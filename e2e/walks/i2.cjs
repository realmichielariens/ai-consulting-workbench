// Acceptance walk for I2 (J2.1-J2.8) against a running `pnpm dev:fake` on :5317.
// Run from the repo root: node e2e/walks/i2.cjs
// It starts a blank engagement with the (fake) Approach Agent each time. The fake
// conversation script picks a turn by keyword (stakeholder|correct, benchmark,
// where are we|status), so the kick-off messages avoid those words.
// Screenshots of failures go to e2e/walks/out/.
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
  page.on("console", (m) => m.type() === "error" && !/409/.test(m.text()) && errors.push("console: " + m.text()));
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.stack || e.message).split("\n").slice(0, 4).join(" | ")));
  // A 409 on posting a message is the D5 "turn still running" signal, which the UI queues.
  page.on("response", (r) => r.status() >= 400 && !(r.status() === 409 && /\/messages$/.test(r.url())) && errors.push(`http ${r.status()} ${r.url()}`));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, "i2-" + n + ".png") });
  const step = async (name, fn) => {
    try { await fn(); log("OK  ", name); }
    catch (e) { log("FAIL", name, "-", e.message.split("\n")[0]); await shot("FAIL-" + name.replace(/\W+/g, "_")); throw e; }
  };
  // UX1 (UX1-PLAN §7): decisions on the Brief, reviews in the document's review bar,
  // human work on the Item page, the conversation in the Kick-off stage or the rail.
  const brief = page.getByTestId("brief-page");
  const chat = page.getByTestId("chat-panel");
  const goHome = async () => { await page.getByTestId("nav-home").click(); await brief.waitFor({ timeout: T }); };
  const goPlan = async () => { await page.getByTestId("nav-plan").click(); await page.getByTestId("process-view").waitFor({ timeout: T }); };
  /** The conversation is in the stage during the Kick-off, else in the rail: open the rail if it is collapsed. */
  const showChat = async () => {
    if (!(await chat.isVisible())) await page.getByTestId("rail-toggle").click();
    await chat.waitFor({ timeout: T });
  };
  /** FYIs are collapsed into one "N updates" row on the Brief. */
  const showFyis = async () => {
    const toggle = brief.getByTestId("fyi-updates-toggle");
    await toggle.waitFor({ timeout: T });
    if (!/hide/i.test(await toggle.innerText())) await toggle.click();
  };
  /** Opens the top review card's document and acts in its review bar, then returns to the Brief. */
  const review = async (act) => {
    await goHome();
    const card = brief.getByTestId("inbox-card-review").first();
    await card.waitFor({ timeout: T });
    await card.getByTestId("review-open").click();
    const bar = page.getByTestId("review-bar");
    await bar.waitFor({ timeout: T });
    await act(bar);
    await bar.waitFor({ state: "detached", timeout: T });
    await goHome();
  };
  const approachMessages = () => page.locator('[data-testid="chat-message"][data-role="approach"]');
  /** Sends a chat message and waits for the Approach Agent's reply to that turn. */
  const say = async (text) => {
    await showChat();
    const before = await approachMessages().count();
    await page.getByTestId("chat-input").fill(text);
    await page.getByTestId("chat-send").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="chat-message"][data-role="approach"]').length > n,
      before,
      { timeout: T },
    );
  };
  const eidOf = () => decodeURIComponent(new URL(page.url()).pathname.split("/")[2]);
  const apiGet = (p) => page.evaluate(async (url) => (await fetch(url)).json(), p);
  let originalProfile = null;

  try {
    await step("J2.1 start with the Approach Agent", async () => {
      await page.goto(WEB_URL);
      originalProfile = (await apiGet("/api/profile")).active;
      await page.getByTestId("start-with-approach").click();
      await page.waitForURL(/\/e\//, { timeout: T });
      await page.getByTestId("chat-panel").waitFor({ timeout: T });
    });
    await step("J2.1 kick-off: clarifying questions", async () => {
      await say(
        "We are starting an IT strategy for Acme Manufacturing Corp. The CEO commissioned it on the board's behalf; " +
          "the board wants a deck in six weeks and steerco endorsement.",
      );
      await shot("01-clarifying");
    });
    await step("J2.1 answers → context + stakeholders published, plan proposed", async () => {
      await say("Four C-suite interviews: CEO, CFO, COO and CIO. The CIO is three months in the role. One human does the interviews.");
      await page.getByTestId("chat-asset-link").nth(1).waitFor({ timeout: T });
      await page.getByTestId("proposal-card").first().waitFor({ timeout: T });
      await page.getByTestId("kickoff-asset-ENG/context").waitFor({ timeout: T });
      await page.getByTestId("kickoff-asset-ENG/stakeholders").waitFor({ timeout: T });
      await shot("02-proposal");
    });
    await step("J2.1 correction → stakeholders v1.1", async () => {
      await say("Please correct the stakeholders list: Dev Anand joins part of the CIO interview.");
      await page.getByTestId("chat-asset-link").filter({ hasText: "1.1" }).first().waitFor({ timeout: T });
    });
    await step("J2.1 reload resumes the same conversation", async () => {
      const n = await page.getByTestId("chat-message").count();
      await page.reload();
      await showChat();
      await page.getByTestId("chat-message").nth(n - 1).waitFor({ timeout: T });
    });
    await step("J2.2 preview the proposal, then approve", async () => {
      const card = chat.getByTestId("proposal-card").first();
      if ((await card.getByTestId("proposal-op").count()) < 5) throw new Error("expected at least 5 readable operations");
      await card.getByTestId("proposal-preview-toggle").click();
      await page.getByTestId("preview-banner").waitFor({ timeout: T });
      await page.getByTestId("process-node-WI-002").waitFor({ timeout: T });
      await shot("03-preview");
      await page.getByTestId("preview-exit").click();
      await page.getByTestId("preview-banner").waitFor({ state: "detached", timeout: T });
      await page.getByTestId("nav-home").click();
      await showChat();
      await chat.getByTestId("proposal-card").first().getByTestId("proposal-approve").click();
      await page.getByTestId("plan-version").filter({ hasText: "v2" }).waitFor({ timeout: T });
      await brief.waitFor({ timeout: T }); // with an approved plan, home is the Brief
      await goPlan();
      await page.getByTestId("process-node-WI-002").waitFor({ timeout: T });
    });
    await step("J2.3 WI-002's question is answered by the Approach Agent (FYI)", async () => {
      await goHome();
      await showFyis();
      const fyi = brief.getByTestId("inbox-card-fyi").filter({ hasText: /Approach Agent/ }).first();
      await fyi.waitFor({ timeout: T });
      await shot("04-fyi");
    });
    await step("J2.3 override the answer once WI-002 is at its gate", async () => {
      const reviewCard = brief.getByTestId("inbox-card-review");
      await reviewCard.waitFor({ timeout: T });
      await showFyis();
      const fyi = brief.getByTestId("inbox-card-fyi").filter({ hasText: /Approach Agent/ }).first();
      await fyi.getByTestId("fyi-override-open").click();
      await fyi.getByTestId("fyi-override-text").fill("Focus on her forward vision, but include one question on inherited commitments.");
      await fyi.getByTestId("fyi-override-submit").click();
      await reviewCard.waitFor({ state: "detached", timeout: T });
    });
    await step("J2.3 re-run reaches the gate → approve", async () => {
      await review((bar) => bar.getByTestId("review-approve").click());
      if (await brief.getByTestId("fyi-updates-toggle").count()) {
        await showFyis();
        const fyi = brief.getByTestId("inbox-card-fyi").first();
        if (await fyi.count()) await fyi.getByTestId("fyi-dismiss").click();
      }
    });
    await step("J1.6 human item uploads + mark done", async () => {
      await goHome();
      const card = brief.locator('[data-testid="inbox-card-human-item"][data-item-id="WI-003"]');
      await card.waitFor({ timeout: T });
      await card.getByTestId("human-item-open").click();
      const work = page.getByTestId("your-work");
      await work.waitFor({ timeout: T });
      for (const who of ["ceo", "cfo", "coo", "cio"]) {
        await work.getByTestId(`upload-input-notes-${who}`).setInputFiles(path.join(ROOT, `demo/interview-notes/notes-${who}.md`));
        await work.getByTestId(`upload-slot-notes-${who}`).getByText(/1\.0/).waitFor({ timeout: T });
      }
      await work.getByTestId("mark-done").click();
      await work.waitFor({ state: "detached", timeout: T }); // Your work shows only while the item is ready or in progress
      await goHome();
    });
    await step("J2.5 WI-004 suggests a CFO follow-up → approve the proposal", async () => {
      await goHome();
      const card = brief.getByTestId("inbox-card-proposal");
      await card.waitFor({ timeout: T });
      await card.getByTestId("proposal-suggested-by").filter({ hasText: /WI-004/i }).waitFor({ timeout: T });
      await shot("05-suggestion");
      await card.getByTestId("proposal-approve").click();
      await card.waitFor({ state: "detached", timeout: T });
      await goPlan();
      await page.getByTestId("process-node-WI-003e").waitFor({ timeout: T });
    });
    await step("J1.5 WI-004 review → approve", async () => {
      await review((bar) => bar.getByTestId("review-approve").click());
    });
    await step("J2.6 human asks for a change → reject with a reason", async () => {
      await say("Add a short benchmarking item before synthesis.");
      const card = chat.getByTestId("proposal-card").last();
      await card.getByTestId("proposal-reject-open").click();
      await card.getByTestId("proposal-reject-reason").fill("Scope it to three peers first.");
      await card.getByTestId("proposal-reject-submit").click();
      await card.getByTestId("proposal-status").filter({ hasText: /rejected/i }).waitFor({ timeout: T });
    });
    await step("J2.6 ask again → approve → WI-005 appears", async () => {
      await say("Fine as proposed, please add the benchmarking item after all.");
      const card = chat.getByTestId("proposal-card").last();
      await card.getByTestId("proposal-approve").click();
      await goPlan();
      await page.getByTestId("process-node-WI-005").waitFor({ timeout: T });
    });
    await step("J2.4 WI-005's question is escalated → amend", async () => {
      await goHome();
      const card = brief.getByTestId("inbox-card-question");
      await card.waitFor({ timeout: T });
      await card.getByTestId("question-escalation-view").waitFor({ timeout: T });
      await shot("06-escalated");
      await card.getByTestId("question-amend-open").click();
      const box = card.getByTestId("question-answer-text");
      await box.fill((await box.inputValue()) + " Include one European peer.");
      await card.getByTestId("question-answer-submit").click();
      await card.waitFor({ state: "detached", timeout: T });
      await page.waitForFunction(
        async (eid) => (await (await fetch(`/api/engagements/${eid}/plan`)).json()).items.find((i) => i.id === "WI-005")?.status === "done",
        eidOf(),
        { timeout: T, polling: 1000 },
      );
    });
    await step("J2.7 where are we?", async () => {
      await say("Where are we?");
      const text = await approachMessages().last().innerText();
      if (!/done/i.test(text)) throw new Error(`status answer lacks "done": ${text.slice(0, 200)}`);
      await shot("07-status");
    });
    await step("J2.8 settings: question handling and profile", async () => {
      const eid = eidOf();
      await page.getByTestId("open-settings").click();
      const panel = page.getByTestId("settings-panel");
      await panel.waitFor({ timeout: T });
      await panel.getByTestId("setting-question-handling").selectOption("always-human");
      await page.waitForFunction(async (id) => (await (await fetch(`/api/engagements/${id}`)).json()).settings.questionHandling === "always-human", eid, { timeout: T, polling: 500 });
      await panel.getByTestId("setting-question-handling").selectOption("aa-first");
      await page.waitForFunction(async (id) => (await (await fetch(`/api/engagements/${id}`)).json()).settings.questionHandling === "aa-first", eid, { timeout: T, polling: 500 });
      const before = (await apiGet("/api/profile")).active;
      const other = before === "test" ? "demo" : "test";
      await panel.getByTestId("setting-profile").selectOption(other);
      await page.waitForFunction(async (p) => (await (await fetch("/api/profile")).json()).active === p, other, { timeout: T, polling: 500 });
      await panel.getByTestId("setting-profile").selectOption(before);
      await page.waitForFunction(async (p) => (await (await fetch("/api/profile")).json()).active === p, before, { timeout: T, polling: 500 });
      await shot("08-settings");
      await panel.getByTestId("settings-close").click();
    });
    await step("D4 approach journal tab renders", async () => {
      await showChat();
      await page.getByTestId("rail-journal").click();
      await page.getByTestId("approach-journal").waitFor({ timeout: T });
    });
  } catch { process.exitCode = 1; }
  // The profile is workspace-wide: never leave it on "demo" (Opus) if the walk stopped halfway.
  if (originalProfile) {
    await page.evaluate(async (p) => {
      await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: p }) });
    }, originalProfile).catch(() => {});
  }
  log("URL", page.url());
  log("ERRORS", errors.length ? "\n  " + [...new Set(errors)].slice(0, 20).join("\n  ") : "none");
  if (errors.length) process.exitCode = 1;
  await browser.close();
})();
