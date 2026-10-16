export type CrewId = "bo" | "pim" | "tuck" | "zip" | "penny";

export type ToyState =
  | "hatching"
  | "idle"
  | "hover"
  | "held"
  | "listening"
  | "thinking"
  | "working"
  | "needs-you"
  | "done"
  | "oops"
  | "sleeping"
  | "returning";

export const TOY_STATES: ToyState[] = [
  "hatching",
  "idle",
  "hover",
  "held",
  "listening",
  "thinking",
  "working",
  "needs-you",
  "done",
  "oops",
  "sleeping",
  "returning",
];

export type Crew = {
  id: CrewId;
  name: string;
  role: string;
  domain: string;
  color: string;
  tint: string;
  hex: number;
  line: string;
  can: string[];
  cant: string[];
  starters: string[];
  model: { kind: "local" | "cloud"; name: string };
  pitch: number;
};

export const CREW: Crew[] = [
  {
    id: "bo",
    name: "Bo",
    role: "Inbox helper",
    domain: "Email and calendar",
    color: "var(--crew-bo)",
    tint: "var(--tint-bo)",
    hex: 0x2f6bff,
    line: "I sort the inbox so you only read what matters.",
    can: ["Read and label mail", "Draft replies", "Find attachments", "Suggest meeting times"],
    cant: ["Send anything without asking", "Delete mail"],
    starters: ["What needs a reply today?", "Draft a polite no to the Friday call", "Find the invoice Priya sent"],
    model: { kind: "cloud", name: "Gemini 3 Flash" },
    pitch: 1,
  },
  {
    id: "pim",
    name: "Pim",
    role: "Writer",
    domain: "Words",
    color: "var(--crew-pim)",
    tint: "var(--tint-pim)",
    hex: 0xff8fc7,
    line: "Hand me any text. I make it clearer, shorter or kinder.",
    can: ["Rewrite and shorten", "Change tone", "Translate", "Summarise long docs"],
    cant: ["Use the internet", "Touch your files"],
    starters: ["Make this sound less stiff", "Summarise this in 3 bullets", "Turn my notes into an email"],
    model: { kind: "local", name: "Llama 4 8B" },
    pitch: 1.25,
  },
  {
    id: "tuck",
    name: "Tuck",
    role: "Organiser",
    domain: "Files and folders",
    color: "var(--crew-tuck)",
    tint: "var(--tint-tuck)",
    hex: 0x35c46f,
    line: "I tidy Downloads and Documents. Everything can be undone.",
    can: ["Rename and sort files", "Find duplicates", "Make folders", "Undo for 7 days"],
    cant: ["Leave Downloads and Documents", "Delete for good"],
    starters: ["Tidy my Downloads", "Rename these receipts by date", "Find big files I forgot"],
    model: { kind: "local", name: "Qwen 3 14B" },
    pitch: 0.8,
  },
  {
    id: "zip",
    name: "Zip",
    role: "Marketing",
    domain: "Campaigns and GTM",
    color: "var(--crew-zip)",
    tint: "var(--tint-zip)",
    hex: 0xff5a36,
    line: "Launches, posts and campaigns. Loud ideas, careful drafts.",
    can: ["Draft posts for X and LinkedIn", "Plan a content week", "Snapshot competitors", "Build lead lists"],
    cant: ["Post publicly without asking", "Spend money"],
    starters: ["3 LinkedIn posts for our launch", "Plan next week's content", "What are competitors shipping?"],
    model: { kind: "cloud", name: "Gemini 3 Pro" },
    pitch: 1.5,
  },
  {
    id: "penny",
    name: "Penny",
    role: "Finance",
    domain: "Money in, money out",
    color: "var(--crew-penny)",
    tint: "var(--tint-penny)",
    hex: 0xffc928,
    line: "Receipts, invoices and budgets, counted twice.",
    can: ["Read receipts and statements", "Categorise expenses", "Draft invoices", "Budget vs actual"],
    cant: ["Pay or transfer anything", "Share numbers outside the app"],
    starters: ["Categorise last month's expenses", "Draft an invoice for Acme", "Are we over budget?"],
    model: { kind: "local", name: "Qwen 3 14B" },
    pitch: 1.1,
  },
];

export const crewById = (id: CrewId) => CREW.find((c) => c.id === id)!;
