import { expect, test } from "bun:test";
import {
    NUTRITION_ARRANGE_MODAL_ID,
    NUTRITION_LOG_MEAL_MODAL_ID,
    renderNutritionPage,
} from "../web/pages/nutrition.js";
import { assertNoNestedForms } from "../web/components/ui.test.js";
import type { NutritionCard } from "./layout.js";

const member = {
    householdId: "hh",
    userId: "u1",
    role: "owner" as const,
    displayName: "Alice",
};
const bob = {
    householdId: "hh",
    userId: "u2",
    role: "member" as const,
    displayName: "Bob",
};

function cardPositions(html: string, order: NutritionCard[]): number[] {
    return order.map((key) => html.indexOf(`data-nutrition-card="${key}"`));
}

async function renderOrder(order: NutritionCard[], peer = false) {
    return renderNutritionPage({
        access: peer
            ? {
                  ok: true,
                  mode: "peer",
                  viewer: member,
                  subject: bob,
              }
            : {
                  ok: true,
                  mode: "self",
                  viewer: member,
                  subject: member,
              },
        members: [member, bob],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: { theme: "light" },
        cardOrder: order,
        viewMemberId: peer ? bob.userId : undefined,
    });
}

test("nutrition page renders cards in saved order", async () => {
    const order: NutritionCard[] = [
        "weight-trends",
        "nutrition-summary",
        "goal-progress",
        "trends",
    ];
    const html = await renderOrder(order);
    const pos = cardPositions(html, order);
    for (let i = 1; i < pos.length; i++) {
        expect(pos[i]!).toBeGreaterThan(pos[i - 1]!);
    }
});

test("peer view keeps the viewer card order and hides log and Arrange", async () => {
    const order: NutritionCard[] = [
        "trends",
        "nutrition-summary",
        "goal-progress",
        "weight-trends",
    ];
    const html = await renderOrder(order, true);
    const pos = cardPositions(html, order);
    for (let i = 1; i < pos.length; i++) {
        expect(pos[i]!).toBeGreaterThan(pos[i - 1]!);
    }
    expect(html).not.toContain('class="panel log-panel"');
    expect(html).not.toContain('commandfor="nutrition-arrange"');
    expect(html).not.toContain(`id="${NUTRITION_ARRANGE_MODAL_ID}"`);
    expect(html).not.toContain('commandfor="nutrition-log-meal"');
    expect(html).toContain('class="peer-view-tag"');
    expect(html).toContain("Viewing Bob");
    expect(html).not.toContain("You can look, not edit");
});

test("Arrange modal lists every card with disabled ends", async () => {
    const html = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [member],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: { theme: "light" },
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
    });
    expect(html).toContain(`id="${NUTRITION_ARRANGE_MODAL_ID}"`);
    expect(html).toContain("Nutrition summary");
    expect(html).toContain("Goal progress");
    expect(html).toContain("Weight trends");
    expect(html).toContain('aria-label="Move Nutrition summary up"');
    expect(html).toContain('aria-label="Move Weight trends down"');
    expect(html).toMatch(
        /<button type="button" class="btn-sm arrange-up" aria-label="Move Nutrition summary up" disabled>↑<\/button>/,
    );
    expect(html).toMatch(
        /<button type="button" class="btn-sm arrange-down" aria-label="Move Weight trends down" disabled>↓<\/button>/,
    );
    expect(html).toContain('class="nutrition-arrange-form"');
    expect(html).toContain('name="order"');
    expect(html).toContain('type="button" class="btn-sm arrange-up"');
    expect(html).toContain('class="btn-primary">Save</button>');
    const arrangeModal = html.match(
        /<dialog class="modal" id="nutrition-arrange"[\s\S]*?<\/dialog>/,
    )?.[0];
    expect(arrangeModal).toBeDefined();
    const orderInputs = [
        ...(arrangeModal!.matchAll(/name="order" value="([^"]+)"/g) ?? []),
    ].map((m) => m[1]);
    expect(orderInputs).toEqual([
        "nutrition-summary",
        "goal-progress",
        "trends",
        "weight-trends",
    ]);
    expect(html).toContain('name="card"');
    expect(html).toContain('name="direction"');
    assertNoNestedForms(arrangeModal!);
    expect(arrangeModal).toContain('id="nutrition-arrange-save"');
    expect(arrangeModal).toMatch(
        /<button type="submit" class="btn-primary">Save<\/button>/,
    );
    expect(arrangeModal).toMatch(
        /<button type="button" class="arrange-reset" command="close" commandfor="nutrition-arrange">Cancel<\/button>/,
    );
    for (const key of orderInputs) {
        expect(arrangeModal).toContain(
            `<input type="hidden" name="order" value="${key}" />`,
        );
    }
    expect(arrangeModal!.indexOf('id="nutrition-arrange-save"')).toBeLessThan(
        arrangeModal!.indexOf('name="order"'),
    );
    expect(arrangeModal!.lastIndexOf("</form>")).toBeGreaterThan(
        arrangeModal!.lastIndexOf('class="btn-primary">Save</button>'),
    );
});

test("log meal validation error reopens the log meal modal only", async () => {
    const html = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [member],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: { theme: "light" },
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
        error: "Enter a meal description or add a food.",
        openModalId: NUTRITION_LOG_MEAL_MODAL_ID,
    });
    expect(html).toMatch(
        new RegExp(
            `<dialog class="modal" id="${NUTRITION_LOG_MEAL_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
    expect(html).toContain("Enter a meal description or add a food.");
    expect(html).not.toMatch(/<header class="dash-head"[^>]*error-banner/s);
});

test("a layout error reopens the Arrange modal only", async () => {
    const html = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [member],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: { theme: "light" },
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
        error: "Unknown card.",
        openModalId: NUTRITION_ARRANGE_MODAL_ID,
    });
    expect(html).toMatch(
        new RegExp(
            `<dialog class="modal" id="${NUTRITION_ARRANGE_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
    expect(html).toContain("Unknown card.");
    expect(html).not.toMatch(/<header class="dash-head"[^>]*error-banner/s);
});
