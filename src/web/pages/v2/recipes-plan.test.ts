import { describe, expect, test } from "bun:test";
import type { RecipePlan } from "../../../domain/plan.js";
import {
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";
import {
    buildWeekPlanView,
    PLAN_MISSING_SHEET_ID,
    planEditSheetId,
    renderMissingSheet,
    renderPlanEditSheets,
    renderPlanSheet,
    renderPlannedWeek,
    withPlanEditDraft,
    type PlanSheetView,
    type WeekPlanView,
} from "./recipes-plan.js";

const HH = "hh-1";
const FLOUR = "food-flour";
const EGGS = "food-eggs";

function plan(over: Partial<RecipePlan> & Pick<RecipePlan, "id" | "date">) {
    return {
        householdId: HH,
        recipeId: "r-pancakes",
        slot: "dinner",
        servings: 2,
        createdBy: null,
        createdAt: "2026-11-10T10:00:00+00:00",
        ...over,
    } satisfies RecipePlan;
}

const pancakes = {
    id: "r-pancakes",
    name: "Pancakes",
    yieldPortions: 2,
    ingredients: [
        {
            displayName: "Flour",
            foodId: FLOUR,
            quantity: { amount: 200, unit: "g" },
        },
        {
            displayName: "Eggs",
            foodId: EGGS,
            quantity: { amount: 2, unit: "each" },
        },
    ],
};

// 2026-11-12 is a Thursday.
const TODAY = "2026-11-12";

describe("buildWeekPlanView", () => {
    test("lists seven days from today, each with its planned recipes by slot", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [
                plan({ id: "p2", date: "2026-11-12", slot: "dinner" }),
                plan({ id: "p1", date: "2026-11-12", slot: "breakfast" }),
                plan({ id: "p3", date: "2026-11-18" }),
            ],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        expect(view.days.map((d) => d.date)).toEqual([
            "2026-11-12",
            "2026-11-13",
            "2026-11-14",
            "2026-11-15",
            "2026-11-16",
            "2026-11-17",
            "2026-11-18",
        ]);
        expect(view.days[0]!.weekday).toBe("Thu");
        expect(view.days[0]!.isToday).toBe(true);
        expect(view.days[1]!.isToday).toBe(false);
        expect(view.days[0]!.plans.map((p) => p.id)).toEqual(["p1", "p2"]);
        expect(view.days[0]!.plans[0]).toMatchObject({
            recipeName: "Pancakes",
            slot: "breakfast",
            servings: 2,
        });
        expect(view.plannedCount).toBe(3);
    });

    test("plans before today are hidden, not counted", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "old", date: "2026-11-10" })],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        expect(view.plannedCount).toBe(0);
        expect(view.days.every((d) => d.plans.length === 0)).toBe(true);
        expect(view.missing).toEqual([]);
    });

    test("a plan whose recipe is gone is left out", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY, recipeId: "r-gone" })],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        expect(view.plannedCount).toBe(0);
    });

    test("missing lists what the stock does not cover, and labels an unknown amount", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY, servings: 2 })],
            recipes: [pancakes],
            // 50 g of flour on hand; eggs held by the piece with no weight.
            stock: [
                { foodId: FLOUR, quantity: { amount: 50, unit: "g" } },
                { foodId: EGGS, quantity: { amount: 3, unit: "g" } },
            ],
            foodsById: new Map(),
        });
        const flour = view.missing.find((m) => m.name === "Flour");
        expect(flour).toMatchObject({
            amount: "150 g",
            unknown: false,
            neededBy: "Pancakes",
        });
        const eggs = view.missing.find((m) => m.name === "Eggs");
        expect(eggs?.unknown).toBe(true);
        expect(eggs?.amount).toBe("2");
    });
});

function sampleView() {
    return buildWeekPlanView({
        today: TODAY,
        plans: [
            plan({ id: "p1", date: TODAY, slot: "dinner" }),
            plan({ id: "p2", date: "2026-11-14", slot: "lunch" }),
        ],
        recipes: [pancakes],
        stock: [],
        foodsById: new Map(),
    });
}

