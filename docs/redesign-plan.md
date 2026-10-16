# Redesign plan: the crew, the portal and the desk

Status: draft for approval, 2026-10-16. Nothing here is built yet.

## 1. Problem

Today the app shows a 48x64 CSS blob that walks the taskbar and opens a 360x420 chat. The blob can walk and blink. It has no idle, thinking, working, needs-you or done pose (`renderer/character.html:105-149`), and approval is a blocking OS dialog (`app/security.js:106`). The character carries no information, so it is decoration, and decoration is the first thing a busy person turns off.

**Falsifiable problem:** a non-technical user cannot tell, without opening a window, which helper is working, which one needs them, and which one is done. So they never hand off work and walk away, and handing off is the whole value.

**Assumption it rests on:** a visible, expressive character that changes pose with agent state makes handing off feel safe and fun enough that people do it again. This is untested. The strategy doc's 2-week A/B still applies.

**Who it is for (inference, no interviews yet):** small business owners, marketing and GTM people, and finance people on Windows. None of them write prompts for a living. They have text, inboxes, files and spreadsheets to get through.

## 2. Art direction

Two worlds, one rule from papersseum: **bold in one place.**

| Layer | Look | Source |
| --- | --- | --- |
| Chrome (desk, home base, cards, menus) | Ink on paper. Hairline borders, Geist 300/400/500, no shadows, no gradients, square structure, 3x3 grid motifs | papersseum tokens, ported 1:1 |
| Characters | Soft vinyl designer toys like the Vanow, Luck Family and BB Family references. Chunky silhouettes, big glossy eyes, soft studio light, a small contact shadow, saturated colour | new |

The characters are the only place with light, shading and depth. That contrast is the brand: flat paper desk, real little toys standing on it. Papersseum's own five slot colours become the five crew colours, so "a colour means a character" carries over exactly as "a colour means a player".

**Why not pixel bots like papersseum?** The pixel bot reads as a game. The references, and the goal (calm, friendly, approachable at work), call for soft toys. The pixel face survives as a second voice: Geist Pixel for counters, badges and the portal.

## 3. The crew

Five starters, one per job family. Each silhouette must read at 40px with the colour removed (squint test). The names are placeholders, see decision D3.

### Toy grammar (read off the three references)

These are the rules every character obeys, so the crew reads as one family:

- **Head is the body.** The head-to-body ratio is about 1:1, or the character is a head on stubby legs (BB yellow, Vanow pink). Arms are nubs, and legs are short pills, often in shoes or socks.
- **One base colour, one contrast accessory.** Each character is a single saturated colour plus one object in another colour: a cap, bow, helmet, sweatband or hat.
- **The eyes do all the acting.** Big white sclera, big black pupils, one small specular dot. Emotion comes from the lid shape (half-lidded cool in Vanow blue, heart pupils in Vanow pink, a wink in BB blue). The mouth is tiny or missing.
- **A small warm accent nose or beak** (yellow or orange) on most of them.
- **Material is part of the character:** matte flocked vinyl (Vanow), glossy vinyl (Luck Family), fur (BB pink), and polka-dot print (BB blue). In three.js: `MeshPhysicalMaterial` with sheen for flocked, clearcoat for glossy, and shell-texture fur for one character only.
- **Studio light:** soft key from the top left, wraparound fill, ambient occlusion in the creases and one soft contact shadow. There are no outlines and no cel shading.
- **Front-facing and slightly turned in.** They look at you, not at each other.

| Name | Role | Reference | Body and material | Eyes | Accessory and prop | Signature "done" move |
| --- | --- | --- | --- | --- | --- | --- |
| Bo | Inbox helper | Vanow blue | Spiky crown, broad block body, matte flocked cobalt | Half-lidded, unbothered | Yellow beak, envelope | Catches an envelope, stamps it, gives a cool nod |
| Pim | Writer | BB pink | Tall furry bean, stubby legs | Two huge round eyes, no mouth | Blue cap worn backwards, pencil behind the ear | Scribbles in the air and the scribble becomes a check mark |
| Tuck | Organiser | Luck Family white | Soft cube, glossy white vinyl | Small dot eyes | Yellow beak, black lid hat | Lid pops, folders file themselves in, lid closes |
| Zip | Marketing and GTM | BB orange | Glossy "b"-shaped blob on two legs | Huge eyes set high | Megaphone | Tiny confetti burst from the megaphone |
| Penny | Finance | BB yellow | Small round blob, striped socks | Wide eyes, tiny "o" mouth | Green visor, calculator | Counts on its nubs, ka-ching, coin flip |
| Minis (sub-agents) | Delegated tasks | BB green stick | Thin glossy pill tinted in the parent's colour | Lazy half-lids | None | Hop back into the portal |

