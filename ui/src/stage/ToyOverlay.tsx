import type { CSSProperties } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { CellLoader } from "../components/ui";
import type { Crew, ToyState } from "../crew/roster";
import "./stage.css";

type Props = { crew: Crew; state: ToyState; peek: string | null; onOpen: () => void; onDismissPeek: () => void; small?: boolean };

export function ToyOverlay({ crew, state, peek, onOpen, onDismissPeek, small }: Props) {
  const style = { "--c": crew.color } as CSSProperties;
  return (
    <div className="toy-ov" style={style}>
      {state === "needs-you" && (
        <button type="button" className="badge-need" onClick={onOpen}>
          <span className="badge-need__dot" />
          Needs you
        </button>
      )}
      {(state === "thinking" || state === "working") && (
        <span className="toy-ov__loader">
          <CellLoader size={small ? 3 : 4} color={crew.color} label={state === "thinking" ? `${crew.name} is thinking` : `${crew.name} is working`} />
        </span>
      )}
      {state === "sleeping" && (
        <span className="zzz pixel" aria-label={`${crew.name} is asleep`}>
          <span>z</span>
          <span>z</span>
          <span>Z</span>
        </span>
      )}
      {peek && state !== "needs-you" && (
        <div className={`peek ${state === "oops" ? "is-oops" : ""}`} role="status">
          <span className="peek__who eyebrow">{crew.name}</span>
          <p className="peek__text">{peek}</p>
          <span className="peek__actions">
            <button type="button" className="peek__open" onClick={onOpen}>
              Open
              <ArrowUpRight />
            </button>
            <button type="button" className="peek__x" aria-label="Dismiss" onClick={onDismissPeek}>
              <X />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
