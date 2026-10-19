import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ToyRig } from "./toy";
import type { CrewId, ToyState } from "./roster";

export type StageToy = {
  key: string;
  id: CrewId | "mini";
  hex: number;
  x: number;
  y: number;
  state: ToyState;
  size?: number;
  spawn?: { x: number; y: number };
  spawnFrom?: string;
  follow?: boolean;
};

type Body = {
  rig: ToyRig;
  pos: THREE.Vector2;
  vel: THREE.Vector2;
  home: THREE.Vector2;
  size: number;
  held: boolean;
  tossed: boolean;
  placed: boolean;
  anchor: HTMLDivElement | null;
  seed: number;
  prev: THREE.Vector2;
  angle: number;
  angVel: number;
  phase: number;
  wanderAt: number;
  hatched: boolean;
  fromPortal: boolean;
  walking: boolean;
};

type Props = {
  toys: StageToy[];
  float?: boolean;
  intensity?: number;
  reduced?: boolean;
  tilt?: number;
  onToyClick?: (key: string) => void;
  onToyDrop?: (key: string, data: DataTransfer) => void;
  onToyMove?: (key: string, x: number, y: number) => void;
  overlay?: (toy: StageToy) => ReactNode;
  onHoverChange?: (key: string | null) => void;
  className?: string;
  band?: number;
  maxPixelRatio?: number;
};

const FPS_LIVE = 60;
const FPS_ANIM = 30;
const FPS_CALM = 15;
const FPS_STILL = 6;

