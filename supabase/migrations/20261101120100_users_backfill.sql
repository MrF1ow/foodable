insert into public.users (id, email, password_hash, created_at)
select id, email, encrypted_password, created_at
from auth.users
on conflict (id) do nothing;
