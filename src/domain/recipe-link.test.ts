import { describe, expect, test } from "bun:test";
import type { RecipeSourceKind } from "./recipe-import.js";
import {
    cleanRecipeLink,
    hostOnPasteOnlyList,
    recipeLinkKey,
    recipeSource,
    validateRecipeLink,
} from "./recipe-link.js";

describe("validateRecipeLink", () => {
    test("upgrades http to https and adds https to bare hosts", () => {
        const http = validateRecipeLink("http://example.com/path");
        expect(http.ok).toBe(true);
        if (http.ok) {
            expect(http.url.protocol).toBe("https:");
        }
        const bare = validateRecipeLink("example.com/recipe");
        expect(bare.ok).toBe(true);
        if (bare.ok) expect(bare.url.href).toBe("https://example.com/recipe");
    });

    test("rejects non-https schemes", () => {
        for (const raw of [
            "javascript:alert(1)",
            "ftp://example.com/x",
            "data:text/plain,hi",
        ]) {
            expect(validateRecipeLink(raw)).toEqual({
                ok: false,
                reason: "invalid_link",
            });
        }
    });

    test("rejects private and loopback hosts", () => {
        for (const raw of [
            "https://127.0.0.1/",
            "https://10.0.0.5/x",
            "https://192.168.1.1/",
            "https://169.254.169.254/",
            "https://100.64.0.1/",
            "https://[::1]/",
            "https://[fd00::1]/",
            "https://[::ffff:10.0.0.1]/",
            "https://[::7f00:1]/",
            "https://localhost/recipe",
            "https://app.local/x",
            "https://svc.internal/y",
            "https://home.home.arpa/z",
        ]) {
            expect(validateRecipeLink(raw)).toEqual({
                ok: false,
                reason: "invalid_link",
            });
        }
    });

    test("allows public IPv6 literal hosts", () => {
        const ok = validateRecipeLink("https://[2606:4700::1]/recipe");
        expect(ok.ok).toBe(true);
    });
});

describe("cleanRecipeLink", () => {
    test("strips tracking params, keeps canonical ids, sorts, drops fragment", () => {
        const validated = validateRecipeLink(
            "https://WWW.Example.com/recipe/?utm_source=x&b=2&a=1&fbclid=1&v=abc&list=xyz&id=9#section",
        );
        expect(validated.ok).toBe(true);
        if (!validated.ok) return;
        const cleaned = cleanRecipeLink(validated.url);
        expect(cleaned).toBe(
            "https://www.example.com/recipe?a=1&b=2&id=9&list=xyz&v=abc",
        );
    });

    test("removes trailing slash on non-root paths", () => {
        const validated = validateRecipeLink("https://example.com/foo/bar/");
        expect(validated.ok).toBe(true);
        if (!validated.ok) return;
        expect(cleanRecipeLink(validated.url)).toBe(
            "https://example.com/foo/bar",
        );
    });
});

describe("recipeSource", () => {
    const cases: Array<{
        url: string;
        kind: RecipeSourceKind;
        label: string;
        shortLink: boolean;
    }> = [
        {
            url: "https://www.instagram.com/p/x",
            kind: "instagram",
            label: "Instagram",
            shortLink: false,
        },
        {
            url: "https://instagr.am/p/x",
            kind: "instagram",
            label: "Instagram",
            shortLink: false,
        },
        {
            url: "https://facebook.com/x",
            kind: "facebook",
            label: "Facebook",
            shortLink: false,
        },
        {
            url: "https://m.facebook.com/x",
            kind: "facebook",
            label: "Facebook",
            shortLink: false,
        },
        {
            url: "https://fb.watch/abc",
            kind: "facebook",
            label: "Facebook",
            shortLink: true,
        },
        {
            url: "https://threads.net/@x",
            kind: "threads",
            label: "Threads",
            shortLink: false,
        },
        {
            url: "https://tiktok.com/@x",
            kind: "tiktok",
            label: "TikTok",
            shortLink: false,
        },
        {
            url: "https://vm.tiktok.com/abc",
            kind: "tiktok",
            label: "TikTok",
            shortLink: true,
        },
        {
            url: "https://pinterest.co.uk/pin/1",
            kind: "pinterest",
            label: "Pinterest",
            shortLink: false,
        },
        {
            url: "https://www.pinterest.com.au/pin/1",
            kind: "pinterest",
            label: "Pinterest",
            shortLink: false,
        },
        {
            url: "https://pinterest.com.mx/pin/1",
            kind: "pinterest",
            label: "Pinterest",
            shortLink: false,
        },
        {
            url: "https://pin.it/abc",
            kind: "pinterest",
            label: "Pinterest",
            shortLink: true,
        },
        {
            url: "https://youtu.be/abc",
            kind: "youtube",
            label: "YouTube",
            shortLink: true,
        },
        {
            url: "https://youtube.com.br/watch?v=1",
            kind: "youtube",
            label: "YouTube",
            shortLink: false,
        },
        {
            url: "https://youtube.co.uk/watch?v=1",
            kind: "youtube",
            label: "YouTube",
            shortLink: false,
        },
        {
            url: "https://fb.me/abc",
            kind: "facebook",
            label: "Facebook",
            shortLink: true,
        },
        {
            url: "https://natashaskitchen.com/recipe",
            kind: "website",
            label: "natashaskitchen.com",
            shortLink: false,
        },
    ];

    for (const row of cases) {
        test(row.url, () => {
            const url = new URL(row.url);
            const info = recipeSource(url);
            expect(info.kind).toBe(row.kind);
            expect(info.label).toBe(row.label);
            expect(info.shortLink).toBe(row.shortLink);
        });
    }
});

describe("paste-only blocklist matcher", () => {
    test("matches exact host and subdomains only", () => {
        const list = ["example.com"];
        expect(hostOnPasteOnlyList("example.com", list)).toBe(true);
        expect(hostOnPasteOnlyList("recipes.example.com", list)).toBe(true);
        expect(hostOnPasteOnlyList("notexample.com", list)).toBe(false);
    });
});

describe("recipeLinkKey", () => {
    test("returns cleaned https key", () => {
        expect(recipeLinkKey("http://Example.com/a?utm_source=1")).toBe(
            "https://example.com/a",
        );
    });
});
