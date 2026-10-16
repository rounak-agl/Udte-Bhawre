import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CrewId, ToyState } from "./roster";

type MatKind = "flock" | "gloss" | "satin" | "fur";

function mat(kind: MatKind, color: number | string): THREE.MeshPhysicalMaterial {
  const c = new THREE.Color(color);
  if (kind === "flock" || kind === "fur") {
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.92,
      sheen: 1,
      sheenRoughness: 0.55,
      sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.45),
    });
  }
  if (kind === "gloss") {
    return new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  }
  return new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 });
}

const WHITE = 0xfbfbf8;
const BLACK = 0x141414;
const BEAK = 0xffb81c;

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = false;
  return o;
}

function softSpike(h: number, r: number) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r * 0.86, h * 0.35),
    new THREE.Vector2(r * 0.5, h * 0.72),
    new THREE.Vector2(r * 0.2, h * 0.93),
    new THREE.Vector2(0, h),
  ];
  return new THREE.LatheGeometry(pts, 24);
}

let furTexture: THREE.DataTexture | null = null;
function getFurTexture() {
  if (furTexture) return furTexture;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(rand() * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  furTexture = new THREE.DataTexture(data, size, size);
  furTexture.wrapS = furTexture.wrapT = THREE.RepeatWrapping;
  furTexture.repeat.set(10, 10);
  furTexture.needsUpdate = true;
  return furTexture;
}

function furShells(geo: THREE.BufferGeometry, color: number, layers = 10, length = 0.07) {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  for (let i = 1; i <= layers; i++) {
    const f = i / layers;
    const m = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.72 + 0.28 * f), roughness: 0.95 });
    m.alphaMap = getFurTexture();
    m.alphaTest = 0.25 + 0.7 * f;
    m.transparent = false;
    const offset = length * f;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\ntransformed += normalize(objectNormal) * ${offset.toFixed(4)};`,
      );
    };
    m.customProgramCacheKey = () => `fur-${i}`;
    g.add(new THREE.Mesh(geo, m));
  }
  return g;
}

function stripeTexture(a: string, b: string) {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? a : b;
    ctx.fillRect(0, i * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Eye = {
  group: THREE.Group;
  pupil: THREE.Group;
  lidTop?: THREE.Mesh;
  lidBot?: THREE.Mesh;
  dot: boolean;
  r: number;
};

function makeEye(r: number, lidColor: number, lidKind: MatKind, dot = false): Eye {
  const group = new THREE.Group();
  const pupil = new THREE.Group();
  if (dot) {
    const p = mesh(new THREE.SphereGeometry(r, 24, 16), mat("gloss", BLACK));
    p.scale.set(1, 1.1, 0.6);
    const glint = mesh(new THREE.SphereGeometry(r * 0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), r * 0.35, r * 0.4, r * 0.55);
    pupil.add(p, glint);
    group.add(pupil);
    return { group, pupil, dot: true, r };
  }
  const sclera = mesh(new THREE.SphereGeometry(r, 32, 24), mat("gloss", WHITE));
  const p = mesh(new THREE.SphereGeometry(r * 0.56, 24, 16), mat("gloss", BLACK));
  p.scale.set(1, 1.06, 0.42);
  const glint = mesh(new THREE.SphereGeometry(r * 0.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), r * 0.2, r * 0.22, r * 0.3);
  pupil.add(p, glint);
  pupil.position.z = r * 0.78;
  const lm = mat(lidKind === "fur" ? "flock" : lidKind, lidColor);
  lm.side = THREE.DoubleSide;
  const lidTop = mesh(new THREE.SphereGeometry(r * 1.07, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lm);
  const lidBot = mesh(new THREE.SphereGeometry(r * 1.07, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lm);
  group.add(sclera, pupil, lidTop, lidBot);
  group.scale.z = 0.62;
  return { group, pupil, lidTop, lidBot, dot: false, r };
}

export type ToyParts = {
  root: THREE.Group;
  lift: THREE.Group;
  squash: THREE.Group;
  turn: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
  eyes: Eye[];
  hat?: THREE.Group;
  prop?: THREE.Object3D;
  shadow: THREE.Mesh;
  height: number;
  pivotY: number;
  lidRest: number;
};

let shadowTex: THREE.Texture | null = null;
function getShadowTex() {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.42)");
  g.addColorStop(0.55, "rgba(0,0,0,0.16)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

function arm(color: number, kind: MatKind, len = 0.2, r = 0.085) {
  const pivot = new THREE.Group();
  const a = mesh(new THREE.CapsuleGeometry(r, len, 8, 16), mat(kind === "fur" ? "flock" : kind, color), 0, -len / 2 - r * 0.4, 0);
  pivot.add(a);
  return pivot;
}

function leg(color: number, kind: MatKind, len = 0.12, r = 0.1, sock?: THREE.Texture) {
  const pivot = new THREE.Group();
  const m = mat(kind === "fur" ? "flock" : kind, color);
  if (sock) {
    m.map = sock;
    m.color.set(0xffffff);
  }
  const l = mesh(new THREE.CapsuleGeometry(r, len, 8, 16), m, 0, -(len / 2 + r), 0);
  pivot.add(l);
  return pivot;
}

export function buildToy(id: CrewId | "mini", hex: number): ToyParts {
  const root = new THREE.Group();
  const lift = new THREE.Group();
  const turn = new THREE.Group();
  const squash = new THREE.Group();
  root.add(lift);
  lift.add(turn);
  turn.add(squash);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.42),
    new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false }),
  );
  shadow.position.set(0, 0.02, -0.5);
  shadow.renderOrder = -1;
  shadow.visible = false;
  root.add(shadow);

  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  const eyes: Eye[] = [];
  let hat: THREE.Group | undefined;
  let prop: THREE.Object3D | undefined;
  let height = 1.3;
  let pivotY = 0.2;
  let lidRest = 0.9;

  const addLegs = (y: number, spread: number, color: number, kind: MatKind, len?: number, r?: number, sock?: THREE.Texture) => {
    for (const s of [-1, 1]) {
      const l = leg(color, kind, len, r, sock);
      l.position.set(s * spread, y, 0.02);
      turn.add(l);
      legs.push(l);
    }
  };
  const addArms = (y: number, x: number, color: number, kind: MatKind, len?: number, r?: number) => {
    for (const s of [-1, 1]) {
      const a = arm(color, kind, len, r);
      a.position.set(s * x, y, 0.02);
      a.rotation.z = s * 0.35;
      squash.add(a);
      arms.push(a);
    }
  };
  const addEyes = (y: number, x: number, z: number, r: number, lid: number, kind: MatKind, dot = false) => {
    for (const s of [-1, 1]) {
      const e = makeEye(r, lid, kind, dot);
      e.group.position.set(s * x, y, z);
      e.group.rotation.y = s * 0.12;
      squash.add(e.group);
      eyes.push(e);
    }
  };
  const beak = (y: number, z: number, s = 1) => {
    const b = mesh(new THREE.SphereGeometry(0.075 * s, 20, 14), mat("gloss", BEAK), 0, y, z);
    b.scale.set(1.25, 0.78, 0.9);
    squash.add(b);
  };

  if (id === "bo") {
    const body = new THREE.Color(hex).getHex();
    pivotY = 0.18;
    addLegs(0.2, 0.2, body, "flock", 0.06, 0.11);
    const b = mesh(new RoundedBoxGeometry(1.02, 0.98, 0.8, 6, 0.34), mat("flock", body), 0, 0.2 + 0.49, 0);
    squash.add(b);
    const spikes: [number, number, number, number, number][] = [
      [-0.38, 1.08, 0.02, 0.36, 0.5],
      [-0.19, 1.13, 0.06, 0.46, 0.2],
      [0, 1.15, 0.04, 0.54, 0],
      [0.19, 1.13, 0.06, 0.46, -0.2],
      [0.38, 1.08, 0.02, 0.36, -0.5],
      [-0.1, 1.08, -0.2, 0.4, 0.25],
      [0.12, 1.08, -0.2, 0.4, -0.25],
    ];
    for (const [x, y, z, h, rz] of spikes) {
      const s = mesh(softSpike(h, 0.15), mat("flock", body), x, y - 0.06, z);
      s.rotation.z = rz;
      squash.add(s);
    }
    addEyes(0.76, 0.21, 0.31, 0.175, body, "flock");
    beak(0.62, 0.42, 1.1);
    addArms(0.62, 0.53, body, "flock", 0.16, 0.1);
    lidRest = 0.52;
    height = 1.5;
    const env = new THREE.Group();
    const paper = mesh(new RoundedBoxGeometry(0.34, 0.24, 0.03, 2, 0.015), mat("satin", 0xfaf7ee));
    const flap = mesh(new THREE.ConeGeometry(0.17, 0.1, 4, 1), mat("satin", 0xe9e2cf), 0, 0.06, 0.02);
    flap.rotation.set(Math.PI / 2, Math.PI / 4, 0);
    flap.scale.set(1, 1, 0.1);
    const stamp = mesh(new THREE.BoxGeometry(0.06, 0.07, 0.01), mat("satin", 0xff4d5e), 0.11, 0.06, 0.02);
    env.add(paper, flap, stamp);
    env.position.set(0, -0.3, 0.1);
    env.visible = false;
    arms[1].add(env);
    prop = env;
  } else if (id === "pim") {
    const body = new THREE.Color(hex).getHex();
    pivotY = 0.2;
    addLegs(0.22, 0.17, body, "flock", 0.08, 0.1);
    const geo = new THREE.CapsuleGeometry(0.42, 0.56, 12, 32);
    const core = mesh(geo, mat("flock", new THREE.Color(body).multiplyScalar(0.7).getHex()), 0, 0.2 + 0.7, 0);
    const fur = furShells(geo, body);
    fur.position.copy(core.position);
    squash.add(core, fur);
    addEyes(1.03, 0.17, 0.47, 0.165, body, "flock");
    addArms(0.82, 0.45, body, "flock", 0.14, 0.09);
    lidRest = 0.95;
    const cap = new THREE.Group();
    const dome = mesh(new THREE.SphereGeometry(0.3, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat("gloss", 0x2f6bff));
    dome.scale.set(1, 0.85, 1);
    const brim = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 32, 1, false, 0, Math.PI), mat("gloss", 0x2f6bff), 0, 0.01, -0.22);
    brim.scale.set(1, 1, 1.2);
    const button = mesh(new THREE.SphereGeometry(0.04, 12, 8), mat("gloss", 0x2f6bff), 0, 0.26, 0);
    cap.add(dome, brim, button);
    cap.position.set(0.04, 1.5, -0.02);
    cap.scale.setScalar(1.25);
    cap.rotation.set(-0.2, 0.5, -0.22);
    squash.add(cap);
    hat = cap;
    const pencil = new THREE.Group();
    const shaft = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6), mat("satin", 0xffd23f));
    const tip = mesh(new THREE.ConeGeometry(0.03, 0.08, 6), mat("satin", 0xf1d3a7), 0, -0.21, 0);
    tip.rotation.z = Math.PI;
    const eraser = mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.05, 6), mat("satin", 0xff8fc7), 0, 0.19, 0);
    pencil.add(shaft, tip, eraser);
    pencil.position.set(0.44, 1.2, 0.0);
    pencil.rotation.set(0.2, 0, -0.5);
    squash.add(pencil);
    prop = pencil;
    height = 1.6;
  } else if (id === "tuck") {
    pivotY = 0.14;
    addLegs(0.16, 0.24, 0xf2f2ee, "gloss", 0.04, 0.1);
    const b = mesh(new RoundedBoxGeometry(1.02, 0.92, 0.9, 6, 0.24), mat("gloss", WHITE), 0, 0.16 + 0.46, 0);
    squash.add(b);
    addEyes(0.7, 0.2, 0.455, 0.055, WHITE, "gloss", true);
    beak(0.56, 0.47, 1.25);
    for (const s of [-1, 1]) {
      const cheek = mesh(new THREE.SphereGeometry(0.06, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffb3c8, transparent: true, opacity: 0.55 }), s * 0.33, 0.56, 0.452);
      cheek.scale.set(1, 0.6, 0.2);
      squash.add(cheek);
    }
    addArms(0.55, 0.52, WHITE, "gloss", 0.12, 0.09);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 1.08, -0.46);
    const lid = mesh(new RoundedBoxGeometry(1.1, 0.16, 0.98, 4, 0.07), mat("gloss", hex), 0, 0.08, 0.46);
    const knob = mesh(new THREE.SphereGeometry(0.07, 16, 8), mat("gloss", hex), 0, 0.17, 0.46);
    knob.scale.set(1.4, 0.7, 1);
    lidPivot.add(lid, knob);
    squash.add(lidPivot);
    hat = lidPivot;
    const folders = new THREE.Group();
    ["#ffd23f", "#4d9dff", "#ff5a36"].forEach((c, i) => {
      const f = mesh(new RoundedBoxGeometry(0.36, 0.26, 0.02, 2, 0.01), mat("satin", c), (i - 1) * 0.05, 0, (i - 1) * 0.04);
      folders.add(f);
    });
    folders.position.set(0, 1.05, 0);
    folders.visible = false;
    squash.add(folders);
    prop = folders;
    lidRest = 1;
    height = 1.35;
  } else if (id === "zip") {
    const body = new THREE.Color(hex).getHex();
    pivotY = 0.2;
    addLegs(0.22, 0.2, body, "gloss", 0.1, 0.1);
    const b = mesh(new THREE.SphereGeometry(0.52, 48, 32), mat("gloss", body), 0, 0.2 + 0.46, 0);
    b.scale.set(1, 0.9, 0.86);
    const stem = mesh(new THREE.CapsuleGeometry(0.22, 0.5, 12, 24), mat("gloss", body), -0.24, 1.1, -0.04);
    stem.rotation.z = 0.08;
    squash.add(b, stem);
    addEyes(0.84, 0.17, 0.385, 0.155, body, "gloss");
    addArms(0.6, 0.5, body, "gloss", 0.16, 0.09);
    const mega = new THREE.Group();
    const horn = mesh(new THREE.CylinderGeometry(0.16, 0.05, 0.3, 32, 1, true), mat("gloss", 0xffd23f));
    (horn.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
    const handle = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), mat("gloss", 0x111111), 0, -0.12, -0.05);
    mega.add(horn, handle);
    mega.rotation.set(0, 0, Math.PI / 2 + 0.4);
    mega.position.set(0.05, -0.32, 0.12);
    arms[1].add(mega);
    prop = mega;
    lidRest = 1;
    height = 1.55;
  } else if (id === "penny") {
    const body = new THREE.Color(hex).getHex();
    pivotY = 0.24;
    addLegs(0.26, 0.15, 0xffffff, "satin", 0.12, 0.085, stripeTexture("#ff4d5e", "#ffffff"));
    const b = mesh(new THREE.SphereGeometry(0.44, 48, 32), mat("gloss", body), 0, 0.26 + 0.4, 0);
    b.scale.set(1, 0.95, 0.9);
    squash.add(b);
    addEyes(0.74, 0.14, 0.355, 0.12, body, "gloss");
    const mouth = mesh(new THREE.TorusGeometry(0.03, 0.013, 8, 20), mat("gloss", 0x3a2a10), 0, 0.56, 0.4);
    squash.add(mouth);
    addArms(0.6, 0.43, body, "gloss", 0.12, 0.08);
    const visor = new THREE.Group();
    const band = mesh(new THREE.TorusGeometry(0.43, 0.03, 8, 48, Math.PI * 1.1), mat("satin", 0x1f9a55));
    band.rotation.set(Math.PI / 2, 0, Math.PI * 0.95);
    band.scale.set(1, 0.95, 1);
    const brim = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 40, 1, false, -Math.PI / 2.4, Math.PI / 1.2), mat("satin", 0x22b862), 0, -0.01, 0.12);
    brim.scale.set(1, 1, 0.75);
    brim.rotation.x = 0.2;
    visor.add(band, brim);
    visor.position.set(0, 0.9, 0.02);
    visor.rotation.x = -0.15;
    squash.add(visor);
    hat = visor;
    const coin = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 32), mat("gloss", 0xffb300));
    coin.rotation.x = Math.PI / 2;
    coin.position.set(0, 1.1, 0.1);
    coin.visible = false;
    squash.add(coin);
    prop = coin;
    lidRest = 1;
    height = 1.3;
  } else {
    const body = new THREE.Color(hex).getHex();
    pivotY = 0.12;
    addLegs(0.14, 0.07, body, "gloss", 0.06, 0.05);
    const b = mesh(new THREE.CapsuleGeometry(0.15, 0.48, 10, 20), mat("gloss", body), 0, 0.14 + 0.39, 0);
    squash.add(b);
    addEyes(0.74, 0.065, 0.13, 0.06, body, "gloss");
    addArms(0.6, 0.17, body, "gloss", 0.18, 0.04);
    lidRest = 0.45;
    height = 0.95;
  }

  squash.position.y = pivotY;
  for (const c of squash.children) c.position.y -= pivotY;
  return { root, lift, squash, turn, legs, arms, eyes, hat, prop, shadow, height, pivotY, lidRest };
}

class Spring {
  x: number;
  v = 0;
  target: number;
  constructor(
    x: number,
    public k = 220,
    public d = 20,
  ) {
    this.x = x;
    this.target = x;
  }
  step(dt: number) {
    const a = -this.k * (this.x - this.target) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(v: number) {
    this.v += v;
  }
}

export type RigInput = {
  look: { x: number; y: number };
  speed: number;
  reduced: boolean;
  intensity: number;
  walk: number;
  stride: number;
};

type Confetti = { m: THREE.Mesh; v: THREE.Vector3; life: number };

const CONFETTI = [0xff4d5e, 0x4d9dff, 0x35e07f, 0xffd23f, 0xb36bff];

export class ToyRig {
  parts: ToyParts;
  state: ToyState = "idle";
  entered = 0;
  phase: number;
  private lift = new Spring(0, 260, 18);
  private sq = new Spring(1, 340, 16);
  private lean = new Spring(0, 160, 18);
  private tilt = new Spring(0, 140, 16);
  private turnY = new Spring(0, 120, 16);
  private armL = new Spring(0.35, 200, 18);
  private armR = new Spring(-0.35, 200, 18);
  private armRx = new Spring(0, 200, 18);
  private lid = new Spring(1, 400, 30);
  private lidLow = new Spring(0, 300, 26);
  private scale = new Spring(1, 300, 14);
  private hat = new Spring(0, 260, 16);
  private gx = new Spring(0, 120, 16);
  private gy = new Spring(0, 120, 16);
  private nextBlink = 2;
  private blinkUntil = 0;
  private confetti: Confetti[] = [];
  private t = 0;

  constructor(
    public id: CrewId | "mini",
    hex: number,
    seed: number,
  ) {
    this.parts = buildToy(id, hex);
    this.phase = seed * 1.7;
    this.lid.x = this.lid.target = this.parts.lidRest;
    this.nextBlink = 1.5 + (seed % 3);
  }

  setState(s: ToyState) {
    if (s === this.state) return;
    this.state = s;
    this.entered = this.t;
    if (s === "hover") this.lift.kick(1.6);
    if (s === "hatching") {
      this.scale.x = 0.15;
      this.lift.x = -0.5;
      this.sq.x = 1.35;
    }
    if (s === "done") {
      this.lift.kick(4.2);
      this.sq.x = 0.78;
      if (this.id === "zip") this.burst();
    }
    if (s === "working") this.sq.kick(-2);
  }

  land(strength: number) {
    this.sq.x = Math.max(0.7, 1 - strength * 0.25);
  }

  private burst() {
    const root = this.parts.squash;
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.08, 0.01),
        new THREE.MeshBasicMaterial({ color: CONFETTI[i % 5], side: THREE.DoubleSide }),
      );
      m.position.set(0.5, 0.55, 0.3);
      const a = -0.3 + Math.random() * 1.6;
      const sp = 2 + Math.random() * 2.2;
      this.confetti.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp + 1.5, (Math.random() - 0.5) * 1.5), life: 1.4 });
      root.add(m);
    }
  }

  update(dt: number, inp: RigInput) {
    this.t += dt;
    const t = this.t;
    const since = t - this.entered;
    const ph = this.phase;
    const amb = inp.reduced ? 0 : inp.intensity;
    const p = this.parts;
    const rest = p.lidRest;

    let lift = 0;
    let sq = 1;
    let lean = 0;
    let tilt = 0;
    let turn = 0;
    let armL = 0.35;
    let armR = -0.35;
    let armRx = 0;
    let lid = rest;
    let lidLow = 0;
    let scale = 1;
    let hat = 0;
    let gx = inp.look.x;
    let gy = inp.look.y;
    let legSwing = 0;
    let breath = 1 + Math.sin(t * 2.1 + ph) * 0.018 * amb;
    let propVisible = false;

    switch (this.state) {
      case "idle":
        break;
      case "hover":
        lift = 0.1;
        lid = Math.min(1, rest + 0.5);
        armL = 0.7;
        armR = -0.7;
        turn = 0;
        tilt = Math.sin(t * 3) * 0.05 * amb;
        break;
      case "held":
        sq = 0.9;
        lid = 0.1;
        lidLow = 0.45;
        armL = 2.3;
        armR = -2.3;
        legSwing = Math.sin(t * 9) * 0.5 * amb;
        tilt = Math.sin(t * 4.5) * 0.08 * amb;
        breath = 1;
        break;
      case "listening":
        lean = 0.16;
        tilt = 0.14;
        lid = 1;
        armL = 0.5;
        armR = -0.5;
        lift = 0.03;
        break;
      case "thinking":
        tilt = Math.sin(t * 1.3) * 0.12 * amb + 0.06;
        armR = -2.6;
        armRx = -0.6;
        lid = Math.min(1, rest + 0.15);
        gx = 0.6;
        gy = 0.8;
        if (p.hat && this.id === "tuck") hat = -0.15 - Math.abs(Math.sin(t * 2)) * 0.12 * amb;
        break;
      case "working": {
        const hop = Math.abs(Math.sin(t * 5.5));
        lift = hop * 0.09 * amb;
        sq = 1 + (hop < 0.2 ? -0.06 : 0.02) * amb;
        armL = 0.6 + Math.sin(t * 11) * 0.5 * amb;
        armR = -0.6 + Math.sin(t * 11 + Math.PI) * 0.5 * amb;
        lid = Math.min(1, rest + 0.1);
        gx = Math.sin(t * 2.2) * 0.5;
        gy = -0.5;
        propVisible = true;
        if (this.id === "tuck") hat = -0.9;
        if (this.id === "zip") armR = -1.4;
        break;
      }
      case "needs-you": {
        const cycle = (since % 6) / 6;
        const waving = cycle < 0.28;
        armR = -2.75 + (waving ? Math.sin(since * 14) * 0.35 * amb : 0);
        armL = 0.45;
        lid = 1;
        turn = 0;
        gx = 0;
        gy = 0;
        lift = 0.06 + (waving ? Math.abs(Math.sin(since * 7)) * 0.04 * amb : 0);
        break;
      }
      case "done": {
        const k = Math.min(1, since / 0.9);
        turn = k < 1 ? k * Math.PI * 2 : 0;
        lid = 1;
        lidLow = 0.78;
        armL = 2.4;
        armR = -2.4;
        if (since > 1.4) {
          armL = 0.9;
          armR = -0.9;
        }
        propVisible = true;
        if (this.id === "tuck") hat = since < 1.4 ? -1.1 : 0;
        if (this.id === "penny" && p.prop) {
          const c = Math.min(1, since / 1.1);
          p.prop.position.y = 1.1 + Math.sin(c * Math.PI) * 0.8;
          p.prop.rotation.x = Math.PI / 2 + c * Math.PI * 6;
          propVisible = since < 1.15;
        }
        break;
      }
      case "oops":
        armL = 1.5;
        armR = -1.5;
        armRx = 0.3;
        tilt = 0.2;
        lid = 0.55;
        lidLow = 0.25;
        gx = -0.4;
        gy = -0.6;
        sq = 0.97;
        break;
      case "sleeping":
        lid = 0;
        lidLow = 0.15;
        tilt = 0.22;
        breath = 1 + Math.sin(t * 1.1) * 0.035 * (inp.reduced ? 0 : 1);
        lift = -0.01;
        armL = 0.25;
        armR = -0.25;
        break;
      case "hatching":
        scale = 1;
        lid = Math.min(1, rest + 0.4);
        armL = 1.6;
        armR = -1.6;
        if (since > 0.6) this.state = "idle";
        break;
      case "returning":
        scale = inp.walk !== 0 ? 1 : 0.05;
        lift = inp.walk !== 0 ? 0 : -0.3;
        armR = -2.5 + Math.sin(t * 14) * 0.4;
        break;
    }

    let armSwing = 0;
    if (inp.walk !== 0 && !inp.reduced && this.state !== "held") {
      const a = inp.stride * Math.PI * 2;
      lift = Math.abs(Math.sin(a)) * 0.05;
      sq = 1 + Math.abs(Math.cos(a)) * 0.02;
      turn = inp.walk * 1.05;
      legSwing = Math.sin(a) * 0.75;
      armSwing = Math.sin(a) * 0.6;
      armL = 0.25;
      armR = -0.25;
      tilt = 0;
    }

    if (t > this.nextBlink && this.state !== "sleeping" && this.state !== "held") {
      this.blinkUntil = t + 0.13;
      this.nextBlink = t + 2.6 + Math.random() * 3 + (Math.random() < 0.2 ? -2.2 : 0);
    }
    const blinking = t < this.blinkUntil;

    this.lift.target = lift;
    this.sq.target = sq;
    this.lean.target = lean;
    this.tilt.target = tilt;
    this.turnY.target = turn;
    this.armL.target = armL;
    this.armR.target = armR;
    this.armRx.target = armRx;
    this.lid.target = blinking ? 0 : lid;
    this.lidLow.target = lidLow;
    this.scale.target = scale;
    this.hat.target = hat;
    this.gx.target = Math.max(-1, Math.min(1, gx));
    this.gy.target = Math.max(-1, Math.min(1, gy));

    const sdt = Math.min(dt, 1 / 30);
    for (const s of [this.lift, this.sq, this.lean, this.tilt, this.turnY, this.armL, this.armR, this.armRx, this.lid, this.lidLow, this.scale, this.hat, this.gx, this.gy]) {
      if (inp.reduced) {
        s.x = s.target;
        s.v = 0;
      } else s.step(sdt);
    }

    p.lift.position.y = this.lift.x;
    const sy = this.sq.x * breath;
    const sx = 1 / Math.sqrt(Math.max(0.5, sy));
    p.squash.scale.set(sx, sy, sx);
    p.turn.rotation.set(this.lean.x, this.turnY.x, this.tilt.x);
    p.root.scale.setScalar(Math.max(0.01, this.scale.x));
    if (p.arms[0]) {
      p.arms[0].rotation.z = this.armL.x;
      p.arms[0].rotation.x = armSwing;
    }
    if (p.arms[1]) {
      p.arms[1].rotation.z = this.armR.x;
      p.arms[1].rotation.x = this.armRx.x - armSwing;
    }
    p.legs.forEach((l, i) => (l.rotation.x = legSwing * (i ? 1 : -1)));
    if (p.hat && this.id === "tuck") p.hat.rotation.x = this.hat.x;
    if (p.prop) p.prop.visible = propVisible;
    if (p.prop && this.id === "tuck") p.prop.position.y = 1.05 + (this.state === "done" ? Math.max(0, 0.4 - since * 0.4) : 0.15);

    const lidO = THREE.MathUtils.clamp(this.lid.x, 0, 1);
    const lowO = THREE.MathUtils.clamp(this.lidLow.x, 0, 1);
    for (const e of p.eyes) {
      e.pupil.position.x = this.gx.x * e.r * 0.32;
      e.pupil.position.y = this.gy.x * e.r * 0.3;
      if (e.dot) {
        e.group.scale.y = Math.max(0.08, lidO * (1 - lowO * 0.6));
        continue;
      }
      if (e.lidTop) e.lidTop.rotation.x = THREE.MathUtils.lerp(Math.PI / 2, -1.25, lidO);
      if (e.lidBot) e.lidBot.rotation.x = THREE.MathUtils.lerp(0.9, -Math.PI / 2 + 0.25, lowO);
    }

    const h = Math.max(0, this.lift.x);
    p.shadow.scale.setScalar(1 - Math.min(0.5, h * 0.9));
    (p.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - Math.min(0.7, h * 1.4);
  
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.life -= dt;
      c.v.y -= 6 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += dt * 8;
      c.m.rotation.y += dt * 5;
      if (c.life <= 0) {
        c.m.removeFromParent();
        c.m.geometry.dispose();
        this.confetti.splice(i, 1);
      }
    }
  }
}
