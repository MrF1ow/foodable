-- Relabel stored database failures. src/analytics.ts now writes
-- database_error where it used to write supabase_error; without this rewrite
-- the history would split across two labels for the same bucket.
update public.tool_analytics
set error_category = 'database_error'
where error_category = 'supabase_error';
