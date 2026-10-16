import type { CrewId, ToyState } from "../crew/roster";

export type Risk = "read" | "write" | "send" | "delete" | "pay" | "post";

export type ToolItem = { id: string; verb: string; target: string; ms?: number; status: "running" | "done" | "failed"; detail?: string };

export type DraftCard = { type: "draft"; channel: "email" | "doc"; to?: string; subject?: string; before?: string; after: string };
export type CompareCard = { type: "compare"; title: string; columns: { name: string; pick?: boolean; rows: string[] }[]; rowLabels: string[] };
export type KpiCard = { type: "kpi"; title: string; tiles: { label: string; value: string; delta?: number; spark?: number[] }[] };
export type ExpenseCard = {
  type: "expenses";
  title: string;
  rows: { date: string; merchant: string; amount: number; category: string; confidence: "high" | "low" }[];
  categories: { name: string; color: string }[];
};
export type PostsCard = { type: "posts"; title: string; variants: { channel: "linkedin" | "x"; hook: string; body: string; chars: number }[] };
export type FilesCard = { type: "files"; title: string; moves: { from: string; to: string; kind: "pdf" | "img" | "doc" | "zip" | "sheet" }[]; undoDays: number };
export type ChecklistCard = { type: "checklist"; title: string; items: { text: string; done: boolean; who?: string }[] };
export type CalendarCard = { type: "calendar"; title: string; days: { day: string; posts: { time: string; channel: string; title: string }[] }[] };

export type CardSpec = DraftCard | CompareCard | KpiCard | ExpenseCard | PostsCard | FilesCard | ChecklistCard | CalendarCard;

export type Msg =
  | { kind: "user"; id: string; text: string; files?: { name: string; size: string }[] }
  | { kind: "text"; id: string; text: string; streaming?: boolean }
  | { kind: "tools"; id: string; items: ToolItem[] }
  | { kind: "plan"; id: string; summary: string; steps: { text: string; risk: Risk }[]; status: "pending" | "approved" | "denied" }
  | { kind: "card"; id: string; card: CardSpec }
  | { kind: "error"; id: string; title: string; body: string };

export type Thread = { id: string; crew: CrewId; title: string; updated: string; msgs: Msg[] };

export type Step =
  | { wait: number; state?: ToyState }
  | { say: string }
  | { stream: string }
  | { tool: Omit<ToolItem, "status" | "id">; fail?: boolean }
  | { plan: { summary: string; steps: { text: string; risk: Risk }[] } }
  | { card: CardSpec }
  | { error: { title: string; body: string } }
  | { state: ToyState }
  | { peek: string };

export type Script = { crew: CrewId; prompt: string; files?: { name: string; size: string }[]; steps: Step[] };
