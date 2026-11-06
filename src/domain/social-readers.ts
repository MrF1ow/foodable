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
        case "host_not_allowed":
        case "blocked_address":
            return "blocked";
        case "too_large":
        case "bad_content_type":
        case "too_many_redirects":
            return "format_changed";
        default:
            return "network";
    }
}

export const TIKTOK_PAGE_ALLOWED_HOSTS = ["tiktok.com"] as const;

export const TIKTOK_SUBTITLE_ALLOWED_HOSTS = [
    "tiktok.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokv.com",
    "ibytedtos.com",
] as const;

export const FACEBOOK_GRAPH_ALLOWED_HOSTS = ["graph.facebook.com"] as const;

function subtitleTrackList(value: unknown): Array<{
    LanguageCodeName?: string;
    Url?: string;
    language?: string;
    url?: string;
}> {
    return Array.isArray(value) ? value : [];
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
    try {
        return parseTikTokPageInner(html);
    } catch {
        return { ok: false, reason: "format_changed" };
    }
}

function parseTikTokPageInner(html: string): TikTokPageParse {
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
    for (const info of subtitleTrackList(struct.video?.subtitleInfos)) {
        if (typeof info?.Url === "string" && info.Url.trim()) {
            tracks.push({
                language: String(info.LanguageCodeName ?? ""),
                url: info.Url.trim(),
            });
        }
    }
    for (const info of subtitleTrackList(struct.video?.claInfo?.captionInfos)) {
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

function isVttMetadataBlock(block: string): boolean {
    if (block.includes("-->")) return false;
    const first = block
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (!first) return true;
    if (/^WEBVTT/i.test(first)) return true;
    if (/^X-TIMESTAMP-MAP=/i.test(first)) return true;
    if (/^REGION(\s|$)/i.test(first)) return true;
    if (/^NOTE(\s|$)/i.test(first)) return true;
    if (/^STYLE(\s|$)/i.test(first)) return true;
    return false;
}

export function webVttToText(vtt: string): string {
    const normalized = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = normalized.split(/\n\n+/);
    const cues: string[] = [];
    for (const block of blocks) {
        if (!block.trim() || isVttMetadataBlock(block)) continue;
        const lines = block.split("\n");
        let i = 0;
        while (i < lines.length && !lines[i]!.trim()) i += 1;
        if (i >= lines.length) continue;
        const firstLine = lines[i]!.trim();
        if (/^\d+$/.test(firstLine)) {
            const nextCue = lines.slice(i + 1).find((l) => l.trim());
            if (nextCue?.includes("-->")) i += 1;
        }
        const timingIdx = lines.findIndex(
            (line, idx) => idx >= i && line.includes("-->"),
        );
        if (timingIdx === -1) continue;
        const textLines = lines.slice(timingIdx + 1).filter((l) => l.trim());
        let text = textLines
            .join(" ")
            .replace(/<[^>]+>/g, "")
            .replace(/<\d{2}:\d{2}[^>]*>/g, "");
        text = decodeRecipeHtmlEntities(text).trim();
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
        path.includes("/reels/") ||
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

function extractOuterFacebookBlockquote(html: string): string | null {
    const openRe =
        /<blockquote[^>]*class="[^"]*\bfb-xfbml-parse-ignore\b[^"]*"[^>]*>/i;
    const openMatch = openRe.exec(html);
    if (!openMatch) return null;
    const contentStart = openMatch.index! + openMatch[0].length;
    const lower = html.toLowerCase();
    let depth = 1;
    let i = contentStart;
    while (i < html.length && depth > 0) {
        const nextOpen = lower.indexOf("<blockquote", i);
        const nextClose = lower.indexOf("</blockquote>", i);
        if (nextClose === -1) return null;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth += 1;
            i = nextOpen + 1;
            continue;
        }
        depth -= 1;
        if (depth === 0) {
            return html.slice(contentStart, nextClose);
        }
        i = nextClose + 1;
    }
    return null;
}

function stripFacebookBlockquoteAttribution(inner: string): string {
    return inner
        .replace(
            /\s*Posted by\s+(?:<a\b[^>]*>[\s\S]*?<\/a>\s*)+on[\s\S]*$/i,
            "",
        )
        .replace(/\s*A post shared by[\s\S]*$/i, "")
        .trim();
}

function parseFacebookBlockquoteInner(inner: string): string {
    const stripped = stripFacebookBlockquoteAttribution(inner);
    const firstP = stripped.search(/<p[\s>]/i);
    const firstPIdx = firstP === -1 ? stripped.length : firstP;
    const prefix = stripped.slice(0, firstPIdx);
    const titleMatch = prefix.match(/^\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*$/i);
    const title = titleMatch?.[1]
        ? decodeRecipeHtmlEntities(titleMatch[1].trim())
        : "";
    const paragraphs: string[] = [];
    for (const pMatch of stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
        const text = decodeRecipeHtmlEntities(pMatch[1] ?? "").trim();
        if (text) paragraphs.push(text);
    }
    let body = paragraphs.join("\n").trim();
    if (!body && title) body = title;
    else if (title && body && !body.startsWith(title)) {
        body = `${title}\n${body}`;
    }
    return body.trim();
}

/** Undocumented fallback markup inside tokenless oEmbed HTML; Meta may remove it. */
export function parseFacebookOembed(jsonText: string): ReaderResult {
    try {
        let payload: unknown;
        try {
            payload = JSON.parse(jsonText);
        } catch {
            return { ok: false, reason: "format_changed" };
        }
        if (!payload || typeof payload !== "object") {
            return { ok: false, reason: "format_changed" };
        }
        const html = (payload as { html?: unknown }).html;
        if (typeof html !== "string" || !html.trim()) {
            return { ok: false, reason: "format_changed" };
        }
        const inner = extractOuterFacebookBlockquote(html);
        if (!inner) {
            return { ok: false, reason: "format_changed" };
        }
        const body = parseFacebookBlockquoteInner(inner);
        if (!body) {
            return { ok: false, reason: "empty" };
        }
        return { ok: true, text: body, transcript: null };
    } catch {
        return { ok: false, reason: "format_changed" };
    }
}

export function facebookGraphOembedUrl(
    endpoint: "oembed_video" | "oembed_post",
    link: string,
): string {
    return `https://graph.facebook.com/v27.0/${endpoint}?url=${encodeURIComponent(link)}`;
}

async function runReader(
    fn: () => Promise<ReaderResult>,
): Promise<ReaderResult> {
    try {
        return await fn();
    } catch {
        return { ok: false, reason: "format_changed" };
    }
}

export async function readTikTok(
    fetcher: SafeFetcher,
    url: string,
): Promise<ReaderResult> {
    return runReader(async () => {
        const page = await fetcher.fetchPage(url, {
            accept: ["text/html"],
            checkRobots: true,
            allowedHosts: TIKTOK_PAGE_ALLOWED_HOSTS,
        });
        if (!page.ok) {
            return {
                ok: false,
                reason: readerFailureFromFetch(page.reason),
            };
        }
        let parsed: TikTokPageParse;
        try {
            parsed = parseTikTokPage(page.body);
        } catch {
            return { ok: false, reason: "format_changed" };
        }
        if (!parsed.ok) return parsed;
        if (!parsed.subtitleUrl) {
            return { ok: true, text: parsed.text, transcript: null };
        }
        const sub = await fetcher.fetchPage(parsed.subtitleUrl, {
            accept: ["text/vtt", "text/plain", "application/octet-stream"],
            checkRobots: true,
            allowedHosts: TIKTOK_SUBTITLE_ALLOWED_HOSTS,
        });
        if (!sub.ok) {
            return { ok: true, text: parsed.text, transcript: null };
        }
        let transcript: string;
        try {
            transcript = webVttToText(sub.body);
        } catch {
            return { ok: true, text: parsed.text, transcript: null };
        }
        return {
            ok: true,
            text: parsed.text,
            transcript: transcript || null,
        };
    });
}

export async function readFacebook(
    fetcher: SafeFetcher,
    url: string,
): Promise<ReaderResult> {
    return runReader(async () => {
        const endpoint = facebookOembedEndpoint(url);
        if (!endpoint.ok) {
            return { ok: false, reason: endpoint.reason };
        }
        const graphUrl = facebookGraphOembedUrl(endpoint.endpoint, url);
        // Tokenless Graph oEmbed is an API endpoint, not a web page; robots.txt does not apply.
        const res = await fetcher.fetchPage(graphUrl, {
            accept: ["application/json", "text/javascript"],
            checkRobots: false,
            allowedHosts: FACEBOOK_GRAPH_ALLOWED_HOSTS,
        });
        if (!res.ok) {
            return {
                ok: false,
                reason: readerFailureFromFetch(res.reason),
            };
        }
        return parseFacebookOembed(res.body);
    });
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
