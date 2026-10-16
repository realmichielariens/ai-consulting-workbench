// WS -> React Query cache wiring: "hello" invalidates every query for the
// engagement, "event" invalidates the queries it affects, and "activity"
// appends to the run's activity cache, deduped by idx.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RunActivityView, WsServerMessage } from "@workbench/core";
import { useEngagementSocket } from "./useEngagementSocket.js";
import { qk } from "./queryKeys.js";
import type { WorkbenchApi, WsStatus } from "./types.js";

afterEach(cleanup);

function makeStubApi(): { api: WorkbenchApi; send: (msg: WsServerMessage) => void } {
  let sender: ((msg: WsServerMessage) => void) | null = null;
  const api = {
    connectWs: (_eid: string, onMessage: (msg: WsServerMessage) => void, onStatus: (s: WsStatus) => void) => {
      sender = onMessage;
      onStatus("open");
      return () => {
        sender = null;
      };
    },
  } as unknown as WorkbenchApi;
  return { api, send: (msg) => sender?.(msg) };
}

function Harness({ api, eid }: { api: WorkbenchApi; eid: string }) {
  useEngagementSocket(api, eid);
  return null;
}

describe("useEngagementSocket", () => {
  test('"hello" invalidates every query key that carries this engagement id', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { api, send } = makeStubApi();
    render(
      <QueryClientProvider client={qc}>
        <Harness api={api} eid="acme-discovery" />
      </QueryClientProvider>,
    );

    send({ type: "hello", engagementId: "acme-discovery", lastSeq: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    const predicate = spy.mock.calls[0]![0]?.predicate as unknown as (q: { queryKey: unknown[] }) => boolean;
    expect(predicate({ queryKey: qk.plan("acme-discovery") as unknown as unknown[] })).toBe(true);
    expect(predicate({ queryKey: qk.plan("other-engagement") as unknown as unknown[] })).toBe(false);
  });

  test('"event" ItemStatusChanged invalidates plan, item, inbox and engagement', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { api, send } = makeStubApi();
    render(
      <QueryClientProvider client={qc}>
        <Harness api={api} eid="acme-discovery" />
      </QueryClientProvider>,
    );
    spy.mockClear();

    send({
      type: "event",
      event: { seq: 1, at: "2026-09-23T00:00:00.000Z", actor: "system", engagementId: "acme-discovery", type: "ItemStatusChanged", payload: { itemId: "WI-002", from: "ready", to: "in_progress" } },
    });

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(qk.plan("acme-discovery"));
    expect(keys).toContainEqual(qk.item("acme-discovery", "WI-002"));
    expect(keys).toContainEqual(qk.inbox("acme-discovery"));
    expect(keys).toContainEqual(qk.engagement("acme-discovery"));
  });

  test('"activity" appends to the cached RunActivityView, deduped by idx', () => {
    const qc = new QueryClient();
    const { api, send } = makeStubApi();
    const runId = "R-0001";
    const seed: RunActivityView = {
      run: { id: runId, itemId: "WI-002", sessionId: "s1", reason: "start", outcome: null, model: "claude-haiku-4-5", costUsd: 0, turns: 0, promptHash: null, startedAt: "2026-09-23T00:00:00.000Z", endedAt: null, nudged: false, denials: 0, error: null },
      activity: [{ idx: 0, at: "2026-09-23T00:00:00.000Z", kind: "system", summary: "Run started" }],
    };
    qc.setQueryData(qk.runActivity("acme-discovery", runId), seed);

    render(
      <QueryClientProvider client={qc}>
        <Harness api={api} eid="acme-discovery" />
      </QueryClientProvider>,
    );

    send({ type: "activity", runId, itemId: "WI-002", item: { idx: 1, at: "2026-09-23T00:00:01.000Z", kind: "text", summary: "Thinking" } });
    expect(qc.getQueryData<RunActivityView>(qk.runActivity("acme-discovery", runId))?.activity).toHaveLength(2);

    // A duplicate idx (e.g. a WS re-delivery) must not be appended twice.
    send({ type: "activity", runId, itemId: "WI-002", item: { idx: 1, at: "2026-09-23T00:00:01.000Z", kind: "text", summary: "Thinking" } });
    expect(qc.getQueryData<RunActivityView>(qk.runActivity("acme-discovery", runId))?.activity).toHaveLength(2);
  });

  test('"activity" for a run not yet in the cache is dropped (no crash), not synthesized', () => {
    const qc = new QueryClient();
    const { api, send } = makeStubApi();
    render(
      <QueryClientProvider client={qc}>
        <Harness api={api} eid="acme-discovery" />
      </QueryClientProvider>,
    );
    send({ type: "activity", runId: "R-9999", itemId: "WI-002", item: { idx: 0, at: "2026-09-23T00:00:00.000Z", kind: "system", summary: "x" } });
    expect(qc.getQueryData(qk.runActivity("acme-discovery", "R-9999"))).toBeUndefined();
  });
});
