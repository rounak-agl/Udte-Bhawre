# Introduction

Tiny AI companions that live on your taskbar, a cross-platform Electron-based desktop assistant. Featuring multi-terminal management, MCP-powered tool integration, and customizable AI personalities that interact with you directly from your system dock.

---
## Demo Videos

https://drive.google.com/drive/folders/1wan_MBSY5Zrw-2k5OIenmlNfSRAtgpsf?usp=drive_link

---

## 🛠 Prerequisites

Before running the application, ensure you have the following installed on your machine:

1.  **Node.js** (v18 or higher recommended)
2.  **npm** (comes bundled with Node)
3.  **MongoDB** (Local or Atlas instance) *Required for persistent agent history and settings.*
4.  **Google Gemini API Key** *You can get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).*

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/rounak-agl/Udte-Bhawre.git
cd Udte-Bhawre
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Your Environment

The application stores settings in `~/.desktop-assistant-settings.json` and uses MongoDB for persistence.

- **Option A (Via Settings GUI):** Once the app is running, use the **Tray Menu > Control Centre > Settings** to input:
    - **MongoDB URI** (e.g., `mongodb://localhost:27017/assistant`)
    - **Google Gemini API Key**
    - **ElevenLabs API Key** (Optional — for voice transcription)
- **Option B (Environment Variables):**
    - You can pre-set your MongoDB connection as an environment variable:
      ```bash
      export MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/db"
      ```

### 4. Run the Application

Start the development server:

```bash
npm start
```

*The application will launch and appear as a **tray icon** (look for the "Q" icon on your taskbar).*

### 5. (Optional) Use a Local Model with Ollama

Run models on your own machine instead of a cloud API:

1. Install [Ollama](https://ollama.com) and pull a model, e.g. `ollama pull llama3.2`.
2. Make sure it's running (`ollama serve`).
3. In **Control Centre → Settings → Custom LLMs**, click **Find models**, pick the model and click **Add model**.

The model then appears as a provider for agents and in every chat's ⚙ menu. Local models are text chat only; they don't get desktop tools.

---

## 🤖 Providers

| Provider | How it runs | Key (Settings → API Keys) |
|---|---|---|
| Gemini Vision | Gemini API, with desktop tools | Gemini API key (required) |
| Claude | `claude` CLI | Optional — otherwise your `claude` login |
| Codex | `codex` CLI | Optional — otherwise your `codex` login |
| Copilot | `copilot` CLI | Optional — otherwise your GitHub login |
| Custom (Ollama) | Local Ollama server | None |

Every agent has its own provider. Change it on the **Agents** page, from the agent's chat **⚙** menu, or in the tray under the agent's name; the conversation carries over. **Settings → Default provider** only pre-selects the provider for new agents. In a Gemini Vision chat, the 🔧 button next to the message box turns that agent's desktop tools on or off.

Keys are encrypted at rest with your OS keychain (Electron `safeStorage`).

### 🛡 ArmorIQ guard

Desktop tools are protected by ArmorIQ. Add your key in **Control Centre → Settings → Security** and use **Test connection** to check it. Each chat shows the guard's live state as a badge: **Protected**, **Asking you** (ArmorIQ unreachable, so each action asks for Allow / Deny), **Guard error**, or **Guard off**. The `ARMORIQ_API_KEY` environment variable overrides the Settings key for development.

### 🔌 Connectors (MCP Marketplace)

Give agents new tools in **Control Centre → Connectors**:

- **Marketplace** has about 30 featured servers (GitHub, Notion, Slack, Postgres, Playwright, Brave Search, Figma, …) and a search of the public [MCP Registry](https://registry.modelcontextprotocol.io). Registry results are marked *Unverified*, and the install dialog shows exactly what will run before you confirm.
- **Install** asks only for what the server needs, such as an API key. It then starts the server once to check it works and lists its tools; servers that fail aren't saved unless you choose **Save anyway**.
- **Installed** lets you **Test**, edit or remove each server.
- **Add custom** takes a pasted config (Claude Desktop, Cursor, VS Code or README JSON) or a form. Arguments go one per row, env vars and headers as key/value rows.

Local servers run with `npx` (needs [Node.js](https://nodejs.org)) or `uvx` (needs [uv](https://docs.astral.sh/uv/)). Hosted servers connect over HTTPS with a token; servers that only support OAuth sign-in aren't supported yet. Keys and tokens are encrypted at rest like the other API keys.

Installed servers are used by agents on **Gemini Vision** with desktop tools (🔧) on, and their tool calls go through the ArmorIQ guard.

---

## 🧪 Running Tests

```bash
npm test
```

Runs the suite in `test/` with Node's built-in test runner — no Electron or database needed (both are stubbed), and your real settings are never touched. Tests that use fake CLI tools need a POSIX shell and are skipped on Windows.

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

*Builds will be generated in the `dist/` directory.*

---

## 🧠 Core Features

-   **Multi-Terminal Support**: Open multiple terminal sessions within the assistant chat.
-   **Character Clones**: Launch multiple AI companions on your taskbar, each with unique roles.
-   **Model Context Protocol (MCP)**: One-click MCP server Marketplace plus custom servers (local or hosted).
-   **Control Centre**: A centralized dashboard to manage agent settings, conversation history, and system configurations.
-   **Security via ArmorIQ**: Integrated security observation to ensure model tool calls are safe and verified.

---

## 📂 Project Structure

-   `main.js` Electron entry point: startup order and app lifecycle.
-   `app/` Main-process modules: `character.js` (a bot's windows, bubble, walking and AI session), `agents.js` (launching/syncing bots), `tray.js`, `overlay.js` (step guides), `control-centre.js`, `security.js` (IPC gatekeeping, navigation guards, approval prompts, MCP config validation), and `ipc/` (IPC handlers grouped by feature: chat, agents, data, providers, settings, marketplace).
-   `renderer/` UI components and pages (Control Centre, Chat, Character overlays).
-   `mcp-servers/` Built-in desktop tools and the curated Connectors catalog (`catalog.js`).
-   `utils/` Database utilities, taskbar geometry, and screen capture logic.
-   `sessions/` AI model sessions: `providers.js` (registry of all providers), `cli-session.js` (shared base for the Claude/Codex/Copilot CLIs), `vision-session.js` (Gemini API + tools), `ollama-session.js` (local models), `mcp-client.js` (built-in + external MCP servers, local and hosted), `mcp-registry.js` (MCP Registry search).
-   `test/` Automated tests (`npm test`).
