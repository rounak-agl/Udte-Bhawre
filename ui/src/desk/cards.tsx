import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check, Copy, FileArchive, FileImage, FileSpreadsheet, FileText, Maximize2, RotateCcw, SquarePen, TriangleAlert } from "lucide-react";
import { Button, IconButton } from "../components/ui";
import type { CalendarCard, CardSpec, ChecklistCard, DraftCard, ExpenseCard, FilesCard, KpiCard, PostsCard } from "../sim/types";

const LABEL: Record<CardSpec["type"], string> = {
  draft: "Draft",
  compare: "Compare",
  kpi: "Numbers",
  expenses: "Expenses",
  posts: "Posts",
  files: "File plan",
  checklist: "List",
  calendar: "Week plan",
};

function Frame({ type, title, children, actions, foot }: { type: CardSpec["type"]; title: string; children: ReactNode; actions?: ReactNode; foot?: ReactNode }) {
  return (
    <section className="card">
      <header className="card__head">
        <span className="card__type pixel">{LABEL[type]}</span>
        <h4 className="card__title">{title}</h4>
        <span className="card__actions">
          {actions}
          <IconButton label="Open larger" tipPos="bottom">
            <Maximize2 />
          </IconButton>
        </span>
      </header>
      <div className="card__body">{children}</div>
      {foot && <footer className="card__foot">{foot}</footer>}
    </section>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <IconButton
      label={ok ? "Copied" : "Copy"}
      tipPos="bottom"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1400);
      }}
    >
      {ok ? <Check /> : <Copy />}
    </IconButton>
  );
}

function Draft({ c }: { c: DraftCard }) {
  const [diff, setDiff] = useState(false);
  return (
    <Frame
      type="draft"
      title={c.channel === "email" ? (c.subject ?? "Email") : "Rewrite"}
      actions={<CopyBtn text={c.after} />}
      foot={
        <>
          {c.before && (
            <button type="button" className="link-btn" onClick={() => setDiff((v) => !v)} aria-pressed={diff}>
              {diff ? "Hide changes" : "Show changes"}
            </button>
          )}
          <span className="grow" />
          <Button size="sm" variant="ghost" icon={<SquarePen />} label="Edit" />
          <Button size="sm" label={c.channel === "email" ? "Open in Gmail" : "Replace original"} />
        </>
      }
    >
      {c.channel === "email" && (
        <dl className="draft__meta">
          <dt className="eyebrow">To</dt>
          <dd>{c.to}</dd>
          <dt className="eyebrow">Subject</dt>
          <dd>{c.subject}</dd>
        </dl>
      )}
      {diff && c.before && <p className="draft__before">{c.before}</p>}
      <p className={`draft__after ${diff ? "is-diff" : ""}`}>{c.after}</p>
    </Frame>
  );
}

