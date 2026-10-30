import { z } from "zod";
import {
    analyticsUserId,
    HOUSEHOLD_HAS_NO_DEFAULT_USER,
    OAUTH_USER_MISMATCH,
    requireActorUserId,
    type AuthContext,
} from "../auth-context.js";
import {
    requireMemberOfHousehold,
    requireManager,
    resolveActorUserId,
    type ActorIntent,
} from "../household.js";
import {
    getPreferredWeightUnit,
    getProfile,
    getUserTimezone,
    timezoneFromProfile,
} from "../db/profiles.js";
import {
    getHouseholdMembership,
    listHouseholdMembers,
} from "../db/household.js";
import { liveFridgeStore } from "../db/fridge.js";
import { liveFoodsStore } from "../db/foods.js";
import { liveRecipesStore } from "../db/recipes.js";
import { liveRulesStore } from "../db/rules.js";
import type {
    Meal,
    NutritionGoals,
    WaterEntry,
    WeightEntry,
} from "../db/nutrition.js";
import {
    todayInTz,
    dateInTz,
    formatLocalDateTime,
    weekdayInTz,
    LoggedAtError,
    resolveWriteLoggedAt,
} from "../domain/tz.js";
import {
    dayCarries,
    coveredDailyAverage,
    type DailyBucket,
} from "../domain/insights.js";
import {
    formatWeight,
    fromGrams,
    pickWriteUnit,
    isPlausibleWeightGrams,
    toGrams,
    type WeightUnit,
} from "../domain/units.js";
import { formatAlcohol, type DrinkUnit } from "../alcohol.js";
export {
    MAX_CALORIES,
    MAX_MACRO_G,
    MAX_ALCOHOL_G,
    MAX_CAFFEINE_MG,
} from "../domain/import.js";
import { alreadyHaveTag } from "../domain/linking.js";
import { listFridge } from "../domain/fridge.js";
import { groceryAllergenWarning } from "../domain/grocery.js";
import { listRecipes } from "../domain/recipes.js";
import { foodsByIds } from "../domain/foods.js";

// MCP Apps UI (https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/):
// the get_nutrition_summary tool links to an HTML dashboard served as a ui://
// resource. Hosts (Claude, ChatGPT, VS Code, Goose) render it in a sandboxed
// iframe and hand it the tool's structuredContent. One MIME type / one resource
// works across all MCP Apps-capable clients.
// The widget HTML is assembled from shared source partials at startup (see
// widgets.ts / public/widgets/src). getWidgetHtml(key) returns the fully-inlined,
// self-contained document for each ui:// resource below.
export const SUMMARY_WIDGET_URI = "ui://widget/nutrition-summary.html";
export const APP_UI_MIME_TYPE = "text/html;profile=mcp-app";
export const GOAL_PROGRESS_WIDGET_URI = "ui://widget/goal-progress.html";
export const MEAL_LOGGED_WIDGET_URI = "ui://widget/meal-logged.html";
export const TRENDS_WIDGET_URI = "ui://widget/trends.html";
export const WEIGHT_TRENDS_WIDGET_URI = "ui://widget/weight-trends.html";
export const IMPORT_MEALS_WIDGET_URI = "ui://widget/import-meals.html";
export const GROCERY_LIST_WIDGET_URI = "ui://widget/grocery-list.html";
export const FRIDGE_WIDGET_URI = "ui://widget/fridge.html";

/** Shared date window for get_meals / get_water / get_weight.
 * `date` is a single local day (defaults to today). `from`+`to` is an
 * inclusive range. The two forms cannot be mixed. */
export function resolveDateWindow(
    args: { date?: string; from?: string; to?: string },
    today: string,
): { start: string; end: string; single: boolean } {
    const hasDate = Boolean(args.date);
    const hasFrom = Boolean(args.from);
    const hasTo = Boolean(args.to);
    if (hasDate && (hasFrom || hasTo)) {
        throw new Error("Pass date or from/to, not both.");
    }
    if (hasFrom !== hasTo) {
        throw new Error("Pass both from and to for a date range.");
    }
    if (hasFrom && hasTo) {
        return { start: args.from!, end: args.to!, single: false };
    }
    const day = args.date ?? today;
    return { start: day, end: day, single: true };
}

// The completeness rule for the three nutrients the model routinely forgets,
// declared once and spliced into SERVER_INSTRUCTIONS, log_meal and update_meal
// so the three cannot drift.
//
// Fiber and sugar are unconditional; caffeine deliberately is NOT. That
// asymmetry is the whole point of this block, and it is a read-side constraint
// rather than a stylistic one: caffeine's display gate is `!= null` everywhere
// (limitShown in shared/macros.js, recordedGoalLine and totalsPayloadOf here),
// so an explicit 0 on a sandwich is not a harmless extra data point — it puts a
// "0 mg / 400 mg limit" row on the dashboard of someone who has never had a
// coffee, and drags every caffeine average toward zero by joining the covered
// set (coveredDailyAverage in insights.ts). Fiber and sugar are typed as plain
// numbers in TOTALS_ITEM and already read as 0 when absent, so filling them in
// only ever adds fidelity.
//
// The reason omission is worse than an imperfect estimate: a NULL is not a
// zero, it excludes the entire DAY from that nutrient's averages and goal lines
// (dayCarries in insights.ts), so one forgotten fiber figure silently deletes a
// day from the user's fiber trend rather than making it slightly wrong.
export const NUTRIENT_COVERAGE = `Fiber, sugar and caffeine are tracked here alongside the headline macros, and they are only worth tracking if they are actually filled in.
- fiber_g and sugar_g: send them on EVERY meal, exactly as you already send protein, carbs and fat. Not knowing the exact figure is not a reason to leave one out — you do not know the exact protein either. Work in this order: a nutrition label, a barcode lookup, or a chain's published per-item nutrition; then a web search for that product or dish; then your own estimate from the ingredients and the portion. A 0 is the right answer wherever 0 is true (a steak, eggs, oil, black coffee) — what is wrong is omitting the field, because a missing value is not a zero: it records "nobody measured this" and drops the whole day out of the user's fiber and sugar averages, goal lines and charts.
- caffeine_mg: decide it deliberately on every entry instead of defaulting to silence, but only send a number when the item really is a caffeine source — coffee of any kind (decaf included, about 2-5 mg), tea, matcha, yerba mate, cola and many other soft drinks, energy drinks, pre-workout, chocolate and cocoa, coffee ice cream, caffeine tablets. If it is one, get the figure from the label or the chain's nutrition, or search the web for the branded drink, or fall back to the typical amounts in the field description. If the item is plainly not a caffeine source, OMIT the field rather than sending 0 — an explicit 0 means "measured, and it was none", which turns on a caffeine row for a user who never consumes any.`;

export type AlcoholDisplay = DrinkUnit | null;

