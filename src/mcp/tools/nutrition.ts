import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    insertMeal,
    getMealsByDate,
    getWaterByDate,
    deleteMeal,
    updateMeal,
    getNutritionGoals,
    countMeals,
    existingIdempotencyKeys,
    existingMealIds,
    snapshotToMealItemWrite,
    type Meal,
    type MealInput,
} from "../../db/nutrition.js";
import {
    getUserTimezone,
    timezoneFromProfile,
    getProfile,
} from "../../db/profiles.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, dateInTz } from "../../domain/tz.js";
import { WIDGET_LOCALE } from "../../routes.js";
import {
    runImport,
    buildSummaryText,
    serializeImportResult,
    BULK_IMPORT_OUTPUT_SCHEMA,
    MAX_ROWS_PER_CALL,
    MAX_CALORIES,
    MAX_MACRO_G,
    MAX_ALCOHOL_G,
    MAX_CAFFEINE_MG,
    type BulkImportArgs,
} from "../../domain/import.js";
import { getWidgetHtml } from "../../widgets.js";
import {
    NUTRIENT_COVERAGE,
    APP_UI_MIME_TYPE,
    MEAL_LOGGED_WIDGET_URI,
    IMPORT_MEALS_WIDGET_URI,
    sumMeals,
    nutrientPresence,
    sumWater,
    mealBreakdown,
    MEAL_PROGRESS_OUTPUT_SCHEMA,
    DRINK_UNIT_FIELD,
    goalsPayloadOf,
    totalsPayloadOf,
    formatProgress,
    LOGGED_AT_FORMS,
    LOGGED_AT_OMIT_IF_NOW,
    resolveWriteTimestamp,
    formatMeal,
    alcoholHiddenNote,
    missingNutrientNote,
    type AlcoholDisplay,
} from "../shared.js";
import type { ToolContext } from "../shared.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import {
    callerSentTotals,
    COMPUTED_TOTALS_WARNING,
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
    type MealItemSpec,
} from "../../domain/meals.js";
import {
    registerNutritionReadTools,
    registerNutritionInsightTools,
} from "./nutrition-insights.js";

// ---------- bulk_import_meals ----------

// Ceiling on total rows per user. Rate limiting is per HTTP request, so one
// batched call writes up to MAX_ROWS_PER_CALL rows for a single limiter hit;
// without this there is no bound on table growth. Set far above any real user:
// 200k rows is ~180 years at three meals a day.
export const MAX_MEALS_PER_USER = 200_000;

// Deliberately permissive: bounds live in validateRow so a single bad cell
// produces an identified per-row error instead of a Zod rejection that discards
// the whole batch (and the structured report with it). z.coerce mirrors
// log_meal, whose numbers are coerced because models emit "450" as a string.
export const IMPORT_ROW_SCHEMA = z.object({
    source_line: z.coerce
        .number()
        .describe(
            "1-based line number of this row in the source file. Required: the server checks that line numbers are unique and increasing to detect dropped or duplicated rows.",
        ),
    description: z
        .string()
        .optional()
        .describe(
            "What was eaten. Include the portion in the text, e.g. 'Oatmeal (1 cup dry) with banana'. Omit only when the source has no food name at all.",
        ),
    logged_at: z
        .string()
        .optional()
        .describe(
            "When it was eaten. Accepts 'YYYY-MM-DD' (logged at local noon), 'YYYY-MM-DDTHH:mm' as LOCAL time in the user's timezone, or full ISO 8601 with an offset. Prefer local time straight from the file: do NOT compute UTC offsets yourself.",
        ),
    timezone: z
        .string()
        .optional()
        .describe(
            "IANA timezone (e.g. 'Europe/Kyiv') this row's logged_at should be read in, when logged_at carries no offset. Map it from a 'timezone' column when the file is an export from THIS server (the meals.csv in an export_all_data archive carries one) — that column names the zone the meal was actually recorded in, which may no longer match the account's current timezone. Omit for files with no such column; the row then falls back to the account's configured timezone.",
        ),
    meal_type: z
        .string()
        .optional()
        .describe(
            "breakfast, lunch, dinner or snack. Case-insensitive; unrecognized values become snack. Omit when the source has no meal column and it will be inferred from the time.",
        ),
    calories: z.coerce.number().optional(),
    protein_g: z.coerce.number().optional(),
    carbs_g: z.coerce.number().optional(),
    fat_g: z.coerce.number().optional(),
    fiber_g: z.coerce.number().optional().describe("Dietary fiber in grams."),
    sugar_g: z.coerce
        .number()
        .optional()
        .describe(
            "TOTAL sugars in grams, including sugar naturally present in fruit and milk — not added sugar. Map the export's 'Sugars' column straight across; do not try to subtract naturally occurring sugar.",
        ),
    alcohol_g: z.coerce
        .number()
        .optional()
        .describe(
            "Grams of pure ethanol (NOT the volume of the drink and NOT its ABV). If the export gives a drink volume and strength instead, compute it: grams = millilitres x (ABV% / 100) x 0.789. Omit when the source has no alcohol column.",
        ),
    caffeine_mg: z.coerce
        .number()
        .optional()
        .describe(
            "Caffeine in MILLIGRAMS, not grams. Every export, label and guideline states caffeine in mg (a brewed coffee is about 95 mg, i.e. 0.095 g), so map an mg column straight across — and multiply by 1000 first if the source header says grams, or the whole history imports a thousand times too small. Omit when the source has no caffeine column.",
        ),
    notes: z
        .string()
        .optional()
        .describe(
            "Anything from the source worth keeping that has no column here (micronutrients, the original row text).",
        ),
    client_row_id: z
        .string()
        .optional()
        .describe(
            "Optional label echoed back in the result so you can match errors to your own rows.",
        ),
    source_id: z
        .string()
        .optional()
        .describe(
            "The value of the 'id' column when the file is an export from THIS server (the meals.csv in an export_all_data archive carries it). Always pass it through: it is how a re-imported backup is recognized as the user's existing meals instead of being duplicated. Ignored for files from other apps.",
        ),
});

