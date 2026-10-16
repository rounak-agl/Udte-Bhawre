import { useSyncExternalStore } from "react";
import { CREW, type CrewId, type ToyState } from "../crew/roster";
import { OOPS_SCRIPT, SCRIPTS } from "./scripts";
import type { Attachment, Msg, Script } from "./types";
import { bridge } from "../lib/bridge";

export type CrewLive = {
  state: ToyState;
  msgs: Msg[];
  peek: string | null;
  busy: boolean;
  waiting: boolean;
  queued: string[];
  updated: number;
  jobs: number;
  steps: number;
  day: string;
  subs: Sub[];
};

export type Sub = { id: string; title: string; status: "running" | "done" | "failed" };

const subStatus = (s: string): Sub["status"] => (/fail|error|cancel/i.test(s) ? "failed" : /done|complete|finish|success/i.test(s) ? "done" : "running");

export type Connector = { id: string; name: string; description: string; category: string; who: CrewId[]; on: boolean };

export type Overview = { providers: Brain[]; assigned: Partial<Record<CrewId, Brain | null>>; hasGeminiKey: boolean; connectors?: Connector[] };

const today = () => new Date().toDateString();

export type Brain = { key: string; name: string; kind: "local" | "cloud"; supportsImages?: boolean };

type World = {
  crew: Record<CrewId, CrewLive>;
  summoned: CrewId[];
  speed: number;
  live: boolean;
  brains: Partial<Record<CrewId, Brain | null>>;
  providers: Brain[];
  hasGeminiKey: boolean;
  needsSetup: boolean;
  connectors: Connector[];
};

const blank = (): CrewLive => ({ state: "idle", msgs: [], peek: null, busy: false, waiting: false, queued: [], updated: 0, jobs: 0, steps: 0, day: today(), subs: [] });

let world: World = {
  crew: Object.fromEntries(CREW.map((c) => [c.id, blank()])) as Record<CrewId, CrewLive>,
  summoned: ["bo", "pim", "penny"],
  speed: 1,
  live: false,
  brains: {},
  providers: [],
  hasGeminiKey: false,
  needsSetup: false,
  connectors: [],
};

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const patch = (id: CrewId, p: Partial<CrewLive> | ((c: CrewLive) => Partial<CrewLive>)) => {
  const cur = world.crew[id];
  const next = typeof p === "function" ? p(cur) : p;
  world = { ...world, crew: { ...world.crew, [id]: { ...cur, ...next } } };
  emit();
};
const push = (id: CrewId, m: Msg) => patch(id, (c) => ({ msgs: [...c.msgs, m], updated: Date.now() }));
const tally = (id: CrewId, k: "jobs" | "steps") =>
  patch(id, (c) => {
    const d = today();
    const base = c.day === d ? c : { ...c, jobs: 0, steps: 0 };
    return { day: d, jobs: base.jobs + (k === "jobs" ? 1 : 0), steps: base.steps + (k === "steps" ? 1 : 0) };
  });
const edit = (id: CrewId, mid: string, f: (m: Msg) => Msg) => patch(id, (c) => ({ msgs: c.msgs.map((m) => (m.id === mid ? f(m) : m)) }));

let n = 0;
const boot = Date.now().toString(36);
const uid = () => `m${boot}${++n}`;
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
      if (!s.fail) tally(id, "steps");
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
  tally(id, "jobs");
  await sleep(2600);
  if (world.crew[id].state === "done") patch(id, { state: "idle" });
}

function lastMsg(id: CrewId) {
  const m = world.crew[id].msgs;
  return m[m.length - 1];
}

function closeStream(id: CrewId) {
  const l = lastMsg(id);
  if (l && l.kind === "text" && l.streaming) edit(id, l.id, (m) => (m.kind === "text" ? { ...m, streaming: false } : m));
}

function summarise(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, 80);
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const v = o.path ?? o.query ?? o.url ?? o.file ?? o.command ?? o.to ?? o.subject ?? Object.values(o)[0];
    return typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v ?? "").slice(0, 80);
  }
  return String(input).slice(0, 80);
}

