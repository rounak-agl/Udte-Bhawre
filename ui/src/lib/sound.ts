import { useEffect, useRef } from "react";
import { CREW, type CrewId, type ToyState } from "../crew/roster";
import type { World } from "../sim/store";

const KEY = "crew.sound";
const PITCH: Record<CrewId, number> = { bo: 1, pim: 1.26, tuck: 0.84, zip: 1.5, penny: 1.12 };

export type Cue = "hatch" | "open" | "done" | "needs" | "oops" | "home";

export const soundOn = () => localStorage.getItem(KEY) === "1";
export const setSound = (on: boolean) => localStorage.setItem(KEY, on ? "1" : "0");

let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(a: AudioContext, f0: number, f1: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function cue(name: Cue, crew: CrewId = "bo") {
  if (!soundOn()) return;
  const a = audio();
  const t = a.currentTime + 0.01;
  const p = PITCH[crew] ?? 1;
  const f = (hz: number) => hz * p;
  switch (name) {
    case "hatch":
      tone(a, f(320), f(880), t, 0.16, 0.06, "triangle");
      tone(a, f(880), f(1100), t + 0.14, 0.1, 0.035);
      break;
    case "open":
      tone(a, f(660), f(740), t, 0.07, 0.04);
      break;
    case "done":
      tone(a, f(660), f(660), t, 0.12, 0.05);
      tone(a, f(830), f(830), t + 0.1, 0.2, 0.05);
      break;
    case "needs":
      tone(a, f(740), f(740), t, 0.11, 0.045, "triangle");
      tone(a, f(990), f(990), t + 0.13, 0.14, 0.04, "triangle");
      break;
    case "oops":
      tone(a, f(520), f(300), t, 0.26, 0.05, "triangle");
      break;
    case "home":
      tone(a, f(880), f(330), t, 0.18, 0.04);
      break;
  }
}

const ON_ENTER: Partial<Record<ToyState, Cue>> = { hatching: "hatch", done: "done", "needs-you": "needs", oops: "oops", returning: "home" };

export function useCrewSounds(world: World) {
  const prev = useRef<Partial<Record<CrewId, ToyState>>>({});
  useEffect(() => {
    for (const c of CREW) {
      const s = world.crew[c.id].state;
      const was = prev.current[c.id];
      prev.current[c.id] = s;
      if (was === undefined || was === s) continue;
      const name = ON_ENTER[s];
      if (name) cue(name, c.id);
    }
  }, [world]);
}
