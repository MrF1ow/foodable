import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveFridgeStore } from "../../db/fridge.js";
import { getProfile } from "../../db/profiles.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { getHouseholdConfig } from "../../db/household.js";
import { liveSocialReaderStatusStore } from "../../db/social-readers.js";
import { insertMeal } from "../../db/nutrition.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveRulesStore } from "../../db/rules.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { run } from "../../db/sql.js";
import { withAnalytics } from "../../analytics.js";
import { lookupBarcode } from "../../foods.js";
import { effectiveFoodsByIds } from "../../domain/foods.js";
import { listFridge } from "../../domain/fridge.js";
import { recipePlacesToWire } from "../../household.js";
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
    recipeNotices,
    setPersonPortion,
    updateRecipe,
    updateRecipeIngredient,
    type Recipe,
    recipeSteps,
    resolveTotalPortions,
    RecipeUnverifiedError,
    recheckRecipe,
    resolveUnresolvedLines,
} from "../../domain/recipes.js";
import { sortNotices } from "../../domain/notices.js";
import { guessMealType, validateTz } from "../../domain/tz.js";
import type {
    RecipeImport,
    RecipeProblem,
    RecipeImportStatus,
} from "../../domain/recipe-import.js";
import {
    importOutcomeMessage,
    importRecipeFromUrl,
    importRecipeFromUrlAnalyticsOutcome,
} from "../../domain/recipe-import.js";
import {
    buildRecipeLinkReaderPausedOutcome,
    RECIPE_LINK_READER_PAUSED_AGENT_MESSAGE,
    recipeFetchMemory,
    recipeImportFetcher,
    linkImportPaused,
    recipeLinkReaderEnabled,
} from "../../recipe-url-fetcher.js";
import {
    cookRecipe,
    previewCookRecipe,
    StockInputError,
    isCookPreviewUnavailable,
    type CookPreview,
} from "../../domain/stock.js";
import { mealWriteFromItems } from "./nutrition.js";
import { noticeSentence } from "../../copy/notices.js";
import {
    NOTICE_SCHEMA,
    NEW_FOOD_INPUT,
    ON_SIMILAR_INPUT,
    noticeToWire,
    onSimilarFor,
    similarFoodsText,
    similarFoodsWire,
    SIMILAR_FOODS_ENTRY,
    WRITE_STATUS,
    QUANTITY_ITEM,
    recipeAllergenNoticesForView,
    registerV2OnlyWidgetResource,
    uiMetaForKey,
    captureDismissals,
    destructiveOutcome,
    dismissedOn,
    uncapturedNote,
    withUndo,
} from "../shared.js";
import type { ToolContext } from "../shared.js";
import { SimilarFoodsError } from "../../domain/foods.js";
import type { MentionWarning } from "../../domain/recipe-mentions.js";
import {
    recipeMentionWarnings,
    type LoadedRecipe,
} from "../../domain/recipe-mentions-check.js";
import { RecipeInputError } from "../../domain/recipes.js";

export const ADD_RECIPE_INGREDIENT_OUTPUT_SCHEMA = z.object({
    status: WRITE_STATUS,
    similar_foods: z.array(SIMILAR_FOODS_ENTRY),
    ingredient: z
        .object({
            id: z.string(),
            food_id: z.string().nullable(),
            display_name: z.string(),
            amount: z.number().nullable(),
            unit: z.string().nullable(),
            note: z.string().nullable(),
        })
        .nullable(),
});

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
    verification: z.enum(["verified", "unverified"]),
};

const RECIPE_PROBLEM = z.object({
    code: z.string(),
    message: z.string(),
    ingredient_id: z.string().nullable(),
    line: z.string().nullable(),
});

const MENTION_WARNING = z.object({
    food: z.string(),
    key: z.string(),
    food_id: z.string().nullable(),
    excerpt: z.string(),
    amount: z.number().nullable(),
    note: z.string().nullable(),
    message: z.string(),
});

/** Foods a recipe's steps name that its ingredients lack, in wire shape. */
function wireMentionWarnings(warnings: readonly MentionWarning[]) {
    return warnings.map((w) => ({
        food: w.food,
        key: w.key,
        food_id: w.foodId ?? null,
        excerpt: w.excerpt,
        amount: w.amount,
        note: w.note,
        message: w.message,
    }));
}

/** The warnings as text the agent reads; empty when there are none. */
function mentionWarningsText(warnings: readonly MentionWarning[]): string {
    if (warnings.length === 0) return "";
    return `\nThe steps mention foods that are not ingredients. This never blocks anything: ask the user whether to add each one, and call add_recipe_ingredient only if they say yes.\n${warnings
        .map((w) => `- ${w.message} ("${w.excerpt}")`)
        .join("\n")}`;
}

/**
 * The warnings for a recipe, or none when they cannot be found: they are advice
 * beside a result that already happened (a saved import, a read), so a lookup
 * that fails is logged and never becomes the tool's error.
 */
