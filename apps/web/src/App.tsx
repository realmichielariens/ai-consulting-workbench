// Boot page (P0b — SCAFFOLD). Proves the web app can reach the placeholder
// server over HTTP and WebSocket. W6 replaces this with the start page
// (J1.1) and the rest of the UI; only import from "@workbench/core" here
// (the browser-safe entry), never "@workbench/core/node".

import { useEffect, useState } from "react";
import { buildPath, routes, WS_PATH, WsServerMessage } from "@workbench/core";

type HealthState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; runtime: "real" | "fake" };

type WsState = { status: "connecting" } | { status: "error" } | { status: "open"; lastSeq: number };

function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(routes.health.path)
      .then(async (res) => {
        const body: unknown = await res.json();
        const parsed = routes.health.response.parse(body);
        if (!cancelled) setState({ status: "ok", runtime: parsed.runtime });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function useBootSocket(): WsState {
  const [state, setState] = useState<WsState>({ status: "connecting" });

  useEffect(() => {
    const path = buildPath(WS_PATH, { eid: "boot" });
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${window.location.host}${path}`);

    socket.onmessage = (event: MessageEvent<string>) => {
      const parsed: unknown = JSON.parse(event.data);
      const message = WsServerMessage.parse(parsed);
      if (message.type === "hello") setState({ status: "open", lastSeq: message.lastSeq });
    };
    socket.onerror = () => setState({ status: "error" });

    return () => socket.close();
  }, []);

  return state;
}

export function App() {
  const health = useHealth();
  const ws = useBootSocket();

  const connected = health.status === "ok" && ws.status === "open";

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Agentic Project Workbench</h1>
      {connected && health.status === "ok" ? (
        <p data-testid="boot-status">server connected (WS) — runtime: {health.runtime}</p>
      ) : (
        <p data-testid="boot-status">
          {health.status === "error" ? `server error: ${health.message}` : `connecting… (health: ${health.status}, ws: ${ws.status})`}
        </p>
      )}
    </main>
  );
}
