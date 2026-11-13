import { test, expect, describe } from "bun:test";
import { z } from "zod";
import {
    formatGoalLine,
    formatProgress,
    formatGoals,
    formatMeal,
    sumMeals,
    mealBreakdown,
    goalsPayloadOf,
    totalsPayloadOf,
    trendsDayPayloadOf,
    hasActiveTarget,
    nutrientPresence,
    rangeAverages,
    loggedDayAverageNote,
    startImportPayload,
    alcoholHiddenNote,
    missingNutrientNote,
    START_IMPORT_OUTPUT_SCHEMA,
    GOALS_ITEM,
    TOTALS_ITEM,
    TRENDS_DAY_ITEM,
    MEAL_BREAKDOWN_ITEM,
    MAX_CAFFEINE_MG,
    gateAlcohol,
    resolveDateWindow,
} from "./mcp.js";
import { formatFoodResult, type FoodResult } from "./foods.js";
import {
    buildDailyBuckets,
    computeTrends,
    computeWeeklyDigest,
    type DailyBucket,
} from "./domain/insights.js";
import type { Meal, NutritionGoals, WaterEntry } from "./db/nutrition.js";

// Pure formatters and payload builders. Kept out of mcp.test.ts so this file
// never mock.module's the db modules, foods.js, or food-search.js. Those
// process-wide stubs stay in mcp.test.ts (and tokens.js in middleware.test.ts).

function meal(over: Partial<Meal> = {}): Meal {
    return {
        id: "m1",
        user_id: "u1",
        logged_at: "2026-07-26T12:00:00.000Z",
        meal_type: "dinner",
        description: "Pasta and a beer",
        calories: 700,
        protein_g: 25,
        carbs_g: 90,
        fat_g: 20,
        fiber_g: 6,
        sugar_g: 12,
        alcohol_g: 14,
        // NULL on the base fixture on purpose: caffeine is the partial nutrient
        // where absence is the norm rather than a relic of pre-feature history,
        // and a pasta-and-beer dinner genuinely carries none. Giving every
        // fixture meal a milligram figure would hide the suppression this whole
        // feature turns on — the tests that want caffeine ask for it.
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        ...over,
    };
}

function goals(over: Partial<NutritionGoals> = {}): NutritionGoals {
    return {
        user_id: "u1",
        daily_calories: 2000,
        daily_protein_g: 120,
        daily_carbs_g: 220,
        daily_fat_g: 70,
        daily_fiber_g: 30,
        daily_sugar_g: 40,
        daily_alcohol_g: 28,
        // Milligrams, and the EFSA/FDA figure the tool description offers.
        daily_caffeine_mg: 400,
        daily_water_ml: 2500,
        target_weight_g: null,
        updated_at: "2026-07-26T00:00:00.000Z",
        ...over,
    };
}

describe("formatGoalLine direction", () => {
    test("floor keeps the 'to go' wording", () => {
        expect(formatGoalLine("Fiber", "g", 18, 30)).toBe(
            "Fiber: 18 / 30g (60%, 12g to go)",
        );
    });

    // The bug this direction exists to prevent: a sugar LIMIT of 40 g with
    // nothing eaten must not read as headroom to use up. "40g left" is a
    // permission slip, and on an averaged view ("7-day average, 12.1g left") it
    // is not even meaningful.
    test("ceiling under the limit never offers the remainder", () => {
        const line = formatGoalLine("Sugar", "g", 0, 40, "ceiling");
        expect(line).toBe("Sugar: 0 / 40g limit (0%, under)");
        expect(line).not.toContain("to go");
        expect(line).not.toContain("left");
        expect(line).not.toContain("remaining");
    });

    test("ceiling over the limit says how far over", () => {
        expect(formatGoalLine("Sugar", "g", 52.5, 40, "ceiling")).toBe(
            "Sugar: 52.5 / 40g limit (131%, 12.5g over)",
        );
    });

    test("ceiling wording survives being read as an average", () => {
        // The same line has to make sense captioned "7-day average" — "under"
        // does, "12.1g left" does not.
        const line = formatGoalLine("Sugar", "g", 27.9, 40, "ceiling");
        expect(line).toBe("Sugar: 27.9 / 40g limit (70%, under)");
    });

    test("no target prints the bare amount in either direction", () => {
        expect(formatGoalLine("Sugar", "g", 12, null, "ceiling")).toBe(
            "Sugar: 12g",
        );
        // A FLOOR of 0 stays unset — a 0 g protein target says nothing.
        expect(formatGoalLine("Protein", "g", 12, 0)).toBe("Protein: 12g");
        // Negatives are rejected in both directions.
        expect(formatGoalLine("Sugar", "g", 12, -5, "ceiling")).toBe(
            "Sugar: 12g",
        );
        expect(formatGoalLine("Protein", "g", 12, -5)).toBe("Protein: 12g");
    });

    test("actualText overrides how the consumed amount is printed", () => {
        expect(
            formatGoalLine("Alcohol", "g", 14, 28, "ceiling", "14 g (1.0 US)"),
        ).toBe("Alcohol: 14 g (1.0 US) / 28g limit (50%, under)");
    });
});

// A limit of 0 was storable, was echoed by get_nutrition_goals, and was then
// treated as no goal at all by every progress line — for the single most likely
// alcohol goal there is.
describe("a zero ceiling is a real limit", () => {
    test("hasActiveTarget splits zero by direction", () => {
        expect(hasActiveTarget(0, "ceiling")).toBe(true);
        expect(hasActiveTarget(0, "floor")).toBe(false);
        expect(hasActiveTarget(-1, "ceiling")).toBe(false);
        expect(hasActiveTarget(null, "ceiling")).toBe(false);
        expect(hasActiveTarget(undefined, "ceiling")).toBe(false);
        expect(hasActiveTarget(NaN, "ceiling")).toBe(false);
        expect(hasActiveTarget(30, "floor")).toBe(true);
    });

    test("staying at zero is reported against the zero limit", () => {
        const line = formatGoalLine(
            "Alcohol",
            "g",
            0,
            0,
            "ceiling",
            "0 g (0.0 US drinks)",
        );
        expect(line).toBe("Alcohol: 0 g (0.0 US drinks) / 0g limit (clear)");
        // No Infinity and no NaN from dividing by the zero target.
        expect(line).not.toContain("Infinity");
        expect(line).not.toContain("NaN");
        expect(line).not.toContain("%");
    });

    test("anything at all is over a zero limit", () => {
        const line = formatGoalLine("Alcohol", "g", 14, 0, "ceiling");
        expect(line).toBe("Alcohol: 14 / 0g limit (14g over)");
        expect(line).not.toContain("NaN");
        expect(line).not.toContain("Infinity");
    });

    // End to end: stored -> echoed by get_nutrition_goals -> honoured on the
    // progress line. Before this fix the middle step happened and the last did
    // not.
    test("a zero alcohol limit is echoed and then honoured", () => {
        const zero = goals({ daily_alcohol_g: 0 });
        expect(formatGoals(zero, "kg", "us")).toContain(
            "- Alcohol (max): 0 g (0.0 US drinks)",
        );
        expect(formatProgress(sumMeals([meal()]), zero, "us")).toContain(
            "Alcohol: 14 g (1.0 US drinks) / 0g limit (14g over)",
        );
        expect(
            formatProgress(sumMeals([meal({ alcohol_g: 0 })]), zero, "us"),
        ).toContain("Alcohol: 0 g (0.0 US drinks) / 0g limit (clear)");
    });

    test("a zero sugar limit is honoured too", () => {
        expect(
            formatProgress(
                sumMeals([meal()]),
                goals({ daily_sugar_g: 0 }),
                null,
            ),
        ).toContain("Sugar: 12 / 0g limit (12g over)");
    });

    // The mirror image: the echo must not promise a floor that the progress
    // line will ignore.
    test("a zero floor is listed as not set, matching how it behaves", () => {
        const text = formatGoals(
            goals({ daily_protein_g: 0, daily_fiber_g: 0 }),
            "kg",
            "us",
        );
        expect(text).toContain("- Protein: not set");
        expect(text).toContain("- Fiber: not set");
    });
});