// ---------- Numeric bounds for the write tools ----------
//
// Why these live in the Zod schema and not in the handler: CLAUDE.md's rule
// ("bounds live in the handler, not in Zod") is specifically about
// bulk_import_meals, where a schema-level rejection fires BEFORE the handler and
// throws away the structured per-row report, the warnings and the analytics row
// — for what is that tool's single most common caller mistake. log_meal,
// update_meal and set_nutrition_goals have no such report to lose: their whole
// output is the one row they just wrote. There, rejecting in the schema is
// strictly better, because the alternative is a raw Postgres `check (fiber_g >=
// 0)` violation surfaced verbatim to the model.
//
// The upper bound is not cosmetic. zod 4's z.number() rejects Infinity but
// accepts 1e308 — and Math.round(1e308 * 10) / 10 IS Infinity, so a single
// absurd meal made every later get_nutrition_summary / get_goal_progress /
// log_meal for that date fail the SDK's outputSchema validation (those schemas
// are z.number(), which refuses Infinity) until the row was deleted by hand.
//
// The ceilings themselves live in src/import.ts and are re-exported here, so
// the same figure is accepted whichever way a meal arrives. They were briefly
// duplicated with a test that grepped the other file to catch drift; sharing
// one declaration removes the drift instead of detecting it.
// Re-exported from src/import.js at the top of this file.
// nutrition_goals stores every gram target as numeric(6,2), so anything from
// 10000 up is a Postgres "numeric field overflow" rather than a saved goal.
export const MAX_GOAL_G = 9_999.99;
// daily_caffeine_mg is the one goal column that is numeric(7,2) — milligram
// figures run three orders larger than the gram targets, so it gets its own
// ceiling for the same overflow reason.
export const MAX_GOAL_MG = 99_999.99;

export interface DailyTotals {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sugar_g: number;
    alcohol_g: number;
    // Milligrams, unlike every gram-valued field above it — the unit rides in
    // the name at every layer because caffeine is the one nutrient here whose
    // unit differs from its siblings. It carries no energy, so it never enters
    // a kcal derivation.
    caffeine_mg: number;
    water_ml: number;
}

export function emptyTotals(): DailyTotals {
    return {
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        fiber_g: 0,
        sugar_g: 0,
        alcohol_g: 0,
        caffeine_mg: 0,
        water_ml: 0,
    };
}

export function sumMeals(meals: Meal[]): DailyTotals {
    const totals = emptyTotals();
    for (const m of meals) {
        totals.calories += m.calories ?? 0;
        totals.protein_g += m.protein_g ?? 0;
        totals.carbs_g += m.carbs_g ?? 0;
        totals.fat_g += m.fat_g ?? 0;
        // Summed regardless of the alcohol opt-in: the flag gates display, and
        // gating here would make the total depend on when it was computed.
        // The `?? 0` here is a SUM, which is fine — a missing value adds
        // nothing. It is only the AVERAGE that needs to know a null from a
        // zero, and that is what nutrientPresence below is for.
        totals.fiber_g += m.fiber_g ?? 0;
        totals.sugar_g += m.sugar_g ?? 0;
        totals.alcohol_g += m.alcohol_g ?? 0;
        totals.caffeine_mg += m.caffeine_mg ?? 0;
    }
    return totals;
}

// Which of the post-launch nutrients a day's meals actually carry. Every meal
// logged before each of them shipped has NULL fiber/sugar/alcohol/caffeine, and
// so does every row imported from an export whose file had no such column;
// `?? 0` cannot tell that apart from a genuine zero. A thin adapter over
// dayCarries in insights.ts — the rule itself lives there, once, so trends and
// the summary cannot drift apart (measured drift: 30 g/day of fiber shown as
// "30d avg: 5g" against a "Target: 30g").
//
// Caffeine is the sharpest case of the four: most meals legitimately never
// carry a value, so a day that recorded none is the norm rather than a relic of
// pre-feature history, and it is this flag — not any profile setting — that
// keeps a fabricated "0 mg" off the screen.
export interface NutrientPresence {
    fiber_g: boolean;
    sugar_g: boolean;
    alcohol_g: boolean;
    caffeine_mg: boolean;
}

export function nutrientPresence(meals: Meal[]): NutrientPresence {
    return {
        fiber_g: dayCarries(meals, "fiber_g"),
        sugar_g: dayCarries(meals, "sugar_g"),
        alcohol_g: dayCarries(meals, "alcohol_g"),
        caffeine_mg: dayCarries(meals, "caffeine_mg"),
    };
}

// Per-day means over a date range, and the denominator each one used.
//
// THE RULE, and it is insights.ts's rule rather than a second copy of it:
// calories, protein, carbs, fat and water divide by EVERY logged day, exactly
// as they always have (users have history built on those figures), while fiber,
// sugar, alcohol and caffeine go through coveredDailyAverage — a day carrying
// no value for a nutrient is excluded from both its numerator and its
// denominator. A nutrient nobody recorded reports 0 over 0 days, which callers
// must render as "not recorded" rather than as a genuine zero.
//
// LOGGED days, deliberately — and that is where this parts company with
// get_trends, which divides the same nutrients by every CALENDAR day in the
// window. Both are right for their own question ("what does a day I eat look
// like?" vs. "what am I averaging over the month?"), so issue #70 was closed by
// DISCLOSING the divergence rather than unifying it: a 15-of-30-days window
// legitimately reads 2000 kcal here and 1000 kcal there. Each side now names
// its own denominator in its text output (loggedDayAverageNote below, and the
// calendar-day note in insights.ts). Silently switching either one would
// rewrite the figures every existing user's history is built on.
export function rangeAverages(
    perDay: Array<{ meals: Meal[]; totals: DailyTotals }>,
): {
    averages: DailyTotals;
    recordedDays: {
        fiber_g: number;
        sugar_g: number;
        alcohol_g: number;
        caffeine_mg: number;
    };
} {
    const sum = emptyTotals();
    for (const { totals } of perDay) {
        sum.calories += totals.calories;
        sum.protein_g += totals.protein_g;
        sum.carbs_g += totals.carbs_g;
        sum.fat_g += totals.fat_g;
        sum.water_ml += totals.water_ml;
    }
    const mealsByDay = perDay.map((d) => d.meals);
    const fiber = coveredDailyAverage(mealsByDay, "fiber_g");
    const sugar = coveredDailyAverage(mealsByDay, "sugar_g");
    const alcohol = coveredDailyAverage(mealsByDay, "alcohol_g");
    const caffeine = coveredDailyAverage(mealsByDay, "caffeine_mg");
    const n = perDay.length || 1;
    return {
        averages: {
            calories: sum.calories / n,
            protein_g: sum.protein_g / n,
            carbs_g: sum.carbs_g / n,
            fat_g: sum.fat_g / n,
            fiber_g: fiber.avg ?? 0,
            sugar_g: sugar.avg ?? 0,
            alcohol_g: alcohol.avg ?? 0,
            caffeine_mg: caffeine.avg ?? 0,
            water_ml: Math.round(sum.water_ml / n),
        },
        recordedDays: {
            fiber_g: fiber.days,
            sugar_g: sugar.days,
            alcohol_g: alcohol.days,
            caffeine_mg: caffeine.days,
        },
    };
}

/** The model-facing half of the #70 fix: says out loud that these averages
 *  divide by logged days, and that get_trends will therefore print a smaller
 *  number for the same window. Empty when the window is fully logged — the two
 *  denominators coincide there, so the note would be pure noise on the common
 *  path. Pure and exported so the exact shipped wording is testable without
 *  standing up the whole tool. */
