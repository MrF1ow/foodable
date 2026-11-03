-- add_household_member and bootstrap_household only ran `revoke ... from public`,
-- which does not remove the explicit EXECUTE that the schema's default
-- privileges grant to anon and authenticated. The server calls both with the
-- service role only.
revoke execute on function public.add_household_member(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.bootstrap_household(text, text) from anon, authenticated;

alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