function verbOf(name: string) {
  const n = name.replace(/^mcp__[^_]+__/, "").replace(/[_-]+/g, " ").trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

const turnFailed = new Set<CrewId>();

function liveSend(id: CrewId, text: string, files?: Attachment[]) {
  const images = (files ?? []).filter((f) => f.image).map((f) => f.image!);
  const texts = (files ?? []).filter((f) => f.text != null);
  const body = [text, ...texts.map((f) => `Attached file ${f.name}:\n\`\`\`\n${f.text}\n\`\`\``)].filter(Boolean).join("\n\n");
  turnFailed.delete(id);
  patch(id, { busy: true, peek: null, state: "listening" });
  push(id, { kind: "user", id: uid(), text: text || (files?.length ? "Take a look at this" : ""), files: files?.map((f) => ({ name: f.name, size: f.size })) });
  bridge?.chatSend(id, body || "Take a look at this", images);
}

function onBackend(id: CrewId, channel: string, args: unknown[]) {
  if (!world.crew[id]) return;
  switch (channel) {
    case "crew-thinking":
      patch(id, { state: "thinking", busy: true });
      break;
    case "chat-text": {
      const chunk = String(args[0] ?? "");
      const l = lastMsg(id);
      if (l && l.kind === "text" && l.streaming) edit(id, l.id, (m) => (m.kind === "text" ? { ...m, text: m.text + chunk } : m));
      else push(id, { kind: "text", id: uid(), text: chunk, streaming: true });
      if (world.crew[id].state !== "working") patch(id, { state: "working" });
      break;
    }
    case "chat-tool-use": {
      closeStream(id);
      const item = { id: uid(), verb: verbOf(String(args[0] ?? "Tool")), target: summarise(args[1]), status: "running" as const };
      const l = lastMsg(id);
      if (l && l.kind === "tools") edit(id, l.id, (m) => (m.kind === "tools" ? { ...m, items: [...m.items, item] } : m));
      else push(id, { kind: "tools", id: uid(), items: [item] });
      patch(id, { state: "working" });
      break;
    }
    case "chat-tool-result": {
      const failed = !!args[1];
      const msgs = world.crew[id].msgs;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.kind !== "tools") continue;
        const idx = m.items.findIndex((x) => x.status === "running");
        if (idx < 0) break;
        edit(id, m.id, (mm) => (mm.kind === "tools" ? { ...mm, items: mm.items.map((x, j) => (j === idx ? { ...x, status: failed ? "failed" : "done", detail: String(args[0] ?? "") } : x)) } : mm));
        if (!failed) tally(id, "steps");
        break;
      }
      break;
    }
    case "crew-approval": {
      closeStream(id);
      const a = (args[0] ?? {}) as { planId: string; message: string };
      push(id, { kind: "plan", id: a.planId, summary: a.message, steps: [], status: "pending" });
      patch(id, { state: "needs-you", waiting: true, peek: "Needs your OK to continue." });
      break;
    }
    case "subagents-update": {
      const u = (args[0] ?? {}) as { active?: boolean; tasks?: { id: string; title: string; status: string }[] };
      const subs = u.active === false ? [] : (u.tasks ?? []).map((t) => ({ id: String(t.id), title: String(t.title ?? ""), status: subStatus(t.status) }));
      patch(id, { subs });
      break;
    }
    case "chat-error":
      closeStream(id);
      turnFailed.add(id);
      push(id, { kind: "error", id: uid(), title: "That didn't work", body: String(args[0] ?? "Something went wrong. Nothing was changed.") });
      break;
    case "chat-turn-complete": {
      closeStream(id);
      const failed = turnFailed.has(id);
      if (!failed) tally(id, "jobs");
      const texts = world.crew[id].msgs.filter((m) => m.kind === "text");
      const lastText = texts[texts.length - 1];
      const line = lastText && lastText.kind === "text" ? lastText.text.replace(/```[\s\S]*?```/g, "").trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 110) : "";
      patch(id, { busy: false, waiting: false, state: failed ? "oops" : "done", peek: failed ? "Couldn't finish. Open to see why." : line || "Done." });
      setTimeout(() => {
        const st = world.crew[id].state;
        if (st === "done" || st === "oops") patch(id, { state: "idle" });
      }, failed ? 6000 : 2600);
      break;
    }
    case "security-audit-event": {
      const e = (args[0] ?? {}) as { type?: string; data?: { reason?: string; tool?: string } };
      if (e.type && /block/i.test(e.type)) push(id, { kind: "error", id: uid(), title: "Blocked by your safety rules", body: e.data?.reason ?? `${e.data?.tool ?? "A step"} was stopped before it ran.` });
      break;
    }
  }
}

export const sim = {
  setLive(on: boolean) {
    world = { ...world, live: on };
    emit();
  },
  backend(evt: { id: CrewId; channel: string; args: unknown[] }) {
    onBackend(evt.id, evt.channel, evt.args);
  },
  setBrains(o: Overview) {
    const needsSetup = !o.hasGeminiKey && !o.providers.some((p) => p.kind === "local");
    world = { ...world, providers: o.providers, brains: o.assigned, hasGeminiKey: o.hasGeminiKey, needsSetup, connectors: o.connectors ?? world.connectors, summoned: needsSetup && !world.needsSetup ? [] : world.summoned };
    emit();
  },
  stop(id: CrewId) {
    if (world.live) bridge?.stop(id);
    patch(id, { busy: false, waiting: false, state: "idle" });
  },
  send(id: CrewId, text?: string, files?: Attachment[]) {
    if (world.live) {
      if (world.crew[id].busy) {
        patch(id, (c) => ({ queued: [...c.queued, text ?? ""] }));
        return;
      }
      liveSend(id, text?.trim() ?? "", files);
      return;
    }
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
    if (world.live) {
      bridge?.decide(planId, ok);
      edit(id, planId, (m) => (m.kind === "plan" ? { ...m, status: ok ? "approved" : "denied" } : m));
      patch(id, { waiting: false, peek: null, state: ok ? "working" : "idle" });
      return;
    }
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
    setTimeout(() => {
      if (world.crew[id].state === "hatching") patch(id, { state: "idle" });
    }, 900);
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
  restore(saved: Partial<Record<CrewId, Pick<CrewLive, "msgs" | "updated" | "jobs" | "steps" | "day">>>) {
    const crew = { ...world.crew };
    for (const c of CREW) {
      const h = saved[c.id];
      if (!h) continue;
      const msgs = h.msgs.map((m): Msg => (m.kind === "plan" && m.status === "pending" ? { ...m, status: "denied" } : m.kind === "text" && m.streaming ? { ...m, streaming: false } : m));
      crew[c.id] = { ...crew[c.id], msgs, updated: h.updated, ...(h.day === today() ? { jobs: h.jobs, steps: h.steps, day: h.day } : {}) };
    }
    world = { ...world, crew };
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