describe("sumMeals", () => {
    test("accumulates fiber, sugar and alcohol, treating nulls as zero", () => {
        const totals = sumMeals([
            meal(),
            meal({ fiber_g: 4, sugar_g: null, alcohol_g: null }),
        ]);
        expect(totals.fiber_g).toBe(10);
        expect(totals.sugar_g).toBe(12);
        expect(totals.alcohol_g).toBe(14);
    });
});

// Every meal logged before this feature has NULL fiber/sugar/alcohol. A sum can
// treat that as zero (it adds nothing); an average cannot, or a window spanning
// the deploy divides real data by every logged day.
describe("nutrientPresence", () => {
    const blank = {
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
    };

    test("one non-null meal makes the day carry the nutrient", () => {
        expect(
            nutrientPresence([meal(blank), meal({ ...blank, fiber_g: 3 })]),
        ).toEqual({
            fiber_g: true,
            sugar_g: false,
            alcohol_g: false,
            caffeine_mg: false,
        });
    });

    test("an explicit zero is data — only null is absence", () => {
        expect(nutrientPresence([meal({ ...blank, fiber_g: 0 })])).toEqual({
            fiber_g: true,
            sugar_g: false,
            alcohol_g: false,
            caffeine_mg: false,
        });
        expect(nutrientPresence([])).toEqual({
            fiber_g: false,
            sugar_g: false,
            alcohol_g: false,
            caffeine_mg: false,
        });
    });

    // Caffeine is the flag with no profile setting behind it, so presence is
    // the ONLY thing standing between a NULL column and a fabricated "0 mg vs
    // 400 mg limit". A coffee among otherwise caffeine-free meals has to flip
    // it on its own, and a measured decaf 2 mg counts as much as a double
    // espresso.
    test("caffeine flips on its own, and a measured zero counts", () => {
        expect(
            nutrientPresence([
                meal(blank),
                meal({ ...blank, caffeine_mg: 95 }),
            ]),
        ).toEqual({
            fiber_g: false,
            sugar_g: false,
            alcohol_g: false,
            caffeine_mg: true,
        });
        expect(
            nutrientPresence([meal({ ...blank, caffeine_mg: 0 })]).caffeine_mg,
        ).toBe(true);
    });
});

describe("rangeAverages", () => {
    const day = (over: Partial<Meal>, water = 0) => {
        const meals = [meal(over)];
        const totals = sumMeals(meals);
        totals.water_ml = water;
        return { meals, totals };
    };
    const blank = {
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
    };

    // The measured regression: 30 g of fiber a day, but a window that reaches
    // back before the columns existed, reported "5g" against a 30g target.
    test("a partial window averages over the days that record the nutrient", () => {
        const perDay = [
            ...Array.from({ length: 25 }, () => day(blank)),
            ...Array.from({ length: 5 }, () => day({ fiber_g: 30 })),
        ];
        const { averages, recordedDays } = rangeAverages(perDay);
        expect(recordedDays.fiber_g).toBe(5);
        expect(averages.fiber_g).toBe(30);
        expect(averages.fiber_g).not.toBe(5);
    });

    test("a genuinely zero day counts in both numerator and denominator", () => {
        const { averages, recordedDays } = rangeAverages([
            day({ fiber_g: 0 }),
            day({ fiber_g: 30 }),
            day(blank),
        ]);
        expect(recordedDays.fiber_g).toBe(2);
        expect(averages.fiber_g).toBe(15);
    });

    test("calories, protein, carbs, fat and water still divide by every day", () => {
        const perDay = [
            day(
                { calories: 900, protein_g: 30, carbs_g: 100, fat_g: 10 },
                1000,
            ),
            day(
                {
                    ...blank,
                    calories: 300,
                    protein_g: 10,
                    carbs_g: 20,
                    fat_g: 0,
                },
                0,
            ),
        ];
        const { averages } = rangeAverages(perDay);
        expect(averages.calories).toBe(600);
        expect(averages.protein_g).toBe(20);
        expect(averages.carbs_g).toBe(60);
        expect(averages.fat_g).toBe(5);
        expect(averages.water_ml).toBe(500);
    });

    test("a nutrient nobody recorded averages to 0 over 0 days", () => {
        const { averages, recordedDays } = rangeAverages([
            day(blank),
            day(blank),
        ]);
        expect(recordedDays.fiber_g).toBe(0);
        expect(averages.fiber_g).toBe(0);
        expect(recordedDays.caffeine_mg).toBe(0);
        expect(averages.caffeine_mg).toBe(0);
        expect(Number.isFinite(averages.sugar_g)).toBe(true);
        expect(Number.isNaN(averages.alcohol_g)).toBe(false);
        expect(Number.isNaN(averages.caffeine_mg)).toBe(false);
    });

    // Caffeine's realistic shape, and the one that breaks a naive average: a
    // day is a coffee plus three meals that carry no caffeine figure at all.
    // The day CARRIES caffeine (95 mg of it) even though most of its meals are
    // NULL, and a day with no coffee carries none — so the divisor is days that
    // recorded it, never meals and never every logged day.
    test("a day mixing null and recorded caffeine meals still counts as one covered day", () => {
        const coffeeDay = (mg: number) => {
            const meals = [
                meal({ ...blank, caffeine_mg: mg }),
                meal(blank),
                meal(blank),
            ];
            return { meals, totals: sumMeals(meals) };
        };
        const { averages, recordedDays } = rangeAverages([
            coffeeDay(95),
            { meals: [meal(blank)], totals: sumMeals([meal(blank)]) },
            coffeeDay(105),
        ]);
        expect(recordedDays.caffeine_mg).toBe(2);
        expect(averages.caffeine_mg).toBe(100);
        // The wrong answers this pins out: 200/3 (every logged day) and
        // 200/7 (every meal).
        expect(averages.caffeine_mg).not.toBe(200 / 3);
    });

    test("an empty range divides nothing by zero", () => {
        const { averages } = rangeAverages([]);
        expect(averages.calories).toBe(0);
        expect(averages.water_ml).toBe(0);
    });
});

