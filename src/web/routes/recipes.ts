import { Hono, type Context } from "hono";
import {
    loadCookPreview,
    renderDashboardPage,
    renderRecipeCompareRoute,
    renderRecipeDetailRoute,
    renderRecipesListPage,
} from "../loaders.js";

import {
    compactFormFields,
    formAmount,
    formOptionalNumber,
    formText,
    isSimilarFoodsError,
    manualOnSimilar,
    rememberAliasIfRequested,
} from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import {
    addRecipeIngredientById,
    addRecipeManualIngredient,
    assertCanDeleteRecipe,
    deleteRecipe,
    editRecipeIngredient,
    isRecipeDraft,
    RecipeEditBreaksCheckError,
    RecipeForbiddenError,
    removeRecipeIngredient,
    resolveLineAsIngredient,
    toTasteNote,
    measuredNote,
    resolveUnresolvedLines,
    saveRecipeDraft,
    RecipeInputError,
    RecipeUnverifiedError,
    type RecipeLineFood,
} from "../../domain/recipes.js";
import {
    getHouseholdConfig,
    getHouseholdMembership,
    listHouseholdMembers,
} from "../../db/household.js";
import { can } from "../../domain/permissions.js";
import { liveSocialReaderStatusStore } from "../../db/social-readers.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import {
    liveRecipesStore,
    liveRecipeVariantsStore,
    recipeAlignTransaction,
} from "../../db/recipes.js";
import {
    alignChange,
    clearRecipeVariant,
    compareVersions,
    previewReset,
    resetVariant,
    setRecipeVariant,
    VARIANT_ACTIONS,
    type VariantAction,
} from "../../domain/recipe-variants.js";
import { liveSettingsStore } from "../../db/settings.js";
import { inStockTransaction, liveStockStore } from "../../db/stock.js";
import { deleteMeal, insertMeal } from "../../db/nutrition.js";
import { getProfile } from "../../db/profiles.js";
import { mealWriteFromItems } from "../../meal-write.js";
import { guessMealType, validateTz } from "../../domain/tz.js";
import {
    COOK_SHEET_ID,
    cookPreviewChanges,
    parseExpectedCook,
    renderCookPreviewRegion,
    type CookSlot,
} from "../pages/v2/recipes-page-cook.js";
import { MealItemsError } from "../../domain/meals.js";
import { cookClaimId, cookRecipe } from "../../domain/stock.js";
import { buildDidYouMeanModal } from "../components/did-you-mean.js";
import { cookSheetToastFlash } from "../components/toast-flash.js";
import { redirectWithToast } from "../components/toast.js";
import { safeReturnPath } from "../usual-products-path.js";
import { truncateToastParam } from "../truncate-toast-param.js";
import {
    importOutcomeMessage,
    importOutcomeParts,
    importOutcomeShowsPasteStep,
    importRecipeFromUrl,
    importRecipeFromSharedText,
    RECIPE_DRAFT_REFUSAL,
} from "../../domain/recipe-import.js";
import {
    cleanRecipeLink,
    recipeSource,
    validateRecipeLink,
} from "../../domain/recipe-link.js";
import {
    RECIPE_LINK_READER_PAUSED_WEB_MESSAGE,
    recipeFetchMemory,
    recipeImportFetcher,
    linkImportPaused,
    recipeLinkReaderEnabled,
} from "../../recipe-url-fetcher.js";
import { run } from "../../db/sql.js";
import { looksLikeSharedRecipeLink } from "../../domain/sharing-source.js";
import { viewerFlagsFor } from "../attention.js";
import {
    addMentionedIngredient,
    dismissFlaggedMention,
} from "../../domain/recipe-mentions-check.js";
import { parseFilterParam } from "../../domain/recipe-filters.js";
import { answerSharedRecipeImport } from "./recipes-shared-import.js";
import { recipesListV2Href } from "../pages/v2/recipes-list.js";
import {
    INGREDIENT_ADD_SHEET_ID,
    ingredientSheetId,
    recipeViewHref,
    resolveSheetId,
} from "../pages/v2/recipes-page-ingredients.js";
import {
    parsePlanBack,
    PLAN_SHEET_ID,
    planBackPath,
    planDayLabel,
    PLAN_SLOT_LABEL,
    type PlanEditDraft,
} from "../pages/v2/recipes-plan.js";
import {
    checkPlanServingsCapped,
    defaultPlanServings,
    planRecipe,
    PlanInputError,
    parseRuleEntryId,
    unplanRecipe,
    updatePlannedRecipe,
} from "../../domain/plan.js";
import {
    addMissingToGroceries,
    addPlanDays,
    missingForPlan,
    pickMissingLines,
    WEEK_PLAN_DAYS,
} from "../../domain/plan-week.js";
import { householdToday } from "../../db/restock.js";
import { addGroceryFoodById, GroceryInputError } from "../../domain/grocery.js";
import { liveNotifier } from "../../db/notify.js";
import { liveRecipePlansStore, planTransaction } from "../../db/plans.js";
import { loadWeekPlanInputs } from "../loaders-plan.js";

export const recipesRoutes = new Hono();

/** The import sheet's error card: the outcome's headline and, if it has one, its reason. */
function importErrorOf(outcome: Parameters<typeof importOutcomeParts>[0]): {
    importError: string;
    importErrorReason?: string;
} {
    const { headline, reason } = importOutcomeParts(outcome);
    return reason
        ? { importError: headline, importErrorReason: reason }
        : { importError: headline };
}

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
        fetcher: await recipeImportFetcher({ householdId }),
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

async function recipeFormError(
    userId: string,
    recipeId: string,
    err: unknown,
    opts: {
        openModalId?: string;
        servings?: number;
        plan?: {
            date?: string;
            slot?: string;
            servings?: number;
            repeat?: string;
            days?: number[];
        };
        /** The member whose version the page shows again (a cook that failed). */
        version?: string;
        /** A refused Save on the importer's landing keeps the leave guard. */
        imported?: boolean;
    } = {},
) {
    const message =
        err instanceof RecipeForbiddenError ||
        err instanceof RecipeInputError ||
        err instanceof RecipeUnverifiedError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update the recipe.";
    const page = await renderRecipeDetailRoute(userId, recipeId, {
        error: message,
        openModalId: opts.openModalId,
        cookServings: opts.servings,
        plan: opts.plan,
        member: opts.version,
        imported: opts.imported,
    });
    const status = err instanceof RecipeForbiddenError ? 403 : (400 as const);
    return { html: page.html, status: status as 400 | 403 };
}

