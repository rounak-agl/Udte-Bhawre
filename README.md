# Introduction

Tiny AI companions that live on your taskbar, a cross-platform Electron-based desktop assistant. Featuring multi-terminal management, MCP-powered tool integration, and customizable AI personalities that interact with you directly from your system dock.

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
-   `sessions/` AI model session handlers (Gemini, Claude, Codex, etc.).