describe("week renderers", () => {
    test("the planned week is one Mini card per planned entry, opening its edit sheet, and the missing link", () => {
        const html = renderPlannedWeek(sampleView());
        expect(html).toContain("Planned this week");
        expect(html.match(/<button[^>]*class="fd-mini-card/g)?.length).toBe(2);
        expect(html).toContain(`commandfor="${planEditSheetId("p1")}"`);
        expect(html).toContain(`commandfor="${planEditSheetId("p2")}"`);
        expect(html).toContain(">Thu<");
        expect(html).toContain(">Sat<");
        expect(html).toContain(`commandfor="${PLAN_MISSING_SHEET_ID}"`);
        expect(html).toContain("2 ingredients missing");
        // Empty days are not tiles: nothing to plan from here.
        expect(html).not.toContain("+ Plan");
    });

    test("an empty week draws nothing", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        expect(renderPlannedWeek(view)).toBe("");
    });

    test("a covered week has its cards and no missing link", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY, servings: 2 })],
            recipes: [pancakes],
            stock: [
                { foodId: FLOUR, quantity: { amount: 500, unit: "g" } },
                { foodId: EGGS, quantity: { amount: 6, unit: "each" } },
            ],
            foodsById: new Map(),
        });
        const html = renderPlannedWeek(view);
        expect(html).toContain("fd-mini-card");
        expect(html).not.toContain(PLAN_MISSING_SHEET_ID);
        expect(html).not.toContain("missing");
    });

    test("two identical entries show as two cards: nothing is merged or summed", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [
                plan({ id: "p1", date: TODAY, servings: 2 }),
                plan({ id: "p2", date: TODAY, slot: "lunch", servings: 3 }),
            ],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        const html = renderPlannedWeek(view);
        expect(html.match(/<button[^>]*class="fd-mini-card/g)?.length).toBe(2);
    });

    test("edit sheets move or remove a plan and carry the page to return to", () => {
        const html = renderPlanEditSheets(sampleView(), "today");
        expect(html).toContain(`id="${planEditSheetId("p1")}"`);
        expect(html).toContain('action="/recipes/plan/p1/move"');
        expect(html).toContain('action="/recipes/plan/p1/remove"');
        expect(html).toContain('name="back" value="today"');
        expect(html).toContain('name="slot"');
        expect(html).toContain('name="date"');
        // No auto-focus on the first field (the keyboard would cover the sheet).
        expect(html).toContain('data-fd-sheet-focus="panel"');
    });

    test("the plan edit sheet carries the class that pins Remove and Save to the bottom on desktop", () => {
        const html = renderPlanEditSheets(sampleView(), "today");
        const sheet = html.match(/<dialog[^>]*id="fd-plan-edit-p2"[^>]*>/)![0];
        expect(sheet).toContain("fd-sheet--side fd-plan-edit-sheet");
    });

    test("the edit sheet is a side sheet titled with the day and the meal under it, with Recipe, Day, Meal, Repeat and Servings", () => {
        const html = renderPlanEditSheets(sampleView(), "today");
        const sheet = html.match(
            /<dialog[^>]*id="fd-plan-edit-p2"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("fd-sheet--side fd-plan-edit-sheet");
        expect(sheet).toContain(
            'fd-sheet__title" id="fd-plan-edit-p2-title">Sat 14 Nov<',
        );
        expect(sheet).toContain(
            'fd-sheet__subtitle" id="fd-plan-edit-p2-sub">Lunch<',
        );
        // The form is the Plan sheet's kind: the page script drives its calendar and Repeat row.
        expect(sheet).toContain('class="fd-plan-form"');
        expect(sheet).toContain("data-fd-plan-form");
        // Recipe, Meal and Repeat: an Item row each that opens a pull-down; the pick rides in the form.
        const rows = [
            ...sheet.matchAll(
                /<li class="fd-item-row"><div class="fd-menu[^"]*"[\s\S]*?<\/li>/g,
            ),
        ].map((m) => m[0]);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toContain('fd-item-row__title" title="Recipe"');
        expect(rows[0]).toContain('fd-item-row__value">Pancakes<');
        expect(rows[0]).toContain('name="recipe_id" value="r-pancakes"');
        expect(rows[1]).toContain('fd-item-row__title" title="Meal"');
        expect(rows[1]).toContain('name="slot" value="lunch"');
        expect(rows[1]).toContain('data-fd-menu-value="dinner"');
        expect(rows[2]).toContain('fd-item-row__title" title="Repeat"');
        expect(rows[2]).toContain('name="repeat" value="once"');
        expect(rows[2]).toContain('fd-item-row__value">Once<');
        // Day is the month calendar: a row that opens it, the pick in a hidden field, not a pull-down.
        expect(sheet).toContain('fd-item-row__title" title="Day"');
        expect(sheet).toContain("data-fd-month-toggle");
        expect(sheet).toContain('name="date" value="2026-11-14"');
        expect(sheet).toContain('fd-item-row__value">Sat 14 Nov<');
        expect(sheet).toContain('id="fd-plan-edit-p2-day-picker"');
        expect(sheet).toContain('data-fd-month-day="2026-11-14"');
        expect(sheet).not.toContain('data-fd-menu-value="2026-11-12"');
        // Days before today cannot be picked.
        expect(sheet).toMatch(/data-fd-month-day="2026-11-11"[^>]* disabled/);
        // The same fields go to the same routes: Save changes the entry, Remove removes it.
        expect(sheet).toContain('name="servings"');
        expect(sheet).toMatch(/<button[^>]*form="fd-plan-edit-p2-move"/);
        // Remove asks in place: it arms, then Cancel and Remove take the row.
        expect(sheet).toMatch(
            /<button[^>]*data-fd-confirm-arm[^>]*>[\s\S]*?Remove/,
        );
        expect(sheet).toMatch(/<button[^>]*form="fd-plan-edit-p2-remove"/);
        expect(sheet).not.toContain('type="date"');
    });

    test("the Recipe menu lists the household's saved recipes by name and keeps the entry's own", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY })],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
            savedRecipes: [
                { id: "r-waffles", name: "Waffles" },
                { id: "r-chili", name: "Beef chili" },
            ],
        });
        // The planned recipe is not in the list given: it stays a choice.
        expect(view.recipeChoices?.map((r) => r.name)).toEqual([
            "Beef chili",
            "Waffles",
        ]);
        const html = renderPlanEditSheets(view, "today");
        const menu = html.match(
            /<li class="fd-item-row"><div class="fd-menu[^"]*"[\s\S]*?title="Recipe"[\s\S]*?<\/li>/,
        )![0];
        const names = [
            ...menu.matchAll(
                /data-fd-menu-value="([^"]+)"[^>]*>[\s\S]*?fd-menu__label">([^<]+)</g,
            ),
        ].map((m) => [m[1], m[2]]);
        expect(names).toEqual([
            ["r-chili", "Beef chili"],
            ["r-pancakes", "Pancakes"],
            ["r-waffles", "Waffles"],
        ]);
        expect(menu).toContain('name="recipe_id" value="r-pancakes"');
        // Without a saved list the planned recipes are the choices.
        const bare = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY })],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        expect(bare.recipeChoices).toEqual([
            { id: "r-pancakes", name: "Pancakes" },
        ]);
    });

    test("the Repeat row starts on how the entry repeats, and pick days shows its weekdays", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [
                plan({ id: "once", date: TODAY, slot: "lunch" }),
                plan({
                    id: "wk",
                    date: TODAY,
                    slot: "dinner",
                    ruleId: "rule-1",
                }),
                plan({ id: "pick", date: "2026-11-13", ruleId: "rule-2" }),
            ],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
            rules: new Map([
                ["rule-1", { repeat: "weekly", days: [] }],
                ["rule-2", { repeat: "days", days: [1, 4] }],
            ]),
        });
        expect(
            view.days
                .flatMap((d) => d.plans)
                .map((p) => [p.id, p.repeat, p.days]),
        ).toEqual([
            ["once", "once", []],
            ["wk", "weekly", []],
            ["pick", "days", [1, 4]],
        ]);
        const html = renderPlanEditSheets(view, "today");
        const sheetOf = (id: string) =>
            html.match(
                new RegExp(
                    `<dialog[^>]*id="fd-plan-edit-${id}"[\\s\\S]*?</dialog>`,
                ),
            )![0];
        expect(sheetOf("once")).toContain('name="repeat" value="once"');
        expect(sheetOf("wk")).toContain('name="repeat" value="weekly"');
        expect(sheetOf("wk")).toContain('fd-item-row__value">Every week<');
        expect(sheetOf("wk")).toContain("data-fd-plan-days hidden");
        const pick = sheetOf("pick");
        expect(pick).toContain('name="repeat" value="days"');
        expect(pick).toContain('fd-item-row__value">Pick days<');
        expect(pick).not.toContain("data-fd-plan-days hidden");
        expect(pick).toContain('<input type="hidden" name="days" value="1">');
        expect(pick).toContain('<input type="hidden" name="days" value="4">');
        expect(pick.match(/name="days"/g)).toHaveLength(2);
        expect(pick).toMatch(/fd-pill-chip--on[^>]*data-value="1"/);
    });

    test("a save that did not check re-opens the sheet with the typed recipe, day, repeat and weekdays and the reason", () => {
        const view = {
            ...sampleView(),
            editDraft: {
                planId: "p1",
                recipeId: "r-pancakes",
                date: "2026-11-20",
                slot: "snack",
                servings: 5,
                repeat: "days",
                days: [2, 3],
                error: "Pick today or a later day.",
            },
            openSheet: planEditSheetId("p1"),
        };
        const sheet = renderPlanEditSheets(view, "today").match(
            /<dialog[^>]*id="fd-plan-edit-p1"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("fd-plan-error");
        expect(sheet).toContain("Pick today or a later day.");
        expect(sheet).toContain('name="date" value="2026-11-20"');
        expect(sheet).toContain('name="slot" value="snack"');
        expect(sheet).toContain('name="repeat" value="days"');
        expect(sheet).toContain('name="servings"');
        expect(sheet).toContain('value="5"');
        expect(sheet.match(/name="days"/g)).toHaveLength(2);
        // The header stays the entry's own day and meal, whatever was typed.
        expect(sheet).toContain(
            'fd-sheet__title" id="fd-plan-edit-p1-title">Thu 12 Nov<',
        );
        expect(sheet).toContain(">Dinner<");
    });

    test("a plan for named people shows their portions as saved now and offers no servings to edit", () => {
        const named = plan({
            id: "p1",
            date: TODAY,
            servings: 4,
            memberIds: ["ana", "ben"],
        });
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [named, plan({ id: "p2", date: TODAY, slot: "lunch" })],
            recipes: [
                {
                    ...pancakes,
                    versions: {
                        ingredients: [],
                        overrides: [],
                        // Ana eats 2, Ben has none saved (one): 3, not the stored 4.
                        portions: { ana: 2 },
                    },
                },
            ],
            stock: [],
            foodsById: new Map(),
        });
        const entries = view.days[0]!.plans;
        expect(entries.map((p) => [p.id, p.servings, p.named])).toEqual([
            ["p2", 2, false],
            ["p1", 3, true],
        ]);
        const html = renderPlanEditSheets(view, "today");
        const sheetOf = (id: string) =>
            html.match(
                new RegExp(
                    `<dialog[^>]*id="fd-plan-edit-${id}"[\\s\\S]*?</dialog>`,
                ),
            )![0];
        expect(sheetOf("p1")).not.toContain('name="servings"');
        expect(sheetOf("p1")).toContain(
            "3 servings: the portions of the people",
        );
        expect(sheetOf("p2")).toContain('name="servings"');
    });

    test("a plan id or recipe name made of $-patterns stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const view = buildWeekPlanView({
                today: TODAY,
                plans: [plan({ id: payload, date: TODAY })],
                recipes: [{ ...pancakes, name: payload }],
                stock: [],
                foodsById: new Map(),
            });
            const html = renderPlanEditSheets(view, "today");
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(
                    html,
                    "dialog[data-fd-sheet-focus]",
                    "id",
                ),
            ).toEqual([planEditSheetId(payload)]);
            const add = renderPlanSheet({
                recipeId: "r-1",
                recipeName: payload,
                yieldPortions: 4,
                today: TODAY,
                date: TODAY,
                slot: "dinner",
                servings: 2,
            });
            expect(await injectedAttributes(add)).toEqual([]);
            expect(add).toContain('data-fd-sheet-focus="panel"');
        }
    });

    test("a failed move opens that plan's sheet with what was typed and the reason", () => {
        const view = withPlanEditDraft(sampleView(), {
            planId: "p1",
            date: "2026-11-01",
            slot: "lunch",
            servings: 7,
            error: "Pick today or a later day.",
        })!;
        const html = renderPlanEditSheets(view, "recipes");
        const sheet = html.match(
            /<dialog[^>]*id="fd-plan-edit-p1"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toMatch(/data-sheet-open-on-load/);
        expect(sheet).toContain("Pick today or a later day.");
        expect(sheet).toContain('value="2026-11-01"');
        expect(sheet).toContain('value="7"');
        expect(sheet).toContain('name="slot" value="lunch"');
        // Other plans' sheets stay closed and untouched.
        const others = html.replace(sheet, "");
        expect(others).not.toContain("data-sheet-open-on-load");
        expect(others).not.toContain("Pick today or a later day.");
    });

    test("a draft for a plan that is not in the week opens nothing", () => {
        expect(
            withPlanEditDraft(sampleView(), {
                planId: "elsewhere",
                date: "x",
                slot: "dinner",
                error: "no",
            }),
        ).toBeNull();
    });

    test("the missing sheet lists lines, labels the unknown ones and posts to add them", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY, servings: 2 })],
            recipes: [pancakes],
            stock: [{ foodId: EGGS, quantity: { amount: 3, unit: "g" } }],
            foodsById: new Map(),
        });
        const html = renderMissingSheet(view, "recipes");
        expect(html).toContain(`id="${PLAN_MISSING_SHEET_ID}"`);
        // A side panel at 1024 px and up, as 616102 draws it.
        expect(html).toContain('class="fd-sheet fd-sheet--side');
        expect(html).toContain('action="/recipes/plan/add-missing"');
        expect(html).toContain("Flour");
        // One short line per note, as frame 386617.
        expect(html).toContain("Pancakes · full amount<");
        // The warning dot is the only mark: no class for CSS that is gone.
        expect(html).not.toContain("fd-plan-missing-row");
        expect(html).toMatch(/Add \d+ to groceries/);
        expect(html).toContain("next 7 days");
    });

    test("the missing sheet's rows are ticked checkboxes that post food_ids[], and the form marks itself", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [plan({ id: "p1", date: TODAY, servings: 2 })],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        expect(view.missing.length).toBeGreaterThan(1);
        const html = renderMissingSheet(view, "recipes");
        const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
        expect(boxes).toHaveLength(view.missing.length);
        for (const [i, box] of boxes.entries()) {
            expect(box).toContain('name="food_ids[]"');
            expect(box).toContain(`value="${view.missing[i]!.foodId}"`);
            expect(box).toContain(" checked");
        }
        expect(html).toContain('name="food_ids_sent" value="1"');
        expect(html).not.toContain("Will be added");
        expect(html).toContain(`Add ${view.missing.length} to groceries`);
        expect(html).toContain("data-fd-plan-missing-add");
        expect(html).toContain("data-fd-plan-missing>");
    });

    test("a line with no food gets no checkbox and is not counted in the button", () => {
        const view: WeekPlanView = {
            today: TODAY,
            days: [],
            plannedCount: 1,
            recipeChoices: [],
            missing: [
                {
                    foodId: "f-flour",
                    name: "Flour",
                    amount: "500 g",
                    unknown: false,
                    unmeasured: false,
                    neededBy: "Pancakes",
                },
                {
                    foodId: null,
                    name: "Mystery",
                    amount: null,
                    unknown: false,
                    unmeasured: false,
                    neededBy: "Pancakes",
                },
            ],
        };
        const html = renderMissingSheet(view, "recipes");
        expect(html.match(/<input type="checkbox"/g) ?? []).toHaveLength(1);
        expect(html).toContain("Mystery");
        expect(html).toContain("Add 1 to groceries");
        expect(html).toContain("2 ingredients");
    });
});

