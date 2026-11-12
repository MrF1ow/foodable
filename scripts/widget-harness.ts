// Local MCP Apps host harness for widget development.
//
//   bun run scripts/widget-harness.ts            # then open http://localhost:8787
//
// Mimics a STRICT host: it validates the ui/initialize request shape, withholds
// the tool result until the app sends ui/notifications/initialized, starts the
// iframe deliberately SHORT so a missing size-changed report shows up as a
// clipped widget, and — unlike anything else we have — answers app-initiated
// tools/call so a widget's server round-trip can be exercised offline.
//
// Query parameters let you reproduce host behaviours that are otherwise only
// observable in production:
//
//   ?serverTools=0      withhold hostCapabilities.serverTools
//   ?tools=0            accept tools/call but never answer (tests timeouts)
//   ?delay=3000         delay every tools/call, standing in for an approval prompt
//   ?maxHeight=600      impose hostContext.containerDimensions.maxHeight
//   ?fail=1             answer tools/call with a JSON-RPC error
//   ?drinkUnit=us       alcohol tracking ON for import-meals (default: off/null)
//   ?theme=dark         host theme at initialize (default: light)
//   ?state=partial      product-score sample: full (default), partial (scored
//                       on 2 of 4) or none (not enough data to score)
//   ?state=stores       restock-nudge sample: costco (default), stores (due
//                       usuals at two stores and one with none), onlist (Eggs
//                       already on the list) or empty
//   ?state=busy         week-plan sample: design (default: three planned days,
//                       two foods missing), busy (two meals on one day),
//                       future (a week starting three days after today)
//                       or empty
//
// Nothing here is served by the production app; scripts/ is dev-only.

import {
    getWidgetHtml,
    harnessNeedsV2,
    WIDGET_TEMPLATES,
    WIDGET_TEMPLATES_V2,
} from "../src/widgets.js";
import { runImport } from "../src/domain/import.js";
import type { MealInput, MealInsertResult } from "../src/db/nutrition.js";

// In-memory stand-in for insertMeal, mirroring its dedup contract, so the harness
// can execute the REAL bulk_import_meals logic instead of returning canned data.
// That is what makes an end-to-end widget run meaningful: the same validation,
// idempotency keys and per-row report a client would get.
const store = new Map<string, MealInput & { id: string }>();
const byId = new Map<string, MealInput & { id: string }>();
let mealSeq = 0;
// Uuid-shaped, because the importer only honours a source_id that could name a
// real meal — "harness-1" ids would make an export re-import look like it
// deduped nothing, which is exactly the bug this flow now guards against.
const harnessMealId = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fakeInsert(input: MealInput): Promise<MealInsertResult> {
    const key = input.idempotency_key!;
    const existing = store.get(key);
    if (existing) return { meal: existing as never, deduplicated: true };
    const meal = { id: harnessMealId(++mealSeq), ...input };
    store.set(key, meal);
    byId.set(meal.id, meal);
    return { meal: meal as never, deduplicated: false };
}

// list_usuals payload for the restock-nudge card: the design's three Costco
// usuals, or the same at two stores plus one without a store, or none due.
function restockUsuals(state: string) {
    const usual = (
        food_id: string,
        name: string,
        product_name: string | null,
        store: [string, string] | null,
        amount: number | null,
        unit: string,
        due: { reason: string; trigger: "schedule" | "low" } | null,
    ) => ({
        food_id,
        name,
        kind: "food",
        product_name,
        store_id: store ? store[0] : null,
        store_name: store ? store[1] : null,
        amount,
        unit,
        schedule: due?.trigger === "schedule" ? "weekly" : null,
        every_weeks: null,
        last_restocked_on: null,
        restock_when_low: due?.trigger === "low",
        low_level: due?.trigger === "low" ? 6 : null,
        paused: false,
        due,
        on_list: false,
    });
    const costco: [string, string] = ["st-costco", "Costco"];
    const tj: [string, string] = ["st-tj", "Trader Joe's"];
    const eggs = usual(
        "food-eggs",
        "Eggs",
        "Vital Farms large",
        costco,
        24,
        "each",
        {
            reason: "2 left, below 6",
            trigger: "low",
        },
    );
    const milk = usual("food-milk", "Milk", "Kirkland 2%", costco, 1, "gal", {
        reason: "weekly, last bought 7 days ago",
        trigger: "schedule",
    });
    const chicken = usual(
        "food-chicken",
        "Chicken thighs",
        "Kirkland boneless",
        costco,
        4,
        "lb",
        {
            reason: "every 2 weeks, last bought 14 days ago",
            trigger: "schedule",
        },
    );
    const rice = usual("food-rice", "Rice", null, costco, 5, "lb", null);
    let usuals = [eggs, milk, chicken, rice];
    if (state === "stores") {
        usuals = [
            eggs,
            usual("food-salmon", "Salmon", null, tj, 1, "lb", {
                reason: "weekly, last bought 7 days ago",
                trigger: "schedule",
            }),
            usual("food-towels", "Paper towels", null, null, null, "roll", {
                reason: "weekly, last bought 7 days ago",
                trigger: "schedule",
            }),
            rice,
        ];
    } else if (state === "onlist") {
        usuals = [{ ...eggs, on_list: true }, milk, chicken, rice];
    } else if (state === "empty") {
        usuals = [rice];
    }
    return {
        restock_weekday: 0,
        restock_weekday_name: "Sunday",
        today: "2026-11-15",
        is_restock_day: true,
        restock_enabled: true,
        usuals,
    };
}

