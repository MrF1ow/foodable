import { Hono } from "hono";
import { renderRecipeDetailRoute, renderRecipesListPage } from "../loaders.js";

import { formAmount, formOptionalNumber, formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import { listFridge } from "../../domain/fridge.js";
import {
    addRecipeIngredientByBarcode,
    addRecipeIngredientById,
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createRecipe,
    deleteRecipe,
    RecipeForbiddenError,
    RecipeInputError,
    removeRecipeIngredient,
    reorderRecipeIngredients,
    setPersonPortion,
    updateRecipe,
    updateRecipeIngredient,
    resolveTotalPortions,
} from "../../domain/recipes.js";
import { listHouseholdMembers } from "../../db/household.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { foodsByIds } from "../../domain/foods.js";
import { insertMeal, snapshotToMealItemWrite } from "../../db/nutrition.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";
import { cookRecipe } from "../../domain/stock.js";
import { redirectWithToast } from "../toast.js";

export const recipesRoutes = new Hono();

function formMemberIds(
    body: Record<string, string | File | (string | File)[]>,
): string[] {
    const raw = body.member_ids;
    if (Array.isArray(raw)) {
        return raw.filter(
            (value): value is string => typeof value === "string",
        );
    }
    if (typeof raw === "string" && raw) return [raw];
    return [];
}

async function recipeFormError(
    userId: string,
    recipeId: string | null,
    err: unknown,
    opts: { member?: string; openModalId?: string } = {},
) {
    const message =
        err instanceof RecipeForbiddenError || err instanceof RecipeInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update the recipe.";
    if (recipeId) {
        const page = await renderRecipeDetailRoute(userId, recipeId, {
            member: opts.member,
            error: message,
            openModalId: opts.openModalId,
        });
        const status =
            err instanceof RecipeForbiddenError ? 403 : (400 as const);
        return { html: page.html, status: status as 400 | 403 };
    }
    const page = await renderRecipesListPage(userId, {
        error: message,
        openModalId: opts.openModalId,
    });
    return { html: page.html, status: 400 as const };
}

recipesRoutes.get("/recipes", requireSiteUser, async (c) => {
    const page = await renderRecipesListPage(c.get("userId"), {
        tag: c.req.query("tag") ?? "",
        canMakeNow: c.req.query("can_make_now") === "1",
        safeFor: c.req.query("safe_for") ?? "",
    });
    return c.html(page.html, page.status);
});

recipesRoutes.post("/recipes", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    try {
        const recipe = await createRecipe(liveRecipesStore(), {
            householdId: member.householdId,
            creatorId: userId,
            name: formText(body, "name"),
            yieldPortions: formAmount(body, "yield_portions"),
        });
        return redirectWithToast(c, `/recipes/${recipe.id}`, "recipes.created");
    } catch (err) {
        const page = await recipeFormError(userId, null, err, {
            openModalId: "recipe-new",
        });
        return c.html(page.html, page.status);
    }
});

recipesRoutes.get("/recipes/:id", requireSiteUser, async (c) => {
    const page = await renderRecipeDetailRoute(
        c.get("userId"),
        c.req.param("id"),
        {
            member: c.req.query("member"),
        },
    );
    return c.html(page.html, page.status);
});

recipesRoutes.post("/recipes/:id/log-portion", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    const portions = formAmount(body, "portions");
    const mealTypeRaw = formText(body, "meal_type").trim().toLowerCase();
    const meal_type =
        mealTypeRaw === "breakfast" ||
        mealTypeRaw === "lunch" ||
        mealTypeRaw === "dinner" ||
        mealTypeRaw === "snack"
            ? mealTypeRaw
            : "snack";
    try {
        const { built, specs } = await resolveAndBuildMeal({
            householdId: member.householdId,
            foods: liveFoodsStore(),
            recipes: liveRecipesStore(),
            items: [{ recipeId, portions }],
        });
        await insertMeal(userId, {
            description: descriptionFromItems(built.items),
            meal_type,
            calories: built.totals.calories ?? undefined,
            protein_g: built.totals.protein_g ?? undefined,
            carbs_g: built.totals.carbs_g ?? undefined,
            fat_g: built.totals.fat_g ?? undefined,
            fiber_g: built.totals.fiber_g ?? undefined,
            sugar_g: built.totals.sugar_g ?? undefined,
            alcohol_g: built.totals.alcohol_g ?? undefined,
            caffeine_mg: built.totals.caffeine_mg ?? undefined,
            items: built.items.map((item) =>
                snapshotToMealItemWrite(item, member.householdId),
            ),
            item_digest: itemListDigest(specs),
        });
        return redirectWithToast(c, "/", "recipes.portion.logged");
    } catch (err) {
        const page = await recipeFormError(
            userId,
            recipeId,
            err instanceof MealItemsError ? err : err,
            { member: formText(body, "member") || undefined },
        );
        return c.html(page.html, page.status);
    }
});

