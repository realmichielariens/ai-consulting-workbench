# S5 — Resume, restart and streaming input

**Verdict:** PASS   **Cost:** $0.60 (after a re-run by the main session)   **SDK:** 0.3.280   **Model:** claude-haiku-4-5

> Written by the main session from `results/s05-resume/summary.json` (31 checks, all pass) and the transcripts. Subagent A4 ran the experiment but hit the Claude Code session limit before writing this file. The main session re-ran `resume-new-process.ts` independently: PASS.

## Hypothesis
A run that ends with a blocking question can be resumed with full context, including from a new process. Streaming input supports multi-turn conversation sessions.

## Setup
| Script | Covers |
|---|---|
| `same-process-resume.ts` | Step 1 |
| `resume-new-process.ts` + `resume-child.ts` | Step 2 |
| `streaming.ts` | Steps 3 and 4 |
| `system-prompt.ts` | Step 5 |
| `fork.ts` | Step 6 |

`run.ts` runs them all, and `shared.ts` holds the minimal `raise_question` in-process tool. Re-run: `npx tsx experiments/s05-resume/run.ts`.

## Results
| Check | Result | Evidence |
|---|---|---|
| Same-process resume: same session id, memory word recalled, draft continued with `Edit` (no rewrite), prompt cache used | PASS | `sameproc-*`: resumed `cache_read_input_tokens=10222`, cost $0.021 |
| **New-process resume**: same checks | PASS; main re-run also PASS | `newproc-*`: child pid 42992, tool calls `[Read, Edit]`, `MEMORY_WORD_RECALL: QUARTZ-1605`, cache read 16.7k tokens |
| No orphan processes after the child exits | PASS | `newproc-no-orphan-claude-processes` |
| **Resume depends on the same `CLAUDE_CONFIG_DIR`** | confirmed: with it unset, resume fails with `error_during_execution`, 0 turns | `newproc-resume-depends-on-matching-CLAUDE_CONFIG_DIR` |
| Streaming: message 1 answered; message 2 pushed 10 s later is answered in the same session | PASS | `streaming-message1-answered`, `streaming-message2-after-10s-same-session` |
| Message pushed mid-turn | **merged into the current turn**: one result answers both | `streaming-mid-turn-push-behavior-documented` |
| `interrupt()` | resolves (`{still_queued: []}`), emits a result, and the session continues afterwards | `streaming-interrupt-*`, `streaming-session-continues-after-interrupt` |
| Streaming session resumed by id from a new process after exit | PASS: recalled message-1 content | `streaming-resume-after-exit-in-new-process-recalls-message1` |
| Custom short system prompt vs. default preset (3 runs each) | custom: 4,066 input tokens, $0.0073 per run; default: 3,669 tokens, $0.0067. Same tool behaviour. | `sysprompt-token-cost-comparison` |
| `forkSession: true` | new session id; the original is still resumable | `fork-*` |

## Exact working configuration
```ts
// blocked run → later resume (same or new process)
query({ prompt: answerText, options: { ...sameOptionsAsRun, resume: item.lastSessionId } });
// child env MUST carry the same CLAUDE_CONFIG_DIR as the original run
// streaming conversation
query({ prompt: asyncIterableOfSDKUserMessages, options });  // push messages as they arrive
await q.interrupt();                                          // stop a turn, session stays usable
```

## Surprises and deviations from ARCHITECTURE.md
- Session transcripts live under `CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/`. The workbench must pin one config dir per workspace, for example `<workspace>/.workbench/claude-config`. That keeps `~/.claude` clean, and it has to stay stable across restarts, or resume breaks.
- Mid-turn pushes are merged into the running turn, not queued as a separate turn. The Approach Agent conversation UI should either queue messages itself until the result arrives, or accept that they merge.
- The "short custom system prompt" was *not* cheaper here (the default preset used about 10 % fewer input tokens in this setup, because an explicit `tools` array already shrinks the preset). The choice is about behaviour, not cost.

## Recommendation
- §8.2: keep `resume` for `resume-answer` and `changes-requested`.
- §8.1: keep conversation resume; document the mid-turn merge.
- §15: add the pinned `CLAUDE_CONFIG_DIR` requirement.

## Fallback status
Not needed.

## Harness change requests
None.

## Open questions
None blocking.
