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
import { noticeSentence } from "../../../copy/notices.js";
import { noticeStrip, parseNoticeBack, stripNotices } from "./notice-strip.js";
import { renderRecipesListBody } from "./recipes-list.js";
import { buildPreviewTodayPageData, renderTodayV2Page } from "./today.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
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

/** The visible row texts: the dismiss label keeps the full sentence, so look only here. */
function rowTexts(html: string): string[] {
    return [
        ...html.matchAll(
            /<span class="fd-notice-strip__text">([^<]*)<\/span>/g,
        ),
    ].map((m) => m[1]!);
}

describe("noticeStrip", () => {
    test("a row shows the short sentence and keeps the full one as the dismiss label", () => {
        const html = String(
            noticeStrip([low, missing, weighIn(ME, "Alex")], {
                canDismiss: true,
                back: "/",
                viewerUserId: ME,
                label: "Notices",
            }),
        );
        expect(rowTexts(html)).toEqual([
            "Eggs running low",
            "Flour missing for tomorrow",
            "Weigh in · 9 days ago",
        ]);
        expect(html).toContain(
            'aria-label="Dismiss: Running low: Eggs (2 left, below 4)"',
        );
    });

    test("a notice with no short form falls back to the full sentence", () => {
        const expiring: Notice = {
            code: "fridge.expiring",
            severity: "info",
            subject: { kind: "fridge_item", id: "fi-1" },
            related: [],
            params: {
                name: "Milk",
                amount: 1,
                unit: "each",
                expiresOn: "2026-11-13",
                daysLeft: 1,
                onGroceryList: "no",
            },
        };
        const html = String(
            noticeStrip([expiring], {
                canDismiss: true,
                back: "/",
                label: "Soon",
            }),
        );
        expect(rowTexts(html)).toEqual([noticeSentence(expiring)]);
    });

    test("nothing to say renders nothing", () => {
        expect(
            String(
                noticeStrip([], {
                    canDismiss: true,
                    back: "/",
                    label: "Running low",
                }),
            ),
        ).toBe("");
    });

    test("a row has the registry sentence, an Add to list form and a dismiss with the notice's own key", () => {
        const html = String(
            noticeStrip([low], {
                canDismiss: true,
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

    test("a viewer who can't dismiss for the household gets no Dismiss", () => {
        const html = String(
            noticeStrip([missing], {
                back: "/recipes",
                label: "Missing",
                canDismiss: false,
            }),
        );
        expect(html).toContain('action="/notices/plan.missing_ingredient/act"');
        expect(html).not.toContain('action="/notices/dismiss"');
    });

    test("the plan row's Add posts the food only: no amount travels in the form", () => {
        const html = String(
            noticeStrip([missing], {
                canDismiss: true,
                back: "/recipes",
                label: "Missing",
            }),
        );
        expect(html).toContain('action="/notices/plan.missing_ingredient/act"');
        expect(html).toContain(">Add</button>");
        expect(html).toContain('name="related_id" value="plan-1"');
        expect(html).not.toContain('name="amount"');
    });

    test("the weigh-in row opens the weigh-in sheet, and only for the viewer", () => {
        const own = String(
            noticeStrip([weighIn(ME, "Alex")], {
                canDismiss: true,
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
                canDismiss: true,
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

    test("parseNoticeBack keeps a real Today date; the retired Needs attention page falls back to Today", () => {
        expect(parseNoticeBack("/needs-attention")).toBe("/");
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
    test("Kitchen › Usuals draws no strip: the usual's own row says low now", () => {
        const html = renderKitchenUsualsBody(
            buildPreviewKitchenUsualsView({
                chrome,
                rows: [],
                stores: [],
                rowMeta: new Map(),
            }),
        );
        expect(html).not.toContain("fd-notice-strip");
        expect(html).not.toContain('aria-label="Running low"');
    });

    test("Kitchen › Fridge draws no strip: the row says it in the warning colour", () => {
        const html = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, "2026-11-12"),
        );
        expect(html).not.toContain("fd-notice-strip");
        expect(html).not.toContain('aria-label="Running low"');
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
            canDismissNotices: true,
        } as never);
        expect(html).toContain("Flour, 250 g, missing for Pancakes");
        expect(html).toContain('name="back" value="/recipes"');
        expect(html).not.toContain("Running low: Eggs");
        expect(html.indexOf("fd-plan-strip")).toBeLessThan(
            html.indexOf("Flour, 250 g"),
        );
        // A plain member keeps Add but gets no Dismiss: it is for everyone.
        const memberHtml = renderRecipesListBody({
            chrome,
            query: "",
            filter: "all",
            cards: [],
            totalCount: 0,
            week,
            notices: [missing],
        } as never);
        expect(memberHtml).toContain(
            'action="/notices/plan.missing_ingredient/act"',
        );
        expect(memberHtml).not.toContain('action="/notices/dismiss"');
    });

    test("Today draws no notice card, strip or action, on the desktop or the phone", () => {
        const data = buildPreviewTodayPageData(chrome, "2026-11-12");
        data.view.notices = [
            low,
            missing,
            weighIn(ME, "Alex"),
            weighIn(SAM, "Sam"),
        ];
        const html = renderTodayV2Page(data);
        expect(html).not.toContain("fd-notice-strip");
        expect(html).not.toContain("fd-today-notices");
        expect(html).not.toContain("Needs attention");
        expect(html).not.toContain("/needs-attention");
        expect(html).not.toContain("/notices/");
        expect(html).not.toContain('aria-label="Weigh-in"');
        expect(html).not.toContain('aria-label="Missing for the plan"');
        expect(html).not.toContain("Running low");
        expect(html).not.toContain("Sam hasn't");
    });

    test("Today draws no agent change strip: Undo lives in Settings › AI connections", () => {
        const data = buildPreviewTodayPageData(chrome as never, "2026-11-10");
        const html = renderTodayV2Page(data);
        expect(html).not.toContain("agent.action");
        expect(html).not.toContain("fd-today-agent");
        expect(html).not.toContain("Agent changes");
    });
});
