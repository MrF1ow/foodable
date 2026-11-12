import { canonicalAppPath } from "./route-map.js";

const BLOCKED_PREFIXES = [
    "/settings",
    "/logout",
    "/login",
    "/authorize",
    "/approve",
    "/exports",
] as const;

function isSettingsHouseholdAppPath(pathname: string): boolean {
    const lower = pathname.toLowerCase();
    if (lower === "/settings/household") return true;
    return lower.startsWith("/settings/household/");
}

function isBlockedPathname(pathname: string): boolean {
    const lower = pathname.toLowerCase();
    if (isSettingsHouseholdAppPath(lower)) return false;
    return BLOCKED_PREFIXES.some(
        (blocked) => lower === blocked || lower.startsWith(`${blocked}/`),
    );
}

// Not pages: machine endpoints and public share links. A browser can hand
// one over as the referrer (iOS Safari sends a service worker's own script
// URL for the navigations it forwards), so a back link must never land there.
const MACHINE_PREFIXES = [
    "/api",
    "/mcp",
    "/s",
    "/token",
    "/register",
    "/.well-known",
] as const;

// A static file, by extension. Names with a dot elsewhere stay pages.
const FILE_EXTENSION =
    /\.(?:m?js|css|wasm|json|webmanifest|ico|png|svg|jpe?g|webp|gif|woff2?|ttf|txt|xml|map|zip|csv)$/i;

function isMachinePathname(pathname: string): boolean {
    const lower = pathname.toLowerCase();
    if (FILE_EXTENSION.test(lower)) return true;
    return MACHINE_PREFIXES.some(
        (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
    );
}

function hasDotSegment(pathname: string): boolean {
    return pathname
        .split("/")
        .some((segment) => segment === "." || segment === "..");
}

/**
 * A same-origin path the app may send someone back to. The pathname is
 * checked at every percent-decoding layer, because a browser decodes `%25`
 * once when following a redirect and the router decodes the rest: a value
 * like `/%6c%6f%67%6f%75%74` or `/%252e%252e/logout` must not reach
 * `/logout`.
 */
export function isSafeAppBackPath(path: string): boolean {
    if (path.length === 0 || path.length > 512) return false;
    if (!path.startsWith("/") || path.startsWith("//")) return false;
    if (path.includes("\\")) return false;
    if (/[\u0000-\u001f\u007f]/.test(path)) return false;
    const q = path.indexOf("?");
    let layer = q >= 0 ? path.slice(0, q) : path;
    for (let round = 0; round < 4; round++) {
        if (layer.startsWith("//") || layer.includes("\\")) return false;
        if (/[\u0000-\u001f\u007f]/.test(layer)) return false;
        if (hasDotSegment(layer) || isBlockedPathname(layer)) return false;
        if (isMachinePathname(layer)) return false;
        let resolved: URL;
        try {
            resolved = new URL(layer, "http://local");
        } catch {
            return false;
        }
        if (resolved.origin !== "http://local") return false;
        if (isBlockedPathname(resolved.pathname)) return false;
        if (isMachinePathname(resolved.pathname)) return false;
        let decoded: string;
        try {
            decoded = decodeURIComponent(layer);
        } catch {
            // A malformed escape in the value as given is refused. One that
            // only appears after decoding (`50%25off` → `50%off`) cannot be
            // decoded any further, so this layer was the last one.
            return round > 0;
        }
        if (decoded === layer) return true;
        layer = decoded;
    }
    return false;
}

export function settingsBackHref(input: {
    from?: string;
    referer?: string;
    origin: string;
}): string {
    const from = input.from?.trim();
    if (from) {
        const canon = canonicalAppPath(from);
        if (isSafeAppBackPath(canon)) return canon;
    }
    if (input.referer) {
        try {
            const url = new URL(input.referer);
            if (url.origin === input.origin) {
                const candidate = canonicalAppPath(url.pathname + url.search);
                if (isSafeAppBackPath(candidate)) return candidate;
            }
        } catch {
            /* ignore malformed referer */
        }
    }
    return "/";
}

export function settingsUrlWithBack(backHref: string): string {
    if (backHref === "/") return "/settings";
    return `/settings?from=${encodeURIComponent(backHref)}`;
}

export function householdSettingsUrlWithBack(backHref: string): string {
    if (backHref === "/") return "/settings/household-settings";
    return `/settings/household-settings?from=${encodeURIComponent(backHref)}`;
}
