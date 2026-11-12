import { describe, expect, test } from "bun:test";
import { createSafeFetcher } from "../fetch-safe.js";
import {
    isSharedRecipeJsonUrl,
    looksLikeSharedRecipeLink,
    parseSharedRecipeInput,
    readSharedRecipe,
    SHARE_FETCH_TIMEOUT_MS,
    SharedRecipeImportError,
} from "./sharing-source.js";

const TOKEN = "A".repeat(43);

function refusal(raw: string): SharedRecipeImportError {
    try {
        parseSharedRecipeInput(raw);
    } catch (err) {
        if (err instanceof SharedRecipeImportError) return err;
        throw err;
    }
    throw new Error(`expected "${raw}" to be refused`);
}

describe("parseSharedRecipeInput: a pasted share link", () => {
    test("the .json address is kept as it is", () => {
        const input = parseSharedRecipeInput(
            `https://kitchen.example/s/${TOKEN}.json`,
        );
        expect(input).toEqual({
            kind: "url",
            url: `https://kitchen.example/s/${TOKEN}.json`,
        });
    });

    test("the page address gets .json appended", () => {
        const input = parseSharedRecipeInput(
            `  https://kitchen.example/s/${TOKEN}\n`,
        );
        expect(input).toEqual({
            kind: "url",
            url: `https://kitchen.example/s/${TOKEN}.json`,
        });
    });

    test("every base64url character is a token character", () => {
        const token = `${"aZ09-_".repeat(7)}a`;
        expect(token).toHaveLength(43);
        const input = parseSharedRecipeInput(`https://x.example/s/${token}`);
        expect(input).toEqual({
            kind: "url",
            url: `https://x.example/s/${token}.json`,
        });
    });

    test("a query string or fragment is dropped, never fetched", () => {
        const input = parseSharedRecipeInput(
            `https://kitchen.example/s/${TOKEN}?utm=x&next=https://evil.example#top`,
        );
        expect(input).toEqual({
            kind: "url",
            url: `https://kitchen.example/s/${TOKEN}.json`,
        });
    });

    test("the explicit default https port is fine", () => {
        const input = parseSharedRecipeInput(
            `https://kitchen.example:443/s/${TOKEN}`,
        );
        expect(input).toEqual({
            kind: "url",
            url: `https://kitchen.example/s/${TOKEN}.json`,
        });
    });

    test.each([
        ["http, not https", `http://kitchen.example/s/${TOKEN}.json`],
        ["a different path", `https://kitchen.example/other/${TOKEN}.json`],
        ["the root", "https://kitchen.example/"],
        [
            "a token that is too short",
            `https://kitchen.example/s/${"A".repeat(42)}`,
        ],
        [
            "a token that is too long",
            `https://kitchen.example/s/${"A".repeat(44)}.json`,
        ],
        [
            "a token with a bad character",
            `https://kitchen.example/s/${"A".repeat(42)}!`,
        ],
        ["a trailing slash", `https://kitchen.example/s/${TOKEN}/`],
        ["a second suffix", `https://kitchen.example/s/${TOKEN}.json.json`],
        ["a capital suffix", `https://kitchen.example/s/${TOKEN}.JSON`],
        ["a deeper path", `https://kitchen.example/x/s/${TOKEN}.json`],
        [
            "an encoded slash in the token",
            `https://kitchen.example/s/${"A".repeat(40)}%2FAA`,
        ],
        ["a username and password", `https://me:pw@kitchen.example/s/${TOKEN}`],
        ["a non-default port", `https://kitchen.example:8443/s/${TOKEN}`],
        ["a loopback address", `https://127.0.0.1/s/${TOKEN}.json`],
        ["the metadata address", `https://169.254.169.254/s/${TOKEN}.json`],
        ["a private IPv4 address", `https://10.0.0.5/s/${TOKEN}.json`],
        ["a private IPv6 address", `https://[fd00::1]/s/${TOKEN}.json`],
        ["localhost", `https://localhost/s/${TOKEN}.json`],
        ["a .local host", `https://pi.local/s/${TOKEN}.json`],
        ["a .internal host", `https://app.internal/s/${TOKEN}.json`],
        ["a host with no dot", `https://kitchen/s/${TOKEN}.json`],
        ["a file address", `file:///s/${TOKEN}.json`],
        ["a javascript address", `javascript:alert(1)//s/${TOKEN}.json`],
        ["not a link at all", "pasta with garlic"],
        ["an empty paste", ""],
        ["only spaces", "   \n  "],
    ])("refuses %s before any network call", (_name, raw) => {
        expect(refusal(raw).code).toBe("not_share_link");
    });

    test("the refusal explains what to paste", () => {
        expect(refusal("pasta").message).toMatch(/share link/i);
        expect(refusal("").message).toMatch(/paste/i);
    });
});

