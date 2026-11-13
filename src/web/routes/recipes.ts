import { Hono } from "hono";
import {
    loadCookPreview,
    renderDashboardPage,
    renderRecipeDetailRoute,
    renderRecipesListPage,
} from "../loaders.js";

import { formAmount, formOptionalNumber, formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import {
    deleteRecipe,
    RecipeForbiddenError,
    RecipeInputError,
    RecipeUnverifiedError,
} from "../../domain/recipes.js";
import { getHouseholdConfig } from "../../db/household.js";
import { liveSocialReaderStatusStore } from "../../db/social-readers.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveRecipesStore } from "../../db/recipes.js";
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
import { cookSheetToastFlash } from "../components/toast-flash.js";
import { redirectWithToast } from "../components/toast.js";
import { safeReturnPath } from "../usual-products-path.js";
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
    RECIPE_LINK_READER_PAUSED_WEB_MESSAGE,
    recipeFetchMemory,
    recipeImportFetcher,
    linkImportPaused,
    recipeLinkReaderEnabled,
} from "../../recipe-url-fetcher.js";
import { run } from "../../db/sql.js";
import { looksLikeSharedRecipeLink } from "../../domain/sharing-source.js";
import { viewerFlagsFor } from "../attention.js";
import { answerSharedRecipeImport } from "./recipes-shared-import.js";
import {
    parseV2RecipeListFilter,
    recipesListV2Href,
} from "../pages/v2/recipes-list.js";
import {
    parsePlanBack,
    PLAN_SHEET_ID,
    planBackPath,
    planDayLabel,
    PLAN_SLOT_LABEL,
    type PlanEditDraft,
} from "../pages/v2/recipes-plan.js";
import {
    checkPlanDay,
    checkPlanServingsCapped,
    checkPlanSlot,
    planRecipe,
    PlanInputError,
} from "../../domain/plan.js";
import {
    addMissingToGroceries,
    addPlanDays,
    missingForPlan,
    WEEK_PLAN_DAYS,
} from "../../domain/plan-week.js";
import { householdToday } from "../../db/restock.js";
import { GroceryInputError } from "../../domain/grocery.js";
import { liveRecipePlansStore, planTransaction } from "../../db/plans.js";
import { loadWeekPlanInputs } from "../loaders-plan.js";

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
        plan?: { date?: string; slot?: string; servings?: number };
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
            return answerSharedRecipeImport(c, importUrl);
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

recipesRoutes.get("/recipes/:id", requireSiteUser, async (c) => {
    const page = await renderRecipeDetailRoute(
        c.get("userId"),
        c.req.param("id"),
        {
            member: c.req.query("member"),
            openCook: c.req.query("cook") === "1",
            plan: {
                open: c.req.query("plan") === "1",
                date: c.req.query("date"),
            },
        },
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

recipesRoutes.get("/recipes/:id/cook/preview", requireMember, async (c) => {
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
    const { preview, error } = await loadCookPreview(
        member.householdId,
        c.req.param("id"),
        servings,
    );
    return c.html(renderCookPreviewRegion(preview, error), preview ? 200 : 400);
});

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
        const meal = logServing
            ? await mealWriteFromItems(member.householdId, [
                  { recipeId, portions: 1 },
              ])
            : null;
        // What this cook is about to take, to compare with what the sheet
        // showed. A recipe it cannot plan fails in cookRecipe below.
        const { preview } = await loadCookPreview(
            member.householdId,
            recipeId,
            servings,
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
                return redirectWithToast(
                    c,
                    `/recipes/${recipeId}`,
                    "recipes.cooked.already",
                );
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
                },
            ),
        );
        if (cooked.alreadyCooked) {
            return redirectWithToast(
                c,
                `/recipes/${recipeId}`,
                "recipes.cooked.already",
            );
        }
        const flash = cookSheetToastFlash({
            loggedSlot: meal ? slot : null,
            shortfallCount: cooked.shortfalls.length,
            unmeasuredNames: cooked.unmeasured.map((row) => row.displayName),
            changedNames,
        });
        return redirectWithToast(
            c,
            `/recipes/${recipeId}`,
            flash.key,
            flash.params,
        );
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
            return redirectWithToast(
                c,
                `/recipes/${recipeId}`,
                "recipes.cooked.already",
            );
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
            filter: parseV2RecipeListFilter(formText(body, "filter")),
        });
        // toast: none (the star shows the new state)
        return c.redirect(`${list}#recipe-${recipeId}`, 303);
    }
    // toast: none (the star shows the new state)
    return c.redirect(`/recipes/${recipeId}`, 303);
});

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
    const body = await c.req.parseBody();
    const date = formText(body, "date").trim();
    const slot = formText(body, "slot");
    const servingsInput = formOptionalNumber(body, "servings");
    try {
        const outcome = await planRecipe(
            liveRecipePlansStore(),
            {
                householdId: member.householdId,
                recipeId,
                recipeYield: recipe.yieldPortions,
                date,
                slot,
                servings: servingsInput,
                today: await householdToday(member.householdId),
                createdBy: userId,
            },
            {
                transaction: planTransaction("plan-recipe", member.householdId),
            },
        );
        if (!outcome) return c.text("Not found", 404);
        const checkedSlot = outcome.plan.slot;
        if (outcome.alreadyPlanned) {
            return redirectWithToast(
                c,
                `/recipes/${recipeId}`,
                "plan.already",
                { when: planWhen(date, checkedSlot) },
            );
        }
        return redirectWithToast(c, `/recipes/${recipeId}`, "plan.added", {
            when: planWhen(date, checkedSlot),
        });
    } catch (err) {
        if (!(err instanceof PlanInputError)) throw err;
        const page = await recipeFormError(userId, recipeId, err, {
            openModalId: PLAN_SHEET_ID,
            plan: {
                date,
                slot,
                servings: servingsInput,
            },
        });
        return c.html(page.html, page.status);
    }
});

