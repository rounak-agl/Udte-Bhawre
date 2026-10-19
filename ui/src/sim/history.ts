import { CREW } from "../crew/roster";
import type { Msg } from "./types";
import { sim } from "./store";

const KEY = "crew.history.v1";
const KEEP = 200;

function slim(m: Msg): Msg {
  if (m.kind === "user" && m.files) return { ...m, files: m.files.map((f) => ({ name: f.name, size: f.size })) };
  return m;
}

export function loadHistory() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch (err) {
    console.warn("Thread history was unreadable. A copy is kept under crew.history.broken.", err);
    localStorage.removeItem(KEY);
    try {
      localStorage.setItem("crew.history.broken", raw);
    } catch (copyErr) {
      console.warn("Could not keep a copy of the unreadable history.", copyErr);
    }
    return;
  }
  sim.restore(saved);
}

export function keepHistory() {
  let t = 0;
  const pack = (keep: number) => {
    const w = sim.snapshot();
    return JSON.stringify(
      Object.fromEntries(
        CREW.map((c) => {
          const x = w.crew[c.id];
          return [c.id, { msgs: x.msgs.slice(-keep).map(slim), updated: x.updated, jobs: x.jobs, steps: x.steps, day: x.day }];
        }),
      ),
    );
  };
  const save = () => {
    for (const keep of [KEEP, 50, 10]) {
      try {
        localStorage.setItem(KEY, pack(keep));
        if (keep < KEEP) console.warn(`Storage is full, so only the last ${keep} messages per crew member were saved.`);
        return;
      } catch (err) {
        if (keep === 10) console.warn("Could not save thread history.", err);
      }
    }
  };
  const off = sim.subscribe(() => {
    clearTimeout(t);
    t = window.setTimeout(save, 800);
  });
  return () => {
    clearTimeout(t);
    save();
    off();
  };
}

export function clearHistory() {
  localStorage.removeItem(KEY);
  sim.reset();
}