export function loggedDayAverageNote(
    loggedDays: number,
    daysInRange: number,
): string {
    if (loggedDays >= daysInRange) return "";
    return `\n\n(Daily averages are per logged day — ${loggedDays} of the ${daysInRange} days in range. get_trends averages over all ${daysInRange} calendar days instead, so its daily figures will be lower.)`;
}

// insights.ts is deliberately free of Supabase, so it cannot know about the
// per-user opt-in: it renders an alcohol line whenever the data contains any
// (see hasAnyPositive there). Zeroing the series is how the flag reaches it —
// both computeTrends and computeWeeklyDigest suppress alcohol on an all-zero
// series, and neither derives anything else from it. Cheap: the buckets are
// per-request and at most 365 shallow copies.
//
// Alcohol only. The spread copies caffeine_mg through untouched, which is the
// intent: caffeine has no opt-in flag to reach insights.ts with, and there
// hasAnyPositive alone decides whether its line is drawn.
export function gateAlcohol(
    buckets: DailyBucket[],
    alcohol: AlcoholDisplay,
): DailyBucket[] {
    if (alcohol) return buckets;
    return buckets.map((b) => ({ ...b, alcohol_g: 0 }));
}

export function sumWater(entries: WaterEntry[]): number {
    let total = 0;
    for (const e of entries) total += e.amount_ml;
    return total;
}

// Per-meal macro breakdown handed to the widgets so tapping a macro ring can
// reveal which meals contributed to it. `date` is null for single-day views
// (the widget labels each row by meal type instead) and set to YYYY-MM-DD for
// multi-day ranges so the widget can tag each meal with its day.
export const MEAL_BREAKDOWN_ITEM = z.object({
    description: z.string(),
    meal_type: z.string().nullable(),
    date: z.string().nullable(),
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
    sugar_g: z.number(),
    // Nullable where the other macros are not: null is how every structured
    // payload says "this user does not track alcohol", which a 0 could not
    // distinguish from a genuinely alcohol-free day.
    alcohol_g: z.number().nullable(),
    // Nullable for the neighbouring reason with no flag behind it: this meal
    // simply has no caffeine figure. Most meals never will, so a 0 here would
    // claim the user measured a caffeine-free lunch. Milligrams.
    caffeine_mg: z.number().nullable(),
});

export function mealBreakdown(
    meals: Meal[],
    dateTz: string | null,
    alcohol: AlcoholDisplay,
) {
    return meals.map((m) => ({
        description: m.description,
        meal_type: m.meal_type ?? null,
        date: dateTz ? dateInTz(m.logged_at, dateTz) : null,
        calories: Math.round(m.calories ?? 0),
        protein_g: Math.round((m.protein_g ?? 0) * 10) / 10,
        carbs_g: Math.round((m.carbs_g ?? 0) * 10) / 10,
        fat_g: Math.round((m.fat_g ?? 0) * 10) / 10,
        fiber_g: Math.round((m.fiber_g ?? 0) * 10) / 10,
        sugar_g: Math.round((m.sugar_g ?? 0) * 10) / 10,
        alcohol_g: alcohol ? Math.round((m.alcohol_g ?? 0) * 10) / 10 : null,
        caffeine_mg:
            m.caffeine_mg == null ? null : Math.round(m.caffeine_mg * 10) / 10,
    }));
}

// Every goals / totals / averages payload in this file has the same shape, so
// they share one schema each (and one builder each, below) instead of four
// hand-maintained copies — which is what let three of them drift apart on the
// last field addition.
export const GOALS_ITEM = z.object({
    calories: z.number().nullable(),
    protein_g: z.number().nullable(),
    carbs_g: z.number().nullable(),
    fat_g: z.number().nullable(),
    fiber_g: z.number().nullable(),
    sugar_g: z.number().nullable(),
    alcohol_g: z.number().nullable(),
    // The stored daily_caffeine_mg, in milligrams. A ceiling like sugar and
    // alcohol, and 0 is a real one ("none at all") rather than "unset".
    caffeine_mg: z.number().nullable(),
    water_ml: z.number().nullable(),
});

export const TOTALS_ITEM = z.object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
    sugar_g: z.number(),
    alcohol_g: z.number().nullable(),
    // Nullable where fiber_g and sugar_g are not, and for a reason no other
    // total has: those two are shown as 0 on a day that never recorded them
    // (defensible — the day did happen), but a caffeine 0 against a limit is
    // the fabricated "0 mg vs goal" this feature is not allowed to invent. Null
    // means nothing on this day recorded caffeine; the widget then draws no
    // stat line at all. See totalsPayloadOf's caffeineRecorded argument.
    caffeine_mg: z.number().nullable(),
    water_ml: z.number(),
});

// get_trends' per-day series shape: like TOTALS_ITEM, but fiber_g/sugar_g are
// nullable too. Everywhere else a day's totals are a real sum for that one
// day, so 0 is unambiguous — but the trends widget re-averages this series
// CLIENT-SIDE across a slice of days (see trends.html's avgOf), and there a
// summed 0 on a day that never recorded fiber/sugar is indistinguishable from
// a real zero. Null is the "not recorded" signal, built by trendsDayPayloadOf.
export const TRENDS_DAY_ITEM = TOTALS_ITEM.extend({
    date: z.string(),
    fiber_g: z.number().nullable(),
    sugar_g: z.number().nullable(),
});

// Which standard-drink convention the widget should render alcohol_g in. The
// payloads carry canonical grams, so without this a UK user saw "US drinks" in
// the widget while the text output beside it said "UK units". Null doubles as
// the "user has alcohol tracking off" signal, matching AlcoholDisplay — the
// widget hides the stat line entirely rather than picking a default.
export const DRINK_UNIT_FIELD = z.enum(["us", "uk"]).nullable();

// log_meal and update_meal share the same MCP Apps widget
// (public/widgets/meal-logged.html). Both declare this identical output shape
// and both build their payload via buildMealProgress() below, so the widget can
// render either result; `action` only changes the header wording.
export const MEAL_PROGRESS_OUTPUT_SCHEMA = z.object({
    action: z.enum(["logged", "updated"]),
    date: z.string(),
    drink_unit: DRINK_UNIT_FIELD,
    // The widget's UI language — see the identical field on
    // get_nutrition_summary's outputSchema for why this is z.string() and
    // Widgets are English-only; always the literal "en".
    locale: z.string(),
    logged_meal: z.object({
        description: z.string(),
        meal_type: z.string().nullable(),
        calories: z.number().nullable(),
        protein_g: z.number().nullable(),
        carbs_g: z.number().nullable(),
        fat_g: z.number().nullable(),
        fiber_g: z.number().nullable(),
        sugar_g: z.number().nullable(),
        alcohol_g: z.number().nullable(),
        // Milligrams, and null whenever this meal carried no caffeine figure —
        // which is most meals, and is not the same as a measured zero.
        caffeine_mg: z.number().nullable(),
    }),
    has_goals: z.boolean(),
    goals: GOALS_ITEM.nullable(),
    totals: TOTALS_ITEM,
    meals: z.array(MEAL_BREAKDOWN_ITEM),
});

