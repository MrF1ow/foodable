import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    createSafeFetcher,
    type FetchFailure,
    type SafeFetcher,
} from "../fetch-safe.js";
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

/** Host check for fake fetchers: the exact host or a subdomain of it. */
function onHost(href: string, domain: string): boolean {
    const host = new URL(href).hostname;
    return host === domain || host.endsWith(`.${domain}`);
}

const FIX = join(import.meta.dir, "fixtures/social");
const SOCIAL_FIXTURES = new Map<string, string>();
for await (const file of new Bun.Glob("*").scan(FIX)) {
    SOCIAL_FIXTURES.set(file, await Bun.file(join(FIX, file)).text());
}
function load(name: string): string {
    const text = SOCIAL_FIXTURES.get(name);
    if (text == null) throw new Error(`Missing fixture ${name}`);
    return text;
}

test("readerFailureFromFetch maps fetch failures", () => {
    expect(readerFailureFromFetch("site_refused")).toBe("blocked");
    expect(readerFailureFromFetch("timeout")).toBe("timeout");
    expect(readerFailureFromFetch("not_found")).toBe("not_found");
    expect(readerFailureFromFetch("robots_disallowed")).toBe(
        "robots_disallowed",
    );
    expect(readerFailureFromFetch("host_not_allowed")).toBe("blocked");
    expect(readerFailureFromFetch("too_large")).toBe("format_changed");
    expect(readerFailureFromFetch("bad_content_type")).toBe("format_changed");
    expect(readerFailureFromFetch("too_many_redirects")).toBe("format_changed");
    expect(readerFailureFromFetch("network_error")).toBe("network");
});

test("webVttToText strips cues and dedupes", () => {
    const text = webVttToText(load("tiktok.vtt"));
    expect(text).toContain("Hello welcome");
    expect(text).toContain("garlic");
    expect(text.split("Hello welcome").length).toBe(2);
});

test("webVttToText keeps cue text that starts like NOTE or STYLE", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
Note the garlic

00:00:01.000 --> 00:00:02.000
Style the pasta
`;
    const text = webVttToText(vtt);
    expect(text).toContain("Note the garlic");
    expect(text).toContain("Style the pasta");
});

test("webVttToText treats numeric cue ids only before timing lines", () => {
    const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:01.000
350

00:00:01.000 --> 00:00:02.000
done
`;
    expect(webVttToText(vtt)).toContain("350");
});

test("webVttToText skips header NOTE STYLE REGION and X-TIMESTAMP-MAP", () => {
    const vtt = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:0000000000000000000

NOTE
This is metadata

STYLE
::cue { color: white; }

REGION id=fred
10%,90% 45%,55%

00:00:00.000 --> 00:00:01.000
visible
`;
    const text = webVttToText(vtt);
    expect(text).toBe("visible");
    expect(text).not.toMatch(/MPEGTS|metadata|::cue|REGION/);
});

test("webVttToText decodes HTML entities in cues", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
Salt &amp; pepper
`;
    expect(webVttToText(vtt)).toBe("Salt & pepper");
});

