// A food only a person's version names (a swapped or added food) is in the
// foods map the week plan totals with, so it matches the household's stock of
// its family like a base food does.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { addLocation } from "../domain/fridge.js";
import { planRecipe } from "../domain/plan.js";
import { countedServings, missingForPlan } from "../domain/plan-week.js";
import { addRecipeManualIngredient } from "../domain/recipes.js";
import { setRecipeVariant } from "../domain/recipe-variants.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { loadWeekPlanInputs } from "./plan-week.js";
import { liveRecipePlansStore } from "./plans.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "./recipes.js";
import { setSqlForTests } from "./sql.js";
import { asUser, seedFood, seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

describeDb(
    pgAvailable !== null,
    "week plan foods for people's versions",
    (getCtx) => {
        let householdId: string;
        let ownerId: string;
        let recipeId: string;

        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const seeded = await seedHousehold(sql);
            householdId = seeded.householdId;
            ownerId = seeded.userId;
            recipeId = crypto.randomUUID();
            await sql`
            insert into public.recipes (id, household_id, creator_id, name, yield_portions)
            values (${recipeId}, ${householdId}, ${ownerId}, ${"Soup"}, ${1})
        `;
        });
        afterEach(() => setSqlForTests(null));

        async function setup(swap: boolean) {
            const { sql } = getCtx();
            const recipes = liveRecipesStore();
            const foods = liveFoodsStore();
            const pasta = await addRecipeManualIngredient(recipes, foods, {
                householdId,
                recipeId,
                name: "Pasta",
                amount: 200,
                unit: "g",
            });
            const product = await seedFood(sql, householdId, {
                name: "Barilla Penne",
            });
            await sql`update public.foods set generic_food_id = ${pasta.foodId}::uuid where id = ${product}::uuid`;
            if (swap) {
                await setRecipeVariant(
                    recipes,
                    foods,
                    liveRecipeVariantsStore(),
                    {
                        householdId,
                        recipeId,
                        userId: ownerId,
                        action: "food",
                        ingredientId: pasta.id,
                        foodId: product,
                    },
                );
            }
            // 1 kg of pasta in the house: a product of the same family.
            const other = await seedFood(sql, householdId, {
                name: "De Cecco Penne",
            });
            await sql`update public.foods set generic_food_id = ${pasta.foodId}::uuid where id = ${other}::uuid`;
            const loc = await addLocation(
                liveFridgeStore(),
                householdId,
                "Pantry",
            );
            await sql`
            insert into public.fridge_items (household_id, location_id, kind, display_name, amount, unit, food_id)
            values (${householdId}, ${loc.id}, 'food', 'De Cecco Penne', 1000, 'g', ${other})
        `;
            await liveRecipePlansStore().addPlan({
                householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
                servings: 1,
                memberIds: [ownerId],
            });
            const inputs = await asUser(
                ownerId,
                () => loadWeekPlanInputs(householdId, "2026-11-12"),
                householdId,
            );
            return missingForPlan(inputs.plans, inputs.recipes, inputs.stock, {
                from: "2026-11-12",
                days: 7,
                foodsById: inputs.foodsById,
            });
        }

        test("a base food is covered by a product of its family", async () => {
            expect((await setup(false)).map((l) => l.displayName)).toEqual([]);
        });

        test("a version swapped to another pasta product is covered too", async () => {
            const lines = await setup(true);
            expect(lines.map((l) => l.displayName)).toEqual([]);
        });

        test("the week's inputs carry the saved recipes and how each repeat repeats, for the edit sheet's Recipe and Repeat rows", async () => {
            const { sql } = getCtx();
            const stewId = crypto.randomUUID();
            const draftId = crypto.randomUUID();
            await sql`
                insert into public.recipes (id, household_id, creator_id, name, yield_portions)
                values (${stewId}, ${householdId}, ${ownerId}, ${"Stew"}, ${2})
            `;
            await sql`
                insert into public.recipes (
                    id, household_id, creator_id, name, yield_portions, verification
                )
                values (${draftId}, ${householdId}, ${ownerId}, ${"Draft"}, ${2}, ${"unverified"})
            `;
            const plans = liveRecipePlansStore();
            await plans.addPlan({
                householdId,
                recipeId,
                date: "2026-11-12",
                slot: "lunch",
            });
            const rule = await plans.addRule({
                householdId,
                recipeId,
                slot: "dinner",
                startsOn: "2026-11-12",
                repeat: "days",
                days: [1, 4],
            });
            const inputs = await asUser(
                ownerId,
                () => loadWeekPlanInputs(householdId, "2026-11-12"),
                householdId,
            );
            // Saved recipes only: the draft is not a choice.
            expect(inputs.savedRecipes.map((r) => r.name).sort()).toEqual([
                "Soup",
                "Stew",
            ]);
            // One entry per repeat read, none for a one-off.
            expect([...inputs.rules]).toEqual([
                [rule!.id, { repeat: "days", days: [1, 4] }],
            ]);
            expect(inputs.plans.some((p) => p.ruleId === rule!.id)).toBe(true);
        });

        test("a plan for a named person follows their saved portions as they change, and the servings given with them are ignored", async () => {
            const recipes = liveRecipesStore();
            const foods = liveFoodsStore();
            await addRecipeManualIngredient(recipes, foods, {
                householdId,
                recipeId,
                name: "Pasta",
                amount: 400,
                unit: "g",
            });
            const nuts = await addRecipeManualIngredient(recipes, foods, {
                householdId,
                recipeId,
                name: "Peanuts",
                amount: 200,
                unit: "g",
            });
            await recipes.upsertPortion({
                householdId,
                recipeId,
                userId: ownerId,
                portionCount: 2,
            });
            await setRecipeVariant(recipes, foods, liveRecipeVariantsStore(), {
                householdId,
                recipeId,
                userId: ownerId,
                action: "remove",
                ingredientId: nuts.id,
            });
            const planned = await planRecipe(liveRecipePlansStore(), {
                householdId,
                recipeId,
                recipeYield: 1,
                date: "2026-11-12",
                slot: "dinner",
                servings: 6,
                memberIds: [ownerId],
                memberPortions: { [ownerId]: 2 },
                today: "2026-11-12",
                createdBy: ownerId,
            });
            // The plan is the person's 2 portions, not the 6 asked for.
            expect(planned?.plan.servings).toBe(2);
            const read = async () => {
                const inputs = await asUser(
                    ownerId,
                    () => loadWeekPlanInputs(householdId, "2026-11-12"),
                    householdId,
                );
                return {
                    need: Object.fromEntries(
                        missingForPlan(inputs.plans, inputs.recipes, [], {
                            from: "2026-11-12",
                            days: 7,
                            foodsById: inputs.foodsById,
                        }).map((l) => [l.displayName, l.need?.amount]),
                    ),
                    counted: countedServings(
                        inputs.plans[0]!,
                        inputs.recipes[0]!.versions,
                    ),
                };
            };
            // Two portions of a yield-1 recipe: all the pasta, none of the
            // peanuts the person leaves out.
            expect(await read()).toEqual({ need: { Pasta: 800 }, counted: 2 });
            // The person lowers their portions: the plan follows, and the
            // stored 2 is not left over at the base.
            await recipes.upsertPortion({
                householdId,
                recipeId,
                userId: ownerId,
                portionCount: 1,
            });
            expect(await read()).toEqual({ need: { Pasta: 400 }, counted: 1 });
        });
    },
);