// Both payloads carry alcohol as a nullable number for the same reason
// MEAL_BREAKDOWN_ITEM does. These two builders are the only places a goals or
// totals literal is written: a .nullable() field is REQUIRED in the emitted JSON
// Schema, so an omitted key is a validation error rather than a null, and one
// builder per shape is what keeps every literal complete.
export function goalsPayloadOf(
    goals: NutritionGoals | null,
    alcohol: AlcoholDisplay,
) {
    if (!goals) return null;
    return {
        calories: goals.daily_calories ?? null,
        protein_g: goals.daily_protein_g ?? null,
        carbs_g: goals.daily_carbs_g ?? null,
        fat_g: goals.daily_fat_g ?? null,
        fiber_g: goals.daily_fiber_g ?? null,
        sugar_g: goals.daily_sugar_g ?? null,
        alcohol_g: alcohol ? (goals.daily_alcohol_g ?? null) : null,
        // No gate: caffeine has no alcohol_tracking_enabled equivalent, so the
        // stored limit is always handed over and the widget decides on the data
        // (a stat line appears only once some value is recorded).
        caffeine_mg: goals.daily_caffeine_mg ?? null,
        water_ml: goals.daily_water_ml ?? null,
    };
}

/** `caffeineRecorded` is dayCarries("caffeine_mg") for whatever meals produced
 *  these totals — or, for an average, whether ANY day in the window recorded
 *  caffeine. False emits null instead of the summed 0, because for caffeine
 *  those two mean genuinely different things and only one of them is true. It
 *  is a required argument rather than a defaulted one so that every call site
 *  has to answer the question; a caller that forgets it gets null, which is the
 *  safe answer (a hidden stat line) rather than an invented zero. */
export function totalsPayloadOf(
    totals: DailyTotals,
    alcohol: AlcoholDisplay,
    caffeineRecorded: boolean,
) {
    return {
        calories: Math.round(totals.calories),
        protein_g: Math.round(totals.protein_g * 10) / 10,
        carbs_g: Math.round(totals.carbs_g * 10) / 10,
        fat_g: Math.round(totals.fat_g * 10) / 10,
        fiber_g: Math.round(totals.fiber_g * 10) / 10,
        sugar_g: Math.round(totals.sugar_g * 10) / 10,
        alcohol_g: alcohol ? Math.round(totals.alcohol_g * 10) / 10 : null,
        caffeine_mg: caffeineRecorded
            ? Math.round(totals.caffeine_mg * 10) / 10
            : null,
        water_ml: totals.water_ml,
    };
}

// get_trends ships this per day in its `days` series, which the widget slices
// to 7/14/30 and re-averages CLIENT-SIDE (see trends.html's avgOf) instead of
// round-tripping to the server. totalsPayloadOf sums fiber/sugar/alcohol with
// `?? 0`, so a day that never recorded them is indistinguishable from a real
// zero — the widget's average then divides by every day in the slice instead
// of the covered ones, drifting from the text output's `coveredSeries` rule
// (src/insights.ts). Null here is that missing-vs-zero signal, mirroring
// dayCarries/coveredDailyAverage; alcohol_g can already be null for tracking
// being off, which takes precedence over the per-day coverage null. caffeine_mg
// needs no override below — TOTALS_ITEM already declares it nullable, so
// totalsPayloadOf applies the same rule for it one level down.
export function trendsDayPayloadOf(
    bucket: DailyBucket,
    alcohol: AlcoholDisplay,
) {
    const totals = totalsPayloadOf(
        {
            calories: bucket.calories,
            protein_g: bucket.protein_g,
            carbs_g: bucket.carbs_g,
            fat_g: bucket.fat_g,
            fiber_g: bucket.fiber_g,
            sugar_g: bucket.sugar_g,
            alcohol_g: bucket.alcohol_g,
            caffeine_mg: bucket.caffeine_mg,
            water_ml: bucket.waterMl,
        },
        alcohol,
        dayCarries(bucket.meals, "caffeine_mg"),
    );
    return {
        date: bucket.date,
        ...totals,
        fiber_g: dayCarries(bucket.meals, "fiber_g") ? totals.fiber_g : null,
        sugar_g: dayCarries(bucket.meals, "sugar_g") ? totals.sugar_g : null,
        alcohol_g:
            totals.alcohol_g == null
                ? null
                : dayCarries(bucket.meals, "alcohol_g")
                  ? totals.alcohol_g
                  : null,
    };
}

// Which way a target points. A floor is something to reach (calories, protein,
// carbs, fat, water, fiber); a ceiling is something to stay under (sugar,
// alcohol, caffeine). The distinction is not cosmetic: with the floor wording a
// 40 g sugar target and 0 g eaten reads "40g to go", which congratulates the
// user for having sugar left to consume.
type GoalDirection = "floor" | "ceiling";

// Whether a stored target is a target at all. Zero splits by direction: a
// CEILING of 0 is a real limit — "none at all" is the single most likely
// alcohol goal anyone sets, and the old `target <= 0` guard let such a goal be
// stored, echoed back by get_goal_progress, and then silently ignored on
// every progress line, which is worse than refusing it. A FLOOR of 0 stays
// "unset": a 0 g protein target is meaningless. Negatives are rejected in both
// directions, and so is NaN (z.coerce turns "" into NaN).
export function hasActiveTarget(
    target: number | null | undefined,
    direction: GoalDirection = "floor",
): target is number {
    if (target == null || Number.isNaN(target)) return false;
    return direction === "ceiling" ? target >= 0 : target > 0;
}

// `actualText` overrides how the consumed amount is printed, for values whose
// natural rendering is not "<number><unit>" — alcohol, which always carries its
// drinks gloss (see formatAlcohol). Everything else passes it as undefined.
export function formatGoalLine(
    label: string,
    unit: string,
    actual: number,
    target: number | null,
    direction: GoalDirection = "floor",
    actualText?: string,
): string {
    const rounded = Math.round(actual * 10) / 10;
    if (!hasActiveTarget(target, direction)) {
        // Standalone, so the amount carries the unit itself.
        return `${label}: ${actualText ?? `${rounded}${unit}`}`;
    }
    const shown = actualText ?? String(rounded);
    const delta = Math.round((target - actual) * 10) / 10;
    if (direction === "ceiling") {
        // A limit is not a budget. "40g left" handed someone trying to drink or
        // sweeten less a daily permission slip, and on an averaged view
        // ("7-day average, 12.1 g left") it means nothing at all. Report the
        // position relative to the limit instead, matching the "Days over
        // limit" phrasing computeTrends already uses.
        //
        // A limit of 0 gets no percentage: every ratio against it is Infinity
        // or NaN. "clear" is the word computeWeeklyDigest uses for the same
        // case, so the two narratives read alike.
        const pct =
            target > 0 ? `${Math.round((actual / target) * 100)}%, ` : "";
        const state =
            delta < 0
                ? `${Math.abs(delta)}${unit} over`
                : target === 0
                  ? "clear"
                  : "under";
        return `${label}: ${shown} / ${target}${unit} limit (${pct}${state})`;
    }
    const pct = Math.round((actual / target) * 100);
    const deltaStr =
        delta > 0 ? `${delta}${unit} to go` : `${Math.abs(delta)}${unit} over`;
    // Against a target the unit sits on the target only ("1500 / 2000 kcal") —
    // unchanged from before this gained a direction.
    return `${label}: ${shown} / ${target}${unit} (${pct}%, ${deltaStr})`;
}

