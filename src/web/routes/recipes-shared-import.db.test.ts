// Importing a recipe another Foodable shared, through the household app, against
// real Postgres: paste a share link (the fetcher is injected) or the document's
// JSON, land on the new recipe with a toast, or stay on Recipes with the reason.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { pairAppSqlForTests, setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import type { FetchOutcome } from "../../fetch-safe.js";
import { newFood } from "../../domain/foods.js";
import type { SharedRecipeFetcher } from "../../domain/sharing-source.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { setSharedRecipeFetcherForTests } from "../../sharing-import.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import {
    decodeToastFlash,
    formatToastText,
    readToastCookie,
} from "../components/toast.js";
import { recipesRoutes } from "./recipes.js";
import { sharedRecipeImportRoutes } from "./recipes-shared-import.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const TOKEN = "A".repeat(43);
const SHARE_PAGE = `https://kitchen.example/s/${TOKEN}`;
const SHARE_JSON = `${SHARE_PAGE}.json`;

const NO_NUTRITION = {
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    saturated_fat_g: null,
    alcohol_g: null,
    caffeine_mg: null,
    grams_per_ml: null,
    grams_per_each: null,
};

function documentText(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 1,
        name: "Lentil soup",
        portions: 4,
        instructions: "Simmer.",
        tags: ["soup"],
        ingredients: [
            {
                food_name: "Red lentils",
                amount: 300,
                unit: "g",
                food: {
                    ...NO_NUTRITION,
                    calories: 352,
                    protein_g: 24.6,
                    carbs_g: 63,
                    fat_g: 1.1,
                    grams_per_ml: 0.85,
                },
            },
            {
                food_name: "Egg",
                amount: 3,
                unit: "each",
                food: {
                    ...NO_NUTRITION,
                    calories: 143,
                    protein_g: 12.6,
                    carbs_g: 0.7,
                    fat_g: 9.5,
                    grams_per_each: 50,
                },
            },
        ],
        ...over,
    });
}

/** One lentil line with `over` applied, for documents that vary a line's text. */
function lentils(over: Record<string, unknown>) {
    return [
        {
            food_name: "Red lentils",
            amount: 300,
            unit: "g",
            food: { ...NO_NUTRITION, calories: 352 },
            ...over,
        },
    ];
}

type Stub = SharedRecipeFetcher & { calls: string[] };

function stubFetcher(outcome: (url: string) => FetchOutcome): Stub {
    const calls: string[] = [];
    return {
        calls,
        fetchPage: async (url) => {
            calls.push(String(url));
            return outcome(String(url));
        },
    };
}

function serving(body: string): Stub {
    return stubFetcher((url) => ({
        ok: true,
        url,
        status: 200,
        contentType: "application/json",
        body,
    }));
}

function failing(
    reason: Extract<FetchOutcome, { ok: false }>["reason"],
    status: number | null = null,
): Stub {
    return stubFetcher(() => ({ ok: false, reason, status, detail: "" }));
}

