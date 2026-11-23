import { test, expect, describe } from "bun:test";
import { Hono } from "hono";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOASTS, type ToastKey } from "../../copy/toasts.js";
import {
    decodeToastFlash,
    encodeToastFlash,
    flashToastMiddleware,
    formatToastText,
    readToastCookie,
    redirectWithToast,
    toastClearCookieHeader,
    toastSeedElement,
    TOAST_COOKIE,
} from "./toast.js";
import { cookSheetToastFlash } from "./toast-flash.js";
import { renderBarePage } from "../shell.js";
import {
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "./v2/test-helpers.js";

describe("toast flash codec", () => {
    test("round-trips a catalog key with params", () => {
        const encoded = encodeToastFlash({
            key: "fridge.item.already-on-grocery",
            params: { unused: "x" },
        });
        expect(encoded).not.toBeNull();
        const decoded = decodeToastFlash(encoded!);
        expect(decoded).toEqual({ key: "fridge.item.already-on-grocery" });
    });

    test("unknown key encodes to null", () => {
        expect(
            encodeToastFlash({ key: "nope.not.real" as ToastKey }),
        ).toBeNull();
    });

    test("tampered cookie decodes to null", () => {
        expect(decodeToastFlash("not-base64!!!")).toBeNull();
        expect(decodeToastFlash("e30")).toBeNull();
    });

    test("a retired key decodes to null", () => {
        const json = Buffer.from(
            JSON.stringify({ k: "nutrition.meal.deleted" }),
            "utf8",
        ).toString("base64url");
        expect(decodeToastFlash(json)).toBeNull();
    });

    test("an action in the cookie is dropped: a toast never carries a button", () => {
        const key = "plan.missing.none" satisfies ToastKey;
        const json = Buffer.from(
            JSON.stringify({
                k: key,
                a: { label: "Undo", action: "/meals/undo" },
            }),
            "utf8",
        ).toString("base64url");
        expect(decodeToastFlash(json)).toEqual({ key });
    });

    test("formatToastText leaves param values as plain text", () => {
        const raw = '<b>&"';
        expect(formatToastText("notice.added.check", { name: "Milk" })).toBe(
            "Added Milk to the grocery list. Check what you have",
        );
        expect(formatToastText("notice.added.check", { name: raw })).toBe(
            `Added ${raw} to the grocery list. Check what you have`,
        );
    });

    test("formatToastText keeps $-patterns literal in a catalog param", () => {
        for (const name of ["$&", "$`", "$'", "$$", "Mac $& Cheese $1"]) {
            expect(formatToastText("notice.added.check", { name })).toBe(
                `Added ${name} to the grocery list. Check what you have`,
            );
        }
    });

    test("toastSeedElement escapes text once for the attribute", () => {
        const plain = formatToastText("notice.added.check", {
            name: '<b>&"',
        });
        const seed = toastSeedElement("success", plain);
        expect(seed).toContain(
            'data-toast-text="Added &lt;b&gt;&amp;&quot; to the grocery list. Check what you have',
        );
    });

    test("readToastCookie parses header", () => {
        const encoded = encodeToastFlash({ key: "plan.missing.none" });
        const header = `other=1; ${TOAST_COOKIE}=${encodeURIComponent(encoded!)}`;
        expect(readToastCookie(header)).toBe(encoded);
    });
});

describe("toast-flash helpers", () => {
    const plain = { shortNames: [], unmeasuredNames: [], changedNames: [] };

    test("a clean cook says nothing", () => {
        expect(cookSheetToastFlash(plain)).toBeNull();
    });

    test("a shortfall or an uncounted ingredient is one recipes.cooked.short", () => {
        expect(
            cookSheetToastFlash({ ...plain, shortNames: ["Flour"] }),
        ).toEqual({
            key: "recipes.cooked.short",
            params: { names: "Flour" },
        });
        expect(
            cookSheetToastFlash({ ...plain, unmeasuredNames: ["Salt"] }),
        ).toEqual({
            key: "recipes.cooked.short",
            params: { names: "Salt" },
        });
        // Both lists, one name once.
        expect(
            cookSheetToastFlash({
                ...plain,
                shortNames: ["Flour", "Salt"],
                unmeasuredNames: ["Salt", "Pepper"],
            }),
        ).toEqual({
            key: "recipes.cooked.short",
            params: { names: "Flour, Salt, Pepper" },
        });
    });

    test("a kitchen that changed under the preview outranks a shortfall", () => {
        expect(
            cookSheetToastFlash({
                shortNames: ["Flour"],
                unmeasuredNames: ["Salt"],
                changedNames: ["Salmon", "Rice"],
            }),
        ).toEqual({
            key: "recipes.cooked.changed",
            params: { names: "Salmon, Rice" },
        });
        expect(
            cookSheetToastFlash({
                ...plain,
                changedNames: ["x".repeat(120)],
            })?.params.names,
        ).toHaveLength(80);
        expect(
            cookSheetToastFlash({
                ...plain,
                shortNames: ["x".repeat(120)],
            })?.params.names,
        ).toHaveLength(80);
    });
});

// String.replace reads `$&`, `$\``, `$'` and `$$` in a replacement string
// even after HTML escaping. A recipe title scraped from a web page reaches a
// toast, so those must stay literal text everywhere a toast is spliced in.
const DOLLAR_NAMES = [
    "$&",
    "$`",
    "$'",
    "$$",
    "Mac $& Cheese $1",
    'a$`b" onmouseover=x',
];

// HTMLRewriter returns attributes as written; decode what escapeHtml emits.
function decodeEntities(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
}

// Parse the page as a browser would: the seed's text attribute, and any
// on* attribute anywhere (one would mean the toast text escaped into markup).
async function parseSeed(html: string) {
    const seedTexts: string[] = [];
    const handlerAttributes: string[] = [];
    await new HTMLRewriter()
        .on("#toast-seed", {
            element(el) {
                seedTexts.push(
                    decodeEntities(el.getAttribute("data-toast-text") ?? ""),
                );
            },
        })
        .on("*", {
            element(el) {
                for (const [attr] of el.attributes) {
                    if (/^on/i.test(attr)) handlerAttributes.push(attr);
                }
            },
        })
        .transform(new Response(html))
        .text();
    return { seedTexts, handlerAttributes };
}

describe("toast text with $-patterns", () => {
    test("formatToastText keeps $-patterns in a param literal", () => {
        for (const name of DOLLAR_NAMES) {
            expect(
                formatToastText("recipes.cooked.changed", { names: name }),
            ).toBe(
                `Recipe cooked, but your kitchen had changed since the preview: ${name}`,
            );
        }
    });
});

describe("flashToastMiddleware", () => {
    const appHtml = renderBarePage("T", "<p>hi</p>", "light");

    function appWithFlash(initialCookie?: string) {
        const app = new Hono();
        app.use("*", flashToastMiddleware);
        app.get("/page", (c) => c.html(appHtml, 200));
        app.post("/page", (c) => c.redirect("/page", 303));
        app.get("/json", (c) => c.json({ ok: true }));
        app.get("/err", (c) => c.html("<html></html>", 400));
        return (path: string, init?: RequestInit) =>
            app.request(`http://x${path}`, {
                ...init,
                headers: {
                    ...(init?.headers ?? {}),
                    ...(initialCookie
                        ? {
                              cookie: `${TOAST_COOKIE}=${encodeURIComponent(initialCookie)}`,
                          }
                        : {}),
                },
            });
    }

    test("a toast param made of $-patterns stays text in the seed", async () => {
        for (const name of DOLLAR_NAMES) {
            const flash = encodeToastFlash({
                key: "recipes.cooked.changed",
                params: { names: name },
            })!;
            const html = await (await appWithFlash(flash)("/page")).text();
            // The page arrives once, whole: nothing pasted into the seed.
            expect(html.match(/<\/body>/g)).toHaveLength(1);
            expect(html.match(/<p>hi<\/p>/g)).toHaveLength(1);
            const parsed = await parseSeed(html);
            expect(parsed.seedTexts).toEqual([
                `Recipe cooked, but your kitchen had changed since the preview: ${name}`,
            ]);
            expect(parsed.handlerAttributes).toEqual([]);
        }
    });

    test("injects seed and clears cookie on 200 HTML GET", async () => {
        const flash = encodeToastFlash({ key: "plan.missing.none" })!;
        const req = appWithFlash(flash);
        const res = await req("/page");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('id="toast-seed"');
        expect(html).toContain(
            'data-toast-text="Nothing is missing for the plan"',
        );
        expect(res.headers.get("set-cookie")).toContain(`${TOAST_COOKIE}=`);
        expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    });

    // A recipe title scraped from a web page lands in a toast; the seed goes
    // into the page with String.replace, which reads `$\`` and `$'` in a
    // replacement string as "paste the page before / after here".
    test("every DOLLAR_PAYLOADS param stays text in the seed, page arrives once", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const flash = encodeToastFlash({
                key: "notice.added.check",
                params: { name: payload },
            })!;
            const res = await appWithFlash(flash)("/page");
            const html = await res.text();
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(html, "#toast-seed", "data-toast-text"),
            ).toEqual([
                `Added ${payload} to the grocery list. Check what you have`,
            ]);
            // The page itself arrives once, whole.
            expect(html.match(/<\/body>/g)).toHaveLength(1);
            expect(html.match(/<p>hi<\/p>/g)).toHaveLength(1);
        }
    });

    test("does not consume on POST, 4xx, or non-HTML", async () => {
        const flash = encodeToastFlash({ key: "plan.missing.none" })!;
        const req = appWithFlash(flash);
        const post = await req("/page", { method: "POST" });
        expect(post.status).toBe(303);
        expect(post.headers.get("set-cookie")).toBeNull();

        const json = await req("/json");
        expect(json.status).toBe(200);
        expect(json.headers.get("set-cookie")).toBeNull();

        const err = await req("/err");
        expect(err.status).toBe(400);
        expect(err.headers.get("set-cookie")).toBeNull();
    });

    test("tampered cookie injects nothing but clears cookie", async () => {
        const req = appWithFlash("!!!");
        const res = await req("/page");
        const html = await res.text();
        expect(html).not.toContain("toast-seed");
        expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    });

    test("login-like HTML without toast-region leaves cookie intact", async () => {
        const app = new Hono();
        app.use("*", flashToastMiddleware);
        app.get("/login", (c) =>
            c.html("<html><body>login</body></html>", 200),
        );
        const flash = encodeToastFlash({ key: "plan.missing.none" })!;
        const res = await app.request("http://x/login", {
            headers: {
                cookie: `${TOAST_COOKIE}=${encodeURIComponent(flash)}`,
            },
        });
        expect(res.headers.get("set-cookie")).toBeNull();
    });
});