// A pre-feature day must not print a fabricated "Fiber: 0g" — but the line
// cannot just vanish when a target is set either, or tracking looks broken.
describe("formatProgress suppresses unrecorded nutrients", () => {
    const blank = {
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
    };
    const present = nutrientPresence([meal(blank)]);
    const totals = sumMeals([meal(blank)]);

    test("no data and no target prints no line at all", () => {
        const text = formatProgress(
            totals,
            goals({
                daily_fiber_g: null,
                daily_sugar_g: null,
                daily_caffeine_mg: null,
            }),
            null,
            present,
        );
        expect(text).not.toContain("Fiber");
        expect(text).not.toContain("Sugar");
        expect(text).not.toContain("Caffeine");
        // The always-on macros are untouched.
        expect(text).toContain("Calories:");
        expect(text).toContain("Water:");
    });

    test("no data but a target set says so instead of claiming zero", () => {
        const text = formatProgress(totals, goals(), null, present);
        expect(text).toContain("Fiber: not recorded / 30g target");
        expect(text).toContain("Sugar: not recorded / 40g limit");
        expect(text).toContain("Caffeine: not recorded / 400 mg limit");
        expect(text).not.toContain("Fiber: 0");
        expect(text).not.toContain("Sugar: 0");
        expect(text).not.toContain("Caffeine: 0");
    });

    test("recorded data is reported normally", () => {
        const recorded = [meal()];
        expect(
            formatProgress(
                sumMeals(recorded),
                goals(),
                null,
                nutrientPresence(recorded),
            ),
        ).toContain("Fiber: 6 / 30g (20%, 24g to go)");
    });

    // Alcohol keeps its own gate: an opted-IN user with a 0 g limit set it
    // precisely so that a quiet day still reports 0.
    test("alcohol is never suppressed by presence, only by the opt-in", () => {
        expect(formatProgress(totals, goals(), "us", present)).toContain(
            "Alcohol: 0 g (0.0 US drinks)",
        );
        expect(formatProgress(totals, goals(), null, present)).not.toContain(
            "Alcohol",
        );
    });
});

describe("alcohol opt-in gating", () => {
    const totals = sumMeals([meal()]);

    test("progress text shows alcohol in grams AND drinks when enabled", () => {
        const text = formatProgress(totals, goals(), "us");
        expect(text).toContain(
            "Alcohol: 14 g (1.0 US drinks) / 28g limit (50%, under)",
        );
        // Fiber is a floor, sugar a ceiling, in the same block.
        expect(text).toContain("Fiber: 6 / 30g (20%, 24g to go)");
        expect(text).toContain("Sugar: 12 / 40g limit (30%, under)");
        // Neither limit offers up its remainder.
        expect(text).not.toContain("left");
    });

    test("progress text uses UK units when that is the preference", () => {
        expect(formatProgress(totals, goals(), "uk")).toContain(
            "14 g (1.8 UK units)",
        );
    });

    test("progress text omits alcohol entirely when tracking is off", () => {
        const text = formatProgress(totals, goals(), null);
        expect(text).not.toContain("Alcohol");
        // ...but fiber and sugar are never gated.
        expect(text).toContain("Fiber:");
        expect(text).toContain("Sugar:");
    });

    test("goal list hides only the alcohol target when tracking is off", () => {
        expect(formatGoals(goals(), "kg", "us")).toContain(
            "- Alcohol (max): 28 g (2.0 US drinks)",
        );
        const off = formatGoals(goals(), "kg", null);
        expect(off).not.toContain("Alcohol");
        expect(off).toContain("- Fiber: 30g");
        expect(off).toContain("- Sugar (total, max): 40g");
    });

    test("meal text hides only the alcohol line when tracking is off", () => {
        expect(formatMeal(meal(), "us")).toContain(
            "Alcohol: 14 g (1.0 US drinks)",
        );
        const off = formatMeal(meal(), null);
        expect(off).not.toContain("Alcohol");
        expect(off).toContain("Fiber: 6g");
        expect(off).toContain("Sugar: 12g");
    });

    test("a meal with no alcohol logged shows no alcohol line even when enabled", () => {
        expect(formatMeal(meal({ alcohol_g: null }), "us")).not.toContain(
            "Alcohol",
        );
    });

    test("structured payloads null alcohol out when tracking is off", () => {
        expect(totalsPayloadOf(totals, null, false).alcohol_g).toBeNull();
        expect(totalsPayloadOf(totals, "us", false).alcohol_g).toBe(14);
        expect(goalsPayloadOf(goals(), null)!.alcohol_g).toBeNull();
        expect(goalsPayloadOf(goals(), "us")!.alcohol_g).toBe(28);
        expect(mealBreakdown([meal()], null, null)[0]!.alcohol_g).toBeNull();
        expect(mealBreakdown([meal()], null, "us")[0]!.alcohol_g).toBe(14);
        // Never gated, either way.
        expect(totalsPayloadOf(totals, null, false).fiber_g).toBe(6);
        expect(goalsPayloadOf(goals(), null)!.sugar_g).toBe(40);
    });
});

