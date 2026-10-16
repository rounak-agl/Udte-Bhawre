import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronRight,
  Cloud,
  CreditCard,
  FolderOpen,
  Globe,
  HardDrive,
  House,
  ListChecks,
  Lock,
  MessageSquare,
  MessagesSquare,
  NotebookText,
  Plug,
  Search,
  Settings,
  Sheet,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button, Chip, IconButton, Kbd, Segmented, Status } from "../components/ui";
import { CREW, crewById, type CrewId } from "../crew/roster";
import { CrewFace } from "../crew/CrewFace";
import { ToyStage } from "../crew/ToyStage";
import { sim, useWorld, type Connector, type World } from "../sim/store";
import type { Msg } from "../sim/types";
import { bridge } from "../lib/bridge";
import { cue, setSound, soundOn } from "../lib/sound";
import { setTheme, useTheme, type ThemePref } from "../lib/theme";
import { BrainSetup } from "./BrainSetup";
import "./home.css";

type Place = "today" | "crew" | "threads" | "connections" | "settings";

const NAV: { id: Place; label: string; icon: typeof House }[] = [
  { id: "today", label: "Today", icon: House },
  { id: "crew", label: "Crew", icon: Users },
  { id: "threads", label: "Threads", icon: MessagesSquare },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "settings", label: "Settings", icon: Settings },
];

function Mark() {
  return (
    <span className="mark" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} data-i={i} />
      ))}
    </span>
  );
}

const today = () => new Date().toDateString();

