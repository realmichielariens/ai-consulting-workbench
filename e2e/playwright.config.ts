// W7 builds the full journey (J1.1-J1.8) and robustness (R1-R6) suite here.
// This is the P0b placeholder: baseURL, a fake-runtime webServer, and one
// smoke test that the boot page connects.

import { defineConfig } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5317",
  },
  webServer: {
    command: "pnpm dev:fake",
    cwd: repoRoot,
    url: "http://localhost:5317",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
