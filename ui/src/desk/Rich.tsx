import { Fragment, type ReactNode } from "react";
import type { CardSpec } from "../sim/types";
import { Card } from "./cards";

const KNOWN = new Set(["draft", "checklist", "files", "posts", "calendar", "kpi", "expenses"]);
const ARRAYS: Record<string, string> = { checklist: "items", files: "moves", posts: "variants", calendar: "days", kpi: "tiles", expenses: "rows" };

export function toCard(json: string): CardSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { card, type, ...rest } = raw as Record<string, unknown>;
  const kind = String(card ?? type ?? "");
  if (!KNOWN.has(kind)) return null;
  const list = ARRAYS[kind];
  if (list && !Array.isArray(rest[list])) return null;
  if (kind === "draft" && typeof rest.after !== "string") return null;
  if (kind === "expenses" && !Array.isArray(rest.categories)) rest.categories = [];
  if (kind === "files" && typeof rest.undoDays !== "number") rest.undoDays = 7;
  if (typeof rest.title !== "string") rest.title = "";
  return { type: kind, ...rest } as CardSpec;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}b${i}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${key}c${i}`}>{t.slice(1, -1)}</code>);
    else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t);
      if (mm) out.push(<a key={`${key}a${i}`} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
    }
    last = m.index + t.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function blocks(text: string, key: string): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(<p key={`${key}p${out.length}`}>{inline(para.join(" "), `${key}p${out.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{inline(it, `${key}l${out.length}${j}`)}</li>);
    out.push(list.ordered ? <ol key={`${key}o${out.length}`}>{items}</ol> : <ul key={`${key}u${out.length}`}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (head) {
      flushPara();
      flushList();
      out.push(<h5 key={`${key}h${out.length}`}>{inline(head[1], `${key}h${out.length}`)}</h5>);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out;
}

export function Rich({ text, streaming }: { text: string; streaming?: boolean }) {
  const parts: ReactNode[] = [];
  const re = /```(\w*)\n?([\s\S]*?)(```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={`t${n}`}>{blocks(text.slice(last, m.index), `t${n}`)}</Fragment>);
    const closed = m[3] === "```";
    if (m[1] === "ui") {
      const card = closed ? toCard(m[2]) : null;
      if (card) parts.push(<Card key={`c${n}`} card={card} />);
      else if (!closed) parts.push(<div key={`s${n}`} className="card-skel" aria-label="Building a card" />);
      else parts.push(<pre key={`x${n}`} className="code">{m[2]}</pre>);
    } else {
      parts.push(
        <pre key={`x${n}`} className="code">
          {m[2]}
        </pre>,
      );
    }
    last = m.index + m[0].length;
    n++;
    if (!closed) break;
  }
  if (last < text.length) parts.push(<Fragment key="end">{blocks(text.slice(last), "end")}</Fragment>);
  return (
    <div className="rich">
      {parts}
      {streaming && <span className="caret" aria-hidden />}
    </div>
  );
}
