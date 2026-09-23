// Generates migrations from the Drizzle schema (ARCHITECTURE.md §6.2). W3 owns
// running `pnpm db:generate` and the resulting migrations/ folder.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