describe("missing sheet, one food on two lines", () => {
    const line = (amount: string, neededBy: string) => ({
        foodId: "f-flour",
        name: "Flour",
        amount,
        unknown: false,
        unmeasured: false,
        neededBy,
    });
    const view: WeekPlanView = {
        today: TODAY,
        days: [],
        plannedCount: 2,
        recipeChoices: [],
        missing: [
            line("200 g", "Bread"),
            line("1 cup", "Cake"),
            {
                foodId: "f-eggs",
                name: "Eggs",
                amount: "2",
                unknown: false,
                unmeasured: false,
                neededBy: "Cake",
            },
        ],
    };

    test("a food listed twice has one checkbox, on its first row, and counts once in the button", () => {
        const html = renderMissingSheet(view, "recipes");
        const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
        expect(boxes).toHaveLength(2);
        expect(boxes[0]).toContain('value="f-flour"');
        expect(boxes[1]).toContain('value="f-eggs"');
        // Both flour rows are still listed, and the sheet still counts rows.
        expect(html).toContain("200 g");
        expect(html).toContain("1 cup");
        expect(html).toContain("3 ingredients");
        expect(html).toContain("Add 2 to groceries");
    });
});

describe("add to plan sheet", () => {
    const view: PlanSheetView = {
        recipeId: "r-pancakes",
        recipeName: "Pancakes",
        yieldPortions: 2,
        today: TODAY,
        date: TODAY,
        slot: "dinner",
        servings: 2,
    };

    test("is titled Plan <recipe> and posts the day, meal, repeat and servings to the recipe's plan route (FigCraft 406295)", () => {
        const html = renderPlanSheet(view);
        expect(html).toContain('action="/recipes/r-pancakes/plan"');
        expect(html).toContain(">Plan Pancakes<");
        // The day rides in the Starts row's hidden field, not a date input.
        expect(html).toContain('name="date" value="2026-11-12"');
        expect(html).not.toContain('type="date"');
        expect(html).not.toContain("<select");
        expect(html).toContain('name="slot" value="dinner"');
        expect(html).toContain('name="repeat" value="once"');
        expect(html).toContain('name="servings"');
        // Plan submits the form from outside it, with no icon (as the frames).
        const plan = html.slice(
            html.indexOf('form="fd-recipe-plan-form">'),
            html.indexOf(
                "</button>",
                html.indexOf('form="fd-recipe-plan-form">'),
            ),
        );
        expect(plan).toContain(">Plan</span>");
        expect(plan).not.toContain("<svg");
        expect(html).not.toContain("data-sheet-open-on-load");
    });

    test("Starts, Meal and Repeat are Item rows: Starts opens the month picker, the others are pull-downs with the frames' choices", () => {
        const html = renderPlanSheet(view);
        const rows = [
            ...html.matchAll(/<li class="fd-item-row[^"]*">[\s\S]*?<\/li>/g),
        ].map((m) => m[0]);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toContain('fd-item-row__title" title="Starts">Starts<');
        expect(rows[0]).toContain('fd-item-row__value">Today<');
        expect(rows[0]).toContain('aria-expanded="false"');
        expect(rows[1]).toContain('title="Meal"');
        expect(rows[1]).toContain('fd-item-row__value">Dinner<');
        for (const label of ["Breakfast", "Lunch", "Dinner", "Snacks"]) {
            expect(rows[1]).toContain(`fd-menu__label">${label}<`);
        }
        expect(rows[2]).toContain('title="Repeat"');
        expect(rows[2]).toContain('fd-item-row__value">Once<');
        const values = [
            ...rows[2]!.matchAll(/data-fd-menu-value="(\w+)"/g),
        ].map((m) => m[1]);
        expect(values).toEqual(["once", "weekly", "daily", "weekdays", "days"]);
        for (const label of [
            "Once",
            "Every week",
            "Every day",
            "Weekdays",
            "Pick days",
        ]) {
            expect(rows[2]).toContain(`fd-menu__label">${label}<`);
        }
    });

    test("the month picker shows the start day's month, the picked day, and no day before today", () => {
        const html = renderPlanSheet({ ...view, date: "2026-11-20" });
        expect(html).toContain('data-month="2026-11"');
        expect(html).toContain(">November 2026<");
        expect(html).toContain('fd-item-row__value">Fri 20 Nov<');
        // The opening tag of a day's button, found by text, not by pattern.
        const pick = (day: string) => {
            const at = html.indexOf(`data-fd-month-day="${day}"`);
            return html.slice(
                html.lastIndexOf("<button", at),
                html.indexOf(">", at) + 1,
            );
        };
        expect(pick("2026-11-20")).toContain('aria-pressed="true"');
        expect(pick("2026-11-20")).not.toContain("disabled");
        expect(pick("2026-11-12")).toContain('aria-current="date"');
        expect(pick("2026-11-12")).not.toContain("disabled");
        expect(pick("2026-11-11")).toContain("disabled");
        expect(pick("2026-11-01")).toContain("disabled");
        // November starts on a Sunday, so the grid has no blank before it.
        expect(html).not.toContain("fd-month-picker__blank");
        // Nothing earlier than today's month to go back to.
        expect(html).toMatch(
            /<button[^>]*data-fd-month-prev=""[^>]* disabled>/,
        );
        expect(html).not.toMatch(
            /<button[^>]*data-fd-month-next=""[^>]* disabled>/,
        );
    });

    test("a repeat of Pick days shows the weekday chips with the days on, one hidden field each, and the row reads Pick days (FigCraft 409279)", () => {
        const html = renderPlanSheet({
            ...view,
            repeat: "days",
            days: [5, 1, 3],
        });
        expect(html).toContain('name="repeat" value="days"');
        // The chips hold the days; the row keeps "Pick days" while they show.
        expect(html).toContain('fd-item-row__value">Pick days<');
        expect(html).not.toContain("Mon, Wed, Fri");
        const chips = html.match(
            /<div class="fd-plan-days" data-fd-plan-days>[\s\S]*?<\/div>/,
        )![0];
        const on = [
            ...chips.matchAll(
                /aria-pressed="true" aria-label="(\w+)" data-value="(\d)"/g,
            ),
        ].map((m) => m[1]);
        expect(on).toEqual(["Monday", "Wednesday", "Friday"]);
        // Seven chips, Sunday first, each named by its weekday.
        expect(
            chips.match(/<button type="button" class="fd-pill-chip[ "]/g),
        ).toHaveLength(7);
        expect(chips).toContain('aria-label="Sunday" data-value="0"');
        expect(html.match(/<input type="hidden" name="days"/g)).toHaveLength(3);
        for (const day of [1, 3, 5]) {
            expect(html).toContain(
                `<input type="hidden" name="days" value="${day}">`,
            );
        }
    });

    test("any other repeat hides the chips and posts no weekdays", () => {
        for (const repeat of ["once", "weekly", "daily", "weekdays"]) {
            const html = renderPlanSheet({ ...view, repeat, days: [1, 3] });
            expect(html).toContain(`name="repeat" value="${repeat}"`);
            expect(html).toContain("data-fd-plan-days hidden");
            expect(html).not.toContain('name="days"');
        }
        // An unknown repeat is Once.
        expect(renderPlanSheet({ ...view, repeat: "yearly" })).toContain(
            'name="repeat" value="once"',
        );
    });

    test("a failed add re-opens the sheet with the error and what was typed", () => {
        const html = renderPlanSheet({
            ...view,
            open: true,
            date: "2026-13-45",
            error: "A plan date must be a day like 2026-11-12.",
        });
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain("A plan date must be a day");
        expect(html).toContain('name="date" value="2026-13-45"');
        // The Starts row reads what was typed, and the picker offers no pick.
        expect(html).toContain('fd-item-row__value">2026-13-45<');
        expect(html).not.toContain('aria-pressed="true" aria-label="Friday');
    });
});
