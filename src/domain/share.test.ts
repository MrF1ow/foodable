import { describe, expect, test } from "bun:test";
import {
    isSafeShareReturnPath,
    readShare,
    SHARE_RETURN_PATH_MAX,
} from "./share.js";

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
    test("allows /share and /share/probe with query", () => {
        expect(isSafeShareReturnPath("/share?text=hello&url=")).toBe(
            "/share?text=hello&url=",
        );
        expect(isSafeShareReturnPath("/share?text=hi")).toBe("/share?text=hi");
        expect(isSafeShareReturnPath("/share/probe?text=hi")).toBe(
            "/share/probe?text=hi",
        );
    });

    test("refuses traversal, external, and lookalike paths", () => {
        expect(isSafeShareReturnPath("/share/../logout")).toBeNull();
        expect(isSafeShareReturnPath("/share/%2e%2e/logout")).toBeNull();
        expect(isSafeShareReturnPath("/share/./probe")).toBeNull();
        expect(isSafeShareReturnPath("//evil.com")).toBeNull();
        expect(isSafeShareReturnPath("/\\evil.com")).toBeNull();
        expect(isSafeShareReturnPath("https://evil.com")).toBeNull();
        expect(isSafeShareReturnPath("/share@evil.com")).toBeNull();
        expect(isSafeShareReturnPath("%2F%2Fevil.com")).toBeNull();
        expect(isSafeShareReturnPath("/sharex")).toBeNull();
        expect(isSafeShareReturnPath("/recipes")).toBeNull();
        expect(isSafeShareReturnPath("https://evil.com/share")).toBeNull();
        expect(isSafeShareReturnPath("//evil.com/share")).toBeNull();
    });

    test("refuses control characters and CRLF smuggling", () => {
        expect(
            isSafeShareReturnPath("/share?text=hi%0d%0aLocation:%20/evil"),
        ).toBeNull();
        expect(isSafeShareReturnPath("/share\r\n")).toBeNull();
        expect(isSafeShareReturnPath("/share?next=%0a%0d")).toBeNull();
    });

    test("accepts long /share queries within the return cap", () => {
        const text = "z".repeat(2100);
        const path = `/share?text=${encodeURIComponent(text)}`;
        expect(path.length).toBeGreaterThan(2048);
        expect(path.length).toBeLessThanOrEqual(SHARE_RETURN_PATH_MAX);
        const normalized = isSafeShareReturnPath(path);
        expect(normalized).not.toBeNull();
        const u = new URL(normalized!, "https://x.test");
        expect(u.searchParams.get("text")).toBe(text);
    });
});
