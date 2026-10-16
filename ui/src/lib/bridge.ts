import type { CrewId } from "../crew/roster";
import type { DeskMode } from "../desk/Desk";
import type { Attachment } from "../sim/types";

export type BusMsg =
  | { type: "hello" }
  | { type: "world"; world: unknown }
  | { type: "action"; name: "send"; id: CrewId; text?: string; files?: Attachment[] }
  | { type: "action"; name: "stop"; id: CrewId }
  | { type: "action"; name: "brain"; id: CrewId; key: string }
  | { type: "action"; name: "decide"; id: CrewId; planId: string; ok: boolean }
  | { type: "action"; name: "summon" | "wake" | "retry" | "refresh"; id: CrewId };

export type LocalStatus = { running: boolean; error?: string; models: { name: string; size: number }[]; added: { id: string; model: string; name: string }[] };

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
  overview: () => Promise<{ providers: { key: string; name: string; kind: "local" | "cloud"; supportsImages?: boolean }[]; assigned: Partial<Record<CrewId, { key: string; name: string; kind: "local" | "cloud" } | null>>; hasGeminiKey: boolean }>;
  setProvider: (id: CrewId, key: string) => Promise<boolean>;
  localDetect: () => Promise<LocalStatus>;
  localAdd: (model: string) => Promise<{ ok: boolean; key?: string; error?: string }>;
  setKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onBackend: (fn: (e: { id: CrewId; channel: string; args: unknown[] }) => void) => () => void;
};

declare global {
  interface Window {
    crewBridge?: Bridge;
  }
}

export const bridge = window.crewBridge;
export const isNative = !!bridge;