// ---------- caffeine ----------
//
// Caffeine deliberately has NO profile flag: no caffeine_tracking_enabled, no
// tool pair, nothing an AlcoholDisplay-shaped argument could carry. Everything
// that decides whether a caffeine figure is shown is the DATA — dayCarries on
// the write side, hasAnyPositive in insights.ts on the narrative side. These
// pin that, and pin the unit, because caffeine is the one nutrient in this
// schema stored in milligrams and a silent grams/mg mix-up is a 1000x error
// that still looks like a plausible number.
describe("caffeine is suppressed by absence, never by a flag", () => {
    const coffee = { description: "Flat white", caffeine_mg: 95 };
    const recorded = [meal(coffee)];
    const none = [meal()]; // base fixture: caffeine_mg null

    /** The one line of the progress block this describe is about. */
    const caffeineLine = (
        meals: Meal[],
        g: NutritionGoals | null = goals(),
    ): string | undefined =>
        formatProgress(sumMeals(meals), g, null, nutrientPresence(meals))
            .split("\n")
            .find((l) => l.startsWith("Caffeine:"));

    test("a recorded figure is reported against the limit, as a ceiling", () => {
        const line = caffeineLine(recorded);
        expect(line).toBe("Caffeine: 95 / 400 mg limit (24%, under)");
        // A limit is not a budget — same wording rule as sugar and alcohol.
        // (Asserted on the caffeine line alone: the floor-directed macro lines
        // in the same block legitimately say "to go".)
        expect(line).not.toContain("to go");
        expect(line).not.toContain("left");
        expect(line).not.toContain("remaining");
    });

    test("over the limit says how far over, in whole milligrams", () => {
        expect(caffeineLine([meal({ ...coffee, caffeine_mg: 470 })])).toBe(
            "Caffeine: 470 / 400 mg limit (118%, 70 mg over)",
        );
    });

    // The trap this feature is not allowed to fall into (the same one as #78):
    // most meals carry NULL caffeine forever, so a user who has never logged a
    // coffee must never be shown a caffeine figure — not "0 mg", and not
    // "0 / 400 mg limit" either.
    test("a nutrient nobody ever recorded produces no line at all", () => {
        const text = formatProgress(
            sumMeals(none),
            goals({ daily_caffeine_mg: null }),
            null,
            nutrientPresence(none),
        );
        expect(text).not.toContain("Caffeine");
        expect(text).not.toContain("0 mg");
    });

    // With a limit set the line cannot simply vanish — that reads as tracking
    // having broken — but it still refuses to invent the number.
    test("a limit with nothing recorded says 'not recorded', never 0 mg", () => {
        const text = formatProgress(
            sumMeals(none),
            goals(),
            null,
            nutrientPresence(none),
        );
        expect(text).toContain("Caffeine: not recorded / 400 mg limit");
        expect(text).not.toContain("Caffeine: 0");
    });

    // A caffeine limit of 0 is the point of the ceiling direction: someone
    // cutting caffeine out entirely sets it, and it has to behave like a real
    // limit rather than like "unset" — stored, echoed AND honoured.
    test("a zero limit is a real limit in all three places", () => {
        const zero = goals({ daily_caffeine_mg: 0 });
        expect(formatGoals(zero, "kg", null)).toContain(
            "- Caffeine (max): 0 mg",
        );
        expect(goalsPayloadOf(zero, null)!.caffeine_mg).toBe(0);

        const over = formatProgress(
            sumMeals(recorded),
            zero,
            null,
            nutrientPresence(recorded),
        );
        expect(over).toContain("Caffeine: 95 / 0 mg limit (95 mg over)");
        expect(over).not.toContain("NaN");
        expect(over).not.toContain("Infinity");

        // A measured zero against a zero limit is the day the user set it to
        // see, so it reports "clear" rather than disappearing.
        const clearDay = [meal({ ...coffee, caffeine_mg: 0 })];
        expect(
            formatProgress(
                sumMeals(clearDay),
                zero,
                null,
                nutrientPresence(clearDay),
            ),
        ).toContain("Caffeine: 0 / 0 mg limit (clear)");
    });

    // A tenth of a milligram is below the precision of any label or export, so
    // the model-facing text rounds to whole mg — while the structured payload
    // keeps the sibling `* 10 / 10` rounding for the widgets.
    test("text is whole milligrams; the payload keeps one decimal", () => {
        const fussy = [meal({ ...coffee, caffeine_mg: 95.44 })];
        expect(
            formatProgress(
                sumMeals(fussy),
                goals({ daily_caffeine_mg: null }),
                null,
                nutrientPresence(fussy),
            ),
        ).toContain("Caffeine: 95 mg");
        expect(
            formatMeal(meal({ ...coffee, caffeine_mg: 95.44 }), null),
        ).toContain("Caffeine: 95 mg");
        expect(totalsPayloadOf(sumMeals(fussy), null, true).caffeine_mg).toBe(
            95.4,
        );
    });

    // The alcohol opt-in must not reach caffeine: a user with tracking off sees
    // their coffee, and a user with it on sees no extra caffeine line either.
    test("the alcohol opt-in changes nothing about caffeine", () => {
        for (const alcohol of ["us", "uk", null] as const) {
            const text = formatProgress(
                sumMeals(recorded),
                goals(),
                alcohol,
                nutrientPresence(recorded),
            );
            expect(text).toContain("Caffeine: 95 / 400 mg limit");
            expect(formatMeal(meal(coffee), alcohol)).toContain(
                "Caffeine: 95 mg",
            );
            expect(formatGoals(goals(), "kg", alcohol)).toContain(
                "- Caffeine (max): 400 mg",
            );
            expect(goalsPayloadOf(goals(), alcohol)!.caffeine_mg).toBe(400);
        }
    });

    test("formatGoals lists an unset caffeine limit as not set", () => {
        expect(
            formatGoals(goals({ daily_caffeine_mg: null }), "kg", null),
        ).toContain("- Caffeine (max): not set");
    });

    // Per-meal, absence is per-meal: the sandwich in a day that also had a
    // coffee shows no caffeine line of its own.
    test("formatMeal omits the line for a meal with no caffeine figure", () => {
        expect(formatMeal(meal(), null)).not.toContain("Caffeine");
        // ...but a measured zero — an explicitly decaf entry — is data.
        expect(formatMeal(meal({ caffeine_mg: 0 }), null)).toContain(
            "Caffeine: 0 mg",
        );
    });
});

// Caffeine carries no energy. Fiber, sugar and alcohol all do, which is exactly
// why this needs pinning: every one of its siblings is legitimately part of an
// energy or macro story and caffeine is not, so the easy mistake is to treat
// the fourth column like the first three.
describe("caffeine never reaches an energy figure", () => {
    const plain = meal({ caffeine_mg: null });
    const caffeinated = meal({ caffeine_mg: MAX_CAFFEINE_MG });

    test("5,000 mg of caffeine changes no calorie or macro figure", () => {
        const a = sumMeals([plain]);
        const b = sumMeals([caffeinated]);
        expect(b.calories).toBe(a.calories);
        expect(b.protein_g).toBe(a.protein_g);
        expect(b.carbs_g).toBe(a.carbs_g);
        expect(b.fat_g).toBe(a.fat_g);
        expect(b.caffeine_mg).toBe(MAX_CAFFEINE_MG);

        const pa = totalsPayloadOf(a, "us", false);
        const pb = totalsPayloadOf(b, "us", true);
        expect(pb.calories).toBe(pa.calories);
        expect(pb.protein_g).toBe(pa.protein_g);
        expect(pb.carbs_g).toBe(pa.carbs_g);
        expect(pb.fat_g).toBe(pa.fat_g);
    });

    test("the per-meal breakdown the macro rings read from is unchanged too", () => {
        const [a] = mealBreakdown([plain], null, "us");
        const [b] = mealBreakdown([caffeinated], null, "us");
        expect(b!.calories).toBe(a!.calories);
        expect(b!.protein_g).toBe(a!.protein_g);
        expect(b!.carbs_g).toBe(a!.carbs_g);
        expect(b!.fat_g).toBe(a!.fat_g);
        // Present as its own stat, in milligrams, not folded into anything.
        expect(b!.caffeine_mg).toBe(MAX_CAFFEINE_MG);
    });

    test("the calorie line of the progress text is byte-identical", () => {
        const line = (m: Meal) =>
            formatProgress(sumMeals([m]), goals(), "us", nutrientPresence([m]))
                .split("\n")
                .find((l) => l.startsWith("Calories:"));
        expect(line(caffeinated)).toBe(line(plain));
    });
});

