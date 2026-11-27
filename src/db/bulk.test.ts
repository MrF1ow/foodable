import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { createRecipe, RecipeForbiddenError } from "../domain/recipes.js";
import { bulkDeleteSavedItems, bulkLockKey } from "./bulk.js";
import { liveRecipesStore } from "./recipes.js";
import { setSqlForTests } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { raceOnUniqueKey } from "./testing/lock-race.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "bulk actions db", (getCtx) => {
    let sql: SQL;
    let householdId: string;
    let userId: string;

    beforeEach(async () => {
        const ctx = getCtx();
        await ctx.truncateAll();
        sql = ctx.sql;
        setSqlForTests(sql);
        ({ householdId, userId } = await seedHousehold(sql));
    });

    afterEach(() => setSqlForTests(null));

    async function seedSaved() {
        const oats = await seedFood(sql, householdId, { name: "Oats" });
        const recipes = liveRecipesStore();
        const mine = await createRecipe(recipes, {
            householdId,
            creatorId: userId,
            name: "Porridge",
            yieldPortions: 2,
        });
        const peer = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${peer}, ${`peer-${peer}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${peer}, ${"member"}, ${"Peer"})
        `;
        const theirs = await createRecipe(recipes, {
            householdId,
            creatorId: peer,
            name: "Paella",
            yieldPortions: 4,
        });
        return { oats, mine: mine.id, theirs: theirs.id, peer };
    }

    const recipeCount = async () =>
        Number(
            (
                await sql`
                    select count(*)::int as n from public.recipes
                    where household_id = ${householdId}
                `
            )[0].n,
        );

    const archived = async (id: string) =>
        (await sql`select archived_at from public.foods where id = ${id}`)[0]
            .archived_at !== null;

    test("saved items: foods are archived, recipes deleted, and a repeat is done", async () => {
        const { oats, mine, theirs } = await seedSaved();
        const input = {
            householdId,
            foodIds: [oats],
            recipeIds: [mine, theirs],
            actor: { userId, isOwner: true },
        };
        expect(await bulkDeleteSavedItems(input)).toEqual({
            status: "applied",
            count: 3,
        });
        expect(await archived(oats)).toBe(true);
        expect(await recipeCount()).toBe(0);
        expect(await bulkDeleteSavedItems(input)).toEqual({
            status: "already",
            count: 0,
        });
    });

    test("saved items: a recipe the member cannot delete stops the whole batch", async () => {
        const { oats, mine, theirs, peer } = await seedSaved();
        await expect(
            bulkDeleteSavedItems({
                householdId,
                foodIds: [oats],
                recipeIds: [mine, theirs],
                actor: { userId: peer, isOwner: false },
            }),
        ).rejects.toBeInstanceOf(RecipeForbiddenError);
        expect(await archived(oats)).toBe(false);
        expect(await recipeCount()).toBe(2);
    });

    test("saved items: two deletes of the same items at once delete them once", async () => {
        const { pg, sql: owner } = getCtx();
        const { oats, mine } = await seedSaved();
        const key = bulkLockKey(householdId, "saved-delete");
        // The holder takes the batch's lock first, so both submits queue
        // behind it and then run one after the other.
        const [a, b] = await raceOnUniqueKey({
            url: pg.url,
            restoreSql: owner,
            blockInsert: (tx) =>
                tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
            run: () =>
                bulkDeleteSavedItems({
                    householdId,
                    foodIds: [oats],
                    recipeIds: [mine],
                    actor: { userId, isOwner: true },
                }),
        });
        expect([a.status, b.status].sort()).toEqual(["already", "applied"]);
        expect(await archived(oats)).toBe(true);
    });
});
