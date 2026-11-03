alter table public.profiles
    add column if not exists theme text
        check (theme is null or theme in ('light', 'dark'));

alter table public.profiles
    add column if not exists accent_swatch text
        check (
            accent_swatch is null
            or accent_swatch in (
                'sky',
                'violet',
                'teal',
                'rose',
                'amber',
                'slate'
            )
        );
