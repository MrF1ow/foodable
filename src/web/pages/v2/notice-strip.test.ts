import { describe, expect, test } from "bun:test";
import type { Notice } from "../../../domain/notices.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeBody,
} from "./kitchen-fridge.js";
import {
    buildPreviewKitchenUsualsView,
    renderKitchenUsualsBody,
} from "./kitchen-usuals.js";
import { noticeStrip, parseNoticeBack, stripNotices } from "./notice-strip.js";
import { renderRecipesListBody } from "./recipes-list.js";
import { buildPreviewTodayPageData, renderTodayV2Page } from "./today.js";
import { renderTodayRail } from "./today-rail.js";

const chrome = {
    theme: "light" as const,
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
    attention: { count: 0, tabs: {} },
};

const ME = "user-me";
const SAM = "user-sam";

const low: Notice = {
    code: "grocery.running_low",
    severity: "warn",
    subject: { kind: "food", id: "f-eggs" },
    related: [],
    params: {
        name: "Eggs",
        foodId: "f-eggs",
        reason: "2 left, below 4",
        dismissScope: "2026-11-01",
    },
};

const missing: Notice = {
    code: "plan.missing_ingredient",
    severity: "warn",
    subject: { kind: "food", id: "f-flour" },
    related: [{ kind: "recipe", id: "r1", name: "Pancakes" }],
    params: {
        name: "Flour",
        foodId: "f-flour",
        unknown: "no",
        recipeName: "Pancakes",
        recipeCount: 1,
        plannedOn: "2026-11-13",
        daysLeft: 1,
        amounts: "250 g",
        dismissScope: "plan-1",
    },
};

function weighIn(userId: string, name: string): Notice {
    return {
        code: "nutrition.weigh_in_due",
        severity: "info",
        subject: { kind: "member", id: userId },
        related: [{ kind: "member", id: userId, name }],
        params: {
            name,
            days: 9,
            lastWeighedOn: "2026-11-03",
            dismissScope: "2026-11-03",
        },
    };
}

describe("noticeStrip", () => {
    test("nothing to say renders nothing", () => {
        expect(
            String(noticeStrip([], { back: "/", label: "Running low" })),
        ).toBe("");
    });

    test("a row has the registry sentence, an Add to list form and a dismiss with the notice's own key", () => {
        const html = String(
            noticeStrip([low], {
                back: "/kitchen/usuals",
                label: "Running low",
            }),
        );
        expect(html).toContain("Running low: Eggs (2 left, below 4)");
        expect(html).toContain('action="/notices/grocery.running_low/act"');
        expect(html).toContain(">Add to list</button>");
        expect(html).toContain('name="subject_id" value="f-eggs"');
        expect(html).toContain('name="back" value="/kitchen/usuals"');
        expect(html).toContain('action="/notices/dismiss"');
        expect(html).toContain('name="code" value="grocery.running_low"');
        expect(html).toContain('name="subject_kind" value="food"');
        // The day the usual was last restocked: what the dismissal is held for.
        expect(html).toContain('name="related_id" value="2026-11-01"');
    });

    test("the plan row's Add posts the food only: no amount travels in the form", () => {
        const html = String(
            noticeStrip([missing], { back: "/recipes", label: "Missing" }),
        );
        expect(html).toContain('action="/notices/plan.missing_ingredient/act"');
        expect(html).toContain(">Add</button>");
        expect(html).toContain('name="related_id" value="plan-1"');
        expect(html).not.toContain('name="amount"');
    });

    test("the weigh-in row opens the weigh-in sheet, and only for the viewer", () => {
        const own = String(
            noticeStrip([weighIn(ME, "Alex")], {
                back: "/",
                viewerUserId: ME,
                label: "Weigh-in",
            }),
        );
        expect(own).toContain("Alex hasn't weighed in for 9 days");
        expect(own).toContain('data-fd-open-sheet="fd-log-weigh-in"');
        expect(own).toContain(">Weigh in</a>");
        expect(own).not.toContain('action="/notices/nutrition.weigh_in_due');
        expect(own).toContain('name="related_id" value="2026-11-03"');
        expect(own).toContain('name="subject_kind" value="member"');
        // Someone else's reminder has no sheet to open: the sentence stands alone.
        const other = String(
            noticeStrip([weighIn(SAM, "Sam")], {
                back: "/",
                viewerUserId: ME,
                label: "Weigh-in",
            }),
        );
        expect(other).toContain("Sam hasn't weighed in");
        expect(other).not.toContain("data-fd-open-sheet");
    });

    test("stripNotices keeps a code's notices, and a weigh-in only for the viewer", () => {
        const all = [low, missing, weighIn(ME, "Alex"), weighIn(SAM, "Sam")];
        expect(stripNotices(all, ["grocery.running_low"], undefined)).toEqual([
            low,
        ]);
        expect(
            stripNotices(all, ["nutrition.weigh_in_due"], ME).map(
                (n) => n.subject.id,
            ),
        ).toEqual([ME]);
        expect(
            stripNotices(all, ["nutrition.weigh_in_due"], undefined),
        ).toEqual([]);
    });

    test("parseNoticeBack keeps a real Today date and the Needs attention page", () => {
        expect(parseNoticeBack("/needs-attention")).toBe("/needs-attention");
        expect(parseNoticeBack("/?date=2026-11-03")).toBe("/?date=2026-11-03");
        for (const bad of [
            "/?date=2026-02-31",
            "/?date=nope",
            "/?date=2026-11-03&x=1",
            "/x?date=2026-11-03",
            "//?date=2026-11-03",
        ]) {
            expect(parseNoticeBack(bad)).toBe("/");
        }
    });

    test("parseNoticeBack only ever returns one of the app's pages", () => {
        expect(parseNoticeBack("/kitchen/usuals")).toBe("/kitchen/usuals");
        expect(parseNoticeBack("/recipes")).toBe("/recipes");
        for (const bad of [
            "https://evil.example",
            "//evil.example",
            "/settings",
            "",
            undefined,
        ]) {
            expect(parseNoticeBack(bad)).toBe("/");
        }
    });
});

