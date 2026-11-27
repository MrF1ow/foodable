# Data export

Read this before touching `export_all_data`, `src/zip.ts`, the CSV builders, `GET /exports/:token`, `export_archives` or the `getAll*` readers.

**One tool, `export_all_data`, is the only way out.** It builds a ZIP — `meals.csv`, `meal_items.csv`, `water.csv`, `weight.csv`, `goals.csv`, `goal_days.csv`, `profile.csv` and a `README.txt` — upserts it into `public.export_archives` (one row per user, so each export overwrites the last), and returns a 60-minute link to `GET /exports/:token`.

- The token is an `e1.` HMAC over the user id and expiry (seconds), using a key derived from the session secret. It is not a site-session cookie.
- The route verifies it and streams `application/zip` with `Cache-Control: no-store`. Invalid, expired and missing archives all get the same 404.
- A meals-only `export_meals` was removed rather than kept: two overlapping export tools made "export my data" ambiguous for the model, and the meal history is `meals.csv` inside the archive.
- `sweepStaleExports` deletes rows whose `expires_at` is in the past, on the same schedule as before, so nothing outlives its link by more than one sweep. Account deletion drops the row through the `public.users` cascade.

## The ZIP writer

`src/zip.ts` is a hand-rolled store-only (method 0) ZIP writer. Bun has gzip and zstd but no archive builder, and seven small CSVs do not justify a dependency. Two things in it are load-bearing:

- Every size and offset is a **byte** length from `TextEncoder`. A multi-byte character in a meal description otherwise desyncs every following offset.
- The DOS date/time is read in **UTC**, or the same `Date` emits different bytes on different machines and the determinism the tests rest on evaporates.

## Invariants

- **Every CSV pairs each timestamp with a `timezone` column** naming the zone it is rendered in, exactly as the meal export always has. An offset-less wall clock with nothing beside it silently re-resolves against whatever timezone the account has later; that was #97.
- **Every builder emits its header even with zero rows**, and `goals.csv` / `profile.csv` are header-only when the record is null. A file that vanishes when a table is empty makes the archive shape unpredictable for anything reading it.
- **`meals.csv` is byte-identical to `buildMealsCsv`**, whose headers are the importer's column aliases. It is the only file with a way back in (see `docs/agents/meal-import.md`); renaming a column there for looks breaks a re-import silently. `meals.servings` (the multiplier a quick meal was saved at) is deliberately not a column: the CSV contract stays as it is, so a re-imported meal reads as 1 serving, and its totals, which already include the multiplier, are unchanged.
- **Alcohol is not gated on `alcohol_tracking_enabled`.** The opt-in governs display, not the export: the archive is meant to be a complete copy of what was logged, and withholding rows the user later hid would break that.
- **`exportAllData` derives tz and weight unit from one `getProfile` row.** The `getUserTimezone` / `getPreferredWeightUnit` wrappers are each their own `select * from profiles`, so chaining them multiplies one query by the number of preferences read.
- **`getAllMeals` / `getAllWater` / `getAllWeight` reconcile against an exact count and throw when short.** The Supabase-era PostgREST client capped rows at 1000, which truncated an export once already (#66); a loud failure beats a quiet partial backup.
