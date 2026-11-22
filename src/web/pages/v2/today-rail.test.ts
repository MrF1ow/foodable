import { describe, expect, test } from "bun:test";
import type { Notice } from "../../../domain/notices.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { buildPreviewTodayPageData, buildPreviewTodayView } from "./today.js";
import { renderTodayRail } from "./today-rail.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

describe("renderTodayRail has no notices card", () => {
    test("open notices never draw a Needs attention card, rows or actions in the rail", () => {
        const notices: Notice[] = [
            {
                code: "grocery.allergen",
                severity: "block",
                subject: { kind: "grocery_line", id: "line-1" },
                related: [{ kind: "member", id: "m1", name: "Alex" }],
                params: { allergens: ["milk"], name: "Yogurt" },
            },
            {
                code: "grocery.running_low",
                severity: "info",
                subject: { kind: "food", id: "f-eggs" },
                related: [],
                params: {
                    name: "Eggs",
                    reason: "1 left, wants 6",
                    dismissScope: "",
                },
            },
            {
                code: "nutrition.weigh_in_due",
                severity: "info",
                subject: { kind: "member", id: "m1" },
                related: [{ kind: "member", id: "m1", name: "Alex" }],
                params: { name: "Alex", days: 9, dismissScope: "" },
            },
        ];
        const view = buildPreviewTodayView("2026-11-10");
        view.notices = notices;
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, "2026-11-10"),
                view,
            }),
        );
        expect(rail).not.toContain("Needs attention");
        expect(rail).not.toContain("Nothing needs attention");
        expect(rail).not.toContain("/needs-attention");
        expect(rail).not.toContain("fd-today-rail-row__action");
        expect(rail).not.toContain("Contains milk");
        expect(rail).not.toContain("running low");
        // The cards that stay.
        expect(rail).toContain('aria-label="Weight"');
        expect(rail).toContain('aria-label="This week"');
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
