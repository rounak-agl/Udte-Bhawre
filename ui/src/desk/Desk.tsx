import { useRef, useState, type CSSProperties, type DragEvent } from "react";
import { ArrowUp, Cloud, HardDrive, Maximize2, Mic, Minimize2, PanelRight, Paperclip, Pin, ScanLine, Search, Square, X } from "lucide-react";
import { CellLoader, Chip, IconButton, Status, type StatusTone } from "../components/ui";
import { CREW, crewById, type CrewId, type ToyState } from "../crew/roster";
import { CrewFace } from "../crew/CrewFace";
import type { Brain, CrewLive } from "../sim/store";
import type { Msg } from "../sim/types";
import type { Attachment } from "../sim/types";
import { useWorld } from "../sim/store";
import { Thread } from "./Thread";
import "./desk.css";

export type DeskMode = "popover" | "panel" | "focus";

const STATE_LINE: Partial<Record<ToyState, [StatusTone, string]>> = {
  listening: ["live", "Listening"],
  thinking: ["waiting", "Thinking"],
  working: ["live", "Working"],
  "needs-you": ["attention", "Needs your OK"],
  done: ["done", "Done"],
  oops: ["failed", "Couldn't finish"],
  sleeping: ["waiting", "Asleep"],
};

type Props = {
  crewId: CrewId;
  live: CrewLive;
  mode: DeskMode;
  pinned?: boolean;
  onMode: (m: DeskMode) => void;
  onClose: () => void;
  onSend: (text: string, files?: Attachment[]) => void;
  onStop?: () => void;
  brain?: Brain | null;
  brains?: Brain[];
  onBrain?: (key: string) => void;
  onDecide: (planId: string, ok: boolean) => void;
  onPickCrew?: (id: CrewId) => void;
  onPin?: () => void;
  onRetry?: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
  native?: boolean;
};

const TEXT_EXT = /\.(txt|md|csv|tsv|json|html?|xml|ya?ml|log|js|ts|py|ini|eml)$/i;

export function readAttachment(f: File): Promise<Attachment> {
  const base = { name: f.name, size: fmtSize(f.size) };
  return new Promise((resolve) => {
    const r = new FileReader();
    if (/^image\/(png|jpeg|webp|gif)$/.test(f.type) && f.size < 8e6) {
      r.onload = () => resolve({ ...base, image: { mimeType: f.type, data: String(r.result).split(",")[1] ?? "" } });
      r.onerror = () => resolve(base);
      r.readAsDataURL(f);
    } else if ((f.type.startsWith("text/") || TEXT_EXT.test(f.name)) && f.size < 200e3) {
      r.onload = () => resolve({ ...base, text: String(r.result) });
      r.onerror = () => resolve(base);
      r.readAsText(f);
    } else resolve(base);
  });
}