// The insights module renders an alcohol line purely from the data, because it
// stays free of the database and so cannot see the per-user opt-in. gateAlcohol is
// where that flag reaches it, so these assert the end result rather than the
// zeroing: no alcohol wording in either narrative when tracking is off.
describe("gateAlcohol", () => {
    const buckets: DailyBucket[] = ["2026-07-20", "2026-07-21"].map((date) => ({
        date,
        meals: [meal({ caffeine_mg: 95 })],
        waterMl: 1000,
        calories: 700,
        protein_g: 25,
        carbs_g: 90,
        fat_g: 20,
        fiber_g: 6,
        sugar_g: 12,
        alcohol_g: 14,
        caffeine_mg: 95,
        mealTypes: new Set(["dinner"]),
    }));

    test("zeroes the alcohol series only when tracking is off", () => {
        expect(gateAlcohol(buckets, "us")[0]!.alcohol_g).toBe(14);
        const off = gateAlcohol(buckets, null);
        expect(off[0]!.alcohol_g).toBe(0);
        // Nothing else is touched, and the originals are left alone.
        expect(off[0]!.sugar_g).toBe(12);
        expect(off[0]!.calories).toBe(700);
        expect(buckets[0]!.alcohol_g).toBe(14);
    });

    // The spread has to carry caffeine_mg through untouched. There is no
    // caffeine flag to reach insights.ts with, so zeroing it here — the one
    // mechanism that could — would silently delete the caffeine narrative for
    // every user who has alcohol tracking off, which is most of them.
    test("caffeine rides through the alcohol gate in both positions", () => {
        expect(gateAlcohol(buckets, "us")[0]!.caffeine_mg).toBe(95);
        expect(gateAlcohol(buckets, null)[0]!.caffeine_mg).toBe(95);
        expect(computeTrends(gateAlcohol(buckets, null), goals())).toContain(
            "Caffeine",
        );
        expect(
            computeWeeklyDigest(gateAlcohol(buckets, null), goals()),
        ).toContain("Caffeine");
    });

    test("keeps alcohol out of the trends narrative when tracking is off", () => {
        expect(computeTrends(gateAlcohol(buckets, "us"), goals())).toContain(
            "Alcohol",
        );
        expect(
            computeTrends(gateAlcohol(buckets, null), goals()),
        ).not.toContain("Alcohol");
    });

    test("keeps alcohol out of the weekly digest when tracking is off", () => {
        expect(
            computeWeeklyDigest(gateAlcohol(buckets, "us"), goals()),
        ).toContain("Alcohol");
        expect(
            computeWeeklyDigest(gateAlcohol(buckets, null), goals()),
        ).not.toContain("Alcohol");
    });
});

