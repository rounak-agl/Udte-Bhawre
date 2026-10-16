import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "crew-theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");
let pref: ThemePref = (localStorage.getItem(KEY) as ThemePref) || "system";
const subs = new Set<() => void>();

function apply() {
  const dark = pref === "dark" || (pref === "system" && mq.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  subs.forEach((f) => f());
}

mq.addEventListener("change", apply);
apply();

export function setTheme(p: ThemePref) {
  pref = p;
  localStorage.setItem(KEY, p);
  apply();
}

export function useTheme() {
  const resolved = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => document.documentElement.dataset.theme as "light" | "dark",
  );
  return { pref, resolved };
}
