// Acceptance walk for I1 (J1.1-J1.8) against a running `pnpm dev:fake` on :5317.
// Run from the repo root: node e2e/walks/i1.cjs
// It creates a new engagement each time; screenshots of failures go to e2e/walks/out/.
// I2: the acme seed defaults to aa-first (decision D3), so the walk switches the
// new engagement to always-human right away to exercise the direct J1.4 path, and
// rejects the plan change WI-004 suggests (J2.5) before checking the empty Inbox.
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(__dirname, "out");
fs.mkdirSync(SHOTS, { recursive: true });
const T = 90_000;
const WEB_URL = process.env.WORKBENCH_WEB_URL || "http://localhost:5317/";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + ".png") });
  const step = async (name, fn) => {
    try { await fn(); const c = await page.evaluate(() => [document.querySelectorAll(".react-flow__node").length, document.querySelectorAll(".react-flow__edge").length]); log("OK  ", name, "nodes/edges", c.join("/")); }
    catch (e) { log("FAIL", name, "-", e.message.split("\n")[0]); await shot("FAIL-" + name.replace(/\W+/g, "_")); throw e; }
  };

  try {
    await step("J1.1 start page", async () => {
      await page.goto(WEB_URL);
      await page.getByTestId("seed-card").first().waitFor({ timeout: T });
      await shot("01-start");
    });
    await step("J1.1 create engagement", async () => {
      await page.getByTestId("create-engagement-button").first().click();
      await page.waitForURL(/\/e\//, { timeout: T });
      const eid = decodeURIComponent(new URL(page.url()).pathname.split("/")[2]);
      const status = await page.evaluate(async (id) => {
        const res = await fetch(`/api/engagements/${id}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionHandling: "always-human" }),
        });
        return res.status;
      }, eid);
      if (status !== 200) throw new Error(`PATCH settings returned ${status}`);
      await page.getByTestId("process-view").waitFor({ timeout: T });
      await page.getByTestId("process-node-WI-002").waitFor({ timeout: T });
      await shot("02-process");
    });
    await step("J1.3 open WI-002 detail + activity", async () => {
      await page.getByTestId("process-node-WI-002").click();
      await page.getByTestId("item-detail").waitFor({ timeout: T });
      await page.getByTestId("activity-item").first().waitFor({ timeout: T });
      await shot("03-activity");
    });
    await step("J1.4 question arrives + amend", async () => {
      const card = page.getByTestId("inbox-card-question");
      await card.waitFor({ timeout: T });
      await shot("04-question");
      await card.getByTestId("question-amend-open").click();
      const box = card.getByTestId("question-answer-text");
      await box.fill((await box.inputValue()) + " Also ask explicitly about inherited commitments.");
      await card.getByTestId("question-answer-submit").click();
      await card.waitFor({ state: "detached", timeout: T });
    });
    await step("J1.5 review → request changes", async () => {
      const card = page.getByTestId("inbox-card-review");
      await card.waitFor({ timeout: T });
      await shot("05-review");
      await card.getByTestId("review-request-changes-open").click();
      await card.getByTestId("review-comments").fill("Add a closing question on decision rights per executive.");
      await card.getByTestId("review-request-changes-submit").click();
      await card.waitFor({ state: "detached", timeout: T });
    });
    await step("J1.5 second review → approve", async () => {
      const card = page.getByTestId("inbox-card-review");
      await card.waitFor({ timeout: T });
      await card.getByTestId("review-approve").click();
      await card.waitFor({ state: "detached", timeout: T });
    });
    await step("J1.6 human item uploads + mark done", async () => {
      const card = page.getByTestId("inbox-card-human-item");
      await card.waitFor({ timeout: T });
      await shot("06-human-item");
      for (const who of ["ceo", "cfo", "coo", "cio"]) {
        await card.getByTestId(`upload-input-notes-${who}`).setInputFiles(path.join(ROOT, `demo/interview-notes/notes-${who}.md`));
        await card.getByTestId(`upload-slot-notes-${who}`).getByText(/v1\.0/).waitFor({ timeout: T });
      }
      await card.getByTestId("mark-done").click();
      await card.waitFor({ state: "detached", timeout: T });
    });
    await step("J1.5 WI-004 review → approve", async () => {
      const card = page.getByTestId("inbox-card-review");
      await card.waitFor({ timeout: T });
      await card.getByTestId("review-approve").click();
      await card.waitFor({ state: "detached", timeout: T });
    });
    await step("J2.5 reject WI-004's suggested plan change", async () => {
      const card = page.getByTestId("inbox-card-proposal");
      await card.waitFor({ timeout: T });
      await card.getByTestId("proposal-reject-open").click();
      await card.getByTestId("proposal-reject-reason").fill("Not part of the I1 walk.");
      await card.getByTestId("proposal-reject-submit").click();
      await card.waitFor({ state: "detached", timeout: T });
    });
    await step("all done, inbox empty", async () => {
      await page.getByTestId("inbox-empty").waitFor({ timeout: T });
      await page.getByTestId("process-node-WI-004").click();
      await shot("07-final");
    });
    await step("J1.8 open folder shows path", async () => {
      await page.getByTestId("open-folder").click();
      await page.getByTestId("folder-path").waitFor({ timeout: T });
    });
  } catch { process.exitCode = 1; }
  log("URL", page.url());
  log("ERRORS", errors.length ? "\n  " + [...new Set(errors)].slice(0, 20).join("\n  ") : "none");
  if (errors.length) process.exitCode = 1;
  await browser.close();
})();
