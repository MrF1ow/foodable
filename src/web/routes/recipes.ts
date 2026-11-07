import { Hono } from "hono";
import { renderRecipeDetailRoute, renderRecipesListPage } from "../loaders.js";

import {
    formAmount,
    formOptionalNumber,
    formRecipeIngredientAmount,
    formText,
} from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import { listFridge } from "../../domain/fridge.js";
import {
    addRecipeIngredientById,
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createRecipe,
    deleteRecipe,
    RecipeForbiddenError,
    RecipeInputError,
    RecipeUnverifiedError,
    recheckRecipe,
    removeRecipeIngredient,
    reorderRecipeIngredients,
    setPersonPortion,
    updateRecipe,
    updateRecipeIngredient,
    resolveTotalPortions,
} from "../../domain/recipes.js";
import {
    getHouseholdConfig,
    listHouseholdMembers,
} from "../../db/household.js";
import { liveSocialReaderStatusStore } from "../../db/social-readers.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import {
    findOrCreateFoodByBarcodeResult,
    linkProductPromptPath,
} from "../../domain/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { effectiveFoodsByIds } from "../../domain/foods.js";
import { insertMeal, snapshotToMealItemWrite } from "../../db/nutrition.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";
import { cookRecipe } from "../../domain/stock.js";
import {
    addRecipeToGroceryToastFlash,
    cookRecipeToastFlash,
} from "../components/toast-flash.js";
import { redirectWithToast } from "../components/toast.js";
import { truncateToastParam } from "../truncate-toast-param.js";
import {
    importOutcomeMessage,
    importOutcomeShowsPasteStep,
    importOutcomeToastKey,
    importRecipeFromUrl,
    importRecipeFromSharedText,
    importReviewCount,
} from "../../domain/recipe-import.js";
import {
    cleanRecipeLink,
    recipeSource,
    validateRecipeLink,
} from "../../domain/recipe-link.js";
import {
    recipeFetchMemory,
    recipeImportFetcher,
} from "../../recipe-url-fetcher.js";
import { run } from "../../db/sql.js";
import { IMPORT_RECIPE_MODAL_ID } from "../pages/recipes.js";

export const recipesRoutes = new Hono();

function importOriginPrefill(origin: "shared" | "pasted") {
    return origin === "shared"
        ? ({ importTextOrigin: "shared" as const } as const)
        : {};
}

async function recipeImportDeps(householdId: string) {
    const config = await getHouseholdConfig(householdId);
    return {
        recipes: liveRecipesStore(),
        foods: liveFoodsStore(),
        fetcher: recipeImportFetcher(),
        memory: recipeFetchMemory(),
        transaction: <T>(fn: () => Promise<T>) => run(async () => fn()),
        readers: config.preferences.socialReaders,
        readerStatus: liveSocialReaderStatusStore(),
    };
}

function redirectIfUnverified(
    c: Parameters<typeof redirectWithToast>[0],
    recipeId: string,
    err: unknown,
) {
    if (
        err instanceof RecipeUnverifiedError ||
        (err instanceof MealItemsError && err.code === "recipe_unverified")
    ) {
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            "recipes.unverified.blocked",
        );
    }
    return null;
}

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
        err instanceof RecipeForbiddenError ||
        err instanceof RecipeInputError ||
        err instanceof RecipeUnverifiedError
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
        verification: c.req.query("verification") ?? "",
    });
    return c.html(page.html, page.status);
});