describe("parseSharedRecipeInput: pasted JSON", () => {
    test("text that starts with { is the document, untouched", () => {
        const text = '  {"version":1,"name":"Soup"}  ';
        expect(parseSharedRecipeInput(text)).toEqual({
            kind: "document",
            text,
        });
    });

    test("a byte order mark does not hide the brace", () => {
        const text = '﻿{"version":1}';
        expect(parseSharedRecipeInput(text)).toEqual({
            kind: "document",
            text,
        });
    });
});

describe("isSharedRecipeJsonUrl", () => {
    test("only the exact .json path on https passes", () => {
        expect(
            isSharedRecipeJsonUrl(
                new URL(`https://kitchen.example/s/${TOKEN}.json`),
            ),
        ).toBe(true);
        expect(
            isSharedRecipeJsonUrl(
                new URL(`https://kitchen.example/s/${TOKEN}`),
            ),
        ).toBe(false);
        expect(
            isSharedRecipeJsonUrl(
                new URL(`http://kitchen.example/s/${TOKEN}.json`),
            ),
        ).toBe(false);
        expect(
            isSharedRecipeJsonUrl(new URL("https://kitchen.example/other")),
        ).toBe(false);
        expect(
            isSharedRecipeJsonUrl(new URL(`https://127.0.0.1/s/${TOKEN}.json`)),
        ).toBe(false);
    });
});

// ---------- reading: the fetch and the document ----------

const PUBLIC = "93.184.216.34";
const URL_OK = `https://kitchen.example/s/${TOKEN}.json`;

function validDocument(over: Record<string, unknown> = {}) {
    return {
        version: 1,
        name: "Lentil soup",
        portions: 4,
        instructions: "Simmer.",
        tags: ["soup"],
        ingredients: [
            {
                food_name: "Red lentils",
                amount: 200,
                unit: "g",
                food: {
                    calories: 350,
                    protein_g: 25,
                    carbs_g: 60,
                    fat_g: 1.5,
                    fiber_g: 11,
                    sugar_g: 2,
                    saturated_fat_g: 0.2,
                    alcohol_g: null,
                    caffeine_mg: null,
                    grams_per_ml: null,
                    grams_per_each: null,
                },
            },
        ],
        ...over,
    };
}