// ---------- start_meal_import ----------

// Real content: the import widget needs all of this. With no structuredContent
// the bridge never paints and the iframe sits on its loading state forever.
export const START_IMPORT_OUTPUT_SCHEMA = z.object({
    tz: z.string(),
    tz_configured: z.boolean(),
    today: z.string(),
    max_rows_per_call: z.number(),
    import_tool_name: z.string(),
    known_source_apps: z.array(z.string()),
    widgets_enabled: z.boolean(),
    // The alcohol opt-in, reaching the importer the same way it reaches every
    // other widget-backed tool. Without it the widget auto-mapped an
    // `alcohol`/`ethanol` column and rendered a per-row ALC preview for a user
    // who had asked never to see alcohol — the exact scenario the opt-in
    // exists to prevent. What null makes the widget do: see startImportPayload.
    drink_unit: DRINK_UNIT_FIELD,
    // The widget's UI language — see the identical field on
    // get_nutrition_summary's outputSchema for why this is z.string() and
    // Widgets are English-only; always the literal "en".
    locale: z.string(),
    user_id: z.string(),
});

export function startImportPayload(opts: {
    tz: string;
    tzConfigured: boolean;
    widgetsEnabled: boolean;
    alcohol: AlcoholDisplay;
    locale: string;
    userId: string;
}) {
    return {
        // The widget must resolve dates the same way the server will, so it is
        // told the timezone rather than guessing.
        tz: opts.tz,
        tz_configured: opts.tzConfigured,
        today: todayInTz(opts.tz),
        max_rows_per_call: MAX_ROWS_PER_CALL,
        import_tool_name: "bulk_import_meals",
        known_source_apps: [
            "myfitnesspal",
            "cronometer",
            "loseit",
            "macrofactor",
        ],
        widgets_enabled: opts.widgetsEnabled,
        // Null = alcohol tracking is off. The importer then does not auto-map
        // an alcohol column, does not render the ALC preview column, and does
        // NOT send alcohol_g — the file's alcohol never reaches the screen and
        // never reaches the database by this route.
        //
        // Why this route drops it, when CONTRACT §7 says alcohol is stored
        // whenever it is explicitly passed: in this flow the preview IS the
        // contract. The whole reason start_meal_import is preferred over
        // bulk_import_meals is that the user reads and approves every row
        // themselves instead of a model transcribing it. Writing a column that
        // was deliberately never shown breaks that promise and leaves an
        // unverifiable number in the log — one the user cannot audit, because
        // the only surface that would display it is the one their opt-out
        // turned off. Note the gate is the widget's, not the write layer's:
        // bulk_import_meals stores alcohol_g for any caller that passes it,
        // tracking on or off, and that is unchanged.
        //
        // The cost, which is real and is why the widget says so out loud: the
        // loss is permanent, not merely deferred. alcohol_g is deliberately
        // excluded from the import digest (CONTRACT §2), so re-importing the
        // same file after turning tracking on dedupes to a clean no-op and
        // back-fills nothing. There is no second chance. The widget therefore
        // shows an explicit notice when the file HAS an alcohol column and
        // tracking is off — that it will not be imported, and that enabling
        // tracking before importing is how to keep it. Silent would be
        // indefensible; announced, it is the user's call to make.
        drink_unit: opts.alcohol,
        locale: opts.locale,
        user_id: opts.userId,
    };
}

// Compute the day's running totals vs goals for a meal that was just logged or
// updated, packaging both the model-facing progress text and the meal-logged
// widget's structuredContent. Shared by log_meal and update_meal so the two
// tools stay in lockstep.
export async function buildMealProgress(
    userId: string,
    meal: Meal,
    action: "logged" | "updated",
    alcohol: AlcoholDisplay,
) {
    const profile = await getProfile(userId);
    const tz = timezoneFromProfile(profile) ?? "UTC";
    const locale = WIDGET_LOCALE;
    const mealDate = dateInTz(meal.logged_at, tz);
    const [meals, waterEntries, goals] = await Promise.all([
        getMealsByDate(userId, mealDate, tz),
        getWaterByDate(userId, mealDate, tz),
        getNutritionGoals(userId),
    ]);
    const totals = sumMeals(meals);
    totals.water_ml = sumWater(waterEntries);
    const present = nutrientPresence(meals);

    const progressSection = goals
        ? `\n\nDaily progress (${mealDate}):\n${formatProgress(totals, goals, alcohol, present)}`
        : "\n\nNo nutrition goals set — use the set_nutrition_goals tool to track progress against daily targets.";

    const structuredContent = {
        action,
        date: mealDate,
        drink_unit: alcohol,
        locale,
        logged_meal: {
            description: meal.description,
            meal_type: meal.meal_type ?? null,
            calories: meal.calories ?? null,
            protein_g: meal.protein_g ?? null,
            carbs_g: meal.carbs_g ?? null,
            fat_g: meal.fat_g ?? null,
            fiber_g: meal.fiber_g ?? null,
            sugar_g: meal.sugar_g ?? null,
            alcohol_g: alcohol ? (meal.alcohol_g ?? null) : null,
            // Ungated, unlike alcohol_g directly above it: what was stored is
            // what is shown.
            caffeine_mg: meal.caffeine_mg ?? null,
        },
        has_goals: goals != null,
        goals: goalsPayloadOf(goals, alcohol),
        totals: totalsPayloadOf(totals, alcohol, present.caffeine_mg),
        // Single day → label rows by meal type in the widget, not by date.
        meals: mealBreakdown(meals, null, alcohol),
    };

    return { progressSection, structuredContent };
}

