---
name: desk-research
description: Method for short desk research — benchmarks, comparable organizations, market or vendor context — using the sources attached to the task (the web, data providers, the Library), with every claim traceable to a cited source. Use this when a work item's output depends on outside evidence rather than on the engagement's own documents.
---

# Desk research

Desk research for an engagement is not "search and paste". The value is a
small number of sources that are actually relevant to *this* client, read
properly, with every claim traceable to where it came from. A steerco will
ask "where does that number come from?" — the output must answer that
without anyone re-doing the search.

## Your sources

Your task lists its attached sources at the end of your system prompt, each
with its tools and the reason it was attached. Typical ones:

- **Open Web** (`WebSearch`, `WebFetch`): broad and current, uneven quality,
  changes over time. Give `WebFetch` a specific question ("What timeline and
  phasing did they use for the ERP replacement?"), not "summarize this page".
- **A data provider** (its own `search`/`get` tools): curated, often a fixed
  edition. Quote figures exactly, with the record id and edition.
- **The Library**: playbooks from earlier engagements. Adapt; don't copy.

If a source you need isn't attached, don't improvise one: say so in your
worklog and completion report, or suggest it with `propose_plan_change`.

## Method

1. **Frame before you search.** From the brief and `ENG/context`, write
   down (in your worklog) the 2-4 questions the research must answer, and
   what "comparable" means for this client (size, industry, situation).
2. **Curated before broad.** If a data provider or the Library is attached,
   start there; use the open web to fill gaps and to corroborate.
3. **Search narrowly, a few times.** 3-6 targeted queries beat one broad
   one. Add the client's situation to the query, not just the topic.
4. **Read before you cite.** Fetch or `get` the 2-5 most promising items
   and read them. Don't cite something you only saw in a result list.
5. **Separate fact from claim.** A vendor case study or an analyst note is
   a claim by its author. Say so ("according to the vendor's case
   study…", "Meridian notes that…").
6. **Relate it back.** For each finding, say what it means for this client,
   in one or two sentences. Raw findings without the "so what" aren't done.
7. **Note gaps honestly.** If you could not find a credible source for
   something the brief asked, say so in the output and in `openIssues`
   rather than filling it with plausible-sounding text.

## Citing sources (required)

- Cite inline with a numbered marker: "…phased over three years [1]."
- End every output with a `## Sources` section listing each cited source
  as a Markdown link with its publisher, and the edition (fixed sources)
  or the date you accessed it (live sources):

  ```markdown
  ## Sources

  1. [Title of the page](https://example.org/page) — Publisher, accessed 2026-10-05
  2. [MB-104 ERP replacement duration by approach](https://example.com/…) — Northfield Industry Research, edition 2026.1
  ```

- Every source must be one you actually read in this run. Never write a URL
  or a figure from memory.
- Mention in your worklog which queries you ran and against which sources,
  so a human can repeat or extend the research.
