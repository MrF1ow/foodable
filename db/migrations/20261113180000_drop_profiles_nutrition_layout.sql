-- foodable:contract card arranging removed; the column is unread since #260
alter table public.profiles drop column if exists nutrition_layout;
