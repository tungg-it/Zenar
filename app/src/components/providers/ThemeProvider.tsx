import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { applyCssVars, type ResolvedTheme, type ThemeMode } from "@/libs/theme";

const STORAGE_KEY = "zenar.theme";

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;

type ThemeState = {
  /** What the person picked (persisted per machine). */
  mode: ThemeMode;
  /** What is actually shown: `system` resolved against the OS setting. */
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

/** Light / Dark / System mode: remembered in localStorage, follows the OS when `system`. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [isSystemDark, setSystemDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const resolved: ResolvedTheme = mode === "system" ? (isSystemDark ? "dark" : "light") : mode;

  useLayoutEffect(() => applyCssVars(resolved), [resolved]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  };

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

/** Current theme mode and setter; must be used inside ThemeProvider. */
export function useTheme(): ThemeState {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("useTheme must be used inside ThemeProvider");
  return t;
}