// A nutrient nobody recorded is not a zero. Fiber, sugar and caffeine each
// arrived long after most of the history in this database, so "0g" on a day
// whose meals predate them is a fabricated figure — say nothing instead (the
// same instinct as hasAnyPositive() in insights.ts). The exception is a day
// with an active target, where a vanished line would read as tracking having
// broken; "not recorded" still refuses to invent the number.
function recordedGoalLine(
    label: string,
    unit: string,
    actual: number,
    target: number | null,
    recorded: boolean,
    direction: GoalDirection,
): string | null {
    if (recorded) return formatGoalLine(label, unit, actual, target, direction);
    if (!hasActiveTarget(target, direction)) return null;
    const noun = direction === "ceiling" ? "limit" : "target";
    return `${label}: not recorded / ${target}${unit} ${noun}`;
}

// Everything recorded, for the callers that have no per-meal list to inspect.
const ALL_RECORDED: NutrientPresence = {
    fiber_g: true,
    sugar_g: true,
    alcohol_g: true,
    caffeine_mg: true,
};

// Caffeine is the one figure here rendered without decimals. A tenth of a
// milligram is below the precision of any label, database or export, and
// "95.5 mg" claims a measurement nobody made; the structured payloads keep the
// sibling `* 10 / 10` rounding, but the model-facing text is whole milligrams.
function formatMg(mg: number): string {
    return `${Math.round(mg)} mg`;
}

// `present` says which of the post-launch nutrients these meals actually carry,
// so a pre-feature day prints nothing for fiber rather than a made-up "0g".
// Fiber, sugar and caffeine consult it; alcohol does not, because it has its
// own explicit opt-in, and for a user who turned it ON a zero is the meaningful
// reading — that is exactly the "0 g against a 0 g limit" a recovery user set
// the limit to see. Caffeine leans on `present` hardest: it is the only gate it
// has, since there is deliberately no caffeine_tracking_enabled.
export function formatProgress(
    totals: DailyTotals,
    goals: NutritionGoals | null,
    alcohol: AlcoholDisplay,
    present: NutrientPresence = ALL_RECORDED,
): string {
    const lines: Array<string | null> = [
        formatGoalLine(
            "Calories",
            " kcal",
            totals.calories,
            goals?.daily_calories ?? null,
        ),
        formatGoalLine(
            "Protein",
            "g",
            totals.protein_g,
            goals?.daily_protein_g ?? null,
        ),
        formatGoalLine(
            "Carbs",
            "g",
            totals.carbs_g,
            goals?.daily_carbs_g ?? null,
        ),
        formatGoalLine("Fat", "g", totals.fat_g, goals?.daily_fat_g ?? null),
        recordedGoalLine(
            "Fiber",
            "g",
            totals.fiber_g,
            goals?.daily_fiber_g ?? null,
            present.fiber_g,
            "floor",
        ),
        recordedGoalLine(
            "Sugar",
            "g",
            totals.sugar_g,
            goals?.daily_sugar_g ?? null,
            present.sugar_g,
            "ceiling",
        ),
    ];
    // Alcohol is opt-in: stored either way, shown only when the user asked for
    // it (imported exports carry trace alcohol from recipes, and surfacing that
    // unbidden is actively harmful for someone in recovery).
    if (alcohol) {
        lines.push(
            formatGoalLine(
                "Alcohol",
                "g",
                totals.alcohol_g,
                goals?.daily_alcohol_g ?? null,
                "ceiling",
                formatAlcohol(totals.alcohol_g, alcohol),
            ),
        );
    }
    // No opt-in to consult — `present.caffeine_mg` is the whole gate. Rounded to
    // whole milligrams before the line is built (see formatMg) so both the
    // with-target and the standalone wording stay decimal-free.
    lines.push(
        recordedGoalLine(
            "Caffeine",
            " mg",
            Math.round(totals.caffeine_mg),
            goals?.daily_caffeine_mg ?? null,
            present.caffeine_mg,
            "ceiling",
        ),
    );
    lines.push(
        formatGoalLine(
            "Water",
            " ml",
            totals.water_ml,
            goals?.daily_water_ml ?? null,
        ),
    );
    return lines.filter((l): l is string => l !== null).join("\n");
}

export function formatGoals(
    goals: NutritionGoals | null,
    weightUnit: WeightUnit = "kg",
    alcohol: AlcoholDisplay = null,
): string {
    if (!goals) {
        return "No nutrition goals set. Use set_nutrition_goals to define daily targets.";
    }
    // "not set" must mean exactly what formatGoalLine ignores, or the echo
    // promises a target that no progress line will ever honour — which is how a
    // 0 g alcohol limit came to be stored, listed, and then quietly dropped.
    // Floors: 0 is unset. Ceilings: 0 is a real limit and is listed as one.
    const floor = (v: number | null, render: (n: number) => string) =>
        hasActiveTarget(v, "floor") ? render(v) : "not set";
    const ceiling = (v: number | null, render: (n: number) => string) =>
        hasActiveTarget(v, "ceiling") ? render(v) : "not set";
    const parts: string[] = ["Current daily goals:"];
    parts.push(
        `- Calories: ${floor(goals.daily_calories, (n) => `${n} kcal`)}`,
    );
    parts.push(`- Protein: ${floor(goals.daily_protein_g, (n) => `${n}g`)}`);
    parts.push(`- Carbs: ${floor(goals.daily_carbs_g, (n) => `${n}g`)}`);
    parts.push(`- Fat: ${floor(goals.daily_fat_g, (n) => `${n}g`)}`);
    parts.push(`- Fiber: ${floor(goals.daily_fiber_g, (n) => `${n}g`)}`);
    parts.push(
        `- Sugar (total, max): ${ceiling(goals.daily_sugar_g, (n) => `${n}g`)}`,
    );
    if (alcohol) {
        parts.push(
            `- Alcohol (max): ${ceiling(goals.daily_alcohol_g, (n) => formatAlcohol(n, alcohol))}`,
        );
    }
    // Always listed, unlike alcohol: the goal echo is where the model learns a
    // caffeine limit can be set at all, and there is no opt-in to hide it
    // behind. Data-driven suppression applies to recorded VALUES, not to the
    // list of targets the user could set.
    parts.push(
        `- Caffeine (max): ${ceiling(goals.daily_caffeine_mg, formatMg)}`,
    );
    parts.push(`- Water: ${floor(goals.daily_water_ml, (n) => `${n} ml`)}`);
    parts.push(
        `- Target weight: ${goals.target_weight_g != null ? formatWeight(goals.target_weight_g, weightUnit) : "not set"}`,
    );
    return parts.join("\n");
}

export function formatWeightEntry(
    entry: WeightEntry,
    unit: WeightUnit,
): string {
    return `- ${formatWeight(entry.weight_g, unit)} at ${entry.logged_at}${entry.notes ? ` (${entry.notes})` : ""} [id: ${entry.id}]`;
}

