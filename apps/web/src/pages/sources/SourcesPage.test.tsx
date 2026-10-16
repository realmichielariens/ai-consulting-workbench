// Your own MCP servers on the Source Catalog page: add a stdio server, see a
// literal secret refused inline, test the connection and copy its tools into
// the usage notes, and delete only after an in-page confirm that lists the
// tasks using it. Curated listings stay read-only.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SourceCatalogEntry } from "@workbench/core";

const { api } = vi.hoisted(() => ({
  api: {
    listSources: vi.fn(),
    getSource: vi.fn(),
    createSource: vi.fn(),
    updateSource: vi.fn(),
    deleteSource: vi.fn(),
    testSource: vi.fn(),
  },
}));

vi.mock("../../api/index.js", async () => {
  const { qk } = await vi.importActual<typeof import("../../api/queryKeys.js")>("../../api/queryKeys.js");
  return { api, qk };
});

import { SourcesPage } from "./SourcesPage.js";

const curated: SourceCatalogEntry = {
  id: "open-web",
  title: "Open Web",
  publisher: "Public internet",
  kind: "web",
  summary: "Search the public web.",
  description: "",
  freshness: "live",
  offer: { tier: "free", label: "Free" },
  usage: "",
  connectionType: "builtin-web",
  origin: "catalog",
  usedBy: [],
};

const mine: SourceCatalogEntry = {
  id: "crm-notes",
  title: "CRM notes",
  publisher: "You",
  kind: "mcp",
  summary: "Account notes from our CRM.",
  description: "",
  freshness: "live",
  offer: { tier: "free", label: "Your own source" },
  usage: "",
  connectionType: "stdio",
  origin: "user",
  usedBy: [{ itemId: "WI-004" as SourceCatalogEntry["usedBy"][number]["itemId"], title: "Synthesize themes", purpose: "account history" }],
};

const EID = "acme" as Parameters<typeof SourcesPage>[0]["eid"];

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SourcesPage eid={EID} />
    </QueryClientProvider>,
  );
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