recipesRoutes.get("/recipes", requireSiteUser, async (c) => {
    const page = await renderRecipesListPage(c.get("userId"), {
        q: c.req.query("q") ?? "",
        filter: c.req.query("filter") ?? "",
        planDate: c.req.query("plan_date") ?? "",
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

    // A link to a recipe another Foodable shared is that deploy's document,
    // not a recipe website: the household app reads it with the shared-recipe
    // importer while `mcp-share-links` is on. With the flag off, a pasted share
    // link is read as any other URL.
    if (!pasteStep && looksLikeSharedRecipeLink(importUrl)) {
        const flags = await viewerFlagsFor(member);
        if (flags.mcpShareLinks) {
            return answerSharedRecipeImport(c, importUrl, "field");
        }
    }

    if (pasteStep && websiteUrl === "" && text.trim() === "") {
        const pinValidated = validateRecipeLink(pinOrPageUrl);
        const pinKind = pinValidated.ok
            ? recipeSource(pinValidated.url).kind
            : null;
        if (pinKind === "pinterest") {
            const page = await renderRecipesListPage(userId, {
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
            // toast: none — the recipe page shows what came in
            return c.redirect(`/recipes/${outcome.recipeId!}?imported=1`, 303);
        }
        const page = await renderRecipesListPage(userId, {
            ...importErrorOf(outcome),
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

    if (
        importUrl.trim() !== "" &&
        linkImportPaused({
            text,
            readerEnabled: await recipeLinkReaderEnabled(member.householdId),
        })
    ) {
        const importLinkValidated = validateRecipeLink(importUrl);
        const pausedUrl = importLinkValidated.ok
            ? cleanRecipeLink(importLinkValidated.url)
            : pinOrPageUrl;
        const linkInfo = importLinkValidated.ok
            ? recipeSource(importLinkValidated.url)
            : null;
        const page = await renderRecipesListPage(userId, {
            importUrl: pausedUrl,
            importError: RECIPE_LINK_READER_PAUSED_WEB_MESSAGE,
            importPasteStep: true,
            importPasteText: text.trim() !== "" ? text : undefined,
            importCredit: credit,
            importSourceKind: linkInfo?.kind,
            importSourceLabel: linkInfo?.label,
            ...importOriginPrefill(textOrigin),
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
                importUrl: cleanedPinUrl,
                importPasteStep: true,
                importPasteText: text,
                importCredit: credit,
                importWebsiteError: websiteError,
                importWebsiteUrl: websiteUrl,
                ...(text.trim() !== "" ? importErrorOf(outcome) : {}),
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
        // toast: none — the recipe page shows what came in
        return c.redirect(`/recipes/${outcome.recipeId!}?imported=1`, 303);
    }
    if (outcome.status === "duplicate") {
        const page = await renderRecipesListPage(userId, {
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
            importUrl: textOnly ? pinOrPageUrl : cleanedPinUrl,
            ...importErrorOf(outcome),
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
        importUrl: pasteRender ? pasteLinkUrl : pinOrPageUrl,
        ...importErrorOf(outcome),
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

recipesRoutes.get("/recipes/:id", requireSiteUser, async (c) => {
    const page = await renderRecipeDetailRoute(
        c.get("userId"),
        c.req.param("id"),
        {
            member: c.req.query("member"),
            openCook: c.req.query("cook") === "1",
            imported: c.req.query("imported") === "1",
            openIngredient: c.req.query("ingredient"),
            openAdd: c.req.query("add") === "1",
            plan: {
                open: c.req.query("plan") === "1",
                date: c.req.query("date"),
            },
        },
    );
    return c.html(page.html, page.status);
});

/** Compare versions: the owner's and admins' page. A member is refused on the recipe. */
recipesRoutes.get("/recipes/:id/compare", requireSiteUser, async (c) => {
    const page = await renderRecipeCompareRoute(
        c.get("userId"),
        c.req.param("id"),
        { openFor: c.req.query("make") },
    );
    return c.html(page.html, page.status);
});

/** The most servings the cook sheet takes in one go. */
const COOK_SERVINGS_MAX = 999;

const COOK_SLOTS: readonly CookSlot[] = [
    "breakfast",
    "lunch",
    "dinner",
    "snack",
];

/**
 * The member whose version a cook is for, from the sheet's `version` field or
 * the preview's address. A person who is not in the household names no
 * version, so the base is cooked.
 */
async function cookVersionOf(
    householdId: string,
    raw: string,
): Promise<string | undefined> {
    const id = raw.trim();
    if (!UUID_SHAPE.test(id)) return undefined;
    const membership = await getHouseholdMembership(id, householdId);
    return membership?.userId;
}

async function cookPreviewResponse(c: Context, versionRaw: string) {
    const member = siteMember(c);
    const servings = Number(c.req.query("servings") ?? "");
    c.header("Cache-Control", "no-store");
    if (!Number.isFinite(servings) || servings <= 0) {
        return c.html(
            renderCookPreviewRegion(null, "Enter servings greater than zero."),
            400,
        );
    }
    if (servings > COOK_SERVINGS_MAX) {
        return c.html(
            renderCookPreviewRegion(
                null,
                `Keep it to ${COOK_SERVINGS_MAX} servings or fewer.`,
            ),
            400,
        );
    }
    const { preview, error, places } = await loadCookPreview(
        member.householdId,
        c.req.param("id") ?? "",
        servings,
        await cookVersionOf(member.householdId, versionRaw),
    );
    return c.html(
        renderCookPreviewRegion(preview, error, places),
        preview ? 200 : 400,
    );
}

recipesRoutes.get("/recipes/:id/cook/preview", requireMember, (c) =>
    cookPreviewResponse(c, ""),
);

/** The same preview for one member's version: the sheet's address carries who. */
recipesRoutes.get("/recipes/:id/cook/preview/:version", requireMember, (c) =>
    cookPreviewResponse(c, c.req.param("version") ?? ""),
);

/**
 * The cook sheet's Cook button: cook the recipe for `servings` portions (the
 * same `cookRecipe` the old form runs), then, with the switch on, log one
 * portion of it to the viewer under the sheet's slot.
 *
 * With the switch on, the meal is written first and its idempotency key,
 * `cook:<recipe>:<submit_key>`, is what claims the submit: the write is atomic,
 * so of two requests carrying the same sheet only one inserts, and the other
 * sees `deduplicated` and cooks nothing. Cooking comes second; if it throws,
 * the meal just inserted is deleted again, so a failed cook leaves neither a
 * logged serving nor a taken ingredient, and a retry from the re-rendered sheet
 * starts clean. A meal that cannot be built (an unverified recipe, say) fails
 * before anything is written.
 *
 * With the switch off there is no meal to claim the submit, so the key claims
 * the cook itself: it names the ledger rows the cook writes
 * (`cookRecipe`'s `submitKey`), and a second request for the same sheet finds
 * them and takes nothing. The whole cook is one transaction, so a throw part
 * way through leaves every ingredient as it was and a request that loses the
 * race to the same sheet is rolled back whole and answered as a repeat.
 */
recipesRoutes.post("/recipes/:id/cook/confirm", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    const servings = formAmount(body, "servings");
    const logServing = formText(body, "log_serving") === "1";
    const submitKey = formText(body, "submit_key")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 64);
    // The version the sheet cooked, and so the one the page shows again: the
    // person it named, or the base when it named nobody.
    const cookedVersion = () =>
        cookVersionOf(member.householdId, formText(body, "version")).catch(
            () => undefined,
        );
    const backTo = async () =>
        `/recipes/${recipeId}?member=${encodeURIComponent((await cookedVersion()) ?? "base")}`;
    // The meal this request inserted, to take back if the cook fails.
    let insertedMealId: string | null = null;
    // With a meal, its key claims the submit; without one the cook does.
    const cookKey = !logServing && submitKey ? submitKey : null;
    try {
        if (!Number.isFinite(servings) || servings <= 0) {
            throw new RecipeInputError("Enter servings greater than zero.");
        }
        if (servings > COOK_SERVINGS_MAX) {
            throw new RecipeInputError(
                `Keep it to ${COOK_SERVINGS_MAX} servings or fewer.`,
            );
        }
        const profile = await getProfile(userId);
        const slotRaw = formText(body, "meal_type").trim().toLowerCase();
        const slot: CookSlot =
            COOK_SLOTS.find((s) => s === slotRaw) ??
            (guessMealType(
                profile?.timezone && validateTz(profile.timezone)
                    ? profile.timezone
                    : "UTC",
            ) as CookSlot);
        // Whose version the sheet cooked: that person's amounts come off the
        // kitchen. The portion logged for the viewer is worked out from the
        // viewer's own version (the base when they have none), as
        // `cook_recipe` logs each person from their own.
        const version = await cookedVersion();
        const meal = logServing
            ? await mealWriteFromItems(
                  member.householdId,
                  [{ recipeId, portions: 1 }],
                  undefined,
                  userId,
              )
            : null;
        // What this cook is about to take, to compare with what the sheet
        // showed. A recipe it cannot plan fails in cookRecipe below.
        const { preview } = await loadCookPreview(
            member.householdId,
            recipeId,
            servings,
            version,
        );
        const changedNames = preview
            ? cookPreviewChanges(
                  parseExpectedCook(formText(body, "expected")),
                  preview,
              )
            : [];
        if (meal) {
            const inserted = await insertMeal(userId, {
                description: meal.description,
                meal_type: slot,
                ...meal.totals,
                items: meal.items,
                item_digest: meal.item_digest,
                idempotency_key: submitKey
                    ? `cook:${recipeId}:${submitKey}`
                    : undefined,
            });
            if (inserted.deduplicated) {
                // toast: none
                return c.redirect(await backTo(), 303);
            }
            insertedMealId = inserted.meal.id;
        }
        const cooked = await inStockTransaction(() =>
            cookRecipe(
                liveRecipesStore(),
                liveFridgeStore(),
                liveStockStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    recipeId,
                    totalPortions: servings,
                    deductStock: true,
                    actorUserId: userId,
                    submitKey: cookKey,
                    ...(version
                        ? {
                              memberPortions: [
                                  { userId: version, portions: servings },
                              ],
                              variants: liveRecipeVariantsStore(),
                          }
                        : {}),
                },
            ),
        );
        if (cooked.alreadyCooked) {
            // toast: none
            return c.redirect(await backTo(), 303);
        }
        const flash = cookSheetToastFlash({
            shortNames: cooked.shortfalls.map((row) => row.displayName),
            unmeasuredNames: cooked.unmeasured.map((row) => row.displayName),
            changedNames,
        });
        if (flash) {
            return redirectWithToast(
                c,
                await backTo(),
                flash.key,
                flash.params,
            );
        }
        // toast: none — the recipe page and Today show what was cooked
        return c.redirect(await backTo(), 303);
    } catch (err) {
        // A request for the same sheet that got in first has cooked by now
        // (this one was rolled back against it): that is a repeat, not an
        // error to show.
        if (
            cookKey &&
            (await liveStockStore()
                .hasMovement(
                    member.householdId,
                    cookClaimId(member.householdId, recipeId, cookKey),
                )
                .catch(() => false))
        ) {
            // toast: none
            return c.redirect(await backTo(), 303);
        }
        if (insertedMealId) {
            try {
                await deleteMeal(userId, insertedMealId);
            } catch (undoErr) {
                console.error(
                    "cook confirm: could not remove the meal after a failed cook",
                    undoErr,
                );
            }
        }
        const blocked = redirectIfUnverified(c, recipeId, err);
        if (blocked) return blocked;
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: COOK_SHEET_ID,
            servings: Number.isFinite(servings) ? servings : undefined,
            // The base stays the base: a resubmit cooks what was chosen.
            version: (await cookedVersion()) ?? "base",
        });
        return c.html(page.html, page.status);
    }
});

const UUID_SHAPE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The star on a recipe card or page. The form says which state to move to
 * (`on`), so a double submit cannot flip it back; the viewer's own favourites
 * are all it ever touches. The way back is built here from the search and
 * filter the list was showing, never from an address in the form.
 */
recipesRoutes.post("/recipes/:id/favourite", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    const recipe = await liveRecipesStore().getRecipe(
        member.householdId,
        recipeId,
    );
    if (!recipe) return c.text("Not found", 404);
    // A draft is not in the list yet: Save it first.
    if (isRecipeDraft(recipe)) return c.text(RECIPE_DRAFT_REFUSAL, 409);
    const found = await liveRecipesStore().setFavourite(
        member.householdId,
        userId,
        recipeId,
        formText(body, "on") === "1",
    );
    if (!found) return c.text("Not found", 404);
    if (formText(body, "back") === "list") {
        const list = recipesListV2Href({
            q: formText(body, "q"),
            filters: parseFilterParam(formText(body, "filter")),
        });
        // toast: none (the star shows the new state)
        return c.redirect(`${list}#recipe-${recipeId}`, 303);
    }
    // toast: none (the star shows the new state)
    return c.redirect(`/recipes/${recipeId}`, 303);
});

/**
 * An ingredient's Add to grocery list, from its ⋯ on the recipe page: the
 * food goes on the list as `add_grocery_line` with only its `food_id` would
 * (its usual amount and store, folded into an unticked line for the food),
 * and the person stays on the recipe. A draft
 * cannot be put on the list; a food that is not one of the recipe's
 * ingredients is a 404.
 */
recipesRoutes.post(
    "/recipes/:id/ingredients/:foodId/add-to-grocery",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        const foodId = c.req.param("foodId");
        if (!UUID_SHAPE.test(recipeId) || !UUID_SHAPE.test(foodId)) {
            return c.text("Not found", 404);
        }
        const recipes = liveRecipesStore();
        const recipe = await recipes.getRecipe(member.householdId, recipeId);
        if (!recipe) return c.text("Not found", 404);
        // A draft is not on the list yet: Save it first.
        if (isRecipeDraft(recipe)) return c.text(RECIPE_DRAFT_REFUSAL, 409);
        const ingredients = await recipes.listIngredients(
            member.householdId,
            recipeId,
        );
        if (!ingredients.some((row) => row.foodId === foodId)) {
            return c.text("Not found", 404);
        }
        try {
            await addGroceryFoodById(
                liveGroceryStore(),
                liveSettingsStore(),
                liveFoodsStore(),
                // An unticked line for the food is the one this lands on, as
                // `add_grocery_line` does; the page shows it as on the list.
                { householdId: member.householdId, foodId, reuseListed: true },
            );
        } catch (err) {
            if (!(err instanceof GroceryInputError)) throw err;
            const page = await recipeFormError(userId, recipeId, err);
            return c.html(page.html, page.status);
        }
        // Back on the view it was posted from (the base, or the viewer's own
        // version).
        const body = await c.req.parseBody();
        // toast: none (the row reads "On the list")
        return c.redirect(recipeViewHref(recipeId, sheetMember(body)), 303);
    },
);

/**
 * Add the food a warning names to the recipe, with the amount and note its step
 * gave, at once. A food that is no longer flagged (added, dismissed, or on a
 * recipe nobody checks) goes back to the page with a toast saying so.
 */
recipesRoutes.post("/recipes/:id/mentions/add", requireMember, async (c) => {
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const recipe = await liveRecipesStore().getRecipe(
        member.householdId,
        recipeId,
    );
    if (!recipe) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    try {
        await addMentionedIngredient(
            { recipes: liveRecipesStore(), foods: liveFoodsStore() },
            member.householdId,
            recipeId,
            formText(body, "key"),
        );
        // toast: none
        return c.redirect(`/recipes/${recipeId}`, 303);
    } catch (err) {
        if (!(err instanceof RecipeInputError)) throw err;
        // A saved recipe that the line would break: answer in place with
        // what it would break, like every other refused edit.
        if (err instanceof RecipeEditBreaksCheckError) {
            const page = await recipeFormError(member.userId, recipeId, err);
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            "recipes.mention.error",
            { message: truncateToastParam(err.message) },
        );
    }
});

/** Stop warning about a food on this recipe. It never touches the ingredients. */
recipesRoutes.post(
    "/recipes/:id/mentions/dismiss",
    requireMember,
    async (c) => {
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
        const recipe = await liveRecipesStore().getRecipe(
            member.householdId,
            recipeId,
        );
        if (!recipe) return c.text("Not found", 404);
        const body = await c.req.parseBody();
        try {
            await dismissFlaggedMention(
                { recipes: liveRecipesStore(), foods: liveFoodsStore() },
                member.householdId,
                recipeId,
                formText(body, "key"),
            );
        } catch (err) {
            if (!(err instanceof RecipeInputError)) throw err;
            return redirectWithToast(
                c,
                `/recipes/${recipeId}`,
                "recipes.mention.error",
                { message: truncateToastParam(err.message) },
            );
        }
        // toast: none (the card is gone)
        return c.redirect(`/recipes/${recipeId}`, 303);
    },
);

/**
 * A sheet's amount: blank or 0 is "to taste" (no amount), a figure above zero
 * is the amount, anything else is refused.
 */
function sheetAmount(body: Record<string, string | File>): number | null {
    const raw = formText(body, "amount").trim();
    if (raw === "") return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new RecipeInputError("Enter an amount of 0 or more.");
    }
    return amount === 0 ? null : amount;
}

/** The food a sheet names: the one picked from the similar foods, else the typed name. */
function sheetFood(
    body: Record<string, string | File>,
): RecipeLineFood | undefined {
    const foodId = formText(body, "food_id").trim();
    if (foodId) return { foodId };
    const name = formText(body, "food_name").trim();
    return name ? { name, onSimilar: manualOnSimilar(body) } : undefined;
}

/** What a sheet posted, kept to show again and to post again after a similar-foods question. */
function sheetFields(
    body: Record<string, string | File>,
): Record<string, string> {
    return compactFormFields({
        amount: formText(body, "amount").trim() || undefined,
        unit: formText(body, "unit") || undefined,
        note: formText(body, "note") || undefined,
        food_name: formText(body, "food_name").trim() || undefined,
        line: formText(body, "line") || undefined,
        member: sheetMember(body),
    });
}

/**
 * The member view a sheet was opened from (`base`, or a member's id), posted
 * back with it: the redirect and a refused write's page return to that view,
 * not to the viewer's own version. Anything else is no view.
 */
function sheetMember(body: Record<string, string | File>): string | undefined {
    const member = formText(body, "member").trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(member) ? member : undefined;
}

/**
 * A refused ingredient write answers in place: the recipe page again, on the
 * view it was posted from, with the sheet that was posted open on load, holding
 * the refusal (or the similar-foods question) and what was typed.
 */
async function ingredientSheetAnswer(
    c: Context,
    userId: string,
    recipeId: string,
    sheetId: string,
    action: string,
    err: unknown,
    body: Record<string, string | File>,
) {
    const typed = sheetFields(body);
    const member = sheetMember(body);
    if (isSimilarFoodsError(err)) {
        const didYouMean = buildDidYouMeanModal(err, typed, sheetId, action);
        if (didYouMean) {
            const page = await renderRecipeDetailRoute(userId, recipeId, {
                edit: { open: sheetId, typed, didYouMean },
                member,
            });
            return c.html(page.html, page.status === 200 ? 409 : page.status);
        }
    }
    if (
        !(err instanceof RecipeInputError) &&
        !(err instanceof RecipeForbiddenError)
    ) {
        throw err;
    }
    if (
        err.message === "Unknown recipe." ||
        err.message === "Unknown ingredient."
    ) {
        return c.text("Not found", 404);
    }
    const page = await renderRecipeDetailRoute(userId, recipeId, {
        edit: { open: sheetId, error: err.message, typed },
        member,
    });
    const status = err instanceof RecipeForbiddenError ? 403 : 400;
    return c.html(page.html, page.status === 200 ? status : page.status);
}

function requireRecipeEdit(member: ReturnType<typeof siteMember>) {
    const refusal = can(member, "recipe.edit");
    if (!refusal.ok) throw new RecipeForbiddenError(refusal.reason);
}

/**
 * An ingredient sheet's Save: amount, unit, note and, when the name differs,
 * the food (`update_recipe_ingredient` and a swap). On a saved recipe an edit
 * that would make it fail the check is refused with what it would break, and
 * the sheet reopens with that.
 */
recipesRoutes.post(
    "/recipes/:id/ingredients/:ingredientId",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        const ingredientId = c.req.param("ingredientId");
        if (!UUID_SHAPE.test(recipeId) || !UUID_SHAPE.test(ingredientId)) {
            return c.text("Not found", 404);
        }
        const body = await c.req.parseBody();
        try {
            requireRecipeEdit(member);
            const amount = sheetAmount(body);
            const note = formText(body, "note").trim();
            const edited = await editRecipeIngredient(
                liveRecipesStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    recipeId,
                    ingredientId,
                    amount,
                    unit: formText(body, "unit"),
                    // "0 is to taste" (the sheet says so): the person's note
                    // stays and says it, so the check accepts the line; an
                    // amount again takes the added "to taste" back off.
                    note:
                        amount === null
                            ? toTasteNote(note)
                            : measuredNote(note),
                    food: sheetFood(body),
                },
            );
            if (edited.foodId) {
                await rememberAliasIfRequested(
                    liveFoodsStore(),
                    member.householdId,
                    body,
                    edited.foodId,
                );
            }
        } catch (err) {
            return ingredientSheetAnswer(
                c,
                userId,
                recipeId,
                ingredientSheetId(ingredientId),
                `/recipes/${recipeId}/ingredients/${ingredientId}`,
                err,
                body,
            );
        }
        // toast: none (the row shows the new words)
        return c.redirect(recipeViewHref(recipeId, sheetMember(body)), 303);
    },
);

/**
 * Remove ingredient, from its sheet's ⋯ (`remove_recipe_ingredient`). A saved
 * recipe that would fail the check without it keeps the line and says why; a
 * line already gone is the same answer as a removal.
 */
recipesRoutes.post(
    "/recipes/:id/ingredients/:ingredientId/remove",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        const ingredientId = c.req.param("ingredientId");
        if (!UUID_SHAPE.test(recipeId) || !UUID_SHAPE.test(ingredientId)) {
            return c.text("Not found", 404);
        }
        const body = await c.req.parseBody();
        try {
            requireRecipeEdit(member);
            await removeRecipeIngredient(
                liveRecipesStore(),
                member.householdId,
                recipeId,
                ingredientId,
            );
        } catch (err) {
            if (
                err instanceof RecipeInputError &&
                err.message === "Unknown ingredient."
            ) {
                // toast: none (it is already gone)
                return c.redirect(
                    recipeViewHref(recipeId, sheetMember(body)),
                    303,
                );
            }
            return ingredientSheetAnswer(
                c,
                userId,
                recipeId,
                ingredientSheetId(ingredientId),
                `/recipes/${recipeId}/ingredients/${ingredientId}`,
                err,
                body,
            );
        }
        // toast: none (the row is gone)
        return c.redirect(recipeViewHref(recipeId, sheetMember(body)), 303);
    },
);

/**
 * Add ingredient: a catalog food by id (picked from the similar foods) or by
 * the name typed, with an amount and unit (`add_recipe_ingredient`). A name
 * that looks like a food already in the catalog asks which one first, and
 * writes nothing.
 */
recipesRoutes.post("/recipes/:id/ingredients", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    try {
        requireRecipeEdit(member);
        const food = sheetFood(body);
        if (!food) throw new RecipeInputError("Enter a food name.");
        const input = {
            householdId: member.householdId,
            recipeId,
            amount: sheetAmount(body),
            unit: formText(body, "unit") || undefined,
        };
        const added =
            "foodId" in food
                ? await addRecipeIngredientById(
                      liveRecipesStore(),
                      liveFoodsStore(),
                      { ...input, foodId: food.foodId },
                  )
                : await addRecipeManualIngredient(
                      liveRecipesStore(),
                      liveFoodsStore(),
                      { ...input, name: food.name, onSimilar: food.onSimilar },
                  );
        if (added.foodId) {
            await rememberAliasIfRequested(
                liveFoodsStore(),
                member.householdId,
                body,
                added.foodId,
            );
        }
    } catch (err) {
        return ingredientSheetAnswer(
            c,
            userId,
            recipeId,
            INGREDIENT_ADD_SHEET_ID,
            `/recipes/${recipeId}/ingredients`,
            err,
            body,
        );
    }
    // toast: none (the row is on the list)
    return c.redirect(recipeViewHref(recipeId, sheetMember(body)), 303);
});

/**
 * An unreadable import line becomes an ingredient: it is added as the food
 * named, then the line is cleared and the check run again
 * (`resolveLineAsIngredient`). A refusal keeps the line, and Drop stays.
 */
recipesRoutes.post(
    "/recipes/:id/unresolved/resolve",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
        const body = await c.req.parseBody();
        const line = formText(body, "line").trim();
        try {
            requireRecipeEdit(member);
            const food = sheetFood(body);
            if (!food) throw new RecipeInputError("Enter a food name.");
            const added = await resolveLineAsIngredient(
                liveRecipesStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    recipeId,
                    line,
                    food,
                    amount: sheetAmount(body),
                    unit: formText(body, "unit") || undefined,
                },
            );
            if (added.foodId) {
                await rememberAliasIfRequested(
                    liveFoodsStore(),
                    member.householdId,
                    body,
                    added.foodId,
                );
            }
        } catch (err) {
            // The page numbers the lines the check names: the non-blank ones.
            const lines = (
                (
                    await liveRecipesStore().getImport(
                        member.householdId,
                        recipeId,
                    )
                )?.unresolvedLines ?? []
            )
                .map((l) => l.trim())
                .filter(Boolean);
            const index = lines.indexOf(line);
            if (
                index < 0 &&
                err instanceof RecipeInputError &&
                err.message === "That line is already handled."
            ) {
                // toast: none (the page shows what is left)
                return c.redirect(
                    recipeViewHref(recipeId, sheetMember(body)),
                    303,
                );
            }
            return ingredientSheetAnswer(
                c,
                userId,
                recipeId,
                index >= 0 ? resolveSheetId(index) : INGREDIENT_ADD_SHEET_ID,
                `/recipes/${recipeId}/unresolved/resolve`,
                err,
                body,
            );
        }
        // toast: none (the ingredient is on the list)
        return c.redirect(recipeViewHref(recipeId, sheetMember(body)), 303);
    },
);

