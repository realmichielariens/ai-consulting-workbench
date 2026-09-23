// S3 — Guard hooks. Thin entry point: the actual, independently re-runnable
// canary test lives in canary-test.ts (M0-SPIKE-PLAN.md §4 S3 asks for "a
// single re-runnable script experiments/s03-guards/canary-test.ts [that]
// prints a clear PASS/FAIL"). This file exists so
// `npx tsx experiments/s03-guards/run.ts` also works, per spike/README.md
// convention 9.
import { runCanaryTest } from "./canary-test.js";

runCanaryTest()
  .then(({ pass }) => {
    process.exitCode = pass ? 0 : 1;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
