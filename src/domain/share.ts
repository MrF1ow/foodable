import { cleanRecipeLink, validateRecipeLink } from "./recipe-link.js";

const SHARE_FIELD_CAP = 20_000;
const TITLE_AS_TEXT_MIN = 80;
/** Max bytes for post-login `/share?…` return paths (server-side OAuth session). */
export const SHARE_RETURN_PATH_MAX = 64 * 1024;

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]}]+/gi;

export type ShareDetectedFrom = "url" | "text" | "title";

export type ReadShareResult = {
    link: string | null;
    text: string | null;
    title: string | null;
    detectedFrom: ShareDetectedFrom | null;
    raw: { title: string; text: string; url: string };
};

function trimField(value: string | undefined): string {
    return (value ?? "").trim();
}

function capShareFields(
    title: string,
    text: string,
    url: string,
): { title: string; text: string; url: string } {
    let t = title;
    let x = text;
    let u = url;
    let total = t.length + x.length + u.length;
    if (total <= SHARE_FIELD_CAP) {
        return { title: t, text: x, url: u };
    }
    const trimOne = (s: string, take: number) =>
        take <= 0 ? "" : s.length <= take ? s : s.slice(0, take);
    u = trimOne(u, Math.min(u.length, SHARE_FIELD_CAP));
    total = t.length + x.length + u.length;
    if (total > SHARE_FIELD_CAP) {
        const room = Math.max(0, SHARE_FIELD_CAP - u.length);
        const half = Math.floor(room / 2);
        t = trimOne(t, Math.min(t.length, half));
        x = trimOne(x, Math.min(x.length, room - t.length));
    }
    return { title: t, text: x, url: u };
}

function firstRecipeLinkIn(haystack: string): {
    link: string;
    match: string;
} | null {
    if (!haystack) return null;
    URL_IN_TEXT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_IN_TEXT.exec(haystack)) !== null) {
        let candidate = m[0]!;
        while (/[.,;:!?)}\]'"]+$/.test(candidate)) {
            candidate = candidate.slice(0, -1);
        }
        const validated = validateRecipeLink(candidate);
        if (validated.ok) {
            return {
                link: cleanRecipeLink(validated.url),
                match: m[0]!.slice(0, candidate.length),
            };
        }
    }
    return null;
}

function bareUrlText(text: string, linkMatch: string): string | null {
    const rest = text.replace(linkMatch, "").trim();
    return rest.length === 0 ? null : text;
}

function hasControlChars(s: string): boolean {
    return /[\u0000-\u001f\u007f]/.test(s);
}

function pathHasDotSegment(pathname: string): boolean {
    for (const seg of pathname.split("/")) {
        if (seg === "") continue;
        if (seg === "." || seg === "..") return true;
        try {
            const dec = decodeURIComponent(seg);
            if (dec === "." || dec === "..") return true;
        } catch {
            return true;
        }
    }
    return false;
}

/**
 * Same-origin return paths after site login for the share target.
 * Returns normalized `pathname + search`, or null when rejected.
 */
export function isSafeShareReturnPath(path: string): string | null {
    if (path.length === 0 || path.length > SHARE_RETURN_PATH_MAX) return null;
    if (!path.startsWith("/")) return null;
    if (path.startsWith("//")) return null;
    if (path.includes("\\")) return null;
    if (hasControlChars(path)) return null;

    const rawPath = path.split("?")[0] ?? "";
    // Only the path must be free of encoded controls. A caption is multiline,
    // so the query carries %0A; URL keeps it percent-encoded in `search`, and
    // a raw control (which could split a header) was refused above.
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(rawPath);
    } catch {
        return null;
    }
    if (hasControlChars(decodedPath)) return null;
    if (pathHasDotSegment(rawPath)) return null;

    let url: URL;
    try {
        url = new URL(path, "https://placeholder.invalid");
    } catch {
        return null;
    }
    if (url.origin !== "https://placeholder.invalid") return null;
    if (pathHasDotSegment(url.pathname)) return null;

    if (url.pathname !== "/share" && url.pathname !== "/share/probe") {
        return null;
    }

    return url.pathname + url.search;
}

export function readShare(input: {
    title?: string;
    text?: string;
    url?: string;
}): ReadShareResult {
    const raw = capShareFields(
        trimField(input.title),
        trimField(input.text),
        trimField(input.url),
    );

    let link: string | null = null;
    let detectedFrom: ShareDetectedFrom | null = null;
    let linkMatchInText: string | null = null;

    const urlValidated = raw.url ? validateRecipeLink(raw.url) : null;
    if (urlValidated?.ok) {
        link = cleanRecipeLink(urlValidated.url);
        detectedFrom = "url";
    } else {
        const fromText = firstRecipeLinkIn(raw.text);
        if (fromText) {
            link = fromText.link;
            detectedFrom = "text";
            linkMatchInText = fromText.match;
        } else {
            const fromTitle = firstRecipeLinkIn(raw.title);
            if (fromTitle) {
                link = fromTitle.link;
                detectedFrom = "title";
            }
        }
    }

    let text: string | null = null;
    if (raw.text) {
        if (link && detectedFrom === "text" && linkMatchInText) {
            text = bareUrlText(raw.text, linkMatchInText);
        } else if (link && detectedFrom === "url" && raw.text === raw.url) {
            text = null;
        } else {
            text = raw.text;
        }
    } else if (!raw.text && raw.title.length > TITLE_AS_TEXT_MIN) {
        text = raw.title;
    }

    return {
        link,
        text,
        title: raw.title.length > 0 ? raw.title : null,
        detectedFrom,
        raw,
    };
}
