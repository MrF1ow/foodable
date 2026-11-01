import { describe, expect, test } from "bun:test";
import { signExportToken, verifyExportToken } from "./export-link.js";

const SECRET = "x".repeat(32);
const USER = "11111111-1111-4111-8111-111111111111";

describe("export download tokens", () => {
    test("valid token verifies to user id", () => {
        const exp = Date.now() + 60_000;
        const token = signExportToken(USER, exp, SECRET);
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
        parts[2] = String(exp + 3_600_000);
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
});
