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
const backlog = new Map<CrewId, { text: string; files?: Attachment[] }[]>();
const lastSent = new Map<CrewId, { key: string; at: number }>();
const timers = new Map<CrewId, ReturnType<typeof setTimeout>>();
const STALL_MS = 180_000;
const DOUBLE_MS = 1500;

function enqueue(id: CrewId, text: string, files?: Attachment[]) {
  const q = [...(backlog.get(id) ?? []), { text, files }];
  backlog.set(id, q);
  patch(id, { queued: q.map((x) => x.text || "Attached files") });
}

function drain(id: CrewId) {
  const q = backlog.get(id);
  if (!q?.length || world.crew[id].busy) return;
  const [next, ...rest] = q;
  backlog.set(id, rest);
  patch(id, { queued: rest.map((x) => x.text || "Attached files") });
  dispatch(id, next.text, next.files);
}

function dispatch(id: CrewId, text: string, files?: Attachment[]) {
  if (world.live) {
    liveSend(id, text, files);
    return;
  }
  const script = SCRIPTS[id];
  void run(id, script, text || script.prompt, files);
}

function arm(id: CrewId) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => stall(id), STALL_MS));
}

function disarm(id: CrewId) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function stall(id: CrewId) {
  const c = world.crew[id];
  if (!c.busy || c.waiting) return;
  closeStream(id);
  turnFailed.add(id);
  push(id, { kind: "error", id: uid(), title: "No reply for 3 minutes", body: "The brain stopped answering, so the job was stopped. Check that it is running, then try again." });
  bridge?.stop(id);
  finishTurn(id);
}

const KINDS = new Set(["user", "text", "tools", "plan", "card", "error"]);

function sane(m: unknown): m is Msg {
  if (!m || typeof m !== "object") return false;
  const x = m as { id?: unknown; kind?: unknown; text?: unknown; items?: unknown };
  if (typeof x.id !== "string" || typeof x.kind !== "string" || !KINDS.has(x.kind)) return false;
  if ((x.kind === "user" || x.kind === "text") && typeof x.text !== "string") return false;
  if (x.kind === "tools" && !Array.isArray(x.items)) return false;
  return true;
}

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
        drain(id);
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
  drain(id);
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
  if (!bridge) {
    push(id, { kind: "error", id: uid(), title: "Not connected", body: "The app backend is not running, so nothing was sent." });
    return;
  }
  const images = (files ?? []).filter((f) => f.image).map((f) => f.image!);
  const texts = (files ?? []).filter((f) => f.text != null);
  const body = [text, ...texts.map((f) => `Attached file ${f.name}:\n\`\`\`\n${f.text}\n\`\`\``)].filter(Boolean).join("\n\n");
  turnFailed.delete(id);
  patch(id, { busy: true, peek: null, state: "listening" });
  push(id, { kind: "user", id: uid(), text: text || (files?.length ? "Take a look at this" : ""), files: files?.map((f) => ({ name: f.name, size: f.size })) });
  arm(id);
  bridge.chatSend(id, body || "Take a look at this", images);
}

const STREAMING = new Set(["crew-thinking", "chat-text", "chat-tool-use", "chat-tool-result", "chat-error", "subagents-update"]);

function finishTurn(id: CrewId) {
  disarm(id);
  closeStream(id);
  if (!world.crew[id].busy) return;
  const failed = turnFailed.has(id);
  if (!failed) tally(id, "jobs");
  const texts = world.crew[id].msgs.filter((m) => m.kind === "text");
  const lastText = texts[texts.length - 1];
  const line = lastText && lastText.kind === "text" ? lastText.text.replace(/```[\s\S]*?```/g, "").trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 110) : "";
  patch(id, { busy: false, waiting: false, subs: [], state: failed ? "oops" : "done", peek: failed ? "Couldn't finish. Open to see why." : line || "Done." });
  setTimeout(() => {
    const st = world.crew[id].state;
    if (st === "done" || st === "oops") patch(id, { state: "idle" });
  }, failed ? 6000 : 2600);
  drain(id);
}

