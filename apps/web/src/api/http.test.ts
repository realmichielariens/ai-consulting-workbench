// The HTTP client: response parsing against the route's Zod schema, and
// non-2xx -> ApiRequestError mapping (api.ts's ApiError body).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { httpApi } from "./http.js";
import { ApiRequestError } from "./types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("httpApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("parses a valid response against the route's Zod schema", async () => {
    const summary = { id: "acme-discovery", name: "Acme", createdAt: "2026-09-23T00:00:00.000Z", seedId: "acme-discovery", planVersion: 1, costUsd: 0.12, progress: { done: 2, total: 7 }, inboxCount: 3 };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([summary]));

    const result = await httpApi.listEngagements();
    expect(result).toEqual([summary]);
  });

  test("throws Error and does not silently trust a response that violates the contract", async () => {
    // Missing required "costUsd" field.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ id: "x", name: "X", createdAt: "2026-09-23T00:00:00.000Z", seedId: null, planVersion: 1 }]));

    await expect(httpApi.listEngagements()).rejects.toThrow(/contract drift/);
  });

  test("maps a non-2xx ApiError body to ApiRequestError with its code and message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { code: "not_found", message: "No engagement \"missing\"." } }, 404));

    await expect(httpApi.getEngagement("missing")).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "not_found",
      message: 'No engagement "missing".',
    });
  });

  test("a non-JSON / non-conforming error body still throws ApiRequestError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

    const err = await httpApi.getEngagement("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe("internal");
  });

  test("uploadOutput sends the file as multipart/form-data", async () => {
    const version = { slot: "WI-003/notes-ceo", version: "1.0", major: 1, minor: 0, kind: "minor", author: "human", at: "2026-09-23T00:00:00.000Z", note: "", runId: null, path: "items/WI-003/assets/notes-ceo/v1.0.md", format: "md" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(version));

    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    await httpApi.uploadOutput("acme-discovery", "WI-003", "notes-ceo", file);

    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[1]?.body).toBeInstanceOf(FormData);
  });
});