export const MEAL_ITEM_INPUT_SCHEMA = z.object({
    food_id: z
        .string()
        .optional()
        .describe("Household catalog food id. Preferred when known."),
    recipe_id: z
        .string()
        .optional()
        .describe("Recipe to log as a portion of this meal."),
    name: z
        .string()
        .optional()
        .describe(
            "Food name when you do not have a food_id. Resolved through the household catalog (find-or-create).",
        ),
    amount: z.coerce.number().positive().optional().describe("Amount eaten."),
    unit: z
        .string()
        .optional()
        .describe("Unit for amount (g, each, cup, ml, …)."),
    portions: z.coerce
        .number()
        .positive()
        .optional()
        .describe("Recipe portions. Used when recipe_id is set."),
});

function specsFromToolItems(
    items: z.infer<typeof MEAL_ITEM_INPUT_SCHEMA>[],
): MealItemSpec[] {
    return items.map((item) => ({
        foodId: item.food_id,
        recipeId: item.recipe_id,
        name: item.name,
        amount: item.amount,
        unit: item.unit,
        portions: item.portions,
    }));
}

export async function mealWriteFromItems(
    householdId: string,
    items: z.infer<typeof MEAL_ITEM_INPUT_SCHEMA>[],
): Promise<{
    totals: Pick<
        MealInput,
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
    >;
    items: MealInput["items"];
    item_digest: string;
    unknownNote: string;
    description: string;
}> {
    const specs = specsFromToolItems(items);
    const { built, specs: resolved } = await resolveAndBuildMeal({
        householdId,
        foods: liveFoodsStore(),
        recipes: liveRecipesStore(),
        items: specs,
    });
    return {
        totals: {
            calories: built.totals.calories ?? undefined,
            protein_g: built.totals.protein_g ?? undefined,
            carbs_g: built.totals.carbs_g ?? undefined,
            fat_g: built.totals.fat_g ?? undefined,
            fiber_g: built.totals.fiber_g ?? undefined,
            sugar_g: built.totals.sugar_g ?? undefined,
            alcohol_g: built.totals.alcohol_g ?? undefined,
            caffeine_mg: built.totals.caffeine_mg ?? undefined,
        },
        items: built.items.map((item) =>
            snapshotToMealItemWrite(item, householdId),
        ),
        item_digest: itemListDigest(resolved),
        unknownNote:
            built.unknownItems.length > 0
                ? `\n\nNutrition unknown for: ${built.unknownItems.join(", ")}.`
                : "",
        description: descriptionFromItems(built.items),
    };
}

