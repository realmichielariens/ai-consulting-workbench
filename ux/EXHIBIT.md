# Exhibit: the Workbench's visual language

**Version 1.0**, adopted on 2026-09-25.

Exhibit is made of three parts:

| Part | File | Role |
|---|---|---|
| Tokens | [exhibit-tokens.css](exhibit-tokens.css) | The source of truth for every colour, font, size, space and radius. Import it once. |
| Specification | this file | The rules for using the tokens: roles, the signal system, component anatomy and writing conventions. |
| Playground | [playground/index.html](playground/index.html) | A living reference. Open it in a browser to see every token and component, in light and dark. Its defaults must match the tokens file. |

If a rule here conflicts with the playground, this file wins. Fix the playground.

---

## 1. The idea

Consultants trust work that looks like a finished client deliverable:
- a headline that states the conclusion;
- numbered exhibits;
- a source line under every chart;
- hairline tables;
- one disciplined accent colour.

Exhibit borrows that visual grammar. As a result, what the agents produce looks board-ready inside the tool, and the tool itself feels like a professional instrument rather than a chat app.

Two ideas carry the language:

- **The work is the product; the agent is staff.** Deliverables, decisions and the plan get the space. The Approach Agent is present, but it writes short memos with sources and does not dominate the screen.
- **A sans for operating, a serif for reading.** Everything you *operate* (lists, controls, trackers, the canvas) is set in IBM Plex Sans. Everything you *read as content* (documents, briefs, hypotheses) is set in Source Serif 4. The switch in typeface tells the user they have moved from steering the work to judging it.

## 2. Principles

| # | Principle | Rule in practice |
|---|---|---|
| P1 | **Action titles** | A page or card headline states the so-what: "3 decisions need you. Synthesis is waiting on your review.", not "Inbox". The category goes in a small-caps *kicker* above the headline. |
| P2 | **Ink on paper** | Cool white paper, navy ink and one accent. Colour carries meaning (status, change, gate) and is never used for decoration. |
| P3 | **Rules, not boxes** | Structure comes from 1px hairlines, a 2px ink rule under section and table headers, and whitespace. Shadows are only for things that float. |
| P4 | **Numbers are first-class** | Tabular figures everywhere. Ids, file names, versions and times in mono. Progress shown as Harvey balls. |
| P5 | **Source everything** | Every agent claim cites the assets it draws on (`themes.md@2.0 §05`), the way an exhibit carries a source line. A source is always clickable and opens the asset. |

## 3. Colour

The values are in [exhibit-tokens.css](exhibit-tokens.css). Only the roles are listed here.

| Token | Role | Do not use for |
|---|---|---|
| `--paper` | Page and stage background | Cards |
| `--surface` | Cards, panels, rail, top bar | The page background |
| `--sunken` | Tab strips, table group rows, wells, the context chip | Primary content |
| `--ink` | Body text, heavy rules, **formal commit** buttons (record a decision) | Large filled areas, except the nav rail |
| `--ink-2` | Secondary text, message bodies from the human | Headlines |
| `--ink-3` | Meta, captions, kickers, timestamps | Anything the user must read to act |
| `--rule` / `--rule-strong` | Hairlines / outlines of inputs and secondary buttons | Text |
| `--accent` | **The** primary action, selection, focus ring, "ready" and "in progress" | Decoration, headings, more than one primary button per region |
| `--accent-weak` | Selected rows, the hypothesis block | Backgrounds with no meaning |
| `--positive` | Done, added, criteria met | Buttons |
| `--caution` | Stale, partial, implicit read | Warnings that need action (use critical) |
| `--critical` | Blocked, run issue, reject, destructive | Emphasis |
| `--gate` | At gate, review, endorsement | Anything that is not a gate |

**Rules**

1. A colour is **never the only signal.** Every coloured state also has a glyph and a word (§5).
2. There is **one accent** in the product. It is not re-themed per engagement.
3. Each semantic colour has a `-weak` background for highlighted rows and change markers. Text on a `-weak` background uses the strong colour.
4. **Contrast.** Every text token passes WCAG AA (4.5:1) on `--paper`, `--surface` and `--sunken`, in both themes. This was checked for v1.0: `--ink-3` and `--caution` were darkened from the playground's first proposal to pass. If you add a token, check it.
5. **Dark mode** follows `data-theme` on `<html>`, falling back to `prefers-color-scheme`. Components never branch on the theme: they use tokens. The only exception is the nav rail (see §7.1).

## 4. Typography

