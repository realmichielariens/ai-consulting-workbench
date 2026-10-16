// UX1 plan §4.3: a single-key shortcut hook, ignored while focus is in an
// input, textarea or a contenteditable region (so typing "a" in the composer
// never triggers "Approve").

import { useEffect } from "react";

export function useShortcut(key: string, handler: () => void, opts?: { when?: boolean }): void {
  const enabled = opts?.when ?? true;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      e.preventDefault();
      handler();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, handler, enabled]);
}
