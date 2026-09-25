# Agentic Project Workbench

A local, single-user POC in which a human runs an engagement (for example an IT strategy) with AI agents, built on the Claude Agent SDK. See [DESIGN.md](DESIGN.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for what it does and how it's built, and [CLAUDE.md](CLAUDE.md) for the conventions every package follows.

## Try UX1: the Exhibit redesign

About 15 minutes, on scripted agents at no cost.

1. Run `pnpm dev:fake` and open <http://localhost:5317>.
2. Click **Start with the Approach Agent**. The conversation fills the stage (the Kick-off). Send the kick-off messages from the I2 steps below, and watch `context` and `stakeholders` appear under *Taking shape*. On the proposal card, click **Review on plan**: the Plan opens with the proposal bar. Click **Approve** there. You land on the **Brief**, now your home, and the conversation moves into the rail.
3. When a question card arrives on the Brief, press `E` to amend it, type, and send.
4. On a review card, click **Open & review**. Read the document, then click **Approve** in the review bar at the bottom.
5. On the *Conduct CxO interviews* card, click **Open**. On its Item page, under *Your work*, upload the four files from `demo/interview-notes/` and click **Mark done**.
6. On the **Plan**, switch **Canvas** ⇄ **Tracker**. Click a node to peek at it, and use **Open** to open it as a tab.
7. Open a document and ask the rail "what changed here?". The context chip above the composer shows what the agent sees.
8. Toggle dark mode in **Settings** (the gear, bottom left), and toggle the rail with `\`.

The I1 and I2 steps below still work, with the new navigation: the Inbox is now the **Brief**, Chat is the **rail**, reviews happen in the document's review bar, and human work happens on the Item page. Developer details (runtime, WebSocket, cost, Open folder, Feedback) are in the strip at the bottom.

## Try I2 with the Approach Agent

1. Run `pnpm dev:fake` and open <http://localhost:5317>. This uses scripted agents at no API cost.
2. Click **Start with the Approach Agent**. Describe Acme's IT strategy: the CEO commissioned it, the board wants a deck in six weeks, and the steerco must endorse it. Answer the agent's questions about the four C-suite interviews and the new CIO.
3. Open the published `context` and `stakeholders` assets. Review the proposed operations in Chat, toggle **Preview**, then **Approve**. WI-002 starts.
4. Watch WI-002's question go to the Approach Agent. Its answer appears as an FYI in the Inbox. Once WI-002 reaches review, use **Override**, then approve the new review.
5. Upload the four interview notes to WI-003 and mark it done. WI-004 suggests a CFO follow-up; approve the proposal in the Inbox.
6. In Chat, ask for a short benchmarking item, review the new proposal, and ask **Where are we?**. Open **Settings** to change question handling and the model profile. The **Approach** tab shows the read-only journal.

To replay the full scripted journeys, run `node e2e/walks/i2.cjs` while `dev:fake` is running. The I1 regression walk is `node e2e/walks/i1.cjs`.

## Try the I1 demo

1. `pnpm install`, then `pnpm dev:fake` and open <http://localhost:5317>. The scripted fake agent costs nothing.
2. **Start**: pick *Acme — Discovery*, keep the name, click **Create**. The process view shows the plan, and WI-002 starts by itself.
3. **Watch**: click WI-002 to see its live activity. After a few seconds, it asks a blocking question with a hypothesis, which appears in the **Inbox**.
4. **Answer**: choose **Approve**, **Amend** or **Replace**. The agent resumes.
5. **Review**: the interview guide arrives for review. **Request changes** once, then **Approve** the next version. WI-003 becomes ready.
6. **Human work**: in the WI-003 Inbox card, upload the four files from `demo/interview-notes/` into their slots, then click **Mark done**. WI-004 starts.
7. **Finish**: approve the themes review. Click data objects to read the versions, and use **Open folder** to see the engagement's files and `git log` on disk.
8. **Real agents**: stop with Ctrl-C and run `pnpm dev`. The same flow runs on Claude Haiku 4.5; the header shows the running cost. The Work Agent is prompted to flag open judgment calls as non-blocking questions.

Use **Feedback** (top bar) to note anything as you go; notes go to `workspace/feedback.jsonl`. To start clean, delete `workspace/engagements/`.

## Getting started

**Prerequisites**: Node.js ≥26, pnpm 11.5.1 (`packageManager` is pinned; use [Corepack](https://nodejs.org/api/corepack.html) or install that exact version).

```sh
pnpm install
```

The API key (`ANTHROPIC_API_KEY`) is resolved in this order: the process environment, a repo-root `.env` (git-ignored — create one from scratch, there is no `.env.example` at the root), then the Windows user environment variable (`HKCU\Environment`). It is never required just to boot the app with `pnpm dev:fake`.

```sh
pnpm dev        # server (real agent runtime) + web, on the ports in workbench.config.yaml (4317, 5317)
pnpm dev:fake   # same, but the server reports runtime "fake" (WORKBENCH_RUNTIME=fake) — no API key needed
pnpm typecheck  # tsc --noEmit for every package and app
pnpm test       # Vitest for every package and apps/web (jsdom), one command
pnpm e2e        # Playwright, against a `dev:fake` server it starts and stops itself
```

Stop `pnpm dev`/`pnpm dev:fake` with Ctrl-C; it shuts the server down cleanly. Nothing is left running by the quick checks in `iterations/I1/reports/`.
