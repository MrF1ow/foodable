-- An imported recipe stays a draft until a person saves it. A draft is a
-- recipe whose verification is 'unverified'; draft_expires_at says when the
-- daily sweep deletes it if nobody has saved it. Every import sets it to the
-- import time plus 7 days, and saving clears it. Hand-made and shared-link
-- recipes are saved from the start, so theirs stays null.
--
-- Expand only: one nullable column, nothing backfilled here.

alter table public.recipes
    add column if not exists draft_expires_at timestamptz;
