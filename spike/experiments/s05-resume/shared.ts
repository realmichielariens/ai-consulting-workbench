// Shared helpers for S5 (resume, restart, streaming input). Own minimal
// raise_question tool, independent of S4's toolset (M0-SPIKE-PLAN.md §4 S5
// step 1). Used by run.ts, resume-child.ts, resume-new-process.ts,
// streaming.ts, system-prompt.ts and fork.ts.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";

export type RaisedQuestion = {
  question: string;
  hypothesis: string;
  blocking: boolean;
};

/**
 * Own minimal in-process raise_question(question, hypothesis, blocking)
 * tool. The result text tells the agent to end its turn now, matching the
 * ARCHITECTURE §13.1 "Recorded RQ-17. End your turn." contract.
 */
export function makeRaiseQuestionServer() {
  const sink: RaisedQuestion[] = [];
  const server = createSdkMcpServer({
    name: "s5",
    version: "0.0.0",
    tools: [
      tool(
        "raise_question",
        "Raise a question for a human to answer later (optionally blocking further work), then end your turn.",
        {
          question: z.string().describe("The question to ask"),
          hypothesis: z.string().describe("Your best-guess answer if no one responds"),
          blocking: z.boolean().describe("true if you cannot proceed without an answer"),
        },
        async (args) => {
          sink.push(args);
          return {
            content: [{ type: "text", text: "Question recorded. End your turn now." }],
          };
        },
      ),
    ],
  });
  return { server, sink };
}

const MEMORY_WORDS = [
  "TRUMPET", "GRANITE", "VELVET", "COBALT", "LANTERN",
  "ORCHID", "PIVOT", "ZEPHYR", "QUARTZ", "AMBER",
  "FALCON", "CEDAR", "INDIGO", "MERIDIAN", "SABLE",
];

/** A random "memory word" that appears only in the prompt that mints it. */
export function randMemoryWord(): string {
  const w = MEMORY_WORDS[crypto.randomInt(MEMORY_WORDS.length)];
  const n = crypto.randomInt(1000, 9999);
  return `${w}-${n}`;
}

/**
 * Options shared by every S5 run against the fixture: cwd-relative scoped
 * write rule (`Edit(./**)` — covers Write/Edit since cwd IS the item's
 * work/ dir), an explicit `tools` base set (S0 finding: omitting `tools`
 * pulls in a much broader default surface), dontAsk, no Bash.
 */
export function baseOptions(itemWorkDir: string, mcpServer: ReturnType<typeof createSdkMcpServer>): Partial<Options> {
  return {
    cwd: itemWorkDir,
    settingSources: [],
    tools: ["Read", "Write", "Edit", "Glob", "Grep"],
    allowedTools: ["Read", "mcp__s5__raise_question", "Edit(./**)"],
    disallowedTools: ["Bash"],
    permissionMode: "dontAsk",
    mcpServers: { s5: mcpServer },
  };
}

export function blockingQuestionPrompt(memoryWord: string, topic: string): string {
  return `You are a Work Agent for item WI-001 (${topic}). Your working directory (cwd) is the item's own work/ folder; write only there, using relative paths like "draft.md".

Secret memory word for this session: ${memoryWord}
Remember it silently. Do not write it into any file. You will be asked to recall it later.

Task: draft a short file "draft.md" (3-5 sentences, plain prose) proposing vendor-selection criteria for ${topic}. Use the Write tool to create it now.

After drafting, you realize you are unsure whether the CFO's budget ceiling should be treated as a hard constraint or just a guideline. Call the raise_question tool exactly once, with:
- question: your question about the budget ceiling
- hypothesis: your best guess
- blocking: true

Then STOP. Do not call any more tools after that. Do not write any more files. End your turn immediately after the tool result comes back.`;
}

export function resumeAnswerPrompt(memoryWord: string): string {
  return `Human answer to your question: treat the CFO's budget ceiling as a HARD constraint, not a guideline.

Do exactly two things, in order:
1. Using the Edit tool (not Write), append exactly one new sentence to the END of the existing draft.md that reflects this answer. Do not rewrite or recreate the file from scratch — only append to what is already there.
2. In your final reply text (not in any file), state the secret memory word from earlier, verbatim, prefixed with exactly "MEMORY_WORD_RECALL: ".

Do not call raise_question again. Do not quote draft.md's existing content back to me.`;
}

/**
 * Direct child processes of `parentPid` (Windows, via WMI/CIM), by pid and
 * image name. Used for orphan-process detection scoped to a process WE
 * spawned — a global "any new claude.exe appeared" diff is unusable here
 * because several sibling M0-spike subagents run `claude.exe` processes of
 * their own concurrently on this machine (confirmed while building this
 * experiment: unrelated claude.exe processes parented by unrelated node
 * processes showed up mid-run). Scoping to ParentProcessId sidesteps that.
 */
export function findChildProcesses(parentPid: number): { pid: string; name: string }[] {
  if (process.platform !== "win32") return [];
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | Select-Object -Property ProcessId,Name | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const trimmed = out.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((p: any) => ({ pid: String(p.ProcessId), name: String(p.Name) }));
  } catch {
    return [];
  }
}

/** True if a process with this pid currently exists (Windows). */
export function isProcessAlive(pid: number): boolean {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", `Get-Process -Id ${pid} -ErrorAction Stop | Out-Null`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Recursively finds every live descendant of `rootPid` (Windows), up to a small depth cap. */
export function findDescendantProcesses(rootPid: number, maxDepth = 4): { pid: string; name: string; parentPid: string }[] {
  if (process.platform !== "win32") return [];
  const out: { pid: string; name: string; parentPid: string }[] = [];
  let frontier = [String(rootPid)];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const pid of frontier) {
      const children = findChildProcesses(Number(pid));
      for (const c of children) {
        out.push({ ...c, parentPid: pid });
        next.push(c.pid);
      }
    }
    frontier = next;
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
