import type { CrewId } from "./roster";

const BODY: Record<CrewId, string> = {
  bo: "M6 14 L8 6 L11 11 L13 4 L16 10 L19 4 L21 11 L24 6 L26 14 Q27 28 16 28 Q5 28 6 14 Z",
  pim: "M9 12 Q9 4 16 4 Q23 4 23 12 L23 22 Q23 29 16 29 Q9 29 9 22 Z",
  tuck: "M6 11 Q6 8 9 8 L23 8 Q26 8 26 11 L26 24 Q26 28 22 28 L10 28 Q6 28 6 24 Z",
  zip: "M8 6 Q8 3 11 3 Q14 3 14 6 L14 11 Q16 10.5 18 10.5 Q27 10.5 27 19.5 Q27 28 17.5 28 Q8 28 8 19.5 Z",
  penny: "M16 7 Q27 7 27 18 Q27 28 16 28 Q5 28 5 18 Q5 7 16 7 Z",
};

const EYES: Record<CrewId, { y: number; dx: number; r: number; lid?: boolean; dot?: boolean }> = {
  bo: { y: 18, dx: 4.4, r: 3.2, lid: true },
  pim: { y: 13, dx: 3.4, r: 3 },
  tuck: { y: 17, dx: 4.6, r: 1.3, dot: true },
  zip: { y: 17, dx: 3.6, r: 3 },
  penny: { y: 17, dx: 3.2, r: 2.6 },
};

export function CrewFace({ id, size = 28, color, mood = "idle" }: { id: CrewId; size?: number; color: string; mood?: "idle" | "happy" | "sleep" }) {
  const e = EYES[id];
  const cx = id === "zip" ? 17.5 : 16;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden style={{ flex: "none", display: "block" }}>
      <path d={BODY[id]} fill={id === "tuck" ? "#fbfbf8" : color} stroke={id === "tuck" ? "var(--rule)" : "none"} strokeWidth={0.8} />
      {id === "tuck" && <rect x="5" y="6" width="22" height="4" rx="1.6" fill={color} />}
      {id === "penny" && <path d="M7 11 Q16 5 25 11" stroke="#1f9a55" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
      {[-1, 1].map((s) => {
        const x = cx + s * e.dx;
        if (mood === "sleep") return <path key={s} d={`M${x - 2} ${e.y} q2 1.6 4 0`} stroke="#141414" strokeWidth="1.2" fill="none" strokeLinecap="round" />;
        if (mood === "happy") return <path key={s} d={`M${x - 2.2} ${e.y + 0.8} q2.2 -3 4.4 0`} stroke="#141414" strokeWidth="1.4" fill="none" strokeLinecap="round" />;
        if (e.dot) return <circle key={s} cx={x} cy={e.y} r={e.r} fill="#141414" />;
        return (
          <g key={s}>
            <circle cx={x} cy={e.y} r={e.r} fill="#fff" />
            <circle cx={x + 0.3} cy={e.y + 0.4} r={e.r * 0.55} fill="#141414" />
            <circle cx={x + 0.9} cy={e.y - 0.4} r={e.r * 0.16} fill="#fff" />
            {e.lid && <path d={`M${x - e.r - 0.3} ${e.y - 0.2} A ${e.r + 0.3} ${e.r + 0.3} 0 0 1 ${x + e.r + 0.3} ${e.y - 0.2} Z`} fill={color} />}
          </g>
        );
      })}
      {(id === "bo" || id === "tuck") && <ellipse cx="16" cy={id === "bo" ? 22.5 : 21.5} rx="1.9" ry="1.2" fill="#ffb81c" />}
    </svg>
  );
}
