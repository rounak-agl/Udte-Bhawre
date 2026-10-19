import { useEffect, useRef } from "react";
import { CellLoader } from "../components/ui";
import { bridge } from "../lib/bridge";

/** A value read from the main process. */
export type Load<T> = { state: "loading" } | { state: "error"; text: string } | { state: "ready"; data: T };

/** Re-read the crew overview so the Crew page follows key changes and installs. */
export const refreshCrew = () => bridge?.post({ type: "action", name: "refresh", id: "bo" });

/** False once the component has unmounted, so late IPC answers are dropped. */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/** A readable message for a failed call. Offline wins over whatever the error said. */
export function failText(err: unknown, fallback: string) {
  if (!navigator.onLine) return "You are offline. Check your connection and try again.";
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "").trim() || fallback;
}

export function Pending({ text }: { text: string }) {
  return (
    <p className="empty-note busy-note">
      <CellLoader size={3} label={text} />
      {text}
    </p>
  );
}

export function Failed({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <p className="cloudkey__msg is-bad fail-note" role="alert">
      {text}
      {onRetry && (
        <button type="button" className="link-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </p>
  );
}
