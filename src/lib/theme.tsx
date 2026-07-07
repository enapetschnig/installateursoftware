import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

/* =====================================================================
   Theme-System mit drei unabhängigen Achsen:
   - themeMode:   "light" | "dark" | "system"
   - accentTheme: Farbschema (siehe ACCENT_THEMES)
   - eyeCareMode: Augenschonmodus an/aus
   Gespeichert in localStorage (Profil-Sync später leicht ergänzbar).
   ===================================================================== */

export type ThemeMode = "light" | "dark" | "system";
export type Base = "light" | "dark";
export type AccentTheme =
  | "blau" | "rot" | "gruen" | "gold" | "petrol" | "violett" | "graphit" | "orange";

/** Legacy-Typ (Kompatibilität für ältere Aufrufer). */
export type Theme = "light" | "dark" | "warm-light" | "warm-dark";

export const ACCENT_THEMES: { key: AccentTheme; label: string; swatch: string; darkSwatch: string }[] = [
  { key: "blau",    label: "B4Y Blau",        swatch: "#2563EB", darkSwatch: "#60A5FA" },
  { key: "gruen",   label: "Bau Grün",        swatch: "#16A34A", darkSwatch: "#4ADE80" },
  { key: "gold",    label: "Graphit Gold",    swatch: "#B45309", darkSwatch: "#FBBF24" },
  { key: "petrol",  label: "Petrol Türkis",   swatch: "#0F766E", darkSwatch: "#2DD4BF" },
  { key: "violett", label: "Violett",         swatch: "#7C3AED", darkSwatch: "#A78BFA" },
  { key: "rot",     label: "B4Y Classic Rot", swatch: "#EF2F2F", darkSwatch: "#F87171" },
  { key: "graphit", label: "Neutral Graphit", swatch: "#475569", darkSwatch: "#94A3B8" },
  { key: "orange",  label: "Orange",          swatch: "#EA580C", darkSwatch: "#FB923C" },
];

const ACCENT_KEYS = ACCENT_THEMES.map((a) => a.key);

const LS_MODE = "b4y-theme-mode";
const LS_ACCENT = "b4y-accent";
const LS_CARE = "b4y-care";
const LS_COMPACT = "b4y-compact";

type Ctx = {
  // neue API
  themeMode: ThemeMode;
  accentTheme: AccentTheme;
  eyeCareMode: boolean;
  compactMode: boolean; // Kompaktmodus: dichtere Darstellung für kleine Bildschirme/Laptops
  resolvedBase: Base; // tatsächlich aktiver Hell/Dunkel-Modus (System aufgelöst)
  setThemeMode: (m: ThemeMode) => void;
  setAccentTheme: (a: AccentTheme) => void;
  setEyeCareMode: (c: boolean) => void;
  toggleEyeCare: () => void;
  setCompactMode: (c: boolean) => void;
  toggleCompact: () => void;
  // Kompatibilitäts-API (für bestehende Aufrufer)
  base: Base;
  care: boolean;
  theme: Theme;
  setBase: (b: Base) => void;
  setCare: (c: boolean) => void;
  toggleCare: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeCtx = createContext<Ctx>({} as Ctx);

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function initMode(): ThemeMode {
  const m = localStorage.getItem(LS_MODE);
  if (m === "light" || m === "dark" || m === "system") return m;
  // Migration aus altem b4y-base / b4y-theme
  const oldBase = localStorage.getItem("b4y-base");
  if (oldBase === "light" || oldBase === "dark") return oldBase;
  const oldTheme = localStorage.getItem("b4y-theme");
  if (oldTheme === "light" || oldTheme === "warm-light") return "light";
  if (oldTheme === "dark" || oldTheme === "warm-dark" || oldTheme === "warm") return "dark";
  return "system"; // neuer Standard
}

function initAccent(): AccentTheme {
  const a = localStorage.getItem(LS_ACCENT);
  if (a && ACCENT_KEYS.includes(a as AccentTheme)) return a as AccentTheme;
  return "blau"; // neuer Standard
}

function initCare(): boolean {
  const c = localStorage.getItem(LS_CARE);
  if (c === "true") return true;
  if (c === "false") return false;
  const old = localStorage.getItem("b4y-theme");
  return old === "warm" || old === "warm-light" || old === "warm-dark";
}

function initCompact(): boolean {
  return localStorage.getItem(LS_COMPACT) === "true";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initMode);
  const [accentTheme, setAccentThemeState] = useState<AccentTheme>(initAccent);
  const [eyeCareMode, setEyeCareState] = useState<boolean>(initCare);
  const [compactMode, setCompactState] = useState<boolean>(initCompact);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  // Auf OS-Wechsel reagieren, solange "System" aktiv ist
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const resolvedBase: Base = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  // Klassen + data-accent auf <html> anwenden + speichern
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("dark", "warm-light", "warm-dark");
    if (eyeCareMode) {
      if (resolvedBase === "dark") el.classList.add("dark", "warm-dark");
      else el.classList.add("warm-light");
    } else if (resolvedBase === "dark") {
      el.classList.add("dark");
    }
    el.setAttribute("data-accent", accentTheme);
    el.classList.toggle("compact", compactMode);

    localStorage.setItem(LS_MODE, themeMode);
    localStorage.setItem(LS_ACCENT, accentTheme);
    localStorage.setItem(LS_CARE, String(eyeCareMode));
    localStorage.setItem(LS_COMPACT, String(compactMode));
  }, [themeMode, accentTheme, eyeCareMode, compactMode, resolvedBase]);

  const setThemeMode = useCallback((m: ThemeMode) => setThemeModeState(m), []);
  const setAccentTheme = useCallback((a: AccentTheme) => setAccentThemeState(a), []);
  const setEyeCareMode = useCallback((c: boolean) => setEyeCareState(c), []);
  const toggleEyeCare = useCallback(() => setEyeCareState((c) => !c), []);
  const setCompactMode = useCallback((c: boolean) => setCompactState(c), []);
  const toggleCompact = useCallback(() => setCompactState((c) => !c), []);

  // ---- Kompatibilitäts-API ----
  const legacyTheme: Theme = eyeCareMode
    ? resolvedBase === "dark" ? "warm-dark" : "warm-light"
    : resolvedBase;
  const setBase = useCallback((b: Base) => setThemeModeState(b), []);
  const setTheme = useCallback((t: Theme) => {
    setThemeModeState(t === "dark" || t === "warm-dark" ? "dark" : "light");
    setEyeCareState(t === "warm-dark" || t === "warm-light");
  }, []);

  return (
    <ThemeCtx.Provider
      value={{
        themeMode, accentTheme, eyeCareMode, compactMode, resolvedBase,
        setThemeMode, setAccentTheme, setEyeCareMode, toggleEyeCare, setCompactMode, toggleCompact,
        base: resolvedBase, care: eyeCareMode, theme: legacyTheme,
        setBase, setCare: setEyeCareMode, toggleCare: toggleEyeCare, setTheme,
      }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