test("redirectWithToast sets flash cookie", async () => {
    const app = new Hono();
    app.post("/go", (c) => redirectWithToast(c, "/done", "plan.missing.none"));
    const res = await app.request("http://x/go", { method: "POST" });
    expect(res.status).toBe(303);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(TOAST_COOKIE);
    expect(setCookie).toContain("HttpOnly");
});

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(path));
        else if (
            /\.(ts|js)$/.test(entry.name) &&
            !/\.test\.ts$/.test(entry.name)
        )
            out.push(path);
    }
    return out;
}

test("every TOASTS key has a call site outside src/copy/toasts.ts", () => {
    const src = join(import.meta.dir, "../..");
    const own = join(src, "copy", "toasts.ts");
    const texts = sourceFiles(src)
        .filter((path) => path !== own)
        .map((path) => readFileSync(path, "utf8"));
    for (const key of Object.keys(TOASTS)) {
        expect(
            texts.some((text) => text.includes(`"${key}"`)),
            `${key} has no call site`,
        ).toBe(true);
    }
});

test("no bare successful POST c.redirect(..., 303) in web routes", () => {
    const routeDir = join(import.meta.dir, "../routes");
    const bareRedirectRe = /return\s+c\.redirect\([\s\S]*?,\s*303\s*\)/g;
    for (const file of readdirSync(routeDir).filter((f) => f.endsWith(".ts"))) {
        const src = readFileSync(join(routeDir, file), "utf8");
        let match: RegExpExecArray | null;
        while ((match = bareRedirectRe.exec(src)) !== null) {
            const before = src.slice(0, match.index);
            const lineNo = before.split("\n").length - 1;
            const lines = src.split("\n");
            const prev = lines[lineNo - 1] ?? "";
            expect(prev).toMatch(/\/\/ toast: none\b/);
        }
    }
});

test("toastClearCookieHeader clears cookie", () => {
    expect(toastClearCookieHeader(false)).toContain("Max-Age=0");
});