// THE CROSS-CHECK. get_trends and get_nutrition_summary aggregate the same
// meals in two different modules, and a user must not see one fiber average in
// one and a different one in the other. This test runs both halves over one
// window and asserts they agree; it fails if either side changes its rule
// without the other. The rule both must implement: fiber/sugar/alcohol average
// over the days that RECORD them, everything else over every logged day.
describe("summary and trends agree on the same window", () => {
    const END = "2026-07-26";
    const START = "2026-06-27"; // 30 days inclusive
    const dayAt = (i: number) => {
        const d = new Date(`${START}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
    };

    // 25 pre-feature days (NULL fiber/sugar), then one genuine zero day, then
    // four days at 30 g fiber / 20 g sugar. Fiber: 120 g over 4 recorded days
    // plus a recorded 0 => 24 g. The old `?? 0 / every logged day` rule gave 4.
    const meals: Meal[] = [];
    for (let i = 0; i < 25; i++) {
        meals.push(
            meal({
                id: `pre-${i}`,
                logged_at: `${dayAt(i)}T12:00:00.000Z`,
                calories: 600,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
            }),
        );
    }
    meals.push(
        meal({
            id: "zero",
            logged_at: `${dayAt(25)}T12:00:00.000Z`,
            calories: 600,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
        }),
    );
    for (let i = 26; i < 30; i++) {
        meals.push(
            meal({
                id: `post-${i}`,
                logged_at: `${dayAt(i)}T12:00:00.000Z`,
                calories: 600,
                fiber_g: 30,
                sugar_g: 20,
                alcohol_g: null,
            }),
        );
    }

    // What get_nutrition_summary does: group by local date, then rangeAverages.
    const byDate = new Map<string, Meal[]>();
    for (const m of meals) {
        const date = m.logged_at.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) ?? []), m]);
    }
    const summary = rangeAverages(
        [...byDate.values()].map((dayMeals) => ({
            meals: dayMeals,
            totals: sumMeals(dayMeals),
        })),
    );

    const trendsText = computeTrends(
        buildDailyBuckets(meals, [], START, END, "UTC"),
        null,
    );

    // Pull "  30d avg: 24g" out of the "Fiber:" block of the trends narrative.
    const trendAvg = (label: string, window: string): number => {
        const section = trendsText
            .split("\n\n")
            .find((s) => s.startsWith(`${label}:`));
        if (!section) {
            throw new Error(
                `computeTrends printed no "${label}" section — if it was suppressed, the two halves disagree about what counts as no data.\n${trendsText}`,
            );
        }
        const m = section.match(
            new RegExp(`${window} avg: (-?[0-9]+(?:\\.[0-9]+)?)`),
        );
        if (!m) {
            throw new Error(
                `no "${window} avg" in the ${label} section:\n${section}`,
            );
        }
        return Number(m[1]);
    };
    const round1 = (n: number) => Math.round(n * 10) / 10;

    test("fiber: same number in both, over the recorded days only", () => {
        expect(summary.recordedDays.fiber_g).toBe(5);
        expect(round1(summary.averages.fiber_g)).toBe(24);
        expect(trendAvg("Fiber", "30d")).toBe(round1(summary.averages.fiber_g));
    });

    test("sugar: same number in both", () => {
        expect(summary.recordedDays.sugar_g).toBe(5);
        expect(round1(summary.averages.sugar_g)).toBe(16);
        expect(trendAvg("Sugar", "30d")).toBe(round1(summary.averages.sugar_g));
    });

    // NOT a test of the two calorie denominators — this fixture logs all 30 of
    // its 30 days, so "per logged day" and "per calendar day" are the same
    // divisor and the divergence issue #70 reported cannot appear here. What it
    // does prove is that a fully-logged window makes them coincide, and that
    // neither side then apologises for a gap it doesn't have. The gap case is
    // pinned in the next block.
    test("a fully-logged window: both denominators coincide, silently", () => {
        expect(byDate.size).toBe(30);
        expect(round1(summary.averages.calories)).toBe(600);
        expect(trendAvg("Calories", "30d")).toBe(600);
        expect(trendsText).not.toContain("calendar-day average");
        expect(loggedDayAverageNote(byDate.size, 30)).toBe("");
    });
});

// ---------- Regression pin for issue #70 ----------
//
// The two tools report different daily figures for the same window, and BOTH
// are right: rangeAverages divides by the days the user actually logged ("what
// does a day I eat look like?"), computeTrends divides by every calendar day
// in the window ("what am I averaging this month?"). #70 was never that one of
// them miscounts — it was that neither said which it was, so 2000 kcal in the
// summary and 1000 kcal in trends read as a bug. The fix is disclosure on both
// sides, not one shared denominator: changing either divisor would rewrite the
// figures users' history is built on. So this block pins both numbers AND both
// notes; dropping either note, or quietly unifying the denominators, fails here.
describe("logged-day and calendar-day averages diverge, and both say so (#70)", () => {
    const END = "2026-07-26";
    const START = "2026-06-27"; // 30 calendar days inclusive
    const DAYS_IN_RANGE = 30;
    const LOGGED_DAYS = 15;
    const dayAt = (i: number) => {
        const d = new Date(`${START}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
    };

    // Every other day logged — 15 of 30 — at a flat 2000 kcal / 100 g protein /
    // 200 g carbs / 80 g fat / 2000 ml water. A flat value on exactly half the
    // days makes the divergence exactly 2x on every nutrient, which is the
    // widest it can be and the shape the issue described. fiber/sugar/alcohol
    // stay null: they have their own covered-days denominator (tested above)
    // and would only confuse this pin.
    const meals: Meal[] = [];
    const water: WaterEntry[] = [];
    for (let i = 0; i < DAYS_IN_RANGE; i += 2) {
        meals.push(
            meal({
                id: `d-${i}`,
                logged_at: `${dayAt(i)}T12:00:00.000Z`,
                calories: 2000,
                protein_g: 100,
                carbs_g: 200,
                fat_g: 80,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
            }),
        );
        water.push({
            id: `w-${i}`,
            user_id: "u1",
            amount_ml: 2000,
            logged_at: `${dayAt(i)}T12:00:00.000Z`,
            notes: null,
            created_at: `${dayAt(i)}T12:00:00.000Z`,
            idempotency_key: null,
        });
    }

    // The summary's own aggregation: group by local date, then rangeAverages
    // over only the dates that exist (byDate never holds an unlogged day).
    const byDate = new Map<string, Meal[]>();
    for (const m of meals) {
        const date = m.logged_at.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) ?? []), m]);
    }
    const summary = rangeAverages(
        [...byDate.entries()].sort().map(([, dayMeals]) => {
            const totals = sumMeals(dayMeals);
            totals.water_ml = 2000;
            return { meals: dayMeals, totals };
        }),
    );

    const trendsText = computeTrends(
        buildDailyBuckets(meals, water, START, END, "UTC"),
        null,
    );

    test("the summary averages over the 15 logged days", () => {
        expect(byDate.size).toBe(LOGGED_DAYS);
        expect(summary.averages.calories).toBe(2000);
        expect(summary.averages.protein_g).toBe(100);
        expect(summary.averages.carbs_g).toBe(200);
        expect(summary.averages.fat_g).toBe(80);
        expect(summary.averages.water_ml).toBe(2000);
    });

    // Same data, half the figure, because the 15 unlogged days count as zeros.
    test("trends averages the same nutrients over all 30 calendar days", () => {
        expect(trendsText).toContain("30d avg: 1000 kcal");
        expect(trendsText).toContain("30d avg: 50g"); // protein
        expect(trendsText).toContain("30d avg: 100g"); // carbs
        expect(trendsText).toContain("30d avg: 40g"); // fat
        expect(trendsText).toContain("30d avg: 1000 ml");
    });

    test("every trends figure carries the calendar-day note", () => {
        for (const line of [
            "30d avg: 1000 kcal",
            "30d avg: 50g",
            "30d avg: 100g",
            "30d avg: 40g",
            "30d avg: 1000 ml",
        ]) {
            expect(trendsText).toContain(
                `${line} (calendar-day average; ${LOGGED_DAYS} of ${DAYS_IN_RANGE} days logged)`,
            );
        }
    });

    test("the summary note names the same two numbers, the other way round", () => {
        const note = loggedDayAverageNote(LOGGED_DAYS, DAYS_IN_RANGE);
        expect(note).toContain(`${LOGGED_DAYS} of the ${DAYS_IN_RANGE} days`);
        expect(note).toContain("per logged day");
        expect(note).toContain("get_trends");
    });
});

describe("start_meal_import payload", () => {
    const base = {
        tz: "Europe/Kyiv",
        tzConfigured: true,
        widgetsEnabled: true,
        userId: "u1",
    };

    // drink_unit is the whole alcohol gate for this flow: non-null means the
    // importer may map, preview and send the file's alcohol column, in that
    // unit; null means it does none of the three (see startImportPayload).
    test("carries the drink unit when the user tracks alcohol", () => {
        expect(startImportPayload({ ...base, alcohol: "us" }).drink_unit).toBe(
            "us",
        );
        expect(startImportPayload({ ...base, alcohol: "uk" }).drink_unit).toBe(
            "uk",
        );
    });

    // The bug: with no drink_unit at all, the importer auto-mapped an alcohol
    // column and showed per-row ethanol to a user who had tracking off.
    test("drink_unit is null when alcohol tracking is off", () => {
        expect(
            startImportPayload({ ...base, alcohol: null }).drink_unit,
        ).toBeNull();
    });

    test("the payload satisfies the declared outputSchema either way", () => {
        for (const alcohol of ["us", null] as const) {
            const parsed = START_IMPORT_OUTPUT_SCHEMA.parse(
                startImportPayload({ ...base, alcohol }),
            );
            expect(parsed.import_tool_name).toBe("bulk_import_meals");
            expect(parsed.tz).toBe("Europe/Kyiv");
            expect(parsed.user_id).toBe("u1");
            expect(parsed.max_rows_per_call).toBeGreaterThan(0);
        }
    });
});

