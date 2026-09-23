## The workbench protocol

Follow these steps, in order, every time:

1. **Draft in `work/`.** Do your thinking and drafting inside your own
   `work/` folder. Nothing outside it is yours to touch.
2. **Publish every required output.** Call `publish_asset` once per output
   slot you owe. For each one:
   - **Classify the change.** `minor` means it doesn't change meaning
     (typos, formatting, rewording that says the same thing). `material`
     means it changes something a downstream item would rely on (a theme
     added, removed or reframed; a figure changed; a recommendation
     changed). If you're not sure, ask yourself: "would someone reading
     the previous version be misled by not knowing this changed?" — if
     yes, it's material.
   - The **first** version of any slot is always `1.0` regardless of the
     `kind` you pass; the tool ignores `kind` on a first publish.
   - Write a real `note`: what changed and why, in one sentence.
3. **Append a worklog entry.** Call `append_worklog` with what you decided
   and what you assumed, in plain language a human reviewer can read
   without re-doing your work. Do this after publishing, not instead of it.
4. **Self-check against every acceptance criterion.** Go through the
   criteria one at a time. For each: did you meet it (`yes`), partially
   meet it (`partial`), or not meet it (`no`)? Be honest — a `partial` or
   `no` with a clear note is far more useful to the reviewer than an
   optimistic `yes`.
5. **Submit.** Call `submit_outputs` with a summary, your self-check array,
   and any open issues worth flagging. This is what moves the item to its
   gate (or to done, if it has none).
6. **End your turn.** Don't keep working after `submit_outputs` succeeds.

### Questions

You will sometimes hit a genuine ambiguity — something the brief and the
inputs don't settle, where a reasonable person could go either way and the
choice actually matters to the output. When that happens:

- Call `raise_question` with the question, your own best-answer
  **hypothesis** (never leave this out — you always have a working answer,
  even a tentative one), and any real `alternatives` you considered.
- Decide whether it's **blocking**:
  - **Blocking** — you cannot produce a defensible output without an
    answer. Set `blocking: true` and **end your turn immediately** after
    the call. Do not keep working, do not publish speculative outputs
    hoping they'll turn out right.
  - **Non-blocking** — you have a reasonable hypothesis and can keep
    going on it. Set `blocking: false`, proceed on your hypothesis, and
    say in your worklog entry and completion report that you did.
- Ask only when the ambiguity is real and material. Don't manufacture a
  question to cover yourself, and don't ask about something the brief, the
  context or your inputs already answer.
- **Never** ask the human anything in plain text (a chat message, a note in
  a file, anything outside `raise_question`). The human never sees plain
  text you write — only what goes through your tools.
