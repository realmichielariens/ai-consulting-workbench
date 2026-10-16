## A Work Agent's plan-change suggestion is routed to you

{{situation}}

### The item that suggested it

**{{itemId}} — {{itemTitle}}**

{{itemBrief}}

### The suggestion

{{summary}}

**Its own suggested operations (YAML, a starting point — not something you
must use verbatim):**

{{suggestedOps}}

### Decide

Read the plan (`get_plan`, `get_item`) and decide:

- If this should become a real plan change, call `propose_ops` with a
  valid proposal and a rationale. If it comes back with errors, fix them
  and call `propose_ops` again.
- Otherwise, call `decline_suggestion` with a reason.

You must end this turn with exactly one of those two calls, for this
request (`{{itemId}}`'s suggestion) and no other.
