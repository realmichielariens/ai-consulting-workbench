// UX1 plan §4.3: the Approach rail's open/width state. Width is persisted
// (localStorage, try/catch) and clamped to 320-480px (brief A §Build 5).

import { create } from "zustand";

const WIDTH_KEY = "workbench:rail:width";
export const RAIL_MIN_WIDTH = 320;
export const RAIL_MAX_WIDTH = 480;
const RAIL_DEFAULT_WIDTH = 360;

function clamp(width: number): number {
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, width));
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clamp(n) : RAIL_DEFAULT_WIDTH;
  } catch {
    return RAIL_DEFAULT_WIDTH;
  }
}

interface RailState {
  open: boolean;
  width: number;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
}

export const useRailStore = create<RailState>((set) => ({
  open: true,
  width: loadWidth(),
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setWidth: (width) => {
    const clamped = clamp(width);
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // ignore
    }
    set({ width: clamped });
  },
}));

/**
 * "Discuss" / "Ask about this": open the rail if it is collapsed, then focus
 * the composer. The focus waits a frame because opening the rail mounts it.
 * On the Kick-off and /conversation the composer is in the stage, and the same
 * test id finds it there.
 */
export function focusComposer(): void {
  useRailStore.getState().setOpen(true);
  requestAnimationFrame(() => {
    (document.querySelector('[data-testid="chat-input"]') as HTMLElement | null)?.focus();
  });
}
