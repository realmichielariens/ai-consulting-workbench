# Brief C — Web UI (I2)

You extend the React UI (`apps/web`: React 19, TanStack Query, React Flow v12 + ELK, zustand, Vite, vitest) for I2 "Talk to the Approach Agent". The human now starts an engagement by chatting with the Approach Agent, reviews plan **proposals** (a list of operations plus a preview in the process view), sees questions the Approach Agent answered or escalated, and changes settings. The server side (package A) and the agents (package B) exist. The main session wrote the contracts.

## Your paths (write only here)
`apps/web/**`. **Read-only**: `packages/core/src/api.ts` (routes, views), `packages/core/src/domain.ts` (`Proposal`, `ChatMessage`, `Notification`, `Request.escalation`/`routedTo`), `packages/core/src/events.ts`. If a contract is wrong, work around it and list it under "Contract change requests" in your final message.

## Read first (only these)
1. `packages/core/src/api.ts`: the I2 routes (threads, proposals + preview, override, notifications, settings, profile, journal), Inbox kinds `proposal`/`fyi`, `ThreadView`, `ProposalView`, `PlanPreviewView`, WS `activity.threadId`
2. `apps/web/src/api/types.ts`, `http.ts`, `queryKeys.ts`, `useEngagementSocket.ts`
3. `apps/web/src/components/EngagementLayout.tsx`, `Inbox.tsx`, `StartPage.tsx`, `process/ProcessView.tsx`

Do not read DESIGN/ARCHITECTURE/ITERATIONS. Conventions: small components; comments explain why; `.js` in relative imports; never `pnpm add`; never commit. The server is the source of truth: views carry `Allowed`, and the UI never re-implements engine rules.

## Build
1. **API layer**: add every new route to `WorkbenchApi`, `http.ts` and `queryKeys.ts`. In `useEngagementSocket.ts`, invalidate on the new events: `ChatMessagePosted` → thread; `Proposal*` / `PlanChanged` → proposals, plan, inbox, engagement; `QuestionRouted/Escalated`, `SuggestionDeclined`, `HumanNotified`, `NotificationDismissed` → inbox, item; `SettingsChanged` → engagement; `RunStarted/RunEnded` with a `threadId` → thread. Route `activity` messages with a `threadId` into the same `runActivity` cache. In `api/mock/`, implement the new methods as minimal stubs (empty lists, one thread with no messages); the real server is the test target.
2. **Start page**: a prominent **Start with the Approach Agent** button (`data-testid="start-with-approach"`) plus a name input (`approach-name-input`, default "New engagement") → `createEngagement({seedId:"blank", name})` → open it on the Chat tab. Hide the `blank` seed from the seed cards.
3. **Left panel tabs**: `Chat` (`tab-chat`), `Inbox (n)` (`tab-inbox`), `Approach` (`tab-approach`). Default: Chat for an engagement whose plan has only ENG, else Inbox. Remember the choice per engagement in zustand.
4. **Chat** (`chat-panel`), for thread T-0001 (from `listThreads`):
   - messages (`chat-message`, `data-role`), with Markdown for `approach`;
   - a system message with `asset` → a link (`chat-asset-link`) that opens the asset viewer;
   - a system message with `proposalId` → the inline **ProposalCard**;
   - while `activeRunId` is set: the running turn's activity (`chat-activity`, reuse `ActivityStream`) and a "thinking…" line;
   - send box `chat-input` + `chat-send`. **D5**: while a turn runs, sending queues the text locally (`chat-queued`, "queued") and posts it automatically when the turn ends. A 409 also queues;
   - scroll to the newest message.
5. **ProposalCard** (`proposal-card`, `data-proposal-id`), used in the chat and in the Inbox:
   - status badge (`proposal-status`); rationale (`proposal-rationale`); `readableOps` as a list (`proposal-op`); "suggested by WI-004 …" when `suggestedByTitle` is set;
   - **Preview in process view** toggle (`proposal-preview-toggle`): swaps the process view to `previewProposal` with a banner (`preview-banner`, "Previewing P-0001 — not applied", exit `preview-exit`) and highlights `added`/`changed`/`cancelled` nodes;
   - **Approve** (`proposal-approve`), and **Reject** with a reason (`proposal-reject-open`, `proposal-reject-reason`, `proposal-reject-submit`); buttons follow `actions.*.allowed`, with the reason as a tooltip;
   - superseded, rejected or approved proposals render compact.
6. **Inbox**:
   - `proposal` entry → `inbox-card-proposal` wrapping the ProposalCard;
   - `fyi` entry → `inbox-card-fyi`: the text, **Dismiss** (`fyi-dismiss`). When `request` is set, it shows the question, the hypothesis and "Answered by the Approach Agent: …", plus **Override** (`fyi-override-open`, `fyi-override-text`, `fyi-override-submit`) enabled by `override.allowed`;
   - the question card: when `request.escalation` is set, show "The Approach Agent escalated this" and its view (`question-escalation-view`) next to the hypothesis.
7. **Item detail**: for an open question with `to === "approach"`, show "Question sent to the Approach Agent" (`question-routed-note`). Answers by `approach:*` are labelled "Approach Agent" wherever responses are shown. Show the model on each run.
8. **Settings panel**: a header button `open-settings` opens `settings-panel`, with selects `setting-question-handling` (aa-first / always-human), `setting-item-start` (manual / auto), `setting-plan-changes` (propose, disabled), and `setting-profile` (from `getProfile`; note "applies to new sessions"). Settings changes go through `patchSettings`; the profile through `patchProfile`.
9. **Approach tab**: the journal Markdown, read-only (`approach-journal`), refetched on `JournalAppended`.
10. **Header**: plan version (`plan-version`, "plan v3") and the approach model in the runtime badge.

## Checks, then stop
- `pnpm --filter @workbench/web run typecheck` and the existing web tests green, plus a small test for the D5 queue logic and one for the ProposalCard (ops, allowed/disabled approve).
- Brief boot check: `pnpm dev:fake` (web :5317, API :4317). If 4317 is already in use, don't kill it; report it. Click through once: Start with the Approach Agent → send a message → see the scripted reply. Then **stop the servers** (find them by port).
- No real SDK runs.

Finish with a **≤ 20-line final message**: what you built, the test ids you added beyond this list, check evidence, contract change requests, open issues. No report files.