Rules carried from `strategy.md`: at most 4 on screen at once, no guilt or decay mechanics, and a character never shows "done" after an error.

### Character states

Every state names its job. The state machine lives in one module, and chat, the stage and home base all read from it.

| State | Trigger | Pose and motion | Job |
| --- | --- | --- | --- |
| hatching | first spawn, or summon | Pops out of the portal: squash on exit, overshoot, settle | continuity (it came from somewhere) |
| idle | nothing to do | Breathing scale 1 to 1.02, blink every 3-5 s, glances at the cursor, seeded phase so the crew never moves in sync | presence |
| drift | idle over 10 s | Floats on a slow Lissajous path inside its home zone, with a bob, never across your cursor | presence |
| hover | pointer over the character | Turns to face you, eyes widen, small hop, name tag peeks | feedback (you can touch this) |
| held | drag | Squash, legs dangle, eyes squeeze, follows the pointer with lag | feedback |
| tossed | released | Inertia, bounce on screen edges, wobble settle | feedback |
| drop-ready | file or text dragged near | Arms open, ring of 3x3 cells lights in its colour | affordance (drop here) |
| listening | user typing or mic on | Leans in, ear wiggle | feedback |
| thinking | waiting for model | Per-character fidget (Bo taps an envelope, Penny clicks the calculator), a 3x3 cell loader over its head | wait state |
| working | tool running | Prop action loop plus a step counter in Geist Pixel ("2/5") | status |
| needs-you | approval pending | Stops, turns to camera, raises a hand, a yellow badge bobs; repeats a gentle wave every 8 s, never shakes | attention, the most important state |
| done | turn complete, no error | Signature move, then a result peek bubble | reward and status |
| oops | error | Sheepish shrug, sweat drop, peek says what failed in plain words | honest status |
| sleeping | idle 20 min | Sinks to the taskbar, Zzz in pixel type | calm, less motion |
| returning | dismissed | Waves, walks back into the portal, the portal closes | continuity |

## 4. The portal

