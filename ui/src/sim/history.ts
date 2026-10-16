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
  try {
    sim.restore(JSON.parse(raw));
  } catch (err) {
    console.warn("Thread history was unreadable and has been reset.", err);
    localStorage.removeItem(KEY);
  }
}

export function keepHistory() {
  let t = 0;
  const save = () => {
    const w = sim.snapshot();
    const out = Object.fromEntries(
      CREW.map((c) => {
        const x = w.crew[c.id];
        return [c.id, { msgs: x.msgs.slice(-KEEP).map(slim), updated: x.updated, jobs: x.jobs, steps: x.steps, day: x.day }];
      }),
    );
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch (err) {
      console.warn("Could not save thread history.", err);
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
