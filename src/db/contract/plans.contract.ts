import { describe, expect, test } from "bun:test";
import type { PlansStore } from "../../domain/plan.js";
import type { StoreContractCtx } from "./helpers.js";

export type PlansHarness = {
    store: PlansStore;
    /** A recipe id in the household (default `ctx().householdId`), created on call. */
    newRecipe(householdId?: string): Promise<string>;
};

export function runPlansStoreContract(
    label: string,
    createHarness: () => PlansHarness,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} recipe plans store`, () => {
        test("a plan keeps what it was given, and servings default to one", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();

            const soup = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                createdBy: c.userId,
            });
            expect(soup).not.toBeNull();
            expect(soup).toMatchObject({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                servings: 1,
                createdBy: c.userId,
            });
            expect(soup!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+\+00:00$/);

            const odd = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-13",
                slot: "snack",
                servings: 2.5,
            });
            expect(odd).toMatchObject({ servings: 2.5, createdBy: null });

            expect(await store.getPlan(c.householdId, soup!.id)).toEqual(soup);
            expect(
                await store.getPlan(c.householdId, crypto.randomUUID()),
            ).toBeNull();
        });

        test("listing returns the range inclusive, by day then slot, then planning order", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const otherRecipeId = await newRecipe();
            const add = (
                date: string,
                slot: "breakfast" | "lunch" | "dinner" | "snack",
                id?: string,
                forRecipe = recipeId,
            ) =>
                store.addPlan({
                    householdId: c.householdId,
                    recipeId: forRecipe,
                    date,
                    slot,
                    id,
                });

            // Out of order on purpose: neither the day nor the slot is the insert order.
            const snackMon = await add("2026-11-09", "snack");
            const dinnerTue = await add("2026-11-10", "dinner");
            const breakfastTue = await add("2026-11-10", "breakfast");
            const breakfastMon = await add("2026-11-09", "breakfast");
            const lunchSun = await add("2026-11-15", "lunch");
            await add("2026-11-08", "dinner");
            await add("2026-11-16", "dinner");
            // Two dinners (of different recipes) in one slot keep the order
            // they were planned in.
            // The later one has the smaller id, so ordering by id would flip them.
            const firstDinnerWed = await add(
                "2026-11-11",
                "dinner",
                "ffffffff-0000-4000-8000-000000000001",
            );
            await Bun.sleep(5);
            const secondDinnerWed = await add(
                "2026-11-11",
                "dinner",
                "00000000-0000-4000-8000-000000000001",
                otherRecipeId,
            );

            const week = await store.listPlans(
                c.householdId,
                "2026-11-09",
                "2026-11-15",
            );
            expect(week.map((p) => p.id)).toEqual([
                breakfastMon!.id,
                snackMon!.id,
                breakfastTue!.id,
                dinnerTue!.id,
                firstDinnerWed!.id,
                secondDinnerWed!.id,
                lunchSun!.id,
            ]);

            expect(
                await store.listPlans(
                    c.householdId,
                    "2026-11-10",
                    "2026-11-10",
                ),
            ).toHaveLength(2);
            expect(
                await store.listPlans(
                    c.householdId,
                    "2026-11-15",
                    "2026-11-09",
                ),
            ).toEqual([]);
        });

        test("a plan in the past stays stored; only the range hides it", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const stale = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2020-01-06",
                slot: "dinner",
            });
            const ahead = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2030-01-07",
                slot: "dinner",
            });

            expect(
                (
                    await store.listPlans(
                        c.householdId,
                        "2026-11-09",
                        "2031-01-01",
                    )
                ).map((p) => p.id),
            ).toEqual([ahead!.id]);
            expect(
                (
                    await store.listPlans(
                        c.householdId,
                        "2000-01-01",
                        "2031-01-01",
                    )
                ).map((p) => p.id),
            ).toEqual([stale!.id, ahead!.id]);
        });

        test("moving changes the day and slot and nothing else", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const plan = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                servings: 3,
                createdBy: c.userId,
            });

            const moved = await store.movePlan(
                c.householdId,
                plan!.id,
                "2026-11-14",
                "lunch",
            );
            expect(moved).toEqual({
                ...plan!,
                date: "2026-11-14",
                slot: "lunch",
            });
            expect(await store.getPlan(c.householdId, plan!.id)).toEqual(moved);
            expect(
                await store.movePlan(
                    c.householdId,
                    crypto.randomUUID(),
                    "2026-11-14",
                    "lunch",
                ),
            ).toBeNull();
        });

        test("moving onto the same recipe's day and slot merges the two plans", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const there = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-14",
                slot: "lunch",
                servings: 2,
                createdBy: c.userId,
            });
            const moving = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                servings: 3,
            });

            const merged = await store.movePlan(
                c.householdId,
                moving!.id,
                "2026-11-14",
                "lunch",
            );
            // The plan already there stays and takes the moved plan's servings.
            expect(merged).toEqual({ ...there!, servings: 5 });
            expect(await store.getPlan(c.householdId, moving!.id)).toBeNull();
            expect(
                await store.listPlans(
                    c.householdId,
                    "2026-11-01",
                    "2026-11-30",
                ),
            ).toEqual([merged!]);
        });

        test("a move that sets servings merges those servings, and the sum is capped", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const there = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-14",
                slot: "lunch",
                servings: 990,
            });
            const moving = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "lunch",
                servings: 1,
            });
            const merged = await store.movePlan(
                c.householdId,
                moving!.id,
                "2026-11-14",
                "lunch",
                20,
            );
            expect(merged?.id).toBe(there!.id);
            expect(merged?.servings).toBe(999);
        });

        test("a move onto another recipe's slot, or with servings, stays two plans", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const soup = await newRecipe();
            const stew = await newRecipe();
            await store.addPlan({
                householdId: c.householdId,
                recipeId: stew,
                date: "2026-11-14",
                slot: "lunch",
            });
            const moving = await store.addPlan({
                householdId: c.householdId,
                recipeId: soup,
                date: "2026-11-12",
                slot: "dinner",
                servings: 2,
            });
            const moved = await store.movePlan(
                c.householdId,
                moving!.id,
                "2026-11-14",
                "lunch",
                6,
            );
            expect(moved).toEqual({
                ...moving!,
                date: "2026-11-14",
                slot: "lunch",
                servings: 6,
            });
            expect(
                await store.listPlans(
                    c.householdId,
                    "2026-11-01",
                    "2026-11-30",
                ),
            ).toHaveLength(2);
        });

        test("adding a recipe already planned there returns that plan", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const first = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                servings: 2,
            });
            const again = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                servings: 7,
            });
            expect(again).toEqual(first!);
            expect(
                await store.listPlans(
                    c.householdId,
                    "2026-11-12",
                    "2026-11-12",
                ),
            ).toEqual([first!]);
        });

        test("servings can change to a fraction, and stay above zero", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const plan = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
            });

            const updated = await store.updatePlanServings(
                c.householdId,
                plan!.id,
                0.5,
            );
            expect(updated).toEqual({ ...plan!, servings: 0.5 });
            expect(
                await store.updatePlanServings(
                    c.householdId,
                    crypto.randomUUID(),
                    2,
                ),
            ).toBeNull();
            await expect(
                store.updatePlanServings(c.householdId, plan!.id, 0),
            ).rejects.toThrow();
            expect(
                (await store.getPlan(c.householdId, plan!.id))?.servings,
            ).toBe(0.5);
        });

        test("removing a plan removes only that plan", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const keep = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "lunch",
            });
            const drop = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
            });

            expect(await store.removePlan(c.householdId, drop!.id)).toBe(true);
            expect(await store.removePlan(c.householdId, drop!.id)).toBe(false);
            expect(
                (
                    await store.listPlans(
                        c.householdId,
                        "2026-11-12",
                        "2026-11-12",
                    )
                ).map((p) => p.id),
            ).toEqual([keep!.id]);
        });

        test("another household sees, moves, changes and removes nothing", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const plan = await store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
            });

            expect(
                await store.getPlan(c.otherHouseholdId, plan!.id),
            ).toBeNull();
            expect(
                await store.listPlans(
                    c.otherHouseholdId,
                    "2026-01-01",
                    "2026-12-31",
                ),
            ).toEqual([]);
            expect(
                await store.movePlan(
                    c.otherHouseholdId,
                    plan!.id,
                    "2026-11-13",
                    "lunch",
                ),
            ).toBeNull();
            expect(
                await store.updatePlanServings(c.otherHouseholdId, plan!.id, 9),
            ).toBeNull();
            expect(await store.removePlan(c.otherHouseholdId, plan!.id)).toBe(
                false,
            );
            expect(await store.getPlan(c.householdId, plan!.id)).toEqual(plan);
        });

        test("a recipe the household does not have cannot be planned", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const elsewhere = await newRecipe(c.otherHouseholdId);
            for (const recipeId of [
                crypto.randomUUID(),
                elsewhere,
                "not-a-uuid",
            ]) {
                expect(
                    await store.addPlan({
                        householdId: c.householdId,
                        recipeId,
                        date: "2026-11-12",
                        slot: "dinner",
                    }),
                ).toBeNull();
            }
            expect(
                await store.listPlans(
                    c.householdId,
                    "2026-01-01",
                    "2026-12-31",
                ),
            ).toEqual([]);
        });

        test("a bad slot, day or servings is refused and nothing is stored", async () => {
            await reset();
            const c = ctx();
            const { store, newRecipe } = createHarness();
            const recipeId = await newRecipe();
            const base = {
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner" as const,
            };

            await expect(
                store.addPlan({ ...base, slot: "brunch" as never }),
            ).rejects.toThrow();
            await expect(
                store.addPlan({ ...base, date: "2026-02-30" }),
            ).rejects.toThrow();
            await expect(
                store.addPlan({ ...base, date: "12/11/2026" }),
            ).rejects.toThrow();
            await expect(
                store.addPlan({ ...base, servings: 0 }),
            ).rejects.toThrow();
            await expect(
                store.addPlan({ ...base, servings: -1 }),
            ).rejects.toThrow();
            await expect(
                store.addPlan({ ...base, servings: Number.NaN }),
            ).rejects.toThrow();
            await expect(
                store.listPlans(c.householdId, "soon", "2026-12-31"),
            ).rejects.toThrow();
            expect(
                await store.listPlans(
                    c.householdId,
                    "2000-01-01",
                    "2099-12-31",
                ),
            ).toEqual([]);
        });
    });
}
