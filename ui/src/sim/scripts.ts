import type { CrewId } from "../crew/roster";
import type { Script } from "./types";

export const SCRIPTS: Record<CrewId, Script> = {
  bo: {
    crew: "bo",
    prompt: "What needs a reply today?",
    steps: [
      { wait: 700, state: "thinking" },
      { state: "working" },
      { tool: { verb: "Read", target: "Inbox, last 24 hours", ms: 900 } },
      { tool: { verb: "Checked", target: "Calendar, this week", ms: 600 } },
      { stream: "Out of 41 new emails, 3 actually need you. The rest are receipts and newsletters, which I labelled." },
      {
        card: {
          type: "checklist",
          title: "Needs a reply",
          items: [
            { text: "Priya at Acme wants the revised quote by Friday", done: false, who: "Priya Shah" },
            { text: "Landlord asks to move Thursday's visit to 4pm", done: false, who: "R. Mehta" },
            { text: "Accountant needs March bank statements", done: false, who: "Kiran & Co" },
          ],
        },
      },
      { stream: "I drafted the reply to Priya. Sending needs your OK." },
      {
        card: {
          type: "draft",
          channel: "email",
          to: "priya@acme.co",
          subject: "Re: Revised quote",
          before: "Hi Priya, we will send it soon.",
          after: "Hi Priya,\n\nThanks for the patience. The revised quote is attached, with the 8% volume discount we discussed. It holds until 30 October.\n\nHappy to walk through it on a call Thursday.\n\nBest,\nAsha",
        },
      },
      { plan: { summary: "I'll send this one email to Priya from your Gmail. Nothing else gets sent.", steps: [{ text: "Attach Quote-Acme-v2.pdf from Downloads", risk: "read" }, { text: "Send the reply to priya@acme.co", risk: "send" }] } },
      { state: "working" },
      { tool: { verb: "Sent", target: "Reply to Priya Shah", ms: 700 } },
      { stream: "Sent. Two replies left, both drafted in your Gmail drafts." },
      { state: "done" },
      { peek: "Sent the reply to Priya. 2 drafts waiting." },
    ],
  },
  pim: {
    crew: "pim",
    prompt: "Make this sound less stiff",
    files: [{ name: "launch-note.txt", size: "2 KB" }],
    steps: [
      { wait: 600, state: "thinking" },
      { state: "working" },
      { tool: { verb: "Read", target: "launch-note.txt", ms: 300 } },
      { stream: "Here's a warmer version. I kept every fact and cut it from 142 words to 88." },
      {
        card: {
          type: "draft",
          channel: "doc",
          before: "We are pleased to announce that our new scheduling feature is now available to all customers. This feature enables users to efficiently manage appointments.",
          after: "Scheduling is here. Everyone can now book, move and cancel appointments in two taps, without the back-and-forth emails.",
        },
      },
      { stream: "Want a shorter one for a text message too?" },
      { state: "done" },
      { peek: "Rewrote your launch note. 88 words." },
    ],
  },
  tuck: {
    crew: "tuck",
    prompt: "Tidy my Downloads",
    steps: [
      { wait: 600, state: "thinking" },
      { state: "working" },
      { tool: { verb: "Scanned", target: "Downloads, 214 files", ms: 1100 } },
      { tool: { verb: "Found", target: "38 duplicates, 2.1 GB", ms: 400 } },
      { stream: "Here's the plan. Nothing is deleted. Duplicates go to a Quarantine folder for 7 days." },
      {
        card: {
          type: "files",
          title: "52 moves",
          undoDays: 7,
          moves: [
            { from: "IMG_20261003_1422.jpg", to: "Photos/2026-10/", kind: "img" },
            { from: "Invoice_Acme_Sept.pdf", to: "Finance/Invoices/", kind: "pdf" },
            { from: "Q3 report FINAL (2).docx", to: "Work/Reports/", kind: "doc" },
            { from: "bank-statement-march.pdf", to: "Finance/Statements/", kind: "pdf" },
            { from: "brand-assets.zip", to: "Work/Brand/", kind: "zip" },
            { from: "pricing-v3.xlsx", to: "Work/Sales/", kind: "sheet" },
          ],
        },
      },
      { plan: { summary: "I'll move 52 files inside Downloads and Documents, and park 38 duplicates in Quarantine. You can undo all of it for 7 days.", steps: [{ text: "Create 6 folders in Documents", risk: "write" }, { text: "Move 52 files", risk: "write" }, { text: "Park 38 duplicates in Quarantine", risk: "delete" }] } },
      { state: "working" },
      { tool: { verb: "Moved", target: "52 files", ms: 1200 } },
      { tool: { verb: "Parked", target: "38 duplicates in Quarantine", ms: 500 } },
      { stream: "Done. Downloads went from 214 files to 124, and you got 2.1 GB back." },
      { state: "done" },
      { peek: "Tidied Downloads. 2.1 GB freed, undo for 7 days." },
    ],
  },
  zip: {
    crew: "zip",
    prompt: "3 LinkedIn posts for our launch",
    steps: [
      { wait: 600, state: "thinking" },
      { state: "working" },
      { tool: { verb: "Read", target: "launch-note.txt", ms: 300 } },
      { tool: { verb: "Searched", target: "Top posts on scheduling, last 30 days", ms: 1300 } },
      { stream: "Three angles, from safest to boldest. The second one matches what's working this month: short hook, one number, no hashtags." },
      {
        card: {
          type: "posts",
          title: "Launch posts",
          variants: [
            { channel: "linkedin", hook: "We just shipped the feature our customers asked for most.", body: "Scheduling is live for everyone. Book, move and cancel in two taps. Thank you to the 212 people who told us what was broken.", chars: 186 },
            { channel: "linkedin", hook: "Our support inbox dropped 31% in the beta.", body: "Most of those emails were people trying to move an appointment. Now it's two taps. Scheduling is live today.", chars: 171 },
            { channel: "x", hook: "No more 'does Tuesday work?' emails.", body: "Scheduling is live. Two taps to book, move or cancel.", chars: 92 },
          ],
        },
      },
      {
        card: {
          type: "calendar",
          title: "Launch week",
          days: [
            { day: "Mon", posts: [{ time: "9:30", channel: "LinkedIn", title: "Launch post" }] },
            { day: "Tue", posts: [{ time: "12:00", channel: "X", title: "Two-tap demo clip" }] },
            { day: "Wed", posts: [] },
            { day: "Thu", posts: [{ time: "10:00", channel: "LinkedIn", title: "Beta numbers" }, { time: "17:00", channel: "Email", title: "Customer note" }] },
            { day: "Fri", posts: [{ time: "11:00", channel: "X", title: "Thank-you thread" }] },
          ],
        },
      },
      { state: "done" },
      { peek: "3 launch posts and a week plan ready." },
    ],
  },
  penny: {
    crew: "penny",
    prompt: "Categorise last month's expenses",
    files: [{ name: "hdfc-sept-2026.csv", size: "48 KB" }],
    steps: [
      { wait: 700, state: "thinking" },
      { state: "working" },
      { tool: { verb: "Read", target: "hdfc-sept-2026.csv, 86 rows", ms: 700 } },
      { tool: { verb: "Matched", target: "Receipts in Finance/Receipts", ms: 1100 } },
      { stream: "September came in at ₹1,84,200, 12% over budget. Software and travel did it. Two rows I wasn't sure about are marked for you." },
      {
        card: {
          type: "kpi",
          title: "September",
          tiles: [
            { label: "Spent", value: "₹1,84,200", delta: 12, spark: [62, 70, 58, 74, 80, 77, 92] },
            { label: "Budget", value: "₹1,65,000" },
            { label: "Software", value: "₹38,400", delta: 41, spark: [20, 22, 21, 26, 30, 33, 38] },
            { label: "Travel", value: "₹27,900", delta: 18, spark: [12, 18, 9, 22, 16, 24, 28] },
          ],
        },
      },
      {
        card: {
          type: "expenses",
          title: "Needs a look",
          categories: [
            { name: "Software", color: "var(--crew-bo)" },
            { name: "Travel", color: "var(--crew-zip)" },
            { name: "Meals", color: "var(--crew-penny)" },
            { name: "Office", color: "var(--crew-tuck)" },
          ],
          rows: [
            { date: "03 Sep", merchant: "Figma", amount: 3600, category: "Software", confidence: "high" },
            { date: "07 Sep", merchant: "IndiGo 6E-512", amount: 11240, category: "Travel", confidence: "high" },
            { date: "12 Sep", merchant: "AMZN Mktp IN", amount: 4899, category: "Office", confidence: "low" },
            { date: "18 Sep", merchant: "Swiggy Instamart", amount: 1320, category: "Meals", confidence: "low" },
            { date: "22 Sep", merchant: "Notion Labs", amount: 1650, category: "Software", confidence: "high" },
          ],
        },
      },
      { state: "done" },
      { peek: "September: 12% over budget. 2 rows need you." },
    ],
  },
};

export const OOPS_SCRIPT: Script = {
  crew: "bo",
  prompt: "Find the contract from Vikram",
  steps: [
    { wait: 600, state: "thinking" },
    { state: "working" },
    { tool: { verb: "Searched", target: "Gmail for 'contract' from Vikram", ms: 900 }, fail: true },
    { error: { title: "Gmail stopped answering", body: "Google asked to sign in again. Nothing was changed. Reconnect Gmail and I'll pick up where I stopped." } },
    { state: "oops" },
    { peek: "Couldn't reach Gmail. Reconnect to continue." },
  ],
};
