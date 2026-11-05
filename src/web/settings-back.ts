export function isSafeAppBackPath(path: string): boolean {
    if (path.length === 0 || path.length > 512) return false;
    if (!path.startsWith("/") || path.startsWith("//")) return false;
    if (path.includes("\\")) return false;
    if (/[\u0000-\u001f\u007f]/.test(path)) return false;
    const q = path.indexOf("?");
    const pathname = q >= 0 ? path.slice(0, q) : path;
    if (pathname === "/settings" || pathname.startsWith("/settings/")) {
        return false;
    }
    for (const blocked of [
        "/logout",
        "/login",
        "/authorize",
        "/approve",
    ] as const) {
        if (pathname === blocked || pathname.startsWith(`${blocked}/`)) {
            return false;
        }
    }
    if (pathname === "/exports" || pathname.startsWith("/exports/")) {
        return false;
    }
    return true;
}

export function settingsBackHref(input: {
    from?: string;
    referer?: string;
    origin: string;
}): string {
    const from = input.from?.trim();
    if (from && isSafeAppBackPath(from)) return from;
    if (input.referer) {
        try {
            const url = new URL(input.referer);
            if (url.origin === input.origin) {
                const candidate = url.pathname + url.search;
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
