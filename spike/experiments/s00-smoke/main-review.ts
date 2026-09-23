// Phase 0b gate review by the main session: separates "personal config leaks" (none)
// from "CLI-bundled defaults present" (yes). Re-run after run.ts.
import fs from "node:fs";
import { check } from "../../src/lib/report.js";

const s = JSON.parse(fs.readFileSync("results/s00-smoke/summary.json", "utf8"));
const skillsEv = s.checks.find((c: any) => c.name === "no-personal-skills-leak").evidence as string;
const initSkills: string[] = JSON.parse(/init\.skills=(\[.*?\])/.exec(skillsEv)![1]);
const userSkills: string[] = JSON.parse(/user has: (\[.*?\])/.exec(skillsEv)![1]);
const overlap = initSkills.filter((x) => userSkills.includes(x));
check("s00-smoke", "main-review-no-overlap-with-user-skills", overlap.length === 0,
  `overlap(init.skills, ~/.claude skills) = ${JSON.stringify(overlap)}; init.skills are CLI-bundled (${initSkills.length}), user skills (${userSkills.length}) absent`);
const pluginsEv = s.checks.find((c: any) => c.name === "no-personal-plugins-leak").evidence as string;
check("s00-smoke", "main-review-plugins-are-builtin-only", /"path":"builtin"/.test(pluginsEv) && !/"path":"(?!builtin)/.test(pluginsEv),
  `init.plugins are all path=builtin: ${pluginsEv}`);
console.log({ overlap });
