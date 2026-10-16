import { useEffect, useState, type CSSProperties } from "react";
import { CREW, type CrewId } from "../crew/roster";
import { CrewFace } from "../crew/CrewFace";
import "./stage.css";

const CORNER_COLORS = ["var(--crew-bo)", "var(--crew-pim)", "var(--crew-tuck)", "var(--crew-zip)"];

type Props = {
  summoned: CrewId[];
  opening: CrewId | null;
  onSummon: (id: CrewId) => void;
  onDismiss: (id: CrewId) => void;
  hint?: string | null;
  lonely?: boolean;
};

export function Portal({ summoned, opening, onSummon, onDismiss, hint, lonely }: Props) {
  const [fan, setFan] = useState(false);
  const [swirl, setSwirl] = useState<string | null>(null);
  useEffect(() => {
    if (!opening) return;
    const c = CREW.find((x) => x.id === opening)!;
    setSwirl(c.color);
    const t = setTimeout(() => setSwirl(null), 1100);
    return () => clearTimeout(t);
  }, [opening]);

  return (
    <div className={`portal ${fan ? "is-fan" : ""} ${swirl ? "is-open" : ""} ${lonely ? "is-lonely" : ""}`} style={{ "--swirl": swirl ?? "var(--crew-bo)" } as CSSProperties}>
      {hint && <span className="portal__hint">{hint}</span>}
      <div className="fan" role="menu" aria-label="Crew" aria-hidden={!fan}>
        {CREW.map((c, i) => {
          const on = summoned.includes(c.id);
          const a = (-90 - 62 + i * 31) * (Math.PI / 180);
          const r = 104;
          return (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              tabIndex={fan ? 0 : -1}
              className={`fan__item ${on ? "is-on" : ""}`}
              style={{ "--x": `${Math.cos(a) * r}px`, "--y": `${Math.sin(a) * r}px`, "--i": i, "--c": c.color } as CSSProperties}
              onClick={() => {
                if (on) onDismiss(c.id);
                else onSummon(c.id);
                setFan(false);
              }}
            >
              <CrewFace id={c.id} color={c.color} size={34} mood={on ? "idle" : "sleep"} />
              <span className="fan__label">
                {c.name}
                <span>{on ? "Send home" : c.role}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="portal__btn" aria-label="Open the portal" aria-expanded={fan} onClick={() => setFan((f) => !f)}>
        <span className="portal__grid">
          {Array.from({ length: 9 }, (_, i) => {
            const corner = [0, 2, 6, 8].indexOf(i);
            return <i key={i} data-i={i} style={{ "--cc": corner >= 0 ? CORNER_COLORS[corner] : "var(--ink)", "--d": `${[0, 1, 2, 5, 8, 7, 6, 3, 4].indexOf(i) * 30}ms` } as CSSProperties} />;
          })}
        </span>
      </button>
    </div>
  );
}
