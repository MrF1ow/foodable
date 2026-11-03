import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { signExportToken, verifyExportToken } from "./export-link.js";
import { mintSiteSession, readSiteSession } from "../site-session.js";

const SECRET = "x".repeat(32);
const USER = "11111111-1111-4111-8111-111111111111";

// Site sessions read SESSION_SECRET from the environment. The cross-checks
// sign export tokens with SECRET, so they run with the session on that same
// secret: a regression to "one key, one shape" then fails here.
function withSessionSecret(fn: () => void): void {
    const prev = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = SECRET;
    try {
        fn();
    } finally {
        if (prev === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = prev;
    }
}

function e1RawSecretToken(
    userId: string,
    expiresAtMs: number,
    secret: string,
): string {
    const exp = Math.floor(expiresAtMs / 1000);
    const payload = `e1.${userId}.${exp}`;
    const mac = createHmac("sha256", secret).update(payload).digest("hex");
    return `${payload}.${mac}`;
}

function legacyV1RawSecretToken(
    userId: string,
    expiresAtMs: number,
    secret: string,
): string {
    const exp = Math.floor(expiresAtMs);
    const payload = `v1.${userId}.${exp}`;
    const mac = createHmac("sha256", secret).update(payload).digest("hex");
    return `${payload}.${mac}`;
}

describe("export download tokens", () => {
    test("valid token verifies to user id", () => {
        const exp = Date.now() + 60_000;
        const token = signExportToken(USER, exp, SECRET);
        expect(token.startsWith("e1.")).toBe(true);
        expect(verifyExportToken(token, Date.now(), SECRET)).toBe(USER);
    });

    test("expired token is rejected", () => {
        const exp = Date.now() - 1;
        const token = signExportToken(USER, exp, SECRET);
        expect(verifyExportToken(token, Date.now(), SECRET)).toBeNull();
    });

    test("tampered user id is rejected", () => {
        const exp = Date.now() + 60_000;
        const token = signExportToken(USER, exp, SECRET);
        const parts = token.split(".");
        parts[1] = "22222222-2222-4222-8222-222222222222";
        expect(
            verifyExportToken(parts.join("."), Date.now(), SECRET),
        ).toBeNull();
    });

    test("tampered expiry is rejected", () => {
        const exp = Date.now() + 60_000;
        const token = signExportToken(USER, exp, SECRET);
        const parts = token.split(".");
        parts[2] = String(Number(parts[2]) + 3600);
        expect(
            verifyExportToken(parts.join("."), Date.now(), SECRET),
        ).toBeNull();
    });

    test("wrong secret is rejected", () => {
        const exp = Date.now() + 60_000;
        const token = signExportToken(USER, exp, SECRET);
        expect(verifyExportToken(token, Date.now(), "y".repeat(32))).toBeNull();
    });

    test("truncated token is rejected", () => {
        const exp = Date.now() + 60_000;
        const token = signExportToken(USER, exp, SECRET);
        expect(
            verifyExportToken(
                token.slice(0, token.length - 4),
                Date.now(),
                SECRET,
            ),
        ).toBeNull();
    });

    test("garbage input is rejected", () => {
        expect(verifyExportToken("not-a-token", Date.now(), SECRET)).toBeNull();
        expect(verifyExportToken("", Date.now(), SECRET)).toBeNull();
    });

    test("export tokens are never accepted as site sessions", () => {
        withSessionSecret(() => {
            const fresh = signExportToken(USER, Date.now() + 60_000, SECRET);
            const expired = signExportToken(USER, Date.now() - 1, SECRET);
            expect(readSiteSession(fresh)).toBeNull();
            expect(readSiteSession(expired)).toBeNull();
        });
    });

    test("site session tokens are never accepted as export tokens", () => {
        withSessionSecret(() => {
            const session = mintSiteSession(USER);
            expect(readSiteSession(session)).toBe(USER);
            expect(verifyExportToken(session, Date.now(), SECRET)).toBeNull();
        });
    });

    test("e1 tokens signed with the raw session secret are rejected", () => {
        const raw = e1RawSecretToken(USER, Date.now() + 60_000, SECRET);
        expect(verifyExportToken(raw, Date.now(), SECRET)).toBeNull();
    });

    test("legacy v1 tokens signed with the raw session secret are rejected", () => {
        const legacy = legacyV1RawSecretToken(
            USER,
            Date.now() + 60_000,
            SECRET,
        );
        expect(verifyExportToken(legacy, Date.now(), SECRET)).toBeNull();
    });
});
