// Tiny URL-state module (no router dependency, per the W6 brief): "/" is the
// start page, "/e/:eid" is an engagement, and selection lives in query params
// (?item=, ?asset=&v=, ?run=) so every state is deep-linkable for W7's
// Playwright tests. Built on the History API + useSyncExternalStore.

import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    for (const l of listeners) l();
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return window.location.pathname + window.location.search;
}

function notify(): void {
  for (const l of listeners) l();
}

export function navigate(path: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  notify();
}

export interface AssetSelection {
  itemId: string;
  slot: string;
  version: string | null;
}

export interface ParsedRoute {
  view: "start" | "engagement";
  eid: string | null;
  item: string | null;
  asset: AssetSelection | null;
  run: string | null;
}

export function parseUrl(full: string): ParsedRoute {
  const qIdx = full.indexOf("?");
  const pathname = qIdx === -1 ? full : full.slice(0, qIdx);
  const search = qIdx === -1 ? "" : full.slice(qIdx);
  const params = new URLSearchParams(search);
  const m = /^\/e\/([^/]+)/.exec(pathname);
  const eid = m ? decodeURIComponent(m[1]!) : null;
  const item = params.get("item");
  const assetParam = params.get("asset");
  let asset: AssetSelection | null = null;
  if (assetParam) {
    const i = assetParam.indexOf("/");
    if (i > 0) asset = { itemId: assetParam.slice(0, i), slot: assetParam.slice(i + 1), version: params.get("v") };
  }
  return { view: eid ? "engagement" : "start", eid, item, asset, run: params.get("run") };
}

/** Re-renders whenever the URL changes (back/forward, or any navigate()/select*() call). */
export function useRoute(): ParsedRoute {
  const full = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return parseUrl(full);
}

function setSelection(patch: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  navigate(url.pathname + url.search);
}

export function goHome(): void {
  navigate("/");
}

export function openEngagement(eid: string): void {
  navigate(`/e/${encodeURIComponent(eid)}`);
}

/** Selecting an item clears any asset selection (the detail panel shows one thing at a time). */
export function selectItem(itemId: string | null): void {
  setSelection({ item: itemId, asset: null, v: null });
}

export function selectAsset(itemId: string, slot: string, version?: string | null): void {
  setSelection({ asset: `${itemId}/${slot}`, v: version ?? null, item: null });
}

export function selectRun(runId: string | null): void {
  setSelection({ run: runId });
}

export function clearSelection(): void {
  setSelection({ item: null, asset: null, v: null });
}
