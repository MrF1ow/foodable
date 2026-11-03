import { createHmac, timingSafeEqual } from "node:crypto";

export const SITE_COOKIE = "nm_site";
const TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_SESSION_SECRET_LEN = 32;

let sessionSecretFallbackWarned = false;

/** Test-only: reset the one-time fallback warning flag. */
export function resetSessionSecretWarningForTest(): void {
    sessionSecretFallbackWarned = false;
}

/** Session HMAC secret; export download links derive a separate key from this. */
export function resolveSessionSigningSecret(): string {
    const session = process.env.SESSION_SECRET;
    if (session) {
        if (session.length < MIN_SESSION_SECRET_LEN) {
            throw new Error(
                `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LEN} characters`,
            );
        }
        return session;
    }
    const oauth = process.env.OAUTH_CLIENT_SECRET;
    if (!oauth) {
        throw new Error("OAUTH_CLIENT_SECRET is required for site sessions");
    }
    if (!sessionSecretFallbackWarned) {
        sessionSecretFallbackWarned = true;
        console.warn(
            "[config] SESSION_SECRET is unset; signing site sessions with OAUTH_CLIENT_SECRET",
        );
    }
    return oauth;
}

function sign(payload: string): string {
    return createHmac("sha256", resolveSessionSigningSecret())
        .update(payload)
        .digest("hex");
}

export function mintSiteSession(userId: string, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + TTL_SECONDS;
    const payload = `v1.${userId}.${exp}`;
    return `${payload}.${sign(payload)}`;
}

export function readSiteSession(
    cookie: string | undefined,
    now = Date.now(),
): string | null {
    if (!cookie) return null;
    const parts = cookie.split(".");
    if (parts.length !== 4) return null;
    const [version, userId, expRaw, mac] = parts;
    if (version !== "v1" || !userId || !expRaw || !mac) return null;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
    const payload = `v1.${userId}.${exp}`;
    const expected = sign(payload);
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return userId;
}

export function siteCookieHeader(value: string, secure: boolean): string {
    const parts = [
        `${SITE_COOKIE}=${value}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${TTL_SECONDS}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

export function clearSiteCookieHeader(secure: boolean): string {
    const parts = [
        `${SITE_COOKIE}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}