function onBackend(id: CrewId, channel: string, args: unknown[]) {
  if (!world.crew[id]) return;
  if (STREAMING.has(channel) && !world.crew[id].busy) return;
  if (world.crew[id].busy && channel !== "chat-turn-complete") arm(id);
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
      const a = (args[0] ?? {}) as { planId?: string; message?: string };
      const pid = a.planId ? String(a.planId) : uid();
      if (world.crew[id].msgs.some((m) => m.id === pid)) break;
      push(id, { kind: "plan", id: pid, summary: String(a.message ?? "Wants to take a step that needs your OK."), steps: [], status: "pending" });
      patch(id, { state: "needs-you", waiting: true, peek: "Needs your OK to continue." });
      break;
    }
    case "subagents-update": {
      const u = (args[0] ?? {}) as { active?: boolean; tasks?: { id: string; title: string; status: string }[] };
      const subs = u.active === false ? [] : (u.tasks ?? []).map((t) => ({ id: String(t.id), title: String(t.title ?? ""), status: subStatus(t.status) }));
      patch(id, { subs });
      break;
    }
    case "crew-approval-expired": {
      const pid = String(((args[0] ?? {}) as { planId?: string }).planId ?? "");
      const plan = world.crew[id].msgs.find((m) => m.id === pid);
      if (!plan || plan.kind !== "plan" || plan.status !== "pending") break;
      edit(id, pid, (m) => (m.kind === "plan" ? { ...m, status: "denied" } : m));
      push(id, { kind: "text", id: uid(), text: "I waited 5 minutes for your OK, then skipped that step. Nothing was changed." });
      patch(id, { waiting: false, peek: null, state: "working" });
      if (world.crew[id].busy) arm(id);
      break;
    }
    case "chat-busy":
      push(id, { kind: "error", id: uid(), title: "Still on the last job", body: String(args[0] ?? "Send that again when this one finishes.") });
      patch(id, { busy: true, state: "working" });
      arm(id);
      break;
    case "chat-error":
      closeStream(id);
      turnFailed.add(id);
      push(id, { kind: "error", id: uid(), title: "That didn't work", body: String(args[0] ?? "Something went wrong. Nothing was changed.") });
      break;
    case "chat-turn-complete":
      finishTurn(id);
      break;
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
    if (!world.crew[id]) return;
    disarm(id);
    closeStream(id);
    backlog.delete(id);
    if (world.live) bridge?.stop(id);
    patch(id, { busy: false, waiting: false, state: "idle", queued: [], subs: [] });
  },
  send(id: CrewId, text?: string, files?: Attachment[]) {
    const c = world.crew[id];
    if (!c) return;
    const t = text?.trim() ?? "";
    if (world.live && !t && !files?.length) return;
    const key = `${t}|${(files ?? []).map((f) => `${f.name}:${f.size}`).join(",")}`;
    const last = lastSent.get(id);
    if (key !== "|" && last?.key === key && Date.now() - last.at < DOUBLE_MS) return;
    lastSent.set(id, { key, at: Date.now() });
    if (c.busy) {
      enqueue(id, t, files);
      return;
    }
    dispatch(id, t, files);
  },
  retry(id: CrewId) {
    const c = world.crew[id];
    if (!c || c.busy) return;
    const ask = [...c.msgs].reverse().find((m) => m.kind === "user");
    dispatch(id, ask && ask.kind === "user" ? ask.text : "");
  },
  oops(id: CrewId) {
    void run(id, { ...OOPS_SCRIPT, crew: id }, OOPS_SCRIPT.prompt);
  },
  decide(id: CrewId, planId: string, ok: boolean) {
    const plan = world.crew[id]?.msgs.find((m) => m.id === planId);
    if (!plan || plan.kind !== "plan" || plan.status !== "pending") return;
    if (world.live) {
      bridge?.decide(planId, ok);
      if (world.crew[id].busy) arm(id);
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
  setSubs(id: CrewId, subs: Sub[]) {
    patch(id, { subs });
  },
  dismissPeek(id: CrewId) {
    patch(id, { peek: null });
  },
  summon(id: CrewId) {
    if (world.summoned.includes(id)) {
      if (world.crew[id].state === "returning") patch(id, { state: world.crew[id].busy ? "working" : "idle" });
      return;
    }
    world = { ...world, summoned: [...world.summoned, id].slice(-4) };
    patch(id, { state: "hatching" });
    setTimeout(() => {
      if (world.crew[id].state === "hatching") patch(id, { state: "idle" });
    }, 900);
  },
  dismiss(id: CrewId) {
    patch(id, { state: "returning" });
    setTimeout(() => {
      if (world.crew[id].state !== "returning") return;
      world = { ...world, summoned: world.summoned.filter((x) => x !== id) };
      patch(id, { state: world.crew[id].busy ? "working" : "idle" });
    }, 700);
  },
  setSummoned(ids: CrewId[]) {
    world = { ...world, summoned: ids };
    emit();
  },
  reset() {
    approvals.clear();
    backlog.clear();
    lastSent.clear();
    turnFailed.clear();
    timers.forEach(clearTimeout);
    timers.clear();
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
  restore(saved: unknown) {
    if (!saved || typeof saved !== "object") return;
    const crew = { ...world.crew };
    for (const c of CREW) {
      const h = (saved as Record<string, Partial<Record<"msgs" | "updated" | "jobs" | "steps" | "day", unknown>> | undefined>)[c.id];
      if (!h || !Array.isArray(h.msgs)) continue;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
      const seen = new Set<string>();
      const msgs = h.msgs.filter((m): m is Msg => sane(m) && !seen.has(m.id) && !!seen.add(m.id)).map((m): Msg => (m.kind === "plan" && m.status === "pending" ? { ...m, status: "denied" } : m.kind === "text" && m.streaming ? { ...m, streaming: false } : m));
      crew[c.id] = { ...crew[c.id], msgs, updated: num(h.updated), ...(h.day === today() ? { jobs: num(h.jobs), steps: num(h.steps), day: today() } : {}) };
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