function ago(t: number) {
  if (!t) return "";
  const d = Date.now() - t;
  if (d < 60e3) return "now";
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min`;
  const then = new Date(t);
  const now = new Date();
  if (then.toDateString() === now.toDateString()) return then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (then.toDateString() === y.toDateString()) return "Yesterday";
  return then.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

const STATE_LABEL: Partial<Record<string, string>> = { listening: "Reading", thinking: "Thinking", working: "Working", "needs-you": "Waiting for you" };

function pending(world: World) {
  return CREW.flatMap((c) =>
    world.crew[c.id].msgs.flatMap((m) => (m.kind === "plan" && m.status === "pending" ? [{ crew: c.id, id: m.id, summary: m.summary, at: world.crew[c.id].updated }] : [])),
  );
}

function firstAsk(msgs: Msg[]) {
  const u = msgs.find((m) => m.kind === "user");
  return u && u.kind === "user" ? u.text : "";
}

function lastAsk(msgs: Msg[]) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.kind === "user") return m.text;
  }
  return "";
}

function decide(id: CrewId, planId: string, ok: boolean) {
  if (bridge) bridge.post({ type: "action", name: "decide", id, planId, ok });
  else sim.decide(id, planId, ok);
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}

function Today({ onOpenCrew, world }: { onOpenCrew: (id: CrewId) => void; world: World }) {
  const needs = pending(world);
  const did = CREW.filter((c) => world.crew[c.id].day === today() && world.crew[c.id].jobs > 0);
  const jobs = did.reduce((n, c) => n + world.crew[c.id].jobs, 0);
  const running = CREW.filter((c) => world.crew[c.id].busy);
  const date = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="today">
      <header className="today__hello">
        <p className="eyebrow">{date}</p>
        <h1 className="display today__title">{greeting()}</h1>
        <p className="lede">
          {needs.length ? <b>{needs.length === 1 ? "1 thing needs you." : `${needs.length} things need you.`}</b> : "Nothing needs you right now."}{" "}
          {jobs ? `The crew finished ${jobs} ${jobs === 1 ? "job" : "jobs"} today.` : "The crew has not done anything yet today."}
        </p>
      </header>

      <section className="block">
        <header className="block__head">
          <h2>Needs you</h2>
          <span className="eyebrow num">{needs.length}</span>
        </header>
        {needs.length === 0 ? (
          <Empty>When someone wants to send, pay, delete or post, they stop and ask here first.</Empty>
        ) : (
          <ul className="needs">
            {needs.map((n, i) => {
              const c = crewById(n.crew);
              return (
                <li key={n.id} className="need rise" style={{ "--c": c.color, "--i": i } as CSSProperties}>
                  <CrewFace id={c.id} color={c.color} size={32} />
                  <span className="need__text">
                    <span className="need__t">{n.summary}</span>
                    <span className="eyebrow">
                      {c.name} · Waiting for your OK{n.at ? ` · ${ago(n.at)}` : ""}
                    </span>
                  </span>
                  <Button size="sm" label="Review" onClick={() => onOpenCrew(n.crew)} />
                  <Button size="sm" variant="ink" label="Approve" onClick={() => decide(n.crew, n.id, true)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="block">
        <header className="block__head">
          <h2>What the crew did for you</h2>
          <span className="eyebrow">Today</span>
        </header>
        {did.length === 0 ? (
          <Empty>Nothing yet today. Click anyone on your screen and ask for a hand.</Empty>
        ) : (
          <div className="did">
            {did.map((c, i) => {
              const x = world.crew[c.id];
              return (
                <button key={c.id} type="button" className="did__cell grid-cell rise" style={{ "--c": c.color, "--tint": c.tint, "--i": i } as CSSProperties} onClick={() => onOpenCrew(c.id)}>
                  <span className="did__n pixel num">{x.jobs}</span>
                  <span className="did__unit">
                    {x.jobs === 1 ? "job done" : "jobs done"}
                    {x.steps ? ` · ${x.steps} ${x.steps === 1 ? "step" : "steps"}` : ""}
                  </span>
                  <span className="did__who">
                    <CrewFace id={c.id} color={c.color} size={18} />
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="block">
        <header className="block__head">
          <h2>Running now</h2>
        </header>
        {running.length === 0 ? (
          <Empty>Nobody is working right now.</Empty>
        ) : (
          <ul className="rows">
            {running.map((c) => {
              const x = world.crew[c.id];
              const helpers = x.subs.length ? ` · ${x.subs.filter((s) => s.status !== "running").length}/${x.subs.length} helpers` : "";
              return (
                <li key={c.id} className="row" style={{ "--c": c.color } as CSSProperties}>
                  <CrewFace id={c.id} color={c.color} size={24} />
                  <span className="row__t">{lastAsk(x.msgs) || `${c.name} is on it`}</span>
                  <Status tone={x.state === "needs-you" ? "waiting" : "live"}>{`${STATE_LABEL[x.state] ?? "Working"}${helpers}`}</Status>
                  <IconButton label="Open" onClick={() => onOpenCrew(c.id)}>
                    <ChevronRight />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

const ICONS: Record<string, typeof Globe> = {
  filesystem: FolderOpen,
  notion: NotebookText,
  slack: MessageSquare,
  todoist: ListChecks,
  hubspot: ChartNoAxesCombined,
  airtable: Sheet,
  stripe: CreditCard,
  exa: Search,
  fetch: Globe,
};

const demo = (id: string, name: string, who: CrewId[], on: boolean): Connector => ({ id, name, description: "", category: "", who, on });

const DEMO_CONNECTORS: Connector[] = [
  demo("filesystem", "Filesystem", ["tuck"], true),
  demo("notion", "Notion", ["zip"], false),
  demo("slack", "Slack", ["bo", "zip"], false),
  demo("todoist", "Todoist", ["bo"], false),
  demo("hubspot", "HubSpot", ["zip"], false),
  demo("airtable", "Airtable", ["penny"], false),
  demo("stripe", "Stripe", ["penny"], false),
  demo("exa", "Exa", ["zip", "penny"], true),
  demo("fetch", "Fetch", ["zip"], true),
];

const connectorsOf = (world: World) => (bridge ? world.connectors : DEMO_CONNECTORS);

function CrewPlace({ onOpenCrew, world }: { onOpenCrew: (id: CrewId) => void; world: World }) {
  const [sel, setSel] = useState<CrewId>("pim");
  const c = crewById(sel);
  const brain = world.brains[sel] ?? null;
  const uses = connectorsOf(world).filter((x) => x.who.includes(sel));
  return (
    <div className="crewp" style={{ "--c": c.color, "--tint": c.tint } as CSSProperties}>
      <div className="shelf">
        <ToyStage
          toys={CREW.map((x, i) => ({ key: x.id, id: x.id, hex: x.hex, x: 70 + i * 118, y: 190, size: 56, state: x.id === sel ? "hover" : "idle" }))}
          onToyClick={(k) => setSel(k as CrewId)}
        />
        <div className="shelf__plank" />
        <div className="shelf__names">
          {CREW.map((x) => (
            <button key={x.id} type="button" className={x.id === sel ? "is-on" : ""} style={{ "--c": x.color } as CSSProperties} onClick={() => setSel(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
      </div>
      <div className="crewp__detail" key={sel}>
        <div className="crewp__intro rise">
          <p className="eyebrow">{c.domain}</p>
          <h1 className="display crewp__name">{c.name}</h1>
          <p className="lede">{c.line}</p>
          <div className="crewp__cta">
            <Button variant="ink" label={`Talk to ${c.name}`} onClick={() => onOpenCrew(sel)} />
          </div>
        </div>
        <section className="field rise" style={{ "--i": 1 } as CSSProperties}>
          <span className="field__label">Brain</span>
          <div className="field__body">
            {world.providers.length === 0 ? (
              <p className="field__hint">No brain yet. Add Ollama or a Gemini key in Settings.</p>
            ) : (
              <>
                <div className="chips">
                  {world.providers.map((p) => (
                    <Chip key={p.key} icon={p.kind === "local" ? <HardDrive /> : <Cloud />} selected={brain?.key === p.key} onClick={() => bridge?.post({ type: "action", name: "brain", id: sel, key: p.key })}>
                      {p.name}
                    </Chip>
                  ))}
                </div>
                <p className="field__hint">{!brain ? "Not set yet." : brain.kind === "local" ? `${brain.name} · runs on this computer, nothing leaves your machine` : `${brain.name} · your own key, billed by the provider`}</p>
              </>
            )}
          </div>
        </section>
        <section className="field rise" style={{ "--i": 2 } as CSSProperties}>
          <span className="field__label">Can</span>
          <div className="field__body chips">
            {c.can.map((x) => (
              <Chip key={x} color={c.color} dot selected>
                {x}
              </Chip>
            ))}
          </div>
        </section>
        <section className="field rise" style={{ "--i": 3 } as CSSProperties}>
          <span className="field__label">Never</span>
          <div className="field__body chips">
            {c.cant.map((x) => (
              <Chip key={x} icon={<Lock />}>
                {x}
              </Chip>
            ))}
          </div>
        </section>
        <section className="field rise" style={{ "--i": 4 } as CSSProperties}>
          <span className="field__label">Uses</span>
          <div className="field__body chips">
            {uses.length === 0 && <p className="field__hint">No apps for {c.name} yet.</p>}
            {uses.map((x) => {
              const Ic = ICONS[x.id] ?? Plug;
              return (
                <Chip key={x.id} icon={<Ic />}>
                  {x.name}
                  {!x.on && <span className="eyebrow">· off</span>}
                </Chip>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Threads({ onOpenCrew, world }: { onOpenCrew: (id: CrewId) => void; world: World }) {
  const [f, setF] = useState<CrewId | "all">("all");
  const all = CREW.filter((c) => world.crew[c.id].msgs.some((m) => m.kind === "user")).sort((a, b) => world.crew[b.id].updated - world.crew[a.id].updated);
  const list = all.filter((c) => f === "all" || c.id === f);
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Threads</h1>
        <div className="chips">
          <Chip selected={f === "all"} onClick={() => setF("all")}>
            All
          </Chip>
          {CREW.map((c) => (
            <Chip key={c.id} color={c.color} dot selected={f === c.id} onClick={() => setF(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      </header>
      {list.length === 0 ? (
        <Empty>{f === "all" ? "No threads yet. Everything you ask the crew lands here, saved on this computer." : `Nothing with ${crewById(f).name} yet.`}</Empty>
      ) : (
        <ul className="rows rows--big">
          {list.map((c, i) => {
            const x = world.crew[c.id];
            const asks = x.msgs.filter((m) => m.kind === "user").length;
            return (
              <li key={c.id} className="row rise" style={{ "--c": c.color, "--i": i } as CSSProperties}>
                <CrewFace id={c.id} color={c.color} size={26} />
                <span className="row__t">{firstAsk(x.msgs).slice(0, 90) || "Untitled"}</span>
                <span className="eyebrow">
                  {c.name} · {asks} {asks === 1 ? "ask" : "asks"}
                </span>
                <span className="eyebrow num row__time">{ago(x.updated)}</span>
                <IconButton label="Open thread" onClick={() => onOpenCrew(c.id)}>
                  <ArrowUpRight />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Connections({ world }: { world: World }) {
  const list = connectorsOf(world);
  const open = () => bridge?.openConnectors();
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Connections</h1>
        <p className="lede">The apps your crew may use. Each one asks before it sends, pays, deletes or posts.</p>
      </header>
      {list.length === 0 ? (
        <Empty>Loading your connections.</Empty>
      ) : (
        <div className="conns">
          {list.map((x, i) => {
            const Ic = ICONS[x.id] ?? Plug;
            return (
              <div key={x.id} className={`conn grid-cell rise ${x.on ? "is-on" : ""}`} style={{ "--i": i } as CSSProperties} title={x.description || undefined}>
                <Ic className="conn__ic" />
                <span className="conn__name">{x.name}</span>
                <span className="conn__who">
                  {x.who.map((w) => {
                    const c = crewById(w);
                    return <CrewFace key={w} id={c.id} color={c.color} size={18} />;
                  })}
                </span>
                {x.on ? <Status tone="done">Connected</Status> : <Button size="sm" label="Connect" disabled={!bridge} onClick={open} />}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="link-btn adv" onClick={open} disabled={!bridge}>
        More apps from the public MCP registry
        <ChevronRight />
      </button>
      <p className="field__hint adv__note">Servers from the public registry are not reviewed. Add them only if you trust the author. They run with the same approval rules.</p>
    </div>
  );
}

function SettingsPlace() {
  const { pref } = useTheme();
  const [theme, setPref] = useState<ThemePref>(pref);
  const [sound, setSoundState] = useState(soundOn() ? "on" : "off");
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Settings</h1>
      </header>
      <section className="set">
        <h2 className="set__h">Brains</h2>
        <BrainSetup />
      </section>
      <section className="set">
        <h2 className="set__h">Look</h2>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(v) => {
            setPref(v);
            setTheme(v);
          }}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </section>
      <section className="set">
        <h2 className="set__h">Sound</h2>
        <Segmented
          label="Sound"
          value={sound}
          onChange={(v) => {
            setSoundState(v);
            setSound(v === "on");
            if (v === "on") cue("done", "pim");
          }}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "Little chirps" },
          ]}
        />
      </section>
      <section className="set">
        <h2 className="set__h">History</h2>
        <div className="set__row">
          <p className="field__hint">Threads are saved on this computer only. Clearing them cannot be undone.</p>
          <Button
            size="sm"
            label="Clear all threads"
            onClick={() => {
              if (!window.confirm("Clear every thread? This cannot be undone.")) return;
              if (bridge) bridge.post({ type: "action", name: "clear", id: "bo" });
              else sim.reset();
            }}
          />
        </div>
      </section>
      <section className="set">
        <h2 className="set__h">Safety</h2>
        <ul className="rows">
          {["Sending email or messages", "Paying or transferring money", "Deleting anything", "Posting in public"].map((t) => (
            <li key={t} className="row">
              <ShieldCheck className="row__ic" />
              <span className="row__t">{t}</span>
              <span className="eyebrow">Always asks you</span>
              <Lock className="row__ic" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Home({ onOpenCrew }: { onOpenCrew: (id: CrewId) => void }) {
  const [place, setPlace] = useState<Place>("today");
  const world = useWorld();
  const needs = pending(world).length;
  useEffect(() => {
    if (!bridge) return;
    const onFocus = () => bridge!.post({ type: "action", name: "refresh", id: "bo" });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return (
    <div className="home">
      <nav className="home__nav" aria-label="Home base">
        <div className="home__brand">
          <Mark />
          <span>Crew</span>
        </div>
        <button type="button" className="home__search">
          <Search />
          <span>Search or ask</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <button type="button" className={`navi ${place === n.id ? "is-on" : ""}`} aria-current={place === n.id ? "page" : undefined} onClick={() => setPlace(n.id)}>
                <n.icon />
                {n.label}
                {n.id === "today" && needs > 0 && <span className="navi__badge num">{needs}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="home__crew">
          <span className="eyebrow">On screen</span>
          <div>
            {world.summoned.length === 0 && <span className="eyebrow">Nobody yet</span>}
            {world.summoned.map(crewById).map((c) => (
              <button key={c.id} type="button" data-tip={c.name} aria-label={c.name} onClick={() => onOpenCrew(c.id)}>
                <CrewFace id={c.id} color={c.color} size={26} />
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="home__main" key={place}>
        {place === "today" && <Today onOpenCrew={onOpenCrew} world={world} />}
        {place === "crew" && <CrewPlace onOpenCrew={onOpenCrew} world={world} />}
        {place === "threads" && <Threads onOpenCrew={onOpenCrew} world={world} />}
        {place === "connections" && <Connections world={world} />}
        {place === "settings" && <SettingsPlace />}
      </main>
    </div>
  );
}
