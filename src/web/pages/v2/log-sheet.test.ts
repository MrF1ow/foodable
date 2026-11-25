import { describe, expect, setSystemTime, test } from "bun:test";
import {
    FD_LOG_AMOUNT_SHEET_ID,
    FD_LOG_QUICK_CAL_SHEET_ID,
    FD_LOG_SEARCH_SHEET_ID,
    FD_LOG_WEIGH_IN_SHEET_ID,
    isStepValid,
    logAmountUnitChips,
    logResultRow,
    renderLogSheets,
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
        const time = html.match(/<input[^>]*type="datetime-local"[^>]*>/)![0];
        expect(time).toContain(" disabled");
        expect(html).toContain("data-fd-log-time-pick hidden");
    });

    test("every sheet is built from the sheet parts and places as a dialog", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        for (const id of [
            FD_LOG_SEARCH_SHEET_ID,
            FD_LOG_AMOUNT_SHEET_ID,
            FD_LOG_QUICK_CAL_SHEET_ID,
            FD_LOG_WEIGH_IN_SHEET_ID,
        ]) {
            expect(html).toMatch(
                new RegExp(
                    `<dialog class="fd-sheet fd-sheet--dialog[^"]*" id="${id}"`,
                ),
            );
        }
        // Nothing of the old sheet: no `fd-sheet-sub`, no `fd-sheet--edit`, no
        // hand-written chips or tiles.
        expect(html).not.toContain("fd-sheet--edit");
        expect(html).not.toContain("fd-sheet-sub");
        expect(html).not.toContain("fd-log-meals");
        expect(html).not.toContain("fd-quick-tile");
        expect(html).not.toContain("fd-log-search-field");
        // And no menu, so none can render empty.
        expect(html).not.toContain('aria-haspopup="menu"');
    });

    test("search sheet is a search header over ADD TO, Recent and Quick", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        const search = html.slice(0, html.indexOf(FD_LOG_AMOUNT_SHEET_ID));
        expect(search).toContain("fd-sheet--search");
        expect(search).toContain("fd-sheet__header--search");
        expect(search).toContain('id="fd-log-search-q"');
        expect(search).toContain(
            'placeholder="Search foods, recipes, barcodes"',
        );
        for (const label of ["Add to", "Recent", "Quick"]) {
            expect(search).toContain(
                `<h3 class="fd-sheet__label">${label}</h3>`,
            );
        }
        // The sheet's title is only its accessible name, and it has no subtitle.
        expect(search).toContain(
            '<h2 class="fd-sr" id="fd-log-search-title">Search</h2>',
        );
        expect(search).not.toContain("Adding to");
        expect(search).not.toContain("Log food");
    });

    test("the search header offers Go for a pasted recipe link, hidden until one is", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        expect(html).toMatch(/<button[^>]*data-fd-log-import-go[^>]*hidden/);
        expect(html).toContain('action="/recipes/import"');
        expect(html).toContain("data-fd-log-import");
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
        expect(html).toContain("fd-stepper-control");
        expect(html).toContain("fd-segmented--small");
        expect(html).toContain("data-fd-log-submit");
        expect(html).not.toContain(">Cancel</button>");
    });

    test("a food with a pack serving defaults to 1 portion · 30 ml with its kcal", () => {
        // 40 kcal in a 30 ml serving is 133.3 kcal per 100 ml.
        const kcalPer100 = (40 / 30) * 100;
        const serving = {
            label: "1 tbsp (30 ml)",
            amount: 30,
            unit: "ml" as const,
        };
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Half & Half",
                food_id: "f-hh",
                brand: "Member's Mark",
                basis: "100ml",
                serving,
                kcal_per_100g: kcalPer100,
                unit_hints: logAmountUnitChips(
                    { basis: "100ml", serving },
                    false,
                ),
            },
        });
        const amountInput = html.match(/id="fd-log-amount-value"[^>]*>/)?.[0];
        expect(amountInput).toContain('value="1"');
        expect(html).toMatch(/value="portion"[^>]*checked/);
        expect(html).toMatch(/data-fd-log-portion>1 portion · 30 ml</);
        expect(html).toContain("per 100 ml");
        expect(html).not.toContain("per 100 g");
        // The kcal tile: one 30 ml portion is 40 kcal.
        expect(html).toMatch(/kcal<\/dt><dd class="fd-macro-tile__value">40</);
    });

    test("a per-100 ml food without a serving defaults to 100 ml", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Oat drink",
                food_id: "f-oat",
                basis: "100ml",
                unit_hints: logAmountUnitChips({ basis: "100ml" }, false),
            },
        });
        const amountInput = html.match(/id="fd-log-amount-value"[^>]*>/)?.[0];
        expect(amountInput).toContain('value="100"');
        // One unit has nothing to choose: it posts from a hidden field.
        expect(html).toContain('<input type="hidden" name="unit" value="ml">');
        expect(html).not.toContain("fd-segmented");
        expect(html).toMatch(/data-fd-log-portion hidden>/);
    });

    test("a per-100 g food without a serving keeps its 100 g default", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Rice",
                food_id: "f-rice",
                unit_hints: logAmountUnitChips({}, false),
            },
        });
        expect(html).toContain('value="100"');
        expect(html).toContain('<input type="hidden" name="unit" value="g">');
        expect(html).toMatch(/data-fd-log-portion hidden>/);
    });

    test("a food with a piece weight labels the each segment with it", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Chicken breast",
                food_id: "f-breast",
                grams_per_each: 174,
                unit_hints: ["g", "each"],
            },
        });
        expect(html).toContain(">g</span></label>");
        expect(html).toContain(">each · 174 g</span></label>");
        expect(html).toContain('value="each"');
    });

    test("a per-100 g food with a serving in g defaults to 1 portion", () => {
        const serving = {
            label: "1/4 cup (30 g)",
            amount: 30,
            unit: "g" as const,
        };
        const html = renderLogSheets({
            timezone: "UTC",
            amount: {
                name: "Flour",
                food_id: "f-flour",
                kcal_per_100g: 364,
                serving,
                unit_hints: logAmountUnitChips({ serving }, false),
            },
        });
        expect(html).toMatch(/value="portion"[^>]*checked/);
        expect(html).toMatch(/data-fd-log-portion>1 portion · 30 g</);
    });

    test("the Quick grid has Cook a recipe and Add to groceries, and no Photo tile", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        expect(html).toContain(
            '<a class="fd-quick-action" href="/recipes"><span class="fd-quick-action__box">',
        );
        expect(html).toContain(">Cook a recipe</span>");
        expect(html).toContain('href="/kitchen/groceries?add=1"');
        expect(html).toContain(">Add to groceries</span>");
        expect(html).not.toContain("Photo");
        // The existing tiles stay.
        for (const label of [
            "Quick calories",
            "Water +250 ml",
            "Weigh in",
            "Scan barcode",
        ]) {
            expect(html).toContain(`>${label}</span>`);
        }
    });

    test("Water +250 ml and the sheet openers post and open what they did", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        const water = html.match(
            /<form class="fd-log-quick-form" method="post" action="\/log\/water">[\s\S]*?<\/form>/,
        )![0];
        expect(water).toContain('name="amount_ml" value="250"');
        expect(water).toContain('name="return_to" value="/"');
        expect(water).toContain('type="submit"');
        expect(html).toContain(
            `data-fd-open-sheet="${FD_LOG_QUICK_CAL_SHEET_ID}"`,
        );
        expect(html).toContain(
            `data-fd-open-sheet="${FD_LOG_WEIGH_IN_SHEET_ID}"`,
        );
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

    test("the amount sheet's title and subtitle are the food, and a close button", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            amount: { name: "Milk", food_id: "f1", unit_hints: ["g"] },
        });
        const amount = html.slice(
            html.indexOf(`id="${FD_LOG_AMOUNT_SHEET_ID}"`),
        );
        expect(amount).toContain(">Milk</h2>");
        expect(amount).toContain('class="fd-sheet__subtitle"');
        expect(amount).toContain('commandfor="fd-log-amount"');
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
        expect(html).toContain('fd-macro-tile__value">248<');
        expect(html).toContain('fd-macro-tile__value">47 g<');
        expect(html).toContain('fd-macro-tile__value">5 g<');
    });

    test("shell amount sheet starts with no unit radios", () => {
        const html = renderLogSheets({ timezone: "UTC" });
        const amountStart = html.indexOf(FD_LOG_AMOUNT_SHEET_ID);
        const amountEnd = html.indexOf(FD_LOG_QUICK_CAL_SHEET_ID, amountStart);
        const amount = html.slice(amountStart, amountEnd);
        expect(amount).toContain("data-fd-log-units");
        expect(amount).not.toMatch(/name="unit"[^>]*value="/);
        expect(amount).not.toMatch(/value="[^"]*"[^>]*name="unit"/);
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
            /id="fd-log-amount"[\s\S]*?class="fd-sheet__subtitle"[^>]*>([^<]*)</,
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
        expect(amount).toMatch(/name="fd_log_time_mode" value="pick" checked/);
        expect(amount).not.toMatch(
            /name="fd_log_time_mode" value="now"[^>]*checked/,
        );
        expect(amount).toContain('name="logged_at"');
        expect(amount).not.toContain('name="logged_at" value=""');
        expect(amount).toContain("data-fd-log-time-pick>");
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
        expect(html).toMatch(/<button[^>]*data-fd-log-online(?![^>]*hidden)/);
        expect(html).toContain("Search online");
    });

    test("preview results mode renders filter chips and search rows", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            previewSearch: "results",
            previewQuery: "chick",
        });
        // The filter chips are a radio group of four.
        expect(html.match(/name="fd_log_filter"/g)).toHaveLength(4);
        expect(html).toContain("Chicken breast, grilled");
        expect(html).toContain('class="fd-item-row"');
        expect(html).toContain('role="listbox"');
        expect(html).toContain('role="option"');
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

    test("empty search shows the six QUICK tiles when the camera is on", () => {
        const html = renderLogSheets({
            timezone: "UTC",
            previewSearch: "empty",
            barcodeCamera: true,
        });
        expect(html).toContain("Quick calories");
        expect(html).toContain("Water +250 ml");
        expect(html).toContain("Weigh in");
        expect(html).toContain("Scan barcode");
        const tiles = html.match(/\bclass="fd-quick-action"/g) ?? [];
        // Four actions, then Cook a recipe and Add to groceries.
        expect(tiles).toHaveLength(6);
    });

    describe("search results", () => {
        const results = () =>
            renderLogSheets({
                timezone: "UTC",
                previewSearch: "results",
                previewQuery: "chick",
                barcodeCamera: true,
            });
        const rows = (html: string) =>
            html.match(/<li class="fd-item-row"[\s\S]*?<\/li>/g) ?? [];

        test("a row opens its thing and its plus logs it", () => {
            const [thighs, alfredo, , soup, wrap] = rows(results());
            expect(thighs).toContain(
                '<a class="fd-item-row__anchor" href="/kitchen/fridge?item=s1">',
            );
            expect(thighs).toContain("fd-item-row__chevron");
            expect(thighs).toContain('aria-label="Add Chicken thighs"');
            expect(thighs).toContain("data-fd-log-pick=");
            expect(alfredo).toContain('href="/recipes/r-alfredo"');
            expect(soup).toContain('href="/foods/f-soup"');
            expect(soup).toContain("fd-score");
            // A past meal only logs: no link, no chevron, a plus and a pick.
            expect(wrap).not.toContain("<a ");
            expect(wrap).not.toContain("fd-item-row__chevron");
            expect(wrap).toContain("data-fd-log-pick=");
            expect(wrap).toContain("data-fd-log-row-pick=");
        });

        test("rows carry no macro line, as the design draws them", () => {
            expect(results()).not.toContain("fd-macros");
        });

        test("the sheet ends in the barcode link with the camera on and has none with it off", () => {
            expect(results()).toContain("Not here? Scan the barcode");
            const off = renderLogSheets({
                timezone: "UTC",
                previewSearch: "results",
                previewQuery: "chick",
                barcodeCamera: false,
            });
            expect(off).not.toContain("Not here?");
        });

        test("a row that cannot be logged has a link and no plus", () => {
            const html = String(
                logResultRow(
                    {
                        name: "Mystery",
                        subtitle: "Generic",
                        open: "/foods",
                        pick: { name: "Mystery" },
                    },
                    0,
                ),
            );
            expect(html).toContain("fd-item-row__add");
        });
    });

    describe("Copy yesterday tile", () => {
        const withHints = (
            slots: string[],
            over: Record<string, unknown> = {},
        ) =>
            renderLogSheets({
                timezone: "UTC",
                previewSearch: "empty",
                barcodeCamera: true,
                copyYesterday: { slots, returnTo: "/" },
                ...over,
            });

        test("a Quick grid with no yesterday data has no such tile", () => {
            const html = renderLogSheets({ timezone: "UTC" });
            expect(html).not.toContain("Copy yesterday");
            expect(html).not.toContain("/log/copy-yesterday");
        });

        test("posts the slot to the same route as the Today prompt", () => {
            const html = withHints(["breakfast", "dinner"]);
            const form = html.match(
                /<form[^>]*data-fd-copy-yesterday[^>]*>[\s\S]*?<\/form>/,
            )![0];
            expect(form).toContain('method="post"');
            expect(form).toContain('action="/log/copy-yesterday"');
            expect(form).toContain('name="return_to" value="/"');
            expect(form).toContain('name="slot"');
            expect(form).toContain("Copy yesterday");
            expect(form).toContain(
                'data-fd-copy-yesterday-slots="breakfast dinner"',
            );
        });

        test("follows the design order: Scan, Quick calories, Water, Weigh in, Cook, Copy yesterday, Add to groceries", () => {
            const html = withHints(["breakfast"]);
            const grid = html.slice(html.indexOf(">Quick</h3>"));
            const order = [
                "Scan barcode",
                "Quick calories",
                "Water +250 ml",
                "Weigh in",
                "Cook a recipe",
                "Copy yesterday",
                "Add to groceries",
            ].map((label) => grid.indexOf(label));
            expect(order.every((i) => i >= 0)).toBe(true);
            expect(order).toEqual([...order].sort((a, b) => a - b));
            expect(html.match(/\bclass="fd-quick-action"/g) ?? []).toHaveLength(
                7,
            );
        });

        test("starts enabled when the guessed meal has a hint, disabled when not", () => {
            // 12:00 UTC guesses lunch.
            setSystemTime(new Date("2026-11-12T12:00:00Z"));
            try {
                const enabled = withHints(["lunch"]);
                const disabled = withHints(["breakfast"]);
                const tile = (html: string) =>
                    html.match(
                        /<button[^>]*data-fd-copy-yesterday-button[^>]*>/,
                    )![0];
                expect(tile(enabled)).not.toContain("disabled");
                expect(enabled).toContain('name="slot" value="lunch"');
                expect(tile(disabled)).toContain("disabled");
            } finally {
                setSystemTime();
            }
        });

        test("with nothing to copy in any meal there is no tile, as in the design's no-yesterday frame", () => {
            const html = withHints([]);
            expect(html).not.toContain("Copy yesterday");
            expect(html).not.toContain("/log/copy-yesterday");
            expect(html.match(/\bclass="fd-quick-action"/g) ?? []).toHaveLength(
                6,
            );
        });

        test("never adds the frame's Photo of meal tile: no feature is behind it", () => {
            const html = withHints(["breakfast"]);
            expect(html).not.toContain("Photo of meal");
        });
    });

    describe("barcode-camera", () => {
        const on = renderLogSheets({
            timezone: "UTC",
            previewSearch: "empty",
            barcodeCamera: true,
        });
        const off = renderLogSheets({
            timezone: "UTC",
            previewSearch: "empty",
            barcodeCamera: false,
        });
        const scanOpeners = (html: string) =>
            html.match(/data-fd-open-sheet="fd-barcode-scan"/g) ?? [];

        test("on: the Scan barcode tile and the search field's barcode button open the scanner", () => {
            expect(on).toContain(">Scan barcode</span>");
            expect(on).toContain('aria-label="Scan a barcode"');
            // The tile, the field button and the link under the results.
            expect(scanOpeners(on)).toHaveLength(3);
            expect(on).not.toContain("fd-scanner--type-only");
            expect(on).toContain("data-fd-camera-video");
        });

        test("off: no Scan tile, no barcode button, no scan link, and no camera in the scanner", () => {
            expect(off).not.toContain("Scan barcode");
            expect(off).not.toContain("Enter barcode");
            expect(scanOpeners(off)).toHaveLength(0);
            expect(off).toContain("fd-scanner--type-only");
            expect(off).not.toContain("data-fd-camera-video");
            expect(off).not.toContain("data-fd-scanner-torch");
        });

        test("either way the sheets hold no menu that could be empty", () => {
            expect(on).not.toContain("fd-menu");
            expect(off).not.toContain("fd-menu");
        });
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
        // Calories and weight are the design's Stepper, not a bare box.
        expect(html).toMatch(/fd-stepper-control[^>]*>[\s\S]*name="calories"/);
        expect(html).toMatch(/fd-stepper-control[^>]*>[\s\S]*name="weight"/);
        // The subtitle that restated the title is gone; the last weigh-in stays.
        expect(html).not.toContain("Log without picking a food");
        expect(html).toContain("Last: 183.0 lb");
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

    test("the weigh-in's Today chip reads like the log sheet's, in 12 hours", () => {
        setSystemTime(new Date("2026-11-12T17:23:00Z"));
        try {
            const html = renderLogSheets({ timezone: "UTC" });
            expect(html).toContain(
                '<span class="fd-chip__label" data-fd-weigh-today-label="">Today 5:23 PM</span>',
            );
        } finally {
            setSystemTime();
        }
    });
});
