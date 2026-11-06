import { describe, expect, test } from "bun:test";
import { isSafeShareReturnPath, readShare } from "./share.js";

describe("readShare", () => {
    test("url field only", () => {
        const out = readShare({
            url: "https://www.natashaskitchen.com/test-recipe/",
        });
        expect(out.link).toBe("https://www.natashaskitchen.com/test-recipe");
        expect(out.detectedFrom).toBe("url");
        expect(out.text).toBeNull();
    });

    test("Android shape: empty url, link in text", () => {
        const out = readShare({
            text: "https://vm.tiktok.com/ZM123/",
        });
        expect(out.link).toBe("https://vm.tiktok.com/ZM123");
        expect(out.detectedFrom).toBe("text");
        expect(out.text).toBeNull();
    });

    test("caption prefix with link keeps full text", () => {
        const out = readShare({
            text: "Check this out https://vm.tiktok.com/ZM123/",
        });
        expect(out.link).toBe("https://vm.tiktok.com/ZM123");
        expect(out.text).toBe("Check this out https://vm.tiktok.com/ZM123/");
    });

    test("caption with link at the end", () => {
        const caption =
            "Garlic noodles\n\n1 lb pasta\n\nSee https://example.com/r/1";
        const out = readShare({ text: caption });
        expect(out.link).toBe("https://example.com/r/1");
        expect(out.text).toBe(caption);
    });

    test("title-only link", () => {
        const out = readShare({
            title: "Recipe https://example.com/r/2",
        });
        expect(out.link).toBe("https://example.com/r/2");
        expect(out.detectedFrom).toBe("title");
    });

    test("garbage url field with link in text", () => {
        const out = readShare({
            url: "not-a-url",
            text: "https://www.instagram.com/p/abc/",
        });
        expect(out.link).toBe("https://www.instagram.com/p/abc");
        expect(out.detectedFrom).toBe("text");
    });

    test("no link", () => {
        const out = readShare({
            title: "Check out this video on TikTok",
            text: "Just a caption with no URL",
        });
        expect(out.link).toBeNull();
        expect(out.text).toBe("Just a caption with no URL");
    });

    test("short title is not used as recipe text", () => {
        const out = readShare({
            title: "Check out this video on TikTok",
        });
        expect(out.text).toBeNull();
    });

    test("long title becomes text when text empty", () => {
        const longTitle = `${"A".repeat(81)} ingredients: 1 cup flour`;
        const out = readShare({ title: longTitle });
        expect(out.text).toBe(longTitle);
    });

    test("total field cap", () => {
        const chunk = "x".repeat(10_000);
        const out = readShare({
            title: chunk,
            text: chunk,
            url: chunk,
        });
        const total =
            out.raw.title.length + out.raw.text.length + out.raw.url.length;
        expect(total).toBeLessThanOrEqual(20_000);
    });

    test("whitespace trimming", () => {
        const out = readShare({
            url: "  https://example.com/r/3  ",
            text: "  hello  ",
        });
        expect(out.link).toBe("https://example.com/r/3");
        expect(out.text).toBe("hello");
    });
});

describe("isSafeShareReturnPath", () => {
    test("allows /share with query", () => {
        expect(isSafeShareReturnPath("/share?text=hello&url=")).toBe(true);
    });

    test("refuses external and protocol-relative paths", () => {
        expect(isSafeShareReturnPath("https://evil.com/share")).toBe(false);
        expect(isSafeShareReturnPath("//evil.com/share")).toBe(false);
        expect(isSafeShareReturnPath("/recipes")).toBe(false);
    });
});