| Role | Face | Size / weight | Used for |
|---|---|---|---|
| Display | UI sans | `--fs-xxl` / 600, tracking −0.02em | Rare. The engagement's home headline at most. |
| Page title | UI sans | `--fs-xl` / 600 | The action title of a page (Brief, Plan, Decisions). |
| Document title | UI sans | 28px / 600 | The H1 of a rendered document. |
| Heading | UI sans | `--fs-lg` or 18px / 600 | Headings inside a page or document. In documents they are numbered in mono accent (`01`). |
| Card title | UI sans | `--fs-md` / 600 | The action title of a decision card. |
| Label / kicker | UI sans | `--fs-xs` / 600, CAPS, tracking +0.08em, `--ink-3` | Categories, table headers, field labels. |
| UI body | UI sans | `--fs-base` / 400, line-height 1.5 | Everything operational, including Approach Agent messages. |
| Dense UI | UI sans | `--fs-sm` | Tables, buttons, streams, meta. |
| **Reading** | **Serif** | `--fs-read` / 400, line-height 1.62, max `--measure` | Document bodies, item briefs, acceptance criteria, hypotheses, standfirsts. |
| Identifier | Mono | 0.86–0.92em, `--ink-3` | `WI-004`, `themes.md@2.0`, versions, times, paths, costs in streams. |

**Rules**

1. Use the **serif for content authored by an agent or a person** that the user reads to judge. Use the **sans for everything the tool says** about that content.
2. Tabular figures are on globally (`font-feature-settings: "tnum"`). Never set numbers in a proportional face.
3. The reading measure is at most 68 characters. Documents never stretch to the full stage width.
4. Headings use sentence case. Only labels are in caps.
5. There is no italic for emphasis in the UI. Use weight 600.

## 5. The signal system

This is a closed set of signals that users learn once. Do not invent new ones without adding them here.

### 5.1 Item status

The glyphs are 14px SVGs. The playground's `GLYPH` map is the reference drawing.

| Status | Glyph | Colour | Label | Meaning shown on hover |
|---|---|---|---|---|
| `draft` | dashed circle | ink-3 | Draft | Proposed, not approved |
| `waiting` | hollow circle | ink-3 | Waiting | Its inputs don't exist yet |
| `ready` | thick ring | accent | Ready | Can start |
| `in_progress` | half-filled circle (slow spin; still under reduced motion) | accent | In progress | An agent, or you, is working |
| `blocked` | filled square with a bar | critical | Blocked | Needs an answer |
| `at_gate` | diamond with a filled core | gate | At gate | Waiting for a review or endorsement |
| `done` | filled circle with a check | positive | Done | Outputs accepted |
| `stale` | filled triangle with ! | caution | Stale | An input changed materially |
| `cancelled` | circle with a slash, label struck through | ink-3 | Cancelled | Dropped from the plan |

Canvas nodes also show the status as a 4px left edge in the status colour. The glyph and label stay inside the node.

### 5.2 Other signals

| Signal | Form | Meaning |
|---|---|---|
| **Harvey ball** | 14px circle, filled 0/25/50/75/100% | The share of children done (roll-ups, progress, theme strength in exhibits). |
| **Minor version** | `1.1`, mono, outlined | Downstream items are notified only. |
| **Material version** | `2.0`, mono, ink-filled | Downstream items go stale. |
| **Executor** | outline robot glyph (agent) / person glyph (human) | Who executes. **No emoji** anywhere in the UI. |
| **Review gate** | outline diamond, gate colour | AI or human review. |
| **Endorsement gate** | filled diamond, gate colour, plus the forum label | A formal decision (for example by the steerco). |
| **Data object** | document glyph: filled when published, dashed when the slot is empty | An asset slot. |
| **Implicit read** | dotted caution outline (on a source chip or an edge) | A read beyond the declared inputs. |
| **Change marker** | 3px positive bar in the margin with a `-weak` wash, plus an "added 2.0" tag | Content added or changed since the compared version. |
| **Source chip** | mono, 1px rule outline; the accent appears on hover | A citation. It opens the asset at that version and section. |
| **Proposed (ghost)** | dashed outline, transparent fill, `proposed` or `#7` accent tag | A change in a pending proposal. |
| **Live** | a small positive dot with a halo, plus the text "2 agents running" | Work is happening now. |

## 6. Space, grid and shape

- **The grid is 4px.** Use `--sp-*` tokens. Density (`data-density="compact"`) scales them through `--d`. Use compact for trackers and long queues, **never for reading**.
- **Corners are sharp:** `--r` (2px) for controls and tags, `--r-lg` (4px) for cards, panels and nodes. Nothing is fully round except avatars for people, status dots and Harvey balls.
- **Rules.** A 1px `--rule` separates items. A 2px `--ink` rule sits under a section header, a table header or a queue header ("Needs you"). A 1px `--ink` rule sits above a sticky action bar (the review bar).
- **Elevation** (`--shadow-float`) is only for popovers, menus, dialogs, and the rail when it overlays the stage. Cards lie flat.

