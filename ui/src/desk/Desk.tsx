import { useRef, useState, type CSSProperties, type DragEvent } from "react";
import { ArrowUp, Cloud, HardDrive, Maximize2, Mic, Minimize2, PanelRight, Paperclip, Pin, ScanLine, Search, Square, X } from "lucide-react";
import { CellLoader, Chip, IconButton, Kbd, Status, type StatusTone } from "../components/ui";
import { CREW, crewById, type CrewId, type ToyState } from "../crew/roster";
import { CrewFace } from "../crew/CrewFace";
import type { CrewLive } from "../sim/store";
import { SEED_THREADS } from "../sim/scripts";
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
  onSend: (text: string, files?: { name: string; size: string }[]) => void;
  onDecide: (planId: string, ok: boolean) => void;
  onPickCrew?: (id: CrewId) => void;
  onPin?: () => void;
  onRetry?: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
};

function fmtSize(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function Desk({ crewId, live, mode, pinned, onMode, onClose, onSend, onDecide, onPickCrew, onPin, onRetry, onDragStart }: Props) {
  const crew = crewById(crewId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ name: string; size: string }[]>([]);
  const [over, setOver] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
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
    const fs = [...e.dataTransfer.files].map((f) => ({ name: f.name, size: fmtSize(f.size) }));
    const txt = e.dataTransfer.getData("text/plain");
    if (fs.length) setFiles((x) => [...x, ...fs].slice(0, 4));
    else if (txt) setText((v) => (v ? `${v}\n${txt}` : txt));
  };

  const style = { "--c": crew.color, "--tint": crew.tint } as CSSProperties;

  const main = (
    <div className="desk__main">
      <header className="desk__head" onPointerDown={onDragStart}>
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
              <button key={s} type="button" className="starter rise" style={{ "--i": i } as CSSProperties} onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {live.busy && !live.waiting && (
          <div className="busy-line">
            <CellLoader size={3} color={crew.color} />
            <span>{live.queued.length ? `${live.queued.length} queued. ${crew.name} gets to it next.` : `${crew.name} is on it. You can keep typing.`}</span>
            <button type="button" className="link-btn">
              <Square />
              Stop
            </button>
          </div>
        )}
        <div className={`composer ${text || files.length ? "has-text" : ""}`}>
          {files.length > 0 && (
            <div className="composer__files">
              {files.map((f) => (
                <span key={f.name} className="file-chip">
                  <Paperclip />
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y !== f))}>
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer__row">
            <IconButton label="Attach a file">
              <Paperclip />
            </IconButton>
            <IconButton label="Capture screen">
              <ScanLine />
            </IconButton>
            <IconButton label="Hold to talk">
              <Mic />
            </IconButton>
            <span className="grow" />
            <span className={`model model--${crew.model.kind}`} data-tip={crew.model.kind === "local" ? "Runs fully on this computer" : "Uses your own key"}>
              {crew.model.kind === "local" ? <HardDrive /> : <Cloud />}
              {crew.model.kind === "local" ? "On this computer" : crew.model.name}
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
      <div className={`desk desk--${mode}`} style={style}>
        {main}
      </div>
    );
  }

  return (
    <div className="desk desk--focus" style={style}>
      <nav className="rail" aria-label="Crew">
        {CREW.map((c) => (
          <button key={c.id} type="button" className={`rail__btn ${c.id === crewId ? "is-on" : ""}`} style={{ "--c": c.color } as CSSProperties} aria-label={c.name} data-tip={c.name} onClick={() => onPickCrew?.(c.id)}>
            <CrewFace id={c.id} color={c.color} size={30} />
          </button>
        ))}
      </nav>
      <aside className="threads">
        <div className="threads__search">
          <Search />
          <input placeholder="Search threads" />
          <Kbd>Ctrl K</Kbd>
        </div>
        <div className="threads__filters">
          <Chip selected>All</Chip>
          <Chip color={crew.color} dot>
            {crew.name}
          </Chip>
        </div>
        <ul className="threads__list">
          {SEED_THREADS.map((t, i) => {
            const c = crewById(t.crew);
            return (
              <li key={t.id}>
                <button type="button" className={`thr ${i === 0 && t.crew === crewId ? "is-on" : ""}`} onClick={() => onPickCrew?.(t.crew)}>
                  <CrewFace id={c.id} color={c.color} size={22} />
                  <span className="thr__title">{t.title}</span>
                  <span className="thr__time eyebrow">{t.updated}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      {main}
    </div>
  );
}
