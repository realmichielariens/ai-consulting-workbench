#!/usr/bin/env node
// node --import tsx packages/agents/src/dev/try-source-test.ts [<command> [args...]]
// Runs one real "Test connection" (sourceTest.ts) through the Claude Code CLI:
// starts the stdio MCP server, lists its tools, closes. No prompt is sent, so
// it makes no model call and costs nothing. Without arguments it tests the
// echo fixture (dev/fixtures/echo-mcp-server.mjs) started as `node <fixture>`,
// which on Windows also exercises the `cmd /c` wrap.

import fs from "node:fs";
import path from "node:path";
import { loadConfig, repoRoot, sdkEnv, workspacePaths } from "@workbench/core/node";
import { testSourceConnection } from "../sourceTest.js";

async function main(): Promise<void> {
  const root = repoRoot();
  const workspace = workspacePaths(loadConfig(root).resolved.home);
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== "--");
  const connection = command
    ? { type: "stdio" as const, command, args }
    : { type: "stdio" as const, command: "node", args: [path.resolve(import.meta.dirname, "fixtures", "echo-mcp-server.mjs")] };

  fs.mkdirSync(workspace.home, { recursive: true });
  console.log(`Testing: ${connection.command} ${connection.args.join(" ")}`);
  const started = Date.now();
  const result = await testSourceConnection(connection, {
    repoRoot: root,
    cwd: workspace.home,
    buildEnv: () => sdkEnv(root, workspace, { requireAuth: false }),
  });
  console.log(`status:     ${result.status} (${Date.now() - started} ms)`);
  if (result.error) console.log(`error:      ${result.error}`);
  if (result.serverInfo) console.log(`server:     ${result.serverInfo.name} ${result.serverInfo.version}`);
  for (const t of result.tools) console.log(`tool:       ${t.name}${t.description ? ` - ${t.description}` : ""}`);
  if (result.missingSecrets.length > 0) console.log(`missing:    ${result.missingSecrets.join(", ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
