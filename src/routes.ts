// Locale data for the English-only login template and widget UI language.

export type SiteLocale = "en";
export const SITE_LOCALES: readonly SiteLocale[] = ["en"];

export const LOCALE_NAMES: Record<SiteLocale, string> = {
    en: "English",
};

/** IETF BCP 47 tag for `<html lang>`. */
export const HTML_LANG: Record<SiteLocale, string> = {
    en: "en",
};
