import { useSyncExternalStore } from "react";
import { CREW, type CrewId, type ToyState } from "../crew/roster";
import { OOPS_SCRIPT, SCRIPTS } from "./scripts";
import type { Msg, Script } from "./types";

export type CrewLive = {
  state: ToyState;
  msgs: Msg[];
  peek: string | null;
  busy: boolean;
  waiting: boolean;
  queued: string[];
};

type World = {
  crew: Record<CrewId, CrewLive>;
  summoned: CrewId[];
  speed: number;
};

const blank = (): CrewLive => ({ state: "idle", msgs: [], peek: null, busy: false, waiting: false, queued: [] });

let world: World = {
  crew: Object.fromEntries(CREW.map((c) => [c.id, blank()])) as Record<CrewId, CrewLive>,
  summoned: ["bo", "pim", "penny"],
  speed: 1,
};

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const patch = (id: CrewId, p: Partial<CrewLive> | ((c: CrewLive) => Partial<CrewLive>)) => {
  const cur = world.crew[id];
  const next = typeof p === "function" ? p(cur) : p;
  world = { ...world, crew: { ...world.crew, [id]: { ...cur, ...next } } };
  emit();
};
const push = (id: CrewId, m: Msg) => patch(id, (c) => ({ msgs: [...c.msgs, m] }));
const edit = (id: CrewId, mid: string, f: (m: Msg) => Msg) => patch(id, (c) => ({ msgs: c.msgs.map((m) => (m.id === mid ? f(m) : m)) }));

let n = 0;
const uid = () => `m${++n}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / world.speed));
const approvals = new Map<string, (ok: boolean) => void>();

async function run(id: CrewId, script: Script, text: string, files?: { name: string; size: string }[]) {
  patch(id, { busy: true, peek: null });
  push(id, { kind: "user", id: uid(), text, files: files ?? script.files });
  patch(id, { state: "listening" });
  await sleep(350);
  let toolsId: string | null = null;
  for (const s of script.steps) {
    if ("wait" in s) {
      if (s.state) patch(id, { state: s.state });
      await sleep(s.wait);
    } else if ("state" in s) {
      patch(id, { state: s.state });
    } else if ("tool" in s) {
      const item = { ...s.tool, id: uid(), status: "running" as const };
      if (!toolsId) {
        toolsId = uid();
        push(id, { kind: "tools", id: toolsId, items: [item] });
      } else {
        edit(id, toolsId, (m) => (m.kind === "tools" ? { ...m, items: [...m.items, item] } : m));
      }
      await sleep(s.tool.ms ?? 600);
      const tid = toolsId;
      edit(id, tid, (m) => (m.kind === "tools" ? { ...m, items: m.items.map((x) => (x.id === item.id ? { ...x, status: s.fail ? "failed" : "done" } : x)) } : m));
    } else if ("stream" in s) {
      toolsId = null;
      const mid = uid();
      push(id, { kind: "text", id: mid, text: "", streaming: true });
      const words = s.stream.split(/(\s+)/);
      let acc = "";
      for (const w of words) {
        acc += w;
        edit(id, mid, (m) => (m.kind === "text" ? { ...m, text: acc } : m));
        await sleep(18);
      }
      edit(id, mid, (m) => (m.kind === "text" ? { ...m, streaming: false } : m));
      await sleep(250);
    } else if ("say" in s) {
      push(id, { kind: "text", id: uid(), text: s.say });
    } else if ("card" in s) {
      toolsId = null;
      push(id, { kind: "card", id: uid(), card: s.card });
      await sleep(500);
    } else if ("plan" in s) {
      toolsId = null;
      const pid = uid();
      push(id, { kind: "plan", id: pid, ...s.plan, status: "pending" });
      patch(id, { state: "needs-you", waiting: true, peek: "Needs your OK to continue." });
      const ok = await new Promise<boolean>((r) => approvals.set(pid, r));
      approvals.delete(pid);
      edit(id, pid, (m) => (m.kind === "plan" ? { ...m, status: ok ? "approved" : "denied" } : m));
      patch(id, { waiting: false, peek: null });
      if (!ok) {
        push(id, { kind: "text", id: uid(), text: "Okay, I stopped there. Nothing was sent or changed." });
        patch(id, { state: "idle", busy: false });
        return;
      }
    } else if ("error" in s) {
      push(id, { kind: "error", id: uid(), ...s.error });
    } else if ("peek" in s) {
      patch(id, { peek: s.peek });
    }
  }
  patch(id, { busy: false });
  await sleep(2600);
  if (world.crew[id].state === "done") patch(id, { state: "idle" });
}

export const sim = {
  send(id: CrewId, text?: string, files?: { name: string; size: string }[]) {
    const c = world.crew[id];
    if (c.busy) {
      patch(id, { queued: [...c.queued, text ?? ""] });
      return;
    }
    const script = SCRIPTS[id];
    void run(id, script, text?.trim() || script.prompt, files);
  },
  oops(id: CrewId) {
    void run(id, { ...OOPS_SCRIPT, crew: id }, OOPS_SCRIPT.prompt);
  },
  decide(id: CrewId, planId: string, ok: boolean) {
    approvals.get(planId)?.(ok);
    if (!approvals.has(planId)) patch(id, { waiting: false });
  },
  setState(id: CrewId, state: ToyState) {
    patch(id, { state });
  },
  dismissPeek(id: CrewId) {
    patch(id, { peek: null });
  },
  summon(id: CrewId) {
    if (world.summoned.includes(id)) return;
    world = { ...world, summoned: [...world.summoned, id].slice(-4) };
    patch(id, { state: "hatching" });
  },
  dismiss(id: CrewId) {
    patch(id, { state: "returning" });
    setTimeout(() => {
      world = { ...world, summoned: world.summoned.filter((x) => x !== id) };
      patch(id, { state: "idle" });
    }, 700);
  },
  setSummoned(ids: CrewId[]) {
    world = { ...world, summoned: ids };
    emit();
  },
  reset() {
    approvals.clear();
    world = { ...world, crew: Object.fromEntries(CREW.map((c) => [c.id, blank()])) as Record<CrewId, CrewLive> };
    emit();
  },
  setSpeed(s: number) {
    world = { ...world, speed: s };
  },
  snapshot() {
    return world;
  },
  hydrate(w: World) {
    world = w;
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

export type { World };

export function useWorld() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => world,
  );
}
