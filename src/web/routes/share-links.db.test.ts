// The public share page against real Postgres, driven the way a visitor
// reaches it: no actor of its own, so the route has to bring the household
// scope it needs, and a code path that forgot to would throw here.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { Hono } from "hono";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveShareLinkStore } from "../../db/share-links.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedFood, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { createRecipe } from "../../domain/recipes.js";
import {
    createShareLink,
    hashToken,
    mintShareToken,
    revokeShareLink,
} from "../../domain/sharing.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import {
    createMemoryRateLimitStore,
    setRateLimitStore,
} from "../../rate-limit.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { createShareLinksRoutes } from "./share-links.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests skipped: no initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

const NOW = new Date();

// Strings that must never reach a visitor, each distinctive enough that a hit
// anywhere in the HTML is a leak.
const SECRET = {
    memberName: "Zorblax Quillfeather",
    email: "zorblax.quillfeather@leak-check.test",
    household: "Quillfeather Household Secret",
    recipeNotes: "NOTES-7731-do-not-share",
    sourceUrl: "https://secret-source.leak-check.test/recipe",
    lineNote: "LINENOTE-4419-do-not-share",
};

describeDb(
    pgAvailable !== null,
    "public share page",
    (getCtx) => {
        let sql: SQL;
        let householdId: string;
        let ownerId: string;
        let otherHouseholdId: string;
        let otherOwnerId: string;

        beforeEach(async () => {
            const ctx = getCtx();
            sql = ctx.sql;
            await ctx.truncateAll();
            setSqlForTests(sql);
            setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
            setRateLimitStore(createMemoryRateLimitStore());
            const a = await seedHousehold(sql);
            householdId = a.householdId;
            ownerId = a.userId;
            const b = await seedHousehold(sql);
            otherHouseholdId = b.householdId;
            otherOwnerId = b.userId;
            await sql`update public.users set email = ${SECRET.email} where id = ${ownerId}`;
            await sql`update public.households set name = ${SECRET.household} where id = ${householdId}`;
            await sql`update public.household_members set display_name = ${SECRET.memberName} where user_id = ${ownerId}`;
        });

        afterEach(() => {
            setSqlForTests(null);
            resetFlagsForTests();
        });

        const links = liveShareLinkStore();
        const recipes = liveRecipesStore();
        const groceries = liveGroceryStore();
        const app = () => new Hono().route("/", createShareLinksRoutes());

        async function seedRecipe(
            hh: string,
            by: string,
            name: string,
            notes: string | null = null,
        ) {
            const recipe = await asUser(
                by,
                () =>
                    createRecipe(recipes, {
                        householdId: hh,
                        creatorId: by,
                        name,
                        yieldPortions: 4,
                        instructions: "1. Rinse.\n2. Simmer.",
                        tags: ["dinner"],
                        notes,
                        sourceUrl: SECRET.sourceUrl,
                    }),
                hh,
            );
            const foodId = await seedFood(sql, hh, { name: `${name} lentils` });
            const ingredient = {
                id: crypto.randomUUID(),
                householdId: hh,
                recipeId: recipe.id,
                kind: "food" as const,
                displayName: "Red lentils",
                quantity: { amount: 300, unit: "g" },
                foodId,
                sortOrder: 0,
                note: null,
            };
            await asUser(by, () => recipes.insertIngredient(ingredient), hh);
            return { recipe, foodId };
        }

        async function mint(
            hh: string,
            by: string,
            kind: "recipe" | "grocery_list",
            targetId: string | null,
        ) {
            return asUser(
                by,
                () =>
                    createShareLink(
                        links,
                        {
                            householdId: hh,
                            kind,
                            targetId,
                            createdBy: by,
                        },
                        NOW,
                        recipes,
                    ),
                hh,
            );
        }

        test("a live recipe token shows the recipe", async () => {
            const { recipe } = await seedRecipe(
                householdId,
                ownerId,
                "Lentil soup",
            );
            const { token } = await mint(
                householdId,
                ownerId,
                "recipe",
                recipe.id,
            );
            const res = await app().request(`/s/${token}`);
            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain("Lentil soup");
            expect(html).toContain("Red lentils");
            expect(html).toContain("300 g");
            expect(html).toContain("Rinse.");
            expect(html).toContain("dinner");
            expect(html).toContain("4 servings");
        });

        async function seedGroceryList() {
            // Two stores whose sort order is the reverse of their insert order,
            // sections likewise, and lines inserted against aisle order.
            const marketId = crypto.randomUUID();
            const cornerId = crypto.randomUUID();
            await sql`insert into public.grocery_stores (id, household_id, name, sort_order) values (${marketId}, ${householdId}, ${"Market"}, ${1}), (${cornerId}, ${householdId}, ${"Corner Shop"}, ${0})`;
            const dairy = crypto.randomUUID();
            const produce = crypto.randomUUID();
            await sql`insert into public.grocery_sections (id, household_id, store_id, name, sort_order, hidden, is_other) values (${dairy}, ${householdId}, ${cornerId}, ${"Dairy"}, ${1}, ${false}, ${false}), (${produce}, ${householdId}, ${cornerId}, ${"Produce"}, ${0}, ${false}, ${false})`;
            const marketSection = crypto.randomUUID();
            await sql`insert into public.grocery_sections (id, household_id, store_id, name, sort_order, hidden, is_other) values (${marketSection}, ${householdId}, ${marketId}, ${"Aisle"}, ${0}, ${false}, ${false})`;
            const add = async (
                displayName: string,
                storeId: string,
                sectionId: string,
                amount: number,
                unit: string,
                checked = false,
            ) => {
                const foodId = await seedFood(sql, householdId, {
                    name: `${displayName} food`,
                });
                await asUser(
                    ownerId,
                    () =>
                        groceries.insertLine({
                            id: crypto.randomUUID(),
                            householdId,
                            storeId,
                            sectionId,
                            kind: "food",
                            displayName,
                            quantity: { amount, unit },
                            foodId,
                            checked,
                            source: "manual",
                            sourceFridgeItemId: null,
                            note: SECRET.lineNote,
                        }),
                    householdId,
                );
                return foodId;
            };
            const foodIds = [
                await add("Rice", marketId, marketSection, 1, "kg"),
                await add("Milk", cornerId, dairy, 2, "l"),
                await add("Leeks", cornerId, produce, 3, "each", true),
            ];
            return { foodIds };
        }

        test("a grocery token shows the lines grouped by store, in the app's order", async () => {
            await seedGroceryList();
            const { token } = await mint(
                householdId,
                ownerId,
                "grocery_list",
                null,
            );
            const res = await app().request(`/s/${token}`);
            expect(res.status).toBe(200);
            const html = await res.text();
            const at = (s: string) => html.indexOf(s);
            // Corner Shop (sort 0) before Market (sort 1); within the corner
            // shop, Produce's Leeks before Dairy's Milk, though Milk was
            // inserted first.
            expect(at("Corner Shop")).toBeGreaterThan(-1);
            expect(at("Corner Shop")).toBeLessThan(at("Leeks"));
            expect(at("Leeks")).toBeLessThan(at("Milk"));
            expect(at("Milk")).toBeLessThan(at("Market"));
            expect(at("Market")).toBeLessThan(at("Rice"));
            expect(html).toContain("fd-share-line--checked");
        });

        test("the page carries nothing of the household's people, ids or notes", async () => {
            const { recipe, foodId } = await seedRecipe(
                householdId,
                ownerId,
                "Lentil soup",
                SECRET.recipeNotes,
            );
            const { foodIds } = await seedGroceryList();
            const tokens = [
                (await mint(householdId, ownerId, "recipe", recipe.id)).token,
                (await mint(householdId, ownerId, "grocery_list", null)).token,
            ];
            const ids = [
                householdId,
                ownerId,
                otherHouseholdId,
                otherOwnerId,
                recipe.id,
                foodId,
                ...foodIds,
            ];
            for (const token of tokens) {
                const res = await app().request(`/s/${token}`);
                expect(res.status).toBe(200);
                const html = await res.text();
                for (const secret of [
                    ...Object.values(SECRET),
                    ...ids,
                    "test-" + ownerId,
                ]) {
                    expect(html).not.toContain(secret);
                }
                // and not the token itself either
                expect(html).not.toContain(token);
            }
        });

        test("a signed-in member of another household sees the same page and none of their own data", async () => {
            const mine = await seedRecipe(
                otherHouseholdId,
                otherOwnerId,
                "VIEWER-ONLY-RECIPE",
            );
            await sql`update public.household_members set display_name = ${"VIEWER-DISPLAY-NAME"} where user_id = ${otherOwnerId}`;
            const { recipe } = await seedRecipe(
                householdId,
                ownerId,
                "Lentil soup",
            );
            const { token } = await mint(
                householdId,
                ownerId,
                "recipe",
                recipe.id,
            );
            const bare = await app().request(`/s/${token}`);
            const cookie = `${SITE_COOKIE}=${mintSiteSession(otherOwnerId)}`;
            const signedIn = await app().request(`/s/${token}`, {
                headers: { cookie },
            });
            expect(signedIn.status).toBe(200);
            const html = await signedIn.text();
            expect(html).toBe(await bare.text());
            for (const mine_ of [
                "VIEWER-ONLY-RECIPE",
                "VIEWER-DISPLAY-NAME",
                mine.recipe.id,
                otherOwnerId,
                otherHouseholdId,
            ]) {
                expect(html).not.toContain(mine_);
            }
            expect(html).not.toContain("toast");
            expect(html).not.toContain("/logout");
        });

        test("a link cannot be pointed at another household's recipe", async () => {
            const theirs = await seedRecipe(
                otherHouseholdId,
                otherOwnerId,
                "Secret stew",
            );
            const token = mintShareToken();
            await sql`
                insert into public.share_links (
                    household_id, kind, target_id, token_hash, created_by
                )
                values (
                    ${householdId}, ${"recipe"}, ${theirs.recipe.id},
                    ${hashToken(token)}, ${ownerId}
                )
            `;
            const res = await app().request(`/s/${token}`);
            expect(res.status).toBe(404);
            expect(await res.text()).toBe("Not found");
        });

        test("revoked, expired, unknown, malformed, deleted-recipe and flag-off give byte-identical 404s", async () => {
            const { recipe } = await seedRecipe(
                householdId,
                ownerId,
                "Lentil soup",
            );
            const revoked = await mint(
                householdId,
                ownerId,
                "recipe",
                recipe.id,
            );
            await asUser(
                ownerId,
                () => revokeShareLink(links, householdId, revoked.link.id, NOW),
                householdId,
            );
            const expired = await mint(
                householdId,
                ownerId,
                "recipe",
                recipe.id,
            );
            await sql`update public.share_links set expires_at = now() - interval '1 hour' where id = ${expired.link.id}`;
            const deleted = await seedRecipe(householdId, ownerId, "Gone soon");
            const orphaned = await mint(
                householdId,
                ownerId,
                "recipe",
                deleted.recipe.id,
            );
            await sql`delete from public.recipes where id = ${deleted.recipe.id}`;
            const live = await mint(householdId, ownerId, "recipe", recipe.id);

            const shoot = async (path: string) => {
                const res = await app().request(path);
                return {
                    status: res.status,
                    body: await res.text(),
                    headers: [...res.headers.entries()].sort(([a], [b]) =>
                        a.localeCompare(b),
                    ),
                };
            };
            const refusals = [
                await shoot(`/s/${revoked.token}`),
                await shoot(`/s/${expired.token}`),
                await shoot(`/s/${orphaned.token}`),
                await shoot(`/s/${mintShareToken()}`),
                await shoot("/s/not-a-token"),
            ];
            setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
            refusals.push(await shoot(`/s/${live.token}`));
            for (const refusal of refusals) {
                expect(refusal.status).toBe(404);
                expect(refusal).toEqual(refusals[0]!);
            }
            expect(refusals[0]!.body).toBe("Not found");
            const names = refusals[0]!.headers.map(([n]) => n);
            expect(names).toContain("x-robots-tag");
            expect(names).toContain("referrer-policy");
            expect(names).toContain("cache-control");
        });

        test("ui-v2 is judged for the member who made the link", async () => {
            const { recipe } = await seedRecipe(
                householdId,
                ownerId,
                "Lentil soup",
            );
            const { token } = await mint(
                householdId,
                ownerId,
                "recipe",
                recipe.id,
            );
            // On for the creator only: the link answers.
            setFlagsForTests(
                createMemoryFlags({ "ui-v2": (ctx) => ctx.key === ownerId }),
            );
            expect((await app().request(`/s/${token}`)).status).toBe(200);
            // On for everyone else: the creator's flag is what counts.
            setFlagsForTests(
                createMemoryFlags({ "ui-v2": (ctx) => ctx.key !== ownerId }),
            );
            expect((await app().request(`/s/${token}`)).status).toBe(404);
        });
    },
    { actor: null },
);
