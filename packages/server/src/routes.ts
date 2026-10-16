// Fastify wiring for every route in packages/core/src/api.ts, plus the WS
// endpoint. Routes are thin (CLAUDE.md rule 12): parse with the route's own
// Zod schemas, call one service/view function, send the result.

import path from "node:path";
import type { FastifyInstance } from "fastify";
import { routes, WS_PATH, type EngagementId, type WsServerMessage } from "@workbench/core";
import { eventsRepo } from "@workbench/db";
import { listSeeds } from "@workbench/store";
import { postMessage } from "./approachRunner.js";
import { openEngagement, type ServerContext } from "./engagementContext.js";
import { reconcileEngagement } from "./startup.js";
import { approveProposal, getProposalView, listProposalViews, previewProposal, rejectProposal } from "./proposalService.js";
import { ApiHttpError, HTTP_STATUS_FOR, invalid, notFound } from "./errors.js";
import * as services from "./services.js";
import {
  createUserSource,
  deleteUserSource,
  getUserSource,
  listSourcesView,
  testUserSource,
  updateUserSource,
} from "./sourceService.js";
import * as views from "./views.js";

/** Opens (creating the context + reconciling once, lazily) the engagement named in the URL, or 404s. */
function ctxFor(server: ServerContext, eid: EngagementId) {
  const existing = server.engagements.get(eid);
  if (existing) return existing;
  if (!services.listEngagementIds(server).includes(eid)) throw notFound(`no such engagement: ${eid}`);
  const ctx = openEngagement(server, eid);
  reconcileEngagement(ctx);
  return ctx;
}

