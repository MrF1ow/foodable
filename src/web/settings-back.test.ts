import { describe, expect, test } from "bun:test";
import { isSafeAppBackPath, settingsBackHref } from "./settings-back.js";

describe("isSafeAppBackPath", () => {
    test("allows normal app paths", () => {
        expect(isSafeAppBackPath("/fridge")).toBe(true);
        expect(isSafeAppBackPath("/household?x=1")).toBe(true);
    });

    test("refuses unsafe paths", () => {
        expect(isSafeAppBackPath("//evil.example")).toBe(false);
        expect(isSafeAppBackPath("https://evil.example/x")).toBe(false);
        expect(isSafeAppBackPath("/settings")).toBe(false);
        expect(isSafeAppBackPath("/settings/help")).toBe(false);
        expect(isSafeAppBackPath("/logout")).toBe(false);
        expect(isSafeAppBackPath("/exports/token")).toBe(false);
        expect(isSafeAppBackPath("/" + "a".repeat(512))).toBe(false);
        expect(isSafeAppBackPath("/fridge/../logout")).toBe(false);
        expect(isSafeAppBackPath("/./logout")).toBe(false);
        expect(isSafeAppBackPath("/%2e%2e/logout")).toBe(false);
    });

    test("refuses blocked paths hidden behind percent-encoding", () => {
        expect(isSafeAppBackPath("/%6c%6f%67%6f%75%74")).toBe(false);
        expect(isSafeAppBackPath("/%6cogin")).toBe(false);
        expect(isSafeAppBackPath("/%73ettings/help")).toBe(false);
        expect(isSafeAppBackPath("/%65xports/tok")).toBe(false);
        expect(isSafeAppBackPath("/%252e%252e/logout")).toBe(false);
        expect(isSafeAppBackPath("/%256c%256f%2567%256f%2575%2574")).toBe(
            false,
        );
        expect(isSafeAppBackPath("/%2f%2fevil.example")).toBe(false);
        expect(isSafeAppBackPath("/%5cevil")).toBe(false);
        expect(isSafeAppBackPath("/%zz")).toBe(false);
    });

    test("keeps encoded and query-string app paths", () => {
        for (const ok of [
            "/fridge?q=1",
            "/recipes/r1?id=1",
            "/grocery?store=abc&q=milk%26eggs",
            "/household/usual-products/abc?from=%2Fgrocery",
            "/household/usual-products/my%20food",
            "/household/usual-products/50%25off",
        ]) {
            expect(isSafeAppBackPath(ok)).toBe(true);
        }
    });
});

describe("settingsBackHref", () => {
    const origin = "http://x";

    test("from wins over referer", () => {
        expect(
            settingsBackHref({
                from: "/fridge",
                referer: `${origin}/grocery`,
                origin,
            }),
        ).toBe("/fridge");
    });

    test("same-origin referer is used", () => {
        expect(
            settingsBackHref({
                referer: `${origin}/recipes?id=1`,
                origin,
            }),
        ).toBe("/recipes?id=1");
    });

    test("other-origin referer is ignored", () => {
        expect(
            settingsBackHref({
                referer: "https://evil.example/fridge",
                origin,
            }),
        ).toBe("/");
    });

    test("unsafe from falls back", () => {
        expect(
            settingsBackHref({
                from: "//evil.example",
                referer: `${origin}/fridge`,
                origin,
            }),
        ).toBe("/fridge");
        expect(
            settingsBackHref({
                from: "/settings/help",
                origin,
            }),
        ).toBe("/");
        expect(settingsBackHref({ from: "/\\evil", origin })).toBe("/");
        expect(settingsBackHref({ from: "/login", origin })).toBe("/");
        expect(settingsBackHref({ from: "/authorize", origin })).toBe("/");
        expect(settingsBackHref({ from: "/approve", origin })).toBe("/");
    });

    test("default is home", () => {
        expect(settingsBackHref({ origin })).toBe("/");
    });
});