/** Drop an unreadable line: the check stops asking about it. */
recipesRoutes.post("/recipes/:id/unresolved/drop", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    try {
        requireRecipeEdit(member);
        const recipe = await liveRecipesStore().getRecipe(
            member.householdId,
            recipeId,
        );
        if (!recipe) return c.text("Not found", 404);
        await resolveUnresolvedLines(
            liveRecipesStore(),
            member.householdId,
            recipeId,
            [formText(body, "line")],
        );
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            version: sheetMember(body),
        });
        return c.html(page.html, page.status);
    }
    // toast: none (the line is gone)
    return c.redirect(recipeViewHref(recipeId, sheetMember(body)), 303);
});

/**
 * Every value of a repeated form field as numbers; junk stays NaN for the
 * caller to refuse. A blank value is not a number (`Number("")` is 0), so it is
 * dropped.
 */
function formNumberList(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): number[] {
    const value = body[key];
    const all = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
    return all
        .filter(
            (item): item is string =>
                typeof item === "string" && item.trim() !== "",
        )
        .map((item) => Number(item));
}

/** Every non-blank value of a repeated form field. */
function formTextList(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): string[] {
    const value = body[key];
    const all = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
    return all
        .filter(
            (item): item is string =>
                typeof item === "string" && item.trim() !== "",
        )
        .map((item) => item.trim());
}

