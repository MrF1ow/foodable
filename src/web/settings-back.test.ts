import { describe, expect, test } from "bun:test";
import { isSafeAppBackPath, settingsBackHref } from "./settings-back.js";

describe("isSafeAppBackPath", () => {
    test("allows normal app paths", () => {
        expect(isSafeAppBackPath("/kitchen/fridge")).toBe(true);
        expect(isSafeAppBackPath("/settings/household?x=1")).toBe(true);
    });

    test("refuses unsafe paths", () => {
        expect(isSafeAppBackPath("//evil.example")).toBe(false);
        expect(isSafeAppBackPath("https://evil.example/x")).toBe(false);
        expect(isSafeAppBackPath("/settings")).toBe(false);
        expect(isSafeAppBackPath("/settings/help")).toBe(false);
        expect(isSafeAppBackPath("/logout")).toBe(false);
        expect(isSafeAppBackPath("/exports/token")).toBe(false);
        expect(isSafeAppBackPath("/" + "a".repeat(512))).toBe(false);
        expect(isSafeAppBackPath("/kitchen/fridge/../logout")).toBe(false);
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
            "/kitchen/fridge?q=1",
            "/recipes/r1?id=1",
            "/kitchen/groceries?store=abc&q=milk%26eggs",
            "/kitchen/usuals/abc?from=%2Fkitchen%2Fgroceries",
            "/kitchen/usuals/my%20food",
            "/kitchen/usuals/50%25off",
        ]) {
            expect(isSafeAppBackPath(ok)).toBe(true);
        }
    });

    test("allows settings household app paths only", () => {
        expect(isSafeAppBackPath("/settings/household")).toBe(true);
        expect(isSafeAppBackPath("/settings/household/items")).toBe(true);
        expect(isSafeAppBackPath("/settings/household/members/u1/role")).toBe(
            true,
        );
        expect(isSafeAppBackPath("/settings/household-settings")).toBe(false);
        expect(isSafeAppBackPath("/settings/householdx")).toBe(false);
        expect(isSafeAppBackPath("/settings/household/../help")).toBe(false);
        expect(isSafeAppBackPath("/%73ettings/help")).toBe(false);
        expect(isSafeAppBackPath("/settings/%68ousehold")).toBe(false);
    });
});

describe("isSafeAppBackPath refuses files and machine endpoints", () => {
    // A service worker's own fetch can carry its script URL as the referrer
    // (seen on iOS Safari: the product page's back link went to /sw.js).
    test("static files are not pages", () => {
        for (const bad of [
            "/sw.js",
            "/app.js?v=abc",
            "/app-v2.css",
            "/app-v2-scanner.wasm",
            "/manifest.webmanifest",
            "/favicon.ico",
            "/apple-touch-icon.png",
            "/brand/icon-dark.svg",
            "/fonts/Geist.woff2",
            "/robots.txt",
            "/%73w.js",
        ]) {
            expect(isSafeAppBackPath(bad), bad).toBe(false);
        }
    });

    test("machine endpoints and public share pages are not back targets", () => {
        for (const bad of [
            "/api/log/search?q=x",
            "/mcp",
            "/s/abc",
            "/s/abc.json",
            "/token",
            "/register",
            "/.well-known/oauth-authorization-server",
        ]) {
            expect(isSafeAppBackPath(bad), bad).toBe(false);
        }
    });

    test("names with a dot in an app path still count", () => {
        expect(isSafeAppBackPath("/kitchen/usuals/Dr.%20Pepper")).toBe(true);
        expect(isSafeAppBackPath("/recipes?q=st.%20louis")).toBe(true);
    });
});

describe("settingsBackHref", () => {
    const origin = "http://x";

    test("from wins over referer", () => {
        expect(
            settingsBackHref({
                from: "/kitchen/fridge",
                referer: `${origin}/kitchen/groceries`,
                origin,
            }),
        ).toBe("/kitchen/fridge");
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
                referer: "https://evil.example/kitchen/fridge",
                origin,
            }),
        ).toBe("/");
    });

    test("unsafe from falls back", () => {
        expect(
            settingsBackHref({
                from: "//evil.example",
                referer: `${origin}/kitchen/fridge`,
                origin,
            }),
        ).toBe("/kitchen/fridge");
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

    test("a service-worker referer falls back to home", () => {
        expect(
            settingsBackHref({
                referer: "https://food.example/sw.js",
                origin: "https://food.example",
            }),
        ).toBe("/");
    });

    test("default is home", () => {
        expect(settingsBackHref({ origin })).toBe("/");
    });

    test("canonicalizes legacy from paths", () => {
        expect(settingsBackHref({ from: "/fridge", origin })).toBe(
            "/kitchen/fridge",
        );
        expect(
            settingsBackHref({
                from: "/household/items",
                origin,
            }),
        ).toBe("/settings/household/items");
    });
});
