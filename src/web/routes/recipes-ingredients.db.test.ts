// A recipe's ingredients edited from its page, against real Postgres: a
// draft's lines edited, added, removed, resolved from the import's unreadable
// lines and dropped; a saved recipe refusing an edit that would break its check.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "../../db/recipes.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { newFood } from "../../domain/foods.js";
import { setRecipeVariant } from "../../domain/recipe-variants.js";
import {
    importRecipeFromText,
    saveRecipeDraft,
    type RecipeIngredient,
} from "../../domain/recipes.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { recipesRoutes } from "./recipes.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

describeDb(
    pgAvailable !== null,
    "edit a recipe's ingredients in the app",
    (getCtx) => {
        let sql: SQL;
        let me: { userId: string; householdId: string };

        const app = () => new Hono().route("/", recipesRoutes);
        const as = <T>(fn: () => Promise<T>) =>
            asUser(me.userId, fn, me.householdId);

        beforeEach(async () => {
            const ctx = getCtx();
            sql = ctx.sql;
            await ctx.truncateAll();
            setSqlForTests(sql);
            me = await seedHousehold(sql);
        });

        afterEach(() => setSqlForTests(null));

        function post(path: string, fields: Record<string, string>) {
            return app().request(`http://test${path}`, {
                method: "POST",
                headers: {
                    cookie: `${SITE_COOKIE}=${mintSiteSession(me.userId)}`,
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams(fields).toString(),
            });
        }

        function get(path: string) {
            return app().request(`http://test${path}`, {
                headers: {
                    cookie: `${SITE_COOKIE}=${mintSiteSession(me.userId)}`,
                },
            });
        }

        async function food(name: string): Promise<string> {
            return as(
                async () =>
                    (
                        await liveFoodsStore().insertFood(
                            newFood({
                                householdId: me.householdId,
                                kind: "food",
                                name,
                            }),
                        )
                    ).id,
            );
        }

        /** An imported draft of one Leek line, with `lines` the parser could not read. */
        async function draft(lines: string[] = []) {
            const recipe = await as(
                async () =>
                    (
                        await importRecipeFromText(
                            liveRecipesStore(),
                            liveFoodsStore(),
                            {
                                householdId: me.householdId,
                                creatorId: me.userId,
                                text: "pasted",
                                instructions: "1. Simmer",
                                name: "Soup",
                                ingredients: [
                                    { name: "Leek", amount: 1, unit: "g" },
                                ],
                            },
                            { lookup: async () => null },
                        )
                    ).recipe,
            );
            if (lines.length > 0) {
                await as(async () => {
                    const row = (await liveRecipesStore().getImport(
                        me.householdId,
                        recipe.id,
                    ))!;
                    await liveRecipesStore().upsertImport({
                        ...row,
                        unresolvedLines: lines,
                    });
                });
            }
            return recipe;
        }

        const ingredientsOf = (recipeId: string): Promise<RecipeIngredient[]> =>
            as(() =>
                liveRecipesStore().listIngredients(me.householdId, recipeId),
            );

        const linesOf = (recipeId: string) =>
            as(
                async () =>
                    (
                        await liveRecipesStore().getImport(
                            me.householdId,
                            recipeId,
                        )
                    )?.unresolvedLines ?? [],
            );

        test("an ingredient's amount, unit and note are edited on a draft, and an amount of 0 is to taste", async () => {
            const recipe = await draft();
            const [leek] = await ingredientsOf(recipe.id);
            const res = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                {
                    amount: "3",
                    unit: "oz",
                    note: "sliced",
                    food_name: "Leek",
                },
            );
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(`/recipes/${recipe.id}`);
            expect((await ingredientsOf(recipe.id))[0]).toMatchObject({
                id: leek!.id,
                foodId: leek!.foodId,
                quantity: { amount: 3, unit: "oz" },
                note: "sliced",
            });
            const taste = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                { amount: "0", unit: "oz", note: "", food_name: "Leek" },
            );
            expect(taste.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[0]).toMatchObject({
                quantity: null,
                note: "to taste",
            });
        });

        test("naming another food on a line moves it to that food, keeping its place", async () => {
            const recipe = await draft();
            const [leek] = await ingredientsOf(recipe.id);
            const onion = await food("Onion");
            const res = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                {
                    amount: "2",
                    unit: "g",
                    note: "",
                    food_name: "Onion",
                },
            );
            expect(res.status).toBe(303);
            const [after] = await ingredientsOf(recipe.id);
            expect(after).toMatchObject({
                id: leek!.id,
                foodId: onion,
                displayName: "Onion",
                quantity: { amount: 2, unit: "g" },
            });
        });

        test("an ingredient is added by a food from the catalog", async () => {
            const recipe = await draft();
            const onion = await food("Onion");
            const res = await post(`/recipes/${recipe.id}/ingredients`, {
                food_id: onion,
                amount: "2",
                unit: "g",
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(`/recipes/${recipe.id}`);
            expect(await ingredientsOf(recipe.id)).toMatchObject([
                { displayName: "Leek" },
                {
                    displayName: "Onion",
                    foodId: onion,
                    quantity: { amount: 2, unit: "g" },
                },
            ]);
        });

        test("an ingredient is added by a new name, which makes the food", async () => {
            const recipe = await draft();
            const res = await post(`/recipes/${recipe.id}/ingredients`, {
                food_name: "Chives",
                amount: "",
                unit: "",
            });
            expect(res.status).toBe(303);
            const added = (await ingredientsOf(recipe.id))[1]!;
            expect(added).toMatchObject({
                displayName: "Chives",
                quantity: null,
                note: "to taste",
            });
            const names = await as(async () =>
                (await liveFoodsStore().listFoods(me.householdId)).map(
                    (f) => f.name,
                ),
            );
            expect(names).toContain("Chives");
        });

        test("a new name that looks like a food in the catalog asks which, writes nothing, and takes the pick or a new food", async () => {
            const recipe = await draft();
            const red = await food("Red onion");
            const asked = await post(`/recipes/${recipe.id}/ingredients`, {
                food_name: "Onion",
                amount: "1",
                unit: "g",
            });
            expect(asked.status).toBe(409);
            const html = await asked.text();
            expect(html).toContain("fd-did-you-mean-block");
            expect(html).toContain(`name="food_id" value="${red}"`);
            expect(html).toContain('name="new_food" value="1"');
            expect(html).toContain(`id="fd-recipe-add-ingredient"`);
            expect(html).toContain("data-sheet-open-on-load");
            expect(await ingredientsOf(recipe.id)).toHaveLength(1);
            // The pick adds that food.
            const picked = await post(`/recipes/${recipe.id}/ingredients`, {
                food_id: red,
                food_name: "Onion",
                amount: "1",
                unit: "g",
            });
            expect(picked.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[1]).toMatchObject({
                foodId: red,
            });
            // Confirming it is new makes the food.
            const created = await post(`/recipes/${recipe.id}/ingredients`, {
                food_name: "Onion",
                new_food: "1",
                amount: "1",
                unit: "g",
            });
            expect(created.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[2]).toMatchObject({
                displayName: "Onion",
            });
        });

        test("an ingredient is removed", async () => {
            const recipe = await draft();
            const onion = await food("Onion");
            await post(`/recipes/${recipe.id}/ingredients`, {
                food_id: onion,
                amount: "1",
                unit: "g",
            });
            const [leek, added] = await ingredientsOf(recipe.id);
            const res = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}/remove`,
                {},
            );
            expect(res.status).toBe(303);
            expect((await ingredientsOf(recipe.id)).map((r) => r.id)).toEqual([
                added!.id,
            ]);
            // The same remove again is the same answer.
            const again = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}/remove`,
                {},
            );
            expect(again.status).toBe(303);
        });

        test("an unreadable line is resolved: the ingredient is added, then the line is cleared", async () => {
            const recipe = await draft([
                "a splash of fish sauce",
                "1 lime, in wedges",
            ]);
            const res = await post(`/recipes/${recipe.id}/unresolved/resolve`, {
                line: "a splash of fish sauce",
                food_name: "Fish sauce",
                amount: "1",
                unit: "tbsp",
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(`/recipes/${recipe.id}`);
            expect(await ingredientsOf(recipe.id)).toMatchObject([
                { displayName: "Leek" },
                {
                    displayName: "Fish sauce",
                    quantity: { amount: 1, unit: "tbsp" },
                },
            ]);
            expect(await linesOf(recipe.id)).toEqual(["1 lime, in wedges"]);
            const page = await (await get(`/recipes/${recipe.id}`)).text();
            expect(page).toContain("1 lime, in wedges");
            expect(page).not.toContain("a splash of fish sauce");
        });

        test("a refused resolve keeps the line, shows the error in the line's sheet, and Drop is still there", async () => {
            const recipe = await draft(["a splash of fish sauce"]);
            const res = await post(`/recipes/${recipe.id}/unresolved/resolve`, {
                line: "a splash of fish sauce",
                food_name: "",
                amount: "1",
                unit: "tbsp",
            });
            expect(res.status).toBe(400);
            const html = await res.text();
            const sheet = html.match(
                /<dialog [^>]*id="fd-recipe-line-0"[\s\S]*?<\/dialog>/,
            )![0];
            expect(sheet).toContain("data-sheet-open-on-load");
            expect(sheet).toContain("Enter a food name.");
            expect(html).toContain(
                'action="/recipes/' + recipe.id + '/unresolved/drop"',
            );
            expect(await linesOf(recipe.id)).toEqual([
                "a splash of fish sauce",
            ]);
            expect(await ingredientsOf(recipe.id)).toHaveLength(1);
        });

        test("an unreadable line is dropped, and every other line stays", async () => {
            const recipe = await draft([
                "a splash of fish sauce",
                "1 lime, in wedges",
            ]);
            const res = await post(`/recipes/${recipe.id}/unresolved/drop`, {
                line: "a splash of fish sauce",
            });
            expect(res.status).toBe(303);
            expect(await linesOf(recipe.id)).toEqual(["1 lime, in wedges"]);
            expect(await ingredientsOf(recipe.id)).toHaveLength(1);
            // The check no longer asks about it, so Save is one line closer.
            const page = await (await get(`/recipes/${recipe.id}`)).text();
            expect(page).toContain("1 thing to fix");
            // A line already gone drops quietly.
            const again = await post(`/recipes/${recipe.id}/unresolved/drop`, {
                line: "a splash of fish sauce",
            });
            expect(again.status).toBe(303);
        });

        test("a draft fixed from the page can be saved from the page", async () => {
            const recipe = await draft(["a splash of fish sauce"]);
            const refused = await post(`/recipes/${recipe.id}/save`, {});
            expect(refused.status).toBe(422);
            await post(`/recipes/${recipe.id}/unresolved/resolve`, {
                line: "a splash of fish sauce",
                food_name: "Fish sauce",
                amount: "1",
                unit: "tbsp",
            });
            const saved = await post(`/recipes/${recipe.id}/save`, {});
            expect(saved.status).toBe(303);
            const after = await as(() =>
                liveRecipesStore().getRecipe(me.householdId, recipe.id),
            );
            expect(after?.verification).toBe("verified");
        });

        test("a saved recipe refuses a removal that would break its check, and the sheet reopens with what it would break", async () => {
            const recipe = await draft();
            await as(() =>
                saveRecipeDraft(liveRecipesStore(), me.householdId, recipe.id),
            );
            const [leek] = await ingredientsOf(recipe.id);
            // Taking out its last ingredient leaves a saved recipe with none.
            const removed = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}/remove`,
                {},
            );
            expect(removed.status).toBe(400);
            const html = await removed.text();
            const sheet = html.match(
                new RegExp(
                    `<dialog [^>]*id="fd-recipe-ing-${leek!.id}"[\\s\\S]*?</dialog>`,
                ),
            )![0];
            expect(sheet).toContain("data-sheet-open-on-load");
            expect(sheet).toContain(
                "That change would break this saved recipe",
            );
            expect(await ingredientsOf(recipe.id)).toEqual([leek!]);
            // An edit that adds no problem goes through.
            const fine = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                {
                    amount: "5",
                    unit: "g",
                    note: "",
                    food_name: "Leek",
                },
            );
            expect(fine.status).toBe(303);
        });

        test("0 is to taste whatever the note says: a draft keeps the note and adds to taste, so the check has no amount to ask for", async () => {
            const recipe = await draft();
            const [leek] = await ingredientsOf(recipe.id);
            const res = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                {
                    amount: "0",
                    unit: "g",
                    note: "finely chopped",
                    food_name: "Leek",
                },
            );
            expect(res.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[0]).toMatchObject({
                quantity: null,
                note: "finely chopped, to taste",
            });
            // The check has nothing left to ask for: the draft is ready to save.
            const page = await (await get(`/recipes/${recipe.id}`)).text();
            expect(page).toContain("Ready to save");
            const saved = await post(`/recipes/${recipe.id}/save`, {});
            expect(saved.status).toBe(303);
            // A note that already says it is not measured is left as it is.
            const again = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                { amount: "", unit: "g", note: "to taste", food_name: "Leek" },
            );
            expect(again.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[0]?.note).toBe("to taste");
        });

        test("0 is to taste on a saved recipe too: the note keeps its words, adds to taste, and the edit is not refused", async () => {
            const recipe = await draft();
            await as(() =>
                saveRecipeDraft(liveRecipesStore(), me.householdId, recipe.id),
            );
            const [leek] = await ingredientsOf(recipe.id);
            const res = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                {
                    amount: "0",
                    unit: "g",
                    note: "sliced",
                    food_name: "Leek",
                },
            );
            expect(res.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[0]).toMatchObject({
                quantity: null,
                note: "sliced, to taste",
            });
            // The same with the food swapped in one go: the saved check sees the final note.
            const onion = await food("Onion");
            const swapped = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}`,
                { amount: "0", unit: "g", note: "diced", food_name: "Onion" },
            );
            expect(swapped.status).toBe(303);
            expect((await ingredientsOf(recipe.id))[0]).toMatchObject({
                foodId: onion,
                quantity: null,
                note: "diced, to taste",
            });
        });

        test("an ingredient of another recipe, or that is not there, is not found", async () => {
            const recipe = await draft();
            const other = await draft();
            const [theirs] = await ingredientsOf(other.id);
            const wrong = await post(
                `/recipes/${recipe.id}/ingredients/${theirs!.id}`,
                { amount: "1", unit: "g", food_name: "Leek" },
            );
            expect(wrong.status).toBe(404);
            const nothing = await post(
                `/recipes/${recipe.id}/ingredients/${crypto.randomUUID()}`,
                { amount: "1", unit: "g", food_name: "Leek" },
            );
            expect(nothing.status).toBe(404);
            const nowhere = await post(
                `/recipes/${crypto.randomUUID()}/ingredients`,
                { food_name: "Chives" },
            );
            expect(nowhere.status).toBe(404);
        });

        test("the page's sheets open from its address, and an ingredient with no nutrition has a warning icon that opens its detail", async () => {
            const recipe = await draft();
            const [leek] = await ingredientsOf(recipe.id);
            const opened = await (
                await get(`/recipes/${recipe.id}?ingredient=${leek!.id}`)
            ).text();
            expect(opened).toMatch(
                new RegExp(
                    `<dialog [^>]*id="fd-recipe-ing-${leek!.id}"[^>]*data-sheet-open-on-load`,
                ),
            );
            const add = await (await get(`/recipes/${recipe.id}?add=1`)).text();
            expect(add).toMatch(
                /<dialog [^>]*id="fd-recipe-add-ingredient"[^>]*data-sheet-open-on-load/,
            );
            // An address naming no ingredient of this recipe opens nothing.
            const none = await (
                await get(
                    `/recipes/${recipe.id}?ingredient=${crypto.randomUUID()}`,
                )
            ).text();
            expect(none).not.toContain("data-sheet-open-on-load");
            // Leek has no nutrition: the icon is on its row, the detail names why,
            // and no list of warnings is under the tiles.
            const plain = await (await get(`/recipes/${recipe.id}`)).text();
            const row = plain
                .split('<li class="fd-item-row')
                .find((r) => r.includes('title="Leek"'))!;
            expect(row).toContain("fd-icon--warning");
            expect(row).toContain(`commandfor="fd-recipe-warn-${leek!.id}"`);
            expect(plain).toContain("Leek: no nutrition");
            expect(plain).not.toContain("fd-recipe-caption--warn");
        });

        /** A saved recipe of one Leek line that the viewer has their own version of. */
        async function savedWithMyVersion() {
            const recipe = await draft();
            await as(() =>
                saveRecipeDraft(liveRecipesStore(), me.householdId, recipe.id),
            );
            const [leek] = await ingredientsOf(recipe.id);
            await as(() =>
                setRecipeVariant(
                    liveRecipesStore(),
                    liveFoodsStore(),
                    liveRecipeVariantsStore(),
                    {
                        householdId: me.householdId,
                        recipeId: recipe.id,
                        userId: me.userId,
                        action: "amount",
                        ingredientId: leek!.id,
                        amount: 9,
                    },
                ),
            );
            return { recipe, leek: leek! };
        }

        const unescape = (html: string) => html.replaceAll("&amp;", "&");

        test("editing the base from ?member=base keeps that view: the rows, forms and menu carry it, a refusal reopens the sheet there, and a save lands back on it", async () => {
            const { recipe, leek } = await savedWithMyVersion();
            const base = await (
                await get(`/recipes/${recipe.id}?member=base`)
            ).text();
            expect(unescape(base)).toContain(
                `href="/recipes/${recipe.id}?ingredient=${leek.id}&member=base"`,
            );
            expect(unescape(base)).toContain(
                `href="/recipes/${recipe.id}?add=1&member=base"`,
            );
            const sheetOf = (html: string, id: string) =>
                html.match(
                    new RegExp(`<dialog [^>]*id="${id}"[\\s\\S]*?</dialog>`),
                )![0];
            const mine = sheetOf(base, `fd-recipe-ing-${leek.id}`);
            expect(mine).toContain(
                '<input type="hidden" name="member" value="base">',
            );
            expect(sheetOf(base, "fd-recipe-add-ingredient")).toContain(
                '<input type="hidden" name="member" value="base">',
            );
            expect(mine).toMatch(
                /<form class="fd-menu__form" method="post" action="[^"]*\/remove"><input type="hidden" name="member" value="base">/,
            );
            // The refused removal shows the sheet on the base, with its message.
            const refused = await post(
                `/recipes/${recipe.id}/ingredients/${leek.id}/remove`,
                { member: "base" },
            );
            expect(refused.status).toBe(400);
            const html = await refused.text();
            const open = sheetOf(html, `fd-recipe-ing-${leek.id}`);
            expect(open).toContain("data-sheet-open-on-load");
            expect(open).toContain("That change would break this saved recipe");
            expect(await ingredientsOf(recipe.id)).toEqual([leek]);
            // A typed edit that is refused keeps what was typed and the member view it was typed on.
            const kept = await post(
                `/recipes/${recipe.id}/ingredients/${leek.id}`,
                {
                    member: "base",
                    amount: "x",
                    unit: "g",
                    note: "sliced",
                    food_name: "Leek",
                },
            );
            expect(kept.status).toBe(400);
            const typed = sheetOf(
                await kept.text(),
                `fd-recipe-ing-${leek.id}`,
            );
            expect(typed).toContain('value="sliced"');
            expect(typed).toContain(
                '<input type="hidden" name="member" value="base">',
            );
            // A save lands back on the base's page, not on the viewer's version.
            const saved = await post(
                `/recipes/${recipe.id}/ingredients/${leek.id}`,
                {
                    member: "base",
                    amount: "5",
                    unit: "g",
                    note: "",
                    food_name: "Leek",
                },
            );
            expect(saved.status).toBe(303);
            expect(saved.headers.get("location")).toBe(
                `/recipes/${recipe.id}?member=base`,
            );
            // Without a member view the redirect is the plain page; a made-up one is no view.
            const plain = await post(
                `/recipes/${recipe.id}/ingredients/${leek.id}`,
                { amount: "5", unit: "g", note: "", food_name: "Leek" },
            );
            expect(plain.headers.get("location")).toBe(`/recipes/${recipe.id}`);
            const odd = await post(
                `/recipes/${recipe.id}/ingredients/${leek.id}`,
                {
                    member: '"><script>',
                    amount: "5",
                    unit: "g",
                    note: "",
                    food_name: "Leek",
                },
            );
            expect(odd.headers.get("location")).toBe(`/recipes/${recipe.id}`);
        });

        test("add, resolve, drop and remove all land back on the member view they were posted from", async () => {
            const recipe = await draft(["a splash of fish sauce", "a lime"]);
            const [leek] = await ingredientsOf(recipe.id);
            const here = `/recipes/${recipe.id}?member=base`;
            const added = await post(`/recipes/${recipe.id}/ingredients`, {
                member: "base",
                food_name: "Chives",
            });
            expect(added.headers.get("location")).toBe(here);
            const resolved = await post(
                `/recipes/${recipe.id}/unresolved/resolve`,
                {
                    member: "base",
                    line: "a splash of fish sauce",
                    food_name: "Fish sauce",
                    amount: "1",
                    unit: "tbsp",
                },
            );
            expect(resolved.headers.get("location")).toBe(here);
            const dropped = await post(
                `/recipes/${recipe.id}/unresolved/drop`,
                { member: "base", line: "a lime" },
            );
            expect(dropped.headers.get("location")).toBe(here);
            const removed = await post(
                `/recipes/${recipe.id}/ingredients/${leek!.id}/remove`,
                { member: "base" },
            );
            expect(removed.headers.get("location")).toBe(here);
            // A refused resolve reopens its sheet on the same view too.
            const refused = await post(
                `/recipes/${recipe.id}/unresolved/resolve`,
                { member: "base", line: "gone", food_name: "" },
            );
            expect(refused.status).toBe(400);
        });

        test("a refusal never goes unsaid: with the viewer's own version showing there is no sheet, so the page says it", async () => {
            const { recipe, leek } = await savedWithMyVersion();
            const refused = await post(
                `/recipes/${recipe.id}/ingredients/${leek.id}/remove`,
                {},
            );
            expect(refused.status).toBe(400);
            const html = await refused.text();
            expect(html).not.toContain(`id="fd-recipe-ing-${leek.id}"`);
            expect(html).toMatch(
                /<p class="fd-recipe-error" role="alert">That change would break this saved recipe/,
            );
            // A similar-foods question with no sheet to ask it in says so as well.
            await food("Red onion");
            const asked = await post(`/recipes/${recipe.id}/ingredients`, {
                food_name: "Onion",
                amount: "1",
                unit: "g",
            });
            expect(asked.status).toBe(409);
            expect(await asked.text()).toMatch(
                /<p class="fd-recipe-error" role="alert">That name looks like a food you already have/,
            );
        });

        test("a warning's food link opens the food's own edit sheet: a usual's on Usuals, any other food's on Saved foods", async () => {
            const recipe = await draft();
            const [leek] = await ingredientsOf(recipe.id);
            const warn = (html: string) =>
                html.match(
                    new RegExp(
                        `<dialog [^>]*id="fd-recipe-warn-${leek!.id}"[\\s\\S]*?</dialog>`,
                    ),
                )![0];
            const plain = warn(
                await (await get(`/recipes/${recipe.id}`)).text(),
            );
            expect(plain).toContain(
                `href="/settings/saved?food=${leek!.foodId}"`,
            );
            expect(plain).not.toContain("/kitchen/usuals/");
            await getCtx().sql`
                update public.foods set usual_added_at = now()
                where id = ${leek!.foodId}
            `;
            const usual = warn(
                await (await get(`/recipes/${recipe.id}`)).text(),
            );
            expect(usual).toContain(`href="/kitchen/usuals/${leek!.foodId}"`);
            expect(usual).not.toContain("/settings/saved");
        });

        test("another household's recipe or ingredient is never read or written: edit, remove, add, resolve and drop are not found", async () => {
            const mine = await draft();
            const [myLeek] = await ingredientsOf(mine.id);
            const theirs = await seedHousehold(sql);
            const asThem = <T>(fn: () => Promise<T>) =>
                asUser(theirs.userId, fn, theirs.householdId);
            const theirRecipe = await asThem(
                async () =>
                    (
                        await importRecipeFromText(
                            liveRecipesStore(),
                            liveFoodsStore(),
                            {
                                householdId: theirs.householdId,
                                creatorId: theirs.userId,
                                text: "pasted",
                                instructions: "1. Simmer",
                                name: "Their soup",
                                ingredients: [
                                    { name: "Kale", amount: 2, unit: "g" },
                                ],
                            },
                            { lookup: async () => null },
                        )
                    ).recipe,
            );
            await asThem(async () => {
                const row = (await liveRecipesStore().getImport(
                    theirs.householdId,
                    theirRecipe.id,
                ))!;
                await liveRecipesStore().upsertImport({
                    ...row,
                    unresolvedLines: ["a secret line"],
                });
            });
            const [kale] = await asThem(() =>
                liveRecipesStore().listIngredients(
                    theirs.householdId,
                    theirRecipe.id,
                ),
            );
            const edit = await post(
                `/recipes/${theirRecipe.id}/ingredients/${kale!.id}`,
                { amount: "9", unit: "g", note: "mine now", food_name: "Kale" },
            );
            expect(edit.status).toBe(404);
            const remove = await post(
                `/recipes/${theirRecipe.id}/ingredients/${kale!.id}/remove`,
                {},
            );
            expect(remove.status).toBe(404);
            const add = await post(`/recipes/${theirRecipe.id}/ingredients`, {
                food_name: "Chives",
            });
            expect(add.status).toBe(404);
            const resolve = await post(
                `/recipes/${theirRecipe.id}/unresolved/resolve`,
                {
                    line: "a secret line",
                    food_name: "Fish sauce",
                    amount: "1",
                    unit: "tbsp",
                },
            );
            expect(resolve.status).toBe(404);
            const drop = await post(
                `/recipes/${theirRecipe.id}/unresolved/drop`,
                { line: "a secret line" },
            );
            expect(drop.status).toBe(404);
            // Their ingredient posted to my recipe is not mine to touch either.
            const mixed = await post(
                `/recipes/${mine.id}/ingredients/${kale!.id}`,
                { amount: "9", unit: "g", food_name: "Kale" },
            );
            expect(mixed.status).toBe(404);
            const mixedRemove = await post(
                `/recipes/${mine.id}/ingredients/${kale!.id}/remove`,
                {},
            );
            // Already gone as far as this household can tell, and nothing was removed.
            expect(mixedRemove.status).toBe(303);
            // Nothing of theirs changed, and mine is as it was.
            const after = await asThem(async () => ({
                ingredients: await liveRecipesStore().listIngredients(
                    theirs.householdId,
                    theirRecipe.id,
                ),
                lines:
                    (
                        await liveRecipesStore().getImport(
                            theirs.householdId,
                            theirRecipe.id,
                        )
                    )?.unresolvedLines ?? [],
            }));
            expect(after.ingredients).toEqual([kale!]);
            expect(after.lines).toEqual(["a secret line"]);
            expect(await ingredientsOf(mine.id)).toEqual([myLeek!]);
        });

        test("a version with changes keeps its own lines: no Add ingredient and no edit sheets, while the base is editable", async () => {
            const recipe = await draft();
            await as(() =>
                saveRecipeDraft(liveRecipesStore(), me.householdId, recipe.id),
            );
            const [leek] = await ingredientsOf(recipe.id);
            await as(() =>
                setRecipeVariant(
                    liveRecipesStore(),
                    liveFoodsStore(),
                    liveRecipeVariantsStore(),
                    {
                        householdId: me.householdId,
                        recipeId: recipe.id,
                        userId: me.userId,
                        action: "amount",
                        ingredientId: leek!.id,
                        amount: 9,
                    },
                ),
            );
            const mine = await (await get(`/recipes/${recipe.id}`)).text();
            expect(mine).not.toContain(">Add ingredient<");
            expect(mine).not.toContain(`id="fd-recipe-ing-${leek!.id}"`);
            expect(mine).toContain(`Actions for Leek`);
            const base = await (
                await get(`/recipes/${recipe.id}?member=base`)
            ).text();
            expect(base).toContain(">Add ingredient<");
            expect(base).toContain(`id="fd-recipe-ing-${leek!.id}"`);
        });
    },
);