/** A stored plan's id, or one day of a repeat (`rule:<id>:<day>`). */
function isPlanEntryId(id: string): boolean {
    return UUID_SHAPE.test(id) || parseRuleEntryId(id) !== null;
}

/** "Sat 14 Nov · dinner", the toast's words for where a plan landed. */
function planWhen(date: string, slot: keyof typeof PLAN_SLOT_LABEL): string {
    return `${planDayLabel(date)} · ${PLAN_SLOT_LABEL[slot].toLowerCase()}`;
}

/**
 * Add to plan, from the recipe page's sheet. Planning the same recipe on the
 * same day and slot twice is one plan, so a double submit changes nothing more.
 * A bad day, meal or servings re-renders the recipe page with the sheet open.
 */
recipesRoutes.post("/recipes/:id/plan", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const recipe = await liveRecipesStore().getRecipe(
        member.householdId,
        recipeId,
    );
    if (!recipe) return c.text("Not found", 404);
    const body = await c.req.parseBody({ all: true });
    const date = formText(body, "date").trim();
    const slot = formText(body, "slot");
    const servingsInput = formOptionalNumber(body, "servings");
    // Once unless the sheet says it repeats; "days" brings its weekdays
    // (0 = Sunday), one `days` value each.
    const repeat = formText(body, "repeat") || "once";
    const days = formNumberList(body, "days");
    const memberIds = formTextList(body, "member_ids");
    try {
        // Naming people is a read of their versions: any member of the
        // household may be named.
        for (const id of memberIds) {
            if (
                !UUID_SHAPE.test(id) ||
                !(await getHouseholdMembership(id, member.householdId))
            ) {
                throw new PlanInputError(
                    "Pick people who are in the household.",
                );
            }
        }
        const memberPortions: Record<string, number> = {};
        for (const id of memberIds) {
            const saved = await liveRecipesStore().getPortion(
                member.householdId,
                recipeId,
                id.toLowerCase(),
            );
            if (saved) memberPortions[id.toLowerCase()] = saved.portionCount;
        }
        const outcome = await planRecipe(
            liveRecipePlansStore(),
            {
                householdId: member.householdId,
                recipeId,
                recipeName: recipe.name,
                recipeIsDraft: isRecipeDraft(recipe),
                recipeYield: recipe.yieldPortions,
                date,
                slot,
                servings: servingsInput,
                repeat,
                days,
                memberIds,
                memberPortions,
                today: await householdToday(member.householdId),
                createdBy: userId,
            },
            {
                transaction: planTransaction("plan-recipe", member.householdId),
                notify: liveNotifier(member.householdId, userId),
            },
        );
        if (!outcome) return c.text("Not found", 404);
        if (
            outcome.alreadyPlanned &&
            outcome.plan.servings !==
                (memberIds.length > 0
                    ? defaultPlanServings(
                          recipe.yieldPortions,
                          memberIds.map((id) => id.toLowerCase()),
                          memberPortions,
                      )
                    : (servingsInput ?? recipe.yieldPortions))
        ) {
            // Nothing was written and the servings asked for are not the ones
            // planned: say so, and where it already is. The same servings
            // again (a double submit) is the plan the page shows.
            return redirectWithToast(
                c,
                `/recipes/${recipeId}`,
                "plan.already",
                { when: planWhen(outcome.plan.date, outcome.plan.slot) },
            );
        }
        // toast: none — the recipe page shows the plan ("Planned · day · meal")
        return c.redirect(`/recipes/${recipeId}`, 303);
    } catch (err) {
        if (!(err instanceof PlanInputError)) throw err;
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: PLAN_SHEET_ID,
            plan: {
                date,
                slot,
                servings: servingsInput,
                repeat,
                days,
            },
        });
        return c.html(page.html, page.status);
    }
});

