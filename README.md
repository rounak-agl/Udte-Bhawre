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
-   **Model Context Protocol (MCP)**: Supports Model Context Protocol for deep system integration.
-   **Control Centre**: A centralized dashboard to manage agent settings, conversation history, and system configurations.
-   **Security via ArmorIQ**: Integrated security observation to ensure model tool calls are safe and verified.

---

## 📂 Project Structure

-   `main.js` Electron main process and window orchestration.
-   `renderer/` UI components and pages (Control Centre, Chat, Character overlays).
-   `mcp-servers/` Built-in local MCP server for system tools.
-   `utils/` Database utilities, taskbar geometry, and screen capture logic.
-   `sessions/` AI model sessions: `providers.js` (registry of all providers), `cli-session.js` (shared base for the Claude/Codex/Copilot CLIs), `vision-session.js` (Gemini API + tools), `ollama-session.js` (local models).
-   `test/` Automated tests (`npm test`).
