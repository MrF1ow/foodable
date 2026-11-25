---
name: foodable-test
description: Run, start, verify, test, preview or screenshot Foodable safely - isolated local stack (Postgres plus server on its own ports), which verification tool fits which change, and what never to touch. Use before running the server, tests, check:nav, previews, the widget harness or e2e.
updated: "06fe0cb01f4fb21c3f547e380acda7d6dba63f45"
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
- `bun run db:dev` defaults to the user's own dev database (data dir ~/.local/share/foodable/pg, port 54330, run by `foodable-db.service`). `db:dev stop` would stop it and `init` would migrate it, with no force flag to guard either. **Always** set `FOODABLE_PG_DIR` and `FOODABLE_PG_PORT` first (below), or run only `status` or `url`. `db:dev` reads only those two (plus `PG_BIN`), never `DATABASE_URL`, so it is safe under `bun run`.
- Never use port 8080 or 54330: the user's dev server and database live there.

## Isolated stack (one-off verification)

Shell variables do not survive between tool calls: begin **every** command block with `STACK=<path printed by the first block>; . "$STACK/env"`. `init` creates the cluster, starts it, creates the database and migrates.

```bash
free_port() { bun -e 'const s=Bun.listen({hostname:"127.0.0.1",port:0,socket:{open(){},data(){}}});console.log(s.port);s.stop(true)'; }
STACK=$(mktemp -d); echo "STACK=$STACK"
{ echo "export FOODABLE_PG_DIR=$STACK/pg"
  echo "export FOODABLE_PG_PORT=$(free_port)"
  echo "export APP_PORT=$(free_port)"; } > "$STACK/env"
. "$STACK/env"
bun run db:dev init        # needs initdb on PATH, or PG_BIN=<postgres bin dir>
```

Start the server (repo root). It needs `DATABASE_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `OFF_USER_AGENT`; `SESSION_SECRET` (32+ chars) falls back to `OAUTH_CLIENT_SECRET` with a warning, but pass it. `db:dev url` echoes a `$ bun run …` line first (`| tail -1`):

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

For row level security, set a throwaway `foodable_app` password (`psql`) and add `DATABASE_APP_URL` (user `foodable_app`).

It binds `0.0.0.0` (LAN): keep runs short. No answer: `$STACK/server.log`. App: `http://127.0.0.1:$APP_PORT`; the first sign-up on an empty database is the owner (`docs/self-hosting.md`, "First-user flow").

Not `bun run dev`/`start`: `dev` runs `gen:all` (rewrites tracked files) and `--watch`, and its inner `bun` loads `.env`. Run `gen:all` only in a fresh worktree or after login/token changes.

Stop everything:

```bash
kill "$(cat "$STACK/server.pid")"
bun run db:dev stop     # only the cluster in $FOODABLE_PG_DIR
bun run db:dev status   # "stopped", exit 1
```

## Which tool fits which change

