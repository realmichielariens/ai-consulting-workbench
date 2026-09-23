// Runs in a SEPARATE node process (spawned via `npx tsx` from
// resume-new-process.ts or streaming.ts) to resume an existing session by
// id. This is THE critical piece of evidence for S5 step 2 ("restart"):
// proof that `resume: sessionId` works from a brand-new process, not just
// a second query() call in the same process.
//
// Reads its payload from a JSON file at argv[2] and writes its JSON result
// to payload.outPath, so the parent never has to parse this process's
// stdout (tsx/node can print unrelated noise there).

import fs from "node:fs";
import { runQuery } from "../../src/lib/run.js";
import { childEnv } from "../../src/lib/env.js";
import { makeRaiseQuestionServer } from "./shared.js";

type Payload = {
  exp: string;
  label: string;
  sessionId: string;
  prompt: string;
  cwd: string;
  outPath: string;
  /** null = unset CLAUDE_CONFIG_DIR entirely (fall back to the real default ~/.claude location); a string = override; omitted = use the harness default. */
  configDirOverride?: string | null;
  forkSession?: boolean;
  timeoutMs?: number;
};

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("resume-child: missing payload path (argv[2])");
    process.exit(2);
  }
  const payload: Payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

  const { server, sink } = makeRaiseQuestionServer();

  let envOverride: Record<string, string | undefined> | undefined;
  if (payload.configDirOverride === null) {
    envOverride = { CLAUDE_CONFIG_DIR: undefined };
  } else if (typeof payload.configDirOverride === "string") {
    envOverride = { CLAUDE_CONFIG_DIR: payload.configDirOverride };
  }

  let result: Awaited<ReturnType<typeof runQuery>> | undefined;
  let threw: string | undefined;
  try {
    result = await runQuery({
      exp: payload.exp,
      label: payload.label,
      prompt: payload.prompt,
      options: {
        resume: payload.sessionId,
        forkSession: payload.forkSession,
        cwd: payload.cwd,
        settingSources: [],
        tools: ["Read", "Write", "Edit", "Glob", "Grep"],
        allowedTools: ["Read", "mcp__s5__raise_question", "Edit(./**)"],
        disallowedTools: ["Bash"],
        permissionMode: "dontAsk",
        mcpServers: { s5: server },
        env: childEnv(envOverride),
      },
      timeoutMs: payload.timeoutMs ?? 120_000,
    });
  } catch (err) {
    threw = String((err as Error)?.message ?? err);
  }

  const output = {
    ok: !threw,
    threw,
    childPid: process.pid,
    parentSessionIdRequested: payload.sessionId,
    sessionId: result?.sessionId,
    isError: result?.isError,
    subtype: result?.subtype,
    resultText: result?.resultText,
    costUsd: result?.costUsd,
    turns: result?.turns,
    usage: result?.usage,
    toolCallNames: result?.toolCalls?.map((t) => t.name),
    raisedQuestions: sink,
    transcriptPath: result?.transcriptPath,
    timedOut: result?.timedOut,
  };
  fs.writeFileSync(payload.outPath, JSON.stringify(output, null, 2), "utf8");
  process.exit(0);
}

main().catch((err) => {
  console.error("resume-child: fatal", err);
  process.exit(3);
});
