-- GEN-3 contract: profiles.locale was never read after the app went English-only.

-- foodable:contract profiles.locale is unread since the app went English-only
alter table public.profiles drop column if exists locale;
