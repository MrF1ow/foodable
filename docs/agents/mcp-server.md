# The MCP server (`/mcp`)

Read this before touching `src/mcp/`, `src/mcp.test.ts`, `src/analytics.ts` or the MCP SDK dependencies. The short version is in `CLAUDE.md` ("Project Overview").

## SDK v2 and Zod 4

Foodable runs on MCP TypeScript SDK **v2**: `@modelcontextprotocol/server` at runtime, `@modelcontextprotocol/client` only in tests, with Zod 4 as an explicit dependency. `@modelcontextprotocol/sdk` v1 is gone, so import `McpServer`, `InMemoryTransport` and `createMcpHandler` from `@modelcontextprotocol/server`.

Every `inputSchema` / `outputSchema` is a schema object, never a raw shape (`foodable/mcp-schema-object` lints it). That lets the exported `*_OUTPUT_SCHEMA` constants be `.parse()`d directly in tests.

Two v2 wire facts: advertised schemas are JSON Schema 2020-12, and a POST whose `Content-Type` is not `application/json` is answered `415` before the body is read.

## One endpoint, two protocol eras

`/mcp` is a dual-era endpoint built on `createMcpHandler` (`src/mcp/server.ts`):

- It serves the `2026-07-28` revision: per-request `_meta` envelope, `server/discover`, no protocol-level sessions, and `Mcp-Method` / `Mcp-Name` routing headers validated against the body.
- Through the default `legacy: "stateless"` fallback it still answers `2025-11-25` clients with a per-request `initialize`.

One server factory backs both eras. The factory gets no Hono context: the authenticated actor travels in `authInfo.extra.auth` (`AuthContext`) from `handleMcp`, and the public origin (for the icon URL) is read from `ctx.requestInfo`. When `PUBLIC_ORIGIN` is set, `getBaseUrl` in `src/url.ts` returns it and ignores `X-Forwarded-*`; when unset, the request Host / forwarded headers still win.

`listChanged` is advertised `false` on purpose: the endpoint is stateless and refuses GET, so no channel exists to deliver a list-changed notification.

The server advertises `public/favicon.ico` plus the light and dark tile SVGs (`/brand/icon-{light,dark}.svg`, with the icon `theme` field).

## Testing both eras

The "/mcp over HTTP" section of `src/mcp.test.ts` drives both eras in-process by pointing a v2 `Client`'s `fetch` at the Hono route. There is no in-memory transport for the modern era, so that is the only way to test it.

It lives in `mcp.test.ts` deliberately: `mock.module` is process-wide, and a separate file mocking the same db module broke `middleware.test.ts`'s mock on Linux CI. Two lint rules (`bun run lint`) enforce what follows from that:

- `foodable/no-db-mock-outside-windows`: db modules are stubbed only in the files already listed in `.oxlintrc.json`.
- `foodable/no-restore-from-live-import`: a restore uses a snapshot taken before `mock.module`.

## The registered tool set

`src/mcp/server.ts` holds the server factory and `SERVER_INSTRUCTIONS`, and calls one `registerXTools(server, ctx)` per domain module in `src/mcp/tools/`: `nutrition`, `nutrition-insights`, `water`, `weight`, `goals`, `profile`, `food`, `fridge`, `grocery`, `recipes`, `rules`, `notices`, `household`, plus `plan`, `product-score`, `household-digest`, `stores`, `grocery-admin`, `fridge-admin` and the flag-gated `sharing`.

`src/mcp/shared.ts` holds `withAnalytics`, actor resolution, `uiMeta` and the shared schemas and formatters. `src/mcp.ts` is a temporary re-export. Tool call analytics (duration, outcome, error category) go through `src/analytics.ts` to the `tool_analytics` table.

`src/mcp/tools-list.snapshot.json` pins the `tools/list` names and order (the all-flags-on list), and `src/mcp.test.ts` compares against it. The tool count sentence in `CLAUDE.md` is also asserted by that test.

- `list_notices` is the person's stored inbox (it syncs first). Data-quality marks come with their item (`get_recipe`, `get_food`).
- Declare a flag-gated tool with `gatedTool` in `src/mcp/gated.ts` so it stays out of `tools/list` while the flag is off.
- `src/mcp.test.ts` asserts that the `TOOLS` names in `src/copy/tools.ts` match `tools/list`, and that person-scoped catalog cards include optional `user_id`. `src/copy/tools.ts` is an identity catalog (names, params, household/oauth splits), not a public `/tools` page.
- Nutrition writes also accept optional `target_member` (MCP only), for the acting person only (`ctx.writeUserId`).
