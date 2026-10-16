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
  className?: string;
};

export function ToyStage({ toys, float = false, intensity = 1, reduced, tilt = 0.14, onToyClick, onToyDrop, onToyMove, overlay, className }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const scene = useRef<THREE.Scene | null>(null);
  const live = useRef({ toys, float, intensity, reduced: !!reduced, tilt, onToyClick, onToyDrop, onToyMove });
  live.current = { toys, float, intensity, reduced: !!reduced, tilt, onToyClick, onToyDrop, onToyMove };
  const anchors = useRef(new Map<string, HTMLDivElement>());
  const hoverKey = useRef<string | null>(null);
  const dropKey = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = wrap.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x000000, 0);

    const sc = new THREE.Scene();
    scene.current = sc;
    const pmrem = new THREE.PMREMGenerator(renderer);
    sc.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff6ec, 2.3);
    key.position.set(-3, 5, 6);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    rim.position.set(4, 2, -3);
    const fill = new THREE.HemisphereLight(0xffffff, 0xd9d4cc, 0.9);
    sc.add(key, rim, fill);

    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
    camera.position.z = 500;

    let W = 1;
    let H = 1;
    const resize = () => {
      W = host.clientWidth;
      H = host.clientHeight;
      renderer.setSize(W, H, false);
      camera.left = 0;
      camera.right = W;
      camera.top = 0;
      camera.bottom = -H;
      camera.updateProjectionMatrix();
    };
    resize();
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
      ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      let best: { k: string; d: number } | null = null;
      for (const [k, b] of bodies.current) {
        const hits = ray.intersectObject(b.rig.parts.lift, true);
        if (hits.length && (!best || hits[0].distance < best.d)) best = { k, d: hits[0].distance };
      }
      return best?.k ?? null;
    };

    const onMove = (e: PointerEvent) => {
      const p = local(e);
      pointer.set(p.x, p.y);
      if (drag) {
        const b = bodies.current.get(drag.key);
        if (b) {
          if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) drag.moved = true;
          b.pos.set(p.x - drag.dx, p.y - drag.dy);
          drag.hist.push({ x: p.x, y: p.y, t: performance.now() });
          if (drag.hist.length > 6) drag.hist.shift();
        }
        return;
      }
      const k = pick(p.x, p.y);
      hoverKey.current = k;
      host.style.cursor = k ? "grab" : "";
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      const k = pick(p.x, p.y);
      if (!k) return;
      const b = bodies.current.get(k)!;
      drag = { key: k, dx: p.x - b.pos.x, dy: p.y - b.pos.y, sx: p.x, sy: p.y, moved: false, hist: [{ x: p.x, y: p.y, t: performance.now() }] };
      canvas.setPointerCapture(e.pointerId);
      host.style.cursor = "grabbing";
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
    };
    const onLeave = () => {
      pointer.set(-9999, -9999);
      hoverKey.current = null;
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
      dropKey.current = nearest(p.x, p.y);
    };
    const onDragLeave = () => {
      dropKey.current = null;
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const p = local(e);
      const k = nearest(p.x, p.y);
      dropKey.current = null;
      if (k && e.dataTransfer) live.current.onToyDrop?.(k, e.dataTransfer);
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("dragleave", onDragLeave);
    host.addEventListener("drop", onDrop);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const L = live.current;
      const want = new Map(L.toys.map((t) => [t.key, t]));
      for (const [k, b] of bodies.current) {
        if (!want.has(k)) {
          sc.remove(b.rig.parts.root);
          bodies.current.delete(k);
        }
      }
      let seedN = bodies.current.size;
      for (const t of L.toys) {
        let b = bodies.current.get(t.key);
        if (!b) {
          const seed = ++seedN + t.key.length;
          const rig = new ToyRig(t.id, t.hex, seed);
          sc.add(rig.parts.root);
          b = { rig, pos: new THREE.Vector2(t.spawn?.x ?? t.x, t.spawn?.y ?? t.y), vel: new THREE.Vector2(), home: new THREE.Vector2(t.x, t.y), size: t.size ?? 64, held: false, tossed: false, placed: false, anchor: null, seed };
          bodies.current.set(t.key, b);
          if (t.state === "hatching") rig.setState("hatching");
        }
        b.size = t.size ?? 64;
        if (!b.placed && !b.tossed && !(drag && drag.key === t.key)) b.home.set(t.x, t.y);
        const isDrag = !!drag && drag.key === t.key && drag.moved;
        b.held = isDrag;
        let s: ToyState = t.state;
        if (isDrag) s = "held";
        else if (dropKey.current === t.key) s = "listening";
        else if (hoverKey.current === t.key && (t.state === "idle" || t.state === "sleeping")) s = "hover";
        if (b.rig.state !== "hatching" || s === "returning") b.rig.setState(s);

        let walk = 0;
        if (!isDrag) {
          if (b.tossed) {
            b.pos.addScaledVector(b.vel, dt);
            b.vel.multiplyScalar(Math.exp(-2.4 * dt));
            b.vel.y += 2200 * dt;
            const m = b.size * 0.6;
            const floorY = L.float ? H - 12 : b.home.y;
            if (b.pos.x < m) {
              b.pos.x = m;
              b.vel.x = Math.abs(b.vel.x) * 0.55;
              b.rig.land(0.6);
            }
            if (b.pos.x > W - m) {
              b.pos.x = W - m;
              b.vel.x = -Math.abs(b.vel.x) * 0.55;
              b.rig.land(0.6);
            }
            if (b.pos.y < b.size * 1.6) {
              b.pos.y = b.size * 1.6;
              b.vel.y = Math.abs(b.vel.y) * 0.5;
            }
            if (b.pos.y > floorY) {
              b.pos.y = floorY;
              const imp = Math.min(1, Math.abs(b.vel.y) / 1400);
              b.vel.y = -Math.abs(b.vel.y) * 0.42;
              if (imp > 0.08) b.rig.land(imp);
            }
            if (b.vel.length() < 30) {
              b.tossed = false;
              b.vel.set(0, 0);
              if (L.float) {
                b.home.copy(b.pos);
                b.placed = true;
              }
            }
          } else {
            const goHome = t.state === "returning" && t.spawn;
            const hx = goHome ? t.spawn!.x : b.home.x;
            const hy = goHome ? t.spawn!.y : b.home.y;
            const dx = hx - b.pos.x;
            const dy = hy - b.pos.y;
            const dist = Math.hypot(dx, dy);
            if (L.reduced || dist < 1) {
              b.pos.set(hx, hy);
            } else {
              const step = Math.min(dist, (b.rig.state === "hatching" ? 260 : 170) * dt);
              b.pos.x += (dx / dist) * step;
              b.pos.y += (dy / dist) * step;
              walk = Math.abs(dx) > 2 ? Math.sign(dx) : 0.001;
            }
          }
        }

        const root = b.rig.parts.root;
        root.position.set(b.pos.x, -b.pos.y, 0);
        root.rotation.x = L.tilt;
        const headY = b.pos.y - b.size * b.rig.parts.height;
        const look = {
          x: THREE.MathUtils.clamp((pointer.x - b.pos.x) / 260, -1, 1),
          y: THREE.MathUtils.clamp(-(pointer.y - headY) / 260, -1, 1),
        };
        if (pointer.x < -9000) {
          look.x = 0;
          look.y = 0;
        }
        b.rig.update(dt, { look, speed: 1, reduced: L.reduced, intensity: L.intensity, walk });
        root.scale.multiplyScalar(b.size);
        const el = anchors.current.get(t.key);
        if (el) el.style.transform = `translate3d(${b.pos.x}px, ${headY}px, 0)`;
      }
      renderer.render(sc, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("dragleave", onDragLeave);
      host.removeEventListener("drop", onDrop);
      bodies.current.clear();
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrap} className={`toy-stage ${className ?? ""}`} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }} />
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
