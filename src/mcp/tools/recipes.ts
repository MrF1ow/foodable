import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { getHouseholdConfig } from "../../db/household.js";
import { insertMeal } from "../../db/nutrition.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveRulesStore } from "../../db/rules.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { withAnalytics } from "../../analytics.js";
import { lookupBarcode } from "../../foods.js";
import { foodsByIds } from "../../domain/foods.js";
import { listFridge } from "../../domain/fridge.js";
import { householdConfigToWire } from "../../household.js";
import {
    addRecipeIngredientByBarcode,
    addRecipeIngredientById,
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createRecipe,
    deleteRecipe,
    getRecipeView,
    importRecipeFromText,
    listRecipes,
    listRecipesFiltered,
    macrosForPerson,
    removeRecipeIngredient,
    reorderRecipeIngredients,
    setPersonPortion,
    updateRecipe,
    updateRecipeIngredient,
    type Recipe,
    resolveTotalPortions,
} from "../../domain/recipes.js";
import { cookRecipe, StockInputError } from "../../domain/stock.js";
import { mealWriteFromItems } from "./nutrition.js";
import { QUANTITY_ITEM } from "../shared.js";
import type { ToolContext } from "../shared.js";

const RECIPE_FIELDS = {
    id: z.string(),
    name: z.string(),
    yield_portions: z.number(),
    creator_id: z.string(),
    instructions: z.string().nullable(),
    source_url: z.string().nullable(),
    tags: z.array(z.string()),
    notes: z.string().nullable(),
    prep_minutes: z.number().nullable(),
    cook_minutes: z.number().nullable(),
};

const MACROS_ITEM = z.object({
    calories: z.number().nullable(),
    protein_g: z.number().nullable(),
    carbs_g: z.number().nullable(),
    fat_g: z.number().nullable(),
    fiber_g: z.number().nullable(),
    sugar_g: z.number().nullable(),
    alcohol_g: z.number().nullable(),
    incomplete: z.boolean(),
});

function recipeFields(recipe: Recipe) {
    return {
        id: recipe.id,
        name: recipe.name,
        yield_portions: recipe.yieldPortions,
        creator_id: recipe.creatorId,
        instructions: recipe.instructions,
        source_url: recipe.sourceUrl,
        tags: recipe.tags,
        notes: recipe.notes,
        prep_minutes: recipe.prepMinutes,
        cook_minutes: recipe.cookMinutes,
    };
}

