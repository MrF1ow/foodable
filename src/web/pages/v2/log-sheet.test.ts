import { describe, expect, test } from "bun:test";
import {
    FD_LOG_AMOUNT_SHEET_ID,
    FD_LOG_QUICK_CAL_SHEET_ID,
    FD_LOG_SEARCH_SHEET_ID,
    FD_LOG_WEIGH_IN_SHEET_ID,
    isStepValid,
    logAmountUnitChips,
    renderLogSheets,
    todayTimeLabel24,
    weighInLastSubtitle,
} from "./log-sheet.js";

describe("renderLogSheets", () => {
    test("includes search and amount dialogs", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        expect(html).toContain(`id="${FD_LOG_SEARCH_SHEET_ID}"`);
        expect(html).toContain(`id="${FD_LOG_AMOUNT_SHEET_ID}"`);
    });

    test("search opens on its panel, so a phone keyboard waits for a tap", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        expect(html).toContain(
            `id="${FD_LOG_SEARCH_SHEET_ID}" data-fd-sheet-focus="panel"`,
        );
    });

    test("ids are unique and the time field is not submitted in Today mode", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
        expect(ids.length).toBe(new Set(ids).size);
        const time = html.match(/<input class="fd-log-time-input"[^>]*>/)![0];
        expect(time).toContain(" disabled");
        expect(time).toContain(" hidden");
    });

    test("search sheet has pill field and ADD TO section", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        expect(html).toContain("fd-log-search-field");
        expect(html).toContain("Search foods, recipes, barcodes");
        expect(html).toContain("ADD TO");
        expect(html).toContain("RECENT");
    });

    test("amount stepper accepts default 100 g with step any", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Milk",
                food_id: "f1",
                unit_hints: ["g"],
            },
        });
        const amountInput = html.match(/id="fd-log-amount-value"[^>]*>/)?.[0];
        expect(amountInput).toContain('step="any"');
        expect(amountInput).toContain('min="0"');
        expect(amountInput).toContain('value="100"');
        expect(isStepValid(100, 0, "any")).toBe(true);
        expect(isStepValid(100, 0.1, 1)).toBe(false);
    });

    test("amount sheet lists only allowed unit chips and stepper-first layout", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Milk",
                food_id: "f1",
                unit_hints: logAmountUnitChips(
                    { grams_per_ml: 1.03, grams_per_each: null },
                    false,
                ),
            },
        });
        expect(html).toContain('value="g"');
        expect(html).toContain('value="ml"');
        expect(html).not.toContain('value="each"');
        expect(html).toContain("fd-stepper");
        expect(html).toContain("data-fd-log-submit");
        expect(html).not.toContain(">Cancel</button>");
    });

    test("recipe amount sheet is portion-only", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Chili",
                recipe_id: "r1",
                unit_hints: logAmountUnitChips({}, true),
            },
        });
        expect(html).toContain('value="portion"');
        expect(html).not.toContain('value="g"');
    });

    test("search sheet titles the dialog and shows which meal is selected", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        const searchOnly = html.slice(0, html.indexOf(FD_LOG_AMOUNT_SHEET_ID));
        expect(searchOnly).toContain(">Log food</h2>");
        expect(searchOnly).toMatch(/fd-sheet-sub[^>]*>Adding to /);
        expect(searchOnly).toContain("fd-sheet-close");
    });

    test("preview amount macros use fixture nutrition", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Chicken breast, grilled",
                food_id: "f-chicken",
                unit_hints: ["g"],
                amount: 150,
                unit: "g",
                kcal_per_100g: 165,
                protein_per_100g: 31,
                carbs_per_100g: 0,
                fat_per_100g: 3.3,
            },
        });
        expect(html).toContain(">248</");
        expect(html).toContain(">47<span");
        expect(html).toContain(">5<span");
    });

    test("shell amount sheet starts with no unit radios", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        const amountStart = html.indexOf(FD_LOG_AMOUNT_SHEET_ID);
        const amountEnd = html.indexOf(FD_LOG_QUICK_CAL_SHEET_ID, amountStart);
        const amount = html.slice(amountStart, amountEnd);
        expect(amount).toContain("data-fd-log-unit-chips");
        expect(amount).not.toMatch(/name="unit"[^>]*value="/);
    });

    test("live shell omits preview recent demo names", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        expect(html).not.toContain("Scrambled eggs");
        expect(html).not.toContain("f-eggs");
        expect(html).toMatch(
            /data-fd-log-recent><\/div>|data-fd-log-recent"\s*><\/div>/,
        );
    });

    test("unknown kcal omits invented subtitle numbers", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Mystery",
                food_id: "f-mystery",
                unit_hints: ["g"],
                kcal_per_100g: null,
            },
        });
        const sub = html.match(
            /id="fd-log-amount"[\s\S]*?class="fd-sheet-sub"[^>]*>([^<]*)</,
        )?.[1];
        expect(sub).toBe("Generic");
    });

    test("validation reopen selects pick-a-time when logged_at is set", () => {
        const html = renderLogSheets({
            timezone: "America/Los_Angeles",
            amountOpenOnLoad: true,
            amount: {
                name: "Egg",
                food_id: "egg",
                amount: 5001,
                unit: "g",
                unit_hints: ["g"],
                logged_at: "2026-11-01T09:00",
            },
        });
        const amount = html.slice(html.indexOf(FD_LOG_AMOUNT_SHEET_ID));
        expect(amount).toContain(
            'name="fd_log_time_mode" value="pick" checked',
        );
        expect(amount).not.toMatch(
            /name="fd_log_time_mode" value="now"[^>]*checked/,
        );
        expect(amount).toContain('name="logged_at"');
        expect(amount).not.toContain('name="logged_at" value=""');
    });

    test("preview empty mode still shows fixture recents", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            previewSearch: "empty",
        });
        expect(html).toContain("Scrambled eggs");
    });

    test("preview results mode shows the online search fallback", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            searchOpenOnLoad: true,
            previewSearch: "results",
            previewQuery: "chick",
        });
        expect(html).toContain("fd-log-online");
        expect(html).toMatch(/data-fd-log-online[^>]*(?<! hidden)/);
        expect(html).toContain("Search online");
    });

    test("preview results mode renders filter chips and search rows", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            previewSearch: "results",
            previewQuery: "chick",
        });
        expect(html).toContain("fd-log-filters");
        expect(html).toContain("Chicken breast, grilled");
        expect(html).toContain("fd-row--search");
        expect(html).toContain('role="listbox"');
    });

    test("water validation error shows in the search sheet", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            searchOpenOnLoad: true,
            searchError: "Enter a water amount greater than zero.",
            previewSearch: "empty",
        });
        expect(html).toContain("Enter a water amount greater than zero.");
        expect(html).toContain("data-sheet-open-on-load");
    });

    test("empty search shows exactly three QUICK tiles", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            previewSearch: "empty",
        });
        expect(html).toContain("fd-log-quick-grid");
        expect(html).toContain("Quick calories");
        expect(html).toContain("Water +250 ml");
        expect(html).toContain("Weigh in");
        expect(html).not.toContain("Scan barcode");
        const tiles = html.match(/\bclass="fd-quick-tile"/g) ?? [];
        expect(tiles).toHaveLength(3);
    });

    test("quick calories and weigh-in sheets render their fields", () => {
        const html = renderLogSheets({
            timezone: "America/Los_Angeles",
            quickCaloriesOpenOnLoad: true,
            weighInOpenOnLoad: true,
            weighIn: {
                weight: 182.4,
                unit: "lb",
                lastWeightG: 83007,
                lastLoggedAt: "2026-11-04T12:00:00.000Z",
            },
        });
        expect(html).toContain(`id="${FD_LOG_QUICK_CAL_SHEET_ID}"`);
        expect(html).toContain(`id="${FD_LOG_WEIGH_IN_SHEET_ID}"`);
        expect(html).toContain('name="calories"');
        expect(html).toContain('name="protein_g"');
        expect(html).toContain('name="description"');
        expect(html).toContain('action="/log/quick"');
        expect(html).toContain('action="/log/weight"');
        expect(html).toContain("data-fd-quick-cal-submit");
    });

    test("weighInLastSubtitle formats last entry", () => {
        expect(
            weighInLastSubtitle(
                83007,
                "2026-11-04T12:00:00.000Z",
                "lb",
                "America/Los_Angeles",
            ),
        ).toMatch(/^Last: 183\.0 lb ·/);
    });

    test("todayTimeLabel24 is 24-hour Today prefix", () => {
        expect(todayTimeLabel24("UTC")).toMatch(/^Today \d{2}:\d{2}$/);
    });
});
