-- Drop single-column user_id indexes superseded by (user_id, logged_at, id)
-- composites from 20261102120000_hot_query_indexes.sql. user_id alone is a
-- strict leading prefix of those composites, including for foreign-key cascade
-- checks that filter on user_id. The logged_at-only indexes are not prefixes
-- and stay.

drop index if exists public.idx_meals_user_id;
drop index if exists public.idx_water_log_user_id;
drop index if exists public.idx_weight_log_user_id;
