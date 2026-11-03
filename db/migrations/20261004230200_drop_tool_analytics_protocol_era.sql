-- protocol_era / client_name existed to count leftover 2025-era /mcp users
-- before retiring that leg. Foodable keeps the dual-era endpoint and the
-- duration/outcome analytics rows; it does not need the era columns.
drop index if exists public.tool_analytics_legacy_era_invoked_at_idx;

alter table public.tool_analytics
    drop constraint if exists tool_analytics_protocol_era_check;

alter table public.tool_analytics
    drop column if exists protocol_era,
    drop column if exists client_name;
