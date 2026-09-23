#!/usr/bin/env node
// pnpm demo:headless [--fake] (I1-PLAN.md §6 W5). Starts the server
// in-process on a free port, creates an engagement from acme-discovery, and
// drives the whole I1 script through the real HTTP API with scripted human
// actions (J1.1-J1.6), printing a readable timeline, the final plan, the
// total cost, the engagement path and `git log --oneline`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import type { InboxEntry, PlanView } from "@workbench/core";
import { eventsRepo } from "@workbench/db";
import { createServerContext, type RuntimeKind } from "../engagementContext.js";
import { registerRoutes } from "../routes.js";

const fake = process.argv.includes("--fake");
if (fake) {
  process.env.WORKBENCH_RUNTIME = "fake";
  process.env.WORKBENCH_FAKE_DELAY_MS ??= "0";
}

const TIMEOUT_MS = fake ? 30_000 : 300_000;
const POLL_MS = 150;

async function main(): Promise<void> {
  const runtimeKind: RuntimeKind = process.env.WORKBENCH_RUNTIME === "fake" ? "fake" : "real";
  const server = createServerContext(runtimeKind);

  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(multipart);
  registerRoutes(app, server);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  console.log(`[demo:headless] server listening on ${address} (runtime=${runtimeKind})`);

  const base = address;
  const get = async <T>(url: string): Promise<T> => {
    const res = await fetch(`${base}${url}`);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const post = async <T>(url: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${url}`, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };

  const log = (msg: string) => console.log(`[demo:headless] ${msg}`);

  // --- J1.1: create the engagement -----------------------------------------
  const summary = await post<{ id: string; name: string }>("/api/engagements", {
    seedId: "acme-discovery",
    name: "Acme Manufacturing — IT Strategy (headless demo)",
  });
  const eid = summary.id;
  log(`created engagement ${eid}`);

  // --- J1.4: wait for WI-002's question, then amend the hypothesis ---------
  const question = await waitFor(() => get<{ entries: InboxEntry[] }>(`/api/engagements/${eid}/inbox`), (inbox) =>
    inbox.entries.find((e): e is Extract<InboxEntry, { kind: "question" }> => e.kind === "question" && e.item.id === "WI-002"),
  );
  if (question.request.type !== "question") throw new Error("expected a question request");
  const questionPayload = question.request.payload;
  log(`WI-002 asked: ${questionPayload.question.slice(0, 100)}...`);
  await post(`/api/engagements/${eid}/requests/${question.request.id}/answer`, {
    mode: "amend",
    text: `${questionPayload.hypothesis} Also flag that a follow-up conversation may be needed once she's had more time in the role.`,
  });
  log("amended the answer to WI-002's question");

  // --- J1.5: review WI-002's output, request changes once, then approve ----
  const review1 = await waitFor(() => get<{ entries: InboxEntry[] }>(`/api/engagements/${eid}/inbox`), (inbox) =>
    inbox.entries.find((e): e is Extract<InboxEntry, { kind: "review" }> => e.kind === "review" && e.item.id === "WI-002"),
  );
  if (review1.request.type !== "gate_request") throw new Error("expected a gate request");
  log(`WI-002 submitted for review (round versions: ${review1.request.payload.submitted.map((v) => v.version).join(", ")})`);
  await post(`/api/engagements/${eid}/requests/${review1.request.id}/verdict`, {
    verdict: "changes_requested",
    comments: "Please tighten the CIO section a bit further before we send this out.",
  });
  log("requested changes on WI-002's interview guide");

  const review2 = await waitFor(
    () => get<{ entries: InboxEntry[] }>(`/api/engagements/${eid}/inbox`),
    (inbox) =>
      inbox.entries.find(
        (e): e is Extract<InboxEntry, { kind: "review" }> =>
          e.kind === "review" && e.item.id === "WI-002" && e.request.id !== review1.request.id,
      ),
  );
  await post(`/api/engagements/${eid}/requests/${review2.request.id}/verdict`, { verdict: "approved", comments: "" });
  log("approved WI-002's interview guide");

  // --- J1.6: perform WI-003 (human item) ------------------------------------
  await waitFor(
    () => get<{ node: { status: string | null } }>(`/api/engagements/${eid}/items/WI-003`),
    (detail) => (detail.node.status === "ready" || detail.node.status === "in_progress" ? detail : undefined),
  );
  const notesDir = path.join(server.repoRoot, "demo", "interview-notes");
  const slots = ["notes-ceo", "notes-cfo", "notes-coo", "notes-cio"];
  for (const slot of slots) {
    const file = path.join(notesDir, `${slot}.md`);
    const bytes = fs.readFileSync(file);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "text/markdown" }), `${slot}.md`);
    const res = await fetch(`${base}/api/engagements/${eid}/items/WI-003/outputs/${slot}`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`upload ${slot} -> ${res.status} ${await res.text()}`);
    log(`uploaded ${slot}`);
  }
  await post(`/api/engagements/${eid}/items/WI-003/done`);
  log("marked WI-003 done");

  // --- J1.5 again: review WI-004, approve -----------------------------------
  const review3 = await waitFor(() => get<{ entries: InboxEntry[] }>(`/api/engagements/${eid}/inbox`), (inbox) =>
    inbox.entries.find((e): e is Extract<InboxEntry, { kind: "review" }> => e.kind === "review" && e.item.id === "WI-004"),
  );
  log("WI-004 submitted for review");
  await post(`/api/engagements/${eid}/requests/${review3.request.id}/verdict`, { verdict: "approved", comments: "" });
  log("approved WI-004's themes");

  await waitFor(
    () => get<{ node: { status: string | null } }>(`/api/engagements/${eid}/items/WI-004`),
    (detail) => (detail.node.status === "done" ? detail : undefined),
  );

  // --- Timeline, final state, cost, disk ------------------------------------
  const ctx = server.engagements.get(eid)!;
  const events = eventsRepo.listSince(ctx.dbCtx, eid, 0);
  console.log("\n[demo:headless] event timeline:");
  for (const e of events) console.log(`  #${e.seq} ${e.type} (${e.actor}) ${JSON.stringify(e.payload).slice(0, 140)}`);

  const plan = await get<PlanView>(`/api/engagements/${eid}/plan`);
  console.log("\n[demo:headless] final plan:");
  for (const item of plan.items.filter((i) => i.kind === "task")) console.log(`  ${item.id} ${item.title}: ${item.status}`);

  const engView = await get<{ costUsd: number; folderPath: string }>(`/api/engagements/${eid}`);
  console.log(`\n[demo:headless] total cost: $${engView.costUsd.toFixed(4)}`);
  console.log(`[demo:headless] engagement path: ${engView.folderPath}`);

  const gitLog = execFileSync("git", ["log", "--oneline"], { cwd: engView.folderPath, encoding: "utf8" });
  console.log("\n[demo:headless] git log --oneline:");
  console.log(gitLog.trimEnd());

  const taskItems = plan.items.filter((i) => i.kind === "task");
  const notDone = taskItems.filter((i) => i.status !== "done");
  if (notDone.length > 0) {
    throw new Error(`expected every agent item done, still: ${notDone.map((i) => `${i.id}=${i.status}`).join(", ")}`);
  }
  console.log("\n[demo:headless] OK — the whole seed completed.");

  for (const c of server.engagements.values()) c.dbCtx.close();
  await app.close();
}

async function waitFor<T, R>(poll: () => Promise<T>, extract: (v: T) => R | undefined): Promise<R> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = extract(await poll());
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${TIMEOUT_MS}ms waiting for a condition`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err: unknown) => {
  console.error("[demo:headless] FAILED:", err);
  process.exit(1);
});
