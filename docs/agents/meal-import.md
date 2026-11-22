# Bulk meal import

Read this before touching `start_meal_import`, `bulk_import_meals`, `src/domain/import.ts`, `src/domain/csv.ts`, the `import-meals` widget, or any meal write path's `logged_at` handling.

Two entry points, one write path.

- **`start_meal_import`** returns the `import-meals` widget. Prefer it whenever the user has an actual file: the widget parses and maps the export **in the browser**, so rows never pass through the model and cannot be mistranscribed. Its `outputSchema` is load-bearing: with no `structuredContent` the bridge never paints and the iframe sits on its loading state. It carries `tz` so the widget's preview matches what the server will store.
- **`bulk_import_meals`** is the universal fallback, callable by the model _and_ by the widget. The default `_meta.ui.visibility` is `["model", "app"]`, so one tool serves both; `["app"]` would hide it from the model and break users who have widgets disabled.

`src/domain/import.ts` holds the logic, free of the database so it unit-tests with fixtures; `src/mcp/tools/nutrition.ts` is a thin adapter supplying `insert` and `existingKeys`. `src/domain/csv.ts` is the parser, inlined into the widget via `@inlinets`.

## Invariants

Each of these was a real bug or nearly one.

- **Rows carry an explicit `import:<digest>:<ordinal>` idempotency key.** `insertMeal` derives a content hash when none is given, and that hash includes `logged_at`. But date-only rows all anchor at local noon, so two genuinely separate identical rows hashed alike and the second was silently swallowed as `deduplicated` while the control total still reconciled. The ordinal counts preceding identical rows in the same call, so replaying a file is still a perfect no-op. It is the ordinal and **not** `source_line`, so re-exporting a file with lines added still dedupes. Never split a calendar date across calls: the ordinal is per call.
- **Our own export re-imports by `id`, not by content.** The content digest structurally cannot recognize a meal coming back in: `log_meal` writes `auto:<digest>` keys and the importer writes `import:…` ones, and the two hash different renderings of `logged_at` (the export emits second-precision local wall time, which the importer then re-resolves). So every row carries an optional `source_id`, the `id` column of the `meals.csv` our own export writes, and a row naming a meal the user still has is reported `deduplicated` without an insert, on the dry-run path and the real one alike.
    - Rows whose meal was since deleted key on `import:src:<uuid>:<ordinal>`, so a second replay is still a no-op.
    - Only uuid-shaped values count. A foreign app's `id` column is dropped rather than rejected: passing a non-uuid to the uuid-typed `in ("id", …)` lookup would fail the whole batch on a cast error rather than simply not matching.
    - The export's `timezone` column closes the other half of that gap. A row whose meal was since deleted — the actual "restore my data" case — still gets written fresh rather than deduplicated by id, so it also carries an optional `timezone` field (mapped by the widget from the export's own `timezone` column), which `resolveLoggedAt` uses in place of the account's current timezone when present and valid. Otherwise an offset-less wall clock silently re-resolves against whatever timezone the account has now, moving the meal to a different local day (#97).
- **The tool never sets `isError`.** Failure is `status: "failed"` inside the `outputSchema`. `isError` short-circuits the SDK's output validation, and hosts commonly surface only `content`, which would drop the per-row report that is the whole product. Consequence: `withAnalytics` needs its `outcome` callback, or failed imports log as successes.
- **`.nullable()` is not optional.** Nullable fields are emitted as _required_ with an `anyOf[type, null]` value, so every result row must be built from a complete literal with explicit `null`s. `src/domain/import.test.ts` validates the serializer against the schema. That is the only guard, since `bun run typecheck` checks types but not the shape a handler actually returns at runtime.
- **Bounds live in the handler, not in Zod.** A schema-level rejection happens before the handler runs, discarding the structured report, the warnings and the analytics row, for what will be the caller's most common mistake. Numbers use `z.coerce` like `log_meal`. (The other write tools keep their bounds in Zod on purpose; `src/mcp/shared.ts` explains why.)
- **Timestamps accept a bare date (→ local noon), an offset-less local time (resolved in the profile timezone), or full ISO with an offset.** Offset-less is accepted deliberately: no fitness export carries an offset, so requiring one forces the caller to compute historical DST per row. Every resolved date asserts the `dateInTz` round trip, which turns never-existed local dates (`Pacific/Apia 2011-12-30`) into explicit errors. An unconfigured timezone silently means UTC, so the tool warns; a missing `profiles` row is the only reliable "never set" signal.

## One `logged_at` resolver for every write path

Every write path resolves `logged_at` through the same `parseLoggedAt` in `src/domain/tz.ts`: the importer via `resolveLoggedAt` (`src/domain/import.ts`), and the five manual tools (`log_meal`, `update_meal`, `log_water`, `log_weight`, `update_weight`) via `resolveWriteLoggedAt` and the `resolveWriteTimestamp` adapter in `src/mcp/shared.ts`. Handing an offset-less string to the `timestamptz` column instead reads it in the DB session zone (UTC), which filed a Kyiv user's 21:00 meal at 00:00 the next day while the tool's own progress line reported the later date (issue #68).

The two callers differ **only** in bounds. The importer is backfilling and takes 20 years back to 48 hours ahead. A manual entry has no past bound and a 5-minute future one, except a bare date, whose local-noon anchor is a placeholder for an unknown time and so is judged by calendar day.

This is not about cross-route dedupe — the importer stamps `import:` keys and never reaches the `auto:` digest. It is about both routes filing the same string on the same local day, since every read path buckets by `dateInTz`.