// Shared `logged_at` description for every manual write tool. The three forms
// and the "don't convert to UTC yourself" rule are the whole point: a model
// knows the wall-clock time the user just said, but not the zone's historical
// offset for that date, and guessing it lands the entry on the wrong day.
export const LOGGED_AT_FORMS =
    'Accepts a full ISO 8601 timestamp with an offset or Z ("2026-01-05T08:30:00+02:00"), an offset-less local time ("2026-01-05T08:30"), or a bare date ("2026-01-05", anchored at local noon). Offset-less values are resolved in the user\'s saved timezone, so pass the local time exactly as the user gives it and do NOT convert it to UTC yourself.';

// Appended to `logged_at` on the three "log it now" tools. This used to say
// "ask the user" — which fired on every single log from any host that keeps the
// wall clock out of the model's context (Claude Desktop among them), turning
// "I just ate X" into an interrogation, or worse a guessed time on the wrong
// day (issue #102). Omitting the field is strictly better than guessing: the
// server stamps `new Date()` and it genuinely knows the time.
export const LOGGED_AT_OMIT_IF_NOW =
    " Do NOT ask the user what time it is. If you don't know the current date or time, omit this field entirely and the server stamps the entry with the current time. Only supply it for an entry that happened at some other moment, and call get_current_time if you need the user's local clock to work that moment out.";

// The one rendering of "what time is it for this user", shared by
// get_current_time and get_timezone so the two can never disagree. The weekday
// is there to make "last Monday" resolvable without a second round trip, and
// the UTC instant so a caller can check its own clock against ours. Local time
// is the repo-standard "YYYY-MM-DD HH:mm:ss" wall clock — deliberately not an
// offset-less ISO string, which reads as a machine value a caller might echo
// straight back into logged_at without noticing it has gone stale.
export function formatClockLine(tz: string): string {
    const now = new Date();
    return `Local time now: ${weekdayInTz(now, tz)} ${formatLocalDateTime(now, tz)} (${tz}). UTC now: ${now.toISOString()}.`;
}

// The human-readable gloss for a standard-drink unit, shared by
// set_alcohol_tracking and get_profile so the wording can't drift between
// the tool that sets it and the one that reports it back.
export function drinkUnitLabel(unit: DrinkUnit): string {
    return unit === "us"
        ? "US standard drinks (14 g each)"
        : "UK units (7.9 g each)";
}

// Resolve a caller-supplied `logged_at` to an absolute instant before it
// reaches the timestamptz column. Without this an offset-less string is read in
// the database session's zone (UTC), so a Kyiv user's 21:00 lands at midnight
// on the NEXT day and the tool's own progress line contradicts itself.
// "Configured" is `timezoneFromProfile(profile) !== null`, not `profile !==
// null`: the other set_* tools upsert a profile that never touches timezone,
// so the row's mere existence is not evidence the user ever chose a zone
// (#99).
//
// The unset-timezone hint has to be attached on the failure path too: read as
// UTC, an offset-less local time from a user east of UTC can resolve to a
// future instant and be rejected, and "logged_at is in the future" on its own
// names the wrong cause and gives the caller nothing to act on.
//
// It also has to fire when `raw` is omitted entirely — by far the most common
// call shape, since "I just ate this" never carries a logged_at. The instant
// itself doesn't need the timezone (the DB stamps "now" either way), but every
// read path still buckets the entry into a local day using the same unset
// profile, so staying silent here left the migration's whole warning
// unreachable in practice (found live: a meal logged with no logged_at and no
// profile timezone produced no warning at all).
export async function resolveWriteTimestamp(
    userId: string,
    raw: string | undefined,
): Promise<{ iso: string | undefined; note: string }> {
    const profile = await getProfile(userId);
    const tz = timezoneFromProfile(profile);
    const unsetTzNote = (value: string) =>
        `${JSON.stringify(value)} carries no UTC offset and this account has no timezone set, so it was read as UTC. Set one with set_timezone.`;

    if (raw === undefined) {
        const note =
            tz === null
                ? "\n\nNote: this account has no timezone set, so today's date is being read in UTC — set one with set_timezone."
                : "";
        return { iso: undefined, note };
    }

    let resolved;
    try {
        resolved = resolveWriteLoggedAt(raw, tz ?? "UTC", Date.now());
    } catch (err) {
        if (
            err instanceof LoggedAtError &&
            err.usedProfileTimezone &&
            tz === null
        ) {
            throw new Error(`${err.message} ${unsetTzNote(raw)}`);
        }
        throw err;
    }

    const note =
        resolved.usedProfileTimezone && tz === null
            ? `\n\nNote: ${unsetTzNote(raw)} Then re-check this entry.`
            : "";
    return { iso: resolved.instant.toISOString(), note };
}

// Resolve the unit to use when WRITING a weight value: an explicit unit wins,
// otherwise the user's saved preference. If neither exists, refuse rather than
// guess — silently assuming kg for someone who meant lb is exactly the mis-log
// this feature exists to prevent.
export async function resolveWriteWeightUnit(
    userId: string,
    explicit: WeightUnit | undefined,
): Promise<WeightUnit> {
    return pickWriteUnit(explicit, await getPreferredWeightUnit(userId));
}

// Reject magnitude mistakes (value typed in grams, an extra digit, a sub-unit
// typo). Suggests the other unit when the same number would be plausible there.
export function assertPlausibleWeight(grams: number, unit: WeightUnit): void {
    if (isPlausibleWeightGrams(grams)) return;
    const other: WeightUnit = unit === "kg" ? "lb" : "kg";
    const asOther = toGrams(fromGrams(grams, unit), other);
    const hint = isPlausibleWeightGrams(asOther)
        ? ` If you meant ${fromGrams(grams, unit)} ${other}, pass unit: '${other}'.`
        : "";
    throw new Error(
        `${formatWeight(grams, unit)} is outside the plausible body-weight range (20–500 kg / 44–1102 lb). Double-check the number and unit.${hint}`,
    );
}

export function formatMeal(meal: Meal, alcohol: AlcoholDisplay = null): string {
    const parts = [
        `ID: ${meal.id}`,
        `Time: ${meal.logged_at}`,
        meal.meal_type ? `Type: ${meal.meal_type}` : null,
        `Description: ${meal.description}`,
        meal.calories != null ? `Calories: ${meal.calories}` : null,
        meal.protein_g != null ? `Protein: ${meal.protein_g}g` : null,
        meal.carbs_g != null ? `Carbs: ${meal.carbs_g}g` : null,
        meal.fat_g != null ? `Fat: ${meal.fat_g}g` : null,
        meal.fiber_g != null ? `Fiber: ${meal.fiber_g}g` : null,
        meal.sugar_g != null ? `Sugar: ${meal.sugar_g}g` : null,
        // Opt-in (see formatProgress): a stored value stays hidden until the
        // user turns alcohol tracking on.
        alcohol && meal.alcohol_g != null
            ? `Alcohol: ${formatAlcohol(meal.alcohol_g, alcohol)}`
            : null,
        // Not opt-in: a stored value is always echoed. The `!= null` is the
        // only suppression, and it is per-meal — a sandwich shows no caffeine
        // line, a measured 0 mg energy-free drink shows "Caffeine: 0 mg".
        meal.caffeine_mg != null
            ? `Caffeine: ${formatMg(meal.caffeine_mg)}`
            : null,
        ...(meal.items ?? []).map((item) => {
            const qty =
                item.portions != null
                    ? `${item.portions} portion${item.portions === 1 ? "" : "s"}`
                    : item.amount != null && item.unit
                      ? `${item.amount} ${item.unit}`
                      : null;
            const kcal =
                item.calories != null ? ` — ${item.calories} kcal` : "";
            return `Item: ${item.label}${qty ? ` (${qty})` : ""}${kcal}`;
        }),
        meal.notes ? `Notes: ${meal.notes}` : null,
    ];
    return parts.filter(Boolean).join("\n");
}

