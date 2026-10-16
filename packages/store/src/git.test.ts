import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { checkpoint, initRepo, log, logStat } from "./git.js";
import { rmDir, tempEngagement } from "./test-helpers.js";

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) rmDir(cleanups.pop()!);
});

function withRepo() {
  const t = tempEngagement("w4-git-test");
  cleanups.push(t.root);
  return t;
}

describe("initRepo", () => {
  test("git init, .gitignore and .gitattributes, autocrlf off locally", async () => {
    const { root } = withRepo();
    await initRepo(root);

    expect(fs.existsSync(path.join(root, ".git"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain(".workbench/runs/");
    expect(fs.readFileSync(path.join(root, ".gitattributes"), "utf8")).toContain("*.db binary");

    const git = simpleGit(root);
    const autocrlf = await git.raw(["config", "--local", "core.autocrlf"]);
    expect(autocrlf.trim()).toBe("false");

    // Never touched global/system config.
    const scope = await git.raw(["config", "--local", "--list"]);
    expect(scope).toContain("core.autocrlf=false");
  });

  test("works on a path with a space and mixed case (Windows)", async () => {
    const { root } = withRepo();
    expect(root).toMatch(/ /);
    await expect(initRepo(root)).resolves.toBeUndefined();
  });
});

describe("checkpoint", () => {
  test("commits the initial files and returns a sha", async () => {
    const { root } = withRepo();
    await initRepo(root);
    const sha = await checkpoint(root, { message: "initial checkpoint", actor: "human" });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("returns null when there is nothing to commit", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, { message: "first", actor: "human" });
    const second = await checkpoint(root, { message: "second, but nothing changed", actor: "human" });
    expect(second).toBeNull();
  });

  test("attributes author to the actor and committer to Workbench, never the caller's global identity", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, { message: "publish interview-guide v1.0", actor: "agent:WI-002" });

    const full = await simpleGit(root).raw(["log", "--format=full", "-1"]);
    expect(full).toContain("Author: agent:WI-002 <agent-WI-002@workbench.local>");
    expect(full).toContain("Commit: Workbench <workbench@workbench.local>");
  });

  test("the actor's ':' is replaced in the synthesized email", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, { message: "publish", actor: "agent:WI-004" });
    const full = await simpleGit(root).raw(["log", "--format=full", "-1"]);
    expect(full).toContain("<agent-WI-004@workbench.local>");
    expect(full).not.toContain("agent:WI-004@workbench.local");
  });

  test("appends Workbench-* trailers to the commit message", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, {
      message: "Create engagement from seed acme-discovery",
      actor: "human",
      trailers: { "Workbench-Event": "EngagementCreated", "Workbench-Run": "R-0001" },
    });

    const full = await simpleGit(root).raw(["log", "--format=%B", "-1"]);
    expect(full).toContain("Create engagement from seed acme-discovery");
    expect(full).toContain("Workbench-Event: EngagementCreated");
    expect(full).toContain("Workbench-Run: R-0001");
  });

  test("beforeCommit runs before `git add -A`, so files it writes are included", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, { message: "initial", actor: "human" });

    let ran = false;
    const sha = await checkpoint(root, {
      message: "with a WAL-checkpoint-like side effect",
      actor: "system",
      beforeCommit: () => {
        ran = true;
        fs.writeFileSync(path.join(root, "state.db"), "fake-db-bytes");
      },
    });

    expect(ran).toBe(true);
    expect(sha).not.toBeNull();
    const show = await simpleGit(root).raw(["show", "--stat", "-1"]);
    expect(show).toContain("state.db");
  });

  test("never depends on any global git identity being configured", async () => {
    const { root } = withRepo();
    await initRepo(root);
    // No global user.name/user.email is set for this process; if checkpoint
    // relied on it, the commit would fail outright rather than misattribute.
    const sha = await checkpoint(root, { message: "no global identity needed", actor: "human" });
    expect(sha).not.toBeNull();
  });
});

describe("log / logStat", () => {
  test("log returns the commits, newest first", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, { message: "first", actor: "human" });
    fs.writeFileSync(path.join(root, "extra.md"), "more content");
    await checkpoint(root, { message: "second", actor: "human" });

    const result = await log(root, 5);
    expect(result.all.map((c) => c.message)).toEqual(["second", "first"]);
  });

  test("logStat includes file stats", async () => {
    const { root } = withRepo();
    await initRepo(root);
    await checkpoint(root, { message: "first", actor: "human" });
    const stat = await logStat(root, 1);
    expect(stat).toContain("first");
    expect(stat).toMatch(/changed/);
  });
});
