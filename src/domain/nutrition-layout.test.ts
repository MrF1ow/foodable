import { expect, test } from "bun:test";
import {
    NUTRITION_ARRANGE_MODAL_ID,
    renderNutritionPage,
} from "../web/pages/nutrition.js";
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
        "log",
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

test("peer view keeps the viewer card order and shows Arrange", async () => {
    const order: NutritionCard[] = [
        "trends",
        "log",
        "nutrition-summary",
        "goal-progress",
        "weight-trends",
    ];
    const html = await renderOrder(order, true);
    const peerOrder: NutritionCard[] = [
        "trends",
        "nutrition-summary",
        "goal-progress",
        "weight-trends",
    ];
    const pos = cardPositions(html, peerOrder);
    for (let i = 1; i < pos.length; i++) {
        expect(pos[i]!).toBeGreaterThan(pos[i - 1]!);
    }
    expect(html).not.toContain('class="panel log-panel"');
    expect(html).toContain('commandfor="nutrition-arrange"');
    expect(html).toContain("Viewing Bob");
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
            "log",
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
    expect(html).toContain('aria-label="Move Log up"');
    expect(html).toContain('aria-label="Move Weight trends down"');
    expect(html).toMatch(
        /<button type="button" class="btn-sm" disabled aria-label="Move Log up">↑<\/button>/,
    );
    expect(html).toMatch(
        /<button type="button" class="btn-sm" disabled aria-label="Move Weight trends down">↓<\/button>/,
    );
    expect(html).toContain('action="/nutrition/layout"');
    expect(html).not.toMatch(
        /<form[^>]*action="\/nutrition\/layout"[^>]*class="[^"]*inline-form/,
    );
    expect(html).toContain('name="card"');
    expect(html).toContain('name="direction"');
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
            "log",
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
