// Mock seed content, condensed from demo/seeds/acme-discovery/ and
// demo/interview-notes/ (read-only reference; this file is a hand-authored
// copy so the mock never imports outside apps/web/**). Kept close enough to
// the real seed that the mock's Inbox/process-view/asset content reads like
// the real demo, without reproducing every interview note verbatim.

import type { ItemDef, ItemId } from "@workbench/core";
import type { SeedSummary } from "@workbench/core";

export const ACME_SEED: SeedSummary = {
  id: "acme-discovery",
  title: "Acme — IT Strategy Discovery",
  description: "Acme Manufacturing — IT strategy discovery: interview guide, CxO interviews and theme synthesis (3 items).",
  engagementName: "Acme Manufacturing — IT Strategy",
  itemCount: 3,
};

export const SEED_SUMMARIES: SeedSummary[] = [ACME_SEED];

/** item.md front-matter + brief, transcribed from plan.template.yaml (I1 seed). */
export const ACME_ITEMS: ItemDef[] = [
  {
    id: "ENG",
    title: "IT Strategy for Acme Manufacturing Corp.",
    parent: null,
    order: 0,
    executor: null,
    inputs: [],
    sequencing: [],
    outputs: [
      { slot: "context", format: "md", scope: "project", description: "Client, goals, scope, constraints and timeline for the engagement", required: true },
      { slot: "stakeholders", format: "md", scope: "project", description: "Who is who at Acme, and who is being interviewed", required: true },
    ],
    skills: [],
    gate: [],
    autostart: true,
    acceptance: [],
    brief:
      "IT strategy for Acme Manufacturing Corp., commissioned by the CEO on the board's behalf. Discovery runs the " +
      "interview guide and the four C-suite interviews that ground everything downstream; Synthesis turns those into " +
      "the themes, initiatives and roadmap that go into a board deck due in six weeks, for steerco endorsement.",
  },
  {
    id: "PH-1",
    title: "Discovery",
    parent: null,
    order: 1,
    executor: null,
    inputs: [],
    sequencing: [],
    outputs: [],
    skills: [],
    gate: [],
    autostart: true,
    acceptance: [],
    brief: "Discovery: build the interview guide, then run the four C-suite interviews that everything else in this engagement builds on.",
  },
  {
    id: "PH-2",
    title: "Synthesis",
    parent: null,
    order: 2,
    executor: null,
    inputs: [],
    sequencing: [],
    outputs: [],
    skills: [],
    gate: [],
    autostart: true,
    acceptance: [],
    brief: "Synthesis: turn the interview notes into the cross-cutting themes the rest of the strategy builds on.",
  },
  {
    id: "WI-002",
    title: "Prepare interview guide",
    parent: "PH-1",
    order: 1,
    executor: "agent",
    inputs: [
      { slot: "ENG/context", required: true },
      { slot: "ENG/stakeholders", required: true },
    ],
    sequencing: [],
    outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "A single guide covering the CEO, CFO, COO and CIO interviews", required: true }],
    skills: ["interview-guide-design"],
    gate: [{ type: "human-review" }],
    autostart: true,
    acceptance: [
      "A distinct, targeted set of questions for each of the CEO, CFO, COO and CIO, reflecting their own remit and stake",
      "Each interview opens with a short warm-up and closes with an open 'anything we haven't covered' question",
      "Questions surface pain points, ambitions and constraints, not a specific technology or vendor answer",
      "A suggested running order and a realistic time budget (45-60 minutes) per interview",
      "Reflects at least one stakeholder-specific detail from stakeholders.md for each executive",
    ],
    brief:
      "One interview guide that anchors all four Discovery conversations. Ground it in `ENG/context` and " +
      "`ENG/stakeholders`. Priya Raman (CIO) is three months into the role — be deliberate about whether her section " +
      "leans on her forming vision or on the ERP history she inherited; a single 45-60 minute slot can't do both justice.",
  },
  {
    id: "WI-003",
    title: "Conduct CxO interviews",
    parent: "PH-1",
    order: 2,
    executor: "human",
    inputs: [{ slot: "WI-002/interview-guide", required: true }],
    sequencing: [],
    outputs: [
      { slot: "notes-ceo", format: "md", scope: "project", description: "Notes from the CEO interview (Frank Delgado)", required: true },
      { slot: "notes-cfo", format: "md", scope: "project", description: "Notes from the CFO interview (Grace Whitfield)", required: true },
      { slot: "notes-coo", format: "md", scope: "project", description: "Notes from the COO interview (Marta Ilić)", required: true },
      { slot: "notes-cio", format: "md", scope: "project", description: "Notes from the CIO interview (Priya Raman)", required: true },
    ],
    skills: [],
    gate: [],
    autostart: true,
    acceptance: [],
    brief:
      "Run the four CxO interviews using the guide WI-002 produced. Upload notes into each slot as soon as each " +
      "conversation is done, rather than waiting for all four, so Synthesis can start on whatever is ready.",
  },
  {
    id: "WI-004",
    title: "Consolidate interview themes",
    parent: "PH-2",
    order: 1,
    executor: "agent",
    inputs: [
      { slot: "WI-003/notes-ceo", required: true },
      { slot: "WI-003/notes-cfo", required: true },
      { slot: "WI-003/notes-coo", required: true },
      { slot: "WI-003/notes-cio", required: true },
      { slot: "ENG/context", required: true },
    ],
    sequencing: [],
    outputs: [{ slot: "themes", format: "md", scope: "project", description: "5-10 cross-cutting themes, each with evidence quotes and source interviews", required: true }],
    skills: ["thematic-synthesis"],
    gate: [{ type: "human-review" }],
    autostart: true,
    acceptance: [
      "Every theme is backed by at least two interviews",
      "Contradictions between executives are called out explicitly",
      "Each theme is illustrated with at least one direct quote and its source interview",
      "Themes are prioritised by business impact, not by the order the interviews happened in",
    ],
    brief:
      "Synthesize the four interviews into the major themes for Acme's IT strategy, using `ENG/context` to keep the " +
      "business framing straight. Where the executives disagree, call it out explicitly rather than averaging it away.",
  },
];

