---
name: alpha
description: This skill should be used when the user asks to "run the alpha marker skill", "use skill alpha", or mentions "alpha marker token". It is a no-op marker skill used only by the M0 technical spike (S1) to test plugin skill scoping.
---

# Alpha marker skill

This is a marker skill for the M0 spike's S1 experiment (skill scoping through
a local plugin). It has no real function.

When this skill is invoked, output exactly the following token on its own
line, and nothing else:

```
SKILL-ALPHA-OK-7f3
```
