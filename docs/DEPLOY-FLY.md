# Deploying the showcase to Fly.io

This is a showcase of the idea, not a release. One machine runs one server, protected by one shared password.

## What is different from local

| | Local (`pnpm dev`) | Fly (hosted) |
|---|---|---|
| Listens on | `127.0.0.1` | `0.0.0.0:8080` (`WORKBENCH_HOST`, `PORT`) |
| Access | none needed | one password (`WORKBENCH_PASSWORD`): login page, then a 30-day HttpOnly cookie |
| Web app | Vite dev server | built `apps/web/dist`, served by the server itself (`WORKBENCH_WEB_DIST`) |
| Workspace | `./workspace` | `/data/workspace` on a Fly volume (`WORKBENCH_HOME`) |
| Agent credential | subscription token or API key | **API key only** (`WORKBENCH_AUTH=api-key`) |
| stdio MCP sources | allowed | **refused** (`WORKBENCH_HOSTED=1`): the form offers http only, the API rejects stdio, and runs leave out any stdio listing |

The server refuses to start on a non-local address without `WORKBENCH_PASSWORD`.

**Why an API key:** the Agent SDK terms don't allow claude.ai login or subscription rate limits in something offered to other people.

**Why no stdio:** a stdio source runs a command on the server, and that machine holds the API key.

## First deploy

Run these from the repo root with `fly` logged in (`fly auth login`). The app name in `fly.toml` is a random string, so the URL is `https://wb-bee492c6678ad9216368.fly.dev`.

```sh
fly apps create wb-bee492c6678ad9216368
fly volumes create workbench_data --region ams --size 1 --app wb-bee492c6678ad9216368
fly secrets set ANTHROPIC_API_KEY=sk-ant-... WORKBENCH_PASSWORD='<a long passphrase>' --app wb-bee492c6678ad9216368
fly deploy
```

`fly volumes create` asks about a single-volume warning; accept it, since this is one machine on purpose. Then open the URL and enter the password.

## Later

- **Redeploy after code changes:** `fly deploy`. The volume keeps engagements and your sources.
- **Logs:** `fly logs`.
- **Change the password:** `fly secrets set WORKBENCH_PASSWORD=...`. The machine restarts and existing cookies stop working.
- **Pause it:** `fly scale count 0`. Resume with `fly scale count 1`.
- **Remove everything:** `fly apps destroy wb-bee492c6678ad9216368`.
- **Want a different hostname?** Change `app` in `fly.toml` before the first deploy, and use the new name in the commands.

## Known limits

- **One machine, on purpose.** State lives on its volume, and runs are child processes, so it must not autoscale or auto-stop.
- **The model profile defaults to `test` (Haiku).** A switch in the UI is saved on the volume, so it outlasts redeploys and affects every visitor.
- **"Open folder" can't work hosted.** It opens a folder on the server's machine.
- **Spend is not capped in the app.** Every visitor with the password spends from the API key, so rely on the limits set on the API key itself.