// The one thing that keeps the alcohol opt-in from being a trapdoor. Alcohol
// written while tracking is off is stored but invisible everywhere — no meal
// line, no goal line, no widget stat — so a user who says "log 2 beers" gets a
// silent no-op as far as they can tell, and nothing in any tool output or in
// SERVER_INSTRUCTIONS would ever tell them the feature exists. This appends a
// one-line note to the text output whenever a write actually carried alcohol
// and this user has the gate off.
//
// It REPORTS ONLY. It must never flip alcohol_tracking_enabled: the flag exists
// because surfacing alcohol unbidden is harmful to users in recovery, and
// "they logged a beer" is not consent to start showing it.
//
// `subject` is the clause before the comma, so each call site can name what was
// saved while the advice stays identical everywhere.
export function alcoholHiddenNote(
    carriedAlcohol: boolean,
    alcohol: AlcoholDisplay,
    subject: string,
): string {
    if (!carriedAlcohol || alcohol !== null) return "";
    return `\n\n(${subject}, but alcohol tracking is off for this account so it is not shown. Turn it on with set_alcohol_tracking.)`;
}

// Tool descriptions and SERVER_INSTRUCTIONS are advisory and are read once, at
// the top of a session; this note lands in the model's context at the exact
// moment it left a nutrient out, which is the only feedback in the loop. Same
// report-only shape as alcoholHiddenNote above — it never writes anything.
//
// Deliberately limited to fiber_g and sugar_g. Both are estimable for every
// food that exists, so a NULL on a meal the model just wrote is an omission and
// not a fact, and the cost is not one imperfect number: a null excludes the
// whole DAY from that nutrient's averages, goal lines and charts (dayCarries in
// insights.ts), so a forgotten fiber figure deletes the day from the trend.
//
// Caffeine is NOT checked here, and adding it would undo the suppression the
// rest of this file is built around: most meals genuinely carry none, its
// display gate is `!= null` rather than `> 0` (limitShown, recordedGoalLine,
// totalsPayloadOf), so nagging until every sandwich carries a figure produces
// precisely the fabricated "0 mg / 400 mg limit" that null exists to prevent.
export function missingNutrientNote(meal: Meal): string {
    const missing = [
        meal.fiber_g == null ? "fiber_g" : null,
        meal.sugar_g == null ? "sugar_g" : null,
    ].filter((f): f is string => f !== null);
    if (missing.length === 0) return "";
    return `\n\n(Not recorded on this meal: ${missing.join(", ")}. A missing value is not a zero — it leaves the whole day out of that nutrient's totals, averages and goal line. Estimate the value from the ingredients (0 where the food genuinely has none) and fill it in with update_meal, id ${meal.id}.)`;
}

// `alcohol` is the whole alcohol opt-in, threaded once: the drink unit to render
// grams in, or null when this user has alcohol tracking off. It is resolved from
// the profile in buildMcpServer (like widgetsEnabled) rather than re-read inside
// every handler, because a per-request server means one read serves the whole
// request and every formatter can take it as a plain argument.
//
// At the write layer it gates DISPLAY only. Alcohol passed to log_meal /
// update_meal / bulk_import_meals is always stored — dropping a value the caller
// explicitly sent would be silent data loss, and the flag exists to keep trace
// alcohol from imported recipes out of sight, not out of the database.
//
// The one place a null `alcohol` changes what gets WRITTEN is the import widget,
// which then declines to map the file's alcohol column at all rather than write
// a number it was forbidden to show the user for review. That is the widget's
// choice, announced to the user on screen, not a rule this server enforces — see
// startImportPayload for the full trade-off.
// Exported for tests: the only way to exercise a tool handler end-to-end
// (schema coercion, handler, response text) is to register the tools on a real
// McpServer and call them through a client. Production still reaches this only

export const ALLERGEN_SCHEMA = z.enum([
    "peanut",
    "tree_nut",
    "milk",
    "egg",
    "wheat",
    "soy",
    "fish",
    "shellfish",
    "sesame",
    "other",
]);
export const QUANTITY_ITEM = z.object({
    amount: z.number(),
    unit: z.string(),
});
export async function householdFoodNames(
    householdId: string,
): Promise<string[]> {
    const [fridge, recipes] = await Promise.all([
        listFridge(liveFridgeStore(), householdId),
        listRecipes(liveRecipesStore(), householdId),
    ]);
    const names = fridge.items.map((item) => item.displayName);
    const recipesStore = liveRecipesStore();
    for (const recipe of recipes) {
        const ingredients = await recipesStore.listIngredients(
            householdId,
            recipe.id,
        );
        for (const ingredient of ingredients) {
            names.push(ingredient.displayName);
        }
    }
    return names;
}
export async function groceryLineExtras(
    householdId: string,
    line: {
        displayName: string;
        identity: Parameters<typeof alreadyHaveTag>[0]["identity"];
        quantity: { amount: number; unit: string };
        foodId?: string | null;
    },
): Promise<{ alreadyHave: string | null; warning: string | null }> {
    const [fridge, members] = await Promise.all([
        listFridge(liveFridgeStore(), householdId),
        listHouseholdMembers(householdId),
    ]);
    const catalog = await foodsByIds(liveFoodsStore(), householdId, [
        line.foodId,
        ...fridge.items.map((item) => item.foodId),
    ]);
    const tag = alreadyHaveTag(
        {
            identity: line.identity,
            quantity: line.quantity,
            foodId: line.foodId,
        },
        fridge.items.map((item) => ({
            identity: item.identity,
            quantity: item.quantity,
            foodId: item.foodId,
        })),
        catalog,
    );
    const rules = liveRulesStore();
    const allergenMembers = await Promise.all(
        members.map(async (member) => ({
            displayName: member.displayName,
            allergens: await rules.listAllergens(householdId, member.userId),
        })),
    );
    const food = line.foodId ? catalog.get(line.foodId) : undefined;
    const warning = groceryAllergenWarning(
        line.displayName,
        allergenMembers,
        food ? food.allergens : null,
    );
    return {
        alreadyHave:
            tag == null
                ? null
                : tag.cover === "full"
                  ? "already have"
                  : `already have: have ${tag.have.amount} ${tag.have.unit}, need ${tag.need.amount} ${tag.need.unit}`,
        warning: warning?.text ?? null,
    };
}