/**
 * Change a planned entry from the edit sheet on Today or Recipes: its recipe,
 * day, meal, servings and repeat (`updatePlannedRecipe`). Recipe, Day, Meal
 * and Servings change that one day; Repeat changes the series from that day
 * on. Nothing is written until the whole form checks; a form that does not
 * check re-renders the page it came from with that plan's sheet open, the
 * typed values kept and the reason shown.
 */
recipesRoutes.post("/recipes/plan/:planId/move", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody({ all: true });
    const backKind = parsePlanBack(formText(body, "back"));
    const back = planBackPath(backKind);
    const planId = c.req.param("planId");
    if (!isPlanEntryId(planId)) {
        // toast: none
        return c.redirect(back, 303);
    }
    const plans = liveRecipePlansStore();
    const existing = await plans.getPlan(member.householdId, planId);
    if (!existing) {
        // toast: none (the plan is already gone)
        return c.redirect(back, 303);
    }
    const dateInput = formText(body, "date").trim();
    const slotInput = formText(body, "slot");
    const servingsInput = formOptionalNumber(body, "servings");
    // A form from before the Recipe and Repeat rows posts neither: no change.
    const recipeInput = formText(body, "recipe_id").trim();
    const repeatInput = formText(body, "repeat").trim();
    const daysInput = formNumberList(body, "days");
    try {
        if (recipeInput !== "" && !UUID_SHAPE.test(recipeInput)) {
            throw new PlanInputError("Pick a recipe from the list.");
        }
        const today = await householdToday(member.householdId);
        // A plan for named people has no servings of its own. The sheet
        // posts the number it showed, so an unchanged one is no edit; any
        // other is refused by `updatePlannedRecipe`.
        const named = (existing.memberIds?.length ?? 0) > 0;
        const servings =
            servingsInput === undefined ||
            (named && servingsInput === existing.servings)
                ? undefined
                : checkPlanServingsCapped(servingsInput);
        // The same recipe already on that day and meal is "already planned":
        // nothing moves and nothing is added to it.
        const updated = await updatePlannedRecipe(
            plans,
            member.householdId,
            planId,
            {
                recipeId: recipeInput === "" ? undefined : recipeInput,
                date: dateInput,
                slot: slotInput,
                servings,
                repeat: repeatInput === "" ? undefined : repeatInput,
                // Weekdays go with a repeat of days only.
                days: repeatInput === "days" ? daysInput : undefined,
            },
            {
                recipes: liveRecipesStore(),
                today,
                notify: liveNotifier(member.householdId, member.userId),
                transaction: planTransaction("plan-recipe", member.householdId),
            },
        );
        if (updated?.alreadyPlanned) {
            return redirectWithToast(c, back, "plan.already", {
                when: planWhen(updated.plan.date, updated.plan.slot),
            });
        }
        // toast: none — the week shows where the plan landed (or that it is gone)
        return c.redirect(back, 303);
    } catch (err) {
        if (!(err instanceof PlanInputError)) throw err;
        const draft: PlanEditDraft = {
            planId,
            recipeId: recipeInput === "" ? undefined : recipeInput,
            date: dateInput,
            slot: slotInput,
            servings: servingsInput,
            repeat: repeatInput === "" ? undefined : repeatInput,
            days: daysInput,
            error: err.message,
        };
        // Only a plan in the week has a sheet to re-open; any other (a
        // past day's, still stored) can only be told about by a toast.
        const today = await householdToday(member.householdId);
        const inWeek =
            existing.date >= today &&
            existing.date <= addPlanDays(today, WEEK_PLAN_DAYS - 1);
        if (!inWeek) {
            return redirectWithToast(c, back, "plan.notice", {
                message: err.message,
            });
        }
        const page =
            backKind === "today"
                ? await renderDashboardPage(
                      userId,
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      { planEdit: draft },
                  )
                : await renderRecipesListPage(userId, { planEdit: draft });
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
});