export function registerNutritionWriteTools(
    server: McpServer,
    ctx: ToolContext,
) {
    const {
        widgetsEnabled,
        alcohol,
        personSchema,
        nutritionWriteSchema,
        actorUserId,
        writeUserId,
        callerHouseholdId,
        analytics,
        uiMeta,
        hasGoals,
    } = ctx;
    const mealLoggedUiMeta = hasGoals ? uiMeta(MEAL_LOGGED_WIDGET_URI) : {};
    server.registerTool(
        "log_meal",
        {
            title: "Log Meal",
            description:
                // The nutrient-completeness rule is spliced in from the shared
                // NUTRIENT_COVERAGE rather than restated, because
                // SERVER_INSTRUCTIONS carries the same paragraph and many hosts
                // surface only one of the two.
                "Log a meal entry with nutritional information. If the user doesn't specify the quantity or portion size, ask how much they ate before estimating calories and macros. When the user gives a barcode — typed, or read from a photo of the package (transcribe the digits printed under the barcode) — call lookup_barcode first to get the product's label data, then scale it to the amount eaten. Fall back to web search or estimation only when no product is found. Use web search for branded products when no barcode is available. When logging from a photo of a plated or prepared meal (no package/barcode): first identify each dish, then establish whether it is a restaurant/takeout meal or homemade before anything else. If it is from a restaurant, ask which restaurant and where, then search the web for its menu — chains publish per-item nutrition worth using directly, independent places usually publish ingredient lists that reveal the butter, cream, and oil the photo hides; if you cannot find the menu or cannot tell which dish it is, say so and put your assumption to the user as a question rather than presenting a guess as menu data. Either way, estimate portions in household measures the user can eyeball (a glass of, a handful of, a tablespoon of — NOT grams; for restaurant servings ask how much of it they actually ate), call search_meals to see how similar meals were logged before and to surface ingredients that may be invisible in the photo, then interview the user across multiple turns — one question per message, covering which variation each dish is, how much they ate, and photo-invisible ingredients (oil, sugar, sauce, what a drink was made with) — until nothing is left open. Do NOT call this tool after a single question-and-answer round; a lone confirmation is not enough. Only call it once every open question is resolved and the user has approved a full summary of the meal (or has told you to stop asking and just log it). Write the confirmed household-measure portions into the description itself (e.g. 'Oatmeal (1 glass raw oats, 2 glasses milk) with banana') so future searches are self-describing, and for a restaurant meal name the venue and city too (e.g. 'Pad thai with chicken (1 plate, finished) at Thai Basil, Podil, Kyiv').\n\n" +
                NUTRIENT_COVERAGE +
                "\nPutting '180 mg caffeine' or '6 g fiber' in notes or in the description instead of in the field leaves it out of every total, goal and chart.\nFor items from the household catalog, pass the plain food (\"eggs\", or its food_id) rather than a brand, so the household's usual product supplies the nutrition.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                description: z.string().describe("What was eaten"),
                meal_type: z
                    .enum(["breakfast", "lunch", "dinner", "snack"])
                    .describe(
                        "Type of meal (breakfast, lunch, dinner, or snack). Always ask the user if not provided.",
                    ),
                // Bounded in the schema, not the handler — see the MAX_*
                // constants for why this tool differs from bulk_import_meals.
                calories: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_CALORIES)
                    .optional()
                    .describe("Total calories"),
                protein_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe("Protein in grams"),
                carbs_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe("Carbohydrates in grams"),
                fat_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe("Fat in grams"),
                // Fiber and sugar carry reference anchors for the same reason
                // caffeine_mg does: the field is optional in the schema but
                // effectively mandatory in practice, so the model needs a last
                // resort that is better than skipping the field. See
                // NUTRIENT_COVERAGE for why an omission costs the whole day.
                fiber_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe(
                        "Dietary fiber in grams. Send this on every meal — treat it as mandatory alongside protein, carbs and fat, and estimate it rather than omitting it, because a missing value is not a zero and excludes the whole day from the user's fiber average and goal. Prefer a label or a barcode lookup, then a web search, then these anchors per 100 g: cooked lentils or beans 5-8 g, dry rolled oats 10 g, wholemeal bread 7 g, white bread 2.7 g, cooked wholewheat pasta 4 g (white 2 g), cooked brown rice 1.8 g (white 0.4 g), potato with skin 2 g, most vegetables 2-3 g, apple or pear with skin 2.4-3 g, banana 2.6 g, berries 5-7 g, almonds 12 g, chia 34 g. Meat, fish, eggs, dairy, oil and sugar contain none: send 0 there, do not omit the field.",
                    ),
                sugar_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe(
                        "TOTAL sugars in grams — including sugar naturally present in fruit, milk and juice, not just added sugar. Report the whole figure a nutrition label or database gives for 'Sugars'; do not try to separate out added sugar. Send this on every meal, estimating rather than omitting it: a missing value is not a zero and drops the whole day out of the sugar average and limit. Anchors per 100 g when you have nothing better: milk 5 g, plain yogurt 4.7 g, fruit yogurt 12 g, apple 10 g, banana 12 g, orange 9 g, berries 5-10 g, dried dates 63 g, cola 10.6 g, orange juice 8.4 g, ketchup 22 g, milk chocolate 52 g, bread 3-5 g. Meat, fish, eggs, cheese, oil, rice, pasta and most vegetables are ~0: send 0 there, do not omit the field.",
                    ),
                alcohol_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_ALCOHOL_G)
                    .optional()
                    .describe(
                        "Grams of pure ethanol — NOT the volume of the drink and NOT its ABV. Do not estimate this: compute it from the volume and strength, which the user can read off the bottle or the menu. grams = millilitres x (ABV% / 100) x 0.789. Worked examples: a 330 ml 5% beer = 330 x 0.05 x 0.789 = 13 g; a 150 ml glass of 13% wine = 15.4 g; a 44 ml (1.5 oz) shot of 40% spirit = 13.9 g. For US measures, 1 fl oz = 29.6 ml. Ask for the pour size and the ABV rather than guessing, and omit the field entirely for a non-alcoholic meal.",
                    ),
                caffeine_mg: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_CAFFEINE_MG)
                    .optional()
                    .describe(
                        "Caffeine in MILLIGRAMS (mg) — this field is the one that is not in grams, and a value under 1 almost certainly means grams were sent by mistake. Typical amounts: a 240 ml brewed coffee 95 mg, a single espresso 63 mg, instant coffee 62 mg, black tea 47 mg, green tea 28 mg, a 355 ml cola 34 mg, a 250 ml energy drink 80 mg, decaf 2 mg. Scale them to what was actually drunk (a double espresso is 126 mg), and for a branded drink prefer the figure on the label or the chain's published nutrition. Caffeine adds no calories, so it never changes the kcal figure. Unlike fiber_g and sugar_g, this field is conditional, so decide it on every entry rather than skipping it by default: if the item is a caffeine source at all — coffee including decaf, tea, matcha, yerba mate, cola and other soft drinks, energy drinks, pre-workout, chocolate and cocoa, coffee ice cream, caffeine tablets — send a figure, searching the web for a branded drink whose label you do not know and falling back to the amounts above. Omit the field for anything that is not a caffeine source rather than sending 0 — a 0 records 'measured, and it was none', and one on a sandwich puts a caffeine row on the dashboard of a user who never drinks any.",
                    ),
                logged_at: z
                    .string()
                    .optional()
                    .describe(
                        "When this actually happened (defaults to now). " +
                            LOGGED_AT_FORMS +
                            LOGGED_AT_OMIT_IF_NOW,
                    ),
                notes: z.string().optional().describe("Additional notes"),
                idempotency_key: z
                    .string()
                    .min(1)
                    .max(255)
                    .optional()
                    .describe(
                        "Optional stable key for safe retries. You normally don't need to set this: when omitted, the server derives a stable key from the meal content (including logged_at), so replaying the identical call returns the original meal instead of duplicating it. Pass a UUID only to force-override that behavior. Do NOT reuse a key for genuinely different meals.",
                    ),
                items: z
                    .array(MEAL_ITEM_INPUT_SCHEMA)
                    .optional()
                    .describe(
                        "Foods and recipe portions that make up this meal. When present, the server computes calories and macros from catalog snapshots and ignores any totals you send (a warning is returned). Omit for a free-text / estimated meal — that path is unchanged.",
                    ),
            }),
            outputSchema: MEAL_PROGRESS_OUTPUT_SCHEMA,
            // Link the tool to its progress UI (MCP Apps). update_meal reuses
            // the SAME widget; see buildMealProgress / meal-logged.html. With
            // no goals the link is dropped (ToolContext.hasGoals).
            ...mealLoggedUiMeta,
        },
        async ({ user_id, target_member, items, ...mealArgs }) => {
            return withAnalytics(
                "log_meal",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const { iso, note } = await resolveWriteTimestamp(
                        userId,
                        mealArgs.logged_at,
                    );
                    let extra = "";
                    let write: MealInput = {
                        ...mealArgs,
                        logged_at: iso,
                    };
                    if (items && items.length > 0) {
                        try {
                            const householdId = await callerHouseholdId();
                            const computed = await mealWriteFromItems(
                                householdId,
                                items,
                            );
                            if (callerSentTotals(mealArgs)) {
                                extra += `\n\n${COMPUTED_TOTALS_WARNING}`;
                            }
                            extra += computed.unknownNote;
                            write = {
                                description: mealArgs.description,
                                meal_type: mealArgs.meal_type,
                                notes: mealArgs.notes,
                                idempotency_key: mealArgs.idempotency_key,
                                logged_at: iso,
                                ...computed.totals,
                                items: computed.items,
                                item_digest: computed.item_digest,
                            };
                        } catch (err) {
                            if (err instanceof MealItemsError) {
                                throw new Error(err.message);
                            }
                            throw err;
                        }
                    }
                    const { meal, deduplicated } = await insertMeal(
                        userId,
                        write,
                    );
                    const header = deduplicated
                        ? "Meal already logged (idempotent retry):"
                        : "Meal logged:";

                    const { progressSection, structuredContent } =
                        await buildMealProgress(
                            userId,
                            meal,
                            "logged",
                            alcohol,
                        );

                    return {
                        content: [
                            {
                                type: "text",
                                text: `${header}\n${formatMeal(meal, alcohol)}${progressSection}${alcoholHiddenNote(
                                    (meal.alcohol_g ?? 0) > 0,
                                    alcohol,
                                    "Alcohol saved with this meal",
                                )}${missingNutrientNote(meal)}${note}${extra}`,
                            },
                        ],
                        structuredContent,
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "log_recipe_portion",
        {
            title: "Log Recipe Portion",
            description:
                "Log a meal as one recipe portion. Per-person macros come from the recipe's catalog foods (macrosForPerson). Prefer this when the user ate a known household recipe rather than estimating free-text macros.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                recipe_id: z.string().describe("Recipe to log a portion of."),
                portions: z.coerce
                    .number()
                    .positive()
                    .describe("How many portions of the recipe were eaten."),
                meal_type: z
                    .enum(["breakfast", "lunch", "dinner", "snack"])
                    .optional()
                    .describe("Type of meal. Defaults to snack when omitted."),
                logged_at: z
                    .string()
                    .optional()
                    .describe(
                        "When this actually happened (defaults to now). " +
                            LOGGED_AT_FORMS +
                            LOGGED_AT_OMIT_IF_NOW,
                    ),
            }),
            outputSchema: MEAL_PROGRESS_OUTPUT_SCHEMA,
            ...mealLoggedUiMeta,
        },
        async ({
            user_id,
            target_member,
            recipe_id,
            portions,
            meal_type,
            logged_at,
        }) => {
            return withAnalytics(
                "log_recipe_portion",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const householdId = await callerHouseholdId();
                    const { iso, note } = await resolveWriteTimestamp(
                        userId,
                        logged_at,
                    );
                    let computed;
                    try {
                        computed = await mealWriteFromItems(householdId, [
                            { recipe_id, portions },
                        ]);
                    } catch (err) {
                        if (err instanceof MealItemsError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                    const { meal, deduplicated } = await insertMeal(userId, {
                        description: computed.description,
                        meal_type: meal_type ?? "snack",
                        logged_at: iso,
                        ...computed.totals,
                        items: computed.items,
                        item_digest: computed.item_digest,
                    });
                    const header = deduplicated
                        ? "Meal already logged (idempotent retry):"
                        : "Meal logged:";
                    const { progressSection, structuredContent } =
                        await buildMealProgress(
                            userId,
                            meal,
                            "logged",
                            alcohol,
                        );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${header}\n${formatMeal(meal, alcohol)}${progressSection}${alcoholHiddenNote(
                                    (meal.alcohol_g ?? 0) > 0,
                                    alcohol,
                                    "Alcohol saved with this meal",
                                )}${missingNutrientNote(meal)}${note}${computed.unknownNote}`,
                            },
                        ],
                        structuredContent,
                    };
                },
                analytics,
            );
        },
    );

    // UI resource for the import widget. Registered unconditionally, like every
    // other widget resource — only the tool's _meta.ui link is gated per user.
    server.registerResource(
        "import-meals-widget",
        IMPORT_MEALS_WIDGET_URI,
        {
            title: "Import Meals",
            description:
                "Interactive importer for a meal-history export: reads the file in the browser, maps its columns, previews the rows, then writes them via bulk_import_meals.",
            mimeType: APP_UI_MIME_TYPE,
        },
        async (uri) => {
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: APP_UI_MIME_TYPE,
                        text: await getWidgetHtml("import-meals"),
                        _meta: { ui: { prefersBorder: true } },
                    },
                ],
            };
        },
    );

    server.registerTool(
        "start_meal_import",
        {
            title: "Import Meals from a File",
            description:
                "Open an importer the user can drive themselves to load a meal-history export (MyFitnessPal, Cronometer, Lose It!, MacroFactor). Prefer this over bulk_import_meals whenever the user has an actual file: the importer reads and maps it in the browser, so the rows never pass through you and cannot be mistranscribed, and it handles column mapping, batching and retries. Call it when the user says they want to import, upload, or bring in their history from another app. Fall back to bulk_import_meals if the user cannot use the importer, if they have already pasted the data into the conversation, or if the importer reports that this client will not let it save. If the user has alcohol tracking off but wants alcohol from the file, turn it on with set_alcohol_tracking BEFORE importing: the importer skips the alcohol column while tracking is off, and re-importing afterwards will not backfill it.",
            inputSchema: personSchema({}),
            outputSchema: START_IMPORT_OUTPUT_SCHEMA,
            annotations: {
                title: "Import Meals from a File",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
            ...uiMeta(IMPORT_MEALS_WIDGET_URI),
        },
        async (args) => {
            return withAnalytics(
                "start_meal_import",
                async () => {
                    const userId = await actorUserId(args.user_id);
                    const profile = await getProfile(userId);
                    const tz = timezoneFromProfile(profile);
                    const structuredContent = startImportPayload({
                        tz: tz ?? "UTC",
                        tzConfigured: tz !== null,
                        widgetsEnabled,
                        alcohol,
                        locale: WIDGET_LOCALE,
                        userId,
                    });
                    const text = widgetsEnabled
                        ? "Importer ready — pick your export file in the panel above. Nothing is saved until you confirm the preview." +
                          (tz === null
                              ? " Note: this account has no timezone set, so times will be read as UTC. Offer to set it first."
                              : "")
                        : "This account has widgets turned off, so the importer cannot be shown. Ask the user to paste their export (or enable widgets with set_widget_display), then import it yourself with bulk_import_meals.";
                    return {
                        content: [{ type: "text" as const, text }],
                        structuredContent,
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "bulk_import_meals",
        {
            title: "Bulk Import Meals",
            description:
                "Import many past meals in one call, for backfilling history from a file the user exported from another app (MyFitnessPal, Cronometer, Lose It!, MacroFactor) or from a list they pasted. Parse the source yourself and map it to the row schema; the server validates every row and reports per-row results, so you can fix and re-send only the rows that failed. Prefer this over calling log_meal in a loop — log_meal is rate-limited per call, so a week of meals would exhaust the budget. Two rules matter for correctness. (1) Compute expected_row_count, and expected_total_kcal when every row has calories, FROM THE SOURCE FILE using deterministic tooling (a script, or counting the actual lines) — never by re-reading the JSON you just wrote, which would only compare your output against itself and catch nothing. (2) Call once with dry_run: true first whenever the rows came from parsing a CSV, a screenshot, or free text; check the resolved logged_at and meal_type echoed back for every row, show the user what will be imported, and only then call again with dry_run: false. Pass local times exactly as the file gives them and let the server apply the user's timezone; do not compute UTC offsets yourself, and do not guess a value you cannot find — omit the field and list the column in unmapped_columns instead. (3) Because those local times are placed using the user's saved timezone, check with get_timezone before a large import: if it is unset the server falls back to UTC, and correcting it afterwards moves every imported meal — including onto adjacent days for anything logged near midnight. Offer set_timezone first. Maximum " +
                MAX_ROWS_PER_CALL +
                " rows per call: split larger files by date range, keeping all rows for one calendar date in the same call. If a single calendar date alone has more than " +
                MAX_ROWS_PER_CALL +
                " rows, that date has to be split across more than one call — the row cap is a hard server-side limit and wins over the same-call grouping. Doing so loosens deduplication for that date only: two rows in it that are byte-identical (same description, meal_type, calories, protein_g, carbs_g, fat_g, notes and logged_at) may collapse into one if they land in different calls, so prefer keeping duplicate-looking rows together in one call when you have to split. If the file is an export from THIS server (its header starts with an id column), map that column to source_id on every row, and map its timezone column to timezone on every row too — source_id is what makes restoring a backup a no-op instead of doubling the user's history, and timezone is what makes a restored row resolve at the local time it was actually recorded rather than the account's current timezone.",
            inputSchema: nutritionWriteSchema({
                meals: z
                    .array(IMPORT_ROW_SCHEMA)
                    .describe(
                        `The rows to import, in source-file order. 1 to ${MAX_ROWS_PER_CALL} per call.`,
                    ),
                expected_row_count: z.coerce
                    .number()
                    .describe(
                        "How many rows THIS call carries, counted from the source file. The server rejects the batch if it disagrees, which is how a dropped or truncated row gets caught.",
                    ),
                expected_total_kcal: z.coerce
                    .number()
                    .optional()
                    .describe(
                        "Sum of calories across this call's rows, from the source file. Supply it whenever every row has calories; the server reconciles it within 0.5%.",
                    ),
                dry_run: z
                    .boolean()
                    .default(false)
                    .describe(
                        "Validate and report what would happen without writing anything.",
                    ),
                on_error: z
                    .enum(["continue", "abort"])
                    .default("continue")
                    .describe(
                        "continue: import the valid rows and report the rest. abort: if ANY row fails validation, write nothing. Note writes are not transactional — once writing starts, a database error leaves earlier rows saved.",
                    ),
                rows_skipped: z.coerce
                    .number()
                    .default(0)
                    .describe(
                        "How many source rows you deliberately did not send (deleted entries, totals rows, unparseable lines). Explains gaps in source_line so they are not reported as dropped rows.",
                    ),
                unmapped_columns: z
                    .array(z.string())
                    .default([])
                    .describe(
                        "Source columns you could not map to any field. Report them here rather than inventing a place for them.",
                    ),
                source_app: z
                    .string()
                    .optional()
                    .describe(
                        "Which app the file came from, e.g. myfitnesspal. Used to label rows that have no food name of their own.",
                    ),
            }),
            outputSchema: BULK_IMPORT_OUTPUT_SCHEMA,
            annotations: {
                title: "Bulk Import Meals",
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
            },
            // ChatGPT's legacy Apps SDK path only lets a widget call tools
            // flagged widgetAccessible; without it the import-meals panel there
            // cannot reach its write path. Other hosts ignore the key.
            _meta: { "openai/widgetAccessible": true },
        },
        async (args) => {
            return withAnalytics(
                "bulk_import_meals",
                async () => {
                    const userId = await writeUserId(
                        args.user_id,
                        args.target_member,
                    );
                    // One profile read serves both: the timezone, and whether the
                    // user ever configured one via timezoneFromProfile (null
                    // means never set — see Profile.timezone in
                    // src/db/profiles.ts, #99). Rows without an explicit offset are
                    // placed with it, so the import warns rather than silently
                    // guessing.
                    const profile = await getProfile(userId);
                    const tz = timezoneFromProfile(profile);
                    const tzConfigured = tz !== null;

                    // Bound total growth before doing any work (see
                    // MAX_MEALS_PER_USER).
                    const existingCount = await countMeals(userId);
                    if (
                        existingCount + args.meals.length >
                        MAX_MEALS_PER_USER
                    ) {
                        const structuredContent = serializeImportResult({
                            status: "failed",
                            dry_run: args.dry_run ?? false,
                            summary: {
                                total: args.meals.length,
                                created: 0,
                                deduplicated: 0,
                                would_create: 0,
                                failed: 0,
                                not_attempted: 0,
                                duplicate_rows_in_file: 0,
                                rows_without_calories: 0,
                                skipped_by_caller: args.rows_skipped ?? 0,
                            },
                            warnings: [
                                `This import would exceed the maximum of ${MAX_MEALS_PER_USER} stored meals (you have ${existingCount}). Delete some history first.`,
                            ],
                            results: [],
                        });
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: structuredContent.warnings[0]!,
                                },
                            ],
                            structuredContent,
                        };
                    }

                    const result = await runImport(args as BulkImportArgs, {
                        userId,
                        tz: tz ?? "UTC",
                        tzConfigured,
                        nowMs: Date.now(),
                        insert: (input) => insertMeal(userId, input),
                        existingKeys: (keys) =>
                            existingIdempotencyKeys(userId, keys),
                        existingMealIds: (ids) => existingMealIds(userId, ids),
                    });

                    // Same discovery problem as log_meal, one rung louder: a
                    // backfill can carry alcohol on dozens of rows and, with
                    // the gate off, none of it shows up anywhere afterwards.
                    // Only rows that landed (or, on a dry run, would) count —
                    // a rejected row saved nothing to be told about. `index`
                    // is the 0-based position in args.meals.
                    const wrote = new Set([
                        "created",
                        "deduplicated",
                        "would_create",
                        "would_deduplicate",
                    ]);
                    const carriedAlcohol = result.results.some(
                        (r) =>
                            wrote.has(r.status) &&
                            (args.meals[r.index]?.alcohol_g ?? 0) > 0,
                    );

                    return {
                        content: [
                            {
                                type: "text" as const,
                                text:
                                    buildSummaryText(result) +
                                    alcoholHiddenNote(
                                        carriedAlcohol,
                                        alcohol,
                                        result.dry_run
                                            ? "These rows carry alcohol and it would be saved"
                                            : "Alcohol saved with these meals",
                                    ),
                            },
                        ],
                        structuredContent: serializeImportResult(result),
                    };
                },
                analytics,
                undefined,
                {
                    // Nothing landed means the call really failed, even though
                    // we return a normal result rather than isError.
                    outcome: (r) => {
                        const s = (
                            r as { structuredContent?: { status?: string } }
                        ).structuredContent;
                        return s?.status === "failed"
                            ? { success: false, errorCategory: "import_failed" }
                            : { success: true };
                    },
                },
            );
        },
    );
}
export function registerNutritionEditTools(
    server: McpServer,
    ctx: ToolContext,
) {
    const {
        alcohol,
        nutritionWriteSchema,
        writeUserId,
        callerHouseholdId,
        analytics,
        uiMeta,
        hasGoals,
    } = ctx;
    const mealLoggedUiMeta = hasGoals ? uiMeta(MEAL_LOGGED_WIDGET_URI) : {};
    server.registerTool(
        "delete_meal",
        {
            title: "Delete Meal",
            description: "Delete a meal entry by ID",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                id: z.string().describe("UUID of the meal to delete"),
            }),
        },
        async ({ id, user_id, target_member }) => {
            return withAnalytics(
                "delete_meal",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const deleted = await deleteMeal(userId, id);
                    return {
                        content: [
                            {
                                type: "text",
                                text: deleted
                                    ? `Meal ${id} deleted.`
                                    : `No meal found with id ${id}.`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "update_meal",
        {
            title: "Update Meal",
            // Only the fields passed are written (see updateMeal), which is what
            // makes this the backfill path for a meal that went in without its
            // fiber or sugar — and what missingNutrientNote points the model at.
            description:
                "Update fields of an existing meal entry. Only the fields you pass are changed, which also makes this the way to BACKFILL nutrition a meal was logged without: if a past meal has no fiber_g, sugar_g or (where it applies) caffeine_mg, estimate the value and pass just that field rather than telling the user the figure in prose. Meal ids come from get_meals or search_meals.\n\n" +
                NUTRIENT_COVERAGE,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                id: z.string().describe("UUID of the meal to update"),
                description: z.string().optional(),
                meal_type: z
                    .enum(["breakfast", "lunch", "dinner", "snack"])
                    .optional(),
                // Same bounds, and the same reasoning, as log_meal.
                calories: z.coerce.number().min(0).max(MAX_CALORIES).optional(),
                protein_g: z.coerce.number().min(0).max(MAX_MACRO_G).optional(),
                carbs_g: z.coerce.number().min(0).max(MAX_MACRO_G).optional(),
                fat_g: z.coerce.number().min(0).max(MAX_MACRO_G).optional(),
                fiber_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe(
                        "Dietary fiber in grams. Every meal should carry one — pass it here for a meal logged without it, estimating from the ingredients if no label figure exists, and 0 for a food that genuinely has none (meat, fish, eggs, dairy, oil).",
                    ),
                sugar_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_MACRO_G)
                    .optional()
                    .describe(
                        "TOTAL sugars in grams, including sugar naturally present in fruit and milk — not only added sugar. Every meal should carry one — pass it here for a meal logged without it, estimating if there is no label figure, and 0 for a food that genuinely has none.",
                    ),
                alcohol_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_ALCOHOL_G)
                    .optional()
                    .describe(
                        "Grams of pure ethanol — NOT the drink's volume and NOT its ABV. Compute it rather than estimating: grams = millilitres x (ABV% / 100) x 0.789 (a 330 ml 5% beer = 13 g).",
                    ),
                caffeine_mg: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_CAFFEINE_MG)
                    .optional()
                    .describe(
                        "Caffeine in MILLIGRAMS, not grams (a 240 ml brewed coffee is 95 mg, a single espresso 63 mg, black tea 47 mg, a 250 ml energy drink 80 mg). Adds no calories. Pass it only for a meal that is genuinely a caffeine source; a 0 here records 'measured, and it was none' and starts showing the user a caffeine row.",
                    ),
                logged_at: z
                    .string()
                    .optional()
                    .describe("When the meal was eaten. " + LOGGED_AT_FORMS),
                notes: z.string().optional(),
                items: z
                    .array(MEAL_ITEM_INPUT_SCHEMA)
                    .optional()
                    .describe(
                        "Replace this meal's foods and recipe portions. When present, totals are recomputed from snapshots and any totals you send are ignored.",
                    ),
            }),
            outputSchema: MEAL_PROGRESS_OUTPUT_SCHEMA,
            // Reuses the SAME meal-logged widget as log_meal (see
            // buildMealProgress / meal-logged.html); `action: "updated"` just
            // changes its header. Unlinked when no goals are set.
            ...mealLoggedUiMeta,
        },
        async ({ id, user_id, target_member, items, ...fields }) => {
            return withAnalytics(
                "update_meal",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const { iso, note } = await resolveWriteTimestamp(
                        userId,
                        fields.logged_at,
                    );
                    let extra = "";
                    let patch: Partial<MealInput> = {
                        ...fields,
                        logged_at: iso,
                    };
                    if (items && items.length > 0) {
                        try {
                            const householdId = await callerHouseholdId();
                            const computed = await mealWriteFromItems(
                                householdId,
                                items,
                            );
                            if (callerSentTotals(fields)) {
                                extra += `\n\n${COMPUTED_TOTALS_WARNING}`;
                            }
                            extra += computed.unknownNote;
                            patch = {
                                ...fields,
                                logged_at: iso,
                                description:
                                    fields.description ?? computed.description,
                                ...computed.totals,
                                items: computed.items,
                                item_digest: computed.item_digest,
                            };
                        } catch (err) {
                            if (err instanceof MealItemsError) {
                                throw new Error(err.message);
                            }
                            throw err;
                        }
                    }
                    const meal = await updateMeal(userId, id, patch);
                    const { progressSection, structuredContent } =
                        await buildMealProgress(
                            userId,
                            meal,
                            "updated",
                            alcohol,
                        );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Meal updated:\n${formatMeal(meal, alcohol)}${progressSection}${alcoholHiddenNote(
                                    (meal.alcohol_g ?? 0) > 0,
                                    alcohol,
                                    "Alcohol saved with this meal",
                                )}${missingNutrientNote(meal)}${note}${extra}`,
                            },
                        ],
                        structuredContent,
                    };
                },
                analytics,
            );
        },
    );
}

export function registerNutritionTools(server: McpServer, ctx: ToolContext) {
    registerNutritionWriteTools(server, ctx);
    registerNutritionReadTools(server, ctx);
    registerNutritionEditTools(server, ctx);
    registerNutritionInsightTools(server, ctx);
}