recipesRoutes.post("/recipes/:id/cook", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    const mealTypeRaw = formText(body, "meal_type").trim().toLowerCase();
    const meal_type =
        mealTypeRaw === "breakfast" ||
        mealTypeRaw === "lunch" ||
        mealTypeRaw === "dinner" ||
        mealTypeRaw === "snack"
            ? mealTypeRaw
            : "dinner";
    const deductStock = formText(body, "deduct_stock") === "1";
    const logMeals = formText(body, "log_meals") === "1";
    try {
        const householdMembers = await listHouseholdMembers(member.householdId);
        const portions: { userId: string; portions: number }[] = [];
        for (const person of householdMembers) {
            const raw = formText(body, `portion:${person.userId}`).trim();
            if (!raw) continue;
            const count = Number(raw);
            if (!Number.isFinite(count) || count <= 0) continue;
            portions.push({ userId: person.userId, portions: count });
        }
        const totalPortions = resolveTotalPortions(
            portions.reduce((sum, row) => sum + row.portions, 0),
            formOptionalNumber(body, "total_portions"),
        );
        await cookRecipe(
            liveRecipesStore(),
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                recipeId,
                totalPortions,
                deductStock,
                actorUserId: userId,
            },
        );
        if (logMeals) {
            for (const row of portions) {
                const { built, specs } = await resolveAndBuildMeal({
                    householdId: member.householdId,
                    foods: liveFoodsStore(),
                    recipes: liveRecipesStore(),
                    items: [{ recipeId, portions: row.portions }],
                });
                await insertMeal(row.userId, {
                    description: descriptionFromItems(built.items),
                    meal_type,
                    calories: built.totals.calories ?? undefined,
                    protein_g: built.totals.protein_g ?? undefined,
                    carbs_g: built.totals.carbs_g ?? undefined,
                    fat_g: built.totals.fat_g ?? undefined,
                    fiber_g: built.totals.fiber_g ?? undefined,
                    sugar_g: built.totals.sugar_g ?? undefined,
                    alcohol_g: built.totals.alcohol_g ?? undefined,
                    caffeine_mg: built.totals.caffeine_mg ?? undefined,
                    items: built.items.map((item) =>
                        snapshotToMealItemWrite(item, member.householdId),
                    ),
                    item_digest: itemListDigest(specs),
                });
            }
        }
        return redirectWithToast(c, `/recipes/${recipeId}`, "recipes.cooked");
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: `recipe-cook-${recipeId}`,
        });
        return c.html(page.html, page.status);
    }
});

recipesRoutes.post("/recipes/:id", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    try {
        const prepRaw = formText(body, "prep_minutes").trim();
        const cookRaw = formText(body, "cook_minutes").trim();
        await updateRecipe(liveRecipesStore(), member.householdId, recipeId, {
            name: formText(body, "name"),
            yieldPortions: formAmount(body, "yield_portions"),
            instructions: formText(body, "instructions"),
            sourceUrl: formText(body, "source_url"),
            tags: formText(body, "tags").split(","),
            notes: formText(body, "notes"),
            prepMinutes: prepRaw === "" ? null : Number(prepRaw),
            cookMinutes: cookRaw === "" ? null : Number(cookRaw),
        });
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: `recipe-edit-${recipeId}`,
        });
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, `/recipes/${recipeId}`, "recipes.updated");
});

recipesRoutes.post(
    "/recipes/:id/ingredients/:ingredientId/delete",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        try {
            await removeRecipeIngredient(
                liveRecipesStore(),
                member.householdId,
                recipeId,
                c.req.param("ingredientId"),
            );
        } catch (err) {
            const page = await recipeFormError(userId, recipeId, err, {
                openModalId: `recipe-delete-ingredient-${c.req.param("ingredientId")}`,
            });
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            "recipes.ingredient.removed",
        );
    },
);

