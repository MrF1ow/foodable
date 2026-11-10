-- Per-subject last-known kill-switch values (global, household, user).

alter table public.flag_snapshot
    add column subject_kind text not null default 'global',
    add column subject_id text not null default '';

alter table public.flag_snapshot
    add constraint flag_snapshot_subject_kind_check
        check (subject_kind in ('global', 'household', 'user'));

-- foodable:contract one snapshot row per flag becomes one row per flag and subject; existing rows are global via defaults
alter table public.flag_snapshot drop constraint flag_snapshot_pkey;

alter table public.flag_snapshot
    add constraint flag_snapshot_flag_subject_key unique (
        flag_name,
        subject_kind,
        subject_id
    );