- **Domain / pure logic:** `bun --no-env-file test <file>`.
- **SQL, db adapters:** `bun --no-env-file test <file>` (`describeDb`). One Postgres a run, in `~/.cache/foodable/pg-test` (`FOODABLE_PG_TEST_DIR`), not `db:dev`; each file gets a migrated-template copy as `foodable_app`. Needs `initdb` (PATH or `PG_BIN`), else skipped. Fixtures: `seedHousehold` (owner agent switch On), `seedMember` (Off). Page loads sync `notifications`; db-less route tests log `sync failed`.
- **Web pages, nav, Turbo, theme chrome:** `bun run check:nav`. Needs `CHROME_BIN`. Ports :4791, :9223, one at a time ("harness crashed" = port held). No DB: `scripts/nav-check-fixture.ts` keys pages by path and query, flags on, POSTs 303 back. Swipe: touch emulation.
- **Flicker:** `bun scripts/flicker-check.ts --base http://<tailscale ip -4>:$APP_PORT` on an isolated stack: remote browserless Chromium, 390 px, both themes.
- **App look:** `bun run preview:app --shots`: `-390.png`/`-1440.png` per page in tmp/app-preview. Without `--shots`: serves :4787 (`PREVIEW_PORT`), pages `/<name>-<light|dark>.html`; clock, caret pinned.
- **No visual change:** `flock ~/.cache/foodable/shots.lock nice -n 10 bun scripts/preview-diff.ts` (`--base`, `--reuse-base`, `--no-cache`) compares base and branch; exit 1 on a diff. Clean commits are cached in `~/.cache/foodable/preview-diff` (`rm -rf` old).
- **WebKit (Safari-class):** WPE `MiniBrowser` needs a wrapper exporting `WEBKIT_EXEC_PATH`, `WEBKIT_INJECTED_BUNDLE_PATH`, `WEBKIT_INSPECTOR_RESOURCES_PATH`, `WEBKIT_FORCE_COMPLEX_TEXT=1` and `LD_LIBRARY_PATH` (its `lib`, `sys/lib`, ICU 74).
- **Barcode scans** hit live Open Food Facts (tests stub it); `barcode-camera` off: `/?camera=off`, `*-camera-off` previews.
- **A flag off for one run:** `FOODABLE_FLAGS=<flag>:off` in the server's env (`all`, `internal`, comma lists).
- **Chat widgets:** background `bun run harness` (:8787, or `HARNESS_PORT`); `/host?widget=<key>&theme=dark`, plus `&state=` for product-score `full|partial|none`, restock-nudge `costco|stores|onlist|empty`, week-plan `design|busy|future|empty`; `attention` paints a populated inbox. CDP eval inside the widget iframe needs Chromium `--disable-site-isolation-trials`.
- **App-wide middleware (body limit, CORS):** import `app` from `src/index.ts` (`src/index.test.ts`).
- **MCP tools and both protocol eras:** `bun --no-env-file test src/mcp.test.ts`; the `/mcp` describes (`-t "/mcp"`) drive both eras in-process.
- **MCP end to end through a real agent:** `bun run e2e:agent --list`, then `--only <ids>`; only when asked.
- **Migrations:** `bun run db:dryrun` (throwaway Postgres; needs `initdb`). `bun run db:rehearse` (production copy via `railway ssh`): only when asked.
- **Flag rollout:** `bun run flags:apply --dry-run` only (applying mutates Railway).
- **Types, lint, format:** `bun run typecheck`, `lint`, `format:check` (`format` fixes). `bun fmt` needs Bun ≥ 1.4.4: put `$(mise where bun@1.4.4)/bin` first on PATH.

`e2e:agent` drives the Grok CLI against a live server and snapshots, then **restores over**, the database. It refuses to run without `E2E_DB_URL` (no `.env` fallback). **Set `E2E_DB_URL=<isolated URL>` and `E2E_SERVER=http://127.0.0.1:$APP_PORT`** (default: the user's `:8080`). Grok must be signed into an MCP server named `foodable` (`E2E_MCP_NAME`) at that URL; if that is the user's server, stop and ask. The scenarios (one: no logging for another member) need two household members: sign up the owner, create the household, add a member in Settings › Household, then sign Grok in. Snapshots need `pg_dump` and `psql` (`PG_BIN`).

## Never touch

- Production data: Railway Postgres is internal-only; `bun run db:rehearse` only when asked, no `railway ssh` of your own.
- `.env`, and any value in it (never print, copy or commit; use throwaway secrets). Not `docker-compose.yml` (loads `.env`).
- The design file `Foodable Design.figcraft`: read-only, never edit or save it.
- The user's dev server, `foodable*.service` units, `foodable-db.service`, and anything on :8080 or :54330: never kill, restart, reuse.
- `main` and the rulesets.

## When this skill is out of date

The `watches:` list in the frontmatter names the files this skill describes. If your change touches one, update this skill in the same PR, or **skill-drift** fails (`bun scripts/conventions/skill-drift.ts`). Skills and CLAUDE.md also have a size budget (`bun scripts/conventions/context-budget.ts`); growing past it needs the `agent-context-increase` label.
