import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { GrocerySection } from "../../../domain/settings.js";
import {
    renderSettingsStoreV2Page,
    SETTINGS_STORE_V2_MARKER,
    STORE_DELETE_SHEET_ID,
    storeSectionSheetId,
    type SettingsStoreV2View,
} from "./settings-stores-detail.js";

const HH = "hh-1";
const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

function section(
    id: string,
    name: string,
    sortOrder: number,
    over: Partial<GrocerySection> = {},
): GrocerySection {
    return {
        id,
        householdId: HH,
        storeId: "s1",
        name,
        sortOrder,
        hidden: false,
        isOther: false,
        ...over,
    };
}

function view(over: Partial<SettingsStoreV2View> = {}): SettingsStoreV2View {
    return {
        chrome,
        store: { id: "s1", householdId: HH, name: "Costco", sortOrder: 0 },
        sections: [
            section("a", "Produce", 0),
            section("b", "Bakery", 1),
            section("c", "Meat", 2),
            section("d", "Frozen", 3, { hidden: true }),
            section("o", "Other", 4, { isOther: true }),
        ],
        sectionLineCounts: new Map([["c", 1]]),
        lineCount: 0,
        rules: [],
        moveTarget: {
            id: "s2",
            householdId: HH,
            name: "Trader Joe's",
            sortOrder: 1,
        },
        canManage: true,
        ...over,
    };
}

describe("settings store page", () => {
    test("name field, sections in walking order with counts, and the hidden ones apart", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain(SETTINGS_STORE_V2_MARKER);
        expect(html).toContain('action="/settings/household/stores/s1/rename"');
        expect(html).toContain('value="Costco"');
        expect(html).toContain("Sections · walking order");
        const produce = html.indexOf(">Produce<");
        const bakery = html.indexOf(">Bakery<");
        const meat = html.indexOf(">Meat<");
        expect(produce).toBeGreaterThan(-1);
        expect(produce).toBeLessThan(bakery);
        expect(bakery).toBeLessThan(meat);
        expect(html).toContain("1 on the list");
        // Frozen is hidden: out of the order, listed under Hidden sections.
        expect(html).not.toContain('name="order" value="d"');
        expect(html).toContain("Hidden sections");
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections/d/visibility"',
        );
        // Other is the fixed last stop: no order field of its own.
        expect(html).not.toContain('name="order" value="o"');
        expect(html).toContain("fd-order-item--fixed");
    });

    test("sections post their full order with up and down buttons", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections/order"',
        );
        for (const id of ["a", "b", "c"]) {
            expect(html).toContain(`name="order" value="${id}"`);
        }
        expect(html).toContain('name="move" value="b:up"');
        expect(html).toContain('aria-label="Move Bakery down"');
    });

    test("each section opens a sheet to rename or hide it; Other cannot be hidden", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain(`commandfor="${storeSectionSheetId("a")}"`);
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections/a/rename"',
        );
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections/a/visibility"',
        );
        expect(html).not.toContain(
            'action="/settings/household/stores/s1/sections/o/visibility"',
        );
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections/o/rename"',
        );
    });

    test("add a section and store rules stay on the store's page", () => {
        const html = renderSettingsStoreV2Page(
            view({
                rules: [
                    {
                        id: "r1",
                        householdId: HH,
                        storeId: "s1",
                        body: "Bring bags",
                        sortOrder: 0,
                    },
                ],
            }),
        );
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections"',
        );
        expect(html).toContain("Add a section");
        expect(html).toContain("Store rules");
        expect(html).toContain("Bring bags");
        expect(html).toContain(
            'action="/settings/household/stores/s1/rules/add"',
        );
    });

    test("a store with lines asks: move them to the target or delete them with the store", () => {
        const html = renderSettingsStoreV2Page(view({ lineCount: 5 }));
        expect(html).toContain('<dialog class="fd-sheet fd-sheet--confirm"');
        expect(html).toContain('action="/settings/household/stores/s1/delete"');
        expect(html).toContain('name="move_to" value="s2"');
        // The count the dialog shows rides along so the server can refuse a stale one.
        expect(html).toContain('name="lines" value="5"');
        expect(html).toContain(
            'name="mode" value="move">Move 5 lines to Trader Joe\'s<',
        );
        expect(html).toContain(
            'name="mode" value="delete">Delete the store and its 5 lines<',
        );
        expect(html).toContain("Delete Costco?");
    });

    test("one line reads in the singular", () => {
        const html = renderSettingsStoreV2Page(view({ lineCount: 1 }));
        expect(html).toContain("Move 1 line to Trader Joe's");
        expect(html).toContain("Delete the store and its 1 line<");
        expect(html).toContain("is in this store");
    });

    test("the only store with lines can only delete them", () => {
        const html = renderSettingsStoreV2Page(
            view({ lineCount: 2, moveTarget: null }),
        );
        expect(html).not.toContain('value="move"');
        expect(html).not.toContain('name="move_to"');
        expect(html).toContain("Delete the store and its 2 lines");
        expect(html).toContain("no other store");
    });

    test("a store with no lines is a plain confirm", () => {
        const html = renderSettingsStoreV2Page(view({ lineCount: 0 }));
        expect(html).toContain("Delete store</button>");
        expect(html).not.toContain('value="move"');
        expect(html).not.toContain('name="mode"');
        expect(html).toContain("Its sections and rules go with it.");
        expect(html).toContain('name="lines" value="0"');
    });

    test("a member reads the store: no forms, no delete", () => {
        const html = renderSettingsStoreV2Page(view({ canManage: false }));
        expect(html).toContain("Produce");
        expect(html).toContain("Costco");
        expect(html).not.toContain('action="/settings/household/stores');
        expect(html).not.toContain("Delete store");
        expect(html).not.toContain(`id="${STORE_DELETE_SHEET_ID}"`);
    });

    test("a failed delete reopens the dialog with the error", () => {
        const html = renderSettingsStoreV2Page(
            view({
                lineCount: 2,
                error: "This store has 2 lines on the list. Choose what to do with them.",
                openModalId: STORE_DELETE_SHEET_ID,
            }),
        );
        expect(html).toContain('role="alert">This store has 2 lines');
        expect(html).toMatch(
            new RegExp(
                `id="${STORE_DELETE_SHEET_ID}"[^>]*data-sheet-open-on-load`,
            ),
        );
    });

    test("the phone back goes to the stores page and the desktop link says Stores", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain(
            'class="fd-settings-phone-back" href="/settings/household/stores"',
        );
        expect(html).toContain(
            'class="fd-stores-back" href="/settings/household/stores"',
        );
        expect(html).toContain(
            '<h1 class="fd-settings-phone-title">Costco</h1>',
        );
    });
});
