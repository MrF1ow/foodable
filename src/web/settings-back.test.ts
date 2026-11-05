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
