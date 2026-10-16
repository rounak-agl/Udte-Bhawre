import { useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Calendar,
  ChartNoAxesCombined,
  ChevronRight,
  Cloud,
  Globe,
  HardDrive,
  House,
  Lock,
  Mail,
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
import { SEED_THREADS } from "../sim/scripts";
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

const NEEDS = [
  { crew: "bo" as CrewId, text: "Send the revised quote to Priya at Acme", risk: "Sends 1 email", age: "4 min" },
  { crew: "tuck" as CrewId, text: "Park 38 duplicate files in Quarantine", risk: "Undo for 7 days", age: "22 min" },
];

const DID = [
  { crew: "bo" as CrewId, n: "41", unit: "emails sorted" },
  { crew: "tuck" as CrewId, n: "52", unit: "files tidied" },
  { crew: "pim" as CrewId, n: "1.2k", unit: "words rewritten" },
  { crew: "penny" as CrewId, n: "86", unit: "expenses read" },
];

const RUNNING = [
  { crew: "zip" as CrewId, text: "Researching competitor launches", step: "3 of 5" },
  { crew: "penny" as CrewId, text: "Matching receipts for October", step: "1 of 2" },
];

function Today({ onOpenCrew }: { onOpenCrew: (id: CrewId) => void }) {
  return (
    <div className="today">
      <header className="today__hello">
        <p className="eyebrow">Friday, 16 October</p>
        <h1 className="display today__title">Good afternoon, Asha.</h1>
        <p className="lede">
          <b>2 things need you.</b> The crew handled 179 small jobs today, about 1 h 40 min of your time.
        </p>
      </header>

      <section className="block">
        <header className="block__head">
          <h2>Needs you</h2>
          <span className="eyebrow num">{NEEDS.length}</span>
        </header>
        <ul className="needs">
          {NEEDS.map((n, i) => {
            const c = crewById(n.crew);
            return (
              <li key={i} className="need rise" style={{ "--c": c.color, "--i": i } as CSSProperties}>
                <CrewFace id={c.id} color={c.color} size={32} />
                <span className="need__text">
                  <span className="need__t">{n.text}</span>
                  <span className="eyebrow">
                    {c.name} · {n.risk} · {n.age} ago
                  </span>
                </span>
                <Button size="sm" label="Review" onClick={() => onOpenCrew(n.crew)} />
                <Button size="sm" variant="ink" label="Approve" />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="block">
        <header className="block__head">
          <h2>What the crew did for you</h2>
          <span className="eyebrow">Today</span>
        </header>
        <div className="did">
          {DID.map((d, i) => {
            const c = crewById(d.crew);
            return (
              <button key={d.unit} type="button" className="did__cell grid-cell rise" style={{ "--c": c.color, "--tint": c.tint, "--i": i } as CSSProperties} onClick={() => onOpenCrew(d.crew)}>
                <span className="did__n pixel num">{d.n}</span>
                <span className="did__unit">{d.unit}</span>
                <span className="did__who">
                  <CrewFace id={c.id} color={c.color} size={18} />
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="block">
        <header className="block__head">
          <h2>Running now</h2>
        </header>
        <ul className="rows">
          {RUNNING.map((r) => {
            const c = crewById(r.crew);
            return (
              <li key={r.text} className="row" style={{ "--c": c.color } as CSSProperties}>
                <CrewFace id={c.id} color={c.color} size={24} />
                <span className="row__t">{r.text}</span>
                <Status tone="live">{r.step}</Status>
                <IconButton label="Open" onClick={() => onOpenCrew(r.crew)}>
                  <ChevronRight />
                </IconButton>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const CONNECTORS = [
  { name: "Gmail", icon: Mail, on: true, who: ["bo"] },
  { name: "Google Calendar", icon: Calendar, on: true, who: ["bo"] },
  { name: "Google Drive", icon: HardDrive, on: false, who: ["tuck", "pim"] },
  { name: "Google Sheets", icon: Sheet, on: true, who: ["penny"] },
  { name: "Slack", icon: MessageSquare, on: false, who: ["bo", "zip"] },
  { name: "Notion", icon: NotebookText, on: false, who: ["pim", "zip"] },
  { name: "HubSpot", icon: ChartNoAxesCombined, on: false, who: ["zip"] },
  { name: "Web search", icon: Globe, on: true, who: ["zip", "penny"] },
];

function CrewPlace({ onOpenCrew }: { onOpenCrew: (id: CrewId) => void }) {
  const [sel, setSel] = useState<CrewId>("pim");
  const c = crewById(sel);
  const [kind, setKind] = useState<"local" | "cloud">(c.model.kind);
  return (
    <div className="crewp" style={{ "--c": c.color, "--tint": c.tint } as CSSProperties}>
      <div className="shelf">
        <ToyStage
          toys={CREW.map((x, i) => ({ key: x.id, id: x.id, hex: x.hex, x: 70 + i * 118, y: 190, size: 56, state: x.id === sel ? "hover" : "idle" }))}
          onToyClick={(k) => {
            setSel(k as CrewId);
            setKind(crewById(k as CrewId).model.kind);
          }}
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
            <Button label="Rename" />
          </div>
        </div>
        <section className="field rise" style={{ "--i": 1 } as CSSProperties}>
          <span className="field__label">Brain</span>
          <div className="field__body">
            <Segmented
              label="Where it runs"
              value={kind}
              onChange={setKind}
              options={[
                { value: "local", label: "On this computer", icon: <HardDrive /> },
                { value: "cloud", label: "Cloud", icon: <Cloud /> },
              ]}
            />
            <p className="field__hint">{kind === "local" ? "Ollama · Qwen 3 14B · nothing leaves your machine" : "Gemini 3 Flash · your own key · billed by Google"}</p>
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
            {CONNECTORS.filter((x) => x.who.includes(sel)).map((x) => (
              <Chip key={x.name} icon={<x.icon />}>
                {x.name}
                {!x.on && <span className="eyebrow">· off</span>}
              </Chip>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Threads({ onOpenCrew }: { onOpenCrew: (id: CrewId) => void }) {
  const [f, setF] = useState<CrewId | "all">("all");
  const list = SEED_THREADS.filter((t) => f === "all" || t.crew === f);
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
      <ul className="rows rows--big">
        {list.map((t, i) => {
          const c = crewById(t.crew);
          return (
            <li key={t.id} className="row rise" style={{ "--c": c.color, "--i": i } as CSSProperties}>
              <CrewFace id={c.id} color={c.color} size={26} />
              <span className="row__t">{t.title}</span>
              <span className="eyebrow">{c.name}</span>
              <span className="eyebrow num row__time">{t.updated}</span>
              <IconButton label="Open thread" onClick={() => onOpenCrew(t.crew)}>
                <ArrowUpRight />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Connections() {
  const [adv, setAdv] = useState(false);
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Connections</h1>
        <p className="lede">The apps your crew may use. Each one asks before it sends, pays, deletes or posts.</p>
      </header>
      <div className="conns">
        {CONNECTORS.map((x, i) => (
          <div key={x.name} className={`conn grid-cell rise ${x.on ? "is-on" : ""}`} style={{ "--i": i } as CSSProperties}>
            <x.icon className="conn__ic" />
            <span className="conn__name">{x.name}</span>
            <span className="conn__who">
              {x.who.map((w) => {
                const c = crewById(w as CrewId);
                return <CrewFace key={w} id={c.id} color={c.color} size={18} />;
              })}
            </span>
            {x.on ? <Status tone="done">Connected</Status> : <Button size="sm" label="Connect" />}
          </div>
        ))}
      </div>
      <button type="button" className="link-btn adv" aria-expanded={adv} onClick={() => setAdv((a) => !a)}>
        Advanced: public MCP registry
        <ChevronRight className={adv ? "is-open" : ""} />
      </button>
      {adv && <p className="field__hint adv__note">Servers from the public registry are not reviewed. Add them only if you trust the author. They run with the same approval rules.</p>}
    </div>
  );
}

const MODELS = [
  { name: "Qwen 3 14B", size: "9.0 GB", used: ["tuck", "penny"] },
  { name: "Llama 4 8B", size: "4.9 GB", used: ["pim"] },
  { name: "Gemma 3 4B", size: "3.3 GB", used: [] },
];

function SettingsPlace() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Settings</h1>
      </header>
      <section className="set">
        <h2 className="set__h">Brains</h2>
        <div className="local">
          <div className="local__head">
            <HardDrive />
            <span>
              <b>Ollama is running on this computer</b>
              <span className="eyebrow">localhost:11434 · 3 models · nothing leaves your machine</span>
            </span>
            <Status tone="live">Ready</Status>
          </div>
          <ul className="models">
            {MODELS.map((m) => (
              <li key={m.name}>
                <span className="models__name">{m.name}</span>
                <span className="eyebrow num">{m.size}</span>
                <span className="models__who">
                  {m.used.map((w) => {
                    const c = crewById(w as CrewId);
                    return <CrewFace key={w} id={c.id} color={c.color} size={18} />;
                  })}
                  {m.used.length === 0 && <span className="eyebrow">Unused</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="keys">
          {[
            ["Gemini", "Added", true],
            ["Claude", "Not added", false],
            ["OpenAI", "Not added", false],
          ].map(([n, s, ok]) => (
            <div key={n as string} className="key">
              <Cloud />
              <span className="key__n">{n}</span>
              <span className="eyebrow">{s}</span>
              <Button size="sm" label={ok ? "Replace key" : "Add key"} />
            </div>
          ))}
        </div>
      </section>
      <section className="set">
        <h2 className="set__h">Look</h2>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(v) => {
            setTheme(v);
            document.documentElement.dataset.theme = v === "dark" ? "dark" : "light";
          }}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
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
                {n.id === "today" && <span className="navi__badge num">2</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="home__crew">
          <span className="eyebrow">On screen</span>
          <div>
            {CREW.slice(0, 3).map((c) => (
              <button key={c.id} type="button" data-tip={c.name} aria-label={c.name} onClick={() => onOpenCrew(c.id)}>
                <CrewFace id={c.id} color={c.color} size={26} />
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="home__main" key={place}>
        {place === "today" && <Today onOpenCrew={onOpenCrew} />}
        {place === "crew" && <CrewPlace onOpenCrew={onOpenCrew} />}
        {place === "threads" && <Threads onOpenCrew={onOpenCrew} />}
        {place === "connections" && <Connections />}
        {place === "settings" && <SettingsPlace />}
      </main>
    </div>
  );
}
