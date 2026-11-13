import { afterEach, expect, test } from "bun:test";
import type { GroceryLine } from "../domain/grocery.js";
import type { HouseholdConfig } from "../household.js";
import { runRestockCheck } from "../domain/restock.js";
import { liveRestockStore } from "./restock.js";
import { liveGroceryStore } from "./grocery.js";
import { getHouseholdConfig, updateHouseholdConfig } from "./household.js";
import { currentActor, setFallbackActorForTests, type Actor } from "./actor.js";
import { describeDb, householdOwnerActor } from "./testing/pg.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import { liveRestockCheckDeps } from "../restock-runner.js";

const pgAvailable = await findPgBin();

function sampleLine(
    householdId: string,
    storeId: string,
    sectionId: string,
    foodId: string,
): GroceryLine {
    return {
        id: crypto.randomUUID(),
        householdId,
        storeId,
        sectionId,
        kind: "food",
        displayName: "Milk",
        quantity: { amount: 1, unit: "l" },
        foodId,
        checked: false,
        source: "restock",
        sourceFridgeItemId: null,
        note: null,
    };
}

describeDb(pgAvailable !== null, "restock commit (live)", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("commitRestockRun writes lines and lastRunOn together", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const runOn = "2026-06-07";
        const store = liveRestockStore();
        const line = sampleLine(householdId, storeId, sectionId, foodId);
        const ok = await store.commitRestockRun(householdId, runOn, [line]);
        expect(ok).toBe(true);
        const config = await getHouseholdConfig(householdId);
        expect(config.preferences.restock.lastRunOn).toBe(runOn);
        const lines = await sql`
            select id, source from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(1);
        expect(lines[0]!.source).toBe("restock");
    });

    test("forced FK failure writes neither", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const runOn = "2026-06-08";
        const store = liveRestockStore();
        const bad = sampleLine(
            householdId,
            crypto.randomUUID(),
            sectionId,
            foodId,
        );
        await expect(
            store.commitRestockRun(householdId, runOn, [bad]),
        ).rejects.toThrow();
        const config = await getHouseholdConfig(householdId);
        expect(config.preferences.restock.lastRunOn).toBeNull();
        const lines = await sql`
            select id from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(0);
    });

    test("second commit same date returns false", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const runOn = "2026-06-09";
        const restock = liveRestockStore();
        const line = sampleLine(householdId, storeId, sectionId, foodId);
        expect(await restock.commitRestockRun(householdId, runOn, [line])).toBe(
            true,
        );
        const second = sampleLine(householdId, storeId, sectionId, foodId);
        expect(
            await restock.commitRestockRun(householdId, runOn, [second]),
        ).toBe(false);
        const lines = await sql`
            select id from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(1);
    });

    test("concurrent commits same date insert lines once", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const runOn = "2026-06-10";
        const restock = liveRestockStore();
        const [a, b] = await Promise.all([
            restock.commitRestockRun(householdId, runOn, [
                sampleLine(householdId, storeId, sectionId, foodId),
            ]),
            restock.commitRestockRun(householdId, runOn, [
                sampleLine(householdId, storeId, sectionId, foodId),
            ]),
        ]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        const lines = await sql`
            select id from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(1);
    });

    test("a run does not double a line a card added after its read", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const family = { familyId: foodId, foodIds: [foodId] };
        const cardLine = sampleLine(householdId, storeId, sectionId, foodId);
        await liveGroceryStore().insertLine(cardLine);
        const runLine = sampleLine(householdId, storeId, sectionId, foodId);
        expect(
            await liveRestockStore().commitRestockRun(
                householdId,
                "2026-06-12",
                [runLine],
                new Map([[runLine.id, family]]),
            ),
        ).toBe(true);
        const lines = await sql`
            select id from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toEqual([{ id: cardLine.id }]);
        const config = await getHouseholdConfig(householdId);
        expect(config.preferences.restock.lastRunOn).toBe("2026-06-12");
    });

    test("a card add and the restock run racing leave one line", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const family = { familyId: foodId, foodIds: [foodId] };
        const runLine = sampleLine(householdId, storeId, sectionId, foodId);
        const cardLine = sampleLine(householdId, storeId, sectionId, foodId);
        const [committed, card] = await Promise.all([
            liveRestockStore().commitRestockRun(
                householdId,
                "2026-06-12",
                [runLine],
                new Map([[runLine.id, family]]),
            ),
            liveGroceryStore().insertLineUnlessListed(cardLine, family),
        ]);
        expect(committed).toBe(true);
        const lines = await sql`
            select id from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(1);
        // Whichever landed second saw the first and folded into it.
        const survivor = lines[0] as { id: string };
        expect([runLine.id, cardLine.id]).toContain(survivor.id);
        expect(card.line.id).toBe(survivor.id);
    });

    test("updateHouseholdConfig keeps stored lastRunOn", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const sectionId = await seedGrocerySection(
            sql,
            householdId,
            storeId,
            "Dairy",
        );
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const runOn = "2026-06-11";
        await liveRestockStore().commitRestockRun(householdId, runOn, [
            sampleLine(householdId, storeId, sectionId, foodId),
        ]);
        const before = await getHouseholdConfig(householdId);
        expect(before.preferences.restock.lastRunOn).toBe(runOn);
        const patch: HouseholdConfig = {
            ...before,
            preferences: {
                ...before.preferences,
                restock: {
                    ...before.preferences.restock,
                    lastRunOn: "2020-01-01",
                    enabled: true,
                },
            },
        };
        const updated = await updateHouseholdConfig(householdId, {
            name: before.name,
            recipeSearchPlaces: before.recipeSearchPlaces,
            preferences: patch.preferences,
        });
        expect(updated.preferences.restock.lastRunOn).toBe(runOn);
    });

    test("runRestockCheck live deps inserts restock line when due", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const otherId = crypto.randomUUID();
        await sql`
            insert into public.grocery_sections (
                id,
                household_id,
                store_id,
                name,
                sort_order,
                hidden,
                is_other
            )
            values (
                ${otherId},
                ${householdId},
                ${storeId},
                ${"Other"},
                ${99},
                ${false},
                ${true}
            )
        `;
        const foodId = await seedFood(sql, householdId, { name: "Milk" });
        const locationId = await seedFridgeLocation(sql, householdId);
        const itemId = await seedFridgeItem(
            sql,
            householdId,
            locationId,
            foodId,
            { displayName: "Milk pint", amount: 1, unit: "l" },
        );
        const runOn = "2026-06-06";
        const expiresOn = "2026-06-09";
        await sql`
            update public.fridge_items
            set expires_on = ${expiresOn}
            where id = ${itemId}::uuid
        `;
        const base = await getHouseholdConfig(householdId);
        await updateHouseholdConfig(householdId, {
            ...base,
            preferences: {
                ...base.preferences,
                timezone: "UTC",
                restock: {
                    enabled: true,
                    weekday: 6,
                    time: "00:00",
                    lastRunOn: null,
                },
            },
        });
        const now = new Date("2026-06-06T12:00:00.000Z");
        const deps = liveRestockCheckDeps();
        const ownerLookupActors: Array<Actor | undefined> = [];
        const getOwnerProfile = deps.getOwnerProfile;
        deps.getOwnerProfile = (id) => {
            ownerLookupActors.push(currentActor());
            return getOwnerProfile(id);
        };
        // The runner names its own actors: with no test fallback, a query it
        // left without one would throw and the household would not run.
        setFallbackActorForTests(null);
        try {
            await runRestockCheck(deps, now);
        } finally {
            setFallbackActorForTests(householdOwnerActor);
        }
        expect(ownerLookupActors).toEqual([{ kind: "household", householdId }]);
        const config = await getHouseholdConfig(householdId);
        expect(config.preferences.restock.lastRunOn).toBe(runOn);
        const lines = await sql`
            select source from grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(1);
        expect(lines[0]!.source).toBe("restock");
    });

    test("switch day: a legacy run then a schedules run the same day leaves the grocery lines unchanged", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        await seedGrocerySection(sql, householdId, storeId, "Dairy");
        await sql`
            insert into public.grocery_sections (
                id, household_id, store_id, name, sort_order, hidden, is_other
            )
            values (
                ${crypto.randomUUID()}, ${householdId}, ${storeId},
                ${"Other"}, ${99}, ${false}, ${true}
            )
        `;
        const milkId = await seedFood(sql, householdId, { name: "Milk" });
        const riceId = await seedFood(sql, householdId, { name: "Rice" });
        // A weekly usual that never was restocked: due on the restock day, so
        // a schedules run that got past the shared marker would add it.
        await sql`
            update public.foods
            set restock_schedule = 'weekly'
            where id = ${riceId}::uuid
        `;
        const locationId = await seedFridgeLocation(sql, householdId);
        const itemId = await seedFridgeItem(
            sql,
            householdId,
            locationId,
            milkId,
            { displayName: "Milk pint", amount: 1, unit: "l" },
        );
        await sql`
            update public.fridge_items
            set expires_on = ${"2026-06-09"}
            where id = ${itemId}::uuid
        `;
        const base = await getHouseholdConfig(householdId);
        await updateHouseholdConfig(householdId, {
            ...base,
            preferences: {
                ...base.preferences,
                timezone: "UTC",
                restock: {
                    enabled: true,
                    weekday: 6,
                    time: "00:00",
                    lastRunOn: null,
                },
            },
        });
        const now = new Date("2026-06-06T12:00:00.000Z");
        const lineKeys = async () =>
            await sql`
                select id, food_id, source
                from grocery_lines
                where household_id = ${householdId}
                order by id
            `;
        setFallbackActorForTests(null);
        try {
            await runRestockCheck(
                { ...liveRestockCheckDeps(), source: "legacy" },
                now,
            );
            const afterLegacy = await lineKeys();
            expect(afterLegacy).toHaveLength(1);
            expect(afterLegacy[0]!.food_id).toBe(milkId);

            await runRestockCheck(
                { ...liveRestockCheckDeps(), source: "schedules" },
                now,
            );
            expect(await lineKeys()).toEqual(afterLegacy);
        } finally {
            setFallbackActorForTests(householdOwnerActor);
        }
        const config = await getHouseholdConfig(householdId);
        expect(config.preferences.restock.lastRunOn).toBe("2026-06-06");
    });
});
