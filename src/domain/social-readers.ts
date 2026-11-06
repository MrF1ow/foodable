import type { FetchFailure } from "../fetch-safe.js";
import type { SafeFetcher } from "../fetch-safe.js";
import { decodeRecipeHtmlEntities } from "./recipe-jsonld.js";

export type ReaderFailure =
    | "robots_disallowed"
    | "blocked"
    | "timeout"
    | "not_found"
    | "empty"
    | "format_changed"
    | "unsupported_link"
    | "network";

export type ReaderResult =
    | { ok: true; text: string; transcript: string | null }
    | { ok: false; reason: ReaderFailure };

export type SocialReaderId = "tiktok" | "facebook";

export type SocialReaderStatusRow = {
    reader: SocialReaderId;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastFailureReason: string | null;
};

export type SocialReaderStatusStore = {
    get(householdId: string): Promise<SocialReaderStatusRow[]>;
    recordSuccess(
        householdId: string,
        reader: SocialReaderId,
        at: Date,
    ): Promise<void>;
    recordFailure(
        householdId: string,
        reader: SocialReaderId,
        at: Date,
        reason: ReaderFailure,
    ): Promise<void>;
};

export function readerFailureFromFetch(reason: FetchFailure): ReaderFailure {
    switch (reason) {
        case "site_refused":
            return "blocked";
        case "timeout":
            return "timeout";
        case "not_found":
            return "not_found";
        case "robots_disallowed":
            return "robots_disallowed";
        default:
            return "network";
    }
}

const ENGLISH_SUBTITLE_RE = /^(eng(-us)?|en)([-_]|$)/i;

function pickSubtitleUrl(
    tracks: { language: string; url: string }[],
): string | null {
    if (tracks.length === 0) return null;
    const english = tracks.find((t) => ENGLISH_SUBTITLE_RE.test(t.language));
    return (english ?? tracks[0])!.url;
}

export type TikTokPageParse =
    | { ok: true; text: string; subtitleUrl: string | null }
    | { ok: false; reason: ReaderFailure };

export function parseTikTokPage(html: string): TikTokPageParse {
    const match = html.match(
        /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!match?.[1]) {
        return { ok: false, reason: "format_changed" };
    }
    let data: unknown;
    try {
        data = JSON.parse(match[1]);
    } catch {
        return { ok: false, reason: "format_changed" };
    }
    const scope = (data as { __DEFAULT_SCOPE__?: unknown })?.__DEFAULT_SCOPE__;
    if (!scope || typeof scope !== "object") {
        return { ok: false, reason: "format_changed" };
    }
    const detail = (scope as Record<string, unknown>)["webapp.video-detail"];
    if (!detail || typeof detail !== "object") {
        return { ok: false, reason: "format_changed" };
    }
    const itemInfo = (detail as { itemInfo?: unknown }).itemInfo;
    if (!itemInfo || typeof itemInfo !== "object") {
        return { ok: false, reason: "format_changed" };
    }
    const itemStruct = (itemInfo as { itemStruct?: unknown }).itemStruct;
    if (!itemStruct || typeof itemStruct !== "object") {
        return { ok: false, reason: "format_changed" };
    }
    const struct = itemStruct as {
        desc?: unknown;
        video?: {
            subtitleInfos?: Array<{
                LanguageCodeName?: string;
                Url?: string;
            }>;
            claInfo?: {
                captionInfos?: Array<{ language?: string; url?: string }>;
            };
        };
    };
    const desc = typeof struct.desc === "string" ? struct.desc.trim() : "";
    const tracks: { language: string; url: string }[] = [];
    for (const info of struct.video?.subtitleInfos ?? []) {
        if (typeof info?.Url === "string" && info.Url.trim()) {
            tracks.push({
                language: String(info.LanguageCodeName ?? ""),
                url: info.Url.trim(),
            });
        }
    }
    for (const info of struct.video?.claInfo?.captionInfos ?? []) {
        if (typeof info?.url === "string" && info.url.trim()) {
            tracks.push({
                language: String(info.language ?? ""),
                url: info.url.trim(),
            });
        }
    }
    const subtitleUrl = pickSubtitleUrl(tracks);
    if (!desc && !subtitleUrl) {
        return { ok: false, reason: "empty" };
    }
    return { ok: true, text: desc, subtitleUrl };
}