/**
 * Move a plan to another day or meal (and change its servings), from the edit
 * sheet on Today or Recipes. Nothing is written until the whole form checks; a
 * form that does not check re-renders the page it came from with that plan's
 * sheet open, the typed values kept and the reason shown.
 */
recipesRoutes.post("/recipes/plan/:planId/move", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const backKind = parsePlanBack(formText(body, "back"));
    const back = planBackPath(backKind);
    const planId = c.req.param("planId");
    if (!UUID_SHAPE.test(planId)) {
        return redirectWithToast(c, back, "plan.gone");
    }
    const plans = liveRecipePlansStore();
    const existing = await plans.getPlan(member.householdId, planId);
    if (!existing) return redirectWithToast(c, back, "plan.gone");
    const dateInput = formText(body, "date").trim();
    const slotInput = formText(body, "slot");
    const servingsInput = formOptionalNumber(body, "servings");
    try {
        const date = checkPlanDay(
            dateInput,
            await householdToday(member.householdId),
        );
        const slot = checkPlanSlot(slotInput);
        const servings = checkPlanServingsCapped(
            servingsInput ?? existing.servings,
        );
        // The same recipe already on that day and slot absorbs this plan
        // (its servings are added), so the week never shows it twice.
        const moved = await plans.movePlan(
            member.householdId,
            existing.id,
            date,
            slot,
            servings,
        );
        if (!moved) return redirectWithToast(c, back, "plan.gone");
        // The row that comes back is not this plan's when it merged.
        return redirectWithToast(
            c,
            back,
            moved.id === existing.id ? "plan.moved" : "plan.merged",
            { when: planWhen(moved.date, moved.slot) },
        );
    } catch (err) {
        if (!(err instanceof PlanInputError)) throw err;
        const draft: PlanEditDraft = {
            planId,
            date: dateInput,
            slot: slotInput,
            servings: servingsInput,
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

recipesRoutes.post("/recipes/plan/:planId/remove", requireMember, async (c) => {
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const back = planBackPath(parsePlanBack(formText(body, "back")));
    const planId = c.req.param("planId");
    const removed =
        UUID_SHAPE.test(planId) &&
        (await liveRecipePlansStore().removePlan(member.householdId, planId));
    return redirectWithToast(c, back, removed ? "plan.removed" : "plan.gone");
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
    const body = await c.req.parseBody();
    const back = planBackPath(parsePlanBack(formText(body, "back")));
    const inputs = await loadWeekPlanInputs(member.householdId);
    const lines = missingForPlan(inputs.plans, inputs.recipes, inputs.stock, {
        from: inputs.today,
        days: WEEK_PLAN_DAYS,
        foodsById: inputs.foodsById,
    });
    if (lines.length === 0) {
        return redirectWithToast(c, back, "plan.missing.none");
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
            return redirectWithToast(c, back, "plan.missing.on-list");
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
        return redirectWithToast(c, back, "plan.missing.added", {
            count: result.added.length,
        });
    } catch (err) {
        if (!(err instanceof GroceryInputError)) throw err;
        return redirectWithToast(c, back, "plan.notice", {
            message: err.message,
        });
    }
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
    return redirectWithToast(c, returnTo, "recipes.deleted");
});
