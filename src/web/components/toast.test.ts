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
import {
    addRecipeToGroceryToastFlash,
    cookRecipeToastFlash,
    groceryLineCheckToastKey,
    householdPersonRuleRemovedKey,
} from "./toast-flash.js";
import { renderBarePage } from "../shell.js";

describe("toast flash codec", () => {
    test("round-trips a catalog key with params", () => {
        const encoded = encodeToastFlash({
            key: "grocery.line.added",
            params: { unused: "x" },
        });
        expect(encoded).not.toBeNull();
        const decoded = decodeToastFlash(encoded!);
        expect(decoded).toEqual({ key: "grocery.line.added" });
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

    test("unknown toast action path is stripped", () => {
        const key = "nutrition.meal.deleted" satisfies ToastKey;
        const json = Buffer.from(
            JSON.stringify({
                k: key,
                a: {
                    label: "Undo",
                    action: "/evil",
                },
            }),
            "utf8",
        ).toString("base64url");
        expect(decodeToastFlash(json)).toEqual({ key });
    });

    test("formatToastText leaves param values as plain text", () => {
        const raw = '<b>&"';
        expect(formatToastText("recipes.added-to-grocery", { count: 2 })).toBe(
            "Added to the grocery list (2)",
        );
        expect(
            formatToastText("recipes.added-to-grocery", { count: raw }),
        ).toBe(`Added to the grocery list (${raw})`);
    });

    test("toastSeedElement escapes text once for the attribute", () => {
        const plain = formatToastText("recipes.added-to-grocery", {
            count: '<b>&"',
        });
        const seed = toastSeedElement("success", plain);
        expect(seed).toContain(
            'data-toast-text="Added to the grocery list (&lt;b&gt;&amp;&quot;)',
        );
    });

    test("readToastCookie parses header", () => {
        const encoded = encodeToastFlash({ key: "nutrition.meal.logged" });
        const header = `other=1; ${TOAST_COOKIE}=${encodeURIComponent(encoded!)}`;
        expect(readToastCookie(header)).toBe(encoded);
    });
});

describe("toast-flash helpers", () => {
    test("cookRecipeToastFlash", () => {
        expect(cookRecipeToastFlash(false, false, 0)).toBeNull();
        expect(cookRecipeToastFlash(true, false, 0)).toEqual({
            key: "recipes.cooked",
        });
        expect(cookRecipeToastFlash(false, true, 2)).toEqual({
            key: "recipes.cooked.shortfall",
        });
        expect(cookRecipeToastFlash(true, false, 1, ["Salt"])).toEqual({
            key: "recipes.cooked.shortfall.unmeasured",
            params: { names: "Salt" },
        });
    });

    test("addRecipeToGroceryToastFlash", () => {
        expect(addRecipeToGroceryToastFlash(0)).toEqual({
            key: "recipes.add-to-grocery.nothing",
        });
        expect(addRecipeToGroceryToastFlash(3)).toEqual({
            key: "recipes.added-to-grocery",
            params: { count: 3 },
        });
    });

    test("groceryLineCheckToastKey", () => {
        expect(groceryLineCheckToastKey(true)).toBe("grocery.line.checked");
        expect(groceryLineCheckToastKey(false)).toBe("grocery.line.unchecked");
    });

    test("householdPersonRuleRemovedKey", () => {
        expect(householdPersonRuleRemovedKey("rule")).toBe(
            "settings.household.rule.removed",
        );
        expect(householdPersonRuleRemovedKey("allergen")).toBe(
            "settings.household.allergen.removed",
        );
        expect(householdPersonRuleRemovedKey("dislike")).toBe(
            "settings.household.dislike.removed",
        );
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
                formatToastText("recipes.import.imported", {
                    name,
                    site: "example.com",
                }),
            ).toBe(`Imported ${name} from example.com.`);
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
                key: "recipes.import.imported",
                params: { name, site: "example.com" },
            })!;
            const html = await (await appWithFlash(flash)("/page")).text();
            // The page arrives once, whole: nothing pasted into the seed.
            expect(html.match(/<\/body>/g)).toHaveLength(1);
            expect(html.match(/<p>hi<\/p>/g)).toHaveLength(1);
            const parsed = await parseSeed(html);
            expect(parsed.seedTexts).toEqual([
                `Imported ${name} from example.com.`,
            ]);
            expect(parsed.handlerAttributes).toEqual([]);
        }
    });

    test("injects seed and clears cookie on 200 HTML GET", async () => {
        const flash = encodeToastFlash({ key: "nutrition.water.logged" })!;
        const req = appWithFlash(flash);
        const res = await req("/page");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('id="toast-seed"');
        expect(html).toContain('data-toast-text="Water logged"');
        expect(res.headers.get("set-cookie")).toContain(`${TOAST_COOKIE}=`);
        expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    });

    test("does not consume on POST, 4xx, or non-HTML", async () => {
        const flash = encodeToastFlash({ key: "nutrition.water.logged" })!;
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
        const flash = encodeToastFlash({ key: "nutrition.water.logged" })!;
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
    app.post("/go", (c) => redirectWithToast(c, "/done", "grocery.line.added"));
    const res = await app.request("http://x/go", { method: "POST" });
    expect(res.status).toBe(303);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(TOAST_COOKIE);
    expect(setCookie).toContain("HttpOnly");
});

test("every TOASTS key is referenced in web routes or client", () => {
    const routeDir = join(import.meta.dir, "../routes");
    const routeSources = readdirSync(routeDir)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => readFileSync(join(routeDir, f), "utf8"))
        .join("\n");
    const flashSource = readFileSync(
        join(import.meta.dir, "toast-flash.ts"),
        "utf8",
    );
    const clientSources = readFileSync(
        join(import.meta.dir, "../client/toast.js"),
        "utf8",
    );
    const haystack = `${routeSources}\n${flashSource}\n${clientSources}`;
    for (const key of Object.keys(TOASTS) as ToastKey[]) {
        expect(haystack).toContain(`"${key}"`);
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
