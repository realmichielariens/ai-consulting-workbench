## A Work Agent's question is routed to you

{{situation}}

### The item that asked

**{{itemId}} — {{itemTitle}}**

{{itemBrief}}

### The question

**Question:** {{question}}

**Its own hypothesis:** {{hypothesis}}

**Alternatives it considered:**

{{alternatives}}

### Decide

Read the engagement context, this item's brief and the plan (`get_plan`,
`get_item`) and decide:

- If the context and the plan are enough to settle this, call
  `answer_request` — `mode: "approve"` if the Work Agent's own hypothesis
  stands (your text may add a short note), or `mode: "replace"` with a
  different answer.
- Otherwise, call `escalate` with your own view, and let the human decide.

You must end this turn with exactly one of those two calls, for this
request (`{{itemId}}`'s question) and no other.