// formatFoodResult lives in foods.ts but its rendering is part of this pass, and
// its gate is fed by the same alcohol opt-in threaded through mcp.ts — so its
// gating cases are covered here rather than in the food-lookup suite.
describe("formatFoodResult", () => {
    const beer: FoodResult = {
        name: "Lager",
        brand: "Brewery",
        serving: "330 ml",
        calories: 140,
        protein_g: 1,
        carbs_g: 11,
        fat_g: 0,
        fiber_g: 0.5,
        sugar_g: 0.2,
        alcohol_g: 13,
        nutriscore_grade: "d",
        nova_group: 2,
        source: "off:1234567890123",
        source_name: "openfoodfacts",
        barcode: "1234567890123",
    };

    test("always shows fiber and total sugar", () => {
        const text = formatFoodResult(beer);
        expect(text).toContain("Fiber: 0.5 g");
        expect(text).toContain("Sugar (total): 0.2 g");
    });

    test("renders n/a rather than 0 for an absent fiber or sugar figure", () => {
        const text = formatFoodResult({
            ...beer,
            fiber_g: null,
            sugar_g: null,
        });
        expect(text).toContain("Fiber: n/a");
        expect(text).toContain("Sugar (total): n/a");
    });

    test("shows alcohol only when the user tracks it", () => {
        expect(formatFoodResult(beer, "us")).toContain(
            "Alcohol: 13 g (0.9 US drinks)",
        );
        expect(formatFoodResult(beer, "uk")).toContain("(1.6 UK units)");
        expect(formatFoodResult(beer)).not.toContain("Alcohol");
        expect(formatFoodResult(beer, null)).not.toContain("Alcohol");
    });

    test("omits alcohol when Open Food Facts could not resolve it", () => {
        expect(
            formatFoodResult({ ...beer, alcohol_g: null }, "us"),
        ).not.toContain("Alcohol");
    });
});

// A .nullable() field is emitted as REQUIRED with anyOf[type, null], so a
// payload that omits a key fails validation instead of defaulting to null.
// These parses are the guard that every builder emits a complete literal.
describe("structuredContent literals satisfy their schemas", () => {
    const totals = sumMeals([meal()]);

    test("totals, goals and breakdown parse with alcohol on and off", () => {
        for (const alcohol of ["us", null] as const) {
            expect(() =>
                TOTALS_ITEM.parse(totalsPayloadOf(totals, alcohol, false)),
            ).not.toThrow();
            expect(() =>
                GOALS_ITEM.parse(goalsPayloadOf(goals(), alcohol)),
            ).not.toThrow();
            expect(() =>
                z
                    .array(MEAL_BREAKDOWN_ITEM)
                    .parse(mealBreakdown([meal()], "UTC", alcohol)),
            ).not.toThrow();
        }
    });

    test("goalsPayloadOf keeps every cleared target as an explicit null", () => {
        const parsed = GOALS_ITEM.parse(
            goalsPayloadOf(
                goals({
                    daily_fiber_g: null,
                    daily_sugar_g: null,
                    daily_alcohol_g: null,
                    daily_caffeine_mg: null,
                }),
                "us",
            ),
        );
        expect(parsed.fiber_g).toBeNull();
        expect(parsed.sugar_g).toBeNull();
        expect(parsed.alcohol_g).toBeNull();
        expect(parsed.caffeine_mg).toBeNull();
    });

    test("no goals at all is null, not a half-filled object", () => {
        expect(goalsPayloadOf(null, "us")).toBeNull();
    });

    // The specific failure mode of a .nullable() field: the emitted JSON Schema
    // marks it REQUIRED with an anyOf[number, null] value, so a builder that
    // OMITS the key on the "nothing to report" path fails validation instead of
    // quietly defaulting to null — and the host then drops the whole result.
    // Caffeine is the field most likely to hit that path, since a null is its
    // normal state rather than an edge case.
    test("an unrecorded caffeine emits an explicit null, with the key present", () => {
        const payload = totalsPayloadOf(sumMeals([meal()]), "us", false);
        expect(payload.caffeine_mg).toBeNull();
        expect(Object.keys(payload)).toContain("caffeine_mg");
        expect(TOTALS_ITEM.parse(payload).caffeine_mg).toBeNull();

        const [row] = mealBreakdown([meal()], null, "us");
        expect(row!.caffeine_mg).toBeNull();
        expect(Object.keys(row!)).toContain("caffeine_mg");
        expect(() => MEAL_BREAKDOWN_ITEM.parse(row)).not.toThrow();
    });

    // The mirror: a day that DID record caffeine, and recorded none of it, must
    // survive as 0 rather than being collapsed back into the null that means
    // "never recorded". `caffeineRecorded` is what tells the two apart.
    test("a recorded zero survives as 0, not as the absence null", () => {
        const decaf = [meal({ caffeine_mg: 0 })];
        const payload = totalsPayloadOf(
            sumMeals(decaf),
            "us",
            nutrientPresence(decaf).caffeine_mg,
        );
        expect(payload.caffeine_mg).toBe(0);
        expect(payload.caffeine_mg).not.toBeNull();
        expect(mealBreakdown(decaf, null, "us")[0]!.caffeine_mg).toBe(0);
    });
});

