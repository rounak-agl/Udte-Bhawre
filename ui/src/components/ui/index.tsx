import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import "./ui.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ink" | "line" | "ghost" | "crew";
  size?: "md" | "sm";
  icon?: ReactNode;
  trailing?: ReactNode;
  color?: string;
  label: string;
};

function Roll({ text }: { text: string }) {
  const chars = [...text];
  const row = (hidden: boolean) => (
    <span className="roll__row" aria-hidden={hidden || undefined}>
      {chars.map((c, i) => (
        <span key={i} className="roll__char" style={{ "--i": i } as CSSProperties}>
          {c}
        </span>
      ))}
    </span>
  );
  return (
    <span className="roll">
      {row(false)}
      {row(true)}
    </span>
  );
}

export function Button({ variant = "line", size = "md", icon, trailing, color, label, className, style, disabled, ...rest }: ButtonProps) {
  const cls = ["btn", variant !== "line" && `btn--${variant}`, size === "sm" && "btn--sm", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      style={{ ...(color ? { "--c": color } : null), ...style } as CSSProperties}
      aria-disabled={disabled || undefined}
      {...rest}
    >
      {icon}
      <Roll text={label} />
      {trailing}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tipPos?: "top" | "bottom" };

export function IconButton({ label, active, tipPos, children, ...rest }: IconButtonProps) {
  return (
    <button type="button" className="icon-btn" aria-label={label} data-tip={label} data-tip-pos={tipPos} data-active={active || undefined} {...rest}>
      {children}
    </button>
  );
}

type ChipProps = { children: ReactNode; color?: string; dot?: boolean; selected?: boolean; onClick?: () => void; icon?: ReactNode };

export function Chip({ children, color, dot, selected, onClick, icon }: ChipProps) {
  const style = color ? ({ "--c": color } as CSSProperties) : undefined;
  const inner = (
    <>
      {dot && <span className="chip__dot" />}
      {icon}
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="chip" style={style} data-selected={selected || undefined} aria-pressed={selected} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    <span className="chip" style={style} data-selected={selected || undefined}>
      {inner}
    </span>
  );
}

export type StatusTone = "live" | "waiting" | "done" | "failed" | "attention";

export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`status status--${tone}`} role="status">
      <span className="status__mark" aria-hidden />
      {children}
    </span>
  );
}

const SPIRAL = [0, 1, 2, 5, 8, 7, 6, 3, 4];

export function CellLoader({ color, size = 5, label = "Working" }: { color?: string; size?: number; label?: string }) {
  return (
    <span className="cell-loader" role="img" aria-label={label} style={{ "--c": color, "--cl": `${size}px` } as CSSProperties}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ "--s": SPIRAL.indexOf(i) } as CSSProperties} />
      ))}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

type SegOption<T extends string> = { value: T; label: string; icon?: ReactNode };

export function Segmented<T extends string>({ options, value, onChange, label }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`button[data-v="${value}"]`);
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="seg" ref={ref} role="group" aria-label={label}>
      <span className="seg__thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />
      {options.map((o) => (
        <button key={o.value} type="button" data-v={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
