import type { CrewId } from "../crew/roster";
import type { DeskMode } from "../desk/Desk";

export type BusMsg =
  | { type: "hello" }
  | { type: "world"; world: unknown }
  | { type: "action"; name: "send"; id: CrewId; text?: string; files?: { name: string; size: string }[] }
  | { type: "action"; name: "decide"; id: CrewId; planId: string; ok: boolean }
  | { type: "action"; name: "summon" | "wake" | "retry"; id: CrewId };

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
};

declare global {
  interface Window {
    crewBridge?: Bridge;
  }
}

export const bridge = window.crewBridge;
export const isNative = !!bridge;