async function openAddForm() {
  renderPage();
  fireEvent.click(await screen.findByTestId("source-add"));
  return screen.getByTestId("source-editor");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SourcesPage: your own MCP servers", () => {
  test("curated cards are read-only; your cards carry the Yours badge with edit and delete", async () => {
    api.listSources.mockResolvedValue([curated, mine]);
    renderPage();
    const own = await screen.findByTestId("source-card-crm-notes");
    const cat = screen.getByTestId("source-card-open-web");

    expect(within(own).getByTestId("source-origin-user").textContent).toBe("Yours");
    expect(within(own).getByTestId("source-edit-crm-notes")).toBeTruthy();
    expect(within(cat).queryByTestId("source-origin-user")).toBeNull();
    expect(within(cat).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(cat).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("adds a stdio server with args one per line and env rows", async () => {
    api.listSources.mockResolvedValue([curated]);
    api.createSource.mockResolvedValue({ ...mine, connection: { type: "stdio", command: "node", args: [] } });
    const editor = await openAddForm();

    expect(within(editor).getByTestId("source-stdio-warning").textContent).toContain(
      "A stdio server runs this command on your machine with your user rights.",
    );
    const save = within(editor).getByTestId("source-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing filled in yet

    type("source-title", "CRM notes");
    type("source-summary", "Account notes from our CRM.");
    type("source-command", "node");
    type("source-args", "server.mjs\n\n --verbose ");
    fireEvent.click(screen.getByTestId("source-env-add"));
    fireEvent.change(screen.getByLabelText("Environment 1 name"), { target: { value: "CRM_TOKEN" } });
    fireEvent.change(screen.getByLabelText("Environment 1 value"), { target: { value: "${env:CRM_TOKEN}" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(screen.queryByTestId("source-editor")).toBeNull());
    expect(api.createSource).toHaveBeenCalledWith({
      title: "CRM notes",
      summary: "Account notes from our CRM.",
      description: "",
      usage: "",
      freshness: "live",
      connection: { type: "stdio", command: "node", args: ["server.mjs", "--verbose"], env: { CRM_TOKEN: "${env:CRM_TOKEN}" } },
    });
    await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(2)); // the catalog is refetched
  });

  test("a literal secret refused by the server is shown on its row and the form stays open", async () => {
    api.listSources.mockResolvedValue([]);
    api.createSource.mockRejectedValue(new Error("env.API_KEY looks like a secret; use ${env:NAME} instead"));
    await openAddForm();

    type("source-title", "Leaky");
    type("source-summary", "Has a literal key.");
    type("source-command", "npx");
    fireEvent.click(screen.getByTestId("source-env-add"));
    fireEvent.change(screen.getByLabelText("Environment 1 name"), { target: { value: "API_KEY" } });
    fireEvent.change(screen.getByLabelText("Environment 1 value"), { target: { value: "sk-live-123" } });
    fireEvent.click(screen.getByTestId("source-save"));

    expect((await screen.findByTestId("source-save-error")).textContent).toBe("env.API_KEY looks like a secret; use ${env:NAME} instead");
    const row = screen.getByTestId("source-env-row-0");
    expect(within(row).getByTestId("source-secret-error").textContent).toContain("${env:API_KEY}");
    expect(screen.getByTestId("source-editor")).toBeTruthy();
  });

  test("test connection shows the tools and can add them to the usage notes; a failure shows its error", async () => {
    api.listSources.mockResolvedValue([]);
    api.testSource.mockResolvedValueOnce({
      status: "connected",
      error: null,
      serverInfo: { name: "echo-mcp", version: "0.1.0" },
      tools: [
        { name: "echo", description: "Returns the text it is given." },
        { name: "lookup", description: "Looks up a canned record." },
      ],
      missingSecrets: [],
    });
    await openAddForm();

    fireEvent.click(screen.getByRole("button", { name: "http" }));
    expect(screen.queryByTestId("source-stdio-warning")).toBeNull();
    expect((screen.getByTestId("source-test") as HTMLButtonElement).disabled).toBe(true); // no URL yet
    type("source-url", "https://mcp.example.com/mcp");
    type("source-usage", "Prefer lookup.");
    fireEvent.click(screen.getByTestId("source-test"));

    await waitFor(() => expect(api.testSource).toHaveBeenCalledWith({ connection: { type: "http", url: "https://mcp.example.com/mcp" } }));
    expect((await screen.findByTestId("source-test-status")).textContent).toBe("Connected");
    expect(screen.getByTestId("source-test-tools").textContent).toContain("lookup");

    fireEvent.click(screen.getByTestId("source-append-tools"));
    expect((screen.getByTestId("source-usage") as HTMLTextAreaElement).value).toBe(
      "Prefer lookup.\n\nTools:\n- echo: Returns the text it is given.\n- lookup: Looks up a canned record.",
    );

    api.testSource.mockResolvedValueOnce({ status: "failed", error: "connection refused", serverInfo: null, tools: [], missingSecrets: [] });
    type("source-url", "https://fail.example.com/mcp"); // a connection edit clears the old result
    expect(screen.queryByTestId("source-test-result")).toBeNull();
    fireEvent.click(screen.getByTestId("source-test"));
    expect((await screen.findByTestId("source-test-status")).textContent).toBe("Failed");
    expect(within(screen.getByTestId("source-test-result")).getByRole("alert").textContent).toBe("connection refused");
    expect(screen.queryByTestId("source-test-tools")).toBeNull();
  });

  test("delete asks in the page first, listing the tasks that use the source", async () => {
    api.listSources.mockResolvedValueOnce([curated, mine]).mockResolvedValue([curated]);
    api.deleteSource.mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, "confirm");
    renderPage();

    fireEvent.click(await screen.findByTestId("source-delete-crm-notes"));
    const confirm = screen.getByTestId("source-delete-confirm-crm-notes");
    expect(confirm.textContent).toContain("1 task in this engagement uses it");
    expect(confirm.textContent).toContain("WI-004");
    expect(api.deleteSource).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByTestId("source-delete-confirm-crm-notes")).toBeNull();

    fireEvent.click(screen.getByTestId("source-delete-crm-notes"));
    fireEvent.click(screen.getByTestId("source-delete-confirm-button-crm-notes"));
    await waitFor(() => expect(screen.queryByTestId("source-card-crm-notes")).toBeNull());
    expect(api.deleteSource).toHaveBeenCalledWith("crm-notes");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("edit loads the full listing and saves through updateSource", async () => {
    api.listSources.mockResolvedValue([mine]);
    api.getSource.mockResolvedValue({
      ...mine,
      connection: { type: "stdio", command: "node", args: ["crm.mjs"], env: { CRM_TOKEN: "${env:CRM_TOKEN}" } },
    });
    api.updateSource.mockImplementation(async (_sid: string, body: { title: string }) => ({ ...mine, ...body }));
    renderPage();

    fireEvent.click(await screen.findByTestId("source-edit-crm-notes"));
    expect(await screen.findByDisplayValue("crm.mjs")).toBeTruthy();
    expect((screen.getByLabelText("Environment 1 name") as HTMLInputElement).value).toBe("CRM_TOKEN");
    type("source-title", "CRM notes (EU)");
    fireEvent.click(screen.getByTestId("source-save"));

    await waitFor(() => expect(screen.queryByTestId("source-editor")).toBeNull());
    expect(api.updateSource.mock.calls[0]![0]).toBe("crm-notes");
    expect(api.updateSource.mock.calls[0]![1]).toMatchObject({ title: "CRM notes (EU)", connection: { type: "stdio", args: ["crm.mjs"] } });
  });
});
