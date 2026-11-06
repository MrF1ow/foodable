import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { FetchFailure, SafeFetcher } from "../fetch-safe.js";
import {
    facebookGraphOembedUrl,
    facebookOembedEndpoint,
    parseFacebookOembed,
    parseTikTokPage,
    readFacebook,
    readTikTok,
    readerFailureFromFetch,
    webVttToText,
} from "./social-readers.js";

const FIX = join(import.meta.dir, "fixtures/social");
function load(name: string): string {
    return readFileSync(join(FIX, name), "utf8");
}

test("readerFailureFromFetch maps fetch failures", () => {
    expect(readerFailureFromFetch("site_refused")).toBe("blocked");
    expect(readerFailureFromFetch("timeout")).toBe("timeout");
    expect(readerFailureFromFetch("not_found")).toBe("not_found");
    expect(readerFailureFromFetch("robots_disallowed")).toBe(
        "robots_disallowed",
    );
    expect(readerFailureFromFetch("network_error")).toBe("network");
});

test("webVttToText strips cues and dedupes", () => {
    const text = webVttToText(load("tiktok.vtt"));
    expect(text).toContain("Hello welcome");
    expect(text).toContain("garlic");
    expect(text.split("Hello welcome").length).toBe(2);
});

test("parseTikTokPage reads caption and subtitle url", () => {
    const parsed = parseTikTokPage(load("tiktok-video.html"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.text).toContain("Garlic butter pasta");
    expect(parsed.subtitleUrl).toBe("https://subtitle.example/tiktok.vtt");
});

test("parseTikTokPage without subtitles", () => {
    const parsed = parseTikTokPage(load("tiktok-no-subtitles.html"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.subtitleUrl).toBeNull();
});

test("parseTikTokPage format_changed without script", () => {
    expect(parseTikTokPage(load("tiktok-changed.html"))).toEqual({
        ok: false,
        reason: "format_changed",
    });
});

test("parseFacebookOembed fixtures", () => {
    const video = parseFacebookOembed(load("facebook-video.json"));
    expect(video.ok).toBe(true);
    if (video.ok) {
        expect(video.text).toContain("Garlic Pasta");
        expect(video.text).toContain("2 cups pasta");
        expect(video.text).not.toMatch(/Posted by/i);
    }
    const post = parseFacebookOembed(load("facebook-post.json"));
    expect(post.ok).toBe(true);
    expect(parseFacebookOembed(load("facebook-no-blockquote.json"))).toEqual({
        ok: false,
        reason: "format_changed",
    });
    expect(parseFacebookOembed(load("facebook-empty.json"))).toEqual({
        ok: false,
        reason: "empty",
    });
});

describe("facebookOembedEndpoint", () => {
    test.each([
        ["https://www.facebook.com/watch/?v=1", "oembed_video"],
        ["https://www.facebook.com/reel/1", "oembed_video"],
        ["https://www.facebook.com/share/v/1/", "oembed_video"],
        ["https://fb.watch/abc/", "oembed_video"],
        ["https://www.facebook.com/user/posts/1", "oembed_post"],
        ["https://www.facebook.com/permalink.php?story_fbid=1", "oembed_post"],
        ["https://www.facebook.com/share/p/1/", "oembed_post"],
    ] as const)("maps %s", (url, endpoint) => {
        const result = facebookOembedEndpoint(url);
        expect(result).toEqual({ ok: true, endpoint });
    });

    test("groups and unknown paths are unsupported", () => {
        expect(
            facebookOembedEndpoint("https://www.facebook.com/groups/x/posts/1"),
        ).toEqual({
            ok: false,
            reason: "unsupported_link",
        });
    });
});

function trackingFetcher(
    impl: (
        url: string,
    ) =>
        | { ok: true; body: string; contentType?: string }
        | { ok: false; reason: FetchFailure },
): SafeFetcher & { urls: string[] } {
    const urls: string[] = [];
    return {
        urls,
        async robotsAllows() {
            return true;
        },
        async fetchPage(url, opts) {
            urls.push(typeof url === "string" ? url : url.href);
            const href = typeof url === "string" ? url : url.href;
            if (href.includes("graph.facebook.com")) {
                expect(opts?.checkRobots).toBe(false);
                expect(href).not.toContain("access_token");
                expect(href).not.toContain("app_id");
            } else {
                expect(opts?.checkRobots).not.toBe(false);
            }
            const result = impl(href);
            if (result.ok) {
                return {
                    ok: true,
                    url: href,
                    status: 200,
                    contentType: result.contentType ?? "text/html",
                    body: result.body,
                };
            }
            return {
                ok: false,
                reason: result.reason,
                status: 403,
                detail: result.reason,
            };
        },
    } as SafeFetcher & { urls: string[] };
}

test("readTikTok fetches page and subtitle with robots on", async () => {
    const fetcher = trackingFetcher((url) => {
        if (url.includes("tiktok.vtt"))
            return {
                ok: true,
                body: load("tiktok.vtt"),
                contentType: "text/vtt",
            };
        return { ok: true, body: load("tiktok-video.html") };
    });
    const result = await readTikTok(
        fetcher,
        "https://www.tiktok.com/@x/video/1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
        expect(result.text).toContain("Garlic butter pasta");
        expect(result.transcript).toContain("garlic");
    }
    expect(fetcher.urls.length).toBeLessThanOrEqual(2);
});

test("readTikTok subtitle failure keeps caption", async () => {
    const fetcher = trackingFetcher((url) => {
        if (url.includes("subtitle.example")) {
            return { ok: false, reason: "network_error" };
        }
        return { ok: true, body: load("tiktok-video.html") };
    });
    const result = await readTikTok(
        fetcher,
        "https://www.tiktok.com/@x/video/1",
    );
    expect(result).toEqual({
        ok: true,
        text: expect.stringContaining("Garlic butter pasta"),
        transcript: null,
    });
});

test("readTikTok 403 is blocked with one page request", async () => {
    const fetcher = trackingFetcher(() => ({
        ok: false,
        reason: "site_refused",
    }));
    const result = await readTikTok(
        fetcher,
        "https://www.tiktok.com/@x/video/1",
    );
    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(fetcher.urls.length).toBe(1);
});

test("readFacebook uses tokenless graph url", async () => {
    const fetcher = trackingFetcher(() => ({
        ok: true,
        body: load("facebook-video.json"),
        contentType: "application/json",
    }));
    const result = await readFacebook(
        fetcher,
        "https://www.facebook.com/watch/?v=1",
    );
    expect(result.ok).toBe(true);
    expect(fetcher.urls[0]).toBe(
        facebookGraphOembedUrl(
            "oembed_video",
            "https://www.facebook.com/watch/?v=1",
        ),
    );
});