function jsonResponse(
    body: string,
    headers: Record<string, string> = {},
    status = 200,
) {
    return new Response(body, {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

type Seen = { urls: string[]; resolved: string[] };

function liveFetcher(
    handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
    resolve: (host: string) => string[] = () => [PUBLIC],
) {
    const seen: Seen = { urls: [], resolved: [] };
    const fetcher = createSafeFetcher({
        resolve: async (host) => {
            seen.resolved.push(host);
            return resolve(host);
        },
        fetch: async (url, init) => {
            seen.urls.push(String(url));
            return handler(String(url), init);
        },
    });
    return { fetcher, seen };
}

async function readError(
    promise: Promise<unknown>,
): Promise<SharedRecipeImportError> {
    try {
        await promise;
    } catch (err) {
        if (err instanceof SharedRecipeImportError) return err;
        throw err;
    }
    throw new Error("expected the read to be refused");
}

describe("readSharedRecipe: fetching a share link", () => {
    test("fetches the .json address and returns the parsed document", async () => {
        const { fetcher, seen } = liveFetcher(() =>
            jsonResponse(JSON.stringify(validDocument())),
        );
        const doc = await readSharedRecipe(URL_OK, { fetcher });
        expect(doc.name).toBe("Lentil soup");
        expect(doc.ingredients[0]!.food.protein_g).toBe(25);
        expect(seen.urls).toEqual([URL_OK]);
    });

    test("a pasted page address is fetched as the .json document", async () => {
        const { fetcher, seen } = liveFetcher(() =>
            jsonResponse(JSON.stringify(validDocument())),
        );
        await readSharedRecipe(`https://kitchen.example/s/${TOKEN}`, {
            fetcher,
        });
        expect(seen.urls).toEqual([URL_OK]);
    });

    test("asks for JSON only, within 256 KB and 10 s, and ignores robots.txt", async () => {
        const calls: unknown[] = [];
        const fetcher = {
            fetchPage: async (url: URL | string, opts: unknown) => {
                calls.push({ url: String(url), opts });
                return {
                    ok: true as const,
                    url: String(url),
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify(validDocument()),
                };
            },
        };
        await readSharedRecipe(URL_OK, { fetcher });
        expect(calls).toHaveLength(1);
        const { url, opts } = calls[0] as {
            url: string;
            opts: {
                accept: string[];
                maxBytes: number;
                timeoutMs: number;
                checkRobots: boolean;
                redirectAllowed: (next: URL) => boolean;
            };
        };
        expect(url).toBe(URL_OK);
        expect(opts.accept).toEqual(["application/json"]);
        expect(opts.maxBytes).toBe(256 * 1024);
        expect(opts.timeoutMs).toBe(10_000);
        expect(SHARE_FETCH_TIMEOUT_MS).toBe(10_000);
        // A person pasted this address themselves; no crawler policy applies.
        expect(opts.checkRobots).toBe(false);
        expect(opts.redirectAllowed(new URL(URL_OK))).toBe(true);
        expect(
            opts.redirectAllowed(new URL("https://kitchen.example/other")),
        ).toBe(false);
    });

    test("pasted JSON is parsed without touching the network", async () => {
        const { fetcher, seen } = liveFetcher(() => {
            throw new Error("no network for a pasted document");
        });
        const doc = await readSharedRecipe(
            `  ${JSON.stringify(validDocument({ name: "Pasted" }))}  `,
            { fetcher },
        );
        expect(doc.name).toBe("Pasted");
        expect(seen.urls).toEqual([]);
        expect(seen.resolved).toEqual([]);
    });

    test("http://, another path and a malformed token never reach the fetcher", async () => {
        const { fetcher, seen } = liveFetcher(() =>
            jsonResponse(JSON.stringify(validDocument())),
        );
        for (const raw of [
            `http://kitchen.example/s/${TOKEN}.json`,
            `https://kitchen.example/other`,
            `https://kitchen.example/s/${"A".repeat(10)}`,
            `https://kitchen.example/s/${TOKEN}.json.json`,
        ]) {
            const err = await readError(readSharedRecipe(raw, { fetcher }));
            expect(err.code).toBe("not_share_link");
        }
        expect(seen.urls).toEqual([]);
        expect(seen.resolved).toEqual([]);
    });

    test("a host that resolves to a private address is refused before a request", async () => {
        for (const address of [
            "10.0.0.5",
            "127.0.0.1",
            "169.254.169.254",
            "192.168.1.9",
            "::1",
            "fd00::1",
            "::ffff:10.0.0.1",
        ]) {
            const { fetcher, seen } = liveFetcher(
                () => jsonResponse(JSON.stringify(validDocument())),
                () => [address],
            );
            const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
            expect(err.code).toBe("not_share_link");
            expect(err.message).toMatch(/address/i);
            expect(seen.urls).toEqual([]);
        }
    });

    test("one private address among several public ones is enough to refuse", async () => {
        const { fetcher, seen } = liveFetcher(
            () => jsonResponse(JSON.stringify(validDocument())),
            () => [PUBLIC, "10.0.0.5"],
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("not_share_link");
        expect(seen.urls).toEqual([]);
    });

    test("a redirect to the metadata address is refused and never requested", async () => {
        const { fetcher, seen } = liveFetcher((url) =>
            url === URL_OK
                ? jsonResponse(
                      "",
                      {
                          location: `https://169.254.169.254/s/${TOKEN}.json`,
                      },
                      302,
                  )
                : jsonResponse(JSON.stringify(validDocument())),
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("not_share_link");
        expect(seen.urls).toEqual([URL_OK]);
        expect(seen.resolved).toEqual(["kitchen.example"]);
    });

    test("a redirect to a public host that resolves privately is refused", async () => {
        const { fetcher, seen } = liveFetcher(
            (url) =>
                url === URL_OK
                    ? jsonResponse(
                          "",
                          {
                              location: `https://rebind.example/s/${TOKEN}.json`,
                          },
                          302,
                      )
                    : jsonResponse(JSON.stringify(validDocument())),
            (host) => (host === "rebind.example" ? ["10.0.0.5"] : [PUBLIC]),
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("not_share_link");
        expect(seen.urls).toEqual([URL_OK]);
    });

    test("a redirect to another path on a public host is refused", async () => {
        const { fetcher, seen } = liveFetcher((url) =>
            url === URL_OK
                ? jsonResponse(
                      "",
                      { location: "https://other.example/account" },
                      302,
                  )
                : jsonResponse(JSON.stringify(validDocument())),
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("not_share_link");
        expect(seen.urls).toEqual([URL_OK]);
    });

    test("a redirect to http:// is refused", async () => {
        const { fetcher, seen } = liveFetcher(() =>
            jsonResponse(
                "",
                { location: `http://kitchen.example/s/${TOKEN}.json` },
                301,
            ),
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("not_share_link");
        expect(seen.urls).toEqual([URL_OK]);
    });

    test("a redirect to another share document is followed", async () => {
        const moved = `https://share.example/s/${"B".repeat(43)}.json`;
        const { fetcher, seen } = liveFetcher((url) =>
            url === URL_OK
                ? jsonResponse("", { location: moved }, 301)
                : jsonResponse(JSON.stringify(validDocument())),
        );
        const doc = await readSharedRecipe(URL_OK, { fetcher });
        expect(doc.name).toBe("Lentil soup");
        expect(seen.urls).toEqual([URL_OK, moved]);
    });

    test("a 300 KB body is refused", async () => {
        const padded = JSON.stringify(
            validDocument({ instructions: "x".repeat(300 * 1024) }),
        );
        const { fetcher } = liveFetcher(() => jsonResponse(padded));
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("too_large");
        expect(err.message).toMatch(/too large/i);
    });

    test("a streamed body over the cap with no content-length is refused", async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const chunk = new Uint8Array(100 * 1024).fill(32);
                for (let i = 0; i < 4; i++) controller.enqueue(chunk);
                controller.close();
            },
        });
        const { fetcher } = liveFetcher(
            () =>
                new Response(stream, {
                    headers: { "content-type": "application/json" },
                }),
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("too_large");
    });

    test("a response that does not answer within the timeout is refused", async () => {
        const { fetcher } = liveFetcher(
            (_url, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("Aborted", "AbortError")),
                    );
                }),
        );
        const err = await readError(
            readSharedRecipe(URL_OK, { fetcher, timeoutMs: 30 }),
        );
        expect(err.code).toBe("unreachable");
        expect(err.message).toMatch(/answer|time/i);
    });

    test("a body that stalls past the timeout is refused", async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"version":'));
                // never closes
            },
        });
        const { fetcher } = liveFetcher(
            () =>
                new Response(stream, {
                    headers: { "content-type": "application/json" },
                }),
        );
        const err = await readError(
            readSharedRecipe(URL_OK, { fetcher, timeoutMs: 30 }),
        );
        expect(err.code).toBe("unreachable");
    });

    test.each(["text/html", "text/plain", "application/xml", ""])(
        "a %p response is not a recipe document",
        async (type) => {
            const { fetcher } = liveFetcher(
                () =>
                    new Response(JSON.stringify(validDocument()), {
                        headers: type ? { "content-type": type } : {},
                    }),
            );
            const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
            expect(err.code).toBe("not_recipe");
        },
    );

    test("a body that is JSON but not a document is not a recipe", async () => {
        for (const body of ["[1,2]", "null", '"soup"', "{}"]) {
            const { fetcher } = liveFetcher(() => jsonResponse(body));
            const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
            expect(err.code).toBe("not_recipe");
        }
    });

    test("application/json with a charset is accepted", async () => {
        const { fetcher } = liveFetcher(() =>
            jsonResponse(JSON.stringify(validDocument()), {
                "content-type": "application/json; charset=utf-8",
            }),
        );
        expect((await readSharedRecipe(URL_OK, { fetcher })).name).toBe(
            "Lentil soup",
        );
    });

    test.each([404, 410])(
        "a %p is a link that no longer works",
        async (status) => {
            const { fetcher } = liveFetcher(() =>
                jsonResponse(
                    "Not found",
                    { "content-type": "text/plain" },
                    status,
                ),
            );
            const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
            expect(err.code).toBe("not_found");
            expect(err.message).toMatch(/revoked|expired/i);
        },
    );

    test.each([401, 403, 429, 500, 502, 503])(
        "a %p means the other Foodable could not be reached",
        async (status) => {
            const { fetcher } = liveFetcher(() =>
                jsonResponse("", { "content-type": "text/plain" }, status),
            );
            const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
            expect(err.code).toBe("unreachable");
        },
    );

    test("a network failure is unreachable, without the raw error", async () => {
        const { fetcher } = liveFetcher(() => {
            throw new Error("connect ECONNREFUSED 10.1.2.3:443");
        });
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("unreachable");
        expect(err.message).not.toContain("10.1.2.3");
    });

    test("a host that does not resolve is unreachable", async () => {
        const { fetcher } = liveFetcher(
            () => jsonResponse(JSON.stringify(validDocument())),
            () => [],
        );
        const err = await readError(readSharedRecipe(URL_OK, { fetcher }));
        expect(err.code).toBe("unreachable");
    });
});