recipesRoutes.post(
    "/recipes/:id/ingredients/:ingredientId/move",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        const ingredientId = c.req.param("ingredientId");
        const body = await c.req.parseBody();
        try {
            const store = liveRecipesStore();
            const ingredients = await store.listIngredients(
                member.householdId,
                recipeId,
            );
            const index = ingredients.findIndex(
                (row) => row.id === ingredientId,
            );
            if (index < 0) throw new RecipeInputError("Unknown ingredient.");
            const direction = formText(body, "direction");
            const swapWith = direction === "up" ? index - 1 : index + 1;
            if (swapWith < 0 || swapWith >= ingredients.length) {
                return redirectWithToast(
                    c,
                    `/recipes/${recipeId}`,
                    "recipes.ingredient.reordered",
                );
            }
            const ids = ingredients.map((row) => row.id);
            const tmp = ids[index]!;
            ids[index] = ids[swapWith]!;
            ids[swapWith] = tmp;
            await reorderRecipeIngredients(
                store,
                member.householdId,
                recipeId,
                ids,
            );
        } catch (err) {
            const page = await recipeFormError(userId, recipeId, err);
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            "recipes.ingredient.reordered",
        );
    },
);

recipesRoutes.post(
    "/recipes/:id/ingredients/:ingredientId",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        const body = await c.req.parseBody();
        try {
            await updateRecipeIngredient(
                liveRecipesStore(),
                member.householdId,
                recipeId,
                c.req.param("ingredientId"),
                {
                    amount: formAmount(body, "amount"),
                    note: formText(body, "note"),
                },
            );
        } catch (err) {
            const page = await recipeFormError(userId, recipeId, err, {
                openModalId: `recipe-edit-ingredient-${c.req.param("ingredientId")}`,
            });
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            "recipes.ingredient.updated",
        );
    },
);

recipesRoutes.post("/recipes/:id/delete", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    try {
        await deleteRecipe(liveRecipesStore(), member.householdId, recipeId, {
            userId,
            isOwner: member.role === "owner",
        });
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: `recipe-delete-${recipeId}`,
        });
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/recipes", "recipes.deleted");
});

recipesRoutes.post("/recipes/:id/ingredients", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    const amount = formAmount(body, "qty_amount");
    try {
        if (formText(body, "food_id")) {
            await addRecipeIngredientById(
                liveRecipesStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    recipeId,
                    foodId: formText(body, "food_id"),
                    amount,
                    unit: formText(body, "qty_unit"),
                },
            );
        } else if (formText(body, "barcode")) {
            await addRecipeIngredientByBarcode(
                liveRecipesStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    recipeId,
                    barcode: formText(body, "barcode"),
                    amount,
                    unit: formText(body, "qty_unit"),
                },
                { lookup: fridgeBarcodeLookup },
            );
        } else {
            await addRecipeManualIngredient(
                liveRecipesStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    recipeId,
                    name: formText(body, "food_name"),
                    amount,
                    unit: formText(body, "qty_unit"),
                },
            );
        }
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: `recipe-add-ingredient-${recipeId}`,
        });
        return c.html(page.html, page.status);
    }
    return redirectWithToast(
        c,
        `/recipes/${recipeId}`,
        "recipes.ingredient.added",
    );
});

recipesRoutes.post("/recipes/:id/portions", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    try {
        await setPersonPortion(liveRecipesStore(), {
            householdId: member.householdId,
            recipeId,
            userId,
            portionCount: formAmount(body, "portion_count"),
        });
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
    return redirectWithToast(
        c,
        `/recipes/${recipeId}`,
        "recipes.portion.saved",
    );
});

recipesRoutes.post("/recipes/:id/add-to-grocery", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody({ all: true });
    const selected = formMemberIds(body);
    const storeId = formText(body as Record<string, string | File>, "store_id");
    try {
        const householdMembers = await listHouseholdMembers(member.householdId);
        const allowed = new Set(householdMembers.map((row) => row.userId));
        const memberIds = selected.filter((id) => allowed.has(id));
        const recipes = liveRecipesStore();
        const portionCounts = await Promise.all(
            memberIds.map(async (id) => {
                const portion = await recipes.getPortion(
                    member.householdId,
                    recipeId,
                    id,
                );
                return portion?.portionCount ?? 1;
            }),
        );
        const fridge = await listFridge(liveFridgeStore(), member.householdId);
        const foods = await foodsByIds(liveFoodsStore(), member.householdId, [
            ...(
                await recipes.listIngredients(member.householdId, recipeId)
            ).map((row) => row.foodId),
            ...fridge.items.map((item) => item.foodId),
        ]);
        await addRecipeToGrocery({
            recipes,
            grocery: liveGroceryStore(),
            settings: liveSettingsStore(),
            fridgeItems: fridge.items.map((item) => ({
                identity: item.identity,
                quantity: item.quantity,
                foodId: item.foodId,
            })),
            householdId: member.householdId,
            recipeId,
            storeId,
            portionCounts,
            totalPortions: formOptionalNumber(
                body as Record<string, string | File>,
                "total_portions",
            ),
            foodsById: foods,
        });
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/grocery", "recipes.added-to-grocery");
});
