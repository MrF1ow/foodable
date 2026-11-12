-- A weigh-in reminder is about a household member, so a dismissal of it names
-- a member as its subject. The check on subject_kind was written before that
-- kind existed and refused the row. Additive: the same constraint with one more
-- allowed value; no row changes.

alter table public.notice_dismissals
    drop constraint if exists notice_dismissals_subject_kind_check;

alter table public.notice_dismissals
    add constraint notice_dismissals_subject_kind_check check (subject_kind in (
        'food', 'recipe', 'recipe_ingredient', 'fridge_item', 'grocery_line',
        'member'
    ));
