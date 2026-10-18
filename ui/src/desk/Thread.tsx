import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Paperclip, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, CellLoader } from "../components/ui";
import type { Crew } from "../crew/roster";
import type { Msg, Risk } from "../sim/types";
import { Card } from "./cards";
import { Rich } from "./Rich";

const RISK: Record<Risk, { label: string; strong: boolean }> = {
  read: { label: "Reads", strong: false },
  write: { label: "Changes", strong: false },
  send: { label: "Sends", strong: true },
  delete: { label: "Removes", strong: true },
  pay: { label: "Pays", strong: true },
  post: { label: "Posts", strong: true },
};

function Plan({ m, crew, onDecide }: { m: Extract<Msg, { kind: "plan" }>; crew: Crew; onDecide: (id: string, ok: boolean) => void }) {
  const [armed, setArmed] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 600);
    return () => clearTimeout(t);
  }, []);
  if (m.status !== "pending") {
    return (
      <div className={`plan-done ${m.status}`}>
        <ShieldCheck />
        <span>{m.status === "approved" ? "You approved this plan" : "You stopped this plan"}</span>
        {m.steps.length > 0 && <span className="eyebrow">{m.steps.length} steps</span>}
      </div>
    );
  }
  return (
    <section className="plan" aria-live="polite">
      <span className="plan__eyebrow">
        <span className="status status--attention">
          <span className="status__mark" />
        </span>
        {crew.name} needs your OK
      </span>
      <p className="plan__summary">{m.summary}</p>
      {m.steps.length > 0 && (
      <ol className="plan__steps">
        {m.steps.map((s, i) => (
          <li key={i}>
            <span className="plan__n pixel">{i + 1}</span>
            <span className="plan__t">{s.text}</span>
            <span className={`risk ${RISK[s.risk].strong ? "is-strong" : ""}`}>{RISK[s.risk].label}</span>
          </li>
        ))}
      </ol>
      )}
      {details && (
        <dl className="plan__details">
          <dt className="eyebrow">Plan ID</dt>
          <dd className="eyebrow">{m.id}</dd>
          <dt className="eyebrow">Signed</dt>
          <dd className="eyebrow">ArmorIQ, valid 10 min</dd>
          <dt className="eyebrow">Scope</dt>
          <dd className="eyebrow">Only the steps above</dd>
        </dl>
      )}
      <div className="plan__actions">
        <Button variant="ink" label="Approve" disabled={!armed} onClick={() => onDecide(m.id, true)} />
        <Button label="Stop" onClick={() => onDecide(m.id, false)} />
        <span className="grow" />
        <button type="button" className="link-btn" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
          Details
          <ChevronDown className={details ? "is-open" : ""} />
        </button>
      </div>
    </section>
  );
}

function Tools({ m }: { m: Extract<Msg, { kind: "tools" }> }) {
  const [open, setOpen] = useState(true);
  const running = m.items.some((i) => i.status === "running");
  return (
    <section className="tools">
      <button type="button" className="tools__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {running ? <CellLoader size={3} /> : <span className="tools__tick" />}
        <span>{running ? "Working" : `${m.items.length} ${m.items.length === 1 ? "step" : "steps"}`}</span>
        <ChevronDown className={open ? "is-open" : ""} />
      </button>
      {open && (
        <ul className="tools__list">
          {m.items.map((t, i) => (
            <li key={t.id} className={`tool is-${t.status} rise`} style={{ "--i": i } as CSSProperties}>
              <span className={`status status--${t.status === "running" ? "live" : t.status}`}>
                <span className="status__mark" />
              </span>
              <span className="tool__verb">{t.verb}</span>
              <span className="tool__target">{t.target}</span>
              <span className="tool__ms eyebrow num">{t.status === "running" ? "" : t.status === "failed" ? "failed" : `${((t.ms ?? 500) / 1000).toFixed(1)}s`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function scroller(el: HTMLElement | null) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

export function Thread({ msgs, crew, onDecide, onRetry }: { msgs: Msg[]; crew: Crew; onDecide: (id: string, ok: boolean) => void; onRetry?: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = useRef(0);
  const last = msgs[msgs.length - 1];
  const sig = last ? `${msgs.length}:${last.kind === "text" ? last.text.length : last.kind === "tools" ? last.items.map((t) => t.status).join() : last.kind === "plan" ? last.status : ""}` : "";
  useEffect(() => {
    const box = scroller(end.current);
    if (!box) return;
    const onScroll = () => {
      pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      if (pinned.current) box.scrollTop = box.scrollHeight;
    });
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    ro.observe(box);
    return () => {
      box.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);
  useEffect(() => {
    const grew = msgs.length !== count.current;
    count.current = msgs.length;
    if (!pinned.current && last?.kind !== "user") return;
    end.current?.scrollIntoView({ block: "end", behavior: grew ? "smooth" : "auto" });
  }, [sig]);
  return (
    <div className="thread">
      {msgs.map((m, i) => {
        const prev = msgs[i - 1];
        const firstOfTurn = m.kind !== "user" && (!prev || prev.kind === "user");
        return (
          <div key={m.id} className={`msg msg--${m.kind} rise`}>
            {firstOfTurn && <span className="msg__who eyebrow">{crew.name}</span>}
            {m.kind === "user" && (
              <div className="msg__user">
                {m.files?.map((f) => (
                  <span key={f.name} className="file-chip">
                    <Paperclip />
                    {f.name}
                    <span className="eyebrow">{f.size}</span>
                  </span>
                ))}
                <p>{m.text}</p>
              </div>
            )}
            {m.kind === "text" && <Rich text={m.text} streaming={m.streaming} />}
            {m.kind === "tools" && <Tools m={m} />}
            {m.kind === "plan" && <Plan m={m} crew={crew} onDecide={onDecide} />}
            {m.kind === "card" && <Card card={m.card} />}
            {m.kind === "error" && (
              <section className="oops-card" role="alert">
                <p className="oops-card__title">{m.title}</p>
                <p className="oops-card__body">{m.body}</p>
                {onRetry && i === msgs.length - 1 && !m.title.startsWith("Blocked") && (
                  <div className="plan__actions">
                    <Button variant="ink" size="sm" icon={<RefreshCw />} label="Try again" onClick={onRetry} />
                  </div>
                )}
              </section>
            )}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
