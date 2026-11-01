import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";

function signPayload(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Mint a URL path segment valid until expiresAtMs (epoch ms). */
export function signExportToken(
    userId: string,
    expiresAtMs: number,
    secret: string,
): string {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        throw new Error("invalid user id");
    }
    if (!Number.isFinite(expiresAtMs)) {
        throw new Error("invalid expiry");
    }
    const exp = Math.floor(expiresAtMs);
    const payload = `${TOKEN_VERSION}.${userId}.${exp}`;
    return `${payload}.${signPayload(payload, secret)}`;
}

/** Returns the user id when the token is valid; otherwise null. */
export function verifyExportToken(
    token: string,
    nowMs: number,
    secret: string,
): string | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 4) return null;
    const [version, userId, expRaw, mac] = parts;
    if (version !== TOKEN_VERSION || !userId || !expRaw || !mac) return null;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp <= nowMs) return null;
    const payload = `${TOKEN_VERSION}.${userId}.${exp}`;
    const expected = signPayload(payload, secret);
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return userId;
}