describeDb(
    pgAvailable !== null,
    "import a shared recipe in the app",
    (getCtx) => {
        let sql: SQL;
        let me: { userId: string; householdId: string };
        let other: { userId: string; householdId: string };

        const app = () =>
            new Hono()
                .route("/", sharedRecipeImportRoutes)
                .route("/", recipesRoutes);

        beforeEach(async () => {
            const ctx = getCtx();
            sql = ctx.sql;
            await ctx.truncateAll();
            setSqlForTests(sql);
            setFlagsForTests(
                createMemoryFlags({
                    "ui-v2": true,
                    "recipe-link-reader": true,
                }),
            );
            me = await seedHousehold(sql);
            other = await seedHousehold(sql);
        });

        afterEach(() => {
            setSharedRecipeFetcherForTests(null);
            setSqlForTests(null);
            resetFlagsForTests();
        });

        function post(
            path: string,
            fields: Record<string, string>,
            userId = me.userId,
        ) {
            return app().request(`http://test${path}`, {
                method: "POST",
                headers: {
                    cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams(fields).toString(),
            });
        }

        async function recipesOf(who = me) {
            return asUser(
                who.userId,
                () => liveRecipesStore().listRecipes(who.householdId),
                who.householdId,
            );
        }

        async function foodNamesOf(who = me) {
            return asUser(
                who.userId,
                async () =>
                    (await liveFoodsStore().listFoods(who.householdId)).map(
                        (f) => f.name,
                    ),
                who.householdId,
            );
        }

        function toastOf(res: Response): string {
            const set = res.headers
                .getSetCookie()
                .find((c) => c.startsWith("foodable_toast="));
            expect(set).toBeDefined();
            const flash = decodeToastFlash(readToastCookie(set!)!);
            expect(flash).not.toBeNull();
            return formatToastText(flash!.key, flash!.params);
        }

        test("pasting the document's JSON creates the recipe and lands on it with a toast", async () => {
            const fetcher = serving("never read");
            setSharedRecipeFetcherForTests(fetcher);
            const res = await post("/recipes/import-shared", {
                shared: documentText(),
            });
            expect(res.status).toBe(303);
            const recipes = await recipesOf();
            expect(recipes).toHaveLength(1);
            expect(res.headers.get("location")).toBe(
                `/recipes/${recipes[0]!.id}`,
            );
            expect(recipes[0]).toMatchObject({
                name: "Lentil soup",
                householdId: me.householdId,
                creatorId: me.userId,
                verification: "verified",
            });
            expect(await foodNamesOf()).toEqual(["Egg", "Red lentils"]);
            expect(toastOf(res)).toBe(
                "Imported Lentil soup. 0 matched your foods, 2 added.",
            );
            // A pasted document never touches the network.
            expect(fetcher.calls).toEqual([]);
        });

        test("pasting a share link fetches its .json and imports it", async () => {
            const fetcher = serving(documentText({ name: "From a link" }));
            setSharedRecipeFetcherForTests(fetcher);
            const res = await post("/recipes/import-shared", {
                shared: `  ${SHARE_PAGE}  `,
            });
            expect(res.status).toBe(303);
            expect(fetcher.calls).toEqual([SHARE_JSON]);
            expect((await recipesOf()).map((r) => r.name)).toEqual([
                "From a link",
            ]);
        });

        test("importing the same document at once never answers 500", async () => {
            setSharedRecipeFetcherForTests(serving("never read"));
            // The shared test connections are single-file; give the requests
            // pools of their own so the imports really overlap.
            const appUrl = new URL(getCtx().pg.url);
            appUrl.username = "foodable_app";
            const ownerPool = new SQL(getCtx().pg.url, {
                prepare: false,
                max: 6,
            });
            const appPool = new SQL(appUrl.toString(), {
                prepare: false,
                max: 6,
            });
            pairAppSqlForTests(ownerPool, appPool);
            setSqlForTests(ownerPool);
            let responses: Response[];
            try {
                responses = await Promise.all(
                    Array.from({ length: 4 }, () =>
                        post("/recipes/import-shared", {
                            shared: documentText(),
                        }),
                    ),
                );
            } finally {
                setSqlForTests(sql);
                await appPool.close();
                await ownerPool.close();
            }
            expect(responses.map((r) => r.status)).toEqual([
                303, 303, 303, 303,
            ]);
            expect((await recipesOf()).map((r) => r.name).sort()).toEqual([
                "Lentil soup",
                "Lentil soup (2)",
                "Lentil soup (3)",
                "Lentil soup (4)",
            ]);
            // One food per name: the losers matched what the winner made.
            expect(await foodNamesOf()).toEqual(["Egg", "Red lentils"]);
        });

        test("a food the household already has is matched and left alone", async () => {
            const mine = await asUser(
                me.userId,
                () =>
                    liveFoodsStore().insertFood(
                        newFood({
                            householdId: me.householdId,
                            kind: "food",
                            name: "egg",
                            calories: 150,
                            gramsPerEach: 60,
                        }),
                    ),
                me.householdId,
            );
            const [before] =
                await sql`select * from public.foods where id = ${mine.id}`;
            const res = await post("/recipes/import-shared", {
                shared: documentText(),
            });
            expect(res.status).toBe(303);
            const [after] =
                await sql`select * from public.foods where id = ${mine.id}`;
            expect(after).toEqual(before);
            expect(toastOf(res)).toBe(
                "Imported Lentil soup. 1 matched your foods, 1 added.",
            );
            expect(await foodNamesOf()).toEqual(["egg", "Red lentils"]);
        });

        test("the household is the session's, whatever the form says", async () => {
            const res = await post("/recipes/import-shared", {
                shared: documentText(),
                household_id: other.householdId,
                creator_id: other.userId,
            });
            expect(res.status).toBe(303);
            expect(await recipesOf(me)).toHaveLength(1);
            expect(await recipesOf(other)).toEqual([]);
            expect(await foodNamesOf(other)).toEqual([]);
        });

        test("a share link pasted into the link form goes to the same importer", async () => {
            const fetcher = serving(
                documentText({ name: "Via the link form" }),
            );
            setSharedRecipeFetcherForTests(fetcher);
            const res = await post("/recipes/import", { url: SHARE_PAGE });
            expect(res.status).toBe(303);
            expect(fetcher.calls).toEqual([SHARE_JSON]);
            const recipes = await recipesOf();
            expect(recipes.map((r) => r.name)).toEqual(["Via the link form"]);
            expect(res.headers.get("location")).toBe(
                `/recipes/${recipes[0]!.id}`,
            );
        });

        test("a share link that fails in the link form shows its reason in place", async () => {
            setSharedRecipeFetcherForTests(failing("not_found", 404));
            const res = await post("/recipes/import", { url: SHARE_PAGE });
            expect(res.status).toBe(422);
            const html = await res.text();
            expect(html).toContain("doesn't work any more");
            expect(await recipesOf()).toEqual([]);
        });

        type PasteCase = { fetcher: Stub | null; shared: string };
        const refusals: [string, () => PasteCase, RegExp][] = [
            [
                "text that is not a share link",
                () => ({ fetcher: null, shared: "pasta with garlic" }),
                /isn't a Foodable share link/,
            ],
            [
                "an http link",
                () => ({
                    fetcher: null,
                    shared: `http://kitchen.example/s/${TOKEN}`,
                }),
                /https/,
            ],
            [
                "a link to a private address",
                () => ({
                    fetcher: null,
                    shared: `https://169.254.169.254/s/${TOKEN}`,
                }),
                /can't import from that address/,
            ],
            [
                "an empty paste",
                () => ({ fetcher: null, shared: "   " }),
                /Paste a share link/,
            ],
            [
                "a link that cannot be reached",
                () => ({
                    fetcher: failing("network_error"),
                    shared: SHARE_PAGE,
                }),
                /Couldn't reach the other Foodable/,
            ],
            [
                "a link that times out",
                () => ({ fetcher: failing("timeout"), shared: SHARE_PAGE }),
                /didn't answer within 10 seconds/,
            ],
            [
                "a link that is gone",
                () => ({
                    fetcher: failing("not_found", 404),
                    shared: SHARE_PAGE,
                }),
                /revoked or expired/,
            ],
            [
                "a recipe that is too large",
                () => ({ fetcher: failing("too_large"), shared: SHARE_PAGE }),
                /too large/,
            ],
            [
                "a pasted document over 256 KB",
                () => ({
                    fetcher: null,
                    shared: documentText({ instructions: "x".repeat(300_000) }),
                }),
                /too large/,
            ],
            [
                "a link that is not JSON",
                () => ({
                    fetcher: failing("bad_content_type", 200),
                    shared: SHARE_PAGE,
                }),
                /didn't return a recipe/,
            ],
            [
                "JSON that is not a recipe",
                () => ({ fetcher: null, shared: '{"hello":"world"}' }),
                /isn't a Foodable recipe/,
            ],
            [
                "text that looks like JSON and is not",
                () => ({ fetcher: null, shared: "{not json" }),
                /isn't a Foodable recipe/,
            ],
            [
                "a version this deploy does not read",
                () => ({
                    fetcher: null,
                    shared: documentText({ version: 7 }),
                }),
                /version 7.*version 1/,
            ],
            // Postgres text cannot hold a NUL, and no other control character
            // belongs in a recipe: every text field refuses them, and the
            // paste is turned away like any other bad document.
            ...(
                [
                    ["a NUL in the name", { name: "So\u0000up" }, /name:/],
                    [
                        "a NUL in the instructions",
                        { instructions: "Stir\u0000 well" },
                        /instructions:/,
                    ],
                    ["a NUL in a tag", { tags: ["so\u0000up"] }, /tags\.0:/],
                    [
                        "a NUL in an ingredient name",
                        {
                            ingredients: lentils({
                                food_name: "Len\u0000tils",
                            }),
                        },
                        /ingredients\.0\.food_name:/,
                    ],
                    [
                        "a NUL in an ingredient unit",
                        { ingredients: lentils({ unit: "g\u0000" }) },
                        /ingredients\.0\.unit:/,
                    ],
                    [
                        "an escape character in the name",
                        { name: "So\u001bup" },
                        /name:/,
                    ],
                    [
                        "a bell character in the instructions",
                        { instructions: "Stir\u0007" },
                        /instructions:/,
                    ],
                ] as [string, Record<string, unknown>, RegExp][]
            ).map(([label, over, where]): [string, () => PasteCase, RegExp] => [
                label,
                () => ({ fetcher: null, shared: documentText(over) }),
                new RegExp(
                    `isn't a Foodable recipe\\.[^]*${where.source}[^]*control character`,
                ),
            ]),
        ];

        for (const [name, build, message] of refusals) {
            test(`${name} is refused in place with a clear message and writes nothing`, async () => {
                const { fetcher, shared } = build();
                if (fetcher) setSharedRecipeFetcherForTests(fetcher);
                else
                    setSharedRecipeFetcherForTests(
                        stubFetcher(() => {
                            throw new Error("no network expected");
                        }),
                    );
                const res = await post("/recipes/import-shared", { shared });
                expect(res.status).toBe(422);
                expect(res.headers.get("location")).toBeNull();
                const html = await res.text();
                // In place: the Recipes page with the import panel open.
                expect(html).toContain("fd-recipes-page");
                expect(html).toMatch(
                    /<details class="fd-recipes-import-link"[^>]*\sopen/,
                );
                const error =
                    /<p class="fd-recipes-import-error fd-recipes-import-shared-error" role="alert">([^<]*)<\/p>/.exec(
                        html,
                    );
                expect(error).not.toBeNull();
                expect(error![1]!.replaceAll("&#39;", "'")).toMatch(message);
                // What was pasted is still in the box (escaped).
                if (shared.trim() && shared.length < 1000) {
                    expect(html).toContain(
                        shared
                            .replaceAll("&", "&amp;")
                            .replaceAll("<", "&lt;")
                            .replaceAll('"', "&quot;"),
                    );
                }
                expect(await recipesOf()).toEqual([]);
                expect(await foodNamesOf()).toEqual([]);
                expect(res.headers.getSetCookie().join()).not.toContain(
                    "foodable_toast=",
                );
            });
        }

        test("a refused paste is echoed only while it is short", async () => {
            const huge = `{"name":"${"x".repeat(1_000_000)}`;
            const big = await post("/recipes/import-shared", { shared: huge });
            expect(big.status).toBe(422);
            const bigHtml = await big.text();
            expect(bigHtml).toContain("fd-recipes-page");
            expect(bigHtml.length).toBeLessThan(200_000);
            expect(bigHtml).not.toContain("xxxxxxxxxx");
            expect(bigHtml).toMatch(/fd-recipes-import-shared-error/);

            const short = `{"name":"${"y".repeat(2000)}`;
            const small = await post("/recipes/import-shared", {
                shared: short,
            });
            expect(small.status).toBe(422);
            expect(await small.text()).toContain(
                short.replaceAll('"', "&quot;"),
            );
        });

        test("a link to a private address never reaches the fetcher", async () => {
            const fetcher = serving(documentText());
            setSharedRecipeFetcherForTests(fetcher);
            for (const shared of [
                `https://127.0.0.1/s/${TOKEN}`,
                `https://localhost/s/${TOKEN}`,
                `https://10.0.0.5/s/${TOKEN}.json`,
                `http://kitchen.example/s/${TOKEN}`,
                "https://kitchen.example/other",
            ]) {
                const res = await post("/recipes/import-shared", { shared });
                expect(res.status).toBe(422);
            }
            expect(fetcher.calls).toEqual([]);
        });

        test("the link reader being switched off pauses links but not pasted JSON", async () => {
            setFlagsForTests(
                createMemoryFlags({
                    "ui-v2": true,
                    "recipe-link-reader": false,
                }),
            );
            const fetcher = serving(documentText());
            setSharedRecipeFetcherForTests(fetcher);
            const paused = await post("/recipes/import-shared", {
                shared: SHARE_PAGE,
            });
            expect(paused.status).toBe(422);
            expect(await paused.text()).toContain("Reading links is paused");
            expect(fetcher.calls).toEqual([]);
            const pasted = await post("/recipes/import-shared", {
                shared: documentText(),
            });
            expect(pasted.status).toBe(303);
        });

        test("ui-v2 off: the route does not exist and nothing is fetched or written", async () => {
            setFlagsForTests(
                createMemoryFlags({
                    "ui-v2": false,
                    "recipe-link-reader": true,
                }),
            );
            const fetcher = serving(documentText());
            setSharedRecipeFetcherForTests(fetcher);
            for (const shared of [documentText(), SHARE_PAGE]) {
                const res = await post("/recipes/import-shared", { shared });
                expect(res.status).toBe(404);
            }
            expect(fetcher.calls).toEqual([]);
            expect(await recipesOf()).toEqual([]);
            expect(await foodNamesOf()).toEqual([]);
        });

        test("ui-v2 off: a share link in the old link form is not routed to the importer", async () => {
            setFlagsForTests(
                // The reader is off too, so the old importer stays off the network.
                createMemoryFlags({
                    "ui-v2": false,
                    "recipe-link-reader": false,
                }),
            );
            const fetcher = serving(documentText());
            setSharedRecipeFetcherForTests(fetcher);
            const res = await post("/recipes/import", { url: SHARE_PAGE });
            expect(res.status).not.toBe(303);
            expect(fetcher.calls).toEqual([]);
            expect(await recipesOf()).toEqual([]);
        });

        test("no session: signed out, nothing fetched or written", async () => {
            const fetcher = serving(documentText());
            setSharedRecipeFetcherForTests(fetcher);
            const res = await app().request(
                "http://test/recipes/import-shared",
                {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                        shared: documentText(),
                    }).toString(),
                },
            );
            expect(res.status).not.toBe(303);
            expect(fetcher.calls).toEqual([]);
            expect(await recipesOf()).toEqual([]);
        });

        test("a signed-in user outside any household is refused", async () => {
            const [row] = await sql`
            insert into public.users (id, email)
            values (${crypto.randomUUID()}, ${`loner-${crypto.randomUUID()}@foodable.test`})
            returning id`;
            const res = await post(
                "/recipes/import-shared",
                { shared: documentText() },
                (row as { id: string }).id,
            );
            expect(res.status).toBe(403);
            expect(await recipesOf(me)).toEqual([]);
            expect(await recipesOf(other)).toEqual([]);
        });
    },
);
