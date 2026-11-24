-- Unverified imports from before drafts existed become drafts with a fresh
-- 7-day clock from this deploy, so nobody loses one without a week's notice.
-- Hand-made recipes and saved imports keep a null expiry. Re-running it
-- changes nothing: it only fills a missing expiry.

update public.recipes r
set draft_expires_at = now() + interval '7 days'
where r.verification = 'unverified'
  and r.draft_expires_at is null
  and exists (
      select 1
      from public.recipe_imports i
      where i.recipe_id = r.id
  );
