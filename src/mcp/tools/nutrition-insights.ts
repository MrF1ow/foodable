import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    getMealsByDate,
    getMealsInRange,
    searchMeals,
    getGoalsForRange,
    getWaterInRange,
    type Meal,
} from "../../db/nutrition.js";
import {
    getUserTimezone,
    timezoneFromProfile,
    getProfile,
} from "../../db/profiles.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, shiftLocalDate, dateInTz } from "../../domain/tz.js";
import {
    buildDailyBuckets,
    computeTrends,
    computeMealPatterns,
    computeWeeklyDigest,
    dateDiffDays,
    dayCarries,
} from "../../domain/insights.js";
import { exportAllData } from "../../domain/export.js";
import { formatMealSearchResults } from "../../search.js";
import {
    registerWidgetResource,
    resolveDateWindow,
    emptyTotals,
    sumMeals,
    nutrientPresence,
    rangeAverages,
    loggedDayAverageNote,
    mealBreakdown,
    MEAL_BREAKDOWN_ITEM,
    GOALS_ITEM,
    TOTALS_ITEM,
    TRENDS_DAY_ITEM,
    DRINK_UNIT_FIELD,
    goalsPayloadOf,
    totalsPayloadOf,
    trendsDayPayloadOf,
    gateAlcohol,
    formatMeal,
    formatProgress,
    type DailyTotals,
} from "../shared.js";
import type { ToolContext } from "../shared.js";

