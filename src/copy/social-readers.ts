import type { ReaderFailure } from "../domain/social-readers.js";

export type SocialReaderId = "tiktok" | "facebook";

export const SOCIAL_READER_LABELS: Record<SocialReaderId, string> = {
    tiktok: "TikTok",
    facebook: "Facebook",
};

const TIKTOK_FAILURE: Record<ReaderFailure, string> = {
    empty: "TikTok didn't send the caption this time.",
    format_changed: "TikTok didn't send the caption this time.",
    blocked: "TikTok refused the request.",
    timeout: "TikTok took too long to respond.",
    robots_disallowed: "TikTok's robots.txt asks apps not to read this page.",
    not_found: "That TikTok video doesn't exist anymore.",
    unsupported_link: "This TikTok link can't be read automatically.",
    network: "Couldn't reach TikTok.",
};

const FACEBOOK_FAILURE: Record<ReaderFailure, string> = {
    empty: "Facebook didn't include the caption this time.",
    format_changed: "Facebook changed its embed format.",
    blocked: "Facebook refused the request.",
    timeout: "Facebook took too long to respond.",
    robots_disallowed: "Facebook's robots.txt asks apps not to read this page.",
    not_found: "That Facebook post doesn't exist anymore.",
    unsupported_link: "This kind of Facebook link can't be read automatically.",
    network: "Couldn't reach Facebook.",
};

/** The reader worked, but neither the caption nor the subtitles hold a
 *  recipe (it's in the photos, or a link in bio). */
export function readerNoRecipeSentence(reader: SocialReaderId): string {
    return reader === "tiktok"
        ? "The TikTok caption doesn't include the recipe."
        : "The Facebook caption doesn't include the recipe.";
}

export function readerFailureSentence(
    reader: SocialReaderId,
    reason: ReaderFailure,
): string {
    return reader === "tiktok"
        ? TIKTOK_FAILURE[reason]
        : FACEBOOK_FAILURE[reason];
}

export const SOCIAL_READER_RISK_INTRO =
    "Reading posts automatically goes against that platform's terms of service. The platform can block this server at any time; on a shared host that can affect anything else the server asks of that platform. When that happens, recipe imports fall back to pasting the caption, and nothing breaks.";

export const SOCIAL_READER_RESEARCH_URL =
    "https://github.com/MrF1ow/foodable/blob/main/docs/research/recipe-import-terms-2026-11.md";

export const SOCIAL_READER_FACEBOOK_CAVEAT =
    "It reads the caption from Facebook's embed code, which Facebook doesn't document and can change without notice.";

export const SOCIAL_READER_OWNER_ONLY =
    "Only the household owner can change this.";

export function socialReaderConfirmLabel(reader: SocialReaderId): string {
    return `I understand this goes against ${SOCIAL_READER_LABELS[reader]}'s terms`;
}

export function socialReaderTurnOnLabel(reader: SocialReaderId): string {
    return `Turn on ${SOCIAL_READER_LABELS[reader]} reader`;
}

export function socialReaderTurnOffLabel(reader: SocialReaderId): string {
    return `Turn off ${SOCIAL_READER_LABELS[reader]} reader`;
}