async function mentionWarningsFor(
    householdId: string,
    recipeId: string | null,
    loaded?: LoadedRecipe,
): Promise<MentionWarning[]> {
    if (!recipeId) return [];
    try {
        return await recipeMentionWarnings(
            { recipes: liveRecipesStore(), foods: liveFoodsStore() },
            householdId,
            recipeId,
            loaded,
        );
    } catch (err) {
        console.error(
            `[recipes] mention warnings for ${recipeId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
    }
}

export const IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA = z.object({
    status: WRITE_STATUS,
    similar_foods: z.array(SIMILAR_FOODS_ENTRY),
    recipe: z.object(RECIPE_FIELDS).nullable(),
    ingredients: z.array(
        z.object({
            id: z.string(),
            food_id: z.string().nullable(),
            display_name: z.string(),
            amount: z.number().nullable(),
            unit: z.string().nullable(),
            note: z.string().nullable(),
            missing: z.array(
                z.enum([
                    "nutrition",
                    "amount",
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
    verification: z.enum(["verified", "unverified"]).nullable(),
    problems: z.array(RECIPE_PROBLEM),
    mention_warnings: z.array(MENTION_WARNING),
});

export const VERIFY_RECIPE_OUTPUT_SCHEMA = z.object({
    status: z.enum(["verified", "unverified", "not_found"]),
    recipe_id: z.string(),
    verification: z.enum(["verified", "unverified"]).nullable(),
    problems: z.array(RECIPE_PROBLEM),
    mention_warnings: z.array(MENTION_WARNING),
});

export function importRecipeFromUrlPausedStructuredContent(url: string) {
    const outcome = buildRecipeLinkReaderPausedOutcome(url);
    const payload = {
        status: outcome.status,
        recipe_id: outcome.recipeId,
        recipe_name: outcome.recipeName,
        verification: outcome.verification,
        problems: wireProblems(outcome.problems),
        source: outcome.source
            ? {
                  kind: outcome.source.kind,
                  url: outcome.source.url,
                  label: outcome.source.label,
              }
            : null,
        unresolved_lines: outcome.unresolvedLines,
        reader_failure: outcome.readerFailure,
        message: RECIPE_LINK_READER_PAUSED_AGENT_MESSAGE,
        from_memory: outcome.fromMemory,
        remembered_until: outcome.rememberedUntil,
        mention_warnings: [] as ReturnType<typeof wireMentionWarnings>,
    };
    IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(payload);
    return payload;
}

const RECIPE_IMPORT_STATUS = z.enum([
    "imported",
    "unverified_needs_review",
    "paste_needed",
    "no_recipe_in_text",
    "no_recipe_on_page",
    "robots_disallowed",
    "site_refused",
    "not_found",
    "timeout",
    "duplicate",
    "invalid_link",
]);

export const IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA = z.object({
    status: RECIPE_IMPORT_STATUS,
    recipe_id: z.string().nullable(),
    recipe_name: z.string().nullable(),
    verification: z.enum(["verified", "unverified"]).nullable(),
    problems: z.array(RECIPE_PROBLEM),
    source: z
        .object({
            kind: z.string(),
            url: z.string().nullable(),
            label: z.string(),
        })
        .nullable(),
    unresolved_lines: z.array(z.string()),
    reader_failure: z.string().nullable(),
    message: z.string(),
    from_memory: z.boolean(),
    remembered_until: z.string().nullable(),
    mention_warnings: z.array(MENTION_WARNING),
});

const RECIPE_IMPORT_WIRE = z.object({
    source_kind: z.string(),
    source_url: z.string().nullable(),
    source_text: z.string().nullable(),
    source_text_origin: z.string().nullable(),
    transcript: z.string().nullable(),
    credit: z.string().nullable(),
    unresolved_lines: z.array(z.string()),
    imported_at: z.string(),
});

function wireProblems(problems: RecipeProblem[]) {
    return problems.map((p) => ({
        code: p.code,
        message: p.message,
        ingredient_id: p.ingredientId,
        line: p.line,
    }));
}

function wireImport(row: RecipeImport | null) {
    if (!row) return null;
    return {
        source_kind: row.sourceKind,
        source_url: row.sourceUrl,
        source_text: row.sourceText,
        source_text_origin: row.sourceTextOrigin,
        transcript: row.transcript,
        credit: row.credit,
        unresolved_lines: row.unresolvedLines,
        imported_at: row.importedAt,
    };
}

const INSTRUCTIONS_DESCRIPTION =
    'Method steps, one per line. Leave a blank line between steps to write one step over several lines. Numbering ("1.", "Step 2:") is optional and stripped on display.';

function recipeIngredientAmountText(ingredient: {
    quantity: { amount: number; unit: string } | null;
    note: string | null;
    displayName: string;
}): string {
    if (ingredient.quantity == null) {
        return ingredient.note?.trim() || "to taste";
    }
    return `${ingredient.quantity.amount} ${ingredient.quantity.unit}`;
}

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

export const MACROS_ITEM_OUTPUT_SCHEMA = MACROS_ITEM;

/** One ingredient of `get_recipe`, as the recipe card lists it. */
const GET_RECIPE_INGREDIENT = z.object({
    id: z.string(),
    display_name: z.string(),
    amount: z.number().nullable(),
    unit: z.string().nullable(),
    note: z.string().nullable(),
    food_id: z.string().nullable(),
    per_portion_amount: z.number().nullable(),
    person_amount: z.number().nullable(),
    product: z
        .object({
            food_id: z.string(),
            name: z.string(),
        })
        .nullable(),
    missing: z
        .boolean()
        .describe(
            "true when the fridge cannot cover this ingredient for one serving; false when it can or when cook_preview is null",
        ),
});

/** The cook dry run for one serving, as the recipe card reads it. */
const COOK_PREVIEW_WIRE = z.object({
    total_portions: z.number(),
    lines: z.array(
        z.object({
            food_id: z.string(),
            display_name: z.string(),
            from_item_id: z.string(),
            unit: z.string(),
            before: z.number(),
            after: z.number(),
        }),
    ),
    shortfalls: z.array(
        z.object({
            food_id: z
                .string()
                .nullable()
                .describe("null for an ingredient not linked to a food"),
            display_name: z.string(),
            amount: z.number(),
            unit: z.string(),
            unknown_factor: z
                .boolean()
                .describe(
                    "some stock of this food could not be counted, so the real shortfall may be smaller",
                ),
        }),
    ),
    unmeasured: z.array(
        z.object({
            food_id: z.string().nullable(),
            display_name: z.string(),
        }),
    ),
    cookable: z.boolean(),
});

type SuggestedMealType = "breakfast" | "lunch" | "dinner" | "snack";

export const GET_RECIPE_OUTPUT_SCHEMA = z.object({
    ...RECIPE_FIELDS,
    steps: z
        .array(z.string())
        .describe(
            "instructions split into steps, as the recipe page numbers them",
        ),
    portion_count: z.number(),
    macros_per_portion: MACROS_ITEM,
    notices: z.array(NOTICE_SCHEMA),
    ingredients: z.array(GET_RECIPE_INGREDIENT),
    verification: z.enum(["verified", "unverified"]),
    problems: z.array(RECIPE_PROBLEM),
    import: RECIPE_IMPORT_WIRE.nullable(),
    mention_warnings: z
        .array(MENTION_WARNING)
        .describe(
            "foods the steps name that the ingredients do not; advice only, it never changes verification",
        ),
    cook_preview: COOK_PREVIEW_WIRE.nullable().describe(
        "what cooking one serving takes from the fridge; null when the recipe cannot be previewed",
    ),
    suggested_meal_type: z
        .enum(["breakfast", "lunch", "dinner", "snack"])
        .describe(
            "the meal slot it is now for the viewing member (their timezone, UTC when unset); pass it as meal_type to log_recipe_portion",
        ),
});

/** The dry run for one serving in wire shape. */
function cookPreviewWire(preview: CookPreview) {
    return {
        total_portions: preview.totalPortions,
        lines: preview.lines.map((line) => ({
            food_id: line.foodId,
            display_name: line.displayName,
            from_item_id: line.fromItemId,
            unit: line.unit,
            before: line.before,
            after: line.after,
        })),
        shortfalls: preview.shortfalls.map((row) => ({
            // An ingredient with no food carries "" in the domain.
            food_id: row.foodId || null,
            display_name: row.displayName,
            amount: row.amount,
            unit: row.unit,
            unknown_factor: row.unknownFactor,
        })),
        unmeasured: preview.unmeasured.map((row) => ({
            food_id: row.foodId,
            display_name: row.displayName,
        })),
        cookable: preview.shortfalls.length === 0,
    };
}

/**
 * The one-serving dry run behind `get_recipe`. A recipe the cook cannot run on
 * (unverified, an unlinked or archived ingredient) is null, never an error:
 * reading a recipe must not depend on being able to cook it.
 */
async function recipeCookPreview(
    householdId: string,
    recipeId: string,
): Promise<CookPreview | null> {
    try {
        return await previewCookRecipe(
            liveRecipesStore(),
            liveFridgeStore(),
            liveFoodsStore(),
            { householdId, recipeId, totalPortions: 1 },
        );
    } catch (err) {
        if (isCookPreviewUnavailable(err)) {
            return null;
        }
        throw err;
    }
}

function wireMacros(macros: ReturnType<typeof macrosForPerson>) {
    return {
        calories: macros.calories,
        protein_g: macros.protein_g,
        carbs_g: macros.carbs_g,
        fat_g: macros.fat_g,
        fiber_g: macros.fiber_g,
        sugar_g: macros.sugar_g,
        alcohol_g: macros.alcohol_g,
        incomplete: macros.incomplete,
    };
}

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
        verification: recipe.verification,
    };
}

function ingredientLinesForRecipeText(
    rows: {
        display_name: string;
        person_amount: number | null;
        unit: string | null;
        note: string | null;
    }[],
): string {
    return rows
        .map((ingredient) => {
            // An unmeasured ingredient shows its note ("to taste"), never 0.
            if (ingredient.person_amount == null || !ingredient.unit) {
                return `${ingredient.display_name} ${ingredient.note?.trim() || "to taste"}`;
            }
            return `${ingredient.display_name} ${ingredient.person_amount} ${ingredient.unit}${ingredient.note ? ` (${ingredient.note})` : ""}`;
        })
        .join("\n");
}

/** The model-facing text of get_recipe's verification state and import data,
 *  so a host that shows only `content` can still follow the Help prompt. */
function getRecipeImportText(payload: {
    verification: "verified" | "unverified";
    problems: { message: string }[];
    import: {
        source_kind: string;
        source_url: string | null;
        source_text: string | null;
        credit: string | null;
        transcript: string | null;
        unresolved_lines: string[];
    } | null;
}): string {
    const parts: string[] = [];
    parts.push(`\nVerification: ${payload.verification}`);
    if (payload.problems.length > 0) {
        parts.push(
            `Problems:\n${payload.problems.map((row) => `- ${row.message}`).join("\n")}`,
        );
    }
    const row = payload.import;
    if (row) {
        parts.push(
            `Import: ${row.source_kind}${row.source_url ? ` ${row.source_url}` : ""}${row.credit ? ` by ${row.credit}` : ""}`,
        );
        if (row.unresolved_lines.length > 0) {
            parts.push(
                `Unresolved lines:\n${row.unresolved_lines.map((line) => `- ${line}`).join("\n")}`,
            );
        }
        if (row.source_text) parts.push(`Source text:\n${row.source_text}`);
        if (row.transcript) parts.push(`Transcript:\n${row.transcript}`);
    }
    return parts.join("\n");
}

export function registerRecipesTools(server: McpServer, ctx: ToolContext) {
    const {
        callerHouseholdId,
        requireHouseholdMemberId,
        callerActor,
        analytics,
        runDestructive,
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
                verification: z.enum(["verified", "unverified"]).optional(),
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
                        Boolean(args.safe_for) ||
                        Boolean(args.verification);
                    let recipes;
                    if (filterOn) {
                        const fridge = await listFridge(
                            liveFridgeStore(),
                            householdId,
                        );
                        const allFoods =
                            await liveFoodsStore().listFoods(householdId);
                        const foodsById = await effectiveFoodsByIds(
                            liveFoodsStore(),
                            householdId,
                            allFoods.map((food) => food.id),
                        );
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
                            foodsById,
                            fridge.items.map((item) => ({
                                quantity: item.quantity,
                                foodId: item.foodId,
                            })),
                            {
                                tag: args.tag,
                                canMakeNow: args.can_make_now === true,
                                safeFor,
                                verification: args.verification ?? null,
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
                                                      `${recipe.name} yield ${recipe.yield_portions} ${recipe.id}${recipe.verification === "unverified" ? " (unverified)" : ""}`,
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

    registerV2OnlyWidgetResource(server, ctx, {
        key: "recipe-card",
        resourceName: "recipe-card",
        title: "Recipe",
        description:
            "A recipe with what the fridge covers and Cook behind a confirm step, for get_recipe.",
        flag: "widget-recipe-card",
    });

    server.registerTool(
        "get_recipe",
        {
            title: "Get Recipe",
            description:
                "Get a recipe as viewed by a household member, including per-portion and per-person amounts. `notices` surface allergens and recipe gaps in one place; when macros are incomplete, `macros_per_portion.incomplete` is true. `mention_warnings` lists foods an imported recipe's steps use that its ingredients lack; they never block anything, so ask the user and call add_recipe_ingredient only if they say yes.",
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
            outputSchema: GET_RECIPE_OUTPUT_SCHEMA,
            ...uiMetaForKey(ctx, "recipe-card", {
                v2: true,
                flag: "widget-recipe-card",
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
                    const catalog = await effectiveFoodsByIds(
                        liveFoodsStore(),
                        actor.householdId,
                        view.ingredients.map((row) => row.foodId),
                    );
                    const recipeGapNotices = recipeNotices(
                        args.id,
                        view.ingredients,
                        catalog,
                    );
                    const recipeAllergen = await recipeAllergenNoticesForView({
                        householdId: actor.householdId,
                        recipeId: args.id,
                        ingredients: view.ingredients,
                        catalog,
                        viewingMemberId: memberId,
                    });
                    const noticesWire = sortNotices([
                        ...recipeAllergen,
                        ...recipeGapNotices,
                    ]).map(noticeToWire);
                    const macrosPerPortion = macrosForPerson(
                        view.ingredients,
                        view.yieldPortions,
                        1,
                        catalog,
                    );
                    const wiredMacros = wireMacros(macrosPerPortion);
                    const store = liveRecipesStore();
                    const importRow = await store.getImport(
                        actor.householdId,
                        args.id,
                    );
                    const problems = importRow?.problems ?? [];
                    const mentionWarnings = await mentionWarningsFor(
                        actor.householdId,
                        args.id,
                        {
                            recipe: view,
                            ingredients: view.ingredients,
                            importRow,
                        },
                    );
                    const gapReasonTexts: string[] = [];
                    const seenGapMsg = new Set<string>();
                    for (const n of recipeGapNotices) {
                        const m = noticeSentence(n);
                        if (seenGapMsg.has(m)) continue;
                        seenGapMsg.add(m);
                        gapReasonTexts.push(m);
                    }
                    const perPortionReasonTail =
                        gapReasonTexts.length > 0
                            ? ` (${gapReasonTexts.join("; ")})`
                            : "";
                    const perPortionLine = `${view.name} yield ${view.yieldPortions}, portion ${view.portionCount}\nPer portion: ${wiredMacros.incomplete && wiredMacros.calories == null ? "macros incomplete" : `${wiredMacros.calories ?? "—"} kcal${wiredMacros.incomplete ? ", incomplete" : ""}`}${perPortionReasonTail}`;
                    const allergenBlockLines = recipeAllergen
                        .filter((n) => n.severity === "block")
                        .map((n) => `Allergen: ${noticeSentence(n)}`);
                    const allergenBlock =
                        allergenBlockLines.length > 0
                            ? `\n${allergenBlockLines.join("\n")}`
                            : "";
                    const steps = recipeSteps(view.instructions);
                    const cook = await recipeCookPreview(
                        actor.householdId,
                        args.id,
                    );
                    const cookWire = cook ? cookPreviewWire(cook) : null;
                    const shortFoodIds = new Set(
                        (cookWire?.shortfalls ?? []).flatMap((row) =>
                            row.food_id ? [row.food_id] : [],
                        ),
                    );
                    // An ingredient with no food is named in the shortfalls by
                    // its display name alone.
                    const shortUnlinked = new Set(
                        (cookWire?.shortfalls ?? []).flatMap((row) =>
                            row.food_id ? [] : [row.display_name],
                        ),
                    );
                    const profile = await getProfile(memberId);
                    const tz =
                        profile?.timezone && validateTz(profile.timezone)
                            ? profile.timezone
                            : "UTC";
                    const payload = {
                        ...recipeFields(view),
                        suggested_meal_type: guessMealType(
                            tz,
                        ) as SuggestedMealType,
                        verification: view.verification,
                        problems: wireProblems(problems),
                        import: wireImport(importRow),
                        mention_warnings: wireMentionWarnings(mentionWarnings),
                        steps,
                        portion_count: view.portionCount,
                        macros_per_portion: wiredMacros,
                        notices: noticesWire,
                        cook_preview: cookWire,
                        ingredients: view.ingredients.map((ingredient) => {
                            const eff = ingredient.foodId
                                ? catalog.get(ingredient.foodId)
                                : undefined;
                            return {
                                id: ingredient.id,
                                display_name: ingredient.displayName,
                                amount: ingredient.quantity?.amount ?? null,
                                unit: ingredient.quantity?.unit ?? null,
                                note: ingredient.note,
                                food_id: ingredient.foodId,
                                per_portion_amount: ingredient.perPortionAmount,
                                person_amount: ingredient.personAmount,
                                product: eff?.product
                                    ? {
                                          food_id: eff.product.id,
                                          name: eff.product.name,
                                      }
                                    : null,
                                missing: ingredient.foodId
                                    ? shortFoodIds.has(ingredient.foodId)
                                    : shortUnlinked.has(ingredient.displayName),
                            };
                        }),
                    };
                    const ingredientBlock = ingredientLinesForRecipeText(
                        payload.ingredients,
                    );
                    const stepsLines =
                        steps.length > 0
                            ? `\nMethod:\n${steps
                                  .map((step, index) => `${index + 1}. ${step}`)
                                  .join("\n")}`
                            : "";
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${perPortionLine}${allergenBlock}\n${ingredientBlock}${stepsLines}${getRecipeImportText(payload)}${mentionWarningsText(mentionWarnings)}`,
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
                instructions: z
                    .string()
                    .optional()
                    .describe(INSTRUCTIONS_DESCRIPTION),
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
                "Add a food ingredient to a recipe. Pass a barcode or a manual name. Leave amount out for to-taste / never-measured ingredients; never send 0.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                amount: z.coerce.number().nullable().optional(),
                name: z.string().optional(),
                barcode: z.string().optional(),
                food_id: z.string().optional(),
                unit: z.string().optional(),
                on_similar: ON_SIMILAR_INPUT,
                new_food: NEW_FOOD_INPUT,
            }),
            outputSchema: ADD_RECIPE_INGREDIENT_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "add_recipe_ingredient",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveRecipesStore();
                    const foods = liveFoodsStore();
                    const onSimilar = onSimilarFor(args);
                    const similarNull = {
                        status: "similar_foods" as const,
                        similar_foods: [] as z.infer<
                            typeof SIMILAR_FOODS_ENTRY
                        >[],
                        ingredient: null,
                    };
                    try {
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
                                    {
                                        lookup: (barcode) =>
                                            lookupBarcode(barcode, {
                                                householdId,
                                            }),
                                    },
                                )
                              : await addRecipeManualIngredient(store, foods, {
                                    householdId,
                                    recipeId: args.recipe_id,
                                    name: args.name ?? "",
                                    amount: args.amount,
                                    unit: args.unit,
                                    onSimilar,
                                });
                        const structured = {
                            status: "ok" as const,
                            similar_foods: [],
                            ingredient: {
                                id: ingredient.id,
                                food_id: ingredient.foodId,
                                display_name: ingredient.displayName,
                                amount: ingredient.quantity?.amount ?? null,
                                unit: ingredient.quantity?.unit ?? null,
                                note: ingredient.note,
                            },
                        };
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Added ${ingredient.displayName} ${recipeIngredientAmountText(ingredient)}`,
                                },
                            ],
                            structuredContent: structured,
                        };
                    } catch (err) {
                        if (err instanceof SimilarFoodsError) {
                            const wire = similarFoodsWire(err.entries);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: similarFoodsText(err.entries),
                                    },
                                ],
                                structuredContent: {
                                    ...similarNull,
                                    similar_foods: wire,
                                },
                            };
                        }
                        if (err instanceof RecipeInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
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
                    const run = await runDestructive(
                        "delete_recipe",
                        async (rec) => {
                            const store = liveRecipesStore();
                            const recipe = await store.getRecipe(
                                actor.householdId,
                                args.id,
                            );
                            const ingredientIds = (
                                await store.listIngredients(
                                    actor.householdId,
                                    args.id,
                                )
                            ).map((row) => row.id);
                            // The recipe with its ingredients, plans, import
                            // and portions. Favourites are private to each
                            // member, so the report names them as lost.
                            const report = recipe
                                ? await rec.captureCascade("recipes", [
                                      { id: args.id },
                                  ])
                                : { captured: 0, uncaptured: [] };
                            // The dismissals on the recipe and on each of its
                            // ingredients go with it.
                            await captureDismissals(
                                rec,
                                actor.householdId,
                                (dismissal) =>
                                    dismissedOn("recipe", [args.id])(
                                        dismissal,
                                    ) ||
                                    dismissedOn(
                                        "recipe_ingredient",
                                        ingredientIds,
                                    )(dismissal),
                            );
                            const deleted = await deleteRecipe(
                                store,
                                actor.householdId,
                                args.id,
                                {
                                    userId: actor.userId,
                                    isOwner: actor.isOwner,
                                },
                            );
                            return {
                                value: { deleted },
                                summary: `Deleted recipe ${recipe?.name ?? args.id}${uncapturedNote(report.uncaptured)}`,
                                changed: deleted,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    run.value.deleted
                                        ? `Deleted recipe ${args.id}.`
                                        : `No recipe found with id ${args.id}.`,
                                    run.undo,
                                ),
                            },
                        ],
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
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
                        unmeasured: z.boolean(),
                        need: QUANTITY_ITEM.nullable(),
                        remainder: QUANTITY_ITEM.nullable(),
                        note: z.string().nullable(),
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
                    const foods = await effectiveFoodsByIds(
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
                    try {
                        const result = await addRecipeToGrocery({
                            recipes,
                            grocery: liveGroceryStore(),
                            settings: liveSettingsStore(),
                            fridgeItems: fridge.items.map((item) => ({
                                quantity: item.quantity,
                                foodId: item.foodId,
                            })),
                            householdId,
                            recipeId: args.recipe_id,
                            storeId: args.store_id,
                            portionCounts,
                            totalPortions: args.total_portions,
                            foodsById: foods,
                            foods: liveFoodsStore(),
                        });
                        const addedByName = new Map(
                            result.added.map((line) => [
                                line.displayName,
                                line,
                            ]),
                        );
                        const remainder = result.plan.map((line) => {
                            const inserted = addedByName.get(line.displayName);
                            return {
                                display_name: line.displayName,
                                skipped: line.skipped,
                                unmeasured: line.unmeasured,
                                need: line.need,
                                remainder: line.remainder,
                                note: inserted?.note ?? null,
                            };
                        });
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: [
                                        `For ${result.totalPortions} portion${result.totalPortions === 1 ? "" : "s"}:`,
                                        ...remainder.map((line) => {
                                            if (line.unmeasured && line.note) {
                                                return `${line.display_name} · ${line.note}${line.skipped ? " (skipped)" : ""}`;
                                            }
                                            if (
                                                line.skipped ||
                                                line.remainder == null
                                            ) {
                                                return `${line.display_name} skipped`;
                                            }
                                            return `${line.display_name} remainder ${line.remainder.amount} ${line.remainder.unit}`;
                                        }),
                                    ].join("\n"),
                                },
                            ],
                            structuredContent: {
                                total_portions: result.totalPortions,
                                remainder,
                            },
                        };
                    } catch (err) {
                        if (err instanceof RecipeUnverifiedError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
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
                unmeasured: z.array(
                    z.object({
                        food_id: z.string().nullable(),
                        display_name: z.string(),
                    }),
                ),
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
                            unmeasured: cooked.unmeasured.map((row) => ({
                                food_id: row.foodId,
                                display_name: row.displayName,
                            })),
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
                        const unmeasuredText =
                            cooked.unmeasured.length === 0
                                ? ""
                                : ` Not deducted (no amount): ${cooked.unmeasured
                                      .map((row) => row.displayName)
                                      .join(", ")}.`;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Cooked ${cooked.totalPortions} portion${cooked.totalPortions === 1 ? "" : "s"}.${shortfallText}${unmeasuredText}${
                                        mealIds.length > 0
                                            ? ` Logged ${mealIds.length} meal${mealIds.length === 1 ? "" : "s"}.`
                                            : ""
                                    }`,
                                },
                            ],
                            structuredContent: payload,
                        };
                    } catch (err) {
                        if (
                            err instanceof StockInputError ||
                            err instanceof RecipeUnverifiedError
                        ) {
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
                instructions: z
                    .string()
                    .nullable()
                    .optional()
                    .describe(`${INSTRUCTIONS_DESCRIPTION} null clears them.`),
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
                "Update a recipe ingredient amount, unit, or note (for example diced or room temp). Leave amount null for to-taste / never-measured ingredients; never send 0.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                ingredient_id: z.string(),
                amount: z.coerce.number().nullable().optional(),
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
                        liveFoodsStore(),
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Updated ${ingredient.displayName} ${recipeIngredientAmountText(ingredient)}${ingredient.note && ingredient.quantity != null ? ` (${ingredient.note})` : ""}`,
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
                    const run = await runDestructive(
                        "remove_recipe_ingredient",
                        async (rec, householdId) => {
                            const store = liveRecipesStore();
                            const recipe = await store.getRecipe(
                                householdId,
                                args.recipe_id,
                            );
                            const ingredient = (
                                await store.listIngredients(
                                    householdId,
                                    args.recipe_id,
                                )
                            ).find((row) => row.id === args.ingredient_id);
                            await rec.captureByIds(
                                "recipe_ingredients",
                                [args.ingredient_id],
                                "deleted",
                            );
                            await captureDismissals(
                                rec,
                                householdId,
                                dismissedOn("recipe_ingredient", [
                                    args.ingredient_id,
                                ]),
                            );
                            // Removing an ingredient re-checks an unverified
                            // recipe, which can change what the recipe and
                            // its import record say.
                            await rec.captureByIds(
                                "recipes",
                                [args.recipe_id],
                                "updated",
                            );
                            await rec.captureByKeys(
                                "recipe_imports",
                                [{ recipe_id: args.recipe_id }],
                                "updated",
                            );
                            const removed = await removeRecipeIngredient(
                                store,
                                householdId,
                                args.recipe_id,
                                args.ingredient_id,
                            );
                            return {
                                value: { removed },
                                summary: `Removed ${ingredient?.displayName ?? args.ingredient_id} from recipe ${recipe?.name ?? args.recipe_id}`,
                                changed: removed,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    run.value.removed
                                        ? `Removed ingredient ${args.ingredient_id}.`
                                        : `No ingredient ${args.ingredient_id}.`,
                                    run.undo,
                                ),
                            },
                        ],
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
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
                'Create a recipe from structured fields the agent extracted from recipe text. Pass text (raw source, required) and structured ingredients. Pass the steps in instructions; without them the recipe stays unverified. Leave an ingredient\'s amount out only when it is not measured, and then set its note to "to taste" (or "as needed", "for garnish"); an ingredient with no amount and no such note keeps the recipe unverified. The server find-or-creates catalog foods and returns nutrition or unit gaps. Use get_household_config recipe_search_places for where this household looks up recipes. Do not store the recipe as a food. When it returns similar_foods, ask the person about every listed ingredient at once, then call again passing each chosen food_id on that ingredient or new_food: true. mention_warnings lists foods the steps use that the ingredients lack: they never block or unverify a recipe; ask the person, and call add_recipe_ingredient only if they say yes.',
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                text: z.string(),
                instructions: z.string().max(20_000).optional(),
                source_url: z.string().optional(),
                name: z.string().optional(),
                yield_portions: z.coerce.number().optional(),
                ingredients: z
                    .array(
                        z.object({
                            name: z.string(),
                            amount: z.coerce.number().nullable().optional(),
                            unit: z.string().optional(),
                            note: z.string().optional(),
                            food_id: z.string().optional(),
                            barcode: z.string().optional(),
                            new_food: NEW_FOOD_INPUT,
                        }),
                    )
                    .optional(),
                tags: z.array(z.string()).optional(),
                notes: z.string().optional(),
                prep_minutes: z.coerce.number().optional(),
                cook_minutes: z.coerce.number().optional(),
                on_similar: ON_SIMILAR_INPUT,
            }),
            outputSchema: IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "import_recipe_from_text",
                async () => {
                    const actor = await callerActor();
                    const household = await getHouseholdConfig(
                        actor.householdId,
                    );
                    const places = recipePlacesToWire(
                        household.recipeSearchPlaces,
                    );
                    const onSimilar = onSimilarFor(args);
                    try {
                        const result = await importRecipeFromText(
                            liveRecipesStore(),
                            liveFoodsStore(),
                            {
                                householdId: actor.householdId,
                                creatorId: actor.userId,
                                text: args.text,
                                instructions: args.instructions,
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
                                    newFood: line.new_food,
                                })),
                                tags: args.tags,
                                notes: args.notes,
                                prepMinutes: args.prep_minutes,
                                cookMinutes: args.cook_minutes,
                                onSimilar,
                            },
                            {
                                lookup: (barcode) =>
                                    lookupBarcode(barcode, {
                                        householdId: actor.householdId,
                                    }),
                                transaction: (fn) => run(async () => fn()),
                            },
                        );
                        const importGapRows = result.gaps;
                        const mentionWarnings = await mentionWarningsFor(
                            actor.householdId,
                            result.recipe.id,
                        );
                        const payload = {
                            status: "ok" as const,
                            similar_foods: [],
                            recipe: recipeFields(result.recipe),
                            ingredients: result.ingredients.map(
                                (ingredient) => ({
                                    id: ingredient.id,
                                    food_id: ingredient.foodId,
                                    display_name: ingredient.displayName,
                                    amount: ingredient.quantity?.amount ?? null,
                                    unit: ingredient.quantity?.unit ?? null,
                                    note: ingredient.note,
                                    missing:
                                        importGapRows.find(
                                            (gap) =>
                                                gap.ingredientId ===
                                                ingredient.id,
                                        )?.missing ?? [],
                                }),
                            ),
                            recipe_search_places: places,
                            verification: result.verification,
                            problems: wireProblems(result.problems),
                            mention_warnings:
                                wireMentionWarnings(mentionWarnings),
                        };
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Imported ${result.recipe.name} ${result.recipe.id} (${result.verification})\n${payload.ingredients
                                        .map(
                                            (row) =>
                                                `${row.display_name} ${row.amount != null && row.unit ? `${row.amount} ${row.unit}` : row.note?.trim() || "to taste"}${row.missing.length ? ` missing ${row.missing.join(", ")}` : ""}`,
                                        )
                                        .join("\n")}${
                                        places.length
                                            ? `\nSearch places: ${places.map((place) => place.name).join(", ")}`
                                            : ""
                                    }${mentionWarningsText(mentionWarnings)}`,
                                },
                            ],
                            structuredContent: payload,
                        };
                    } catch (err) {
                        if (err instanceof SimilarFoodsError) {
                            const wire = similarFoodsWire(err.entries);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: similarFoodsText(err.entries),
                                    },
                                ],
                                structuredContent: {
                                    status: "similar_foods" as const,
                                    similar_foods: wire,
                                    recipe: null,
                                    ingredients: [],
                                    recipe_search_places: places,
                                    verification: null,
                                    problems: [],
                                    mention_warnings: [],
                                },
                            };
                        }
                        if (err instanceof RecipeInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
            ),
    );

    server.registerTool(
        "verify_recipe",
        {
            title: "Verify Recipe",
            description:
                "Run the deterministic check on a recipe. Only this check can verify a recipe; there is no override. Use after fixing an unverified import. It also lists mention_warnings (foods the steps use that the ingredients lack), which never affect the result. Pass resolved_lines with the unresolved import lines you have dealt with (added as ingredients, or not needed); they are removed before the check runs, and any other unresolved lines still count.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                resolved_lines: z
                    .array(z.string().max(2000))
                    .max(200)
                    .optional()
                    .describe(
                        "Unresolved import lines you have handled, copied exactly from get_recipe.",
                    ),
            }),
            outputSchema: VERIFY_RECIPE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "verify_recipe",
                async () => {
                    const actor = await callerActor();
                    const store = liveRecipesStore();
                    const recipe = await store.getRecipe(
                        actor.householdId,
                        args.recipe_id,
                    );
                    if (!recipe) {
                        const payload = {
                            status: "not_found" as const,
                            recipe_id: args.recipe_id,
                            verification: null,
                            problems: [] as {
                                code: string;
                                message: string;
                                ingredient_id: string | null;
                                line: string | null;
                            }[],
                            mention_warnings: [] as ReturnType<
                                typeof wireMentionWarnings
                            >,
                        };
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "Unknown recipe.",
                                },
                            ],
                            structuredContent: payload,
                        };
                    }
                    const checked =
                        args.resolved_lines && args.resolved_lines.length > 0
                            ? await resolveUnresolvedLines(
                                  store,
                                  actor.householdId,
                                  args.recipe_id,
                                  args.resolved_lines,
                              )
                            : await recheckRecipe(
                                  store,
                                  actor.householdId,
                                  args.recipe_id,
                              );
                    const mentionWarnings = await mentionWarningsFor(
                        actor.householdId,
                        args.recipe_id,
                    );
                    const payload = {
                        status: checked.verification,
                        recipe_id: args.recipe_id,
                        verification: checked.verification,
                        problems: wireProblems(checked.problems),
                        mention_warnings: wireMentionWarnings(mentionWarnings),
                    };
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${
                                    checked.verified
                                        ? `${recipe.name} passed the check.`
                                        : checked.verification === "verified"
                                          ? `${recipe.name} was made by hand, so it stays verified. The check found: ${checked.problems.map((row) => row.message).join(" ")}`
                                          : `${recipe.name} is still unverified (${checked.problems.length} problem${checked.problems.length === 1 ? "" : "s"}): ${checked.problems.map((row) => row.message).join(" ")}`
                                }${mentionWarningsText(mentionWarnings)}`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "import_recipe_from_url",
        {
            title: "Import Recipe From URL",
            description:
                "Import a recipe from a link. For a recipe website, reads the page's published recipe data. For a social post (Instagram, TikTok, Facebook, Threads, Pinterest, YouTube), returns status paste_needed when no text is given — ask the user to paste the caption (for Pinterest, first ask for the recipe website the pin links to, otherwise the recipe text), then call again with text. The household may have turned on an opt-in TikTok or Facebook reader; if status is still paste_needed, reader_failure explains why and you should ask for the caption. Never open, fetch, or browse the post yourself. When status is no_recipe_in_text, the caption has no recipe — ask the user to type it or send a screenshot. Returns unresolved_lines and problems so you can fix an unverified import and call verify_recipe. mention_warnings lists foods the steps use that the ingredients lack: they never block or unverify a recipe; ask the user, and call add_recipe_ingredient only if they say yes.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            inputSchema: z.object({
                url: z
                    .string()
                    .describe("HTTPS link to a recipe page or social post."),
                text: z
                    .string()
                    .max(20_000)
                    .optional()
                    .describe(
                        "The caption or recipe the user pasted. Needed for Instagram, Facebook, Threads, TikTok, Pinterest and YouTube links.",
                    ),
                credit: z
                    .string()
                    .max(120)
                    .optional()
                    .describe("Optional creator name the user typed."),
                retry: z
                    .boolean()
                    .optional()
                    .describe(
                        "Check the link again even if Foodable remembers the site refusing or the page being gone.",
                    ),
            }),
            outputSchema: IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "import_recipe_from_url",
                async () => {
                    const actor = await callerActor();
                    const household = await getHouseholdConfig(
                        actor.householdId,
                    );
                    const readerEnabled = await recipeLinkReaderEnabled(
                        actor.householdId,
                    );
                    const paused = linkImportPaused({
                        text: args.text,
                        readerEnabled,
                    });
                    const handled = !paused
                        ? await (async () => {
                              const outcome = await importRecipeFromUrl(
                                  {
                                      recipes: liveRecipesStore(),
                                      foods: liveFoodsStore(),
                                      fetcher: await recipeImportFetcher({
                                          householdId: actor.householdId,
                                      }),
                                      memory: recipeFetchMemory(),
                                      transaction: (fn) =>
                                          run(async () => fn()),
                                      readers:
                                          household.preferences.socialReaders,
                                      readerStatus:
                                          liveSocialReaderStatusStore(),
                                  },
                                  {
                                      householdId: actor.householdId,
                                      creatorId: actor.userId,
                                      url: args.url,
                                      text: args.text,
                                      credit: args.credit,
                                      textOrigin: "pasted",
                                      retry: args.retry === true,
                                  },
                              );
                              // A duplicate points at a recipe already saved, whose
                              // warnings are as live as a fresh import's.
                              const mentionWarnings =
                                  outcome.status === "imported" ||
                                  outcome.status ===
                                      "unverified_needs_review" ||
                                  outcome.status === "duplicate"
                                      ? await mentionWarningsFor(
                                            actor.householdId,
                                            outcome.recipeId,
                                        )
                                      : [];
                              const built = {
                                  status: outcome.status,
                                  recipe_id: outcome.recipeId,
                                  recipe_name: outcome.recipeName,
                                  verification: outcome.verification,
                                  problems: wireProblems(outcome.problems),
                                  source: outcome.source
                                      ? {
                                            kind: outcome.source.kind,
                                            url: outcome.source.url,
                                            label: outcome.source.label,
                                        }
                                      : null,
                                  unresolved_lines: outcome.unresolvedLines,
                                  reader_failure: outcome.readerFailure,
                                  message: importOutcomeMessage(outcome),
                                  from_memory: outcome.fromMemory,
                                  remembered_until: outcome.rememberedUntil,
                                  mention_warnings:
                                      wireMentionWarnings(mentionWarnings),
                              };
                              IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(built);
                              return {
                                  payload: built,
                                  text: `${built.message}${mentionWarningsText(mentionWarnings)}`,
                              };
                          })()
                        : (() => {
                              const payload =
                                  importRecipeFromUrlPausedStructuredContent(
                                      args.url,
                                  );
                              return { payload, text: payload.message };
                          })();
                    return {
                        content: [{ type: "text", text: handled.text }],
                        structuredContent: handled.payload,
                    };
                },
                analytics,
                undefined,
                {
                    outcome: (r) => {
                        const status = (
                            r as {
                                structuredContent?: {
                                    status?: RecipeImportStatus;
                                };
                            }
                        ).structuredContent?.status;
                        return importRecipeFromUrlAnalyticsOutcome(status);
                    },
                },
            ),
    );
}