// Regression coverage for https://github.com/akutishevsky/nutrition-mcp/issues/67:
// the trends widget re-averaged fiber/sugar/alcohol over every day in a slice
// instead of only the days that recorded them, because a day's per-day payload
// summed those nutrients with `?? 0` just like every other totals payload — so
// the widget's client-side average (trends.html's avgOf) could never tell "not
// recorded" from "recorded zero". trendsDayPayloadOf is the fix: it nulls out
// fiber_g/sugar_g/alcohol_g on a day that dayCarries says didn't record them.
describe("trendsDayPayloadOf", () => {
    const bucketWith = (mealsForDay: Meal[]): DailyBucket => ({
        date: "2026-07-20",
        meals: mealsForDay,
        waterMl: 1000,
        calories: mealsForDay.reduce((s, m) => s + (m.calories ?? 0), 0),
        protein_g: 25,
        carbs_g: 90,
        fat_g: 20,
        fiber_g: mealsForDay.reduce((s, m) => s + (m.fiber_g ?? 0), 0),
        sugar_g: mealsForDay.reduce((s, m) => s + (m.sugar_g ?? 0), 0),
        alcohol_g: mealsForDay.reduce((s, m) => s + (m.alcohol_g ?? 0), 0),
        caffeine_mg: mealsForDay.reduce((s, m) => s + (m.caffeine_mg ?? 0), 0),
        mealTypes: new Set(["dinner"]),
    });

    test("nulls fiber/sugar/alcohol/caffeine on a day that never recorded them", () => {
        const bucket = bucketWith([
            meal({
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
            }),
        ]);
        const payload = trendsDayPayloadOf(bucket, "us");
        expect(payload.fiber_g).toBeNull();
        expect(payload.sugar_g).toBeNull();
        expect(payload.alcohol_g).toBeNull();
        expect(payload.caffeine_mg).toBeNull();
        // Everything else sums normally — only the three partial nutrients
        // get the covered-days treatment.
        expect(payload.calories).toBe(bucket.calories);
        expect(() => TRENDS_DAY_ITEM.parse(payload)).not.toThrow();
    });

    test("keeps a real recorded zero as 0, not null", () => {
        const bucket = bucketWith([
            meal({ fiber_g: 0, sugar_g: 0, alcohol_g: 0, caffeine_mg: 0 }),
        ]);
        const payload = trendsDayPayloadOf(bucket, "us");
        expect(payload.fiber_g).toBe(0);
        expect(payload.sugar_g).toBe(0);
        expect(payload.alcohol_g).toBe(0);
        expect(payload.caffeine_mg).toBe(0);
    });

    // Caffeine gets the covered-days treatment one level down, inside
    // totalsPayloadOf, rather than through an override in the returned literal
    // — so it needs its own pin: a day whose coffee is one meal among several
    // NULL ones is covered and reports the day's total.
    test("a day with one coffee among null meals reports the day's total", () => {
        const bucket = bucketWith([
            meal({ caffeine_mg: 95 }),
            meal({ caffeine_mg: null }),
        ]);
        expect(trendsDayPayloadOf(bucket, "us").caffeine_mg).toBe(95);
        // And the alcohol opt-in has no say over it, in either position.
        expect(trendsDayPayloadOf(bucket, null).caffeine_mg).toBe(95);
    });

    test("alcohol tracking off nulls alcohol_g regardless of coverage", () => {
        const bucket = bucketWith([meal({ alcohol_g: 14 })]);
        expect(trendsDayPayloadOf(bucket, null).alcohol_g).toBeNull();
    });

    test("a day with no meals at all is null across every partial nutrient", () => {
        const payload = trendsDayPayloadOf(bucketWith([]), "us");
        expect(payload.fiber_g).toBeNull();
        expect(payload.sugar_g).toBeNull();
        expect(payload.alcohol_g).toBeNull();
        expect(payload.caffeine_mg).toBeNull();
        expect(() => TRENDS_DAY_ITEM.parse(payload)).not.toThrow();
    });

    // The exact drift the issue reported: fiber recorded on 5 of 30 days at
    // 30 g averaged out to 5 g/day in the widget (150 / 30) instead of 30
    // (150 / 5). Once uncovered days are null, filtering them out before
    // averaging — what the fixed client-side avgOf now does — recovers 30.
    test("covered-days average recovers the true figure once uncovered days are null", () => {
        const covered = Array.from({ length: 5 }, () =>
            trendsDayPayloadOf(bucketWith([meal({ fiber_g: 30 })]), "us"),
        );
        const uncovered = Array.from({ length: 25 }, () =>
            trendsDayPayloadOf(bucketWith([meal({ fiber_g: null })]), "us"),
        );
        const days = [...uncovered, ...covered];
        const seen = days.filter((d) => d.fiber_g != null);
        expect(seen).toHaveLength(5);
        const avg = seen.reduce((s, d) => s + d.fiber_g!, 0) / seen.length;
        expect(avg).toBe(30);
    });
});

describe("alcoholHiddenNote", () => {
    test("says nothing when the user already tracks alcohol", () => {
        expect(alcoholHiddenNote(true, "us", "Alcohol saved")).toBe("");
        expect(alcoholHiddenNote(true, "uk", "Alcohol saved")).toBe("");
    });

    test("says nothing when the write carried no alcohol", () => {
        expect(alcoholHiddenNote(false, null, "Alcohol saved")).toBe("");
    });

    test("names the setting only when both conditions hold", () => {
        const note = alcoholHiddenNote(true, null, "Alcohol target saved");
        expect(note).toContain("Alcohol target saved");
        expect(note).toContain("set_alcohol_tracking");
        expect(note).toContain("not shown");
    });
});

describe("missingNutrientNote", () => {
    const base = {
        id: "m1",
        user_id: "u1",
        logged_at: "2026-08-07T12:00:00.000Z",
        meal_type: "lunch" as const,
        description: "Chicken salad",
        calories: 400,
        protein_g: 30,
        carbs_g: 10,
        fat_g: 20,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
    } satisfies Meal;

    test("names both missing fields and the meal id to repair", () => {
        const note = missingNutrientNote(base);
        expect(note).toContain("fiber_g, sugar_g");
        expect(note).toContain("update_meal");
        expect(note).toContain("m1");
        // The sentence that stops the model "fixing" it by sending 0s blindly.
        expect(note).toContain("A missing value is not a zero");
    });

    test("names only the field that is actually missing", () => {
        const note = missingNutrientNote({ ...base, fiber_g: 6 });
        expect(note).toContain("sugar_g");
        expect(note).not.toContain("fiber_g");
    });

    // An explicit 0 is a measurement — the point of the nudge is to turn
    // omissions into values, and 0 is a perfectly good value for a steak.
    test("an explicit zero satisfies it", () => {
        expect(missingNutrientNote({ ...base, fiber_g: 0, sugar_g: 0 })).toBe(
            "",
        );
    });

    // If this ever starts asking for caffeine, the read side has to change
    // first — see limitShown in shared/macros.js and recordedGoalLine.
    test("never asks for caffeine, however complete the rest is", () => {
        const note = missingNutrientNote({
            ...base,
            fiber_g: 6,
            sugar_g: 4,
            caffeine_mg: null,
        });
        expect(note).toBe("");
    });
});

describe("resolveDateWindow", () => {
    test("defaults to today as a single day", () => {
        expect(resolveDateWindow({}, "2026-07-15")).toEqual({
            start: "2026-07-15",
            end: "2026-07-15",
            single: true,
        });
    });

    test("accepts a single date", () => {
        expect(resolveDateWindow({ date: "2026-07-01" }, "2026-07-15")).toEqual(
            {
                start: "2026-07-01",
                end: "2026-07-01",
                single: true,
            },
        );
    });

    test("accepts from/to as an inclusive range", () => {
        expect(
            resolveDateWindow(
                { from: "2026-07-01", to: "2026-07-07" },
                "2026-07-15",
            ),
        ).toEqual({
            start: "2026-07-01",
            end: "2026-07-07",
            single: false,
        });
    });

    test("rejects mixing date with from/to", () => {
        expect(() =>
            resolveDateWindow(
                { date: "2026-07-01", from: "2026-07-01" },
                "2026-07-15",
            ),
        ).toThrow(/not both/);
    });

    test("rejects a half range", () => {
        expect(() =>
            resolveDateWindow({ from: "2026-07-01" }, "2026-07-15"),
        ).toThrow(/both from and to/);
    });
});
