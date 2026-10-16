import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeskMode } from "../desk/Desk";

export type Rect = { x: number; y: number; w: number; h: number };

type Props = {
  mode: DeskMode;
  anchor: { x: number; y: number };
  area: { w: number; h: number };
  onMode: (m: DeskMode) => void;
  children: (startDrag: (e: React.PointerEvent) => void) => ReactNode;
};

const MIN = { w: 320, h: 380 };

function preset(mode: DeskMode, anchor: { x: number; y: number }, area: { w: number; h: number }): Rect {
  if (mode === "panel") return { x: area.w - 492, y: 12, w: 480, h: area.h - 120 };
  if (mode === "focus") {
    const w = Math.min(1120, area.w - 80);
    const h = Math.min(760, area.h - 60);
    return { x: (area.w - w) / 2, y: (area.h - h) / 2, w, h };
  }
  const w = 400;
  const h = Math.max(MIN.h, Math.min(560, anchor.y - 28));
  const x = Math.max(12, Math.min(area.w - w - 84, anchor.x - w / 2));
  const y = Math.max(12, anchor.y - h - 16);
  return { x, y, w, h };
}

export function Frame({ mode, anchor, area, onMode, children }: Props) {
  const [r, setR] = useState<Rect>(() => preset(mode, anchor, area));
  const [anim, setAnim] = useState(true);
  const [snap, setSnap] = useState<"left" | "right" | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    setAnim(true);
    setR(preset(mode, anchor, area));
  }, [mode, area.w, area.h]);

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = r;
    dragging.current = true;
    setAnim(false);
    const move = (ev: PointerEvent) => {
      const nx = start.x + ev.clientX - sx;
      const ny = Math.max(0, start.y + ev.clientY - sy);
      setR((cur) => ({ ...cur, x: nx, y: ny }));
      setSnap(ev.clientX > area.w - 24 ? "right" : ev.clientX < 24 ? "left" : null);
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      dragging.current = false;
      const side = ev.clientX > area.w - 24 ? "right" : ev.clientX < 24 ? "left" : null;
      setSnap(null);
      if (side) {
        setAnim(true);
        if (mode === "panel" && side === "right") setR(preset("panel", anchor, area));
        else if (side === "left") setR({ x: 12, y: 12, w: 480, h: area.h - 24 });
        else onMode("panel");
      }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const startResize = (dir: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const s = r;
    setAnim(false);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let { x, y, w, h } = s;
      if (dir.includes("e")) w = Math.max(MIN.w, s.w + dx);
      if (dir.includes("s")) h = Math.max(MIN.h, s.h + dy);
      if (dir.includes("w")) {
        w = Math.max(MIN.w, s.w - dx);
        x = s.x + s.w - w;
      }
      if (dir.includes("n")) {
        h = Math.max(MIN.h, s.h - dy);
        y = s.y + s.h - h;
      }
      setR({ x, y, w, h });
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  return (
    <>
      {snap && <div className={`snap-ghost is-${snap}`} style={{ height: area.h - 24 }} />}
      <div
        className={`frame ${anim ? "is-anim" : ""} frame--${mode}`}
        style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h, transformOrigin: `${anchor.x - r.x}px ${anchor.y - r.y}px` }}
      >
        {children(startDrag)}
        {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => (
          <span key={d} className={`rs rs--${d}`} onPointerDown={startResize(d)} />
        ))}
      </div>
    </>
  );
}