/**
 * Takes a plan off the week. A day of a repeating plan (`rule:<id>:<day>`)
 * goes alone by default, or with `scope=series` the repeat ends from that
 * day on and the days before it stay.
 */
recipesRoutes.post("/recipes/plan/:planId/remove", requireMember, async (c) => {
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const back = planBackPath(parsePlanBack(formText(body, "back")));
    const planId = c.req.param("planId");
    const scope = formText(body, "scope") === "series" ? "series" : "day";
    try {
        if (isPlanEntryId(planId)) {
            await unplanRecipe(
                liveRecipePlansStore(),
                member.householdId,
                planId,
                {
                    recipes: liveRecipesStore(),
                    notify: liveNotifier(member.householdId, member.userId),
                },
                scope,
            );
        }
    } catch (err) {
        if (!(err instanceof PlanInputError)) throw err;
        return redirectWithToast(c, back, "plan.notice", {
            message: err.message,
        });
    }
    // toast: none — the week shows it gone (a plan already gone is the same)
    return c.redirect(back, 303);
});

/**
 * Change the signed-in person's own version of a recipe, one ingredient at a
 * time (`action`: remove, amount, food or add). It is always their own: the
 * form names no person. The base recipe is not touched. A change that does not
 * check re-renders the recipe page with the reason.
 */
recipesRoutes.post("/recipes/:id/variant", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    const action = formText(body, "action");
    try {
        if (!(VARIANT_ACTIONS as readonly string[]).includes(action)) {
            throw new RecipeInputError(
                `Pick what to change: ${VARIANT_ACTIONS.join(", ")}.`,
            );
        }
        await setRecipeVariant(
            liveRecipesStore(),
            liveFoodsStore(),
            liveRecipeVariantsStore(),
            {
                householdId: member.householdId,
                recipeId,
                userId,
                action: action as VariantAction,
                ingredientId: formText(body, "ingredient_id") || null,
                amount: formOptionalNumber(body, "amount"),
                unit: formText(body, "unit") || undefined,
                foodId: formText(body, "food_id") || undefined,
            },
        );
    } catch (err) {
        if (!(err instanceof RecipeInputError)) throw err;
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
    // toast: none — the page reloads on the recipe, now with the change saved
    return c.redirect(`/recipes/${recipeId}`, 303);
});

