/**
 * What a recipe import says about each outcome. The web import sheet shows it
 * inline and the MCP import tools return it as `message`, so both read it
 * through `importOutcomeMessage`. `{name}`, `{site}`, `{platform}`, `{count}`
 * and `{reason}` are filled from the outcome. A duplicate is the one outcome
 * that is also a toast, so its text lives in `TOASTS`
 * (`recipes.import.duplicate`).
 */
export type ImportMessage = {
    /** What happened, in one short line. */
    headline: string;
    /** Why, or what to do next; shown under the headline, joined to it by a space in the one-line `message`. */
    reason?: string;
};

export const IMPORT_MESSAGES = {
    imported: { headline: "Imported {name} from {site}." },
    unverified_needs_review: {
        headline: "Imported as unverified: {count} need checking.",
    },
    unverified_needs_review_one: {
        headline: "Imported as unverified: {count} needs checking.",
    },
    paste_needed: { headline: "Paste the {platform} caption below." },
    paste_needed_site: { headline: "Paste the recipe from {site} below." },
    paste_needed_reader: {
        headline: "Paste the {platform} caption below.",
        reason: "{reason}",
    },
    no_recipe_in_text: {
        headline: "This caption doesn't contain a recipe.",
        reason: "If it's in the photos, type it in or send a screenshot to your agent.",
    },
    no_recipe_on_page: {
        headline: "This page doesn't publish its recipe in a form we can read.",
        reason: "Paste the recipe instead.",
    },
    robots_disallowed: {
        headline: "This site asks apps not to read this page.",
        reason: "Paste the recipe instead.",
    },
    site_refused: {
        headline: "The site refused the request.",
        reason: "Paste the recipe instead.",
    },
    site_refused_recent: {
        headline: "This site refused Foodable recently.",
        reason: "Paste the recipe instead.",
    },
    not_found: { headline: "That page doesn't exist anymore." },
    not_found_recent: { headline: "That page doesn't exist anymore." },
    timeout: { headline: "The page took too long to respond." },
    invalid_link: { headline: "That doesn't look like a web link." },
} as const satisfies Record<string, ImportMessage>;

export type ImportMessageKey = keyof typeof IMPORT_MESSAGES;
