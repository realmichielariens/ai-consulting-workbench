#!/usr/bin/env node
// A dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0),
// for trying user-defined sources (docs/USER-MCP-SOURCES-PLAN.md) without a
// third-party server: add it as a stdio source with command `node` and this
// file's absolute path as the one argument. Tools: `echo` and `lookup` (a
// canned record). Nothing here touches the network or the disk.

import readline from "node:readline";

const SERVER_INFO = { name: "echo-mcp-server", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-06-18";

const RECORDS = {
  "acme-erp": {
    id: "acme-erp",
    title: "Acme ERP landscape (fixture)",
    url: "https://example.com/fixtures/acme-erp",
    body: "Acme runs one ERP instance across three plants; the finance module was upgraded in 2025. Illustrative fixture data.",
  },
};

const TOOLS = [
  {
    name: "echo",
    description: "Returns the text you send, unchanged. For checking that the source is wired up.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "Text to echo back." } }, required: ["text"] },
  },
  {
    name: "lookup",
    description: `Returns a canned record by id. Known ids: ${Object.keys(RECORDS).join(", ")}.`,
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Record id." } }, required: ["id"] },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function text(body, isError = false) {
  return { content: [{ type: "text", text: body }], isError };
}

function callTool(name, args) {
  if (name === "echo") return text(String(args?.text ?? ""));
  if (name === "lookup") {
    const record = RECORDS[String(args?.id ?? "")];
    return record ? text(JSON.stringify(record, null, 2)) : text(`No record with id "${args?.id}". Known ids: ${Object.keys(RECORDS).join(", ")}.`, true);
  }
  return null;
}

function handle(msg) {
  const isRequest = msg.id !== undefined && msg.id !== null;
  switch (msg.method) {
    case "initialize":
      reply(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      reply(msg.id, {});
      return;
    case "tools/list":
      reply(msg.id, { tools: TOOLS });
      return;
    case "tools/call": {
      const result = callTool(msg.params?.name, msg.params?.arguments);
      if (result) reply(msg.id, result);
      else fail(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      return;
    }
    default:
      if (isRequest) fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  handle(msg);
});
// The client closing stdin is the shutdown signal (MCP stdio transport); never linger as an orphan.
rl.on("close", () => process.exit(0));