/**
 * Take back the signed-in person's own changes to a recipe: all of them, or
 * one ingredient's (`ingredient_id`). Another person's version is never
 * reached from here.
 */
recipesRoutes.post("/recipes/:id/variant/clear", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    try {
        await clearRecipeVariant(
            liveRecipesStore(),
            liveRecipeVariantsStore(),
            {
                householdId: member.householdId,
                recipeId,
                userId,
                // Left out clears the whole version; present but blank is an
                // ingredient that names nothing, which is refused, as it is
                // over MCP.
                ingredientId:
                    "ingredient_id" in body
                        ? formText(body, "ingredient_id")
                        : null,
            },
        );
    } catch (err) {
        if (!(err instanceof RecipeInputError)) throw err;
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
    // toast: none — the page reloads on the recipe, the changes taken back
    return c.redirect(`/recipes/${recipeId}`, 303);
});

/**
 * Admin and owner only (`household.align_recipe_versions`). A member is
 * refused before anything is read or written.
 */
function alignRefusal(member: {
    userId: string;
    role: Parameters<typeof can>[0]["role"];
}): RecipeForbiddenError | null {
    const allowed = can(member, "household.align_recipe_versions");
    return allowed.ok ? null : new RecipeForbiddenError(allowed.reason);
}

/**
 * Where an align or reset came from: the Compare versions page says so with
 * `back=compare`, and the answer lands there. A field, never an address.
 */
function fromComparePage(body: Parameters<typeof formText>[0]): boolean {
    return formText(body, "back") === "compare";
}

/** A refusal shown in place on the Compare versions page. */
async function compareFormError(
    userId: string,
    recipeId: string,
    err: RecipeInputError | RecipeForbiddenError,
) {
    const page = await renderRecipeCompareRoute(userId, recipeId, {
        error: err.message,
    });
    const status =
        page.status === 200
            ? err instanceof RecipeForbiddenError
                ? 403
                : 400
            : page.status;
    return { html: page.html, status: status as 400 | 403 | 404 };
}

/**
 * The compare view as data for the admin's screen: the base lines, each
 * member's differences from them (with the `ref` that names a change to
 * align) and who uses the base. JSON, no page: the screen reads it.
 */
recipesRoutes.get("/recipes/:id/versions", requireMember, async (c) => {
    const member = siteMember(c);
    const refusal = alignRefusal(member);
    if (refusal) return c.json({ error: refusal.message }, 403);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) {
        return c.json({ error: "Not found" }, 404);
    }
    const recipes = liveRecipesStore();
    const recipe = await recipes.getRecipe(member.householdId, recipeId);
    if (!recipe) return c.json({ error: "Not found" }, 404);
    const [ingredients, overrides, members] = await Promise.all([
        recipes.listIngredients(member.householdId, recipe.id),
        liveRecipeVariantsStore().listOverrides(member.householdId, recipe.id),
        listHouseholdMembers(member.householdId),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.displayName]));
    const compare = compareVersions(
        { id: recipe.id, ingredients },
        overrides,
        members.map((m) => m.userId),
    );
    const named = (userId: string) => ({
        userId,
        displayName: names.get(userId) ?? "",
    });
    return c.json({
        ...compare,
        versions: compare.versions.map((v) => ({ ...v, ...named(v.userId) })),
        usingBase: compare.usingBase.map(named),
    });
});

/**
 * Push one person's change to one ingredient into the base recipe, for
 * everyone (`user_id`, `ingredient_id`: the base ingredient, or the id of an
 * added line, as the compare read names it) and `row_key`, the `rowKey` the
 * compare read gave that change: when the person has saved it again since, it
 * is a 400 and nothing changes. The base edit and the clean-up
 * of the rows it makes redundant are one transaction. A change that no longer
 * exists, or would break the recipe's check, is a 400 and changes nothing.
 */
recipesRoutes.post("/recipes/:id/versions/align", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    try {
        const refusal = alignRefusal(member);
        if (refusal) throw refusal;
        const who = formText(body, "user_id");
        if (!UUID_SHAPE.test(who)) {
            throw new RecipeInputError("Pick whose change to use.");
        }
        await alignChange(
            {
                recipes: liveRecipesStore(),
                foods: liveFoodsStore(),
                variants: liveRecipeVariantsStore(),
                transaction: recipeAlignTransaction(recipeId),
            },
            {
                householdId: member.householdId,
                recipeId,
                userId: who,
                ref: formText(body, "ingredient_id"),
                rowKey: formText(body, "row_key"),
            },
        );
    } catch (err) {
        if (
            !(err instanceof RecipeInputError) &&
            !(err instanceof RecipeForbiddenError)
        ) {
            throw err;
        }
        if (fromComparePage(body)) {
            const page = await compareFormError(userId, recipeId, err);
            return c.html(page.html, page.status);
        }
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
    if (fromComparePage(body)) {
        // Back on Compare versions, that person's sheet open again when more
        // of their changes remain.
        // toast: none
        return c.redirect(
            `/recipes/${recipeId}/compare?make=${encodeURIComponent(formText(body, "user_id"))}`,
            303,
        );
    }
    // toast: none — the page reloads on the recipe, the base now changed
    return c.redirect(`/recipes/${recipeId}`, 303);
});

/**
 * Reset one person's version of a recipe to the base (`user_id`). It asks
 * first: without `confirm=1` nothing changes and the answer says what would
 * go (`confirmRequired`, the row count and the differences), which the screen
 * shows as the confirm in place, with `rowKeys` naming the rows it showed.
 * The confirm posts those back as `row_keys`, and exactly those rows go, and
 * no one else's: when the person's rows are no longer the ones shown (one
 * added or saved again since), nothing goes and the answer is a 400.
 */
recipesRoutes.post("/recipes/:id/versions/reset", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody({ all: true });
    // Without confirm the answer is JSON, errors included; the confirmed
    // form post answers with the recipe page, as the other forms do.
    const confirmed = formText(body, "confirm") === "1";
    if (!UUID_SHAPE.test(recipeId)) {
        return confirmed
            ? c.text("Not found", 404)
            : c.json({ error: "Not found" }, 404);
    }
    const input = {
        householdId: member.householdId,
        recipeId,
        userId: formText(body, "user_id"),
    };
    try {
        const refusal = alignRefusal(member);
        if (refusal) throw refusal;
        if (!UUID_SHAPE.test(input.userId)) {
            throw new RecipeInputError("Pick whose version to reset.");
        }
        if (!confirmed) {
            const preview = await previewReset(
                liveRecipesStore(),
                liveRecipeVariantsStore(),
                input,
            );
            return c.json({ confirmRequired: true, recipeId, ...preview });
        }
        // The rows the admin was shown, handed back by the confirm.
        const rowKeys = [body["row_keys"] ?? []]
            .flat()
            .filter((key): key is string => typeof key === "string");
        await resetVariant(liveRecipesStore(), liveRecipeVariantsStore(), {
            ...input,
            rowKeys,
            transaction: recipeAlignTransaction(recipeId),
        });
    } catch (err) {
        if (
            !(err instanceof RecipeInputError) &&
            !(err instanceof RecipeForbiddenError)
        ) {
            throw err;
        }
        if (!confirmed) {
            return c.json(
                { error: err.message },
                err instanceof RecipeForbiddenError ? 403 : 400,
            );
        }
        if (fromComparePage(body)) {
            const page = await compareFormError(userId, recipeId, err);
            return c.html(page.html, page.status);
        }
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(page.html, page.status);
    }
    if (fromComparePage(body)) {
        // toast: none — back on Compare versions
        return c.redirect(`/recipes/${recipeId}/compare`, 303);
    }
    // toast: none — the page reloads on the recipe, the person back on the base
    return c.redirect(`/recipes/${recipeId}`, 303);
});