function Checklist({ c }: { c: ChecklistCard }) {
  const [done, setDone] = useState(c.items.map((i) => i.done));
  const left = done.filter((d) => !d).length;
  return (
    <Frame type="checklist" title={c.title} foot={<span className="eyebrow">{left === 0 ? "All handled" : `${left} left`}</span>}>
      <ul className="check">
        {c.items.map((it, i) => (
          <li key={i} className={done[i] ? "is-done" : ""}>
            <button type="button" className="check__box" role="checkbox" aria-checked={done[i]} onClick={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}>
              <Check />
            </button>
            <span className="check__text">{it.text}</span>
            {it.who && <span className="check__who eyebrow">{it.who}</span>}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

const KIND = { pdf: FileText, img: FileImage, doc: FileText, zip: FileArchive, sheet: FileSpreadsheet };

function Files({ c }: { c: FilesCard }) {
  return (
    <Frame
      type="files"
      title={c.title}
      foot={
        <>
          <RotateCcw className="foot-ic" />
          <span className="eyebrow">Undo anything for {c.undoDays} days</span>
          <span className="grow" />
          <span className="eyebrow">Showing 6 of 52</span>
        </>
      }
    >
      <ul className="moves">
        {c.moves.map((m, i) => {
          const I = KIND[m.kind];
          return (
            <li key={i} className="rise" style={{ "--i": i } as CSSProperties}>
              <I className="moves__ic" />
              <span className="moves__from">{m.from}</span>
              <ArrowRight className="moves__arrow" />
              <span className="moves__to">{m.to}</span>
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

function Posts({ c }: { c: PostsCard }) {
  const [pick, setPick] = useState(1);
  return (
    <Frame type="posts" title={c.title} foot={<span className="eyebrow">Nothing is posted until you say so</span>}>
      <div className="posts">
        {c.variants.map((v, i) => (
          <article key={i} className={`post ${pick === i ? "is-picked" : ""}`}>
            <header className="post__head">
              <span className="post__ch">{v.channel === "x" ? "X" : "LinkedIn"}</span>
              <span className="eyebrow num">{v.chars} chars</span>
            </header>
            <p className="post__hook">{v.hook}</p>
            <p className="post__body">{v.body}</p>
            <Button size="sm" variant={pick === i ? "ink" : "line"} label={pick === i ? "Picked" : "Use this"} onClick={() => setPick(i)} />
          </article>
        ))}
      </div>
    </Frame>
  );
}

const CH: Record<string, string> = { LinkedIn: "var(--crew-bo)", X: "var(--ink)", Email: "var(--crew-penny)" };

function Calendar({ c }: { c: CalendarCard }) {
  return (
    <Frame type="calendar" title={c.title}>
      <div className="cal">
        {c.days.map((d) => (
          <div key={d.day} className="cal__day">
            <span className="cal__label eyebrow">{d.day}</span>
            {d.posts.length === 0 && <span className="cal__rest">Rest</span>}
            {d.posts.map((p, i) => (
              <span key={i} className="cal__post" style={{ "--c": CH[p.channel] ?? "var(--muted)" } as CSSProperties}>
                <span className="eyebrow num">{p.time}</span>
                <span className="cal__t">{p.title}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Spark({ pts }: { pts: number[] }) {
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ c }: { c: KpiCard }) {
  return (
    <Frame type="kpi" title={c.title}>
      <div className="kpi">
        {c.tiles.map((t) => (
          <div key={t.label} className="kpi__tile">
            <span className="eyebrow">{t.label}</span>
            <span className="kpi__value num">{t.value}</span>
            {t.delta !== undefined && <span className={`kpi__delta num ${t.delta > 0 ? "is-over" : "is-under"}`}>{t.delta > 0 ? `+${t.delta}%` : `${t.delta}%`} vs Aug</span>}
            {t.spark && <Spark pts={t.spark} />}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Expenses({ c }: { c: ExpenseCard }) {
  const [rows, setRows] = useState(c.rows);
  const color = (n: string) => c.categories.find((x) => x.name === n)?.color ?? "var(--muted)";
  const cycle = (i: number) =>
    setRows((r) =>
      r.map((x, j) => {
        if (j !== i) return x;
        const k = c.categories.findIndex((cc) => cc.name === x.category);
        return { ...x, category: c.categories[(k + 1) % c.categories.length].name, confidence: "high" };
      }),
    );
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return (
    <Frame type="expenses" title={c.title} foot={<span className="eyebrow">Click a category to change it</span>}>
      <table className="xp">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.confidence === "low" ? "is-low" : ""}>
              <td className="xp__date eyebrow num">{r.date}</td>
              <td className="xp__merchant">
                {r.merchant}
                {r.confidence === "low" && (
                  <span className="xp__flag" title="Penny isn't sure">
                    <TriangleAlert />
                    Check
                  </span>
                )}
              </td>
              <td>
                <button type="button" className="chip" style={{ "--c": color(r.category) } as CSSProperties} data-selected onClick={() => cycle(i)}>
                  <span className="chip__dot" />
                  {r.category}
                </button>
              </td>
              <td className="xp__amt num">{fmt(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

export function Card({ card }: { card: CardSpec }) {
  switch (card.type) {
    case "draft":
      return <Draft c={card} />;
    case "checklist":
      return <Checklist c={card} />;
    case "files":
      return <Files c={card} />;
    case "posts":
      return <Posts c={card} />;
    case "calendar":
      return <Calendar c={card} />;
    case "kpi":
      return <Kpi c={card} />;
    case "expenses":
      return <Expenses c={card} />;
    default:
      return null;
  }
}