function fmtSize(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function Desk({ crewId, live, mode, pinned, onMode, onClose, onSend, onDecide, onPickCrew, onPin, onRetry, onDragStart, native, onStop, brain, brains, onBrain }: Props) {
  const crew = crewById(crewId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const model = brain ?? { key: "", name: crew.model.name, kind: crew.model.kind };

  const addFiles = async (list: File[]) => {
    const read = await Promise.all(list.slice(0, 4).map(readAttachment));
    setFiles((x) => [...x, ...read].slice(0, 4));
  };
  const line = STATE_LINE[live.state];
  const empty = live.msgs.length === 0;

  const submit = (t = text) => {
    if (!t.trim() && files.length === 0) return;
    onSend(t, files.length ? files : undefined);
    setText("");
    setFiles([]);
    if (ta.current) ta.current.style.height = "";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const list = [...e.dataTransfer.files];
    const txt = e.dataTransfer.getData("text/plain");
    if (list.length) void addFiles(list);
    else if (txt) setText((v) => (v ? `${v}\n${txt}` : txt));
  };

  const style = { "--c": crew.color, "--tint": crew.tint } as CSSProperties;

  const main = (
    <div className="desk__main">
      <header className={`desk__head ${native ? "is-native" : ""}`} onPointerDown={native ? undefined : onDragStart}>
        <span className="desk__id">
          <CrewFace id={crew.id} color={crew.color} size={30} mood={live.state === "done" ? "happy" : live.state === "sleeping" ? "sleep" : "idle"} />
          <span className="desk__names">
            <span className="desk__name">{crew.name}</span>
            {line ? (
              <Status tone={line[0]}>{line[1]}</Status>
            ) : (
              <span className="eyebrow">{crew.role}</span>
            )}
          </span>
        </span>
        <span className="desk__tools" onPointerDown={(e) => e.stopPropagation()}>
          {mode === "popover" && onPin && (
            <IconButton label={pinned ? "Unpin" : "Keep on top"} tipPos="bottom" active={pinned} onClick={onPin}>
              <Pin />
            </IconButton>
          )}
          {mode !== "panel" && (
            <IconButton label="Dock to side" tipPos="bottom" onClick={() => onMode("panel")}>
              <PanelRight />
            </IconButton>
          )}
          {mode !== "focus" ? (
            <IconButton label="Expand" tipPos="bottom" onClick={() => onMode("focus")}>
              <Maximize2 />
            </IconButton>
          ) : (
            <IconButton label="Shrink" tipPos="bottom" onClick={() => onMode("popover")}>
              <Minimize2 />
            </IconButton>
          )}
          <IconButton label="Close" tipPos="bottom" onClick={onClose}>
            <X />
          </IconButton>
        </span>
      </header>

      <div className="desk__scroll" onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {empty ? (
          <div className="hello">
            <p className="hello__eyebrow eyebrow">{crew.domain}</p>
            <h2 className="hello__title display">
              Hi, I'm {crew.name}.<br />
              <span>{crew.line}</span>
            </h2>
            <div className="hello__scope">
              <div>
                <span className="eyebrow">I can</span>
                <ul>
                  {crew.can.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="eyebrow">I won't</span>
                <ul className="is-cant">
                  {crew.cant.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <Thread msgs={live.msgs} crew={crew} onDecide={onDecide} onRetry={onRetry} />
        )}
        {over && (
          <div className="drop">
            <CrewFace id={crew.id} color={crew.color} size={44} mood="happy" />
            <span>Drop it, {crew.name} will take it from here</span>
          </div>
        )}
      </div>

      <footer className="desk__foot">
        {empty && (
          <div className="starters">
            {crew.starters.map((s, i) => (
              <button key={s} type="button" className="starter rise" style={{ "--i": i } as CSSProperties} onClick={() => onSend(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {live.busy && !live.waiting && (
          <div className="busy-line">
            <CellLoader size={3} color={crew.color} />
            <span>{live.queued.length ? `${live.queued.length} queued. ${crew.name} gets to it next.` : `${crew.name} is on it. You can keep typing.`}</span>
            <button type="button" className="link-btn" onClick={onStop}>
              <Square />
              Stop
            </button>
          </div>
        )}
        <div className={`composer ${text || files.length ? "has-text" : ""}`}>
          {files.length > 0 && (
            <div className="composer__files">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="file-chip">
                  <Paperclip />
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                    <X />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={`Ask ${crew.name}, or drop a file`}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "";
              e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer__row">
            <IconButton label="Attach a file" onClick={() => picker.current?.click()}>
              <Paperclip />
            </IconButton>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <IconButton label="Capture screen">
              <ScanLine />
            </IconButton>
            <IconButton label="Hold to talk">
              <Mic />
            </IconButton>
            <span className="grow" />
            <span className="model-wrap">
              <button type="button" className={`model model--${model.kind}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} disabled={!brains?.length}>
                {model.kind === "local" ? <HardDrive /> : <Cloud />}
                {model.kind === "local" ? `${model.name} · on this computer` : model.name}
              </button>
              {menu && brains && (
                <span className="menu" role="menu">
                  {(["local", "cloud"] as const).map((k) => {
                    const group = brains.filter((b) => b.kind === k);
                    if (!group.length) return null;
                    return (
                      <span key={k} className="menu__group">
                        <span className="menu__label eyebrow">{k === "local" ? "On this computer" : "Cloud"}</span>
                        {group.map((b) => (
                          <button
                            key={b.key}
                            type="button"
                            role="menuitemradio"
                            aria-checked={b.key === model.key}
                            className="menu__item"
                            onClick={() => {
                              onBrain?.(b.key);
                              setMenu(false);
                            }}
                          >
                            {k === "local" ? <HardDrive /> : <Cloud />}
                            {b.name}
                          </button>
                        ))}
                      </span>
                    );
                  })}
                </span>
              )}
            </span>
            <button type="button" className="send" aria-label="Send" disabled={!text.trim() && !files.length} onClick={() => submit()}>
              <ArrowUp />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );

  if (mode !== "focus") {
    return (
      <div className={`desk desk--${mode} ${native ? "is-native" : ""}`} style={style}>
        {main}
      </div>
    );
  }

  return (
    <div className={`desk desk--focus ${native ? "is-native" : ""}`} style={style}>
      <nav className="rail" aria-label="Crew">
        {CREW.map((c) => (
          <button key={c.id} type="button" className={`rail__btn ${c.id === crewId ? "is-on" : ""}`} style={{ "--c": c.color } as CSSProperties} aria-label={c.name} data-tip={c.name} onClick={() => onPickCrew?.(c.id)}>
            <CrewFace id={c.id} color={c.color} size={30} />
          </button>
        ))}
      </nav>
      <ThreadList crewId={crewId} onPickCrew={onPickCrew} />
      {main}
    </div>
  );
}

function firstAsk(msgs: Msg[]) {
  const u = msgs.find((m) => m.kind === "user");
  return u && u.kind === "user" ? u.text : "";
}

function stamp(t: number) {
  if (!t) return "";
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function ThreadList({ crewId, onPickCrew }: { crewId: CrewId; onPickCrew?: (id: CrewId) => void }) {
  const world = useWorld();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const crew = crewById(crewId);
  const needle = q.trim().toLowerCase();
  const list = CREW.filter((c) => {
    const msgs = world.crew[c.id].msgs;
    if (!msgs.some((m) => m.kind === "user")) return false;
    if (mine && c.id !== crewId) return false;
    if (!needle) return true;
    return msgs.some((m) => (m.kind === "user" || m.kind === "text") && m.text.toLowerCase().includes(needle));
  }).sort((x, y) => world.crew[y.id].updated - world.crew[x.id].updated);
  return (
    <aside className="threads">
      <div className="threads__search">
        <Search />
        <input placeholder="Search threads" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="threads__filters">
        <Chip selected={!mine} onClick={() => setMine(false)}>
          All
        </Chip>
        <Chip color={crew.color} dot selected={mine} onClick={() => setMine(true)}>
          {crew.name}
        </Chip>
      </div>
      {list.length === 0 ? (
        <p className="threads__empty eyebrow">{needle ? "No thread mentions that." : "No threads yet."}</p>
      ) : (
        <ul className="threads__list">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className={`thr ${c.id === crewId ? "is-on" : ""}`} onClick={() => onPickCrew?.(c.id)}>
                <CrewFace id={c.id} color={c.color} size={22} />
                <span className="thr__title">{firstAsk(world.crew[c.id].msgs) || c.name}</span>
                <span className="thr__time eyebrow">{stamp(world.crew[c.id].updated)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