export function ToyStage({ toys, float = false, intensity = 1, reduced, tilt = 0.14, onToyClick, onToyDrop, onToyMove, overlay, onHoverChange, className, band, maxPixelRatio = 2 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const scene = useRef<THREE.Scene | null>(null);
  const live = useRef({ toys, float, intensity, reduced: !!reduced, tilt, onToyClick, onToyDrop, onToyMove, onHoverChange });
  live.current = { toys, float, intensity, reduced: !!reduced, tilt, onToyClick, onToyDrop, onToyMove, onHoverChange };
  const anchors = useRef(new Map<string, HTMLDivElement>());
  const hoverKey = useRef<string | null>(null);
  const dropKey = useRef<string | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const config = useRef({ band, maxPixelRatio });

  useEffect(() => {
    wakeRef.current();
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = wrap.current!;
    const { band: bandPx, maxPixelRatio: maxDpr } = config.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x000000, 0);

    const sc = new THREE.Scene();
    scene.current = sc;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    sc.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    sc.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff6ec, 2.3);
    key.position.set(-3, 5, 6);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    rim.position.set(4, 2, -3);
    const fill = new THREE.HemisphereLight(0xffffff, 0xd9d4cc, 0.9);
    sc.add(key, rim, fill);
    const light = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      rim.intensity = dark ? 2.2 : 0.9;
      rim.color.set(dark ? 0xcfdcff : 0xdfe8ff);
      fill.intensity = dark ? 0.75 : 0.9;
      fill.groundColor.set(dark ? 0x2a2a2a : 0xd9d4cc);
      renderer.toneMappingExposure = dark ? 1.08 : 1;
    };
    light();
    const mo = new MutationObserver(() => {
      light();
      wake();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
    camera.position.z = 500;

    let W = 1;
    let H = 1;
    let full = !bandPx;
    let calmSince = 0;
    const view = { top: 0, h: 1 };
    const applyView = () => {
      const h = full || !bandPx ? H : Math.min(H, bandPx);
      const top = H - h;
      view.top = top;
      view.h = h;
      renderer.setSize(W, h, false);
      canvas.style.top = `${top}px`;
      canvas.style.height = `${h}px`;
      camera.left = 0;
      camera.right = W;
      camera.top = -top;
      camera.bottom = -(top + h);
      camera.updateProjectionMatrix();
    };
    const measure = () => {
      W = Math.max(1, host.clientWidth);
      H = Math.max(1, host.clientHeight);
      applyView();
    };
    const resize = () => {
      measure();
      wake();
    };
    measure();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const pointer = new THREE.Vector2(-9999, -9999);
    const ndc = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    let drag: { key: string; dx: number; dy: number; sx: number; sy: number; moved: boolean; hist: { x: number; y: number; t: number }[] } | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pick = (x: number, y: number): string | null => {
      if (y < view.top || y > view.top + view.h) return null;
      ndc.set((x / W) * 2 - 1, -((y - view.top) / view.h) * 2 + 1);
      let aimed = false;
      let best: { k: string; d: number } | null = null;
      for (const [k, b] of bodies.current) {
        const reach = b.size * (b.rig.parts.height + 0.4);
        if (Math.abs(x - b.pos.x) > b.size || y < b.pos.y - reach || y > b.pos.y + b.size * 0.3) continue;
        if (!aimed) {
          ray.setFromCamera(ndc, camera);
          aimed = true;
        }
        const hits = ray.intersectObject(b.rig.parts.lift, true);
        if (hits.length && (!best || hits[0].distance < best.d)) best = { k, d: hits[0].distance };
      }
      return best?.k ?? null;
    };

    let pickDue = false;
    const hover = (k: string | null) => {
      if (k !== hoverKey.current) live.current.onHoverChange?.(k);
      hoverKey.current = k;
      host.style.cursor = k ? "grab" : "";
    };
    const nearAny = (x: number, y: number) => {
      for (const b of bodies.current.values()) {
        if (Math.abs(x - b.pos.x) < b.size * 2 && y > b.pos.y - b.size * (b.rig.parts.height + 1.5) && y < b.pos.y + b.size) return true;
      }
      return false;
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      pointer.set(p.x, p.y);
      if (drag) {
        wake();
        const b = bodies.current.get(drag.key);
        if (b) {
          if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) drag.moved = true;
          b.pos.set(p.x - drag.dx, p.y - drag.dy);
          drag.hist.push({ x: p.x, y: p.y, t: performance.now() });
          if (drag.hist.length > 6) drag.hist.shift();
        }
        return;
      }
      if (hoverKey.current || nearAny(p.x, p.y)) {
        pickDue = true;
        wake();
      }
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      const k = pick(p.x, p.y);
      if (!k) return;
      const b = bodies.current.get(k)!;
      drag = { key: k, dx: p.x - b.pos.x, dy: p.y - b.pos.y, sx: p.x, sy: p.y, moved: false, hist: [{ x: p.x, y: p.y, t: performance.now() }] };
      canvas.setPointerCapture(e.pointerId);
      host.style.cursor = "grabbing";
      if (bandPx && !full) {
        full = true;
        applyView();
      }
      wake();
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const b = bodies.current.get(drag.key);
      const d = drag;
      drag = null;
      canvas.releasePointerCapture(e.pointerId);
      host.style.cursor = "";
      if (!b) return;
      b.held = false;
      if (!d.moved) {
        live.current.onToyClick?.(d.key);
        return;
      }
      const h = d.hist;
      const a = h[0];
      const z = h[h.length - 1];
      const dt = Math.max(16, z.t - a.t) / 1000;
      b.vel.set((z.x - a.x) / dt, (z.y - a.y) / dt);
      if (b.vel.length() > 2600) b.vel.setLength(2600);
      b.tossed = true;
      live.current.onToyMove?.(d.key, b.pos.x, b.pos.y);
      wake();
    };
    const onLeave = () => {
      pointer.set(-9999, -9999);
      pickDue = false;
      hover(null);
      wake();
    };
    const nearest = (x: number, y: number) => {
      let best: { k: string; d: number } | null = null;
      for (const [k, b] of bodies.current) {
        const d = Math.hypot(b.pos.x - x, b.pos.y - b.size * 0.6 - y);
        if (d < 150 && (!best || d < best.d)) best = { k, d };
      }
      return best?.k ?? null;
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      const p = local(e);
      const k = nearest(p.x, p.y);
      if (k !== dropKey.current) wake();
      dropKey.current = k;
    };
    const onDragLeave = () => {
      dropKey.current = null;
      wake();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const p = local(e);
      const k = nearest(p.x, p.y);
      dropKey.current = null;
      if (k && e.dataTransfer) live.current.onToyDrop?.(k, e.dataTransfer);
      wake();
    };

    host.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("dragleave", onDragLeave);
    host.addEventListener("drop", onDrop);

    let raf = 0;
    let timer = 0;
    let running = false;
    let last = performance.now();
    let budget = 0;
    let blank = false;
    const want = new Set<string>();
    const settled: Body[] = [];
    const look = { x: 0, y: 0 };
    const placed = new Map<string, string>();
    const schedule = (ms: number) => {
      if (ms <= 4) raf = requestAnimationFrame(loop);
      else
        timer = window.setTimeout(() => {
          timer = 0;
          raf = requestAnimationFrame(loop);
        }, ms);
    };
    const halt = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
      running = false;
    };
    function wake() {
      if (document.hidden) return;
      budget = 0;
      if (running && !timer) return;
      clearTimeout(timer);
      timer = 0;
      if (!running) last = performance.now();
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }
    const onVisibility = () => (document.hidden ? halt() : wake());
    document.addEventListener("visibilitychange", onVisibility);
    wakeRef.current = wake;

    function loop(now: number) {
      raf = 0;
      const gap = now - last;
      if (gap < budget * 0.75) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(0.05, gap / 1000);
      last = now;
      const L = live.current;
      if (pickDue && !drag) {
        pickDue = false;
        hover(pick(pointer.x, pointer.y));
      }
      want.clear();
      for (const t of L.toys) want.add(t.key);
      for (const [k, b] of bodies.current) {
        if (!want.has(k)) {
          sc.remove(b.rig.parts.root);
          bodies.current.delete(k);
          placed.delete(k);
        }
      }
      let moving = !!drag || dropKey.current !== null;
      let lively = false;
      let seedN = bodies.current.size;
      for (const t of L.toys) {
        let b = bodies.current.get(t.key);
        if (!b) {
          const seed = ++seedN + t.key.length;
          const parent = t.spawnFrom ? bodies.current.get(t.spawnFrom) : undefined;
          const origin = parent ? { x: parent.pos.x, y: parent.pos.y - parent.size * 0.8 } : t.spawn;
          const fromPortal = !!origin && t.state === "hatching";
          const sx = fromPortal ? origin!.x : t.x;
          const sy = fromPortal ? origin!.y : t.y;
          const rig = new ToyRig(t.id, t.hex, seed);
          sc.add(rig.parts.root);
          b = {
            rig,
            pos: new THREE.Vector2(sx, sy),
            vel: new THREE.Vector2(),
            home: new THREE.Vector2(t.x, t.y),
            size: t.size ?? 64,
            held: false,
            tossed: false,
            placed: false,
            anchor: null,
            seed,
            prev: new THREE.Vector2(sx, sy),
            angle: 0,
            angVel: 0,
            phase: 0,
            wanderAt: now + 4000 + Math.random() * 6000,
            hatched: t.state !== "hatching",
            fromPortal,
            walking: false,
          };
          if (fromPortal && parent) {
            b.tossed = true;
            b.vel.set((t.x >= parent.pos.x ? 1 : -1) * (60 + Math.random() * 60), -380);
            b.angVel = (Math.random() - 0.5) * 6;
          } else if (fromPortal) {
            b.tossed = true;
            b.vel.set(-140 - Math.random() * 90, -460);
            b.angVel = -4 - Math.random() * 3;
          }
          bodies.current.set(t.key, b);
          if (t.state === "hatching") rig.setState("hatching");
        }
        b.size = t.size ?? 64;
        const ground = t.y;
        const lead = t.follow && t.spawnFrom ? bodies.current.get(t.spawnFrom) : undefined;
        if (lead && !(drag && drag.key === t.key)) b.home.set(THREE.MathUtils.clamp(lead.home.x + t.x, b.size, W - b.size), t.y);
        else if (!b.placed && !b.tossed && !(drag && drag.key === t.key)) b.home.set(t.x, t.y);
        const isDrag = !!drag && drag.key === t.key && drag.moved;
        b.held = isDrag;
        let s: ToyState = t.state;
        if (s === "hatching") {
          if (b.hatched) s = "idle";
          else if (b.rig.state === "hatching") b.hatched = true;
        }
        if (isDrag) s = "held";
        else if (dropKey.current === t.key) s = "listening";
        else if (hoverKey.current === t.key && (t.state === "idle" || t.state === "sleeping")) s = "hover";
        if (b.rig.state !== "hatching" || s === "returning" || s === "held") b.rig.setState(s);

        let walk = 0;
        if (isDrag) {
          const vx = (b.pos.x - b.prev.x) / Math.max(dt, 1e-3);
          const target = THREE.MathUtils.clamp(-vx * 0.0011, -0.95, 0.95);
          b.angVel += ((target - b.angle) * 120 - b.angVel * 8) * dt;
          b.angle += b.angVel * dt;
        } else if (b.tossed) {
          b.pos.addScaledVector(b.vel, dt);
          b.vel.x *= Math.exp(-0.9 * dt);
          b.vel.y += 2400 * dt;
          b.angle += b.angVel * dt;
          b.angVel *= Math.exp(-1.1 * dt);
          const m = b.size * 0.6;
          const floorY = L.float ? ground : b.home.y;
          if (b.pos.x < m) {
            b.pos.x = m;
            b.vel.x = Math.abs(b.vel.x) * 0.5;
            b.angVel = -b.angVel * 0.6;
            b.rig.land(0.5);
          }
          if (b.pos.x > W - m) {
            b.pos.x = W - m;
            b.vel.x = -Math.abs(b.vel.x) * 0.5;
            b.angVel = -b.angVel * 0.6;
            b.rig.land(0.5);
          }
          if (b.pos.y < b.size * 1.6) {
            b.pos.y = b.size * 1.6;
            b.vel.y = Math.abs(b.vel.y) * 0.4;
          }
          if (b.pos.y >= floorY) {
            b.pos.y = floorY;
            const imp = Math.min(1, Math.abs(b.vel.y) / 1500);
            b.vel.y = -Math.abs(b.vel.y) * 0.38;
            b.vel.x *= 0.7;
            b.angVel = b.angVel * 0.35 - b.angle * 6;
            if (imp > 0.06) b.rig.land(imp);
            if (Math.abs(b.vel.y) < 90) {
              b.tossed = false;
              b.vel.set(0, 0);
              if (b.fromPortal) b.fromPortal = false;
              else if (L.float) {
                b.home.set(b.pos.x, ground);
                b.placed = true;
              }
            }
          }
        } else {
          b.angVel += (-b.angle * 160 - b.angVel * 11) * dt;
          b.angle += b.angVel * dt;
          const busy = t.state !== "idle" || hoverKey.current === t.key || dropKey.current === t.key;
          if (L.float && !L.reduced && !busy && !t.follow && now > b.wanderAt) {
            b.wanderAt = now + 6000 + Math.random() * 8000;
            const span = b.size * (1.5 + Math.random() * 2.5);
            const dir = Math.random() < 0.5 ? -1 : 1;
            const lo = Math.max(b.size, t.x - 260);
            const hi = Math.min(W - 120, t.x + 260);
            let tx = THREE.MathUtils.clamp(b.pos.x + dir * span, lo, hi);
            for (const [ok, ob] of bodies.current) {
              if (ok !== t.key && Math.abs(ob.home.x - tx) < b.size * 1.3) tx = THREE.MathUtils.clamp(b.pos.x - dir * span, lo, hi);
            }
            b.home.set(tx, ground);
            b.placed = true;
          }
          const back = t.spawnFrom ? bodies.current.get(t.spawnFrom)?.pos : t.spawn;
          const goHome = t.state === "returning" && !!back;
          const hx = goHome ? back!.x : b.home.x;
          const hy = L.float ? ground : b.home.y;
          const dx = hx - b.pos.x;
          b.pos.y += (hy - b.pos.y) * Math.min(1, dt * 12);
          if (L.reduced || Math.abs(dx) < 1) {
            b.pos.x = hx;
          } else {
            const speed = b.rig.state === "hatching" ? 150 : goHome ? 120 : 52 + b.size * 0.5;
            const step = Math.min(Math.abs(dx), speed * dt);
            b.pos.x += Math.sign(dx) * step;
            b.phase += step / (b.size * 0.42);
            walk = Math.sign(dx);
          }
        }
        b.prev.copy(b.pos);
        b.walking = walk !== 0;

        const root = b.rig.parts.root;
        const c = b.size * b.rig.parts.height * 0.5;
        root.position.set(b.pos.x + c * Math.sin(b.angle), -b.pos.y + c - c * Math.cos(b.angle), b.walking ? -120 : t.follow ? 60 : 0);
        root.rotation.set(L.tilt, 0, b.angle);
        const headY = b.pos.y - b.size * b.rig.parts.height;
        const near = pointer.x > -9000 && Math.abs(pointer.x - b.pos.x) < 400 && Math.abs(pointer.y - headY) < 400;
        look.x = near ? THREE.MathUtils.clamp((pointer.x - b.pos.x) / 260, -1, 1) : 0;
        look.y = near ? THREE.MathUtils.clamp(-(pointer.y - headY) / 260, -1, 1) : 0;
        b.rig.update(dt, { look, speed: 1, reduced: L.reduced, intensity: L.intensity, walk, stride: b.phase });
        root.scale.multiplyScalar(b.size);
        if (b.tossed || b.held) moving = true;
        if (b.walking) lively = true;
        if (b.rig.lively) lively = true;
        const el = anchors.current.get(t.key);
        if (el) {
          const tf = `translate3d(${b.pos.x.toFixed(1)}px, ${headY.toFixed(1)}px, 0)`;
          if (placed.get(t.key) !== tf) {
            el.style.transform = tf;
            placed.set(t.key, tf);
          }
        }
      }
      settled.length = 0;
      for (const b of bodies.current.values()) if (!b.tossed && !b.held && !b.walking) settled.push(b);
      for (let i = 0; i < settled.length; i++) {
        for (let j = i + 1; j < settled.length; j++) {
          const a = settled[i];
          const o = settled[j];
          const min = (a.size + o.size) * 0.62;
          const d = o.pos.x - a.pos.x;
          if (Math.abs(d) < min && Math.abs(o.pos.y - a.pos.y) < 40) {
            const push = (min - Math.abs(d)) * 0.5 * Math.min(1, dt * 8);
            const sgn = d === 0 ? 1 : Math.sign(d);
            a.pos.x -= sgn * push;
            o.pos.x += sgn * push;
            a.pos.x = THREE.MathUtils.clamp(a.pos.x, a.size * 0.6, W - a.size * 0.6);
            o.pos.x = THREE.MathUtils.clamp(o.pos.x, o.size * 0.6, W - o.size * 0.6);
            if (a.placed) a.home.x = a.pos.x;
            if (o.placed) o.home.x = o.pos.x;
            if (push > 0.05) moving = true;
          }
        }
      }
      if (bandPx) {
        let airborne = !!drag;
        for (const b of bodies.current.values()) if (b.tossed || b.rig.bursting || b.pos.y - b.size * (b.rig.parts.height + 0.6) < H - bandPx) airborne = true;
        if (airborne) calmSince = now;
        const wantFull = airborne || now - calmSince < 400;
        if (wantFull !== full) {
          full = wantFull;
          applyView();
        }
      }
      const empty = !bodies.current.size && !L.toys.length;
      if (!empty || !blank) renderer.render(sc, camera);
      blank = empty;
      if (empty) {
        running = false;
        return;
      }
      const fps = drag ? 0 : moving ? FPS_LIVE : lively && !L.reduced ? FPS_ANIM : L.reduced ? FPS_STILL : FPS_CALM;
      budget = fps ? 1000 / fps : 0;
      schedule(fps >= FPS_LIVE || !fps ? 0 : budget - (performance.now() - now));
    }
    wake();

    return () => {
      halt();
      wakeRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      mo.disconnect();
      host.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("dragleave", onDragLeave);
      host.removeEventListener("drop", onDrop);
      bodies.current.clear();
      sc.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrap} className={`toy-stage ${className ?? ""}`} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", touchAction: "none" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {overlay &&
          toys.map((t) => (
            <div
              key={t.key}
              ref={(el) => {
                if (el) anchors.current.set(t.key, el);
                else anchors.current.delete(t.key);
              }}
              style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}
            >
              {overlay(t)}
            </div>
          ))}
      </div>
    </div>
  );
}