export function registerNutritionReadTools(
    server: McpServer,
    ctx: ToolContext,
) {
    const { alcohol, personSchema, actorUserId, analytics, uiMeta } = ctx;
    server.registerTool(
        "get_meals",
        {
            title: "Get Meals",
            description:
                "Get logged meals. Omit date/from/to for today; pass date for one local day; pass from and to (inclusive, YYYY-MM-DD) for a range. Do not mix date with from/to.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                date: z
                    .string()
                    .optional()
                    .describe(
                        "Single local day (YYYY-MM-DD). Defaults to today.",
                    ),
                from: z
                    .string()
                    .optional()
                    .describe(
                        "Range start (YYYY-MM-DD), inclusive. Requires to.",
                    ),
                to: z
                    .string()
                    .optional()
                    .describe(
                        "Range end (YYYY-MM-DD), inclusive. Requires from.",
                    ),
            }),
        },
        async (args) => {
            return withAnalytics(
                "get_meals",
                async () => {
                    const userId = await actorUserId(args.user_id, "read");
                    const tz = await getUserTimezone(userId);
                    const window = resolveDateWindow(args, todayInTz(tz));
                    const meals = window.single
                        ? await getMealsByDate(userId, window.start, tz)
                        : await getMealsInRange(
                              userId,
                              window.start,
                              window.end,
                              tz,
                          );
                    if (meals.length === 0) {
                        const empty = window.single
                            ? window.start === todayInTz(tz)
                                ? "No meals logged today."
                                : `No meals logged on ${window.start}.`
                            : `No meals found between ${window.start} and ${window.end}.`;
                        return {
                            content: [{ type: "text", text: empty }],
                        };
                    }
                    if (window.single) {
                        const text = meals
                            .map((m) => formatMeal(m, alcohol))
                            .join("\n\n---\n\n");
                        return { content: [{ type: "text", text }] };
                    }
                    const byDate = new Map<string, Meal[]>();
                    for (const meal of meals) {
                        const date = dateInTz(meal.logged_at, tz);
                        const existing = byDate.get(date) ?? [];
                        existing.push(meal);
                        byDate.set(date, existing);
                    }
                    const sections: string[] = [];
                    for (const [date, dateMeals] of [
                        ...byDate.entries(),
                    ].sort()) {
                        const header = `## ${date} (${dateMeals.length} meal${dateMeals.length === 1 ? "" : "s"})`;
                        const formatted = dateMeals
                            .map((m) => formatMeal(m, alcohol))
                            .join("\n\n---\n\n");
                        sections.push(`${header}\n\n${formatted}`);
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: sections.join("\n\n===\n\n"),
                            },
                        ],
                    };
                },
                analytics,
                {
                    date: args.date,
                    from: args.from,
                    to: args.to,
                },
            );
        },
    );

    server.registerTool(
        "search_meals",
        {
            title: "Search Past Meals",
            description:
                "Search the user's past logged meals by keyword (case-insensitive match on description and notes), newest first, grouped into recurring variations with counts, last-logged date, and typical macros. Use this BEFORE logging a meal from a photo: past variations reveal ingredients that aren't visible in the picture (raisins vs banana, milk vs water, added honey or oil) — turn each difference between variations into a question for the user rather than picking one silently, and ask those questions one at a time across several turns instead of batching them. Also use it for requests like 'log my usual breakfast': search, interview the user to pin down the variation and the amount, then log_meal. For a restaurant meal, search the restaurant name as well as the dish — a past visit to the same venue is stronger evidence than anything on the web. Pass short food keywords, not full sentences, and include the food name in every language the user may have logged in — always add an English alternative alongside the conversation language, e.g. [\"вівсянка\", \"oatmeal\"].",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                queries: z
                    .array(z.string().min(1))
                    .min(1)
                    .max(5)
                    .describe(
                        "Keyword alternatives, each a short food name like 'oatmeal' or 'chicken salad' (all words of one alternative must match; alternatives are OR'd). Include the food name in every language the user may have logged in — typically the conversation language plus English.",
                    ),
                days: z.coerce
                    .number()
                    .int()
                    .min(1)
                    .max(3650)
                    .optional()
                    .describe("How far back to search, in days (default 365)."),
                limit: z.coerce
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .optional()
                    .describe("Max matching entries to analyze (default 50)."),
            }),
        },
        async ({ queries, days, limit, user_id }) => {
            return withAnalytics(
                "search_meals",
                async () => {
                    const userId = await actorUserId(user_id, "read");
                    const tz = await getUserTimezone(userId);
                    const windowDays = days ?? 365;
                    // A fuzzy lookback window needs no calendar-day precision,
                    // so a plain UTC offset from now is enough (tz is still
                    // used to render dates in the results).
                    const sinceIso = new Date(
                        Date.now() - windowDays * 24 * 60 * 60 * 1000,
                    ).toISOString();
                    const meals = await searchMeals(userId, queries, {
                        limit: limit ?? 50,
                        sinceIso,
                    });
                    if (meals.length === 0) {
                        const label = queries.map((q) => `"${q}"`).join(" / ");
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `No past meals matching ${label} in the last ${windowDays} days. If logging from a photo, proceed with your own portion assumptions — but with no past variations to draw on, you have MORE to ask about, not less. Interview the user one question per message about the amount eaten and about ingredients the photo cannot show (oil, butter, sugar, sauce, what a drink was made with) before calling log_meal.`,
                                },
                            ],
                        };
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: formatMealSearchResults(
                                    meals,
                                    queries,
                                    tz,
                                ),
                            },
                        ],
                    };
                },
                analytics,
                { days: days ?? 365 },
            );
        },
    );

    registerWidgetResource(server, ctx, {
        key: "nutrition-summary",
        resourceName: "nutrition-summary-widget",
        title: "Nutrition Summary Dashboard",
        description:
            "Interactive dashboard UI for get_nutrition_summary: macro tiles vs goals and a per-day breakdown, with automatic light/dark theming.",
    });
    registerWidgetResource(server, ctx, {
        key: "goal-progress",
        resourceName: "goal-progress-widget",
        title: "Goal Progress",
        description:
            "Interactive UI for get_goal_progress: intake-vs-goal rings for a single day plus body-weight progress, with automatic light/dark theming.",
    });
    registerWidgetResource(server, ctx, {
        key: "meal-logged",
        resourceName: "meal-logged-widget",
        title: "Meal Logged",
        description:
            "Interactive UI shown after log_meal: the day's running intake-vs-goal rings, with automatic light/dark theming. Shows nothing when no nutrition goals are set.",
    });
    registerWidgetResource(server, ctx, {
        key: "trends",
        resourceName: "trends-widget",
        title: "Trends",
        description:
            "Interactive UI for get_trends: a 7/14/30-day toggle over a daily calories chart and trailing-average-vs-goal rings, with automatic light/dark theming.",
    });
    registerWidgetResource(server, ctx, {
        key: "weight-trends",
        resourceName: "weight-trends-widget",
        title: "Weight Trends",
        description:
            "Interactive UI for get_weight_trends: a 7/14/30-day toggle over a weight-over-time chart (data-scaled axis, target line) plus latest/change/target stats, with automatic light/dark theming.",
    });

    server.registerTool(
        "get_nutrition_summary",
        {
            title: "Get Nutrition Summary",
            description:
                "Get daily nutrition totals for a date range. Renders an interactive dashboard (macro tiles vs. goals and a per-day breakdown) in clients that support MCP Apps UI, and returns the same data as text elsewhere. Figures are estimates, not medical or dietary advice.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                start_date: z.string().describe("Start date (YYYY-MM-DD)"),
                end_date: z.string().describe("End date (YYYY-MM-DD)"),
            }),
            outputSchema: z.object({
                start_date: z.string(),
                end_date: z.string(),
                logged_days: z.number(),
                // The calendar length of the window, so a consumer can see the
                // denominator behind `averages` for itself: these are per
                // LOGGED day, while get_trends divides the same nutrients by
                // all `days_in_range` days (issue #70). Without both numbers a
                // client cannot tell a full month from a fortnight of gaps.
                days_in_range: z.number(),
                drink_unit: DRINK_UNIT_FIELD,
                goals: GOALS_ITEM.nullable(),
                averages: TOTALS_ITEM,
                // How many of `logged_days` actually record each of the
                // post-launch nutrients — the denominator behind `averages` for
                // them, so a consumer can say "5 of 30 days" instead of passing
                // a partial average off as a full one. 0 means the window has no
                // data for it at all and its average is not a figure. Alcohol is
                // null when tracking is off, like every other alcohol field;
                // caffeine has no such flag, so its count is always a number
                // (0 being how a consumer sees "never recorded").
                recorded_days: z.object({
                    fiber_g: z.number(),
                    sugar_g: z.number(),
                    alcohol_g: z.number().nullable(),
                    caffeine_mg: z.number(),
                }),
                days: z.array(
                    TOTALS_ITEM.extend({
                        date: z.string(),
                        meal_count: z.number(),
                    }),
                ),
                meals: z.array(MEAL_BREAKDOWN_ITEM),
            }),
            // Link the tool to its dashboard UI (MCP Apps).
            ...uiMeta("nutrition-summary"),
        },
        async ({ start_date, end_date, user_id }) => {
            return withAnalytics(
                "get_nutrition_summary",
                async () => {
                    const userId = await actorUserId(user_id, "read");
                    // Sized with insights.ts's own arithmetic (the function
                    // buildDailyBuckets lays its buckets out with), so the two
                    // tools cannot disagree about how long a window is. Clamped
                    // because a reversed range would otherwise report 0 or less
                    // days and make the note read as nonsense.
                    const daysInRange = Math.max(
                        1,
                        dateDiffDays(start_date, end_date) + 1,
                    );
                    const tz = await getUserTimezone(userId);
                    const [meals, water, { forDate }] = await Promise.all([
                        getMealsInRange(userId, start_date, end_date, tz),
                        getWaterInRange(userId, start_date, end_date, tz),
                        getGoalsForRange(userId, start_date, end_date),
                    ]);

                    const goalsPayload = goalsPayloadOf(
                        forDate(end_date),
                        alcohol,
                    );

                    if (meals.length === 0 && water.length === 0) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `No meals or water logged between ${start_date} and ${end_date}.`,
                                },
                            ],
                            structuredContent: {
                                start_date,
                                end_date,
                                logged_days: 0,
                                days_in_range: daysInRange,
                                drink_unit: alcohol,
                                goals: goalsPayload,
                                averages: totalsPayloadOf(
                                    emptyTotals(),
                                    alcohol,
                                    // Nothing logged, so nothing recorded
                                    // caffeine: null, not a 0 mg average.
                                    false,
                                ),
                                recorded_days: {
                                    fiber_g: 0,
                                    sugar_g: 0,
                                    alcohol_g: alcohol ? 0 : null,
                                    caffeine_mg: 0,
                                },
                                days: [],
                                meals: [],
                            },
                        };
                    }

                    // Group by date (local to user timezone)
                    const byDate = new Map<string, Meal[]>();
                    for (const meal of meals) {
                        const date = dateInTz(meal.logged_at, tz);
                        const existing = byDate.get(date) ?? [];
                        existing.push(meal);
                        byDate.set(date, existing);
                    }
                    const waterByDate = new Map<string, number>();
                    for (const entry of water) {
                        const date = dateInTz(entry.logged_at, tz);
                        waterByDate.set(
                            date,
                            (waterByDate.get(date) ?? 0) + entry.amount_ml,
                        );
                        if (!byDate.has(date)) byDate.set(date, []);
                    }

                    const sections: string[] = [];
                    const days: Array<
                        ReturnType<typeof totalsPayloadOf> & {
                            date: string;
                            meal_count: number;
                        }
                    > = [];
                    const perDay: Array<{
                        meals: Meal[];
                        totals: DailyTotals;
                    }> = [];
                    for (const [date, dateMeals] of [
                        ...byDate.entries(),
                    ].sort()) {
                        const totals = sumMeals(dateMeals);
                        totals.water_ml = waterByDate.get(date) ?? 0;
                        // Which nutrients this day actually recorded, so a
                        // pre-feature day neither prints "Fiber: 0g" nor drags
                        // the range average down towards zero.
                        const present = nutrientPresence(dateMeals);
                        const header = `## ${date} (${dateMeals.length} meal${dateMeals.length === 1 ? "" : "s"})`;
                        const dayGoals = forDate(date);
                        sections.push(
                            `${header}\n${formatProgress(totals, dayGoals, alcohol, present)}`,
                        );
                        days.push({
                            date,
                            meal_count: dateMeals.length,
                            ...totalsPayloadOf(
                                totals,
                                alcohol,
                                present.caffeine_mg,
                            ),
                        });
                        perDay.push({ meals: dateMeals, totals });
                    }

                    // Per-day means, rounded by totalsPayloadOf like every other
                    // payload (water stays whole millilitres there). See
                    // rangeAverages for which denominator each nutrient uses.
                    const { averages: rawAverages, recordedDays } =
                        rangeAverages(perDay);
                    const averages = totalsPayloadOf(
                        rawAverages,
                        alcohol,
                        // A window where no day recorded caffeine has no
                        // caffeine average to report — coveredDailyAverage
                        // returns 0 over 0 days, which is not a figure.
                        recordedDays.caffeine_mg > 0,
                    );

                    // Don't pass a partial average off as a full one. Terse:
                    // only nutrients that were recorded on SOME but not all of
                    // the logged days get a mention (none at all is already
                    // silent, since those lines are suppressed per day).
                    const partial = [
                        recordedDays.fiber_g > 0 &&
                        recordedDays.fiber_g < days.length
                            ? `fiber ${recordedDays.fiber_g}`
                            : null,
                        recordedDays.sugar_g > 0 &&
                        recordedDays.sugar_g < days.length
                            ? `sugar ${recordedDays.sugar_g}`
                            : null,
                        alcohol &&
                        recordedDays.alcohol_g > 0 &&
                        recordedDays.alcohol_g < days.length
                            ? `alcohol ${recordedDays.alcohol_g}`
                            : null,
                        // Unconditional: no opt-in to check, only the data.
                        recordedDays.caffeine_mg > 0 &&
                        recordedDays.caffeine_mg < days.length
                            ? `caffeine ${recordedDays.caffeine_mg}`
                            : null,
                    ].filter((s): s is string => s !== null);
                    const coverageNote = partial.length
                        ? `\n\n(Averaged over the days that record each figure, not all ${days.length}: ${partial.join(", ")}.)`
                        : "";

                    const span = Math.max(
                        0,
                        dateDiffDays(start_date, end_date),
                    );
                    const rangeDates: string[] = [];
                    for (let i = 0; i <= span; i++) {
                        rangeDates.push(shiftLocalDate(start_date, i));
                    }
                    const noGoalsInRange = rangeDates.every(
                        (d) => forDate(d) == null,
                    );
                    const footer =
                        coverageNote +
                        loggedDayAverageNote(days.length, daysInRange) +
                        (noGoalsInRange
                            ? "\n\n(Tip: set daily targets with set_nutrition_goals to see progress percentages.)"
                            : "");

                    return {
                        content: [
                            {
                                type: "text",
                                text: sections.join("\n\n") + footer,
                            },
                        ],
                        structuredContent: {
                            start_date,
                            end_date,
                            logged_days: days.length,
                            days_in_range: daysInRange,
                            drink_unit: alcohol,
                            goals: goalsPayload,
                            averages,
                            recorded_days: {
                                fiber_g: recordedDays.fiber_g,
                                sugar_g: recordedDays.sugar_g,
                                alcohol_g: alcohol
                                    ? recordedDays.alcohol_g
                                    : null,
                                caffeine_mg: recordedDays.caffeine_mg,
                            },
                            days,
                            // Multi-day range → tag each meal with its date.
                            meals: mealBreakdown(meals, tz, alcohol),
                        },
                    };
                },
                analytics,
                { start_date, end_date },
            );
        },
    );
}

