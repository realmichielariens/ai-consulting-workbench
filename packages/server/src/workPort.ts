// The real WorkPort (ports.ts, ARCHITECTURE.md §8.6 `work` toolset), bound to
// one item + one run. This is the ONLY place agent tool calls turn into file
// writes and DB rows (CLAUDE.md rule 12): publish is server-owned (A7),
// worklog/questions/submissions are validated here, never by the agent.

import path from "node:path";
import fs from "node:fs";
import {
  agentActor,
  nextVersion,
  slotRef as makeSlotRef,
  WorkPortError,
  type AppendWorklogInput,
  type BriefView,
  type ItemId,
  type PublishAssetInput,
  type PublishAssetResult,
  type RaiseQuestionInput,
  type RaiseQuestionResult,
  type ReportProgressInput,
  type RunId,
  type SlotVersionRef,
  type SubmitOutputsInput,
  type SubmitOutputsResult,
  type WorkPort,
} from "@workbench/core";
import { isInside, normalize } from "@workbench/core/node";
import { assetVersionsRepo, consumptionsRepo, itemsRepo, nextRequestId, requestsRepo } from "@workbench/db";
import { appendWorklog, readItemMd, writeVersionFile } from "@workbench/store";
import { checkpointCommit } from "./checkpoint.js";
import { emitEvent, type EngagementContext } from "./engagementContext.js";
import { syncPlanState } from "./scheduler.js";

