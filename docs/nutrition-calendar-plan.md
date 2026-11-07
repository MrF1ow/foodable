# Nutrition calendar with per-day goals: plan

Status: proposed (#149). Moved out of [ROADMAP.md](../ROADMAP.md) on 2026-11-07, unchanged.

## Goal

The Nutrition tab only shows today. Add a calendar view: a month grid where each day shows its calories against that day's goal, opening a day view with the day's meals, totals and macros, where meals can be added and edited for that day. The data is already per day (every meal, water and weight row has `logged_at`, read paths bucket by `dateInTz`, and `get_meals` takes `date` or `from`/`to`), so the view itself needs no schema change.

## Plan

- **Per-day goals.** `nutrition_goals` is one row per user today. Add the new shape first: a `nutrition_goal_days` table (`household_id`, `user_id`, `date`, the same `daily_*` columns, null meaning "use the default") with row level security and `service_role` grants in the same migration. The existing row stays the default; no backfill is needed because "no override" already means "use the default". A weekday pattern (say, a training-day target every Monday, Wednesday and Friday) can come later as a second table if per-date overrides prove tedious.
- **One resolver.** A pure `goalsForDate(defaults, overrides, date)` in `src/domain/` with memory-store tests. Every reader that compares a day against goals goes through it: `get_goal_progress`, the meal-progress strip, `get_nutrition_summary`, `get_trends`, the dashboard data, insights and the weekly digest. A range read (trends, the calendar month) resolves each day separately, so averages compare against that day's own target, not today's.
- **Surfaces.** Web: the calendar under the Nutrition tab, and a "goal for this day" form in the day view. MCP: let the goals tool take an optional `date` (or `from`/`to`) to set or clear a day's override, and include overrides in `export_all_data` (`goals.csv` or a new `goal_days.csv`, header-only when empty). Tool changes update `src/mcp/tools-list.snapshot.json` and `TOOLS` in the same PR.
- Meals keep their denormalized totals; nothing about how meals are written changes.