export function registerRecipesTools(server: McpServer, ctx: ToolContext) {
    const {
        callerHouseholdId,
        requireHouseholdMemberId,
        callerActor,
        analytics,
    } = ctx;
    server.registerTool(
        "list_recipes",
        {
            title: "List Recipes",
            description:
                "List household recipes. Filter by tag, recipes whose fridge stock fully covers every ingredient (can_make_now), or recipes safe for a member (no catalog allergen hits and no dislikes).",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                tag: z.string().optional(),
                can_make_now: z.boolean().optional(),
                safe_for: z.string().optional(),
            }),
            outputSchema: z.object({
                recipes: z.array(z.object(RECIPE_FIELDS)),
            }),
        },
        async (args) =>
            withAnalytics(
                "list_recipes",
                async () => {
                    const householdId = await callerHouseholdId();
                    const filterOn =
                        Boolean(args.tag?.trim()) ||
                        args.can_make_now === true ||
                        Boolean(args.safe_for);
                    let recipes;
                    if (filterOn) {
                        const fridge = await listFridge(
                            liveFridgeStore(),
                            householdId,
                        );
                        const foods =
                            await liveFoodsStore().listFoods(householdId);
                        let safeFor = null;
                        if (args.safe_for) {
                            const memberId = await requireHouseholdMemberId(
                                args.safe_for,
                            );
                            const rules = liveRulesStore();
                            const [allergens, dislikes] = await Promise.all([
                                rules.listAllergens(householdId, memberId),
                                rules.listDislikes(householdId, memberId),
                            ]);
                            safeFor = { allergens, dislikes };
                        }
                        recipes = await listRecipesFiltered(
                            liveRecipesStore(),
                            householdId,
                            new Map(foods.map((food) => [food.id, food])),
                            fridge.items.map((item) => ({
                                identity: item.identity,
                                quantity: item.quantity,
                                foodId: item.foodId,
                            })),
                            {
                                tag: args.tag,
                                canMakeNow: args.can_make_now === true,
                                safeFor,
                            },
                        );
                    } else {
                        recipes = await listRecipes(
                            liveRecipesStore(),
                            householdId,
                        );
                    }
                    const payload = {
                        recipes: recipes.map(recipeFields),
                    };
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    payload.recipes.length === 0
                                        ? "No recipes."
                                        : payload.recipes
                                              .map(
                                                  (recipe) =>
                                                      `${recipe.name} yield ${recipe.yield_portions} ${recipe.id}`,
                                              )
                                              .join("\n"),
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "get_recipe",
        {
            title: "Get Recipe",
            description:
                "Get a recipe as viewed by a household member, including per-portion and per-person amounts.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
                member_id: z.string().optional(),
            }),
            outputSchema: z.object({
                ...RECIPE_FIELDS,
                portion_count: z.number(),
                macros_per_portion: MACROS_ITEM,
                ingredients: z.array(
                    z.object({
                        id: z.string(),
                        display_name: z.string(),
                        amount: z.number(),
                        unit: z.string(),
                        note: z.string().nullable(),
                        food_id: z.string().nullable(),
                        per_portion_amount: z.number(),
                        person_amount: z.number(),
                    }),
                ),
            }),
        },
        async (args) =>
            withAnalytics(
                "get_recipe",
                async () => {
                    const actor = await callerActor();
                    const memberId = args.member_id
                        ? await requireHouseholdMemberId(args.member_id)
                        : actor.userId;
                    const view = await getRecipeView(
                        liveRecipesStore(),
                        actor.householdId,
                        args.id,
                        memberId,
                    );
                    const catalog = await foodsByIds(
                        liveFoodsStore(),
                        actor.householdId,
                        view.ingredients.map((row) => row.foodId),
                    );
                    const macrosPerPortion = macrosForPerson(
                        view.ingredients,
                        view.yieldPortions,
                        1,
                        catalog,
                    );
                    const payload = {
                        ...recipeFields(view),
                        portion_count: view.portionCount,
                        macros_per_portion: macrosPerPortion,
                        ingredients: view.ingredients.map((ingredient) => ({
                            id: ingredient.id,
                            display_name: ingredient.displayName,
                            amount: ingredient.quantity.amount,
                            unit: ingredient.quantity.unit,
                            note: ingredient.note,
                            food_id: ingredient.foodId,
                            per_portion_amount: ingredient.perPortionAmount,
                            person_amount: ingredient.personAmount,
                        })),
                    };
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${view.name} yield ${view.yieldPortions}, portion ${view.portionCount}\nPer portion: ${macrosPerPortion.incomplete && macrosPerPortion.calories == null ? "macros incomplete" : `${macrosPerPortion.calories ?? "—"} kcal`}\n${payload.ingredients
                                    .map(
                                        (ingredient) =>
                                            `${ingredient.display_name} ${ingredient.person_amount} ${ingredient.unit}${ingredient.note ? ` (${ingredient.note})` : ""}`,
                                    )
                                    .join("\n")}`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "create_recipe",
        {
            title: "Create Recipe",
            description:
                "Create a household recipe with a cook yield. The caller is the creator.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                name: z.string().min(1),
                yield_portions: z.coerce.number(),
                instructions: z.string().optional(),
                source_url: z.string().optional(),
                tags: z.array(z.string()).optional(),
                notes: z.string().optional(),
                prep_minutes: z.coerce.number().optional(),
                cook_minutes: z.coerce.number().optional(),
            }),
            outputSchema: z.object(RECIPE_FIELDS),
        },
        async (args) =>
            withAnalytics(
                "create_recipe",
                async () => {
                    const actor = await callerActor();
                    const recipe = await createRecipe(liveRecipesStore(), {
                        householdId: actor.householdId,
                        creatorId: actor.userId,
                        name: args.name,
                        yieldPortions: args.yield_portions,
                        instructions: args.instructions,
                        sourceUrl: args.source_url,
                        tags: args.tags,
                        notes: args.notes,
                        prepMinutes: args.prep_minutes,
                        cookMinutes: args.cook_minutes,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Created ${recipe.name} yield ${recipe.yieldPortions} ${recipe.id}`,
                            },
                        ],
                        structuredContent: recipeFields(recipe),
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "add_recipe_ingredient",
        {
            title: "Add Recipe Ingredient",
            description:
                "Add a food ingredient to a recipe. Pass a barcode or a manual name. Amounts are grams.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                amount: z.coerce.number(),
                name: z.string().optional(),
                barcode: z.string().optional(),
                food_id: z.string().optional(),
                unit: z.string().optional(),
            }),
        },
        async (args) =>
            withAnalytics(
                "add_recipe_ingredient",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveRecipesStore();
                    const foods = liveFoodsStore();
                    const ingredient = args.food_id
                        ? await addRecipeIngredientById(store, foods, {
                              householdId,
                              recipeId: args.recipe_id,
                              foodId: args.food_id,
                              amount: args.amount,
                              unit: args.unit,
                          })
                        : args.barcode
                          ? await addRecipeIngredientByBarcode(
                                store,
                                foods,
                                {
                                    householdId,
                                    recipeId: args.recipe_id,
                                    barcode: args.barcode,
                                    amount: args.amount,
                                    unit: args.unit,
                                },
                                { lookup: lookupBarcode },
                            )
                          : await addRecipeManualIngredient(store, foods, {
                                householdId,
                                recipeId: args.recipe_id,
                                name: args.name ?? "",
                                amount: args.amount,
                                unit: args.unit,
                            });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Added ${ingredient.displayName} ${ingredient.quantity.amount} ${ingredient.quantity.unit}`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "set_recipe_portion",
        {
            title: "Set Recipe Portion",
            description:
                "Set how many portions a household member eats of a recipe.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                member_id: z.string(),
                portion_count: z.coerce.number(),
            }),
        },
        async (args) =>
            withAnalytics(
                "set_recipe_portion",
                async () => {
                    const householdId = await callerHouseholdId();
                    await requireHouseholdMemberId(args.member_id);
                    const portion = await setPersonPortion(liveRecipesStore(), {
                        householdId,
                        recipeId: args.recipe_id,
                        userId: args.member_id,
                        portionCount: args.portion_count,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Set portion ${portion.portionCount} for ${args.member_id}.`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "delete_recipe",
        {
            title: "Delete Recipe",
            description:
                "Delete a recipe. Only the creator or the household owner may delete.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
            }),
        },
        async (args) =>
            withAnalytics(
                "delete_recipe",
                async () => {
                    const actor = await callerActor();
                    const deleted = await deleteRecipe(
                        liveRecipesStore(),
                        actor.householdId,
                        args.id,
                        { userId: actor.userId, isOwner: actor.isOwner },
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: deleted
                                    ? `Deleted recipe ${args.id}.`
                                    : `No recipe found with id ${args.id}.`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "add_recipe_to_grocery",
        {
            title: "Add Recipe to Grocery",
            description:
                "Add a recipe's remainder to a grocery store, netting fridge stock. Size it with member_ids (the sum of those members' saved portions: one meal, nothing left over) and/or total_portions. For a whole batch (baking a loaf, a casserole) pass total_portions = the recipe's yield_portions; for leftovers (\"cook once, eat twice\") pass more than the members' sum. total_portions may not be less than the members' sum. Returns the per-ingredient remainder.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                store_id: z.string(),
                member_ids: z.array(z.string()).optional(),
                total_portions: z.coerce.number().optional(),
            }),
            outputSchema: z.object({
                total_portions: z.number(),
                remainder: z.array(
                    z.object({
                        display_name: z.string(),
                        skipped: z.boolean(),
                        need: QUANTITY_ITEM,
                        remainder: QUANTITY_ITEM.nullable(),
                    }),
                ),
            }),
        },
        async (args) =>
            withAnalytics(
                "add_recipe_to_grocery",
                async () => {
                    const householdId = await callerHouseholdId();
                    const memberIds = args.member_ids ?? [];
                    for (const memberId of memberIds) {
                        await requireHouseholdMemberId(memberId);
                    }
                    const recipes = liveRecipesStore();
                    const portionCounts: number[] = [];
                    for (const memberId of memberIds) {
                        const view = await getRecipeView(
                            recipes,
                            householdId,
                            args.recipe_id,
                            memberId,
                        );
                        portionCounts.push(view.portionCount);
                    }
                    const fridge = await listFridge(
                        liveFridgeStore(),
                        householdId,
                    );
                    const foods = await foodsByIds(
                        liveFoodsStore(),
                        householdId,
                        [
                            ...(
                                await recipes.listIngredients(
                                    householdId,
                                    args.recipe_id,
                                )
                            ).map((row) => row.foodId),
                            ...fridge.items.map((item) => item.foodId),
                        ],
                    );
                    const result = await addRecipeToGrocery({
                        recipes,
                        grocery: liveGroceryStore(),
                        settings: liveSettingsStore(),
                        fridgeItems: fridge.items.map((item) => ({
                            identity: item.identity,
                            quantity: item.quantity,
                            foodId: item.foodId,
                        })),
                        householdId,
                        recipeId: args.recipe_id,
                        storeId: args.store_id,
                        portionCounts,
                        totalPortions: args.total_portions,
                        foodsById: foods,
                    });
                    const remainder = result.plan.map((line) => ({
                        display_name: line.displayName,
                        skipped: line.skipped,
                        need: line.need,
                        remainder: line.remainder,
                    }));
                    return {
                        content: [
                            {
                                type: "text",
                                text: [
                                    `For ${result.totalPortions} portion${result.totalPortions === 1 ? "" : "s"}:`,
                                    ...remainder.map((line) =>
                                        line.skipped || line.remainder == null
                                            ? `${line.display_name} skipped`
                                            : `${line.display_name} remainder ${line.remainder.amount} ${line.remainder.unit}`,
                                    ),
                                ].join("\n"),
                            },
                        ],
                        structuredContent: {
                            total_portions: result.totalPortions,
                            remainder,
                        },
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "cook_recipe",
        {
            title: "Cook Recipe",
            description:
                "Deduct scaled ingredients from the fridge (cook movements, oldest expiry first) and optionally log one recipe-portion meal per member through log_recipe_portion's meal-items path. Returns shortfalls instead of going negative. The amount cooked defaults to the sum of portions_by_member (one meal, nothing left over). For a whole batch pass total_portions = the recipe's yield_portions; for leftovers pass more than the members' sum. Only portions_by_member are logged as eaten; the rest is cooked but not logged. total_portions may not be less than the members' sum, and portions_by_member may be empty when nobody eats yet (baking ahead).",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                portions_by_member: z
                    .array(
                        z.object({
                            user_id: z.string(),
                            portions: z.coerce.number(),
                        }),
                    )
                    .optional(),
                total_portions: z.coerce.number().optional(),
                deduct_stock: z.boolean().optional(),
                log_meals: z.boolean().optional(),
                meal_type: z
                    .enum(["breakfast", "lunch", "dinner", "snack"])
                    .optional(),
            }),
            outputSchema: z.object({
                total_portions: z.number(),
                shortfalls: z.array(
                    z.object({
                        food_id: z.string(),
                        display_name: z.string(),
                        amount: z.number(),
                        unit: z.string(),
                    }),
                ),
                meal_ids: z.array(z.string()),
            }),
        },
        async (args) =>
            withAnalytics(
                "cook_recipe",
                async () => {
                    const householdId = await callerHouseholdId();
                    const deductStock = args.deduct_stock !== false;
                    const logMeals = args.log_meals !== false;
                    try {
                        const portions: {
                            userId: string;
                            portions: number;
                        }[] = [];
                        for (const row of args.portions_by_member ?? []) {
                            const userId = await requireHouseholdMemberId(
                                row.user_id,
                            );
                            if (
                                !Number.isFinite(row.portions) ||
                                row.portions <= 0
                            ) {
                                continue;
                            }
                            portions.push({
                                userId,
                                portions: row.portions,
                            });
                        }
                        const totalPortions = resolveTotalPortions(
                            portions.reduce(
                                (sum, row) => sum + row.portions,
                                0,
                            ),
                            args.total_portions,
                        );
                        const cooked = await cookRecipe(
                            liveRecipesStore(),
                            liveFridgeStore(),
                            liveStockStore(),
                            liveFoodsStore(),
                            {
                                householdId,
                                recipeId: args.recipe_id,
                                totalPortions,
                                deductStock,
                            },
                        );
                        const mealIds: string[] = [];
                        if (logMeals) {
                            for (const row of portions) {
                                const computed = await mealWriteFromItems(
                                    householdId,
                                    [
                                        {
                                            recipe_id: args.recipe_id,
                                            portions: row.portions,
                                        },
                                    ],
                                );
                                const { meal } = await insertMeal(row.userId, {
                                    description: computed.description,
                                    meal_type: args.meal_type ?? "dinner",
                                    ...computed.totals,
                                    items: computed.items,
                                    item_digest: computed.item_digest,
                                });
                                mealIds.push(meal.id);
                            }
                        }
                        const payload = {
                            total_portions: cooked.totalPortions,
                            shortfalls: cooked.shortfalls.map((row) => ({
                                food_id: row.foodId,
                                display_name: row.displayName,
                                amount: row.amount,
                                unit: row.unit,
                            })),
                            meal_ids: mealIds,
                        };
                        const shortfallText =
                            cooked.shortfalls.length === 0
                                ? ""
                                : ` Shortfall: ${cooked.shortfalls
                                      .map(
                                          (row) =>
                                              `${row.displayName} ${row.amount} ${row.unit}`,
                                      )
                                      .join("; ")}.`;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Cooked ${cooked.totalPortions} portion${cooked.totalPortions === 1 ? "" : "s"}.${shortfallText}${
                                        mealIds.length > 0
                                            ? ` Logged ${mealIds.length} meal${mealIds.length === 1 ? "" : "s"}.`
                                            : ""
                                    }`,
                                },
                            ],
                            structuredContent: payload,
                        };
                    } catch (err) {
                        if (err instanceof StockInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
            ),
    );

    server.registerTool(
        "update_recipe",
        {
            title: "Update Recipe",
            description:
                "Update a recipe's name, yield, instructions, source URL, tags, notes, or prep and cook times.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
                name: z.string().optional(),
                yield_portions: z.coerce.number().optional(),
                instructions: z.string().nullable().optional(),
                source_url: z.string().nullable().optional(),
                tags: z.array(z.string()).optional(),
                notes: z.string().nullable().optional(),
                prep_minutes: z.coerce.number().nullable().optional(),
                cook_minutes: z.coerce.number().nullable().optional(),
            }),
            outputSchema: z.object(RECIPE_FIELDS),
        },
        async (args) =>
            withAnalytics(
                "update_recipe",
                async () => {
                    const householdId = await callerHouseholdId();
                    const recipe = await updateRecipe(
                        liveRecipesStore(),
                        householdId,
                        args.id,
                        {
                            name: args.name,
                            yieldPortions: args.yield_portions,
                            instructions: args.instructions,
                            sourceUrl: args.source_url,
                            tags: args.tags,
                            notes: args.notes,
                            prepMinutes: args.prep_minutes,
                            cookMinutes: args.cook_minutes,
                        },
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Updated ${recipe.name} ${recipe.id}`,
                            },
                        ],
                        structuredContent: recipeFields(recipe),
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "update_recipe_ingredient",
        {
            title: "Update Recipe Ingredient",
            description:
                "Update a recipe ingredient amount, unit, or note (for example diced or room temp).",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                ingredient_id: z.string(),
                amount: z.coerce.number().optional(),
                unit: z.string().optional(),
                note: z.string().nullable().optional(),
            }),
        },
        async (args) =>
            withAnalytics(
                "update_recipe_ingredient",
                async () => {
                    const householdId = await callerHouseholdId();
                    const ingredient = await updateRecipeIngredient(
                        liveRecipesStore(),
                        householdId,
                        args.recipe_id,
                        args.ingredient_id,
                        {
                            amount: args.amount,
                            unit: args.unit,
                            note: args.note,
                        },
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Updated ${ingredient.displayName} ${ingredient.quantity.amount} ${ingredient.quantity.unit}${ingredient.note ? ` (${ingredient.note})` : ""}`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "remove_recipe_ingredient",
        {
            title: "Remove Recipe Ingredient",
            description: "Remove an ingredient from a recipe.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                ingredient_id: z.string(),
            }),
        },
        async (args) =>
            withAnalytics(
                "remove_recipe_ingredient",
                async () => {
                    const householdId = await callerHouseholdId();
                    const removed = await removeRecipeIngredient(
                        liveRecipesStore(),
                        householdId,
                        args.recipe_id,
                        args.ingredient_id,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: removed
                                    ? `Removed ingredient ${args.ingredient_id}.`
                                    : `No ingredient ${args.ingredient_id}.`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "reorder_recipe_ingredients",
        {
            title: "Reorder Recipe Ingredients",
            description:
                "Set the ingredient order for a recipe. Pass every ingredient id exactly once.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                ingredient_ids: z.array(z.string()).min(1),
            }),
        },
        async (args) =>
            withAnalytics(
                "reorder_recipe_ingredients",
                async () => {
                    const householdId = await callerHouseholdId();
                    const ingredients = await reorderRecipeIngredients(
                        liveRecipesStore(),
                        householdId,
                        args.recipe_id,
                        args.ingredient_ids,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: ingredients
                                    .map(
                                        (ingredient) =>
                                            `${ingredient.sortOrder + 1}. ${ingredient.displayName}`,
                                    )
                                    .join("\n"),
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "import_recipe_from_text",
        {
            title: "Import Recipe From Text",
            description:
                "Create a recipe from structured fields the agent extracted from recipe text. Pass the original text plus extracted name, yield, ingredients, tags, and times. The server find-or-creates catalog foods for each ingredient and returns which still lack nutrition or unit factors. Use get_household_config recipe_search_places to know where this household looks up recipes. Do not store the recipe as a food.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                text: z.string(),
                source_url: z.string().optional(),
                name: z.string().optional(),
                yield_portions: z.coerce.number().optional(),
                ingredients: z
                    .array(
                        z.object({
                            name: z.string(),
                            amount: z.coerce.number(),
                            unit: z.string().optional(),
                            note: z.string().optional(),
                            food_id: z.string().optional(),
                            barcode: z.string().optional(),
                        }),
                    )
                    .optional(),
                tags: z.array(z.string()).optional(),
                notes: z.string().optional(),
                prep_minutes: z.coerce.number().optional(),
                cook_minutes: z.coerce.number().optional(),
            }),
            outputSchema: z.object({
                recipe: z.object(RECIPE_FIELDS),
                ingredients: z.array(
                    z.object({
                        id: z.string(),
                        food_id: z.string().nullable(),
                        display_name: z.string(),
                        amount: z.number(),
                        unit: z.string(),
                        note: z.string().nullable(),
                        missing: z.array(
                            z.enum([
                                "nutrition",
                                "grams_per_each",
                                "grams_per_ml",
                            ]),
                        ),
                    }),
                ),
                recipe_search_places: z.array(
                    z.object({
                        name: z.string(),
                        kind: z.string(),
                        url: z.string().nullable(),
                    }),
                ),
            }),
        },
        async (args) =>
            withAnalytics(
                "import_recipe_from_text",
                async () => {
                    const actor = await callerActor();
                    const result = await importRecipeFromText(
                        liveRecipesStore(),
                        liveFoodsStore(),
                        {
                            householdId: actor.householdId,
                            creatorId: actor.userId,
                            text: args.text,
                            sourceUrl: args.source_url,
                            name: args.name,
                            yieldPortions: args.yield_portions,
                            ingredients: args.ingredients?.map((line) => ({
                                name: line.name,
                                amount: line.amount,
                                unit: line.unit,
                                note: line.note,
                                foodId: line.food_id,
                                barcode: line.barcode,
                            })),
                            tags: args.tags,
                            notes: args.notes,
                            prepMinutes: args.prep_minutes,
                            cookMinutes: args.cook_minutes,
                        },
                        { lookup: lookupBarcode },
                    );
                    const places = householdConfigToWire(
                        await getHouseholdConfig(actor.householdId),
                    ).recipe_search_places;
                    const payload = {
                        recipe: recipeFields(result.recipe),
                        ingredients: result.ingredients.map((ingredient) => ({
                            id: ingredient.id,
                            food_id: ingredient.foodId,
                            display_name: ingredient.displayName,
                            amount: ingredient.quantity.amount,
                            unit: ingredient.quantity.unit,
                            note: ingredient.note,
                            missing:
                                result.gaps.find(
                                    (gap) => gap.ingredientId === ingredient.id,
                                )?.missing ?? [],
                        })),
                        recipe_search_places: places,
                    };
                    const gapLines = payload.ingredients.filter(
                        (row) => row.missing.length > 0,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Imported ${result.recipe.name} ${result.recipe.id}\n${payload.ingredients
                                    .map(
                                        (row) =>
                                            `${row.display_name} ${row.amount} ${row.unit}${row.missing.length ? ` missing ${row.missing.join(", ")}` : ""}`,
                                    )
                                    .join("\n")}${gapLines.length ? "" : ""}${
                                    places.length
                                        ? `\nSearch places: ${places.map((place) => place.name).join(", ")}`
                                        : ""
                                }`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );
}
