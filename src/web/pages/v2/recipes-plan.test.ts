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
    renderWeekRows,
    renderWeekStrip,
    withPlanEditDraft,
    type PlanSheetView,
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
    test("rows list every day: planned recipes, and a plan link on an empty day", () => {
        const html = renderWeekRows(sampleView());
        expect(html.match(/<li class="fd-plan-day/g)?.length).toBe(7);
        expect(html).toContain("Pancakes");
        expect(html).toContain("Nothing planned");
        expect(html).toContain('href="/recipes?plan_date=2026-11-13"');
        // A planned row opens that plan's edit sheet.
        expect(html).toContain(`commandfor="${planEditSheetId("p1")}"`);
    });

    test("the strip shows seven tiles, planned or open, and the missing link", () => {
        const html = renderWeekStrip(sampleView());
        expect(html.match(/<li class="fd-plan-tile/g)?.length).toBe(7);
        expect(html).toContain("fd-plan-tile--empty");
        expect(html).toContain(`commandfor="${PLAN_MISSING_SHEET_ID}"`);
        expect(html).toContain("2 ingredients missing");
    });

    test("an empty week says so and offers no missing link", () => {
        const view = buildWeekPlanView({
            today: TODAY,
            plans: [],
            recipes: [pancakes],
            stock: [],
            foodsById: new Map(),
        });
        const html = renderWeekStrip(view);
        expect(html).toContain("Nothing planned yet");
        expect(html).not.toContain(PLAN_MISSING_SHEET_ID);
    });

    test("a covered week says nothing is missing", () => {
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
        const html = renderWeekStrip(view);
        expect(html).toContain("You have everything");
        expect(html).not.toContain(PLAN_MISSING_SHEET_ID);
    });

    test("edit sheets move or remove a plan and carry the page to return to", () => {
        const html = renderPlanEditSheets(sampleView(), "today");
        expect(html).toContain(`id="${planEditSheetId("p1")}"`);
        expect(html).toContain('action="/recipes/plan/p1/move"');
        expect(html).toContain('action="/recipes/plan/p1/remove"');
        expect(html).toContain('name="back" value="today"');
        expect(html).toContain('name="slot"');
        expect(html).toContain('type="date"');
        // No auto-focus on the date field (the keyboard would cover the sheet).
        expect(html).toContain('data-fd-sheet-focus="panel"');
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
        expect(sheet).toContain('<option value="lunch" selected>');
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
        expect(html).toContain('action="/recipes/plan/add-missing"');
        expect(html).toContain("Flour");
        expect(html).toContain("can't tell what you have");
        expect(html).toContain("Add to groceries");
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

    test("posts the recipe's plan with a date, a slot and servings", () => {
        const html = renderPlanSheet(view);
        expect(html).toContain('action="/recipes/r-pancakes/plan"');
        expect(html).toContain('type="date"');
        expect(html).toContain('name="servings"');
        expect(html).toContain('<option value="dinner" selected>');
        expect(html).not.toContain("data-sheet-open-on-load");
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
        expect(html).toContain('value="2026-13-45"');
    });
});
