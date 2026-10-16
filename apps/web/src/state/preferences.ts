// UX1 brief A §Build 6: theme, density and dev-strip visibility. Stored in
// localStorage only (not per-engagement settings) and mirrored onto
// data-theme / data-density on <html> so every component picks them up
// through the Exhibit tokens without branching on theme itself (EXHIBIT §3
// rule 5).

import { useEffect } from "react";
import { create } from "zustand";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

const KEY = "workbench:preferences";

interface StoredPreferences {
  theme: Theme;
  density: Density;
  devStrip: boolean;
}

const DEFAULTS: StoredPreferences = { theme: "system", density: "comfortable", devStrip: true };

function load(): StoredPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: StoredPreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

interface PreferencesState extends StoredPreferences {
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
  setDevStrip: (visible: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...load(),
  setTheme: (theme) => {
    const next = { ...get(), theme };
    save(next);
    set({ theme });
  },
  setDensity: (density) => {
    const next = { ...get(), density };
    save(next);
    set({ density });
  },
  setDevStrip: (devStrip) => {
    const next = { ...get(), devStrip };
    save(next);
    set({ devStrip });
  },
}));

/** Mount once (AppShell and the Engagements home) to reflect theme/density onto <html>. */
export function useApplyPreferences(): void {
  const theme = usePreferencesStore((s) => s.theme);
  const density = usePreferencesStore((s) => s.density);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (density === "comfortable") root.removeAttribute("data-density");
    else root.setAttribute("data-density", density);
  }, [density]);
}
