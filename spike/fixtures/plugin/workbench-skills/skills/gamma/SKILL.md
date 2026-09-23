---
name: gamma
description: This skill should be used when the user asks to "run the gamma marker skill", "use skill gamma", or mentions "gamma marker token" or "gamma script". It is a marker skill used only by the M0 technical spike (S1) to test that a skill can find and run its own bundled script.
allowed-tools: Bash
---

# Gamma marker skill

This is a marker skill for the M0 spike's S1 experiment (skill scoping
through a local plugin, and a skill's ability to locate its own bundled
script directory).

First, output exactly the following token on its own line:

```
SKILL-GAMMA-OK-a41
```

Then run this skill's bundled script and report its output too. The script
lives in a `scripts/` folder next to this SKILL.md file, at
`scripts/token.mjs`. Try, in order, whichever of these actually resolves in
your environment, and use the first one that works:

1. If a skill-directory variable such as `${CLAUDE_SKILL_DIR}` (or similar)
   is available, run: `node "${CLAUDE_SKILL_DIR}/scripts/token.mjs"`
2. Otherwise, run the script with a path relative to this SKILL.md file's
   own directory, e.g. `node skills/gamma/scripts/token.mjs` (adjust the
   relative path to wherever you can locate this file).
3. If neither resolves, say explicitly which resolution method you tried
   and that the script could not be located, and output nothing further.

Run the script with the `Bash` tool (`node <path-to-token.mjs>`), and output
its stdout verbatim.
