import { afterEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { liveFoodsStore, mergeLiveFoods } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { liveRecipesStore } from "./recipes.js";
import { liveStockStore } from "./stock.js";
import { clearCheckedLines } from "../domain/grocery.js";
import { deleteItem, deleteLocation } from "../domain/fridge.js";
import { discardFridgeItem, eatFridgeItem } from "../domain/stock.js";
import { removeRecipeIngredient } from "../domain/recipes.js";
import { updateFood } from "../domain/foods.js";
import { describeDb } from "./testing/pg.js";
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
import type { NoticeSubjectKind } from "../domain/notice-dismissals.js";

const pgAvailable = await findPgBin();

type DismissalRow = {
    subject_kind?: string;
    subject_id?: string;
    related_key?: string;
};

async function insertDismissals(
    sql: SQL,
    householdId: string,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
    foodId?: string,
): Promise<{ unrelatedItemId: string }> {
    const unrelatedItemId = crypto.randomUUID();
    await sql`
        insert into public.notice_dismissals (
            household_id, code, subject_kind, subject_id, related_key
        )
        values (
            ${householdId},
            ${"fridge.expiring"},
            ${subjectKind},
            ${subjectId},
            ${""}
        )
    `;
    await sql`
        insert into public.notice_dismissals (
            household_id, code, subject_kind, subject_id, related_key
        )
        values (
            ${householdId},
            ${"fridge.expiring"},
            ${"fridge_item"},
            ${unrelatedItemId},
            ${""}
        )
    `;
    if (foodId) {
        if (!(subjectKind === "food" && subjectId === foodId)) {
            await sql`
                insert into public.notice_dismissals (
                    household_id, code, subject_kind, subject_id, related_key
                )
                values (
                    ${householdId},
                    ${"fridge.expiring"},
                    ${"food"},
                    ${foodId},
                    ${""}
                )
            `;
        }
        await sql`
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id, related_key
            )
            values (
                ${householdId},
                ${"fridge.expiring"},
                ${"food"},
                ${crypto.randomUUID()},
                ${foodId}
            )
        `;
    }
    return { unrelatedItemId };
}

async function expectTargetGone(
    sql: SQL,
    householdId: string,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
    foodId?: string,
) {
    const rows = (await sql`
        select subject_kind, subject_id, related_key
        from public.notice_dismissals
        where household_id = ${householdId}
    `) as DismissalRow[];
    expect(
        rows.some(
            (r: DismissalRow) =>
                r.subject_kind === subjectKind &&
                String(r.subject_id) === subjectId,
        ),
    ).toBe(false);
    if (foodId) {
        expect(
            rows.some(
                (r: DismissalRow) =>
                    r.subject_kind === "food" &&
                    String(r.subject_id) === foodId,
            ),
        ).toBe(false);
        expect(
            rows.some((r: DismissalRow) => String(r.related_key) === foodId),
        ).toBe(false);
    }
    expect(rows).toHaveLength(1);
}

describeDb(
    pgAvailable !== null,
    "notice dismissal cleanup (live)",
    (getCtx) => {
        afterEach(() => setSqlForTests(null));

        test("deleteLocation removes dismissals for items in the location", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const foodId = await seedFood(sql, householdId);
            const locationId = await seedFridgeLocation(sql, householdId);
            const itemId = await seedFridgeItem(
                sql,
                householdId,
                locationId,
                foodId,
            );
            await insertDismissals(sql, householdId, "fridge_item", itemId);
            const fridge = liveFridgeStore();
            expect(await deleteLocation(fridge, householdId, locationId)).toBe(
                true,
            );
            await expectTargetGone(sql, householdId, "fridge_item", itemId);
        });

        test("fridge deleteItem removes dismissals for that item", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const foodId = await seedFood(sql, householdId);
            const locationId = await seedFridgeLocation(sql, householdId);
            const itemId = await seedFridgeItem(
                sql,
                householdId,
                locationId,
                foodId,
            );
            await insertDismissals(sql, householdId, "fridge_item", itemId);
            const fridge = liveFridgeStore();
            expect(await deleteItem(fridge, householdId, itemId)).toBe(true);
            await expectTargetGone(sql, householdId, "fridge_item", itemId);
        });

        test("eatFridgeItem empty and discard remove dismissals", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const foodId = await seedFood(sql, householdId);
            const locationId = await seedFridgeLocation(sql, householdId);
            const itemId = await seedFridgeItem(
                sql,
                householdId,
                locationId,
                foodId,
                {
                    amount: 50,
                },
            );
            await insertDismissals(sql, householdId, "fridge_item", itemId);
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            await eatFridgeItem(fridge, stock, foods, {
                householdId,
                itemId,
                amount: 50,
                actorUserId: null,
            });
            await expectTargetGone(sql, householdId, "fridge_item", itemId);

            const item2 = await seedFridgeItem(
                sql,
                householdId,
                locationId,
                foodId,
                { amount: 2 },
            );
            await insertDismissals(sql, householdId, "fridge_item", item2);
            await discardFridgeItem(fridge, stock, foods, {
                householdId,
                itemId: item2,
                amount: 2,
                actorUserId: null,
            });
            const afterDiscard = (await sql`
                select subject_id::text as subject_id
                from public.notice_dismissals
                where household_id = ${householdId}
            `) as DismissalRow[];
            expect(
                afterDiscard.some((r: DismissalRow) => r.subject_id === item2),
            ).toBe(false);
        });

        test("grocery deleteLine and clearCheckedLines remove dismissals", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const storeId = await seedGroceryStore(sql, householdId);
            const sectionId = await seedGrocerySection(
                sql,
                householdId,
                storeId,
            );
            const foodId = await seedFood(sql, householdId);
            const lineId = crypto.randomUUID();
            await sql`
            insert into public.grocery_lines (
                id, household_id, store_id, section_id, kind, display_name,
                amount, unit, food_id, checked
            )
            values (
                ${lineId},
                ${householdId},
                ${storeId},
                ${sectionId},
                ${"food"},
                ${"Apples"},
                ${1},
                ${"g"},
                ${foodId},
                ${false}
            )
        `;
            await insertDismissals(sql, householdId, "grocery_line", lineId);
            const grocery = liveGroceryStore();
            expect(await grocery.deleteLine(householdId, lineId)).toBe(true);
            await expectTargetGone(sql, householdId, "grocery_line", lineId);

            const checkedId = crypto.randomUUID();
            await sql`
            insert into public.grocery_lines (
                id, household_id, store_id, section_id, kind, display_name,
                amount, unit, food_id, checked
            )
            values (
                ${checkedId},
                ${householdId},
                ${storeId},
                ${sectionId},
                ${"food"},
                ${"Pears"},
                ${1},
                ${"g"},
                ${foodId},
                ${true}
            )
        `;
            await sql`
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id, related_key
            )
            values (
                ${householdId},
                ${"fridge.expiring"},
                ${"grocery_line"},
                ${checkedId},
                ${""}
            )
        `;
            await clearCheckedLines(grocery, householdId);
            const remaining = (await sql`
                select subject_id::text as subject_id
                from public.notice_dismissals
                where household_id = ${householdId}
            `) as DismissalRow[];
            expect(
                remaining.some((r: DismissalRow) => r.subject_id === checkedId),
            ).toBe(false);
        });

        test("recipe delete and ingredient removal remove dismissals", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId, userId } = await seedHousehold(sql);
            const foodId = await seedFood(sql, householdId);
            const recipeId = crypto.randomUUID();
            await sql`
            insert into public.recipes (
                id, household_id, creator_id, name, yield_portions
            )
            values (${recipeId}, ${householdId}, ${userId}, ${"Soup"}, ${2})
        `;
            const ingId = crypto.randomUUID();
            await sql`
            insert into public.recipe_ingredients (
                id, household_id, recipe_id, kind, display_name,
                amount, unit, food_id, sort_order
            )
            values (
                ${ingId},
                ${householdId},
                ${recipeId},
                ${"food"},
                ${"Carrot"},
                ${1},
                ${"g"},
                ${foodId},
                ${0}
            )
        `;
            await sql`
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id, related_key
            )
            values
                (${householdId}, ${"recipe.no_food"}, ${"recipe"}, ${recipeId}, ${""}),
                (${householdId}, ${"recipe.no_food"}, ${"recipe_ingredient"}, ${ingId}, ${""}),
                (${householdId}, ${"fridge.expiring"}, ${"recipe_ingredient"}, ${crypto.randomUUID()}, ${""})
        `;
            const recipes = liveRecipesStore();
            expect(await recipes.deleteRecipe(householdId, recipeId)).toBe(
                true,
            );
            const left = (await sql`
            select subject_id::text as subject_id, subject_kind
            from public.notice_dismissals
            where household_id = ${householdId}
        `) as DismissalRow[];
            expect(
                left.some((r: DismissalRow) => r.subject_id === recipeId),
            ).toBe(false);
            expect(left.some((r: DismissalRow) => r.subject_id === ingId)).toBe(
                false,
            );

            const recipe2 = crypto.randomUUID();
            await sql`
            insert into public.recipes (
                id, household_id, creator_id, name, yield_portions
            )
            values (${recipe2}, ${householdId}, ${userId}, ${"Salad"}, ${1})
        `;
            const ing2 = crypto.randomUUID();
            await sql`
            insert into public.recipe_ingredients (
                id, household_id, recipe_id, kind, display_name,
                amount, unit, food_id, sort_order
            )
            values (
                ${ing2},
                ${householdId},
                ${recipe2},
                ${"food"},
                ${"Lettuce"},
                ${1},
                ${"g"},
                ${foodId},
                ${0}
            )
        `;
            await insertDismissals(sql, householdId, "recipe_ingredient", ing2);
            expect(
                await removeRecipeIngredient(
                    recipes,
                    householdId,
                    recipe2,
                    ing2,
                ),
            ).toBe(true);
            const afterIng = (await sql`
            select subject_id::text as subject_id
            from public.notice_dismissals
            where household_id = ${householdId}
        `) as DismissalRow[];
            expect(
                afterIng.some((r: DismissalRow) => r.subject_id === ing2),
            ).toBe(false);
        });

        test("food archive and mergeLiveFoods remove food dismissals", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const keepId = await seedFood(sql, householdId, { name: "Eggs" });
            const dropId = await seedFood(sql, householdId, {
                name: "Large eggs",
            });
            await insertDismissals(sql, householdId, "food", dropId, dropId);
            const foods = liveFoodsStore();
            await updateFood(foods, householdId, dropId, { archived: true });
            await expectTargetGone(sql, householdId, "food", dropId, dropId);

            const drop2 = await seedFood(sql, householdId, {
                name: "Yogurt B",
            });
            await insertDismissals(sql, householdId, "food", drop2, drop2);
            setSqlForTests(sql);
            await mergeLiveFoods(householdId, keepId, drop2);
            const afterMerge = (await sql`
                select subject_id::text as subject_id, subject_kind, related_key
                from public.notice_dismissals
                where household_id = ${householdId}
            `) as DismissalRow[];
            expect(
                afterMerge.some(
                    (r: DismissalRow) =>
                        r.subject_kind === "food" && r.subject_id === drop2,
                ),
            ).toBe(false);
            expect(
                afterMerge.some(
                    (r: DismissalRow) => String(r.related_key) === drop2,
                ),
            ).toBe(false);
        });
    },
);