export function webVttToText(vtt: string): string {
    const lines = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const cues: string[] = [];
    let inNote = false;
    let inStyle = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
            inNote = false;
            inStyle = false;
            continue;
        }
        if (/^WEBVTT/i.test(line)) continue;
        if (/^NOTE/i.test(line)) {
            inNote = true;
            continue;
        }
        if (/^STYLE/i.test(line)) {
            inStyle = true;
            continue;
        }
        if (inNote || inStyle) continue;
        if (/^\d+$/.test(line)) continue;
        if (/^\d{2}:\d{2}/.test(line) || line.includes("-->")) continue;
        let text = line.replace(/<[^>]+>/g, "");
        text = text.replace(/<\d{2}:\d{2}[^>]*>/g, "");
        text = text.trim();
        if (text) cues.push(text);
    }
    const deduped: string[] = [];
    for (const cue of cues) {
        if (deduped.at(-1) !== cue) deduped.push(cue);
    }
    return deduped.join(" ").replace(/\s+/g, " ").trim();
}

export function facebookOembedEndpoint(
    url: string,
):
    | { ok: true; endpoint: "oembed_video" | "oembed_post" }
    | { ok: false; reason: "unsupported_link" } {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, reason: "unsupported_link" };
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const full = `${host}${path}`;

    if (host === "fb.watch" || host.endsWith(".fb.watch")) {
        return { ok: true, endpoint: "oembed_video" };
    }
    if (host === "fb.me" || host.endsWith(".fb.me")) {
        return { ok: true, endpoint: "oembed_video" };
    }
    if (!host.includes("facebook.com") && !host.includes("fb.com")) {
        return { ok: false, reason: "unsupported_link" };
    }
    if (path.includes("/groups/")) {
        return { ok: false, reason: "unsupported_link" };
    }

    if (
        path.includes("/videos/") ||
        path.includes("/reel/") ||
        path.includes("/watch") ||
        path.includes("/share/v/")
    ) {
        return { ok: true, endpoint: "oembed_video" };
    }
    if (path.includes("/share/r/")) {
        return { ok: true, endpoint: "oembed_video" };
    }
    if (
        path.includes("/posts/") ||
        path.includes("/permalink.php") ||
        path.includes("/photo") ||
        path.includes("/photo.php") ||
        path.includes("/story.php") ||
        path.includes("/share/p/")
    ) {
        return { ok: true, endpoint: "oembed_post" };
    }
    return { ok: false, reason: "unsupported_link" };
}

/** Undocumented fallback markup inside tokenless oEmbed HTML; Meta may remove it. */
export function parseFacebookOembed(jsonText: string): ReaderResult {
    let payload: { html?: unknown };
    try {
        payload = JSON.parse(jsonText) as { html?: unknown };
    } catch {
        return { ok: false, reason: "format_changed" };
    }
    if (typeof payload.html !== "string" || !payload.html.trim()) {
        return { ok: false, reason: "format_changed" };
    }
    const blockMatch = payload.html.match(
        /<blockquote[^>]*class="[^"]*\bfb-xfbml-parse-ignore\b[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i,
    );
    if (!blockMatch?.[1]) {
        return { ok: false, reason: "format_changed" };
    }
    const inner = blockMatch[1];
    const titleMatch = inner.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch?.[1]
        ? decodeRecipeHtmlEntities(titleMatch[1])
        : "";
    const paragraphs: string[] = [];
    for (const pMatch of inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
        const text = decodeRecipeHtmlEntities(pMatch[1] ?? "");
        if (text) paragraphs.push(text);
    }
    let body = paragraphs.join("\n").trim();
    if (!body && title) body = title;
    else if (title && body && !body.startsWith(title)) {
        body = `${title}\n${body}`;
    }
    body = body
        .replace(/\s*Posted by[\s\S]*$/i, "")
        .replace(/\s*A post shared by[\s\S]*$/i, "")
        .trim();
    if (!body) {
        return { ok: false, reason: "empty" };
    }
    return { ok: true, text: body, transcript: null };
}

