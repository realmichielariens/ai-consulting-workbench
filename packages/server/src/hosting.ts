// What a hosted showcase deploy needs on top of the local server
// (docs/DEPLOY-FLY.md): one shared password in front of everything, and the
// built web app served from the same origin as the API and WebSocket. Locally
// neither is registered, so `pnpm dev` behaves as before.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const COOKIE = "workbench_session";
const LOGIN_PATH = "/api/login";
/** Fly's health check must get through without the password. */
const OPEN_PATHS = new Set(["/api/health", LOGIN_PATH]);

/** The cookie value: an HMAC of the password, so the password itself never sits in the browser. */
function sessionToken(password: string): string {
  return crypto.createHmac("sha256", password).update("workbench-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

const LOGIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workbench</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f6f5f2; color: #1d1c1a; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form { background: #fff; border: 1px solid #e2dfd8; border-radius: 10px; padding: 28px; width: min(320px, calc(100vw - 32px)); display: grid; gap: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  input, button { font: inherit; padding: 9px 11px; border-radius: 6px; border: 1px solid #cfcbc2; }
  button { background: #1d1c1a; color: #fff; border-color: #1d1c1a; cursor: pointer; }
  .err { color: #b3261e; font-size: 14px; min-height: 1.2em; margin: 0; }
</style></head>
<body><form id="f"><h1>Agentic Project Workbench</h1>
<input id="p" type="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button type="submit">Enter</button><p class="err" id="e"></p></form>
<script>
document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const r = await fetch("${LOGIN_PATH}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: document.getElementById("p").value }) });
  if (r.ok) location.reload(); else document.getElementById("e").textContent = "Wrong password.";
});
</script></body></html>`;

/** Everything except the open paths needs the session cookie; pages without it get the login form. */
export function registerPasswordGate(app: FastifyInstance, password: string, secureCookie: boolean): void {
  const token = sessionToken(password);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const urlPath = req.url.split("?")[0]!;
    if (OPEN_PATHS.has(urlPath)) return;
    const cookie = readCookie(req, COOKIE);
    if (cookie && safeEqual(cookie, token)) return;
    if (urlPath.startsWith("/api/")) return reply.code(401).send({ error: "unauthorized", message: "log in first" });
    return reply.code(200).type("text/html; charset=utf-8").header("cache-control", "no-store").send(LOGIN_HTML);
  });

  app.post(LOGIN_PATH, async (req, reply) => {
    const given = (req.body as { password?: unknown } | null)?.password;
    if (typeof given !== "string" || !safeEqual(sessionToken(given), token)) {
      // A fixed delay makes guessing slow without any state to keep.
      await new Promise((r) => setTimeout(r, 750));
      return reply.code(401).send({ error: "unauthorized", message: "wrong password" });
    }
    const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${60 * 60 * 24 * 30}`, ...(secureCookie ? ["Secure"] : [])];
    reply.header("set-cookie", `${COOKIE}=${token}; ${attrs.join("; ")}`);
    return { ok: true };
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

/** Serves apps/web/dist: a file when one matches, else index.html so client-side routes survive a reload. */
export function registerWebApp(app: FastifyInstance, distDir: string): void {
  const root = path.resolve(distDir);
  const indexHtml = path.join(root, "index.html");

  app.setNotFoundHandler(async (req, reply) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]!);
    if (req.method !== "GET" || urlPath.startsWith("/api/")) {
      return reply.code(404).send({ error: "not_found", message: `${req.method} ${urlPath}` });
    }
    const file = path.resolve(root, `.${urlPath}`);
    const inside = !path.relative(root, file).startsWith("..");
    if (inside && fs.existsSync(file) && fs.statSync(file).isFile()) {
      // Vite fingerprints everything under assets/, so those can be cached for good.
      const immutable = urlPath.startsWith("/assets/");
      return reply
        .type(CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream")
        .header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
        .send(fs.createReadStream(file));
    }
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").send(fs.createReadStream(indexHtml));
  });
}
