import { afterEach, beforeEach, describe } from "bun:test";
import { createMemoryPlansStore } from "../domain/plan.js";
import { setFallbackActorForTests } from "./actor.js";
import { runPlansStoreContract } from "./contract/plans.contract.js";
import type { StoreContractCtx } from "./contract/helpers.js";
import { liveRecipePlansStore } from "./plans.js";
import { setSqlForTests } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

describe("recipe plans store (memory)", () => {
    let ctx: StoreContractCtx;
    let known: Set<string>;

    beforeEach(() => {
        known = new Set();
        ctx = {
            householdId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
        };
    });

    runPlansStoreContract(
        "memory",
        () => ({
            store: createMemoryPlansStore({
                recipeInHousehold: (householdId, recipeId) =>
                    known.has(`${householdId}|${recipeId}`),
            }),
            newRecipe: async (householdId = ctx.householdId) => {
                const id = crypto.randomUUID();
                known.add(`${householdId}|${id}`);
                return id;
            },
        }),
        async () => {},
        () => ctx,
    );
});

describeDb(pgAvailable !== null, "recipe plans store (live)", (getCtx) => {
    let ctx: StoreContractCtx;

    afterEach(() => {
        setSqlForTests(null);
        setFallbackActorForTests(null);
    });

    async function reseed(): Promise<void> {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const primary = await seedHousehold(sql);
        const other = await seedHousehold(sql);
        // Two households exist; pin the actor so it is not a coin flip.
        setFallbackActorForTests({
            kind: "user",
            userId: primary.userId,
            householdId: primary.householdId,
        });
        ctx = {
            householdId: primary.householdId,
            userId: primary.userId,
            otherHouseholdId: other.householdId,
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
            sql,
        };
    }

    beforeEach(reseed);

    runPlansStoreContract(
        "live",
        () => ({
            store: liveRecipePlansStore(),
            newRecipe: async (householdId = ctx.householdId) => {
                const id = crypto.randomUUID();
                await getCtx().sql`
                    insert into public.recipes (
                        id, household_id, creator_id, name, yield_portions
                    )
                    values (${id}, ${householdId}, ${ctx.userId}, ${"Soup"}, ${2})
                `;
                return id;
            },
        }),
        reseed,
        () => ctx,
    );
});