// get_week_plan payload for the week-plan card: the design's week (three
// planned days, two foods missing), a week with two meals on one day, a week
// that starts three days after the household's today ("future"), or none.
// The household's today is 2026-11-14 throughout.
function weekPlanData(state: string) {
    const start = state === "future" ? "2026-11-17" : "2026-11-14";
    const weekdays = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    const dates: [string, string][] = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(`${start}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return [d.toISOString().slice(0, 10), weekdays[d.getUTCDay()]!];
    });
    const [d0, d1, d2] = [dates[0]![0], dates[1]![0], dates[2]![0]];
    const entry = (
        plan_id: string,
        recipe_name: string,
        slot: string,
        kcal: number | null,
    ) => ({
        plan_id,
        recipe_id: "rec-" + plan_id,
        recipe_name,
        slot,
        servings: 2,
        kcal_per_portion: kcal,
    });
    const need = (plan_id: string, recipe_name: string, date: string) => ({
        plan_id,
        recipe_id: "rec-" + plan_id,
        recipe_name,
        date,
        slot: "dinner",
    });
    const planned: Record<string, ReturnType<typeof entry>[]> =
        state === "empty"
            ? {}
            : {
                  [d0]: [
                      entry("plan-1", "Salmon, rice & spinach", "dinner", 640),
                  ],
                  [d1]: [entry("plan-2", "Beef chili", "dinner", 520)],
                  [d2]: [entry("plan-3", "Chicken rice bowls", "dinner", 852)],
              };
    if (state === "busy") {
        planned[d2] = [
            entry("plan-4", "Overnight oats", "breakfast", 410),
            entry("plan-3", "Chicken rice bowls", "dinner", 852),
        ];
    }
    const days = dates.map(([date, weekday]) => ({
        date,
        weekday,
        plans: planned[date] ?? [],
    }));
    return {
        today: "2026-11-14",
        from: start,
        planned_count: days.reduce((n, d) => n + d.plans.length, 0),
        days,
        missing:
            state === "empty"
                ? []
                : [
                      {
                          food_id: "food-spinach",
                          display_name: "Spinach",
                          amount: 200,
                          unit: "g",
                          unknown: false,
                          unmeasured: false,
                          needed_by: [
                              need("plan-1", "Salmon, rice & spinach", d0),
                          ],
                      },
                      {
                          food_id: "food-lemon",
                          display_name: "Lemon",
                          amount: 2,
                          unit: "each",
                          unknown: false,
                          unmeasured: false,
                          needed_by: [
                              need("plan-1", "Salmon, rice & spinach", d0),
                          ],
                      },
                  ],
    };
}

const PORT = Number(process.env.HARNESS_PORT ?? 8787);
const KEYS = [
    ...new Set([
        ...Object.keys(WIDGET_TEMPLATES),
        ...Object.keys(WIDGET_TEMPLATES_V2),
    ]),
];

function indexPage(): string {
    const links = KEYS.map((k) => {
        const v2 = harnessNeedsV2(k);
        const qs = v2 ? "&v2=1" : "";
        return `<li><a href="/host?widget=${encodeURIComponent(k)}${qs}">${k}</a></li>`;
    }).join("");
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Widget harness</title>
<style>
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:32px;max-width:760px}
  code{background:#eee;padding:1px 4px;border-radius:3px}
  li{margin:4px 0}
</style></head>
<body>
  <h1>MCP Apps widget harness</h1>
  <p>Pick a widget. Append query flags to simulate host behaviour:
     <code>?serverTools=0</code>, <code>?tools=0</code>, <code>?delay=3000</code>,
     <code>?maxHeight=600</code>, <code>?fail=1</code>, <code>?drinkUnit=us</code>,
     <code>?v2=1</code> (the v2 assembly), <code>?theme=dark</code> (host theme),
     <code>?state=full|partial|none</code> (product-score sample),
     <code>?state=design|busy|future|empty</code> (week-plan sample).</p>
  <ul>${links}</ul>
</body></html>`;
}

function hostPage(widget: string, params: URLSearchParams): string {
    const serverTools = params.get("serverTools") !== "0";
    const answerTools = params.get("tools") !== "0";
    const delay = Number(params.get("delay") ?? 0);
    const maxHeight = params.get("maxHeight");
    const failCalls = params.get("fail") === "1";
    // ?v2=1 frames the widget's v2 assembly (getWidgetHtml(key, { v2: true })).
    const v2 = params.get("v2") === "1" || harnessNeedsV2(widget);
    // The alcohol opt-in, as every tool that touches alcohol sends it:
    // "us"/"uk" when the user tracks alcohol, null when they do not. Default
    // null, because that is the default account state and the state the
    // importer must never leak in.
    //
    // The macro widgets need it too, and for them null means something the
    // importer never has to model: their fixtures below DO carry alcohol
    // figures, so passing null would say "tracking off" and hide the row
    // outright. They take `macroDrinkUnit`, which is the flag when set and
    // "us" otherwise — the server's own default for a tracking user with no
    // saved preference. `?drinkUnit=uk` is therefore the only way to see the
    // "1.6 UK units" gloss anywhere.
    const drinkUnitParam = params.get("drinkUnit");
    const drinkUnit =
        drinkUnitParam === "us" || drinkUnitParam === "uk"
            ? drinkUnitParam
            : null;
    const macroDrinkUnit = drinkUnit ?? "us";

    // Per-widget canned tool results. One shared fixture does NOT work: each
    // widget's coerce() checks for its own shape, so a payload shaped for
    // goal-progress leaves trends stuck on "Loading…" — which looks exactly like
    // a broken handshake. Keep these in step with each template's SAMPLE.
    const day = (d: string, kcal: number) => ({
        date: d,
        calories: kcal,
        protein_g: Math.round(kcal * 0.07),
        carbs_g: Math.round(kcal * 0.11),
        fat_g: Math.round(kcal * 0.03),
        fiber_g: Math.round(kcal * 0.013 * 10) / 10,
        sugar_g: Math.round(kcal * 0.028 * 10) / 10,
        // Alcohol tracking ON in these fixtures except where noted; 0 is a
        // tracked alcohol-free day, null (see "meal-logged") is tracking off.
        alcohol_g: kcal > 2100 ? 13.9 : 0,
        // Caffeine on most days but not all. null is "nothing recorded that
        // day" — the trends widget must average over the days that carry it,
        // and a 0 here would be a claim the user never made.
        caffeine_mg: kcal > 1900 ? 165 : null,
        water_ml: 1800,
    });
    const days = [
        day("2026-07-09", 1980),
        day("2026-07-10", 2210),
        day("2026-07-11", 1875),
        day("2026-07-12", 2340),
        day("2026-07-13", 2050),
        day("2026-07-14", 1920),
        day("2026-07-15", 2160),
    ];
    const goals = {
        calories: 2200,
        protein_g: 160,
        carbs_g: 220,
        fat_g: 70,
        fiber_g: 30,
        sugar_g: 45,
        alcohol_g: 20,
        caffeine_mg: 400,
        water_ml: 2500,
    };
    const totals = {
        calories: 1850,
        protein_g: 120,
        carbs_g: 190,
        fat_g: 62,
        fiber_g: 24.6,
        // Over its ceiling, so the sub-row inside the carbs disclosure flags it.
        sugar_g: 61.3,
        alcohol_g: 27.7,
        // Over its ceiling too, so the stat line flags it.
        caffeine_mg: 470,
        water_ml: 1500,
    };
    // Per-meal breakdown rows: what makes the panel's tiles tappable.
    const meals = [
        {
            description: "Overnight oats with berries",
            meal_type: "breakfast",
            date: null,
            calories: 420,
            protein_g: 18,
            carbs_g: 62,
            fat_g: 12,
            fiber_g: 9.4,
            sugar_g: 24.6,
            alcohol_g: 0,
            caffeine_mg: null,
        },
        {
            description: "Grilled chicken & rice bowl",
            meal_type: "lunch",
            date: null,
            calories: 650,
            protein_g: 52,
            carbs_g: 78,
            fat_g: 16,
            fiber_g: 6.2,
            sugar_g: 9.4,
            alcohol_g: 0,
            caffeine_mg: null,
        },
        {
            description: "Salmon with quinoa & veg",
            meal_type: "dinner",
            date: null,
            calories: 780,
            protein_g: 56,
            carbs_g: 77,
            fat_g: 32,
            fiber_g: 7.9,
            sugar_g: 14.7,
            alcohol_g: 27.7,
            caffeine_mg: null,
        },
        {
            description: "Double espresso",
            meal_type: "snack",
            date: null,
            calories: 10,
            protein_g: 0,
            carbs_g: 1,
            fat_g: 0,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: 0,
            caffeine_mg: 470,
        },
    ];
    // Same rows with alcohol tracking OFF: null, not 0, everywhere.
    const mealsNoAlcohol = meals.map((m) => ({ ...m, alcohol_g: null }));

    // The rows list_grocery_lines and get_fridge send, minus the optional bits.
    const groceryLine = (
        id: string,
        name: string,
        amount: number,
        unit: string,
        over: Record<string, unknown> = {},
    ) => ({
        id,
        store_id: "st-1",
        section_id: "sec-1",
        display_name: name,
        amount,
        unit,
        checked: false,
        source: "manual",
        source_fridge_item_id: null,
        note: null,
        already_have: null,
        store: "Costco",
        product_name: null,
        usual: false,
        product: null,
        notices: [],
        ...over,
    });
    const fridgeItem = (
        id: string,
        location: string,
        name: string,
        amount: number,
        unit: string,
        expiresOn: string | null,
        daysLeft: number | null,
    ) => ({
        id,
        location_id: "loc-1",
        location,
        kind: "food",
        display_name: name,
        amount,
        unit,
        expires_on: expiresOn,
        days_left: daysLeft,
        notices: [],
    });

    const RESULTS: Record<string, unknown> = {
        "nutrition-summary": {
            start_date: "2026-07-09",
            end_date: "2026-07-15",
            logged_days: days.length,
            // 2026-07-09 → 2026-07-15 is 7 calendar days and all 7 are logged,
            // so this previews the no-gap caption. The gappy branch (where the
            // header reads "15 of 30 days logged") is pinned by
            // public/widgets/summary-caption.test.ts; edit both dates together
            // if you want to eyeball it here.
            days_in_range: days.length,
            drink_unit: macroDrinkUnit,
            goals,
            averages: {
                calories: 2076,
                protein_g: 145,
                carbs_g: 228,
                fat_g: 62,
                fiber_g: 27.4,
                sugar_g: 58.1,
                alcohol_g: 7.9,
                caffeine_mg: 165,
                water_ml: 1800,
            },
            days,
            meals: meals.map((m, i) => ({ ...m, date: days[i]!.date })),
        },
        "goal-progress": {
            date: "2026-07-15",
            meal_count: 4,
            water_entries: 6,
            drink_unit: macroDrinkUnit,
            goals,
            totals,
            has_goals: true,
            // Deliberately empty, so one macro widget covers the strip's
            // static path: with no per-meal rows behind them, no tile is a
            // button, the "tap a metric" hint is absent and every cell reads
            // as the plain figure it always was. The interactive path is
            // meal-logged and nutrition-summary below, which carry meals.
            meals: [],
        },
        "meal-logged": {
            action: "logged",
            date: "2026-07-15",
            logged_meal: {
                description: "Grilled chicken salad",
                meal_type: "lunch",
                calories: 520,
                protein_g: 42,
                carbs_g: 28,
                fat_g: 22,
                fiber_g: 7.4,
                sugar_g: 6.1,
                alcohol_g: null,
                caffeine_mg: null,
            },
            has_goals: true,
            // Alcohol tracking OFF for this one, so the panel must show no
            // alcohol stat line at all (null, not 0) — while the caffeine line
            // stays, which is the point: caffeine has no opt-in flag, only the
            // data-driven null.
            drink_unit: null,
            goals: { ...goals, alcohol_g: null },
            totals: { ...totals, alcohol_g: null },
            meals: mealsNoAlcohol,
        },
        trends: { range_days: 7, days, goals, drink_unit: macroDrinkUnit },
        // start_meal_import's payload. Without it the importer would fall back
        // to its built-in defaults and the alcohol gate would never be
        // exercised here — which is exactly how the leak shipped.
        "import-meals": {
            tz: "Europe/Kyiv",
            tz_configured: true,
            today: "2026-07-15",
            max_rows_per_call: 50,
            import_tool_name: "bulk_import_meals",
            known_source_apps: [
                "myfitnesspal",
                "cronometer",
                "loseit",
                "macrofactor",
            ],
            widgets_enabled: true,
            drink_unit: drinkUnit,
            user_id: "u1",
        },
        "weight-trends": {
            range_days: 7,
            unit: "kg",
            days: days.map((d, i) => ({
                date: d.date,
                weight_kg: 82.4 - i * 0.1,
                weight: 82.4 - i * 0.1,
            })),
        },
        attention: {
            count: 5,
            notices: [
                {
                    code: "fridge.expiring",
                    severity: "warn",
                    subject: {
                        kind: "fridge_item",
                        id: "fi-salmon",
                        recipe_id: null,
                    },
                    related: [],
                    message: "Salmon 1 lb expires tomorrow",
                    action: null,
                    title: "Salmon",
                    detail: "tomorrow",
                    detail_tone: "over",
                    group_key: "expiring",
                    group_label: "Expiring",
                    dot_tone: "over",
                    can_dismiss: true,
                    dismiss_label: "Dismiss",
                    dismiss: {
                        code: "fridge.expiring",
                        subject_kind: "fridge_item",
                        subject_id: "fi-salmon",
                        related_id: null,
                    },
                },
                {
                    code: "fridge.expiring",
                    severity: "info",
                    subject: {
                        kind: "fridge_item",
                        id: "fi-spinach",
                        recipe_id: null,
                    },
                    related: [],
                    message: "Baby spinach ½ bag expires in 2 days",
                    action: null,
                    title: "Baby spinach",
                    detail: "2 days",
                    detail_tone: "warn",
                    group_key: "expiring",
                    group_label: "Expiring",
                    dot_tone: "warn",
                    can_dismiss: true,
                    dismiss_label: "Dismiss",
                    dismiss: {
                        code: "fridge.expiring",
                        subject_kind: "fridge_item",
                        subject_id: "fi-spinach",
                        related_id: null,
                    },
                },
                {
                    code: "grocery.restocked",
                    severity: "info",
                    subject: {
                        kind: "grocery_line",
                        id: "gl-eggs",
                        recipe_id: null,
                    },
                    related: [],
                    message: "Added because Eggs expires Friday",
                    action: null,
                    title: "Eggs",
                    detail: "Friday",
                    detail_tone: null,
                    group_key: "running_low",
                    group_label: "Running low",
                    dot_tone: "warn",
                    can_dismiss: true,
                    dismiss_label: "Dismiss",
                    dismiss: {
                        code: "grocery.restocked",
                        subject_kind: "grocery_line",
                        subject_id: "gl-eggs",
                        related_id: null,
                    },
                },
                {
                    code: "recipe.no_nutrition",
                    severity: "warn",
                    subject: {
                        kind: "recipe_ingredient",
                        id: "ing-lemon",
                        recipe_id: "rec-salmon",
                    },
                    related: [],
                    message:
                        "Lemon: no nutrition — add it, or pick a usual product",
                    action: { label: "Pick usual product" },
                    title: "Lemon",
                    detail: "Sat · salmon",
                    detail_tone: null,
                    group_key: "recipe_gaps",
                    group_label: "Missing for planned meals",
                    dot_tone: "warn",
                    can_dismiss: false,
                    dismiss_label: "Dismiss",
                    dismiss: null,
                },
                {
                    code: "recipe.no_food",
                    severity: "warn",
                    subject: {
                        kind: "recipe_ingredient",
                        id: "ing-beans",
                        recipe_id: "rec-chili",
                    },
                    related: [],
                    message: "Kidney beans: not linked to a food",
                    action: null,
                    title: "Kidney beans",
                    detail: "Sun · chili",
                    detail_tone: null,
                    group_key: "recipe_gaps",
                    group_label: "Missing for planned meals",
                    dot_tone: "warn",
                    can_dismiss: false,
                    dismiss_label: "Dismiss",
                    dismiss: null,
                },
            ],
        },
        // list_grocery_lines: two stores, usuals, a ticked line, a note.
        "grocery-list": {
            locale: "en",
            stores: [
                {
                    id: "st-1",
                    name: "Costco",
                    sections: [
                        {
                            id: "sec-dairy",
                            name: "Dairy & eggs",
                            lines: [
                                groceryLine("ln-1", "Milk", 1, "gal", {
                                    product_name: "Kirkland 2% milk",
                                    usual: true,
                                }),
                                groceryLine("ln-2", "Eggs", 24, "each", {
                                    product_name: "Vital Farms large eggs",
                                    usual: true,
                                }),
                            ],
                        },
                        {
                            id: "sec-pantry",
                            name: "Pantry",
                            lines: [
                                groceryLine("ln-3", "Jasmine rice", 5, "lb", {
                                    already_have:
                                        "already have: have 1 lb, need 4 lb",
                                }),
                                groceryLine(
                                    "ln-4",
                                    "Ranch dressing",
                                    1,
                                    "bottle",
                                    {
                                        product_name: "California Olive Ranch",
                                        usual: true,
                                        checked: true,
                                    },
                                ),
                            ],
                        },
                    ],
                },
                {
                    id: "st-2",
                    name: "Trader Joe's",
                    sections: [
                        {
                            id: "sec-fish",
                            name: "Fish",
                            lines: [
                                groceryLine("ln-5", "Salmon", 1, "lb", {
                                    note: "skin on",
                                    store: "Trader Joe's",
                                }),
                            ],
                        },
                    ],
                },
            ],
        },
        // get_fridge: today is 2026-07-15. Three tiles, a long list, a freezer.
        fridge: {
            locale: "en",
            locations: [
                {
                    id: "loc-1",
                    name: "Fridge",
                    sort_order: 0,
                    items: [
                        fridgeItem(
                            "it-1",
                            "Fridge",
                            "Eggs",
                            9,
                            "each",
                            "2026-07-22",
                            7,
                        ),
                        fridgeItem(
                            "it-2",
                            "Fridge",
                            "Chicken thighs",
                            0.5,
                            "lb",
                            "2026-07-20",
                            5,
                        ),
                        fridgeItem(
                            "it-3",
                            "Fridge",
                            "Milk 2%",
                            0.5,
                            "gal",
                            "2026-07-19",
                            4,
                        ),
                        fridgeItem(
                            "it-4",
                            "Fridge",
                            "Salmon",
                            1,
                            "lb",
                            "2026-07-16",
                            1,
                        ),
                        fridgeItem(
                            "it-5",
                            "Fridge",
                            "Spinach",
                            1,
                            "bag",
                            "2026-07-17",
                            2,
                        ),
                        fridgeItem(
                            "it-6",
                            "Fridge",
                            "Cooked rice",
                            2,
                            "cup",
                            "2026-07-18",
                            3,
                        ),
                        fridgeItem(
                            "it-7",
                            "Fridge",
                            "Butter",
                            1,
                            "lb",
                            null,
                            null,
                        ),
                    ],
                },
                {
                    id: "loc-2",
                    name: "Freezer",
                    sort_order: 1,
                    items: [
                        fridgeItem(
                            "it-8",
                            "Freezer",
                            "Peas",
                            1,
                            "bag",
                            "2027-03-01",
                            229,
                        ),
                    ],
                },
                { id: "loc-3", name: "Pantry", sort_order: 2, items: [] },
            ],
        },
        // list_expiring: urgent, soon, later, and an item no recipe uses.
        "use-soon": {
            items: [
                {
                    id: "ex-1",
                    display_name: "Salmon",
                    amount: 1,
                    unit: "lb",
                    expires_on: "2026-07-16",
                    location: "Fridge",
                    days_left: 1,
                    recipe: { id: "rec-1", name: "Salmon, rice & spinach" },
                },
                {
                    id: "ex-2",
                    display_name: "Baby spinach",
                    amount: 0.5,
                    unit: "bag",
                    expires_on: "2026-07-17",
                    location: "Fridge",
                    days_left: 2,
                    recipe: { id: "rec-1", name: "Salmon, rice & spinach" },
                },
                {
                    id: "ex-3",
                    display_name: "Cooked rice",
                    amount: 3,
                    unit: "cup",
                    expires_on: "2026-07-18",
                    location: "Fridge",
                    days_left: 3,
                    recipe: { id: "rec-1", name: "Salmon, rice & spinach" },
                },
                {
                    id: "ex-4",
                    display_name: "Greek yogurt",
                    amount: 12,
                    unit: "oz",
                    expires_on: "2026-07-20",
                    location: "Fridge",
                    days_left: 5,
                    recipe: null,
                },
            ],
            featured: {
                id: "rec-1",
                name: "Salmon, rice & spinach",
                uses: 3,
                minutes: 25,
                calories: 640,
                protein_g: 48,
                carbs_g: 62,
                fat_g: 22,
            },
        },
        // list_usuals: two due at Costco (one low, one on a schedule), one
        // not due (never a row). Replaced below for ?state=stores|empty.
        "restock-nudge": restockUsuals("costco"),
        // get_week_plan: replaced below for ?state=busy|empty.
        "week-plan": weekPlanData("design"),
        // get_recipe: one ingredient the fridge cannot cover, so Cook has a
        // shortfall to show.
        "recipe-card": {
            id: "rec-1",
            name: "Salmon, rice & spinach",
            yield_portions: 2,
            suggested_meal_type: "dinner",
            creator_id: "u-1",
            instructions: null,
            source_url: "https://www.seriouseats.com/salmon-rice",
            tags: [],
            notes: null,
            prep_minutes: 10,
            cook_minutes: 15,
            verification: "verified",
            steps: [],
            portion_count: 1,
            macros_per_portion: {
                calories: 640,
                protein_g: 48,
                carbs_g: 62,
                fat_g: 22,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                incomplete: false,
            },
            notices: [],
            ingredients: [
                ["ri-1", "Salmon fillet", 1, "lb", false],
                ["ri-2", "Jasmine rice", 1, "cup", false],
                ["ri-3", "Baby spinach", 0.5, "bag", false],
                ["ri-4", "Lemon", 1, "each", true],
            ].map(([id, name, amount, unit, missing]) => ({
                id,
                display_name: name,
                amount,
                unit,
                note: null,
                food_id: "food-" + id,
                per_portion_amount: null,
                person_amount: null,
                product: null,
                missing,
            })),
            problems: [],
            import: null,
            cook_preview: {
                total_portions: 1,
                lines: [],
                shortfalls: [
                    {
                        food_id: "food-ri-4",
                        display_name: "Lemon",
                        amount: 1,
                        unit: "each",
                        unknown_factor: false,
                    },
                ],
                unmeasured: [],
                cookable: false,
            },
        },
    };
    // rate_product, in the three states the card draws: every part scored,
    // two of four scored, and too little data to score at all.
    // Wire shape: the notices as the tool sends them, then the verdict and
    // the one-line reason the app's Product screen words.
    const scoreMembers = [
        {
            user_id: "u-1",
            name: "Ethan",
            notices: [],
            verdict: "good",
            reason: "No issues found for this product.",
        },
        {
            user_id: "u-2",
            name: "Sam",
            notices: [
                {
                    code: "food.product_allergen",
                    severity: "block",
                    message: "Contains milk — Sam.",
                },
            ],
            verdict: "avoid",
            reason: "Contains Milk · listed as an allergy",
        },
        {
            user_id: "u-3",
            name: "Jordan",
            notices: [
                {
                    code: "food.product_trace",
                    severity: "warn",
                    message: "May contain traces of nuts — Jordan.",
                },
            ],
            verdict: "careful",
            reason: "May contain traces of nuts",
        },
    ];
    const scoreBase = {
        found: true,
        product: {
            food_id: "f-1",
            barcode: "5201054017463",
            name: "Fage Total 2% Greek yogurt",
            brand: "Fage",
        },
        preset: "balanced",
        preset_label: "Balanced",
        checks: scoreMembers,
    };
    const scoreLabels: Record<string, string> = {
        nutrition: "Nutri-Score",
        processing: "Processing",
        additives: "Additives",
        environment: "Green-Score",
    };
    const scorePart = (
        part: string,
        value: number | null,
        weight: number,
        source: string | null,
        display: string | null,
        status: string | null,
    ) => ({
        part,
        value,
        weight,
        known: value != null,
        source,
        label: scoreLabels[part],
        display,
        status,
    });
    const SCORE_STATES: Record<string, unknown> = {
        full: {
            ...scoreBase,
            score: 82,
            label: "good",
            breakdown: [
                scorePart("nutrition", 100, 0.4, "nutriscore a", "A", "good"),
                scorePart(
                    "processing",
                    100,
                    0.3,
                    "nova 1",
                    "NOVA 1 · unprocessed",
                    "good",
                ),
                scorePart(
                    "additives",
                    100,
                    0.2,
                    "no additives listed",
                    "None",
                    "good",
                ),
                scorePart("environment", 50, 0.1, "ecoscore c", "C", "warn"),
            ],
            parts_used: 4,
            parts_total: 4,
            missing: [],
            info_rows: [
                { kind: "sugars", per_100g: 4, level: "low", status: "good" },
                {
                    kind: "saturated-fat",
                    per_100g: 2,
                    level: "moderate",
                    status: "warn",
                },
            ],
        },
        partial: {
            ...scoreBase,
            product: {
                ...scoreBase.product,
                name: "Crunchy peanut butter",
                brand: "Skippy",
                barcode: null,
            },
            score: 48,
            label: "middling",
            breakdown: [
                scorePart("nutrition", 50, 0.6, "nutriscore c", "C", "warn"),
                scorePart(
                    "processing",
                    33,
                    0.4,
                    "nova 3",
                    "NOVA 3 · processed",
                    "over",
                ),
                scorePart("additives", null, 0, null, null, null),
                scorePart("environment", null, 0, null, null, null),
            ],
            parts_used: 2,
            parts_total: 4,
            missing: ["additives", "environment"],
            info_rows: [
                {
                    kind: "sugars",
                    per_100g: 9,
                    level: "moderate",
                    status: "warn",
                },
                {
                    kind: "saturated-fat",
                    per_100g: 9,
                    level: "high",
                    status: "over",
                },
            ],
        },
        none: {
            ...scoreBase,
            product: {
                ...scoreBase.product,
                name: "Homemade granola",
                brand: null,
                barcode: null,
            },
            score: null,
            label: "not_enough_data",
            breakdown: [
                scorePart("nutrition", null, 0, null, null, null),
                scorePart("processing", null, 0, null, null, null),
                scorePart("additives", null, 0, null, null, null),
                scorePart("environment", null, 0, null, null, null),
            ],
            parts_used: 0,
            parts_total: 4,
            missing: ["nutrition", "processing", "additives", "environment"],
            info_rows: [],
        },
    };
    RESULTS["product-score"] =
        SCORE_STATES[params.get("state") ?? "full"] ?? SCORE_STATES.full;
    RESULTS["restock-nudge"] = restockUsuals(params.get("state") ?? "costco");
    RESULTS["week-plan"] = weekPlanData(params.get("state") ?? "design");
    // Probe and gallery paint their own UI; anything non-null will do.
    const toolResult = RESULTS[widget] ?? { probe: true };

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>host: ${widget}</title>
<style>
  body{font:13px/1.5 -apple-system,system-ui,sans-serif;margin:16px${params.get("theme") === "dark" ? ";background:#0d0f0e;color:#ccc" : ""}}
  #frame{box-sizing:border-box;width:100%;height:130px;border:2px solid #888;border-radius:8px;transition:height .15s}
  #log{margin-top:12px;padding:8px;background:#111;color:#0f0;border-radius:6px;
       font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;max-height:300px;overflow:auto}
  .cfg{color:#666}
</style></head>
<body>
  <strong>${widget}</strong>
  <span class="cfg">serverTools=${serverTools} answerTools=${answerTools} delay=${delay}ms${maxHeight ? " maxHeight=" + maxHeight : ""}${failCalls ? " fail=1" : ""} drinkUnit=${drinkUnit ?? "null (tracking off)"}</span>
  <div style="margin-top:8px"><iframe id="frame" sandbox="allow-scripts" src="/widget/${encodeURIComponent(widget)}${v2 ? "?v2=1" : ""}"></iframe></div>
  <div style="margin-top:8px">
    <button onclick="hostRequest(1)">host req id=1</button>
    <button onclick="hostRequest(2)">host req id=2</button>
    <button onclick="hostNotify()">host-context-changed (dark)</button>
  </div>
  <div id="log">host ready — iframe starts at 130px and grows only on size-changed</div>
<script>
const CFG = {
  serverTools: ${serverTools},
  answerTools: ${answerTools},
  delay: ${delay},
  maxHeight: ${maxHeight ? Number(maxHeight) : "null"},
  fail: ${failCalls},
  theme: ${JSON.stringify(params.get("theme") === "dark" ? "dark" : "light")},
};
const TOOL_RESULT = ${JSON.stringify(toolResult)};
// What log_recipe_portion answers: the meal-progress payload.
const MEAL_LOGGED = ${JSON.stringify(RESULTS["meal-logged"])};
// What get_week_plan answers after unplan_recipe calls: the card's week minus
// the plans removed so far, with the missing lines only those plans needed
// dropped (the server works that out; the card does not).
const GONE = new Set();
function weekNow() {
  const w = TOOL_RESULT;
  if (!w || !Array.isArray(w.days)) return w;
  const days = w.days.map((d) => Object.assign({}, d, { plans: d.plans.filter((p) => !GONE.has(p.plan_id)) }));
  return Object.assign({}, w, {
    days,
    planned_count: days.reduce((n, d) => n + d.plans.length, 0),
    missing: w.missing.filter((m) => m.needed_by.some((n) => !GONE.has(n.plan_id))),
  });
}
const frame = document.getElementById("frame");
const logEl = document.getElementById("log");
const log = (m) => { logEl.textContent += "\\n" + m; logEl.scrollTop = logEl.scrollHeight; };
let initialized = false;

function send(msg) { frame.contentWindow.postMessage(msg, "*"); }

// A host->app REQUEST. The spec's ui/resource-teardown example uses id 1, which
// collides with the app's own first request unless the app namespaces its ids.
// The app must answer, and must NOT treat this as a response.
function hostRequest(id) {
  log("-> host REQUEST ui/resource-teardown (id " + id + ")");
  send({ jsonrpc: "2.0", id, method: "ui/resource-teardown", params: { reason: "test" } });
}
function hostNotify() {
  log("-> host-context-changed theme=dark");
  send({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed",
         params: { hostContext: { theme: "dark" } } });
}

window.addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow) return;   // what bridge.js should also do
  const d = e.data;
  if (!d || typeof d !== "object") return;

  // ---- ui/initialize (strict: validate the request shape) ----
  if (d.method === "ui/initialize") {
    const p = d.params || {};
    const ok = p.protocolVersion && p.appInfo && p.appCapabilities;
    log("<- ui/initialize " + JSON.stringify(p.appInfo || null));
    if (!ok) {
      log("!! REJECTED: needs protocolVersion + appInfo + appCapabilities " +
          "(clientInfo/capabilities is the MCP-core shape and is wrong here)");
      return;
    }
    const hostContext = { theme: CFG.theme };
    if (CFG.maxHeight) hostContext.containerDimensions = { maxHeight: CFG.maxHeight };
    const hostCapabilities = {};
    if (CFG.serverTools) hostCapabilities.serverTools = {};
    send({ jsonrpc: "2.0", id: d.id, result: {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "local-harness", version: "1.0.0" },
      hostCapabilities, hostContext,
    }});
    return;
  }

  // ---- required before the host will deliver data ----
  if (d.method === "ui/notifications/initialized") {
    initialized = true;
    log("<- initialized; delivering tool-result");
    send({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
           params: { structuredContent: TOOL_RESULT } });
    return;
  }

  // ---- height reporting ----
  if (d.method === "ui/notifications/size-changed") {
    const h = d.params && d.params.height;
    const capped = CFG.maxHeight ? Math.min(h, CFG.maxHeight) : h;
    // box-sizing is border-box (the right edge stays unclipped), so the frame
    // is the reported height plus its own vertical border: the iframe's
    // content then gets exactly the height it asked for, with no scrollbar.
    const border = frame.offsetHeight - frame.clientHeight;
    frame.style.height = (capped + border) + "px";
    log("<- size-changed height=" + h + (capped !== h ? " (capped to " + capped + ")" : ""));
    return;
  }

  // ---- ui/update-model-context (a REQUEST, params.content ContentBlocks) ----
  if (d.method === "ui/update-model-context") {
    const p = d.params || {};
    const shapeOk = Array.isArray(p.content) || !!p.structuredContent;
    log("<- ui/update-model-context id=" + d.id + " shapeOk=" + shapeOk +
        " " + JSON.stringify(p).slice(0, 120));
    if (d.id != null) send({ jsonrpc: "2.0", id: d.id, result: {} });
    return;
  }

  // ---- app-initiated tools/call ----
  if (d.method === "tools/call") {
    const name = d.params && d.params.name;
    log("<- tools/call " + name + " (id " + d.id + ") args=" + JSON.stringify(d.params.arguments || {}));
    if (!initialized) log("!! app called a tool before the handshake finished");
    if (!CFG.answerTools) { log("   (answerTools=0: dropping, app should time out)"); return; }
    setTimeout(async () => {
      if (CFG.fail) {
        send({ jsonrpc: "2.0", id: d.id, error: { code: -32603, message: "harness: simulated failure" } });
        log("-> error for id " + d.id);
        return;
      }
      if (name === "dismiss_notice") {
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Notice dismissed." }],
          structuredContent: { dismissed: true },
        }});
        log("-> dismiss_notice dismissed=true for id " + d.id);
        return;
      }
      // Canned, schema-valid answers; the arguments are in the log above.
      if (name === "cook_recipe") {
        const a = d.params.arguments || {};
        const n = Number(a.total_portions) || 1;
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Cooked " + n + " portion" + (n === 1 ? "" : "s") + "." }],
          structuredContent: {
            total_portions: n,
            shortfalls: [{ food_id: "food-ri-4", display_name: "Lemon", amount: n, unit: "each" }],
            meal_ids: [],
            unmeasured: [],
          },
        }});
        log("-> cook_recipe total_portions=" + n + " for id " + d.id);
        return;
      }
      if (name === "log_recipe_portion") {
        const a = d.params.arguments || {};
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Meal logged." }],
          structuredContent: Object.assign({}, MEAL_LOGGED, { status: "ok", similar_foods: [] }),
        }});
        log("-> log_recipe_portion portions=" + a.portions + " meal_type=" + a.meal_type + " for id " + d.id);
        return;
      }
      if (name === "add_grocery_line") {
        const a = d.params.arguments || {};
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Added " + a.food_id + "." }],
          structuredContent: {
            status: "ok", similar_foods: [], id: "ln-" + a.food_id,
            display_name: a.food_id, already_have: null,
            store_id: a.store_id || "st-costco", amount: a.amount == null ? 1 : a.amount,
            unit: a.unit || "each", notices: [],
          },
        }});
        log("-> add_grocery_line food_id=" + a.food_id + " for id " + d.id);
        return;
      }
      if (name === "get_week_plan") {
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Week plan." }],
          structuredContent: weekNow(),
        }});
        log("-> tools/call get_week_plan args=" + JSON.stringify(d.params.arguments || {}) + " for id " + d.id);
        return;
      }
      if (name === "unplan_recipe") {
        const a = d.params.arguments || {};
        GONE.add(a.plan_id);
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Removed " + a.plan_id + " from the plan." }],
          structuredContent: { removed: true, plan_id: a.plan_id },
        }});
        log("-> tools/call unplan_recipe plan_id=" + a.plan_id + " for id " + d.id);
        return;
      }
      if (name === "add_plan_missing_to_groceries") {
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: "Added 1 to the grocery list: Spinach." }],
          structuredContent: {
            added: [{ line_id: "ln-spinach", food_id: "food-spinach", display_name: "Spinach",
              amount: 200, unit: "g", store_id: "st-costco", note: null }],
            on_list: [{ food_id: "food-lemon", display_name: "Lemon", existing_line_id: "ln-lemon" }],
            unknown: [], skipped: [],
          },
        }});
        log("-> tools/call add_plan_missing_to_groceries args=" + JSON.stringify(d.params.arguments || {}) + " for id " + d.id);
        return;
      }
      if (name === "check_grocery_line") {
        const a = d.params.arguments || {};
        send({ jsonrpc: "2.0", id: d.id, result: {
          content: [{ type: "text", text: (a.checked === false ? "Unchecked " : "Checked ") + a.id + ". Fridge unchanged." }],
        }});
        log("-> check_grocery_line id=" + a.id + " checked=" + a.checked + " for id " + d.id);
        return;
      }
      // bulk_import_meals runs for real, server-side, against an in-memory store.
      if (name === "bulk_import_meals") {
        // What the widget actually decided to send, before the server sees it:
        // the field list settles arguments like "is alcohol still written when
        // tracking is off?" by inspection rather than by belief.
        const rows = (d.params.arguments && d.params.arguments.meals) || [];
        const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        log("   " + rows.length + " rows, fields: " + fields.join(",") +
            " | alcohol_g on " + rows.filter((r) => r.alcohol_g != null).length + " row(s)");
        try {
          const r = await fetch("/tool/bulk_import_meals", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(d.params.arguments || {}),
          });
          const sc = await r.json();
          send({ jsonrpc: "2.0", id: d.id, result: {
            content: [{ type: "text", text: "see structuredContent" }],
            structuredContent: sc,
          }});
          log("-> real import result id " + d.id + ": status=" + sc.status +
              " created=" + sc.summary.created + " dedup=" + sc.summary.deduplicated +
              " failed=" + sc.summary.failed + (sc.dry_run ? " (dry run)" : ""));
        } catch (e) {
          send({ jsonrpc: "2.0", id: d.id, error: { code: -32603, message: String(e) } });
          log("-> error for id " + d.id + ": " + e);
        }
        return;
      }
      send({ jsonrpc: "2.0", id: d.id, result: {
        content: [{ type: "text", text: "harness canned result for " + name }],
        structuredContent: TOOL_RESULT,
      }});
      log("-> result for id " + d.id + (CFG.delay ? " after " + CFG.delay + "ms" : ""));
    }, CFG.delay);
    return;
  }

  // App answering one of OUR requests.
  if (d.id != null && d.method === undefined) {
    log("<- app answered id " + d.id + " " + JSON.stringify(d.result || d.error));
    return;
  }
  log("<- (unhandled) " + JSON.stringify(d).slice(0, 160));
});
</script>
</body></html>`;
}

Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/") {
            return new Response(indexPage(), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (url.pathname === "/host") {
            const widget = url.searchParams.get("widget") ?? KEYS[0]!;
            if (!KEYS.includes(widget)) {
                return new Response(`unknown widget: ${widget}`, {
                    status: 404,
                });
            }
            return new Response(hostPage(widget, url.searchParams), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (
            url.pathname === "/tool/bulk_import_meals" &&
            req.method === "POST"
        ) {
            const args = (await req.json()) as Parameters<typeof runImport>[0];
            const result = await runImport(args, {
                userId: "harness-user",
                tz: "Europe/Kyiv",
                tzConfigured: true,
                nowMs: Date.now(),
                insert: fakeInsert,
                async existingKeys(keys) {
                    return new Set(keys.filter((k) => store.has(k)));
                },
                async existingMealIds(ids) {
                    return new Set(ids.filter((id) => byId.has(id)));
                },
            });
            return Response.json(result);
        }
        if (url.pathname === "/tool/reset" && req.method === "POST") {
            store.clear();
            byId.clear();
            mealSeq = 0;
            return Response.json({ ok: true, cleared: true });
        }
        if (url.pathname.startsWith("/widget/")) {
            const key = decodeURIComponent(
                url.pathname.slice("/widget/".length),
            );
            if (!KEYS.includes(key)) {
                return new Response(`unknown widget: ${key}`, { status: 404 });
            }
            // Same CSP the MCP Apps sandbox applies, so a widget that reaches
            // for the network here fails here too.
            const v2 = url.searchParams.get("v2") === "1";
            return new Response(await getWidgetHtml(key, { v2 }), {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                    "content-security-policy":
                        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:",
                },
            });
        }
        return new Response("not found", { status: 404 });
    },
});

console.log(`widget harness on http://localhost:${PORT}`);
console.log(`widgets: ${KEYS.join(", ")}`);