describe("where the one-tap notices show", () => {
    test("Kitchen › Usuals shows the usuals running low, not the other two", () => {
        const html = renderKitchenUsualsBody(
            buildPreviewKitchenUsualsView({
                chrome,
                rows: [],
                stores: [],
                rowMeta: new Map(),
                notices: [low, missing, weighIn(ME, "Alex")],
            }),
        );
        expect(html).toContain("Running low: Eggs");
        expect(html).toContain('aria-label="Running low"');
        expect(html).not.toContain("missing for Pancakes");
        expect(html).not.toContain("weighed in");
        expect(
            renderKitchenUsualsBody(
                buildPreviewKitchenUsualsView({
                    chrome,
                    rows: [],
                    stores: [],
                    rowMeta: new Map(),
                }),
            ),
        ).not.toContain("fd-notice-strip");
    });

    test("Kitchen › Fridge shows them too, and takes the person back to the fridge", () => {
        const html = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, "2026-11-12", {
                notices: [low, missing],
            }),
        );
        expect(html).toContain("Running low: Eggs");
        expect(html).toContain('name="back" value="/kitchen/fridge"');
        expect(html).not.toContain("missing for Pancakes");
    });

    test("Recipes shows what the plan is missing under This week", () => {
        const week = {
            today: "2026-11-12",
            days: [],
            plannedCount: 0,
            missing: [],
        };
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "all",
            cards: [],
            totalCount: 0,
            week,
            notices: [low, missing],
        } as never);
        expect(html).toContain("Flour, 250 g, missing for Pancakes");
        expect(html).toContain('name="back" value="/recipes"');
        expect(html).not.toContain("Running low: Eggs");
        expect(html.indexOf("fd-plan-strip")).toBeLessThan(
            html.indexOf("Flour, 250 g"),
        );
    });

    test("the desktop Today card lists all three with their actions", () => {
        const data = buildPreviewTodayPageData(chrome, "2026-11-12");
        data.view.attention = {
            viewerUserId: ME,
            count: 4,
            notices: [low, missing, weighIn(ME, "Alex"), weighIn(SAM, "Sam")],
            noticeFoods: new Map(),
        };
        const rail = String(renderTodayRail(data));
        expect(rail).toContain("Running low: Eggs");
        expect(rail).toContain('action="/notices/grocery.running_low/act"');
        expect(rail).toContain('action="/notices/plan.missing_ingredient/act"');
        expect(rail).toContain('data-fd-open-sheet="fd-log-weigh-in"');
        // Sam's reminder is a sentence only: the sheet logs the viewer's weight.
        expect(rail).toContain("Sam hasn't weighed in");
        expect(
            rail.match(/data-fd-open-sheet="fd-log-weigh-in"/g),
        ).toHaveLength(
            // Alex's row, and the Weight card's own Weigh in link.
            2,
        );
    });

    test("the card's one-tap rows each carry the dismiss, so the desktop can dismiss without the phone strip", () => {
        const data = buildPreviewTodayPageData(chrome, "2026-11-12");
        const expiring: Notice = {
            code: "fridge.expiring",
            severity: "info",
            subject: { kind: "fridge_item", id: "fi-1" },
            related: [],
            params: {
                name: "Milk",
                amount: 1,
                unit: "l",
                expiresOn: "2026-11-13",
                daysLeft: 1,
                onGroceryList: "no",
            },
        };
        data.view.attention = {
            viewerUserId: ME,
            count: 5,
            notices: [
                low,
                missing,
                weighIn(ME, "Alex"),
                weighIn(SAM, "Sam"),
                expiring,
            ],
            noticeFoods: new Map(),
        };
        const rail = String(renderTodayRail(data));
        const forms =
            rail.match(
                /<form[^>]*action="\/notices\/dismiss"[\s\S]*?<\/form>/g,
            ) ?? [];
        // Four one-tap notices (Sam's too: dismissals are the household's); the expiring one has none.
        expect(forms).toHaveLength(4);
        expect(forms.join("")).toContain(
            'name="code" value="grocery.running_low"',
        );
        expect(forms.join("")).toContain(
            'name="code" value="plan.missing_ingredient"',
        );
        expect(forms.join("")).toContain(
            'name="subject_id" value="' + ME + '"',
        );
        expect(forms.join("")).toContain(
            'name="subject_id" value="' + SAM + '"',
        );
        expect(forms.join("")).toContain(
            'name="related_id" value="2026-11-03"',
        );
        expect(forms.join("")).toContain('name="back" value="/"');
        const row = rail.slice(rail.indexOf("Milk"));
        expect(row).not.toContain("notices/dismiss");
    });

    test("acting or dismissing from another day of Today returns to that day", () => {
        const data = buildPreviewTodayPageData(chrome, "2026-11-12");
        data.view.date = "2026-11-10";
        data.view.householdDate = "2026-11-12";
        data.view.attention = {
            viewerUserId: ME,
            count: 2,
            notices: [low, weighIn(ME, "Alex")],
            noticeFoods: new Map(),
        };
        const html = renderTodayV2Page(data);
        expect(html).toContain('name="back" value="/?date=2026-11-10"');
        expect(html).not.toContain('name="back" value="/"');
        data.view.date = data.view.householdDate;
        expect(renderTodayV2Page(data)).toContain('name="back" value="/"');
    });

    test("the phone Today shows the weigh-in and what the plan is missing in place", () => {
        const data = buildPreviewTodayPageData(chrome, "2026-11-12");
        data.view.attention = {
            viewerUserId: ME,
            count: 3,
            notices: [low, missing, weighIn(ME, "Alex"), weighIn(SAM, "Sam")],
            noticeFoods: new Map(),
        };
        const html = renderTodayV2Page(data);
        expect(html).toContain("fd-today-notices");
        expect(html).toContain('aria-label="Weigh-in"');
        expect(html).toContain('aria-label="Missing for the plan"');
        // Running low belongs to Kitchen; Sam's reminder is not Alex's to act on.
        const phone = html.slice(html.indexOf('class="fd-today-main"'));
        const phoneOnly = phone.slice(
            0,
            phone.indexOf('class="fd-today-rail"'),
        );
        expect(phoneOnly).not.toContain("Running low: Eggs");
        expect(phoneOnly).not.toContain("Sam hasn't");
    });

    test("a peer's read-only day shows no one-tap notices", () => {
        const data = buildPreviewTodayPageData(
            { ...chrome, subjectLabel: "Sam" } as never,
            "2026-11-12",
        );
        data.view.attention = {
            viewerUserId: ME,
            count: 2,
            notices: [missing, weighIn(ME, "Alex")],
            noticeFoods: new Map(),
        };
        const html = renderTodayV2Page(data);
        expect(html).not.toContain("fd-notice-strip");
        expect(html).not.toContain("/notices/");
    });
});
