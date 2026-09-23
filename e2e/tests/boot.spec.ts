// Placeholder journey test (P0b). W7 replaces this with j1-1-start-from-seed
// etc. Proves the whole stack boots on the fake runtime through a real
// browser: web dev server -> proxy -> placeholder server -> WS hello.

import { test, expect } from "@playwright/test";

test("boot page reports the server connected over WS", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("boot-status")).toHaveText(/server connected \(WS\) — runtime: fake/, {
    timeout: 15_000,
  });
});
