import type { CrewId } from "../crew/roster";
import type { DeskMode } from "../desk/Desk";
import type { Attachment } from "../sim/types";
import type { Overview } from "../sim/store";

export type BusMsg =
  | { type: "hello" }
  | { type: "world"; world: unknown }
  | { type: "action"; name: "send"; id: CrewId; text?: string; files?: Attachment[] }
  | { type: "action"; name: "stop"; id: CrewId }
  | { type: "action"; name: "brain"; id: CrewId; key: string }
  | { type: "action"; name: "decide"; id: CrewId; planId: string; ok: boolean }
  | { type: "action"; name: "summon" | "wake" | "retry" | "refresh" | "clear"; id: CrewId };

export type LocalStatus = { running: boolean; error?: string; models: { name: string; size: number }[]; added: { id: string; model: string; name: string }[] };

export type KeyProvider = "gemini" | "claude" | "codex" | "copilot";

export type SecurityOverview = {
  guard: { active: boolean; keySource: string | null; envOverride: boolean };
  policy: { allow: string[]; deny: string[]; path: string };
  approvalTools: string[];
  tools: string[];
  fileAccess: string;
  secrets: { encrypted: boolean; backend?: string; platform?: string };
};

export type AppInfo = { name: string; version: string; electron: string; node: string; chrome: string; platform: string; settingsFile: string; policyFile: string; database: string };

export type ArmorTest = { state: "ok" | "off" | "invalid" | "unreachable" | "error"; message: string };

type Field = { key: string; label: string; required?: boolean; secret?: boolean; placeholder?: string; description?: string; helpUrl?: string; default?: string };

type Install = { type?: "http"; url?: string; command?: string; args?: (string | string[])[]; runtime?: string; env?: Record<string, string>; headers?: Record<string, string> };

/** A server from the curated catalog (verified) or the public MCP Registry (not reviewed). */
export type ServerEntry = {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  publisher?: string;
  icon?: string;
  homepage?: string;
  verified?: boolean;
  installable?: boolean;
  reason?: string;
  registryName?: string;
  version?: string;
  install?: Install;
  fields?: Field[];
};

type Runtime = { label: string; binary: string; installUrl?: string };

export type Catalog = { categories: string[]; entries: ServerEntry[]; runtimes: Record<string, boolean>; runtimeInfo: Record<string, Runtime> };

/** A saved server config (settings file), as the main process sanitised it. */
export type ServerConfig = {
  type?: "http";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  source?: "catalog" | "registry" | "custom";
  catalogId?: string;
  registryName?: string;
  displayName?: string;
};

export type TestResult = { ok: boolean; tools?: string[]; error?: string };

export type SearchResult = { ok: boolean; servers?: ServerEntry[]; nextCursor?: string | null; error?: string };

type Bridge = {
  post: (m: BusMsg) => void;
  on: (fn: (m: BusMsg) => void) => () => void;
  onDeskCrew: (fn: (id: CrewId) => void) => () => void;
  setInteractive: (on: boolean) => void;
  openDesk: (id: CrewId, anchor?: { x: number; y: number }) => void;
  deskMode: (m: DeskMode) => void;
  closeDesk: () => void;
  pinDesk: (on: boolean) => void;
  openHome: () => void;
  chatSend: (id: CrewId, text: string, images: { mimeType: string; data: string }[]) => void;
  decide: (planId: string, ok: boolean) => void;
  stop: (id: CrewId) => void;
  overview: () => Promise<Overview>;
  setProvider: (id: CrewId, key: string) => Promise<boolean>;
  localDetect: () => Promise<LocalStatus>;
  localAdd: (model: string) => Promise<{ ok: boolean; key?: string; error?: string }>;
  setKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  openConnectors: () => void;
  // Only answered for Home base (the main process checks the sender)
  settings: {
    providerKeys: () => Promise<Partial<Record<KeyProvider, string>>>;
    setProviderKey: (provider: KeyProvider, key: string) => void;
    elevenLabsKey: () => Promise<string>;
    setElevenLabsKey: (key: string) => void;
    mongodbUri: () => Promise<string>;
    setMongodbUri: (uri: string) => Promise<{ connected: boolean; error?: string; keptPrevious?: boolean }>;
    armorIQKey: () => Promise<string>;
    setArmorIQKey: (key: string) => Promise<boolean>;
    testArmorIQ: () => Promise<ArmorTest | null>;
    security: () => Promise<SecurityOverview | null>;
    secretStorage: () => Promise<{ encrypted: boolean; backend?: string; platform?: string } | null>;
    appInfo: () => Promise<AppInfo>;
  };
  connectors: {
    installed: () => Promise<Record<string, ServerConfig>>;
    catalog: () => Promise<Catalog | null>;
    search: (query: string, cursor?: string) => Promise<SearchResult>;
    install: (request: { catalogId?: string; registryName?: string; version?: string; values: Record<string, string>; force?: boolean }) => Promise<{ ok: boolean; id?: string; tools?: string[]; error?: string; canForce?: boolean }>;
    test: (target: string | ServerConfig) => Promise<TestResult>;
    save: (request: { id: string; config: ServerConfig; previousId?: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
    uninstall: (id: string) => Promise<boolean>;
  };
  onBackend: (fn: (e: { id: CrewId; channel: string; args: unknown[] }) => void) => () => void;
};

declare global {
  interface Window {
    crewBridge?: Bridge;
  }
}

export const bridge = window.crewBridge;
export const isNative = !!bridge;