A small 3x3 cell grid (papersseum's logo grid) docked above the tray corner of the taskbar, 56x56.

- **Closed:** 9 cells of `--rule`, with the centre empty. Hover lights the four corners in crew colours, the logo mark hover from papersseum.
- **Opening:** the cells wipe open from the centre (the 3x3 cell wipe, 420 ms `--ease-move`) and reveal a soft swirl in the summoning character's colour. This is the one other place light is allowed.
- **Summon:** click the portal to open the crew fan, a radial menu of the roster. Pick one and it hatches. Drag a file onto the portal and it asks "Who should take this?" with the 2 best-fit characters.
- **Sub-agents:** when an orchestrator delegates, up to 3 mini versions (60% scale) pop out of the portal, work beside the parent, and hop back in when done.

## 5. Window model

Today there is one 64x80 window, one chat window and one bubble window per character, moved by `setBounds` at 30 fps (`app/character.js:502-661`). Floating anywhere, tossing, the portal and mini sub-agents cannot work in 64x80 boxes.

**Proposal: one transparent "stage" window per display**, covering the work area, always on top and click-through except where a character, bubble or the portal is under the pointer. All characters render in one WebGL scene in that window. Chat ("the desk") stays a separate, normal, focusable window so it can resize, snap and take keyboard focus.

See decision D1 for the plain-terms trade-off.

## 6. The desk (chat, redesigned)

One window, four sizes. Each size is a mode with its own density, not just a bigger box.

| Mode | Size | What it shows | Enter by |
| --- | --- | --- | --- |
| Peek | bubble, max 280 x 3 lines | The last result or question, with one action ("Open", "Approve", "Undo") | automatic on done, needs-you or oops |
| Popover | 400x560, anchored to the character with a tail | One thread: messages, inline cards, composer | click the character |
| Panel | 480 wide x full work-area height, snapped to the left or right edge | Thread, plus an artifact drawer that slides over from the inside edge | expand button, `Ctrl+Shift+E`, or drag to an edge |
| Focus | 1100x760, centred | Nav rail (crew), thread list, thread, artifact pane: master-detail | expand again, or from home base |

Interactions:
- Resize from any edge and corner with 8px hit targets. Live layout uses container queries, so the thread reflows by its own width rather than the window's.
- Drag the header to move it. It snaps to edges and corners with a 24px magnet, and a hairline preview shows the snap target.
- Pin keeps the window on top. Detaching it from the character turns the tail off.
- The composer has a drop zone: drop text, files or a screenshot, or paste them. Slash commands come from a palette (`/` or `Ctrl+K`). Mentioning `@Penny` hands the message to another crew member.
- The input is never locked while sub-agents run; new messages queue with a visible "queued" chip (fixes `chat.js:789`).

Message vocabulary in the thread:
- Streaming text, with a steady caret and no character-by-character jitter.
- Tool rows are collapsed to one line (verb, target, duration, status shape). They expand to input and output, and run in parallel in a single group.
- **Plan card** (approval, inline, replaces the OS dialog for the UI): a plain-language summary ("I'll read 3 files in Downloads and draft an email to Priya. I won't send it."), the step list, one button per decision (Approve, Edit, Deny), and the hashes behind a Details disclosure. Send, pay, delete and post always ask. Approve is disabled for 600 ms after mount so it cannot be rubber-stamped by a double-click.
- Generative cards (section 7).
- Undo toast after any file or send action, kept for 10 s and then available in Activity for 7 days.

## 7. Dynamic UI: the card catalog

Per the vault note "Generative UI only works inside a constrained component vocabulary": the model never writes HTML. It returns a fenced `ui` block with `{ "card": "<type>", "props": {...} }`, the same marker mechanism `delegate` and `remember` already use in `markdown.js`. The renderer validates the props against a schema and mounts a card from the catalog. Invalid JSON falls back to plain text and never crashes the thread. Every card has a copy, open and "ask about this" escape hatch.

| Pack | Cards |
| --- | --- |
| Core (all crew) | Plan, Draft (email or doc, with a diff against the original and Insert / Copy / Send-for-approval), Compare (2-4 options as columns), Checklist, Choice chips, Summary, Sources, File batch (rename and move preview with undo) |
| Small business | Customer reply set (3 tones), Invoice (line items, totals, due), Schedule (slots) |
| Marketing and GTM | Post variants (X, LinkedIn, email previews in true size), Content calendar (week grid), Campaign brief, Competitor snapshot, Lead list (table with enrichment status) |
| Finance | KPI tiles (value, delta, sparkline), Expense table (auto-categorised, editable category chips), Budget vs actual (bar), Reconciliation diff (matched, unmatched, suggested), Receipt extract |

Frontend-first: every card ships with seeded fixtures (empty, one, typical, heavy, long strings, partial) in the playground. Prompting the providers to emit `ui` blocks is a backend follow-up (D6).

## 8. Home base (Control Centre, redesigned IA)

The current nine-item sidebar (`dashboard, chat history, tasks, agents, activity, settings, connectors...`) becomes five places, ordered by job:

| Place | Job | Replaces |
| --- | --- | --- |
| Today | What needs you (approvals queue), what the crew did ("what I did for you" card), what is running | Dashboard, Activity |
| Crew | The roster as a shelf of toys. Click one for the master-detail: role, can and can't card, model (Local or Cloud), connectors it may use, its threads | Agents |
| Threads | All conversations, searchable, grouped by character | Chat history |
| Connections | The curated connector list first; the public registry behind Advanced | Connectors |
| Settings | Models (Local first: Ollama detection and model list on top, cloud keys below), Appearance, Safety, About | Settings |

Tasks fold into Today and threads. Local is a first-class badge everywhere: each character shows "On this computer" or "Cloud: Gemini", and the model picker groups Local above Cloud.

**Onboarding (first run):** the portal appears alone on an empty desktop. "Something's in here." Click it, and the first character hatches and introduces itself in one line. It then asks for one thing: Ollama, if it is detected ("I can run fully on your computer"), otherwise a free Gemini key. Next comes a 30-second demo: "Drop any text on me." Target: under 2 minutes from install to first character.

## 9. Motion

UI motion uses papersseum's tokens unchanged: `--dur-instant 70`, `--dur-fast 140`, `--dur-moderate 240`, `--dur-slow 420`, `--ease-smooth`, `--ease-swing`, `--ease-move`, press scale 0.96, stagger 40 ms capped under 500 ms, never ease-in, never `transition: all`.

Character motion is a separate system on purpose. It is physical, so it uses springs and squash and stretch, and the UI overshoot cap (1.05) does not apply. It runs in the render loop, never as CSS transitions.

| Moment | Job | Spec |
| --- | --- | --- |
| Button hover | feedback | Rising fill and rolling label (papersseum), 420 ms swing |
| Desk mode change | spatial | The window animates its bounds from the anchor, 420 ms swing, and content cross-fades at 140 ms |
| Popover open | continuity | Grows from the character's position (transform-origin at the tail), 240 ms smooth |
| Card mount | continuity | 8 px rise and fade, 240 ms, staggered rows |
| Plan card needs-you | attention | One pulse of the yellow left rule, no loop |
| Portal open | continuity | 3x3 cell wipe, 420 ms move |
| Character spring | physics | stiffness 380, damping 22 for hops; 180 and 14 for wobble settle |
| Squash on land | feedback | scaleY 0.82, scaleX 1.12, recover 280 ms |
| Done | reward | Signature move, at most 1.6 s, then idle |

**Reduced motion is a second design:** characters stop drifting and stay docked on the taskbar, state changes become pose swaps with a 70 ms fade, the portal fades instead of wiping, and there is no idle breathing. Every state stays readable from pose and badge alone.

**One ambient loop per scene:** only idle breathing loops. Drift is slow enough to read as stillness.

## 10. Sound

Synthesised with Web Audio (the vault's Cuelume note: sound as tokens, not files), off by default with one switch. This fixes today's Sounds toggle, which does nothing. Only six cues: hatch, pick up, drop, needs-you, done and oops. Each crew member gets its own pitch, so you can tell who finished without looking.

## 11. States the desk and home base owe

| Surface | Empty | Loading | Error | Partial | Offline |
| --- | --- | --- | --- | --- | --- |
| Desk thread | "Drop something on me, or ask." plus 3 role-specific starters | Nothing under 300 ms, then the character's thinking state plus a "Thinking" line; past 10 s, "Still on it" with Stop | The oops card in plain words, with what was kept and Retry | Tool group shows done and failed rows separately | Local characters keep working; cloud ones show "Offline. I'll pick this up when you're back." |
| Card | Each card has its own empty copy (for example "No expenses found in this file") | Skeleton in the card's real shape | Card collapses to text plus a Retry | Shows present rows and marks the missing ones "Not found" | Not applicable |
| Today | "Nothing needs you." with the crew asleep on the shelf | Skeleton rows | Per-block error, never a blank page | Per-block | Badge on the header |
| Crew | First run is the onboarding | Shelf skeleton | Per character | Not applicable | Not applicable |

## 12. Stack decisions (plain terms)

**D1. Window model: one stage window per display (recommended), or keep one window per character.**
- *What it means:* today each character is its own tiny invisible window that the app moves 30 times a second. The proposal is one invisible sheet over the whole screen that all characters live on. Clicks pass through it except where something is drawn.
- *Cost:* a medium rewrite of `app/character.js` movement. On some Windows setups, transparent full-screen windows need care around fullscreen apps and multiple monitors. Slice 2 starts with a one-day spike to prove click-through and drag on your machine.
- *What it unlocks:* floating anywhere, tossing, the portal, mini sub-agents and one 3D scene instead of four.
- *What it rules out:* nothing; if the spike fails, characters fall back to per-character windows with a larger box.

**D2. Characters: real-time 3D with three.js (recommended), pre-rendered sprite sheets, or flat SVG.**
- *3D (three.js):* soft vinyl-toy look built from rounded shapes and soft lighting, every state animatable from code, and new characters cost a config, not an artist. It is the same approach as the armoriq-tools mascot builder. Costs about 600 KB, plus GPU use while visible; the scene drops to 0 fps when no character is moving.
- *Sprite sheets:* the best possible look, but every pose of every character has to be rendered by an artist in Blender, and there is no artist.
- *SVG:* light and crisp, but flat. It cannot hit the reference style.

**D3. Renderer stack: Vite + React + TypeScript (recommended), or keep plain HTML and script tags.**
- *Why change:* the generative card catalog, four desk modes and a playground with dials need components and types. Agentation, which you review with, is React. The GSAP React skill applies.
- *Cost:* adds a build step (`npm run dev` runs Vite and Electron together). The existing `preload.js` IPC contract stays exactly as it is, so the backend does not change.
- *Rules out:* nothing; the old renderer stays until each surface is replaced, so the app never breaks mid-way.

**D4. Icons: Lucide**, the set Supabase Studio uses, at 1.5 px stroke and 16 or 20 px. This replaces emoji used as icons.

**D5. Fonts: Geist, Geist Mono and Geist Pixel Square, bundled from the `geist` npm package.** They work offline, which fixes today's Google Fonts dependency and the never-loaded Inter in the bubble.

## 13. Playground

Make it a dev-only `playground.html` served by Vite, viewable in a normal browser so you can review with Agentation, plus an Electron menu item that opens it. DialKit groups:
- **Scene:** character, state, crew size, data scale
- **Structure:** desk mode, card type, layout variant
- **Motion:** spring stiffness, damping, idle intensity, reduced motion
- **Stage:** light or dark, desktop wallpaper behind the stage (light, dark, busy photo) so contrast is checked on real backgrounds

## 14. Build order: slices, commits, PRs

Each slice is one branch and one PR, stacked on the one before it. I commit as I go, open the PR when the slice is shown working, and you review it in the playground.

| # | Slice | Ships | Verify |
| --- | --- | --- | --- |
| 0 | Foundation | Vite + React + TS renderer wired into Electron, tokens ported from papersseum, local Geist fonts, Lucide, motion tokens, primitives (Button, Chip, Status, Tooltip, Popover, Drawer, Toast, Skeleton, EmptyState, Tabs, Segmented), playground shell with DialKit and Agentation | Playground loads, light and dark, `npm test` passes |
| 1 | Toy kit | three.js character engine, the five characters, the state machine, every state in section 3 driven by dials | Every state screenshotted per character |
| 2 | Stage and portal | Spike, then the stage window, portal, hatch and return, drift, drag and toss, hover, drop-ready, mini sub-agents, reduced motion | Running on your desktop, not just the browser |
| 3 | The desk | Four modes, resize and snap, streaming, tool rows, plan card, queueing, wired to the existing chat IPC | A real Gemini or Ollama turn end to end |
| 4 | Card catalog | `ui` block protocol, the schema validator, the core pack plus three domain packs, with fixtures for every state | Every card at every data scale |
| 5 | Home base and onboarding | Five places, crew shelf and detail, Today, the local-first model settings, the first-run hatch | Fresh profile run under 2 minutes |
| 6 | Sound and polish | Six cues, contrast on busy wallpapers, an a11y pass, deleting the old renderer | The old surfaces' tests carried over |

## 15. Decisions for you

1. **D1 to D5** above: approve the recommendations, or name a swap.
2. **Crew:** five characters (Inbox, Writer, Organiser, Marketing, Finance), or start with three and add two later. I recommend building all five in the toy kit, since a character costs a config, and showing three by default.
3. **Names:** Bo, Pim, Tuck, Zip and Penny are placeholders. Keep them or rename.
4. **Repo and PRs:** `origin` is `rounak-agl/Udte-Bhawre`. Opening PRs publishes the branches there. Confirm that is the target. The uncommitted merge on `main` (README, `main.js`, the package files, the Langfuse WIP) stays out of every PR unless you say otherwise.
5. **Approval:** the in-chat plan card becomes the main approval UI, and the native dialog becomes the fallback when no window is open. This touches `app/security.js` in slice 3, which is backend. Do it then, or keep the dialog until later.
6. **Card protocol:** slice 4 is frontend with fixtures only. Teaching Gemini, Claude and Ollama to emit `ui` blocks (system prompt plus parsing) is a later backend slice. Confirm.

Found during the audit: `package.json` lists `@opentelemetry/sdk-node` twice, left over from the merge. Slice 0 removes the duplicate.
