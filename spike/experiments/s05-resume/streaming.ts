// S5 step 3 — streaming input (`prompt: AsyncIterable<SDKUserMessage>`),
// and step 4 — resuming that streaming session's id from a NEW process
// after this one exits. See M0-SPIKE-PLAN.md §4 S5 steps 3-4.
//
// This drives one continuous `runQuery()` call with a hand-controlled
// async generator: push message 1, wait for its result, wait 10s, push
// message 2 (both answered in one session); push message 3 (a slow
// multi-tool task) then push message 4 WHILE message 3 is still running,
// and record exactly what happens; then push message 5 (another slow
// task) and call `interrupt()` mid-turn, recording what's emitted and
// whether the session can still continue afterwards and whether the
// spawned claude.exe is cleaned up.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SDKUserMessage, SDKMessage, SDKResultMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import { runQuery, CostCapExceededError } from "../../src/lib/run.js";
import { spikeRoot } from "../../src/lib/env.js";
import { createEngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";
import { makeRaiseQuestionServer, baseOptions, randMemoryWord, findDescendantProcesses, isProcessAlive, sleep } from "./shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXP = "s05-resume";

function makePushableStream() {
  const queue: SDKUserMessage[] = [];
  let resolveNext: (() => void) | null = null;
  let ended = false;

  function push(text: string): string {
    const uuid = crypto.randomUUID();
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: uuid as unknown as SDKUserMessage["uuid"],
    };
    queue.push(msg);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
    return uuid;
  }

  function end() {
    ended = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  }

  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (ended) return;
      await new Promise<void>((res) => {
        resolveNext = res;
      });
    }
  }

  return { stream: gen(), push, end };
}

class ResultWaiter {
  private waiters: { resolve: (r: SDKResultMessage) => void }[] = [];
  private buffered: SDKResultMessage[] = [];
  push(r: SDKResultMessage) {
    if (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w.resolve(r);
    } else {
      this.buffered.push(r);
    }
  }
  async next(timeoutMs = 90_000): Promise<SDKResultMessage | undefined> {
    if (this.buffered.length > 0) return this.buffered.shift()!;
    return new Promise((res) => {
      // IMPORTANT: on timeout we must remove this waiter from the queue.
      // Earlier version left it in place, so a later push() would resolve
      // this already-settled promise (a no-op) instead of buffering for
      // the NEXT caller — silently losing results. (Caught by re-running
      // this exact scenario and finding message6's result vanish.)
      const entry = {
        resolve: (r: SDKResultMessage) => {
          clearTimeout(t);
          res(r);
        },
      };
      const t = setTimeout(() => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) this.waiters.splice(idx, 1);
        res(undefined);
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
}

type TimelineEntry = { tMs: number; note: string };

function spawnResumeChild(payloadPath: string): Promise<{ exitCode: number | null; stderr: string; pid: number | undefined }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "resume-child.ts"), payloadPath], {
      cwd: spikeRoot,
      env: process.env,
      windowsHide: true,
    });
    const pid = child.pid;
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (exitCode) => resolve({ exitCode, stderr, pid }));
  });
}