export function registerNutritionInsightTools(
    server: McpServer,
    ctx: ToolContext,
) {
    const {
        alcohol,
        requireUser,
        personSchema,
        actorUserId,
        analytics,
        uiMeta,
    } = ctx;
    server.registerTool(
        "get_trends",
        {
            title: "Get Trends",
            description:
                "Rolling 7/14/30-day averages, standard deviation, coefficient of variation, logging streaks, day-of-week breakdowns, and best/worst day for calories and each macro. Pre-aggregated so you can narrate findings to the user without doing arithmetic. Defaults to the last 30 days ending today. Figures are estimates, not medical or dietary advice.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                days: z.coerce
                    .number()
                    .int()
                    .min(2)
                    .max(365)
                    .optional()
                    .describe("Window size in days (default 30, max 365)."),
                end_date: z
                    .string()
                    .optional()
                    .describe("Window end date YYYY-MM-DD (default today)."),
            }),
            outputSchema: z.object({
                end_date: z.string(),
                // Which toggle the widget opens on (nearest of 7/14/30).
                default_range: z.number(),
                drink_unit: DRINK_UNIT_FIELD,
                goals: GOALS_ITEM.nullable(),
                // Up to 30 days of daily series; the widget slices to 7/14/30.
                days: z.array(TRENDS_DAY_ITEM),
            }),
            // Link the tool to its interactive trends UI (MCP Apps).
            ...uiMeta("trends"),
        },
        async ({ days, end_date, user_id }) => {
            return withAnalytics(
                "get_trends",
                async () => {
                    const userId = await actorUserId(user_id, "read");
                    const profile = await getProfile(userId);
                    const tz = timezoneFromProfile(profile) ?? "UTC";
                    const endDate = end_date ?? todayInTz(tz);
                    const windowDays = days ?? 30;
                    // The widget's toggle always offers up to 30 days, so build
                    // at least 30 days of series regardless of the text window.
                    const seriesDays = Math.max(windowDays, 30);
                    const startDate = shiftLocalDate(
                        endDate,
                        -(seriesDays - 1),
                    );
                    const [meals, water, { forDate }] = await Promise.all([
                        getMealsInRange(userId, startDate, endDate, tz),
                        getWaterInRange(userId, startDate, endDate, tz),
                        getGoalsForRange(userId, startDate, endDate),
                    ]);
                    const allBuckets = buildDailyBuckets(
                        meals,
                        water,
                        startDate,
                        endDate,
                        tz,
                    );
                    // Text summary respects the requested window; the widget
                    // gets the last 30 days for its 7/14/30 toggle.
                    const textBuckets = allBuckets.slice(-windowDays);
                    const seriesBuckets = allBuckets.slice(-30);

                    const goalsPayload = goalsPayloadOf(
                        forDate(endDate),
                        alcohol,
                    );

                    return {
                        content: [
                            {
                                type: "text",
                                text: computeTrends(
                                    gateAlcohol(textBuckets, alcohol),
                                    forDate,
                                ),
                            },
                        ],
                        structuredContent: {
                            end_date: endDate,
                            default_range: [7, 14, 30].includes(windowDays)
                                ? windowDays
                                : 30,
                            drink_unit: alcohol,
                            goals: goalsPayload,
                            // Rounded through trendsDayPayloadOf, which nulls
                            // out fiber/sugar/alcohol on days that didn't
                            // record them so the widget's client-side average
                            // (avgOf in trends.html) can skip them instead of
                            // counting a no-data day as a real zero.
                            days: seriesBuckets.map((b) =>
                                trendsDayPayloadOf(b, alcohol),
                            ),
                        },
                    };
                },
                analytics,
                { days: days ?? 30 },
            );
        },
    );

    server.registerTool(
        "get_meal_patterns",
        {
            title: "Get Meal Patterns",
            description:
                "Pre-aggregated behavioural patterns across the logged window: meal-type presence rates, breakfast effect (days with vs without), high-calorie-lunch effect, late-dinner effect, weekday vs weekend, and outlier days. Narrate findings conversationally to the user. Defaults to the last 30 days. Patterns are descriptive estimates, not medical or dietary advice.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                days: z.coerce
                    .number()
                    .int()
                    .min(7)
                    .max(365)
                    .optional()
                    .describe(
                        "Window size in days (default 30, min 7, max 365).",
                    ),
                end_date: z
                    .string()
                    .optional()
                    .describe("Window end date YYYY-MM-DD (default today)."),
            }),
        },
        async ({ days, end_date, user_id }) => {
            return withAnalytics(
                "get_meal_patterns",
                async () => {
                    const userId = await actorUserId(user_id, "read");
                    const tz = await getUserTimezone(userId);
                    const endDate = end_date ?? todayInTz(tz);
                    const windowDays = days ?? 30;
                    const startDate = shiftLocalDate(
                        endDate,
                        -(windowDays - 1),
                    );
                    const [meals, water] = await Promise.all([
                        getMealsInRange(userId, startDate, endDate, tz),
                        getWaterInRange(userId, startDate, endDate, tz),
                    ]);
                    const buckets = buildDailyBuckets(
                        meals,
                        water,
                        startDate,
                        endDate,
                        tz,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: computeMealPatterns(buckets, tz),
                            },
                        ],
                    };
                },
                analytics,
                { days: days ?? 30 },
            );
        },
    );

    server.registerTool(
        "export_all_data",
        {
            title: "Export All Data",
            description:
                "Export EVERY table this server tracks for the user — meals, meal items, water, weight, nutrition goals and profile settings — as a single ZIP archive (meals.csv, meal_items.csv, water.csv, weight.csv, goals.csv, goal_days.csv, profile.csv, plus a README.txt describing the columns and the units they are in) and return a private, time-limited download link (valid 60 minutes). Timestamps use the user's timezone if set, otherwise UTC. Only meals.csv can be read back in; water, weight, goals, goal_days, profile and meal_items are export-only. This is the server's only export path — use it for a full backup, an account takeout, or a request for the meal history alone, in which case tell the user their meals are meals.csv inside the archive. Share the link with the user so they can download their data.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: personSchema({}),
        },
        async (args) => {
            return withAnalytics(
                "export_all_data",
                async () => {
                    const userId = await actorUserId(args.user_id);
                    const { counts, goals, profile, url } = await exportAllData(
                        userId,
                        undefined,
                        ctx.baseUrl,
                    );
                    // No link means the account had nothing at all — not even a
                    // profile row — so there is no archive to hand over.
                    if (!url) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "No data to export yet.",
                                },
                            ],
                        };
                    }
                    // Name every file's row count, zeros included: the archive
                    // always ships every file, so "0 weight entries" is what
                    // tells the user weight.csv is headers-only because they
                    // never logged weight — not because the export lost it.
                    const contents = [
                        `${counts.meals} meal${counts.meals === 1 ? "" : "s"}`,
                        `${counts.water} water ${counts.water === 1 ? "entry" : "entries"}`,
                        `${counts.weight} weight ${counts.weight === 1 ? "entry" : "entries"}`,
                        goals ? "nutrition goals" : "no nutrition goals set",
                        `${counts.goal_days} per-day goal override${counts.goal_days === 1 ? "" : "s"}`,
                        profile ? "profile settings" : "no profile settings",
                    ].join(", ");
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Exported all data to a ZIP archive: ${contents}.\nDownload (link valid for 60 minutes): ${url}`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerResource(
        "weekly-summary",
        "nutrition://weekly-summary",
        {
            title: "Weekly Nutrition Summary",
            description:
                "Rolling 7-day digest: logged-day count, daily averages vs targets, and the best/roughest day of the week. Good to pull at the start of a chat for proactive check-ins.",
            mimeType: "text/plain",
        },
        async (uri) => {
            const userId = requireUser();
            const tz = await getUserTimezone(userId);
            const endDate = todayInTz(tz);
            const startDate = shiftLocalDate(endDate, -6);
            const [meals, water, { forDate }] = await Promise.all([
                getMealsInRange(userId, startDate, endDate, tz),
                getWaterInRange(userId, startDate, endDate, tz),
                getGoalsForRange(userId, startDate, endDate),
            ]);
            const buckets = buildDailyBuckets(
                meals,
                water,
                startDate,
                endDate,
                tz,
            );
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: "text/plain",
                        text: computeWeeklyDigest(
                            gateAlcohol(buckets, alcohol),
                            forDate,
                        ),
                    },
                ],
            };
        },
    );
}
