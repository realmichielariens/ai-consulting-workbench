// Example of a component test in this package (per the boot page P0b built).
// Real coverage of the process view, inbox, etc. is W6's job.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {}
  close(): void {}
  send(): void {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Never resolves: keeps the health check in "loading" so the boot status
  // stays deterministic for this smoke test (no real server running here).
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  test("renders the heading and an initial boot status", () => {
    render(<App />);
    expect(screen.getByText("Agentic Project Workbench")).toBeTruthy();
    expect(screen.getByTestId("boot-status").textContent).toMatch(/connecting/);
  });
});
