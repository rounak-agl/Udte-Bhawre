# Udte Bhawre

A crew of 3D AI agents that live on your desktop, in a cross-platform Electron app. Each crew member has its own brain (Gemini, Claude, Codex, Copilot or a local Ollama model), uses tools through MCP servers, and can hand parts of a job to sub-agents. Every action an agent takes goes through **ArmorIQ** first, so safe work runs and dangerous commands are blocked.

---
## Demo Videos

https://drive.google.com/drive/folders/1wan_MBSY5Zrw-2k5OIenmlNfSRAtgpsf?usp=drive_link

---

## 🛠 Prerequisites

Before running the application, ensure you have the following installed on your machine:

1.  **Node.js** (v18 or higher recommended)
2.  **npm** (comes bundled with Node)
3.  **MongoDB** (Local or Atlas instance) *Stores sub-agent tasks, team memory and (in the classic UI) agents and chat history.*
4.  **Google Gemini API Key** *You can get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).*
5.  **Optional:** the [Claude Code](https://claude.ai/download) CLI, and an **ArmorIQ** API key from [platform.armoriq.ai](https://platform.armoriq.ai).

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/rounak-agl/Udte-Bhawre.git
cd Udte-Bhawre
```

### 2. Install Dependencies and Build the 3D Crew

```bash
npm install
npm run build:ui
```

The 3D crew UI is a separate React + Three.js build in `ui/` (output in `ui/dist`, not committed). Run `npm run build:ui` again after changing anything in `ui/`. Without it, the app opens the classic UI and says so in the terminal.

### 3. Setup Your Environment

The application stores settings in `~/.desktop-assistant-settings.json` and uses MongoDB for persistence.

- **Option A (Via Settings GUI):** Once the app is running, click the grid button next to the crew (or **Tray Menu → Open Home base**) and go to **Settings**:
    - **Keys:** Gemini (required), plus optional Claude, Codex and Copilot keys
    - **Voice:** ElevenLabs key (optional, for voice transcription in the classic chat)
    - **Database:** MongoDB address (e.g., `mongodb://localhost:27017/assistant`)
    - **ArmorIQ:** your ArmorIQ API key, with **Test connection**
- **Option B (Environment Variables):**
    - You can pre-set your MongoDB connection as an environment variable:
      ```bash
      export MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/db"
      ```

### 4. Run the Application

```bash
npm start
```

The crew appears along the bottom of your screen, with a tray icon for the menu. Variations:

| Command | What you get |
|---|---|
| `npm start` | The 3D crew (default) |
| `GPU=1 npm start` | The 3D crew drawn on your graphics card. Much lighter on the CPU; recommended unless the space around the crew turns black instead of see-through |
| `CREW_UI=0 npm start` | The classic UI: Control Centre plus 2D characters you create yourself |

### 5. (Optional) Use a Local Model with Ollama

Run models on your own machine instead of a cloud API:

1. Install [Ollama](https://ollama.com) and pull a model, e.g. `ollama pull llama3.2`.
2. Make sure it's running (`ollama serve`).
3. In **Home base → Settings → Brains**, click **Use** next to the model (classic UI: **Control Centre → Settings → Custom LLMs**).

The model then appears as a brain you can give any crew member. Local models are text chat only; they don't get desktop tools.

---

## 🧸 The Crew

Five crew members live on your screen. Click one to open its desk (a chat window) and ask for help.

| Crew member | Role |
|---|---|
| **Bo** | Inbox helper: email and calendar |
| **Pim** | Writer: rewrites, tone, translation |
| **Tuck** | Organiser: tidies Downloads and Documents, and runs git in your code projects |
| **Zip** | Marketing: launch posts, campaigns, content plans |
| **Penny** | Finance: receipts, invoices, budgets |

- **Brains:** each crew member has its own. Pick it from the model chip under the message box, or on **Home base → Crew**.
- **Sub-agents:** every crew member is an orchestrator. Ask for a job with several parts and it hands them to sub-agents, which hatch on screen as mini characters next to it, work in parallel, then return. See [Orchestrator agents and sub-agents](#-orchestrator-agents-and-sub-agents).
- **Home base** (the grid button next to the crew): **Today** (what needs your OK, what the crew did), **Crew**, **Threads**, **Connections** and **Settings**.
- **Safety:** anything that sends, pays, deletes or posts stops and asks you first, and every tool call goes through ArmorIQ. Blocked actions show up in the desk as a red "Blocked by your safety rules" card.

---

## 🤖 Providers

| Provider | How it runs | Key (Home base → Settings → Keys) |
|---|---|---|
| Gemini Vision | Gemini API (`gemini-3.8-flash`), with desktop tools | Gemini API key (required) |
| Claude | `claude` CLI | Optional — otherwise your `claude` login |
| Codex | `codex` CLI | Optional — otherwise your `codex` login |
| Copilot | `copilot` CLI | Optional — otherwise your GitHub login |
| Custom (Ollama) | Local Ollama server | None |

Every agent has its own provider. In the crew, change it from the model chip in a desk or on **Home base → Crew**. In the classic UI, use the **Agents** page, the chat's **⚙** menu, or the tray under the agent's name. The conversation carries over. **Settings → Default provider** only pre-selects the provider for new agents. In a Gemini Vision chat, the 🔧 button next to the message box turns that agent's desktop tools on or off.

Keys are encrypted at rest with your OS keychain (Electron `safeStorage`).

### 🧩 Orchestrator agents and sub-agents

Agents are **orchestrators** by default. When a request has several parts, the agent can split it into sub-tasks and hand them to **sub-agents** that work in the background. Each sub-agent can use a different provider (e.g. Claude for writing, a local model for something private), and the agent then combines their results into one answer. Simple questions are answered directly.

- **Live progress:** in the crew, each sub-agent appears as a mini character next to its crew member while it works, and **Home base → Today → Running now** counts them. In the classic UI, a card in the chat shows each sub-agent; click a row to see its output, or **Cancel** to stop them.
- **Tasks page (classic UI):** every sub-task appears there with its provider, duration and result. Use **Sub-agent tasks** to see only those.
- **Team memory:** the agent and its sub-agents can save durable facts (your preferences, decisions, findings). Sub-agents that start later see what earlier ones saved, and the memory carries into later conversations. View or clear it under **Agents → Team memory**.
- **Limits:** up to 6 sub-tasks per request, 3 at a time, 5 minutes each. Sub-agents can't create their own sub-agents.
- **Turn it off:** use **Agents → Orchestrator**. Sub-agents use desktop tools only if the agent has tools on, and those calls still go through ArmorIQ and the approval prompts.

Delegation is a small text protocol (`sessions/orchestration.js`), so every provider can orchestrate. Small local models may follow it less reliably.

### 🖼 Screenshots and images

The app never looks at your screen on its own. To show an agent something, use the 📎 button next to the message box:

- **📷 Take a screenshot.** The chat steps aside, captures the screen once, and adds the shot to your message.
- **🖼 Image from file…**, or paste or drag an image into the chat.

Attachments appear above the message box, where you can remove them, and are sent only with the next message (up to 4). Images work with Gemini Vision, Claude, Codex and local Ollama vision models such as `llava` or `gemma3`. Copilot is text-only.

Images are sent to the agent's provider (Google, Anthropic, OpenAI, or your local Ollama), but they're never saved: the chat history records "📎 image attached" instead. On Linux the screenshot uses your desktop's tool (`spectacle`, `gnome-screenshot`, `grim` or `scrot`).

### 🛡 ArmorIQ guard

Every agent action is checked by ArmorIQ, in one of two ways depending on the agent's brain.

**Gemini agents: the ArmorIQ SDK guard** (`sessions/armoriq-guard.js`). Add your key in **Home base → Settings → ArmorIQ** (classic UI: **Control Centre → Settings → Security**) and use **Test connection** to check it. The same page shows what the policy (`armoriq.policy.json`) always blocks and which tools ask you first. On top of the policy, the guard blocks dangerous arguments to any tool, such as `sudo`, `rm -rf`, `chmod` or `mkfs`. In the classic UI, each chat shows the guard's live state as a badge: **Protected**, **Asking you** (ArmorIQ unreachable, so each action asks for Allow / Deny), **Guard error**, or **Guard off**. The `ARMORIQ_API_KEY` environment variable overrides the Settings key for development.

For each request that uses tools, the agent first lists every tool the whole task will need, working only from your conversation and never from what a tool returned. ArmorIQ signs that plan, so multi-step work (e.g. look up your GitHub user → create a branch → commit a file) runs without interruption. If the agent then reaches for a tool outside the signed plan, it's checked against your request, again without anything a tool or sub-agent returned. If your request calls for it, ArmorIQ signs an updated plan and the step runs; risky tools (shell, file writes, opening URLs) still ask you as usual. Otherwise you're asked first: allow it and ArmorIQ signs an updated plan; deny it and the step is blocked.

**Claude agents: ArmorClaude.** Agents on the Claude brain use **ArmorClaude**, ArmorIQ's Claude Code plugin. Before acting, Claude registers an intent plan with ArmorIQ, and each command is checked against your armor policy. Every run shows up in the ArmorIQ console ([tools.armoriq.ai](https://tools.armoriq.ai)) under **Intent Plans** as Completed or Blocked. To set it up:

1. Install the plugin and sign in, following ArmorIQ's ArmorClaude instructions.
2. In a `claude` session, apply a policy template, e.g. `/armorclaude:armor policy template velocity-machine`, then `/armorclaude:armor yes`.
3. Check the rules with `/armorclaude:armor policy list`.

The **Velocity Machine** template allows reads, search and workspace writes by default, and blocks `rm`, `sudo` and `chmod`, `git push --force`, publishing, reading `.env` files and writing outside the workspace. The app runs Claude with read-only git (`status`, `log`, `diff`) pre-approved; other writes are denied in the background chat unless your policy and Claude's permissions allow them.

### 🔌 Connectors (MCP Marketplace)

Give agents new tools in **Home base → Connections** (classic UI: **Control Centre → Connectors**):

- **Browse** has about 30 featured servers (GitHub, Notion, Slack, Postgres, Playwright, Brave Search, Figma, …) and a search of the public [MCP Registry](https://registry.modelcontextprotocol.io). Registry results are marked *Not reviewed*, and the install dialog shows exactly what will run and asks you to confirm you trust the publisher.
- **Install** asks only for what the server needs, such as an API key. It then starts the server once to check it works and lists its tools; servers that fail aren't saved unless you choose **Save anyway**.
- **Installed** lets you **Test**, edit or remove each server.
- **Add your own** takes a pasted config (Claude Desktop, Cursor, VS Code or README JSON) or a form. Arguments go one per row, env vars and headers as key/value rows.

Local servers run with `npx` (needs [Node.js](https://nodejs.org)) or `uvx` (needs [uv](https://docs.astral.sh/uv/)). Hosted servers connect over HTTPS with a token; servers that only support OAuth sign-in aren't supported yet. Keys and tokens are encrypted at rest like the other API keys.

Installed servers are used by agents on **Gemini Vision** with desktop tools on (always on for the crew), and their tool calls go through the ArmorIQ guard.

---

## 🧪 Running Tests

```bash
npm test
```

Runs the suite in `test/` with Node's built-in test runner — no Electron or database needed (both are stubbed), and your real settings are never touched. The main-process tests drive the classic UI (`CREW_UI=0`). Tests that use fake CLI tools need a POSIX shell and are skipped on Windows.

---

## 📦 Building for Production

To create a standalone executable for your operating system:

### For Linux (AppImage)
```bash
npm run build:linux
```

### For Windows (NSIS Installer)
```bash
npm run build:win
```

*Builds will be generated in the `dist/` directory. Both commands build the 3D crew UI first.*

---

## 🧠 Core Features

-   **3D Crew**: Five AI companions with distinct roles, living on your desktop and rendered with Three.js.
-   **Any Brain**: Gemini, Claude, Codex, Copilot or a local Ollama model, per crew member.
-   **Sub-agents**: Crew members split big jobs between sub-agents that work in parallel, with shared team memory.
-   **Model Context Protocol (MCP)**: One-click MCP server marketplace, public registry search, and custom servers (local or hosted).
-   **Security via ArmorIQ**: Every tool call is checked against signed intent plans and your policy; dangerous commands are blocked and logged.
-   **Classic UI**: The Control Centre dashboard with 2D characters is still available (`CREW_UI=0`).

---

## 📂 Project Structure

-   `main.js` Electron entry point: startup order and app lifecycle (3D crew by default, classic with `CREW_UI=0`).
-   `ui/` The 3D crew UI (React, Three.js, Vite): the stage with the crew, each crew member's desk (chat), and Home base. Built to `ui/dist` with `npm run build:ui`.
-   `app/crew-ui.js`, `app/crew-backend.js`, `app/crew-prompts/` The crew's windows, its five agents and their personas. `preload-crew.js` is the bridge the crew UI talks to.
-   `app/` Other main-process modules: `character.js` (a bot's windows, bubble, walking and AI session), `agents.js` (launching/syncing bots), `orchestrator.js` (runs an agent's sub-agents), `tray.js`, `control-centre.js`, `security.js` (IPC gatekeeping, navigation guards, approval prompts, MCP config validation), and `ipc/` (IPC handlers grouped by feature: chat, agents, data, providers, settings, marketplace).
-   `renderer/` Classic UI components and pages (Control Centre, Chat, the walking characters).
-   `mcp-servers/` Built-in desktop tools and the curated Connectors catalog (`catalog.js`).
-   `utils/` Database utilities, taskbar geometry, and the on-demand screenshot for 📷 in chat (`screenshot.js`).
-   `sessions/` AI model sessions: `providers.js` (registry of all providers), `cli-session.js` (shared base for the Claude/Codex/Copilot CLIs), `vision-session.js` (Gemini API + tools), `ollama-session.js` (local models), `mcp-client.js` (built-in + external MCP servers, local and hosted), `mcp-registry.js` (MCP Registry search), `orchestration.js` (delegation protocol) and `team-memory.js`.
-   `test/` Automated tests (`npm test`).