## 7. Components

Each component has one purpose. The reference implementations are in the playground.

### 7.1 Shell

- **Nav rail** (`--nav-w`): an ink background in light mode and `--sunken` in dark mode. It has icons only, with tooltips, and a count badge in critical. It shows only destinations that exist in the current iteration: **no dead nav entries.**
- **Top bar** (`--topbar-h`) shows the engagement name, its goal line and KPIs (progress, plan version, spend, and the week when known), then the live indicator and the rail toggle. Developer details (runtime, profile, models, WebSocket state) do **not** go here; they go in the status strip (see [REDESIGN-PLAN.md](REDESIGN-PLAN.md) §4).
- **Stage tab strip** (`--tabstrip-h`): `--sunken` strip. The active tab takes the paper colour with a 2px accent line on top. Pinned tabs (Brief, Plan) have no close button.
- **Approach rail** (`--rail-w`): `--surface`. It has a header with a Chat/Agenda switch, the memo stream, a context chip, and the composer at the bottom.

### 7.2 Controls

| Control | Rule |
|---|---|
| Button, **primary** (accent) | One per region: the action the region exists for (Approve, Send, Open & review). |
| Button, **ink** | Commits a formal record: Record decision, Run item. |
| Button, **secondary** (outlined) | Alternatives: Amend, Replace, Discuss, Request changes. |
| Button, **ghost** | Low-stakes or tangential: Download, Wrong question. |
| Button, **danger** | Critical-coloured text on an outline; it fills critical-weak on hover. Never filled red. |
| Keyboard hint | A mono `kbd` inside the button (`Approve A`) when a shortcut exists. |
| Disabled | Disabled buttons always show why, from the view's `Allowed.reason`, in a tooltip or a helper line. |
| Segmented control | For view modes (Canvas/Tracker, Read/Changes/Source). The selected segment is filled with ink. |
| Tabs (in-page) | Underline in ink. Stage tabs are a different component (§7.1). |
| Tag | 22px, `--sunken`. Variants: outline, accent, source (mono). |
| Input | 1px `--rule-strong`. On focus: an accent border and a 3px `--accent-weak` ring. |

### 7.3 The decision card

Every moment where the human adds judgement uses the same anatomy:

```
KIND  WI-002  Prepare interview guide · 12 min      ← kicker: label + id (mono) + source + age
How should the CIO section be framed?              ← action title (card title)
┃ AGENT'S HYPOTHESIS                                ← evidence: hypothesis / diff / criteria
┃ Focus on vision and first impressions… (serif)
Shapes 6 of 14 questions in the guide.             ← why it matters (consequence)
───────────────────────────────────────────────
[Approve A] [Amend E] [Replace R]      Wrong question   ← actions: primary first, escape last
```

| Variant | Evidence block | Actions |
|---|---|---|
| Question | Hypothesis (accent left rule, serif), plus the Approach Agent's view if escalated | Approve · Amend (inline field) · Replace · *Wrong question* (I5) |
| Review | Criteria met/partial/not met, as glyphs; the version reviewed | Open & review (primary). The verdict itself is given in the document's review bar. |
| Proposal | A diff list (`+` added, `↻` re-run, `~` changed, `−` removed) and an impact strip (dates, cost) | Approve · Discuss · *Reject* |
| Human item | Inputs available, output slots | Open (primary) · Upload · Mark done |
| Run issue | What happened, the last activity line | Retry (primary) · Stop |
| Endorsement (I6) | A gate-colour top rule, and an outcome segment (Endorsed / With conditions / Not endorsed) | Record decision (**ink**) · Attach minutes |
| FYI | A one-line row, not a card | Dismiss · Override (if allowed) |

### 7.4 Other components