export const ACME_ITEMS_BY_ID = new Map<ItemId, ItemDef>(ACME_ITEMS.map((it) => [it.id, it]));

export const ACME_CONTEXT_MD = `# Acme Manufacturing Corp. — Engagement Context

Acme Manufacturing Corp. is a mid-size industrial manufacturer (approximately 1,800 employees, $410M annual
revenue), headquartered in Dayton, Ohio, with three plants in the US Midwest and a smaller contract-manufacturing
site in Monterrey, Mexico. Acme makes precision-machined components for the agricultural and construction
equipment industries, selling mostly through long-term supply contracts with three large OEM customers.

## Why this engagement

The CEO, Frank Delgado, has asked for an IT strategy: a board deck, due in **six weeks**, that the steering
committee can endorse. Four pressures put IT strategy on the board's agenda this year: ERP end-of-support in three
years on a heavily customized 14-year-old instance; an OEM asking for real-time production visibility as a
condition of renewal; plant-level spreadsheet workarounds hiding risk from the center; and a planned fourth
product line the current systems can't support without heavy custom work.

## Sponsor and stance

Priya Raman, the CIO, has been in the role for **three months**. She inherited the ERP landscape rather than
having built it, and has asked for a fact-based, structured strategy rather than a vendor-led sales process.

## Deliverable and timeline

A board deck — themes, initiatives and a prioritized roadmap — endorsed by the steering committee, in six weeks
from kickoff.
`;

export const ACME_STAKEHOLDERS_MD = `# Acme Manufacturing Corp. — Stakeholders

| Name | Role | Notes |
|---|---|---|
| Frank Delgado | CEO | Commissioned the engagement. Primary exposure is the OEM renewal risk. Interviewed. |
| Grace Whitfield | CFO | Owns the separate finance/GL system, which doesn't share a customer/part master with the ERP. Watches capital discipline closely. Interviewed. |
| Marta Ilić | COO | Owns all three US plants; most exposed to disruption during harvest-season peak. Interviewed. |
| Priya Raman | CIO (three months in role) | Sponsor of the IT strategy. Wants a fact-based approach, not a repeat of the current landscape's over-customization. Interviewed. |
| Owen Butler | Plant Manager, Dayton | Built the most extensive spreadsheet workaround. Not interviewed. |
| Dev Anand | Director of IT, Applications | Deep institutional knowledge of the ERP's customizations. Joined part of the CIO interview. |

**Interviewed in Discovery (WI-003):** Frank Delgado (CEO), Grace Whitfield (CFO), Marta Ilić (COO), Priya Raman (CIO).
`;
