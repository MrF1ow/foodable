import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "e1";
const EXPORT_KEY_INFO = "foodable export link v1";

/** Purpose-specific signing key — never the raw session secret. */
export function deriveExportSigningKey(sessionSecret: string): string {
    return createHmac("sha256", sessionSecret)
        .update(EXPORT_KEY_INFO)
        .digest("hex");
}

function signPayload(payload: string, sessionSecret: string): string {
    return createHmac("sha256", deriveExportSigningKey(sessionSecret))
        .update(payload)
        .digest("hex");
}

/** Mint a URL path segment valid until expiresAtMs (epoch ms). */
export function signExportToken(
    userId: string,
    expiresAtMs: number,
    sessionSecret: string,
): string {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        throw new Error("invalid user id");
    }
    if (!Number.isFinite(expiresAtMs)) {
        throw new Error("invalid expiry");
    }
    const exp = Math.floor(expiresAtMs / 1000);
    const payload = `${TOKEN_VERSION}.${userId}.${exp}`;
    return `${payload}.${signPayload(payload, sessionSecret)}`;
}

/** Returns the user id when the token is valid; otherwise null. */
export function verifyExportToken(
    token: string,
    nowMs: number,
    sessionSecret: string,
): string | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 4) return null;
    const [version, userId, expRaw, mac] = parts;
    if (version !== TOKEN_VERSION || !userId || !expRaw || !mac) return null;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
    const payload = `${TOKEN_VERSION}.${userId}.${exp}`;
    const expected = signPayload(payload, sessionSecret);
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return userId;
}
