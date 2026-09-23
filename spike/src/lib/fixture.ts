// Builds the mini engagement tree described in M0-SPIKE-PLAN.md §3.1, in a
// fresh unique temp directory per call, for the read/write-scope
// experiments (S2-S7). Never share one fixture across runs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// spike/src/lib -> spike/fixtures/engagement-template
const TEMPLATE_DIR = path.resolve(__dirname, "..", "..", "fixtures", "engagement-template");

export type FixtureOptions = {
  /** Item IDs to create under items/. Defaults to ["WI-001", "WI-002"]. */
  items?: string[];
};

export type EngagementFixture = {
  /** The unique temp root, e.g. <tmp>/m0-spike-<rand>. Contains eng/ and outside/. */
  root: string;
  /** <root>/eng */
  engRoot: string;
  /** <root>/outside */
  outsideDir: string;
  paths: {
    engContext: string;
    engStakeholders: string;
    itemWork: (id: string) => string;
    itemAssets: (id: string) => string;
    wi002Secret: string;
    wi002Notes: string;
    workbenchState: string;
    outsideSecret: string;
  };
  canaries: {
    work: string;
    state: string;
    outside: string;
  };
  cleanup: () => void;
};

function randomCanary(kind: "WORK" | "STATE" | "OUTSIDE"): string {
  return `CANARY-${kind}-${crypto.randomBytes(4).toString("hex")}`;
}

function readTemplate(name: string): string {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
}

export function createEngagementFixture(opts: FixtureOptions = {}): EngagementFixture {
  const items = opts.items ?? ["WI-001", "WI-002"];
  if (!items.includes("WI-002")) {
    throw new Error(
      "createEngagementFixture: WI-002 is required (it carries the private-work canary)",
    );
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "m0-spike-"));
  const engRoot = path.join(root, "eng");
  const outsideDir = path.join(root, "outside");

  const canaries = {
    work: randomCanary("WORK"),
    state: randomCanary("STATE"),
    outside: randomCanary("OUTSIDE"),
  };

  // items/ENG/assets/{context,stakeholders}/v1.0.md
  const engContextDir = path.join(engRoot, "items", "ENG", "assets", "context");
  const engStakeholdersDir = path.join(engRoot, "items", "ENG", "assets", "stakeholders");
  fs.mkdirSync(engContextDir, { recursive: true });
  fs.mkdirSync(engStakeholdersDir, { recursive: true });
  const engContext = path.join(engContextDir, "v1.0.md");
  const engStakeholders = path.join(engStakeholdersDir, "v1.0.md");
  fs.writeFileSync(engContext, readTemplate("context.md"), "utf8");
  fs.writeFileSync(engStakeholders, readTemplate("stakeholders.md"), "utf8");

  // items/<id>/work/ and items/<id>/assets/ for every item
  for (const id of items) {
    fs.mkdirSync(path.join(engRoot, "items", id, "work"), { recursive: true });
    fs.mkdirSync(path.join(engRoot, "items", id, "assets"), { recursive: true });
  }

  // items/WI-002/work/secret.md (CANARY-WORK)
  const wi002Secret = path.join(engRoot, "items", "WI-002", "work", "secret.md");
  fs.writeFileSync(
    wi002Secret,
    `# WI-002 private working note\n\nDo not share outside this item. ${canaries.work}\n`,
    "utf8",
  );

  // items/WI-002/assets/notes/v1.0.md (project-scope asset, readable)
  const wi002NotesDir = path.join(engRoot, "items", "WI-002", "assets", "notes");
  fs.mkdirSync(wi002NotesDir, { recursive: true });
  const wi002Notes = path.join(wi002NotesDir, "v1.0.md");
  fs.writeFileSync(wi002Notes, readTemplate("wi-002-notes.md"), "utf8");

  // .workbench/state.txt (CANARY-STATE)
  const workbenchDir = path.join(engRoot, ".workbench");
  fs.mkdirSync(workbenchDir, { recursive: true });
  const workbenchState = path.join(workbenchDir, "state.txt");
  fs.writeFileSync(
    workbenchState,
    `internal-engine-state: do-not-read\n${canaries.state}\n`,
    "utf8",
  );

  // ../outside/secret.txt (CANARY-OUTSIDE, sibling of eng/)
  fs.mkdirSync(outsideDir, { recursive: true });
  const outsideSecret = path.join(outsideDir, "secret.txt");
  fs.writeFileSync(
    outsideSecret,
    `This file is outside the engagement root entirely. ${canaries.outside}\n`,
    "utf8",
  );

  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
  };

  return {
    root,
    engRoot,
    outsideDir,
    paths: {
      engContext,
      engStakeholders,
      itemWork: (id: string) => path.join(engRoot, "items", id, "work"),
      itemAssets: (id: string) => path.join(engRoot, "items", id, "assets"),
      wi002Secret,
      wi002Notes,
      workbenchState,
      outsideSecret,
    },
    canaries,
    cleanup,
  };
}