export function registerRoutes(app: FastifyInstance, server: ServerContext): void {
  app.get(routes.health.path, async () => routes.health.response.parse({ ok: true, runtime: server.runtimeKind, hosted: server.hosted ?? false }));

  app.get(routes.listSeeds.path, async () => listSeeds(path.join(server.repoRoot, "demo", "seeds")));

  app.get(routes.listEngagements.path, async () => {
    return services.listEngagementIds(server).map((id) => {
      const ctx = ctxFor(server, id);
      return views.getEngagementSummaryView(ctx);
    });
  });

  app.post(routes.createEngagement.path, async (req, reply) => {
    const body = routes.createEngagement.body.parse(req.body);
    const summary = await services.createEngagement(server, body.seedId, body.name, body.settings);
    reply.code(201);
    return summary;
  });

  app.get(routes.getEngagement.path, async (req) => {
    const { eid } = routes.getEngagement.params.parse(req.params);
    return views.getEngagementView(ctxFor(server, eid));
  });

  app.delete(routes.deleteEngagement.path, async (req) => {
    const { eid } = routes.deleteEngagement.params.parse(req.params);
    await services.deleteEngagement(server, eid);
    return { ok: true as const };
  });

  app.get(routes.getPlan.path, async (req) => {
    const { eid } = routes.getPlan.params.parse(req.params);
    return views.getPlanView(ctxFor(server, eid));
  });

  app.get(routes.getItem.path, async (req) => {
    const { eid, itemId } = routes.getItem.params.parse(req.params);
    return views.getItemDetailView(ctxFor(server, eid), itemId);
  });

  app.patch(routes.editItem.path, async (req) => {
    const { eid, itemId } = routes.editItem.params.parse(req.params);
    const body = routes.editItem.body.parse(req.body);
    return services.editItem(ctxFor(server, eid), itemId, body.brief, body.acceptance);
  });

  app.post(routes.startItem.path, async (req) => {
    const { eid, itemId } = routes.startItem.params.parse(req.params);
    return services.startItem(ctxFor(server, eid), itemId);
  });

  app.post(routes.stopItem.path, async (req) => {
    const { eid, itemId } = routes.stopItem.params.parse(req.params);
    await services.stopItem(ctxFor(server, eid), itemId);
    return { ok: true as const };
  });

  app.post(routes.resumeItem.path, async (req) => {
    const { eid, itemId } = routes.resumeItem.params.parse(req.params);
    return services.resumeItem(ctxFor(server, eid), itemId);
  });

  app.get(routes.getWorklog.path, async (req) => {
    const { eid, itemId } = routes.getWorklog.params.parse(req.params);
    return views.getWorklogView(ctxFor(server, eid), itemId);
  });

  app.get(routes.getRunActivity.path, async (req) => {
    const { eid, runId } = routes.getRunActivity.params.parse(req.params);
    return views.getRunActivityView(ctxFor(server, eid), runId);
  });

  app.post(routes.uploadOutput.path, async (req) => {
    const { eid, itemId, slot } = routes.uploadOutput.params.parse(req.params);
    const ctx = ctxFor(server, eid);
    const file = await req.file();
    if (!file) throw invalid("expected a multipart file field named \"file\"");
    const bytes = await file.toBuffer();
    return services.uploadOutput(ctx, itemId, slot, file.filename, bytes);
  });

  app.post(routes.markDone.path, async (req) => {
    const { eid, itemId } = routes.markDone.params.parse(req.params);
    return services.markDone(ctxFor(server, eid), itemId);
  });

  app.get(routes.getAssetVersions.path, async (req) => {
    const { eid, itemId, slot } = routes.getAssetVersions.params.parse(req.params);
    return views.getAssetVersionsView(ctxFor(server, eid), itemId, slot);
  });

  app.get(routes.getAssetVersion.path, async (req) => {
    const { eid, itemId, slot, version } = routes.getAssetVersion.params.parse(req.params);
    return views.getAssetContentView(ctxFor(server, eid), itemId, slot, version);
  });

  app.get(routes.getAssetRaw.path, async (req, reply) => {
    const { eid, itemId, slot, version } = routes.getAssetRaw.params.parse(req.params);
    const { bytes, version: v } = views.getAssetRaw(ctxFor(server, eid), itemId, slot, version);
    reply.header("Content-Type", contentTypeFor(v.format));
    reply.header("Content-Disposition", `attachment; filename="${slot}-v${v.version}.${v.format}"`);
    return reply.send(bytes);
  });

  app.get(routes.getInbox.path, async (req) => {
    const { eid } = routes.getInbox.params.parse(req.params);
    return views.getInboxView(ctxFor(server, eid));
  });

  app.post(routes.answerQuestion.path, async (req) => {
    const { eid, rid } = routes.answerQuestion.params.parse(req.params);
    const body = routes.answerQuestion.body.parse(req.body);
    return services.answerQuestion(ctxFor(server, eid), rid, body.mode, body.text);
  });

  app.post(routes.recordVerdict.path, async (req) => {
    const { eid, rid } = routes.recordVerdict.params.parse(req.params);
    const body = routes.recordVerdict.body.parse(req.body);
    return services.recordVerdict(ctxFor(server, eid), rid, body.verdict, body.comments);
  });

  app.post(routes.resolveRunIssue.path, async (req) => {
    const { eid, rid } = routes.resolveRunIssue.params.parse(req.params);
    const body = routes.resolveRunIssue.body.parse(req.body);
    return services.resolveRunIssue(ctxFor(server, eid), rid, body.action);
  });

  app.post(routes.openFolder.path, async (req) => {
    const { eid } = routes.openFolder.params.parse(req.params);
    const body = routes.openFolder.body.parse(req.body);
    return services.openFolder(ctxFor(server, eid), body.itemId);
  });

  app.post(routes.addFeedback.path, async (req) => {
    const { eid } = routes.addFeedback.params.parse(req.params);
    const body = routes.addFeedback.body.parse(req.body);
    services.addFeedback(ctxFor(server, eid), body.note, body.view, body.itemId ?? null);
    return { ok: true as const };
  });

  // I2 — J2.1/J2.6/J2.7: the conversation
  app.get(routes.listThreads.path, async (req) => {
    const { eid } = routes.listThreads.params.parse(req.params);
    return views.listThreadSummaries(ctxFor(server, eid));
  });

  app.get(routes.getThread.path, async (req) => {
    const { eid, tid } = routes.getThread.params.parse(req.params);
    return views.getThreadView(ctxFor(server, eid), tid);
  });

  app.post(routes.postMessage.path, async (req, reply) => {
    const { eid, tid } = routes.postMessage.params.parse(req.params);
    const body = routes.postMessage.body.parse(req.body);
    const result = await postMessage(ctxFor(server, eid), tid, body.text, body.context);
    reply.code(202);
    return result;
  });

  // I2 — J2.2/J2.5: proposals
  app.get(routes.listProposals.path, async (req) => {
    const { eid } = routes.listProposals.params.parse(req.params);
    return listProposalViews(ctxFor(server, eid));
  });

  app.get(routes.getProposal.path, async (req) => {
    const { eid, pid } = routes.getProposal.params.parse(req.params);
    return getProposalView(ctxFor(server, eid), pid);
  });

  app.get(routes.previewProposal.path, async (req) => {
    const { eid, pid } = routes.previewProposal.params.parse(req.params);
    return previewProposal(ctxFor(server, eid), pid);
  });

  app.post(routes.approveProposal.path, async (req) => {
    const { eid, pid } = routes.approveProposal.params.parse(req.params);
    return approveProposal(ctxFor(server, eid), pid);
  });

  app.post(routes.rejectProposal.path, async (req) => {
    const { eid, pid } = routes.rejectProposal.params.parse(req.params);
    const body = routes.rejectProposal.body.parse(req.body);
    return rejectProposal(ctxFor(server, eid), pid, body.reason);
  });

  // I2 — J2.3: override
  app.post(routes.overrideAnswer.path, async (req) => {
    const { eid, rid } = routes.overrideAnswer.params.parse(req.params);
    const body = routes.overrideAnswer.body.parse(req.body);
    return services.overrideAnswer(ctxFor(server, eid), rid, body.mode, body.text);
  });

  // I2 — FYIs
  app.get(routes.listNotifications.path, async (req) => {
    const { eid } = routes.listNotifications.params.parse(req.params);
    return views.listNotificationsView(ctxFor(server, eid));
  });

  app.post(routes.dismissNotification.path, async (req) => {
    const { eid, nid } = routes.dismissNotification.params.parse(req.params);
    services.dismissNotification(ctxFor(server, eid), nid);
    return { ok: true as const };
  });

  // I2 — J2.8: settings and profile
  app.patch(routes.patchSettings.path, async (req) => {
    const { eid } = routes.patchSettings.params.parse(req.params);
    const body = routes.patchSettings.body.parse(req.body);
    return services.patchSettings(ctxFor(server, eid), body);
  });

  app.get(routes.getProfile.path, async () => services.getProfile(server));

  app.patch(routes.patchProfile.path, async (req) => {
    const body = routes.patchProfile.body.parse(req.body);
    return services.patchProfile(server, body);
  });

  // I2 — D4: approach journal
  app.get(routes.getJournal.path, async (req) => {
    const { eid } = routes.getJournal.params.parse(req.params);
    return views.getJournalView(ctxFor(server, eid));
  });

  app.get(routes.listSources.path, async (req) => {
    const { eid } = routes.listSources.params.parse(req.params);
    return listSourcesView(ctxFor(server, eid));
  });

  // User-defined MCP sources (workspace-wide). /api/sources/test is registered before /:sid so "test" is never read as an id.
  app.post(routes.testSource.path, async (req) => testUserSource(server, routes.testSource.body.parse(req.body)));

  app.post(routes.createSource.path, async (req, reply) => {
    const created = createUserSource(server, routes.createSource.body.parse(req.body));
    reply.code(201);
    return created;
  });

  app.get(routes.getSource.path, async (req) => {
    const { sid } = routes.getSource.params.parse(req.params);
    return getUserSource(server, sid);
  });

  app.patch(routes.updateSource.path, async (req) => {
    const { sid } = routes.updateSource.params.parse(req.params);
    return updateUserSource(server, sid, routes.updateSource.body.parse(req.body));
  });

  app.delete(routes.deleteSource.path, async (req) => {
    const { sid } = routes.deleteSource.params.parse(req.params);
    deleteUserSource(server, sid);
    return { ok: true as const };
  });

  // WebSocket: hello (with lastSeq) then live events + activity.
  app.get(WS_PATH, { websocket: true }, (socket, request) => {
    const { eid } = request.params as { eid: string };
    let ctx;
    try {
      ctx = ctxFor(server, eid);
    } catch {
      socket.close();
      return;
    }
    ctx.wsClients.add(socket);
    const lastSeq = eventsRepo.latestSeq(ctx.dbCtx);
    const hello: WsServerMessage = { type: "hello", engagementId: ctx.id, lastSeq };
    socket.send(JSON.stringify(hello));
    socket.on("close", () => ctx.wsClients.delete(socket));
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof ApiHttpError) {
      reply.code(HTTP_STATUS_FOR[err.code]).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err.name === "ZodError" || err.name === "WorkPortError") {
      reply.code(400).send({ error: { code: "invalid", message: err.message } });
      return;
    }
    req.log.error(err);
    reply.code(500).send({ error: { code: "internal", message: err.message } });
  });
}

function contentTypeFor(format: string): string {
  const map: Record<string, string> = { md: "text/markdown", txt: "text/plain", json: "application/json", pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  return map[format] ?? "application/octet-stream";
}
