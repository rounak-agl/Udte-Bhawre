import { useEffect, useRef, useState } from "react";
import { crewById, type CrewId, type ToyState } from "./roster";
import type { StageToy } from "./ToyStage";
import type { World } from "../sim/store";

const HATCH_MS = 900;
const LEAVE_MS = 800;
const MAX = 4;

export const isMini = (key: string) => key.includes(":");
export const parentOf = (key: string) => key.split(":")[0] as CrewId;

export function useMinis(world: World, place: (id: CrewId, i: number) => { x: number; y: number }, portal: { x: number; y: number }, size = 20): StageToy[] {
  const born = useRef(new Map<string, number>());
  const last = useRef(new Map<string, StageToy>());
  const gone = useRef(new Map<string, number>());
  const [, tick] = useState(0);
  const now = performance.now();
  const out: StageToy[] = [];
  const live = new Set<string>();

  world.summoned.forEach((id, i) => {
    const p = place(id, i);
    world.crew[id].subs.slice(0, MAX).forEach((s, j) => {
      const key = `${id}:${s.id}`;
      live.add(key);
      gone.current.delete(key);
      if (!born.current.has(key)) born.current.set(key, now);
      const age = now - born.current.get(key)!;
      const state: ToyState = age < HATCH_MS ? "hatching" : s.status === "done" ? "done" : s.status === "failed" ? "oops" : "working";
      const toy: StageToy = { key, id: "mini", hex: crewById(id).hex, x: (j % 2 ? -1 : 1) * (size * 2 + Math.floor(j / 2) * size * 1.1), y: p.y, state, size, spawn: portal, spawnFrom: id, follow: true };
      last.current.set(key, toy);
      out.push(toy);
    });
  });

  for (const [key, toy] of last.current) {
    if (live.has(key)) continue;
    if (!gone.current.has(key)) gone.current.set(key, now);
    if (now - gone.current.get(key)! > LEAVE_MS) {
      last.current.delete(key);
      born.current.delete(key);
      gone.current.delete(key);
      continue;
    }
    out.push({ ...toy, state: "returning" });
  }

  const pending = out.some((t) => t.state === "hatching" || t.state === "returning");
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => tick((n) => n + 1), 200);
    return () => clearTimeout(t);
  });

  return out;
}
