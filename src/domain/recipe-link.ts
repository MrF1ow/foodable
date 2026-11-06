import { isPublicAddress } from "../fetch-safe.js";
import type { RecipeSourceKind } from "./recipe-import.js";

export const RECIPE_LINK_TRACKING_PARAMS = [
    "fbclid",
    "gclid",
    "dclid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "igsh",
    "igshid",
    "obrf",
    "si",
    "ref",
    "ref_src",
    "ref_url",
    "_ga",
    "_gl",
    "is_from_webapp",
    "sender_device",
    "web_id",
    "_r",
    "_t",
    "mibextid",
    "rdid",
    "share_url",
    "feature",
    "pp",
] as const;

/**
 * Sites whose terms forbid all automated access. The research did not read
 * per-site terms; add a hostname here when the household decides a site
 * should skip the fetcher and go straight to "paste the recipe".
 */
export const PASTE_ONLY_SITES: readonly string[] = [];

export type RecipeSourceInfo = {
    kind: RecipeSourceKind;
    label: string;
    shortLink: boolean;
    pasteOnly: boolean;
};

function isTrackingParam(name: string): boolean {
    const lower = name.toLowerCase();
    if (lower.startsWith("utm_")) return true;
    return (RECIPE_LINK_TRACKING_PARAMS as readonly string[]).includes(lower);
}

function hostnameBlocked(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost") return true;
    const suffixes = [
        ".localhost",
        ".local",
        ".internal",
        ".home.arpa",
    ] as const;
    for (const suffix of suffixes) {
        if (host === suffix.slice(1) || host.endsWith(suffix)) return true;
    }
    return false;
}

function parseIpv4(host: string): boolean {
    const parts = host.split(".");
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d+$/.test(p) && Number(p) <= 255);
}

export function validateRecipeLink(
    raw: string,
): { ok: true; url: URL } | { ok: false; reason: "invalid_link" } {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, reason: "invalid_link" };

    let href = trimmed;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        href = `https://${href}`;
    }

    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return { ok: false, reason: "invalid_link" };
    }

    if (url.protocol === "http:") {
        url = new URL(url.href.replace(/^http:/i, "https:"));
    }
    if (url.protocol !== "https:") {
        return { ok: false, reason: "invalid_link" };
    }
    if (url.username || url.password) {
        return { ok: false, reason: "invalid_link" };
    }
    if (url.port && url.port !== "443") {
        return { ok: false, reason: "invalid_link" };
    }

    const host = url.hostname.toLowerCase();
    if (hostnameBlocked(host)) {
        return { ok: false, reason: "invalid_link" };
    }

    const isIp = parseIpv4(host) || host.includes(":");
    if (isIp) {
        if (!isPublicAddress(host)) {
            return { ok: false, reason: "invalid_link" };
        }
    } else if (!host.includes(".")) {
        return { ok: false, reason: "invalid_link" };
    }

    return { ok: true, url };
}

export function cleanRecipeLink(url: URL): string {
    const cleaned = new URL(url.href);
    cleaned.hash = "";
    cleaned.hostname = cleaned.hostname.toLowerCase();
    if (cleaned.port === "443") cleaned.port = "";

    const kept = new URLSearchParams();
    for (const [key, value] of cleaned.searchParams.entries()) {
        if (!isTrackingParam(key)) {
            kept.append(key, value);
        }
    }
    const sorted = new URLSearchParams(
        [...kept.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    cleaned.search = sorted.toString() ? `?${sorted.toString()}` : "";

    let path = cleaned.pathname;
    if (path.length > 1 && path.endsWith("/")) {
        path = path.slice(0, -1);
    }
    cleaned.pathname = path;

    return cleaned.href;
}

function hostMatches(host: string, pattern: string): boolean {
    const h = host.toLowerCase();
    const p = pattern.toLowerCase();
    return h === p || h.endsWith(`.${p}`);
}

function isPinterestHost(host: string): boolean {
    const h = host.toLowerCase();
    if (hostMatches(h, "pinterest.com")) return true;
    if (hostMatches(h, "pin.it")) return true;
    if (/^([a-z0-9-]+\.)*pinterest\.[a-z]{2}$/.test(h)) return true;
    if (/^([a-z0-9-]+\.)*pinterest\.co\.[a-z]{2}$/.test(h)) return true;
    return false;
}

export function hostOnPasteOnlyList(
    hostname: string,
    list: readonly string[] = PASTE_ONLY_SITES,
): boolean {
    const host = hostname.toLowerCase();
    return list.some(
        (entry) =>
            host === entry.toLowerCase() ||
            host.endsWith(`.${entry.toLowerCase()}`),
    );
}

export function recipeSource(url: URL): RecipeSourceInfo {
    const host = url.hostname.toLowerCase();
    const pasteOnly = hostOnPasteOnlyList(host);

    if (hostMatches(host, "instagram.com") || hostMatches(host, "instagr.am")) {
        return {
            kind: "instagram",
            label: "Instagram",
            shortLink: false,
            pasteOnly,
        };
    }
    if (
        hostMatches(host, "facebook.com") ||
        hostMatches(host, "fb.com") ||
        hostMatches(host, "m.facebook.com") ||
        hostMatches(host, "fb.watch")
    ) {
        return {
            kind: "facebook",
            label: "Facebook",
            shortLink: hostMatches(host, "fb.watch"),
            pasteOnly,
        };
    }
    if (hostMatches(host, "threads.net") || hostMatches(host, "threads.com")) {
        return {
            kind: "threads",
            label: "Threads",
            shortLink: false,
            pasteOnly,
        };
    }
    if (
        hostMatches(host, "tiktok.com") ||
        hostMatches(host, "vm.tiktok.com") ||
        hostMatches(host, "vt.tiktok.com")
    ) {
        return {
            kind: "tiktok",
            label: "TikTok",
            shortLink:
                hostMatches(host, "vm.tiktok.com") ||
                hostMatches(host, "vt.tiktok.com"),
            pasteOnly,
        };
    }
    if (isPinterestHost(host)) {
        return {
            kind: "pinterest",
            label: "Pinterest",
            shortLink: hostMatches(host, "pin.it"),
            pasteOnly,
        };
    }
    if (
        hostMatches(host, "youtube.com") ||
        hostMatches(host, "m.youtube.com") ||
        hostMatches(host, "music.youtube.com") ||
        hostMatches(host, "youtu.be")
    ) {
        return {
            kind: "youtube",
            label: "YouTube",
            shortLink: hostMatches(host, "youtu.be"),
            pasteOnly,
        };
    }

    const label = host.startsWith("www.") ? host.slice(4) : host;
    return {
        kind: "website",
        label,
        shortLink: false,
        pasteOnly,
    };
}

export function recipeLinkKey(raw: string): string | null {
    const validated = validateRecipeLink(raw);
    if (!validated.ok) return null;
    return cleanRecipeLink(validated.url);
}
