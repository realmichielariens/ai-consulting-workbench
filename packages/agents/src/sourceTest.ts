// "Test connection" for a Source listing (USER-MCP-SOURCES-PLAN Decision 5):
// start the server once through the real CLI, report whether it connected and
// which tools it offers. No prompt is ever sent, so no model call is made and
// the test costs nothing. Curated connection types answer without spawning.

import { sourceServerName, type SourceConnection, type SourceTestResult } from "@workbench/core";
import { probeMcpServer, WEB_TOOLS, type ProbeMcpServerArgs, type ProbeMcpServerResult } from "./sdk.js";
import { externalServerConfig, type ResolveSourcesOptions } from "./sourceResolver.js";

export type ProbeFn = (args: ProbeMcpServerArgs) => Promise<ProbeMcpServerResult>;

export interface TestSourceConnectionOptions extends Pick<ResolveSourcesOptions, "repoRoot" | "resolveRef" | "platform"> {
  /** Builds the clean child env (sdkEnv). Lazy: a mock/builtin-web test or a missing secret never needs a credential. */
  buildEnv: () => NodeJS.ProcessEnv;
  /** Where the CLI (and a stdio server) starts. */
  cwd: string;
  /** Defaults to 20 s. */
  timeoutMs?: number;
  /** Defaults to sdk.ts probeMcpServer; tests inject a stand-in so they never spawn the CLI. */
  probe?: ProbeFn;
}

/** The signature the server holds (ServerContext.testSource) so its tests can replace the whole thing. */
export type TestSourceConnectionFn = (connection: SourceConnection, opts: TestSourceConnectionOptions) => Promise<SourceTestResult>;

const DEFAULT_TIMEOUT_MS = 20_000;
// Any stable name will do: the server only lives for the test.
const PROBE_SERVER_NAME = sourceServerName("connection-test");

export async function testSourceConnection(connection: SourceConnection, opts: TestSourceConnectionOptions): Promise<SourceTestResult> {
  switch (connection.type) {
    case "builtin-web":
      return { status: "connected", error: null, serverInfo: null, tools: WEB_TOOLS.map((name) => ({ name })), missingSecrets: [] };
    case "mock":
      return {
        status: "connected",
        error: null,
        serverInfo: null,
        tools: [
          { name: "search", description: "Search the dataset's records." },
          { name: "get", description: "Read one record by id." },
        ],
        missingSecrets: [],
      };
    case "stdio":
    case "http": {
      const external = externalServerConfig(connection, opts);
      if (!external.ok) {
        return {
          status: "failed",
          error: `Not started: ${external.missing.map((n) => `\${env:${n}}`).join(", ")} could not be resolved (process env, .env, or user environment).`,
          serverInfo: null,
          tools: [],
          missingSecrets: external.missing,
        };
      }
      const probe = opts.probe ?? probeMcpServer;
      const result = await probe({
        name: PROBE_SERVER_NAME,
        config: external.config,
        env: opts.buildEnv(),
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      // "disabled" can't happen for a server passed in mcpServers; report it as a failure rather than widen the contract.
      const status = result.status === "disabled" ? "failed" : result.status;
      return { status, error: result.error, serverInfo: result.serverInfo, tools: result.tools, missingSecrets: [] };
    }
  }
}