export function createWorkPortImpl(ctx: EngagementContext, itemId: ItemId, runId: RunId): WorkPort {
  const now = () => new Date().toISOString();

  return {
    itemId,
    runId,

    async getBrief(): Promise<BriefView> {
      const def = readItemMd(ctx.paths.itemMd(itemId));
      const inputRows = itemsRepo.listInputs(ctx.dbCtx, itemId);
      const declaredPins = consumptionsRepo.listByRun(ctx.dbCtx, runId).filter((c) => c.mode === "declared");
      const pinBySlot = new Map(declaredPins.map((p) => [p.slot, p]));

      const descriptionOf = (slot: string): string => {
        const idx = slot.indexOf("/");
        const producer = slot.slice(0, idx) as ItemId;
        const name = slot.slice(idx + 1);
        return itemsRepo.listOutputs(ctx.dbCtx, producer).find((o) => o.slot === name)?.description ?? "";
      };

      const inputs = inputRows.map((row) => {
        const pin = pinBySlot.get(row.slot);
        if (!pin) return { slot: row.slot, required: row.required, description: descriptionOf(row.slot), version: null, path: null };
        const version = assetVersionsRepo.getVersion(ctx.dbCtx, row.slot, pin.major, pin.minor);
        return {
          slot: row.slot,
          required: row.required,
          description: descriptionOf(row.slot),
          version: version ? `${version.major}.${version.minor}` : null,
          path: version ? ctx.paths.versionFile(row.slot, `${version.major}.${version.minor}`, version.format) : null,
        };
      });

      const outputs = def.outputs.map((o) => {
        const slot = makeSlotRef(itemId, o.slot);
        const latest = assetVersionsRepo.latestVersion(ctx.dbCtx, slot);
        return { ...o, latestVersion: latest?.version ?? null };
      });

      const itemRow = itemsRepo.getItem(ctx.dbCtx, itemId);
      const eng = assetVersionsRepo.latestVersion(ctx.dbCtx, "ENG/context");

      return {
        itemId,
        title: def.title,
        brief: def.brief,
        acceptance: def.acceptance,
        inputs,
        outputs,
        gate: itemRow?.gate ?? def.gate,
        workDir: ctx.paths.itemWork(itemId),
        engagementContextPath: eng ? ctx.paths.versionFile("ENG/context", eng.version, eng.format) : null,
      };
    },

    async publishAsset(input: PublishAssetInput): Promise<PublishAssetResult> {
      const def = readItemMd(ctx.paths.itemMd(itemId));
      const outputDef = def.outputs.find((o) => o.slot === input.slot);
      if (!outputDef) {
        throw new WorkPortError("unknown_slot", `"${input.slot}" is not one of ${itemId}'s declared output slots.`);
      }

      const workDir = ctx.paths.itemWork(itemId);
      const absSource = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(workDir, input.sourcePath);
      if (!isInside(absSource, workDir)) {
        throw new WorkPortError("outside_work", `"${input.sourcePath}" is not inside this item's work/ folder.`);
      }
      if (!fs.existsSync(absSource)) {
        throw new WorkPortError("not_found", `"${input.sourcePath}" does not exist in work/.`);
      }

      const slotRef = makeSlotRef(itemId, input.slot);
      const existing = assetVersionsRepo.listVersionParts(ctx.dbCtx, slotRef);
      const version = nextVersion(existing, input.kind);
      const relPath = writeVersionFile(ctx.paths, slotRef, version, outputDef.format, { fromFile: absSource });

      const [major, minor] = version.split(".").map(Number) as [number, number];
      const at = now();
      assetVersionsRepo.insertAssetVersion(ctx.dbCtx, {
        slot: slotRef,
        version,
        major,
        minor,
        kind: existing.length === 0 ? "material" : input.kind,
        author: agentActor(itemId),
        at,
        note: input.note,
        runId,
        path: relPath,
        format: outputDef.format,
      });

      emitEvent(ctx, {
        type: "AssetPublished",
        actor: agentActor(itemId),
        payload: { slot: slotRef, version, kind: input.kind, author: agentActor(itemId), runId },
      });

      syncPlanState(ctx);
      await checkpointCommit(ctx, {
        message: `Publish ${slotRef} v${version}`,
        actor: agentActor(itemId),
        trailers: { "Workbench-Event": "AssetPublished", "Workbench-Run": runId },
      });

      return { slot: slotRef, version, path: relPath };
    },

    async appendWorklog(input: AppendWorklogInput): Promise<void> {
      const at = now();
      appendWorklog(ctx.paths, itemId, { actor: agentActor(itemId), at, entry: input.entry });
      emitEvent(ctx, { type: "WorklogAppended", actor: agentActor(itemId), payload: { itemId, entry: input.entry } });
    },

    async raiseQuestion(input: RaiseQuestionInput): Promise<RaiseQuestionResult> {
      const requestId = nextRequestId(ctx.dbCtx);
      const at = now();
      requestsRepo.createRequest(ctx.dbCtx, {
        id: requestId,
        type: "question",
        from: agentActor(itemId),
        to: "human",
        itemId,
        runId,
        blocking: input.blocking,
        payload: { question: input.question, hypothesis: input.hypothesis, alternatives: input.alternatives },
        createdAt: at,
      });
      emitEvent(ctx, { type: "RequestOpened", actor: agentActor(itemId), payload: { requestId, type: "question", itemId, to: "human" } });

      const instruction = input.blocking
        ? `Recorded ${requestId}. This question is blocking: end your turn now.`
        : `Recorded ${requestId}. Continue working from your hypothesis; end normally when done.`;
      return { requestId, instruction };
    },

    async reportProgress(input: ReportProgressInput): Promise<void> {
      void input; // no state change (ports.ts) — the activity stream already carries it
    },

    async submitOutputs(input: SubmitOutputsInput): Promise<SubmitOutputsResult> {
      const outputRows = itemsRepo.listOutputs(ctx.dbCtx, itemId);
      const required = outputRows.filter((o) => o.required);
      const missing = required.filter((o) => assetVersionsRepo.latestVersion(ctx.dbCtx, o.slotRef) == null).map((o) => o.slot);

      if (missing.length > 0) {
        return {
          accepted: false,
          missing,
          instruction: `Missing required outputs: ${missing.join(", ")}. Publish them, then call submit_outputs again.`,
        };
      }

      const submittedVersions: SlotVersionRef[] = required.map((o) => {
        const v = assetVersionsRepo.latestVersion(ctx.dbCtx, o.slotRef)!;
        return { slot: o.slotRef, version: v.version };
      });
      ctx.pendingReports.set(runId, { report: input, submittedVersions });

      return { accepted: true, missing: [], instruction: "Submitted for review. End your turn now." };
    },
  };
}
