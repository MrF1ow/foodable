import { describe, expect, test } from "bun:test";
import type { Notice } from "../../../domain/notices.js";
import { needsAttentionCount } from "../../../domain/notices.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { noticeList } from "../../components/notices.js";
import { buildPreviewTodayPageData, buildPreviewTodayView } from "./today.js";
import { railNoticesListed, renderTodayRail } from "./today-rail.js";

const chrome = {
    theme: "light" as const,
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
    attention: { count: 0, tabs: {} },
};

describe("renderTodayRail attention", () => {
    test("lists block allergen notices when count is zero", () => {
        const allergen: Notice = {
            code: "grocery.allergen",
            severity: "block",
            subject: { kind: "grocery_line", id: "line-1" },
            related: [{ kind: "member", id: "m1", name: "Alex" }],
            params: { allergens: ["milk"], name: "Yogurt" },
        };
        const view = buildPreviewTodayView("2026-11-10");
        view.attention = {
            count: needsAttentionCount([allergen]),
            notices: [allergen],
            noticeFoods: new Map(),
        };
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, "2026-11-10"),
                view,
            }),
        );
        expect(view.attention.count).toBe(0);
        expect(rail).toContain("Contains milk");
        expect(rail).not.toContain("Nothing needs attention");
    });

    test("running low, missing for the plan and weigh-in rows use the short wording", () => {
        const low: Notice = {
            code: "grocery.running_low",
            severity: "info",
            subject: { kind: "food", id: "f-eggs" },
            related: [],
            params: {
                name: "Eggs",
                reason: "1 left, wants 6",
                dismissScope: "",
            },
        };
        const missing: Notice = {
            code: "plan.missing_ingredient",
            severity: "info",
            subject: { kind: "food", id: "f-lemon" },
            related: [{ kind: "recipe", id: "r1", name: "Fish" }],
            params: {
                name: "Lemon",
                unknown: "no",
                recipeName: "Fish",
                recipeCount: 1,
                plannedOn: "2026-11-14",
                daysLeft: 4,
                dismissScope: "p1",
            },
        };
        const view = buildPreviewTodayView("2026-11-10");
        view.attention = {
            count: 2,
            notices: [low, missing],
            noticeFoods: new Map(),
        };
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, "2026-11-10"),
                view,
            }),
        );
        expect(rail).toContain(">Eggs running low<");
        expect(rail).toContain(">Lemon missing for Saturday<");
        const titles = [
            ...rail.matchAll(/fd-today-rail-row__title">([^<]*)</g),
        ].map((m) => m[1]);
        expect(titles).toEqual([
            "Eggs running low",
            "Lemon missing for Saturday",
        ]);
    });

    test("badge uses shell count with block and warn", () => {
        const allergen: Notice = {
            code: "grocery.allergen",
            severity: "block",
            subject: { kind: "grocery_line", id: "line-1" },
            related: [{ kind: "member", id: "m1", name: "Alex" }],
            params: { allergens: ["milk"], name: "Yogurt" },
        };
        const warn: Notice = {
            code: "recipe.no_nutrition",
            severity: "warn",
            subject: {
                kind: "recipe_ingredient",
                id: "ing-1",
                recipeId: "r1",
            },
            related: [],
            params: { name: "Lemon", foodId: "f-lemon" },
        };
        const notices = [allergen, warn];
        const count = needsAttentionCount(notices);
        const view = buildPreviewTodayView("2026-11-10");
        view.attention = {
            count,
            notices,
            noticeFoods: new Map([["f-lemon", { genericFoodId: null }]]),
        };
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, "2026-11-10"),
                view,
            }),
        );
        expect(count).toBe(1);
        expect(rail).toContain('fd-today-card__count">1</');
        expect(rail).toContain("Contains milk");
        expect(rail).toContain("Lemon: no nutrition");
    });

    test("dedupes duplicate sentences like noticeList", () => {
        const a: Notice = {
            code: "fridge.expiring",
            severity: "info",
            subject: { kind: "fridge_item", id: "a" },
            related: [],
            params: {
                name: "Milk",
                amount: 1,
                unit: "l",
                expiresOn: "2026-11-11",
                daysLeft: 1,
                onGroceryList: "no",
            },
        };
        const b: Notice = {
            ...a,
            subject: { kind: "fridge_item", id: "b" },
        };
        // The Needs attention page renders one noticeList per panel group.
        const pageRows = [[a], [b]]
            .map(
                (group) =>
                    noticeList(group, {
                        ctx: { from: "/needs-attention", foods: new Map() },
                    }).match(/<li/g)?.length ?? 0,
            )
            .reduce((sum, n) => sum + n, 0);
        expect(railNoticesListed([a, b])).toHaveLength(pageRows);
        // Within one group, identical sentences fold as they do there.
        const c: Notice = { ...a };
        expect(railNoticesListed([a, c])).toHaveLength(
            noticeList([a, c], {
                ctx: { from: "/needs-attention", foods: new Map() },
            }).match(/<li/g)?.length ?? 0,
        );
    });

    test("identical sentences in different groups stay separate rows", () => {
        const allergen = (id: string, name: string): Notice => ({
            code: "grocery.allergen",
            severity: "block",
            subject: { kind: "grocery_line", id },
            related: [{ kind: "member", id: "m1", name: "Alex" }],
            params: { allergens: ["milk"], name },
        });
        const notices = [
            allergen("line-1", "Yogurt"),
            allergen("line-2", "Milk"),
        ];
        expect(railNoticesListed(notices)).toHaveLength(2);
    });
});

describe("use soon", () => {
    test("expiry wording uses household today not selected day", () => {
        const view = buildPreviewTodayView("2026-11-10");
        view.householdDate = "2026-11-10";
        view.date = "2026-11-08";
        view.expiringFridge = [
            {
                id: "fr-1",
                householdId: "hh",
                locationId: "loc-fridge",
                kind: "food",
                displayName: "Salmon",
                quantity: { amount: 1, unit: "lb" },
                foodId: "f-salmon",
                expiresOn: "2026-11-11",
            },
        ];
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, "2026-11-10"),
                view,
            }),
        );
        expect(rail).toContain("Tomorrow");
        expect(rail).toContain("Fridge");
    });
});

describe("weight card", () => {
    test("hero row precedes chart and omits weigh-in on peer day", () => {
        const view = buildPreviewTodayView("2026-11-10");
        view.weight = {
            latest: {
                id: "w",
                user_id: "u",
                weight_g: 80_000,
                logged_at: "2026-11-09T08:00:00.000Z",
                created_at: "2026-11-09T08:00:00.000Z",
                idempotency_key: null,
                notes: null,
            },
            series30d: [
                { date: "2026-10-12", weight_g: 80_000 },
                { date: "2026-11-09", weight_g: 82_000 },
            ],
        };
        const own = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, "2026-11-10"),
                view,
            }),
        );
        expect(own.indexOf("fd-today-weight__hero")).toBeLessThan(
            own.indexOf("fd-today-weight__chart"),
        );
        expect(own).toContain("Nov");
        expect(own).toContain("Weigh in");

        const peer = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(
                    { ...chrome, subjectLabel: "Sam" },
                    "2026-11-10",
                ),
                view,
            }),
        );
        expect(peer).not.toContain("Weigh in");
    });
});
