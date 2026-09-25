// UX1 §4.3: path-based routing for an open engagement. The old query-param
// URLs (?item=, ?asset=, ?run=) are only redirected (useLegacyRedirect).
//
// navigate() dispatches a real "popstate" event after pushState/replaceState,
// so every useSyncExternalStore subscriber re-reads the location.

import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseSlotRef, slotRef as buildSlotRef, type StageContext } from "@workbench/core";
import { api, qk } from "../api/index.js";

export type PlanViewMode = "canvas" | "tracker";
export type ItemTab = "activity" | "worklog" | "runs" | "requests";

export type StageRoute =
  | { page: "none" }
  | { page: "home"; eid: string }
  | { page: "plan"; eid: string; view: PlanViewMode; sel: string | null; preview: string | null }
  | { page: "documents"; eid: string }
  | { page: "item"; eid: string; itemId: string; tab: ItemTab; run: string | null }
  | { page: "doc"; eid: string; itemId: string; slot: string; version: string | null }
  | { page: "journal"; eid: string }
  | { page: "conversation"; eid: string };

const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    for (const l of listeners) l();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return window.location.pathname + window.location.search;
}

/** Pushes (or replaces) history, then fires a real popstate so every listener updates. */
function navigate(path: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Pure parse, exported for the unit tests (round trips with the open* builders). */
export function parseStageRoute(full: string): StageRoute {
  const qIdx = full.indexOf("?");
  const pathname = qIdx === -1 ? full : full.slice(0, qIdx);
  const search = qIdx === -1 ? "" : full.slice(qIdx);
  const params = new URLSearchParams(search);
  const segs = pathname.split("/").filter(Boolean);

  if (segs[0] !== "e" || !segs[1]) return { page: "none" };
  const eid = decodeURIComponent(segs[1]);
  const rest = segs.slice(2);

  if (rest.length === 0) return { page: "home", eid };

  switch (rest[0]) {
    case "plan": {
      const view: PlanViewMode = params.get("view") === "tracker" ? "tracker" : "canvas";
      return { page: "plan", eid, view, sel: params.get("sel"), preview: params.get("preview") };
    }
    case "documents":
      return { page: "documents", eid };
    case "item": {
      if (!rest[1]) return { page: "home", eid };
      const tabParam = params.get("tab");
      const tab: ItemTab = tabParam === "worklog" || tabParam === "runs" || tabParam === "requests" ? tabParam : "activity";
      return { page: "item", eid, itemId: decodeURIComponent(rest[1]), tab, run: params.get("run") };
    }
    case "doc": {
      if (!rest[1] || !rest[2]) return { page: "home", eid };
      return {
        page: "doc",
        eid,
        itemId: decodeURIComponent(rest[1]),
        slot: decodeURIComponent(rest[2]),
        version: rest[3] ? decodeURIComponent(rest[3]) : null,
      };
    }
    case "journal":
      return { page: "journal", eid };
    case "conversation":
      return { page: "conversation", eid };
    default:
      return { page: "home", eid };
  }
}

export function openHome(eid: string): void {
  navigate(`/e/${encodeURIComponent(eid)}`);
}

export function openPlan(eid: string, opts?: { sel?: string | null; view?: PlanViewMode; preview?: string | null }): void {
  const params = new URLSearchParams();
  if (opts?.view && opts.view !== "canvas") params.set("view", opts.view);
  if (opts?.sel) params.set("sel", opts.sel);
  if (opts?.preview) params.set("preview", opts.preview);
  const qs = params.toString();
  navigate(`/e/${encodeURIComponent(eid)}/plan${qs ? `?${qs}` : ""}`);
}

export function openDocuments(eid: string): void {
  navigate(`/e/${encodeURIComponent(eid)}/documents`);
}

export function openItem(eid: string, itemId: string, opts?: { tab?: ItemTab; run?: string }): void {
  const params = new URLSearchParams();
  if (opts?.tab && opts.tab !== "activity") params.set("tab", opts.tab);
  if (opts?.run) params.set("run", opts.run);
  const qs = params.toString();
  navigate(`/e/${encodeURIComponent(eid)}/item/${encodeURIComponent(itemId)}${qs ? `?${qs}` : ""}`);
}

/** slotRef = "WI-004/themes" (plan §4.3). */
export function openDoc(eid: string, slotRefStr: string, version?: string | null): void {
  const { itemId, slot } = parseSlotRef(slotRefStr);
  const base = `/e/${encodeURIComponent(eid)}/doc/${encodeURIComponent(itemId)}/${encodeURIComponent(slot)}`;
  navigate(version ? `${base}/${encodeURIComponent(version)}` : base);
}

export function openJournal(eid: string): void {
  navigate(`/e/${encodeURIComponent(eid)}/journal`);
}

export function openConversation(eid: string): void {
  navigate(`/e/${encodeURIComponent(eid)}/conversation`);
}

/** Back to the Engagements home ("/"). */
export function backToStart(): void {
  navigate("/");
}

/** Re-renders whenever the URL changes (back/forward, or any openX() call). */
export function useStageRoute(): StageRoute {
  const full = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return parseStageRoute(full);
}

/** Extra: which engagement (if any) we're inside — used by App.tsx to pick AppShell vs the Engagements home. */
export function useEid(): string | null {
  const route = useStageRoute();
  return route.page === "none" ? null : route.eid;
}

/**
 * UX1 C2: what the rail sends with a message. Resolves a readable label
 * ("themes.md 2.0", "WI-004 Consolidate themes") from the cached plan view,
 * so it costs nothing beyond what the page already fetched.
 */
export function useStageContext(): (StageContext & { label: string }) | null {
  const route = useStageRoute();
  const eid = route.page === "none" ? null : route.eid;
  const plan = useQuery({
    queryKey: eid ? qk.plan(eid) : ["plan", "none"],
    queryFn: () => api.getPlan(eid!),
    enabled: eid != null,
  });

  if (!eid) return null;

  if (route.page === "item") {
    const item = plan.data?.items.find((i) => i.id === route.itemId);
    return { kind: "item", ref: route.itemId, label: item ? `${route.itemId} ${item.title}` : route.itemId };
  }

  if (route.page === "doc") {
    const ref = buildSlotRef(route.itemId, route.slot);
    const node = plan.data?.slots.find((s) => s.ref === ref);
    const version = route.version ?? node?.latest?.version ?? undefined;
    const fileLabel = node ? `${node.name}.${node.format}` : route.slot;
    return { kind: "asset", ref, version, label: version ? `${fileLabel} ${version}` : fileLabel };
  }

  if (route.page === "plan" && route.sel) {
    const item = plan.data?.items.find((i) => i.id === route.sel);
    return { kind: "plan", ref: route.sel, label: item ? `${route.sel} ${item.title}` : route.sel };
  }

  if (route.page === "journal") {
    return { kind: "journal", ref: "ENG", label: "Journal" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Legacy redirects (plan §4.3): the pre-UX1 query-param scheme, on the bare
// engagement path only (that's the only shape the old app ever produced).
// ---------------------------------------------------------------------------

export function legacyRedirectPath(full: string): string | null {
  const qIdx = full.indexOf("?");
  const pathname = qIdx === -1 ? full : full.slice(0, qIdx);
  const search = qIdx === -1 ? "" : full.slice(qIdx);
  if (!search) return null;
  const m = /^\/e\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  const eid = m[1]!;
  const params = new URLSearchParams(search);

  const item = params.get("item");
  if (item) return `/e/${eid}/item/${encodeURIComponent(item)}`;

  const asset = params.get("asset");
  if (asset) {
    const i = asset.indexOf("/");
    if (i > 0) {
      const itemId = asset.slice(0, i);
      const slot = asset.slice(i + 1);
      const v = params.get("v");
      return `/e/${eid}/doc/${encodeURIComponent(itemId)}/${encodeURIComponent(slot)}${v ? `/${encodeURIComponent(v)}` : ""}`;
    }
  }

  // `run=R` is resolved by useLegacyRunRedirect below, which has the plan data to find the item.
  return null;
}

/**
 * Runs the plain item/asset legacy redirect on mount/route change, plus the
 * run=R case (needs the plan's items to find which item owns that run).
 * A navigate() during render would mutate external state mid-render, so the
 * actual redirect happens in an effect.
 */
export function useLegacyRedirect(): void {
  const full = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const route = parseStageRoute(full);
  const eid = route.page === "none" ? null : route.eid;
  const isHome = route.page === "home";
  const plan = useQuery({
    queryKey: eid ? qk.plan(eid) : ["plan", "none"],
    queryFn: () => api.getPlan(eid!),
    enabled: eid != null && isHome,
  });

  useEffect(() => {
    if (!isHome || !eid) return;

    const direct = legacyRedirectPath(full);
    if (direct) {
      navigate(direct, { replace: true });
      return;
    }

    const qIdx = full.indexOf("?");
    const search = qIdx === -1 ? "" : full.slice(qIdx);
    const run = new URLSearchParams(search).get("run");
    if (run && plan.data) {
      const owner = plan.data.items.find((i) => i.activeRunId === run);
      if (owner) navigate(`/e/${eid}/item/${encodeURIComponent(owner.id)}`, { replace: true });
    }
  }, [full, isHome, eid, plan.data]);
}