/**
 * "Missing for the plan · Add to groceries". What is missing is worked out
 * here, from the plan and the kitchen as they are now, never from the form.
 * Lines go on the list with source `plan`; a food the list already covers is
 * not doubled, so a second tap adds nothing. A line whose stock could not be
 * counted is added at the recipe's full amount and says so on the list.
 */
recipesRoutes.post("/recipes/plan/add-missing", requireMember, async (c) => {
    const member = siteMember(c);
    const body = await c.req.parseBody({ all: true });
    const back = planBackPath(parsePlanBack(formText(body, "back")));
    const inputs = await loadWeekPlanInputs(member.householdId);
    const missing = missingForPlan(inputs.plans, inputs.recipes, inputs.stock, {
        from: inputs.today,
        days: WEEK_PLAN_DAYS,
        foodsById: inputs.foodsById,
    });
    if (missing.length === 0) {
        return redirectWithToast(c, back, "plan.missing.none");
    }
    // The sheet posts `food_ids_sent` with its ticked boxes: exactly those
    // foods (found in what is missing now) go on, and none ticked adds
    // nothing. A form without the marker (an old page) adds every line.
    const sent = formText(body, "food_ids_sent") === "1";
    const lines = pickMissingLines(
        missing,
        sent ? formTextList(body, "food_ids[]") : null,
    );
    if (lines.length === 0) {
        // toast: none — nothing was ticked, so nothing changes
        return c.redirect(back, 303);
    }
    const grocery = liveGroceryStore();
    try {
        const result = await addMissingToGroceries(
            grocery,
            liveSettingsStore(),
            liveFoodsStore(),
            { householdId: member.householdId, lines },
            {
                transaction: planTransaction(
                    "plan-missing",
                    member.householdId,
                ),
            },
        );
        if (result.added.length === 0) {
            return redirectWithToast(c, back, "fridge.item.already-on-grocery");
        }
        if (result.unknown.length > 0) {
            return redirectWithToast(c, back, "plan.missing.added.unknown", {
                count: result.added.length,
                names: truncateToastParam(
                    result.unknown
                        .map((entry) => entry.line.displayName)
                        .join(", "),
                ),
            });
        }
        // toast: none
        return c.redirect(back, 303);
    } catch (err) {
        if (!(err instanceof GroceryInputError)) throw err;
        return redirectWithToast(c, back, "plan.notice", {
            message: err.message,
        });
    }
});

/**
 * Save: the one way an imported draft becomes a recipe. It runs the check;
 * when it passes the draft is saved and the page reloads (303), otherwise the
 * recipe page answers in place (422) with what is left to fix. Saving a
 * recipe that is already saved changes nothing.
 */
recipesRoutes.post("/recipes/:id/save", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    // The importer's landing carries its marker through a refused Save.
    const imported = formText(await c.req.parseBody(), "imported") === "1";
    try {
        const refusal = can(member, "recipe.edit");
        if (!refusal.ok) throw new RecipeForbiddenError(refusal.reason);
        const result = await saveRecipeDraft(
            liveRecipesStore(),
            member.householdId,
            recipeId,
        );
        if (!result.saved) {
            const page = await renderRecipeDetailRoute(userId, recipeId, {
                imported,
                // The draft card lists what is left; the banner only says so.
                error: "Not saved yet. Fix what is listed below, then save it again.",
            });
            return c.html(page.html, 422);
        }
    } catch (err) {
        if (
            !(err instanceof RecipeInputError) &&
            !(err instanceof RecipeForbiddenError)
        ) {
            throw err;
        }
        if (err.message === "Unknown recipe.") {
            return c.text("Not found", 404);
        }
        const page = await recipeFormError(userId, recipeId, err, { imported });
        return c.html(page.html, page.status);
    }
    // toast: none — the page reloads as a saved recipe
    return c.redirect(`/recipes/${recipeId}`, 303);
});

/**
 * Discard draft: deletes the recipe only while it is still a draft
 * (`deleteDraftRecipe`), with the permission `discard_recipe_draft` uses:
 * whoever imported it, or the owner. A draft saved since the page was drawn
 * is kept and the page answers in place (409); nobody is notified, since a
 * draft is only its importer's.
 */
recipesRoutes.post("/recipes/:id/discard", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    if (!UUID_SHAPE.test(recipeId)) return c.text("Not found", 404);
    const store = liveRecipesStore();
    const alreadySaved = (name: string) =>
        new RecipeInputError(
            `${name} was already saved, so it was not discarded.`,
        );
    try {
        const refusal = can(member, "recipe.edit");
        if (!refusal.ok) throw new RecipeForbiddenError(refusal.reason);
        const recipe = await store.getRecipe(member.householdId, recipeId);
        if (!recipe) return c.text("Not found", 404);
        if (!isRecipeDraft(recipe)) throw alreadySaved(recipe.name);
        assertCanDeleteRecipe(recipe, {
            userId,
            isOwner: can(member, "recipe.delete_any").ok,
        });
        if (!(await store.deleteDraftRecipe(member.householdId, recipeId))) {
            const now = await store.getRecipe(member.householdId, recipeId);
            if (!now) return c.text("Not found", 404);
            throw alreadySaved(now.name);
        }
    } catch (err) {
        if (
            !(err instanceof RecipeInputError) &&
            !(err instanceof RecipeForbiddenError)
        ) {
            throw err;
        }
        const page = await recipeFormError(userId, recipeId, err);
        return c.html(
            page.html,
            err instanceof RecipeForbiddenError ? 403 : 409,
        );
    }
    // toast: none
    return c.redirect("/recipes", 303);
});

recipesRoutes.post("/recipes/:id/delete", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const recipeId = c.req.param("id");
    const body = await c.req.parseBody();
    const from = formText(body, "from");
    // Settings paths are not generic back targets; the Saved page is the one
    // place besides Recipes that deletes a recipe.
    const returnTo =
        from === "/settings/saved"
            ? "/settings/saved"
            : safeReturnPath(from, "/recipes");
    try {
        await deleteRecipe(
            liveRecipesStore(),
            member.householdId,
            recipeId,
            {
                userId,
                isOwner: can(member, "recipe.delete_any").ok,
            },
            { notify: liveNotifier(member.householdId, userId) },
        );
    } catch (err) {
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: `recipe-delete-${recipeId}`,
        });
        return c.html(page.html, page.status);
    }
    // toast: none
    return c.redirect(returnTo, 303);
});