export function facebookGraphOembedUrl(
    endpoint: "oembed_video" | "oembed_post",
    link: string,
): string {
    return `https://graph.facebook.com/v27.0/${endpoint}?url=${encodeURIComponent(link)}`;
}

export async function readTikTok(
    fetcher: SafeFetcher,
    url: string,
): Promise<ReaderResult> {
    const page = await fetcher.fetchPage(url, {
        accept: ["text/html"],
        checkRobots: true,
    });
    if (!page.ok) {
        return { ok: false, reason: readerFailureFromFetch(page.reason) };
    }
    const parsed = parseTikTokPage(page.body);
    if (!parsed.ok) return parsed;
    if (!parsed.subtitleUrl) {
        return { ok: true, text: parsed.text, transcript: null };
    }
    const sub = await fetcher.fetchPage(parsed.subtitleUrl, {
        accept: ["text/vtt", "text/plain", "application/octet-stream"],
        checkRobots: true,
    });
    if (!sub.ok) {
        return { ok: true, text: parsed.text, transcript: null };
    }
    const transcript = webVttToText(sub.body);
    return {
        ok: true,
        text: parsed.text,
        transcript: transcript || null,
    };
}

export async function readFacebook(
    fetcher: SafeFetcher,
    url: string,
): Promise<ReaderResult> {
    const endpoint = facebookOembedEndpoint(url);
    if (!endpoint.ok) {
        return { ok: false, reason: endpoint.reason };
    }
    const graphUrl = facebookGraphOembedUrl(endpoint.endpoint, url);
    // Tokenless Graph oEmbed is an API endpoint, not a web page; robots.txt does not apply.
    const res = await fetcher.fetchPage(graphUrl, {
        accept: ["application/json", "text/javascript"],
        checkRobots: false,
    });
    if (!res.ok) {
        return { ok: false, reason: readerFailureFromFetch(res.reason) };
    }
    return parseFacebookOembed(res.body);
}

export function createMemorySocialReaderStatusStore(): SocialReaderStatusStore {
    const rows = new Map<string, SocialReaderStatusRow>();

    function key(householdId: string, reader: SocialReaderId): string {
        return `${householdId}:${reader}`;
    }

    return {
        async get(householdId) {
            const out: SocialReaderStatusRow[] = [];
            for (const reader of ["tiktok", "facebook"] as const) {
                const row = rows.get(key(householdId, reader));
                out.push(
                    row ?? {
                        reader,
                        lastSuccessAt: null,
                        lastFailureAt: null,
                        lastFailureReason: null,
                    },
                );
            }
            return out;
        },
        async recordSuccess(householdId, reader, at) {
            const existing = rows.get(key(householdId, reader));
            rows.set(key(householdId, reader), {
                reader,
                lastSuccessAt: at.toISOString(),
                lastFailureAt: existing?.lastFailureAt ?? null,
                lastFailureReason: existing?.lastFailureReason ?? null,
            });
        },
        async recordFailure(householdId, reader, at, reason) {
            const existing = rows.get(key(householdId, reader));
            rows.set(key(householdId, reader), {
                reader,
                lastSuccessAt: existing?.lastSuccessAt ?? null,
                lastFailureAt: at.toISOString(),
                lastFailureReason: reason,
            });
        },
    };
}