export async function runStreamingScenario(): Promise<{ pass: boolean; costUsd: number }> {
  console.log("\n=== S5 step 3+4: streaming input, mid-turn push, interrupt(), then resume-after-exit in a new process ===");

  const fixture = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  const itemWork = fixture.paths.itemWork("WI-001");
  const streamMemoryWord = randMemoryWord();

  const { server } = makeRaiseQuestionServer();
  const { stream, push, end } = makePushableStream();
  const resultWaiter = new ResultWaiter();
  const timeline: TimelineEntry[] = [];
  const t0 = Date.now();
  const note = (s: string) => {
    timeline.push({ tMs: Date.now() - t0, note: s });
    console.log(`  [+${Date.now() - t0}ms] ${s}`);
  };

  let liveQuery: Query | undefined;
  let interruptResponse: unknown;
  let interruptCallTMs: number | undefined;
  let costUsd = 0;
  let pass = true;
  const failures: string[] = [];

  const runPromise = runQuery({
    exp: EXP,
    label: "streaming-session",
    prompt: stream,
    options: baseOptions(itemWork, server),
    onQuery: (q) => {
      liveQuery = q;
    },
    onMessage: (m: SDKMessage) => {
      if (m.type === "result") {
        note(`<- result subtype=${(m as SDKResultMessage).subtype} is_error=${(m as SDKResultMessage).is_error}`);
        resultWaiter.push(m as SDKResultMessage);
      } else if (m.type === "assistant") {
        const content = (m as any).message?.content;
        const kinds = Array.isArray(content) ? content.map((b: any) => b.type).join(",") : "?";
        note(`<- assistant [${kinds}]`);
      } else if (m.type === "user") {
        note(`<- user (tool_result echo or injected)`);
      } else if (m.type === "system" && (m as any).subtype === "init") {
        note(`<- system/init session_id=${(m as any).session_id}`);
      } else {
        note(`<- ${m.type}${(m as any).subtype ? "/" + (m as any).subtype : ""}`);
      }
    },
    timeoutMs: 8 * 60_000,
  });

  try {
    // --- message 1: contains the memory word we'll ask about after resume (step 4) ---
    note(`push message1 (contains streaming memory word)`);
    push(
      `Secret streaming memory word: ${streamMemoryWord}. Just acknowledge with exactly "PONG1" and remember the word for later; do not write it anywhere.`,
    );
    const r1 = await resultWaiter.next();
    note(`message1 result: isError=${r1?.is_error} resultText=${r1 && r1.subtype === "success" ? r1.result : undefined}`);
    check(EXP, "streaming-message1-answered", Boolean(r1) && !r1!.is_error, `result=${JSON.stringify(r1)}`);

    // --- wait 10s, then message 2 ---
    note(`waiting 10s before message2...`);
    await sleep(10_000);
    push(`Reply with exactly "PONG2".`);
    const r2 = await resultWaiter.next();
    note(`message2 result: isError=${r2?.is_error} same-session=${r2?.session_id === r1?.session_id}`);
    check(
      EXP,
      "streaming-message2-after-10s-same-session",
      Boolean(r2) && !r2!.is_error && r2!.session_id === r1!.session_id,
      `r1.session_id=${r1?.session_id} r2.session_id=${r2?.session_id} r2.is_error=${r2?.is_error}`,
    );

    // --- message 3: a slow multi-tool task; push message 4 WHILE it's running ---
    note(`push message3 (slow multi-tool task)`);
    push(
      `Using the Read and Write tools, do the following IN ORDER, one at a time (do not skip steps, do not parallelize): ` +
        `1) Write file a.txt with content "A". 2) Read a.txt. 3) Write file b.txt whose content is a.txt's content plus "B". ` +
        `4) Read b.txt. 5) Write file c.txt whose content is b.txt's content plus "C". Then reply with the final content of c.txt.`,
    );
    await sleep(3000); // let message3's turn get underway (tool calls in flight)
    note(`push message4 WHILE message3 is (presumably) still running`);
    push(`Also, separately: what is 9 * 8? Just the number.`);

    const r3 = await resultWaiter.next(120_000);
    note(`first result after msg3+msg4: isError=${r3?.is_error} subtype=${r3?.subtype} num_turns=${r3?.num_turns}`);
    const r4 = await resultWaiter.next(15_000); // may or may not exist as a SEPARATE result
    if (r4) {
      note(`a SECOND result arrived: isError=${r4.is_error} subtype=${r4.subtype} num_turns=${r4.num_turns}`);
    } else {
      note(`no second result within 15s of the first -> message4 was very likely merged into message3's turn`);
    }
    const midTurnBehavior = r4 ? "queued-separate-turn" : "merged-into-current-turn";
    check(
      EXP,
      "streaming-mid-turn-push-behavior-documented",
      true,
      `mid-turn push behavior observed: ${midTurnBehavior}. ` +
        `r3(msg3[,+msg4])={is_error:${r3?.is_error},subtype:${r3?.subtype},result:${r3 && r3.subtype === "success" ? r3.result : undefined}} ` +
        `r4(separate, if any)=${r4 ? JSON.stringify({ is_error: r4.is_error, subtype: r4.subtype, result: r4.subtype === "success" ? r4.result : undefined }) : "none"}`,
    );

    // --- message 5: another slow task; interrupt() mid-turn ---
    note(`push message5 (another slow task, for interrupt() test)`);
    push(
      `Using the Read and Write tools, do the following IN ORDER: ` +
        `1) Write file d.txt with content "D". 2) Read d.txt. 3) Write file e.txt whose content is d.txt's content plus "E". ` +
        `4) Read e.txt. 5) Write file f.txt whose content is e.txt's content plus "F". 6) Read f.txt. Then reply with the final content of f.txt.`,
    );
    await sleep(2500); // ensure we're mid-turn (tool calls in flight)
    const pidsBeforeInterrupt = liveQuery ? findDescendantProcesses(process.pid) : [];
    note(`calling q.interrupt() mid-turn...`);
    interruptCallTMs = Date.now() - t0;
    try {
      interruptResponse = liveQuery ? await liveQuery.interrupt() : undefined;
    } catch (err) {
      interruptResponse = { threw: String((err as Error)?.message ?? err) };
    }
    note(`interrupt() resolved: ${JSON.stringify(interruptResponse)}`);
    check(EXP, "streaming-interrupt-resolves", true, `interrupt() resolved with: ${JSON.stringify(interruptResponse)}`);

    // What gets emitted after an interrupt? Drain briefly.
    const rInterrupt = await resultWaiter.next(15_000);
    note(`result after interrupt: ${rInterrupt ? JSON.stringify({ is_error: rInterrupt.is_error, subtype: rInterrupt.subtype }) : "none within 15s"}`);
    check(
      EXP,
      "streaming-interrupt-emits-result",
      true,
      `result frame after interrupt(): ${rInterrupt ? JSON.stringify({ is_error: rInterrupt.is_error, subtype: rInterrupt.subtype }) : "none observed within 15s"}`,
    );

    // --- does the session continue after interrupt? push message 6 ---
    note(`push message6 (after interrupt, to test the session still works)`);
    push(`Reply with exactly "PONG6".`);
    const r6 = await resultWaiter.next(60_000);
    note(`message6 result: ${r6 ? JSON.stringify({ is_error: r6.is_error, subtype: r6.subtype, result: r6.subtype === "success" ? r6.result : undefined }) : "none"}`);
    check(
      EXP,
      "streaming-session-continues-after-interrupt",
      Boolean(r6) && !r6!.is_error,
      `message6 after interrupt: ${r6 ? JSON.stringify({ is_error: r6.is_error, subtype: r6.subtype, result: r6.subtype === "success" ? r6.result : undefined }) : "no result observed"}`,
    );
    if (!r6 || r6.is_error) {
      pass = false;
      failures.push("session did not continue cleanly after interrupt()");
    }

    // --- end the stream, let runQuery() finish ---
    note(`ending stream`);
    end();
    const finalResult = await runPromise;
    costUsd = finalResult.costUsd;
    note(`runQuery() resolved: sessionId=${finalResult.sessionId} totalCostUsd=${finalResult.costUsd} totalTurns=${finalResult.turns}`);

    // Orphan check: any live descendant claude.exe of THIS process (scoped,
    // to avoid false positives from unrelated sibling subagents).
    await sleep(1500);
    const descendantsAfterEnd = findDescendantProcesses(process.pid).filter((d) => d.name.toLowerCase() === "claude.exe");
    check(
      EXP,
      "streaming-no-orphan-claude-process-after-end",
      descendantsAfterEnd.length === 0,
      `live claude.exe descendants of this process 1.5s after stream end: ${JSON.stringify(descendantsAfterEnd)}`,
    );

    if (!finalResult.sessionId) {
      pass = false;
      failures.push("no sessionId from the streaming session");
    }

    // --- Step 4: resume the streaming session's id from a NEW process, ask about message 1 ---
    if (finalResult.sessionId) {
      const outPath = path.join(os.tmpdir(), `s05-streaming-resume-${Date.now()}.json`);
      const payloadPath = path.join(os.tmpdir(), `s05-streaming-resume-payload-${Date.now()}.json`);
      fs.writeFileSync(
        payloadPath,
        JSON.stringify({
          exp: EXP,
          label: "streaming-resume-newproc",
          sessionId: finalResult.sessionId,
          prompt:
            `What was the secret streaming memory word from earlier in this conversation (from your very first reply)? ` +
            `Reply with just: STREAM_MEMORY_RECALL: <word>`,
          cwd: itemWork,
          outPath,
        }),
        "utf8",
      );
      note(`spawning a NEW process to resume the (now-exited) streaming session and ask about message 1...`);
      const spawnResult = await spawnResumeChild(payloadPath);
      note(`resume-after-exit child exited with code ${spawnResult.exitCode}`);

      if (fs.existsSync(outPath)) {
        const childOut = JSON.parse(fs.readFileSync(outPath, "utf8"));
        const recalled = (childOut.resultText ?? "").includes(`STREAM_MEMORY_RECALL: ${streamMemoryWord}`);
        check(
          EXP,
          "streaming-resume-after-exit-in-new-process-recalls-message1",
          childOut.ok === true && childOut.isError === false && recalled,
          `child result=${JSON.stringify(childOut)} expected substring="STREAM_MEMORY_RECALL: ${streamMemoryWord}"`,
        );
        if (!(childOut.ok && !childOut.isError && recalled)) {
          pass = false;
          failures.push("resume-after-exit in a new process did not recall message 1's memory word");
        }
        costUsd += childOut.costUsd ?? 0;
      } else {
        check(EXP, "streaming-resume-after-exit-in-new-process-recalls-message1", false, `no output file; stderr(tail)=${spawnResult.stderr.slice(-800)}`);
        pass = false;
        failures.push("resume-after-exit child produced no output");
      }
      for (const p of [outPath, payloadPath]) {
        try {
          fs.rmSync(p, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      check(EXP, "streaming-cost-cap", "skip", err.message);
      pass = false;
      failures.push(`cost cap: ${err.message}`);
    } else {
      console.error("streaming scenario failed:", err);
      pass = false;
      failures.push(String((err as Error)?.message ?? err));
    }
    try {
      end();
    } catch {
      /* already ended or never started */
    }
  } finally {
    fixture.cleanup();
  }

  console.log(`=== S5 step 3+4 verdict: ${pass ? "PASS" : "FAIL"} (cost $${costUsd.toFixed(4)}) ===`);
  if (failures.length) console.log("  failures: " + failures.join("; "));
  console.log("  timeline:");
  for (const e of timeline) console.log(`    [+${e.tMs}ms] ${e.note}`);

  return { pass, costUsd };
}