export type ToolContext = {
    auth: AuthContext;
    widgetsEnabled: boolean;
    alcohol: AlcoholDisplay;
    protocolEra?: "legacy" | "modern";
    requireUser: () => string;
    personSchema: <T extends z.ZodRawShape>(
        shape: T,
    ) => z.ZodObject<T & { user_id: z.ZodOptional<z.ZodString> }>;
    nutritionWriteSchema: <T extends z.ZodRawShape>(
        shape: T,
    ) => z.ZodObject<
        T & {
            user_id: z.ZodOptional<z.ZodString>;
            target_member: z.ZodOptional<z.ZodString>;
        }
    >;
    actorUserId: (
        requested: string | undefined,
        intent?: ActorIntent,
    ) => Promise<string>;
    callerHouseholdId: () => Promise<string>;
    callerManagerHouseholdId: () => Promise<string>;
    writeUserId: (
        requested: string | undefined,
        targetMember: string | undefined,
    ) => Promise<string>;
    requireHouseholdMemberId: (memberId: string) => Promise<string>;
    callerActor: () => Promise<{
        userId: string;
        isOwner: boolean;
        householdId: string;
    }>;
    analytics: { userId: string };
    uiMeta: (resourceUri: string) => Record<string, unknown>;
};

export function createToolContext(
    auth: AuthContext,
    widgetsEnabled: boolean,
    alcohol: AlcoholDisplay,
    protocolEra?: "legacy" | "modern",
): ToolContext {
    const requireUser = () => requireActorUserId(auth);
    const userIdArg =
        auth.kind === "household"
            ? z
                  .string()
                  .min(1)
                  .describe(
                      "Household member to act as. Required on a household bot token.",
                  )
            : z
                  .string()
                  .min(1)
                  .optional()
                  .describe(
                      "Household member to read. Writes still require this to match the signed-in user.",
                  );
    const personSchema = (<T extends z.ZodRawShape>(shape: T) =>
        z.object({
            ...shape,
            user_id: userIdArg,
        })) as ToolContext["personSchema"];
    const targetMemberArg = z
        .string()
        .min(1)
        .optional()
        .describe(
            "Household member to write this nutrition entry for. MCP only; the site has no log-as-them control.",
        );
    const nutritionWriteSchema = (<T extends z.ZodRawShape>(shape: T) =>
        personSchema({
            ...shape,
            target_member: targetMemberArg,
        })) as ToolContext["nutritionWriteSchema"];
    async function actorUserId(
        requested: string | undefined,
        intent: ActorIntent = "write",
    ): Promise<string> {
        const resolved = resolveActorUserId(auth, requested, intent);
        if (!resolved.ok) {
            throw new Error(
                resolved.error === "oauth_mismatch"
                    ? OAUTH_USER_MISMATCH
                    : HOUSEHOLD_HAS_NO_DEFAULT_USER,
            );
        }
        if (resolved.membership === "required") {
            const member = await getHouseholdMembership(
                resolved.userId,
                resolved.householdId,
            );
            const check = requireMemberOfHousehold(
                member,
                resolved.householdId,
            );
            if (!check.ok) {
                throw new Error("not a household member");
            }
        }
        if (resolved.membership === "peer") {
            const viewer = await getHouseholdMembership(resolved.viewerUserId);
            const subject = await getHouseholdMembership(resolved.userId);
            if (
                viewer == null ||
                subject == null ||
                viewer.householdId !== subject.householdId
            ) {
                throw new Error("not a household member");
            }
        }
        return resolved.userId;
    }
    async function callerHouseholdId(): Promise<string> {
        if (auth.kind === "household") return auth.householdId;
        const member = await getHouseholdMembership(auth.userId);
        if (!member) {
            throw new Error("not a household member");
        }
        return member.householdId;
    }
    async function callerManagerHouseholdId(): Promise<string> {
        if (auth.kind === "household") return auth.householdId;
        const member = await getHouseholdMembership(auth.userId);
        const check = requireManager(member);
        if (!check.ok) {
            throw new Error(
                check.error === "not_a_member"
                    ? "not a household member"
                    : "only the household owner or an admin may call this",
            );
        }
        return check.member.householdId;
    }
    async function writeUserId(
        requested: string | undefined,
        targetMember: string | undefined,
    ): Promise<string> {
        if (targetMember != null) {
            if (requested != null && requested !== targetMember) {
                throw new Error(
                    "target_member must match user_id when both are set",
                );
            }
            const householdId = await callerHouseholdId();
            const member = await getHouseholdMembership(
                targetMember,
                householdId,
            );
            const check = requireMemberOfHousehold(member, householdId);
            if (!check.ok) {
                throw new Error("not a household member");
            }
            return targetMember;
        }
        return actorUserId(requested, "write");
    }
    async function requireHouseholdMemberId(memberId: string): Promise<string> {
        const householdId = await callerHouseholdId();
        const member = await getHouseholdMembership(memberId, householdId);
        const check = requireMemberOfHousehold(member, householdId);
        if (!check.ok) {
            throw new Error("not a household member");
        }
        return memberId;
    }
    async function callerActor(): Promise<{
        userId: string;
        isOwner: boolean;
        householdId: string;
    }> {
        if (auth.kind === "household") {
            const members = await listHouseholdMembers(auth.householdId);
            const owner = members.find((row) => row.role === "owner");
            if (!owner) {
                throw new Error("not a household member");
            }
            return {
                userId: owner.userId,
                isOwner: true,
                householdId: auth.householdId,
            };
        }
        const member = await getHouseholdMembership(auth.userId);
        const check = requireMemberOfHousehold(member, null);
        if (!check.ok) {
            throw new Error("not a household member");
        }
        return {
            userId: check.member.userId,
            isOwner: check.member.role === "owner",
            householdId: check.member.householdId,
        };
    }
    // clientInfo is a getter, not a value: at registration time the SDK has not
    // yet resolved who is calling, and on the modern leg it backfills the
    // identity per request before dispatch.
    const analytics = {
        userId: analyticsUserId(auth),
    };
    // Link a tool to its widget only when this user has widgets enabled. Because
    // buildMcpServer registers tools per request, this makes widget display a
    // per-user setting: with widgets off, tools/list advertises no UI link, so
    // hosts render no widget. Spreads to nothing when disabled.
    // "openai/outputTemplate" mirrors ui.resourceUri for ChatGPT: it has honored
    // the MCP Apps standard since 2026-02-22, but still reads the pre-standard
    // Apps SDK alias on some surfaces, and hosts that know neither key ignore
    // both. The two values must stay identical — ChatGPT drops the widget
    // silently if the alias points at an unregistered URI.
    const uiMeta = (resourceUri: string) =>
        widgetsEnabled
            ? {
                  _meta: {
                      ui: { resourceUri },
                      "openai/outputTemplate": resourceUri,
                  },
              }
            : {};
    return {
        auth,
        widgetsEnabled,
        alcohol,
        protocolEra,
        requireUser,
        personSchema,
        nutritionWriteSchema,
        actorUserId,
        callerHouseholdId,
        callerManagerHouseholdId,
        writeUserId,
        requireHouseholdMemberId,
        callerActor,
        analytics,
        uiMeta,
    };
}