describe("readSharedRecipe: the document", () => {
    const never = {
        fetchPage: async () => {
            throw new Error("unused");
        },
    };

    test("a version this deploy does not read is named as such", async () => {
        const err = await readError(
            readSharedRecipe(JSON.stringify(validDocument({ version: 2 })), {
                fetcher: never,
            }),
        );
        expect(err.code).toBe("unsupported_version");
        expect(err.message).toMatch(/version 2/);
        expect(err.message).toMatch(/version 1/);
    });

    test("a document over 256 KB is too large, however it arrives", async () => {
        const err = await readError(
            readSharedRecipe(
                JSON.stringify(
                    validDocument({ instructions: "x".repeat(300 * 1024) }),
                ),
                { fetcher: never },
            ),
        );
        expect(err.code).toBe("too_large");
    });

    test.each([
        ["text that is not JSON", "{not json"],
        [
            "a document with no ingredients list",
            JSON.stringify({ version: 1, name: "x", portions: 1 }),
        ],
        [
            "a document with no name",
            JSON.stringify(validDocument({ name: "  " })),
        ],
        [
            "a document with no version",
            JSON.stringify({ ...validDocument(), version: undefined }),
        ],
    ])("%s is not a recipe document", async (_name, text) => {
        const err = await readError(readSharedRecipe(text, { fetcher: never }));
        expect(err.code).toBe("not_recipe");
        expect(err.message).toMatch(/recipe/i);
    });

    test("a document with too many ingredients is not a recipe document", async () => {
        const one = validDocument().ingredients[0]!;
        const err = await readError(
            readSharedRecipe(
                JSON.stringify(
                    validDocument({ ingredients: Array(201).fill(one) }),
                ),
                { fetcher: never },
            ),
        );
        expect(err.code).toBe("not_recipe");
    });

    test("keys it does not know are ignored", async () => {
        const doc = await readSharedRecipe(
            JSON.stringify(validDocument({ author: "someone", extra: [1] })),
            { fetcher: never },
        );
        expect(doc.name).toBe("Lentil soup");
        expect("author" in doc).toBe(false);
    });
});

describe("looksLikeSharedRecipeLink", () => {
    test("a link whose path is /s/<token> or /s/<token>.json is a share link, on any host", () => {
        for (const raw of [
            `https://kitchen.example/s/${TOKEN}`,
            ` https://kitchen.example/s/${TOKEN}.json `,
            `http://kitchen.example/s/${TOKEN}`,
            `https://127.0.0.1/s/${TOKEN}`,
            `https://kitchen.example/s/${TOKEN}?x=1#y`,
        ]) {
            expect(looksLikeSharedRecipeLink(raw)).toBe(true);
        }
    });

    test("an ordinary recipe link, other paths, short tokens and non-links are not", () => {
        for (const raw of [
            "https://www.seriouseats.com/pan-seared-salmon",
            "https://kitchen.example/s/short",
            `https://kitchen.example/shop/${TOKEN}`,
            `https://kitchen.example/s/${TOKEN}/more`,
            "",
            "pasta",
            '{"version":1}',
        ]) {
            expect(looksLikeSharedRecipeLink(raw)).toBe(false);
        }
    });
});
