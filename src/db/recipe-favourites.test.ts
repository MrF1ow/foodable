// recipe_favourites against real Postgres, as foodable_app: the cascades the
// migration promises and the per-member row level security. The store's own
// star/unstar behaviour is in the recipes store contract
// (household-stores.contract.test.ts), which runs the memory twin too.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { withActor } from "./actor.js";
import { liveRecipesStore } from "./recipes.js";
import { setSqlForTests } from "./sql.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { createRecipe } from "../domain/recipes.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

describeDb(pgAvailable !== null, "recipe favourites db", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let memberId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        ownerId = seeded.userId;
        memberId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${memberId}, ${`member-${memberId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    async function recipe(name: string): Promise<string> {
        const created = await createRecipe(liveRecipesStore(), {
            householdId,
            creatorId: ownerId,
            name,
            yieldPortions: 2,
        });
        return created.id;
    }

    async function favouriteCount(userId: string): Promise<number> {
        const { sql } = getCtx();
        const [row] = (await sql`
            select count(*)::int as n
            from public.recipe_favourites
            where user_id = ${userId}
        `) as { n: number }[];
        return row!.n;
    }

    test("removing a member from the household takes their favourites, not the owner's", async () => {
        const { sql } = getCtx();
        const store = liveRecipesStore();
        const soup = await recipe("Soup");
        await store.setFavourite(householdId, ownerId, soup, true);
        await asUser(
            memberId,
            () => store.setFavourite(householdId, memberId, soup, true),
            householdId,
        );
        expect(await favouriteCount(memberId)).toBe(1);

        await sql`
            delete from public.household_members
            where household_id = ${householdId} and user_id = ${memberId}
        `;
        expect(await favouriteCount(memberId)).toBe(0);
        expect(await favouriteCount(ownerId)).toBe(1);
    });

    test("deleting a member's login takes their favourites", async () => {
        const { sql } = getCtx();
        const store = liveRecipesStore();
        const soup = await recipe("Soup");
        await asUser(
            memberId,
            () => store.setFavourite(householdId, memberId, soup, true),
            householdId,
        );
        await sql`delete from public.users where id = ${memberId}`;
        expect(await favouriteCount(memberId)).toBe(0);
    });

    test("deleting a recipe takes every member's star on it", async () => {
        const store = liveRecipesStore();
        const soup = await recipe("Soup");
        await store.setFavourite(householdId, ownerId, soup, true);
        await asUser(
            memberId,
            () => store.setFavourite(householdId, memberId, soup, true),
            householdId,
        );
        expect(await store.deleteRecipe(householdId, soup)).toBe(true);
        expect(await favouriteCount(ownerId)).toBe(0);
        expect(await favouriteCount(memberId)).toBe(0);
    });

    test("a member cannot read or write another member's stars", async () => {
        const { sql } = getCtx();
        const store = liveRecipesStore();
        const soup = await recipe("Soup");
        await store.setFavourite(householdId, ownerId, soup, true);

        // Acting as the member, the owner's row is invisible and untouchable.
        await asUser(
            memberId,
            async () => {
                expect(
                    await store.listFavourites(householdId, ownerId),
                ).toEqual([]);
                // Un-starring "for the owner" matches no row the member can see.
                await store.setFavourite(householdId, ownerId, soup, false);
                // Starring for them is refused outright, even where the star exists.
                await expect(
                    store.setFavourite(householdId, ownerId, soup, true),
                ).rejects.toThrow();
            },
            householdId,
        );
        // The owner's star is still there, and nothing was added or removed.
        expect(await favouriteCount(ownerId)).toBe(1);
        const rows = (await sql`
            select user_id from public.recipe_favourites
        `) as { user_id: string }[];
        expect(rows.map((r) => r.user_id)).toEqual([ownerId]);
    });

    test("the household bot token has no stars of its own", async () => {
        const store = liveRecipesStore();
        const soup = await recipe("Soup");
        await store.setFavourite(householdId, ownerId, soup, true);
        const seen = await withActor({ kind: "household", householdId }, () =>
            store.listFavourites(householdId, ownerId),
        );
        expect(seen).toEqual([]);
    });
});
