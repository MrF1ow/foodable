---
name: foodable-test
description: Run, start, verify, test, preview or screenshot Foodable safely - isolated local stack (Postgres plus server on its own ports), which verification tool fits which change, and what never to touch. Use before running the server, tests, check:nav, previews, the widget harness or e2e.
updated: "3d110a3d34a1d5cfde5aa6bf93e8ee547373c5e2"
watches:
    - package.json#scripts
    - docker-compose.yml
    - Dockerfile
    - .env.example
    - scripts/dev-db.ts
    - scripts/e2e-agent.ts
    - scripts/nav-check*.ts
    - scripts/app-preview.ts
    - scripts/widget-harness.ts
    - src/index.ts
    - src/db/testing/**
---

# Foodable: run and verify safely

## Rules first

- Bun loads `.env` on its own, and a real `.env` can hold production secrets. Pass every variable the process needs on the command line (a process env var beats `.env`), and start the server with `bun --no-env-file` so nothing else leaks in. `bun --no-env-file run <script>` does **not** reach the inner `bun`: use it only on `bun <file>` or `bun test`.
- Never print, copy or commit `.env` values; use throwaway secrets.
- `bun run db:dev` defaults to the user's own dev database (data dir ~/.local/share/foodable/pg, port 54330, run by `foodable-db.service`). `db:dev stop` would stop it and `init` would migrate it. There is no force or drop flag. So **always** set `FOODABLE_PG_DIR` and `FOODABLE_PG_PORT` first, as below. If you cannot, run only `status` or `url`. `db:dev` reads only those two (plus `PG_BIN`) and never `DATABASE_URL`, so it is safe under `bun run` even though the inner `bun` loads `.env`.
- Never use port 8080 or 54330: the user's dev server and database live there.

## Isolated stack (one-off verification)

Shell variables do not survive separate tool calls: begin **every** command block with `STACK=<path printed by the first block>; . "$STACK/env"`. `init` creates the cluster, starts it, creates the database and migrates.

```bash
free_port() { bun -e 'const s=Bun.listen({hostname:"127.0.0.1",port:0,socket:{open(){},data(){}}});console.log(s.port);s.stop(true)'; }
STACK=$(mktemp -d); echo "STACK=$STACK"
{ echo "export FOODABLE_PG_DIR=$STACK/pg"
  echo "export FOODABLE_PG_PORT=$(free_port)"
  echo "export APP_PORT=$(free_port)"; } > "$STACK/env"
. "$STACK/env"
bun run db:dev init        # needs initdb on PATH, or PG_BIN=<postgres bin dir>
```

Start the server (repo root). `src/index.ts` needs `DATABASE_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `OFF_USER_AGENT`; `SESSION_SECRET` (32+ chars) is optional (it falls back to `OAUTH_CLIENT_SECRET` with a warning) but pass it. The values below are throwaway. `db:dev url` echoes a `$ bun run …` line first, hence `| tail -1`:

```bash
. "$STACK/env"
DATABASE_URL="$(bun run db:dev url | tail -1)" PORT="$APP_PORT" \
OAUTH_CLIENT_ID=test-client OAUTH_CLIENT_SECRET=test-secret \
SESSION_SECRET=throwaway-session-secret-0123456789abcdef \
OFF_USER_AGENT="Foodable (test@example.invalid)" \
  bun --no-env-file src/index.ts > "$STACK/server.log" 2>&1 &
echo $! > "$STACK/server.pid"
for i in $(seq 40); do curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null && break; sleep 0.5; done
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$APP_PORT/"   # 200 = login page
```

For row level security, set a throwaway `foodable_app` password (`psql`) and add `DATABASE_APP_URL` (as `foodable_app:<pw>`).

It binds `0.0.0.0` (LAN): keep runs short. No answer: `$STACK/server.log`. App: `http://127.0.0.1:$APP_PORT`; the first sign-up on an empty database becomes the owner (`docs/self-hosting.md`, "First-user flow").

Not `bun run dev`/`start`: `dev` runs `gen:all` (rewrites tracked files) and `--watch`, and the inner `bun` loads `.env`. Run `gen:all` only in a fresh worktree or after login copy/token changes.

Stop everything:

```bash
kill "$(cat "$STACK/server.pid")"      # SIGTERM
bun run db:dev stop                    # stops only the cluster in $FOODABLE_PG_DIR
bun run db:dev status                  # "stopped", exit 1 is expected
```

## Which tool fits which change

- **Domain / pure logic:** `bun --no-env-file test <file>`.
- **SQL, db adapters:** `bun --no-env-file test <file>` (`describeDb`). One Postgres a run, in `~/.cache/foodable/pg-test` (`FOODABLE_PG_TEST_DIR`), not `db:dev`; each file gets a migrated-template copy as `foodable_app` (household owner; `src/db/testing/pg.ts`). Needs `initdb` (PATH or `PG_BIN`), else skipped.
- **Web pages, nav, Turbo, theme chrome:** `bun run check:nav`. Needs Chromium (`CHROME_BIN`). Fixed ports :4791 and :9223, one run at a time ("harness crashed": another run holds them; wait until `ss -ltn` shows both free). No database.
- **App look:** `bun run preview:app --shots`, PNGs in tmp/app-preview (slow: long `timeout`). Clear tmp/app-preview first. Without `--shots`: serves :4787 (`PREVIEW_PORT`). Per page: `-390.png` and `-1440.png`. Chromium; fixture data.
- **WebKit (Safari-class checks):** Playwright's WPE `MiniBrowser` only starts through a wrapper that exports `WEBKIT_EXEC_PATH`, `WEBKIT_INJECTED_BUNDLE_PATH` and `WEBKIT_INSPECTOR_RESOURCES_PATH` (its `bin`, `lib`, `share`), plus `WEBKIT_FORCE_COMPLEX_TEXT=1` and an `LD_LIBRARY_PATH` with its `lib` and `sys/lib` and an ICU 74 libs directory.
- **Barcode scans against a running server** hit live Open Food Facts (no fixture on the server), so they need network; unit tests stub it.
- **A flag off for one run:** `FOODABLE_FLAGS=<flag>:off` in the server's env (`all`, `internal`, comma lists).
- **Chat widgets:** background `bun run harness` (:8787, or `HARNESS_PORT`); `/host?widget=<key>&v2=1&theme=dark`, plus `&state=` for product-score `full|partial|none`, restock-nudge `costco|stores|onlist|empty`, week-plan `design|busy|future|empty`. `bun --no-env-file test src/widgets.test.ts` guards assembly. CDP eval inside the widget iframe needs Chromium `--disable-site-isolation-trials`.
- **MCP tools and both protocol eras:** `bun --no-env-file test src/mcp.test.ts`; the `/mcp` describes (`-t "/mcp"`) drive both eras in-process.
- **MCP end to end through a real agent:** `bun run e2e:agent --list`, then `--only <ids>`; only when asked (below).
- **Migrations:** `bun run db:dryrun` (throwaway Postgres, never production; needs `initdb`). `bun run db:rehearse` (production copy via `railway ssh`): only when asked.
- **Flag rollout:** `bun run flags:apply --dry-run` only (applying mutates Railway).
- **Types, lint, format:** `bun run typecheck`, `bun run lint`, `bun run format:check` (`format` fixes). Both run `bun fmt` and need Bun ≥ 1.4.4 (the default `bun` may be older): `mise exec bun@1.4.4 -- bun run format:check`.

`e2e:agent` drives the Grok CLI against a live server and snapshots, then **restores over**, the database. It refuses to run without `E2E_DB_URL` (no `.env` fallback). **Set `E2E_DB_URL=<isolated URL>` and `E2E_SERVER=http://127.0.0.1:$APP_PORT`** (default: the user's `:8080`). Grok must be signed into an MCP server named `foodable` (`E2E_MCP_NAME`) at that URL; if it points at the user's server, stop and ask. The scenarios need two household members: sign up the owner, create the household, add a member in Settings › Household, then sign Grok in. Snapshots need `pg_dump` and `psql` (`PG_BIN`).

## Never touch

- Production data: Railway Postgres is internal-only; `bun run db:rehearse` only when asked, no own `railway ssh` queries.
- `.env`, and any value in it (never print, copy or commit). `docker-compose.yml` loads `.env`, so do not use it for verification.
- The design file `Foodable Design.figcraft` in the user's designs folder: read-only, read it with the FigCraft tools, never edit or save it.
- The user's running dev server, `foodable*.service` units and `foodable-db.service`, and anything on :8080 or :54330: never kill, restart or reuse.
- `main` and the rulesets.

## When this skill is out of date

The `watches:` list in the frontmatter names the files this skill describes. If your change touches one, update this skill in the same PR: the **skill-drift** policy check fails otherwise (`bun scripts/conventions/skill-drift.ts` runs it locally). Skills and CLAUDE.md also have a size budget (`.github/agent-context-budget.json`); growing past it needs the `agent-context-increase` label (`bun scripts/conventions/context-budget.ts` checks it).
