-- Fixture for the Phase 2 food catalog backfill, loaded onto the schema as it
-- stood before 20261004230000. Each row is an edge case check.sql asserts on.

-- Non-null hashes so check.sql's password_hash comparison compares values.
insert into auth.users (id, email, encrypted_password) values
    ('00000000-0000-0000-0000-0000000000a1', 'a@example.com', '$2a$10$fixturehashaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ('00000000-0000-0000-0000-0000000000b2', 'b@example.com', '$2a$10$fixturehashbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

-- 'Freezer' twice: the location copy must not trip the unique key.
insert into public.households (id, name, fridge_locations) values
    ('11111111-1111-1111-1111-111111111111', 'Home',
     array['Fridge', 'Freezer', 'Freezer', 'Pantry ']);

insert into public.household_members (household_id, user_id, role, display_name) values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'owner', 'A'),
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'member', 'B');

insert into public.fridge_locations (id, household_id, name, sort_order) values
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Fridge', 0);

insert into public.grocery_stores (id, household_id, name) values
    ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Shop');

insert into public.grocery_sections (id, household_id, store_id, name) values
    ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333', 'Dairy');

insert into public.recipes (id, household_id, creator_id, name, yield_portions) values
    ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
     '00000000-0000-0000-0000-0000000000a1', 'Omelette', 2);

-- OFF cache. Milk and granola are cached per serving, oats per 100 g. Only
-- oats may reach the per-100 g columns on foods.
insert into public.food_cache (source, source_id, payload, fetched_at) values
    ('openfoodfacts', '111', '{"name":"Whole Milk","serving":"250 ml","calories":160,"protein_g":8,"carbs_g":12,"fat_g":9,"fiber_g":0,"sugar_g":12,"alcohol_g":null}', now()),
    ('openfoodfacts', '222', '{"name":"Oats","serving":"100 g","calories":380,"protein_g":13,"carbs_g":60,"fat_g":7,"fiber_g":10,"sugar_g":1,"alcohol_g":null}', now()),
    ('openfoodfacts', '444', '{"name":"Granola","serving":"45 g","calories":200,"protein_g":5,"carbs_g":30,"fat_g":7,"fiber_g":3,"sugar_g":9,"alcohol_g":null}', now());

-- Two milk barcodes share one name; manual "Eggs" / "EGGS" / "eggs  " across
-- three tables must become one food; a manual "oats" meets barcode "Oats".
insert into public.fridge_items (household_id, location_id, kind, display_name, amount, unit, identity) values
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'food', 'Whole Milk', 1000, 'g',
     '{"kind":"food","via":"barcode","barcode":"111","displayName":"Whole Milk"}'),
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'food', 'Whole Milk', 500, 'g',
     '{"kind":"food","via":"barcode","barcode":"333","displayName":"Whole Milk"}'),
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'food', 'Eggs', 300, 'g',
     '{"kind":"food","via":"manual","householdManualId":"m1","displayName":"Eggs"}'),
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'supply', 'Foil', 1, 'g',
     '{"kind":"supply","via":"manual","householdManualId":"m2","displayName":"Foil"}'),
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'food', 'Granola', 400, 'g',
     '{"kind":"food","via":"catalog","source":"openfoodfacts","sourceId":"444","displayName":"Granola"}');

insert into public.grocery_lines (household_id, store_id, section_id, kind, display_name, amount, unit, identity) values
    ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     'food', 'EGGS', 600, 'g', '{"kind":"food","via":"manual","householdManualId":"m3","displayName":"EGGS"}'),
    ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     'food', 'Oats', 500, 'g', '{"kind":"food","via":"barcode","barcode":"222","displayName":"Oats"}'),
    ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     'food', 'oats', 500, 'g', '{"kind":"food","via":"manual","householdManualId":"m4","displayName":"oats"}');

-- Butter has no cache row; its nutrition comes from the recipe's 100 g basis.
insert into public.recipe_ingredients (household_id, recipe_id, kind, display_name, amount, unit, identity, nutrition) values
    ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'food', 'eggs  ', 150, 'g',
     '{"kind":"food","via":"manual","householdManualId":"m5","displayName":"eggs  "}', null),
    ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'food', 'Butter', 10, 'g',
     '{"kind":"food","via":"barcode","barcode":"555","displayName":"Butter"}',
     '{"basisUnit":"g","basisAmount":100,"calories":717,"protein_g":1,"carbs_g":0,"fat_g":81}'),
    ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'food', 'Whole Milk', 50, 'g',
     '{"kind":"food","via":"barcode","barcode":"111","displayName":"Whole Milk"}', null);

insert into public.member_dislikes (household_id, user_id, display_name) values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'Eggs'),
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'Cilantro');