recipesRoutes.post("/recipes/import", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const pasteStep = formText(body, "import_step") === "paste";
    const textOnly = formText(body, "text_only") === "1";
    const pinOrPageUrl = formText(body, "url");
    const websiteUrl = formText(body, "website_url").trim();
    const text = formText(body, "text");
    const credit = formText(body, "credit");
    const textOrigin =
        formText(body, "text_origin") === "shared" ? "shared" : "pasted";
    const retry = formText(body, "retry") === "1";
    const pinValidated = validateRecipeLink(pinOrPageUrl);
    const cleanedPinUrl = pinValidated.ok
        ? cleanRecipeLink(pinValidated.url)
        : pinOrPageUrl.trim();

    if (pasteStep && websiteUrl !== "") {
        const webValidated = validateRecipeLink(websiteUrl);
        if (!webValidated.ok) {
            const pinKind = pinValidated.ok
                ? recipeSource(pinValidated.url).kind
                : null;
            if (pinKind === "pinterest") {
                const page = await renderRecipesListPage(userId, {
                    openModalId: IMPORT_RECIPE_MODAL_ID,
                    importUrl: cleanedPinUrl,
                    importPasteStep: true,
                    importPasteText: text,
                    importCredit: credit,
                    importWebsiteError: "That doesn't look like a web link.",
                    importSourceKind: "pinterest",
                    importSourceLabel: "Pinterest",
                    ...importOriginPrefill(textOrigin),
                });
                return c.html(page.html, 422);
            }
        }
    }

    const importUrl = websiteUrl || pinOrPageUrl;

    if (pasteStep && websiteUrl === "" && text.trim() === "") {
        const pinValidated = validateRecipeLink(pinOrPageUrl);
        const pinKind = pinValidated.ok
            ? recipeSource(pinValidated.url).kind
            : null;
        if (pinKind === "pinterest") {
            const page = await renderRecipesListPage(userId, {
                openModalId: IMPORT_RECIPE_MODAL_ID,
                importUrl: cleanedPinUrl,
                importError: "Paste the recipe website link or the recipe.",
                importPasteStep: true,
                importSourceKind: "pinterest",
                importSourceLabel: "Pinterest",
                ...importOriginPrefill(textOrigin),
            });
            return c.html(page.html, 422);
        }
    }

    const importDeps = await recipeImportDeps(member.householdId);

    if (
        pasteStep &&
        textOnly &&
        pinOrPageUrl.trim() === "" &&
        text.trim() !== ""
    ) {
        const outcome = await importRecipeFromSharedText(importDeps, {
            householdId: member.householdId,
            creatorId: userId,
            text,
            credit: credit.trim() || undefined,
            textOrigin,
        });
        if (
            outcome.status === "imported" ||
            outcome.status === "unverified_needs_review"
        ) {
            const key =
                outcome.status === "imported"
                    ? ("recipes.import.imported" as const)
                    : importOutcomeToastKey(outcome);
            const params: Record<string, string> = {
                name: truncateToastParam(outcome.recipeName ?? "Recipe"),
                site: truncateToastParam(
                    outcome.source?.label ?? "Recipe text",
                ),
            };
            if (outcome.status === "unverified_needs_review") {
                params.count = importReviewCount(outcome.problems);
            }
            return redirectWithToast(
                c,
                `/recipes/${outcome.recipeId!}`,
                key,
                params,
            );
        }
        const page = await renderRecipesListPage(userId, {
            openModalId: IMPORT_RECIPE_MODAL_ID,
            importError: importOutcomeMessage(outcome),
            importPasteStep: true,
            importPasteText: text,
            importTextOnly: true,
            importShowRetry: outcome.fromMemory,
            ...importOriginPrefill(textOrigin),
            importSourceKind: "text",
            importSourceLabel: "Recipe text",
        });
        return c.html(page.html, 422);
    }

    let outcome = await importRecipeFromUrl(importDeps, {
        householdId: member.householdId,
        creatorId: userId,
        url: importUrl,
        text: websiteUrl ? undefined : text,
        credit: credit.trim() || undefined,
        textOrigin,
        retry,
    });
    const onPinStep =
        pasteStep &&
        websiteUrl !== "" &&
        pinValidated.ok &&
        recipeSource(pinValidated.url).kind === "pinterest";
    if (
        onPinStep &&
        outcome.status !== "imported" &&
        outcome.status !== "unverified_needs_review" &&
        outcome.status !== "duplicate"
    ) {
        // The recipe website could not be read. Fall back to the caption the
        // person pasted on the same step, under the pin's link; otherwise stay
        // on the Pinterest step with their text and creator kept.
        const websiteError = importOutcomeMessage(outcome);
        if (text.trim() !== "") {
            outcome = await importRecipeFromUrl(importDeps, {
                householdId: member.householdId,
                creatorId: userId,
                url: cleanedPinUrl,
                text,
                credit: credit.trim() || undefined,
                textOrigin,
            });
        }
        if (
            outcome.status !== "imported" &&
            outcome.status !== "unverified_needs_review" &&
            outcome.status !== "duplicate"
        ) {
            const page = await renderRecipesListPage(userId, {
                openModalId: IMPORT_RECIPE_MODAL_ID,
                importUrl: cleanedPinUrl,
                importPasteStep: true,
                importPasteText: text,
                importCredit: credit,
                importWebsiteError: websiteError,
                importWebsiteUrl: websiteUrl,
                importError:
                    text.trim() !== ""
                        ? importOutcomeMessage(outcome)
                        : undefined,
                importShowRetry: outcome.fromMemory,
                importSourceKind: "pinterest",
                importSourceLabel: "Pinterest",
                ...importOriginPrefill(textOrigin),
            });
            return c.html(page.html, 422);
        }
    }
    if (
        outcome.status === "imported" ||
        outcome.status === "unverified_needs_review"
    ) {
        const key =
            outcome.status === "imported"
                ? ("recipes.import.imported" as const)
                : importOutcomeToastKey(outcome);
        const params: Record<string, string> = {
            name: truncateToastParam(outcome.recipeName ?? "Recipe"),
            site: truncateToastParam(outcome.source?.label ?? "the web"),
        };
        if (outcome.status === "unverified_needs_review") {
            params.count = importReviewCount(outcome.problems);
        }
        return redirectWithToast(
            c,
            `/recipes/${outcome.recipeId!}`,
            key,
            params,
        );
    }
    if (outcome.status === "duplicate") {
        const page = await renderRecipesListPage(userId, {
            openModalId: IMPORT_RECIPE_MODAL_ID,
            importUrl: pinOrPageUrl,
            importDuplicateRecipeId: outcome.recipeId ?? undefined,
        });
        return c.html(page.html, 409);
    }
    // Text the person pasted (or shared) is never thrown away: when the link
    // beside it fails (invalid, 404, timeout), stay on a paste step with it.
    if (
        pasteStep &&
        text.trim() !== "" &&
        !importOutcomeShowsPasteStep(outcome.status)
    ) {
        const page = await renderRecipesListPage(userId, {
            openModalId: IMPORT_RECIPE_MODAL_ID,
            importUrl: textOnly ? pinOrPageUrl : cleanedPinUrl,
            importError: importOutcomeMessage(outcome),
            importPasteStep: true,
            importPasteText: text,
            importCredit: credit,
            importTextOnly: textOnly || !pinValidated.ok,
            importShowRetry: outcome.fromMemory,
            importSourceKind: textOnly ? "text" : outcome.source?.kind,
            importSourceLabel: textOnly ? "Recipe text" : outcome.source?.label,
            ...importOriginPrefill(textOrigin),
        });
        return c.html(page.html, 422);
    }
    const pasteRender = importOutcomeShowsPasteStep(outcome.status);
    const pasteLinkUrl = outcome.source?.url ?? cleanedPinUrl;
    const page = await renderRecipesListPage(userId, {
        openModalId: IMPORT_RECIPE_MODAL_ID,
        importUrl: pasteRender ? pasteLinkUrl : pinOrPageUrl,
        importError: importOutcomeMessage(outcome),
        importPasteStep: pasteRender,
        importPasteText: pasteRender ? text : undefined,
        importCredit: pasteRender ? credit : undefined,
        importShowRetry: outcome.fromMemory,
        importRetryDisabled: retry,
        importSourceKind: outcome.source?.kind,
        importSourceLabel: outcome.source?.label,
        ...importOriginPrefill(textOrigin),
    });
    return c.html(page.html, 422);
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
            linkProductId: c.req.query("link_product"),
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
        const blocked = redirectIfUnverified(c, recipeId, err);
        if (blocked) return blocked;
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
        const cooked = await cookRecipe(
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
        const flash = cookRecipeToastFlash(
            deductStock,
            logMeals,
            cooked.shortfalls.length,
            cooked.unmeasured.map((row) => row.displayName),
        );
        if (!flash) {
            // toast: none (no-op)
            return c.redirect(`/recipes/${recipeId}`, 303);
        }
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            flash.key,
            flash.params,
        );
    } catch (err) {
        const blocked = redirectIfUnverified(c, recipeId, err);
        if (blocked) return blocked;
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
            // Steps have their own form (/instructions); a form without
            // the field must not clear them.
            instructions:
                "instructions" in body
                    ? formText(body, "instructions")
                    : undefined,
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

recipesRoutes.post("/recipes/:id/instructions", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    try {
        await updateRecipe(liveRecipesStore(), member.householdId, recipeId, {
            instructions: formText(body, "instructions"),
        });
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: `recipe-method-${recipeId}`,
        });
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, `/recipes/${recipeId}`, "recipes.steps.saved");
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
                // toast: none (no-op)
                return c.redirect(`/recipes/${recipeId}`, 303);
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
                    amount: formRecipeIngredientAmount(body, "ing_amount"),
                    unit: formText(body, "ing_unit"),
                    note: formText(body, "note"),
                },
                liveFoodsStore(),
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
    const amount = formRecipeIngredientAmount(body, "qty_amount");
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
            const foods = liveFoodsStore();
            const { food, created } = await findOrCreateFoodByBarcodeResult(
                foods,
                member.householdId,
                formText(body, "barcode"),
                fridgeBarcodeLookup,
            );
            await addRecipeIngredientById(liveRecipesStore(), foods, {
                householdId: member.householdId,
                recipeId,
                foodId: food.id,
                amount,
                unit: formText(body, "qty_unit"),
            });
            if (created) {
                const catalog = await foods.listFoods(member.householdId);
                const prompt = linkProductPromptPath(
                    food,
                    catalog,
                    `/recipes/${recipeId}`,
                );
                if (prompt) {
                    // toast: none (link-product prompt on destination)
                    return c.redirect(prompt, 303);
                }
            }
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
        const foods = await effectiveFoodsByIds(
            liveFoodsStore(),
            member.householdId,
            [
                ...(
                    await recipes.listIngredients(member.householdId, recipeId)
                ).map((row) => row.foodId),
                ...fridge.items.map((item) => item.foodId),
            ],
        );
        const added = await addRecipeToGrocery({
            recipes,
            grocery: liveGroceryStore(),
            settings: liveSettingsStore(),
            fridgeItems: fridge.items.map((item) => ({
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
            foods: liveFoodsStore(),
        });
        const flash = addRecipeToGroceryToastFlash(added.added.length);
        return redirectWithToast(c, "/grocery", flash.key, flash.params);
    } catch (err) {
        const blocked = redirectIfUnverified(c, recipeId, err);
        if (blocked) return blocked;
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
});

recipesRoutes.post("/recipes/:id/verify", requireMember, async (c) => {
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    try {
        const checked = await recheckRecipe(
            liveRecipesStore(),
            member.householdId,
            recipeId,
        );
        if (checked.verified) {
            return redirectWithToast(
                c,
                `/recipes/${recipeId}`,
                "recipes.verify.passed",
            );
        }
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            "recipes.verify.failed",
            { count: String(checked.problems.length) },
        );
    } catch (err) {
        if (err instanceof RecipeInputError) {
            return redirectWithToast(c, "/recipes", "recipes.not_found");
        }
        throw err;
    }
});