- **Tracker table.** Caps header over a 2px ink rule, `--sunken` group rows per phase, hover rows in accent-weak, Harvey balls right-aligned. It is the scan view of the plan.
- **Activity stream.** A mono timestamp, a signal dot (read = ink-3, implicit read = dotted caution, write = accent, ask = gate diamond), then a line of prose. It is written for people ("Read 4 interview notes"), not as tool-call names.
- **Memo (Approach Agent message).** Not a bubble. Avatar square (ink "A") for the agent and a round avatar for the human; name, then time; the body in UI sans; then the source chips; then inline decision cards if the message carries one. The human's messages are in `--ink-2`.
- **Context chip.** Sits above the composer: "Viewing **themes.md 2.0** · the agent sees this". It shows what the rail will send as context.
- **Canvas node.** 188px wide, `--r-lg`, status edge on the left, id (mono) and executor glyph on top, title (600), then status or roll-up, then the output data objects. Selected: an accent border and a 3px accent-weak ring. Composite: `--sunken` fill. Ghost: dashed.
- **Version rail.** A vertical 1px line. Material versions are square markers and minor versions are round. The current version is filled with the accent.
- **Review bar.** Sticky at the bottom of a document under review. A 1px ink rule on top. It shows the gate glyph and label, the criteria glyphs, then Request changes and Approve *version* (primary).
- **Exhibit (inside a document).** "EXHIBIT n" label in accent caps, a bold title, a 2px ink rule, the table or chart, then a "Source: …" line in `--fs-xs` `--ink-3`.

## 8. Writing conventions

| Topic | Convention |
|---|---|
| Headlines | Action titles (P1). Computed from data where possible, for example "3 decisions need you. Synthesis is waiting on your review." |
| Kickers | CAPS label, then the id in mono, then plain text: `QUESTION  WI-002  Prepare interview guide · 12 min` |
| Buttons | A verb in sentence case, as specific as possible: "Approve 2.0", "Record decision", "Open & review". Never "OK" or "Submit". |
| The human | "You" and "your": "You review themes.md", "Needs you". |
| The agents | "Approach Agent" in full; a Work Agent is referred to by its item ("WI-004"). |
| Ids | Always mono, always with a prefix: `WI-004`, `PH-2`, `#7` for proposals, `themes.md@2.0` for an asset version. |
| Time | Today: `09:47`. This week: `Mon`. Older: `25 Sep`. The Brief header: `Thu 25 Sep · Week 3 of 6`. |
| Money | `$1.84`: two decimals in the UI, three in the developer status strip. |
| Status words | Exactly the labels in §5.1. No synonyms ("pending", "todo"). |
| Empty states | Say what will appear and what causes it: "Nothing needs you. Agents are working on 2 items." |
| Emoji | None in the UI. The glyphs replace 🤖 👤 ◇ ◆. |

## 9. Accessibility

- Colour, glyph and label always appear together (§3 rule 1). Glyph-only uses (the criteria in the review bar) carry a `title` and an `aria-label`.
- Text contrast is AA in both themes (§3 rule 4).
- The focus ring is a 2px accent outline with a 2px offset, on every interactive element.
- Every decision action is reachable by keyboard. The shortcuts are listed in [REDESIGN-PLAN.md](REDESIGN-PLAN.md) §7.
- Motion is limited to the in-progress spin and 120ms colour transitions. `prefers-reduced-motion` stops the spin.
- Hit targets are at least 28px high, even in compact density.

## 10. Implementation conventions (apps/web)

1. **Import the tokens once**, in `main.tsx`, from `ux/exhibit-tokens.css` or from a copy in `apps/web/src/styles/`. The redesign plan decides which. Component CSS uses `var(--…)` only: no hex values, no font names, no px sizes that a token already covers.
2. **Fonts are loaded from Google Fonts for now**, through a `<link>` in `apps/web/index.html` (decided 2026-09-25). The fallback stacks in the tokens keep the app readable offline. If offline demos become important, self-host through `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` and `@fontsource-variable/source-serif-4`; that is a dependency request (CLAUDE.md rule 3).
3. **One glyph module** (`apps/web/src/ui/glyphs.tsx`) exports `StatusGlyph`, `ExecGlyph`, `GateGlyph`, `DocGlyph` and `HarveyBall`. Nothing else draws these.
4. **A small primitives layer** (`apps/web/src/ui/`): `Button`, `Segmented`, `Tag`, `SourceChip`, `Status`, `Version`, `Card` (kicker, title, evidence, actions), `Tracker`. Pages compose them. There is no UI library.
5. The theme and density are set as `data-theme` and `data-density` on `<html>` and stored per user in `localStorage` (a convenience only).
6. **Keep existing `data-testid` values** when restyling, so the e2e walks (`e2e/walks/*.cjs`) keep working. New surfaces get new test ids.
7. Status colours come from `--status-<ItemStatus>`, so a status never needs a hand-written colour.

## 11. Don'ts

- No warm cream backgrounds, no orange accent, no large border radii, no gradients (the change-marker wash is the one exception).
- No chat bubbles. No typing-dots theatre. Show real activity instead.
- No second accent colour, and no per-status background fills on whole cards.
- No drop shadows on cards.
- No full-width text: reading stays within `--measure`.
- No "Inbox (3)" style labels as headlines. Use the action title and put the count in the kicker.