test("parseTikTokPage reads caption and subtitle url", () => {
    const parsed = parseTikTokPage(load("tiktok-video.html"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.text).toContain("Garlic butter pasta");
    expect(parsed.subtitleUrl).toBe(
        "https://v16-webapp.tiktokcdn.com/foo/tiktok.vtt",
    );
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

test("parseTikTokPage ignores non-array subtitle tracks", () => {
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"desc":"Caption only","video":{"subtitleInfos":"broken","claInfo":{"captionInfos":null}}}}}}}</script>`;
    const parsed = parseTikTokPage(html);
    expect(parsed).toEqual({
        ok: true,
        text: "Caption only",
        subtitleUrl: null,
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
    if (post.ok) {
        expect(post.text).toMatch(/^Sunday stew:/);
        expect(post.text).not.toMatch(/^Cook/);
        expect(post.text).not.toMatch(/Posted by/i);
    }
    const inlineAttribution = parseFacebookOembed(
        JSON.stringify({
            html: '<blockquote class="fb-xfbml-parse-ignore"><p>Posted by my grandma: 2 cups flour, 1 egg.</p>Posted by <a href="https://www.facebook.com/x">Page</a> on Monday</blockquote>',
        }),
    );
    expect(inlineAttribution.ok).toBe(true);
    if (inlineAttribution.ok) {
        expect(inlineAttribution.text).toContain("Posted by my grandma");
        expect(inlineAttribution.text).toContain("2 cups flour");
    }
    const nested = parseFacebookOembed(
        JSON.stringify({
            html: '<blockquote class="fb-xfbml-parse-ignore"><p>Outer caption</p><blockquote><p>Inner keep</p></blockquote>Posted by <a href="https://www.facebook.com/x">X</a> on Monday</blockquote>',
        }),
    );
    expect(nested.ok).toBe(true);
    if (nested.ok) {
        expect(nested.text).toContain("Outer caption");
        expect(nested.text).toContain("Inner keep");
    }
    expect(parseFacebookOembed("null")).toEqual({
        ok: false,
        reason: "format_changed",
    });
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
        ["https://www.facebook.com/reels/1", "oembed_video"],
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
            const parsed = new URL(href);
            if (opts?.allowedHosts?.length) {
                const allowed = opts.allowedHosts.some(
                    (host) =>
                        parsed.hostname === host ||
                        parsed.hostname.endsWith(`.${host}`),
                );
                if (!allowed) {
                    return {
                        ok: false,
                        reason: "host_not_allowed" as FetchFailure,
                        status: null,
                        detail: parsed.hostname,
                    };
                }
            }
            if (onHost(href, "graph.facebook.com")) {
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
        if (onHost(url, "tiktokcdn.com"))
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
        if (onHost(url, "tiktokcdn.com")) {
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

test("readFacebook refuses graph redirect to facebook.com", async () => {
    const PUBLIC = "93.184.216.34";
    let fetchCount = 0;
    const fetcher = createSafeFetcher({
        resolve: async () => [PUBLIC],
        fetch: async (url) => {
            fetchCount += 1;
            const href = String(url);
            if (onHost(href, "graph.facebook.com")) {
                return new Response("", {
                    status: 302,
                    headers: {
                        location: "https://www.facebook.com/evil",
                    },
                });
            }
            throw new Error(`unexpected fetch ${href}`);
        },
    });
    const result = await readFacebook(
        fetcher,
        "https://www.facebook.com/watch/?v=1",
    );
    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(fetchCount).toBe(1);
});

test("readTikTok skips subtitle fetch on disallowed host", async () => {
    const html = load("tiktok-video.html").replace(
        "https://v16-webapp.tiktokcdn.com/foo/tiktok.vtt",
        "https://www.instagram.com/sub.vtt",
    );
    let instagramBodyRequested = false;
    const fetcher = trackingFetcher((url) => {
        if (onHost(url, "instagram.com")) {
            instagramBodyRequested = true;
        }
        return { ok: true, body: html };
    });
    const result = await readTikTok(
        fetcher,
        "https://www.tiktok.com/@x/video/1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
        expect(result.text).toContain("Garlic butter pasta");
        expect(result.transcript).toBeNull();
    }
    expect(instagramBodyRequested).toBe(false);
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

describe("reader text keeps its line breaks", () => {
    test("each subtitle cue is its own line", () => {
        const vtt =
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n2 cups flour\n\n2\n00:00:01.000 --> 00:00:02.000\n1 tsp salt\n\n3\n00:00:02.000 --> 00:00:03.000\nDirections: mix.";
        expect(webVttToText(vtt)).toBe(
            "2 cups flour\n1 tsp salt\nDirections: mix.",
        );
    });

    test("a Facebook caption keeps <br> lines inside one paragraph", () => {
        const json = JSON.stringify({
            html: '<blockquote class="fb-xfbml-parse-ignore"><p>Sunday stew:<br/>1 lb beef<br />3 carrots<br><br>Simmer 2 hours.</p>Posted by <a href="https://x">Cook</a> on <a href="https://y">Tuesday</a></blockquote>',
        });
        const result = parseFacebookOembed(json);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.text).toBe(
            "Sunday stew:\n1 lb beef\n3 carrots\n\nSimmer 2 hours.",
        );
    });
});

test("a look-alike host is not Facebook", () => {
    expect(facebookOembedEndpoint("https://evilfacebook.com/videos/1")).toEqual(
        { ok: false, reason: "unsupported_link" },
    );
    expect(
        facebookOembedEndpoint("https://facebook.com.evil.io/posts/1"),
    ).toEqual({ ok: false, reason: "unsupported_link" });
});

test("subtitle tags cannot reassemble across a strip", () => {
    const vtt =
        "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<<c>script>alert(1)<</c>/script> 2 cups flour";
    expect(webVttToText(vtt)).not.toContain("<script");
});
