import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    DEFAULT_STORE_HINT,
    renderSettingsStoresV2Page,
    SETTINGS_STORES_V2_MARKER,
    STORES_ADD_SHEET_ID,
    STORES_REORDER_SHEET_ID,
    type SettingsStoresV2View,
} from "./settings-stores.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

function view(over: Partial<SettingsStoresV2View> = {}): SettingsStoresV2View {
    return {
        chrome,
        stores: [
            { id: "s1", name: "Costco", sectionCount: 6, lineCount: 5 },
            { id: "s2", name: "Trader Joe's", sectionCount: 1, lineCount: 0 },
            { id: "s3", name: "Farmers market", sectionCount: 0, lineCount: 0 },
        ],
        defaultStoreId: "s1",
        useUsualStore: true,
        canManage: true,
        ...over,
    };
}

describe("settings stores page", () => {
    test("lists each store with its sections and lines, linked to its page", () => {
        const html = renderSettingsStoresV2Page(view());
        expect(html).toContain(SETTINGS_STORES_V2_MARKER);
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain('href="/settings/household/stores/s1"');
        expect(html).toContain("6 sections");
        expect(html).toContain("5 on the list");
        expect(html).toContain("1 section<");
        expect(html).toContain("No sections");
        // The phone back arrow goes to the household, not Settings home.
        expect(html).toContain(
            'class="fd-settings-phone-back" href="/settings/household"',
        );
    });

    test("managers get add, reorder, default store and the switch", () => {
        const html = renderSettingsStoresV2Page(view());
        expect(html).toContain(`commandfor="${STORES_ADD_SHEET_ID}"`);
        expect(html).toContain('action="/settings/household/stores/add"');
        expect(html).toContain(`commandfor="${STORES_REORDER_SHEET_ID}"`);
        expect(html).toContain('action="/settings/household/stores/order"');
        expect(html).toContain(
            'action="/settings/household/stores/preferences"',
        );
        expect(html).toContain(DEFAULT_STORE_HINT);
        expect(html).toContain('role="switch" aria-checked="true"');
        expect(html).toContain('name="use_usual_store" value="0"');
        expect(html).toContain('class="fd-stores-pref__value">Costco<');
    });

    test("the reorder sheet has a hidden order field, up and down buttons per store", () => {
        const html = renderSettingsStoresV2Page(view());
        for (const id of ["s1", "s2", "s3"]) {
            expect(html).toContain(`name="order" value="${id}"`);
            expect(html).toContain(`name="move" value="${id}:up"`);
            expect(html).toContain(`name="move" value="${id}:down"`);
        }
        // The sheet reopens from the URL after a full load, so no Turbo visit.
        expect(html).toMatch(
            /action="\/settings\/household\/stores\/order" class="fd-order-form" data-fd-order-form data-turbo="false"/,
        );
        // The first store cannot go up, the last cannot go down.
        expect(html).toMatch(/name="move" value="s1:up"[^>]*disabled/);
        expect(html).toMatch(/name="move" value="s3:down"[^>]*disabled/);
        expect(html).not.toMatch(/name="move" value="s2:up"[^>]*disabled/);
    });

    test("the copy spells out the pick order for each state of the switch", () => {
        const on = renderSettingsStoresV2Page(view({ useUsualStore: true }));
        expect(on).toContain("Falls back to the default<");
        expect(on).toContain(
            "its usual store, then the default store, then the store it was last on the list.",
        );
        const off = renderSettingsStoresV2Page(view({ useUsualStore: false }));
        expect(off).toContain("Falls back to the store it was last on<");
        expect(off).toContain(
            "its usual store, then the store it was last on the list, then the default store.",
        );
        expect(off).toContain(
            "New items go here when Foodable has no better guess.",
        );
        expect(off).toContain('role="switch" aria-checked="false"');
        expect(off).toContain('name="use_usual_store" value="1"');
    });

    test("no default store reads None", () => {
        const html = renderSettingsStoresV2Page(view({ defaultStoreId: null }));
        expect(html).toContain('class="fd-stores-pref__value">None<');
        expect(html).toContain('name="default_store_id" value="" checked');
    });

    test("a member sees the stores and settings but no controls", () => {
        const html = renderSettingsStoresV2Page(view({ canManage: false }));
        expect(html).toContain("Costco");
        expect(html).toContain(">On<");
        for (const hidden of [
            STORES_ADD_SHEET_ID,
            "/stores/add",
            "/stores/order",
            "/stores/preferences",
            'role="switch"',
            "Reorder stores",
        ]) {
            expect(html).not.toContain(hidden);
        }
    });

    test("one store has no reorder, an empty household says so", () => {
        const one = renderSettingsStoresV2Page(
            view({
                stores: [
                    { id: "s1", name: "Costco", sectionCount: 1, lineCount: 0 },
                ],
            }),
        );
        expect(one).not.toContain(`commandfor="${STORES_REORDER_SHEET_ID}"`);
        const none = renderSettingsStoresV2Page(
            view({ stores: [], defaultStoreId: null }),
        );
        expect(none).toContain("No grocery stores yet.");
    });

    test("an error shows as a banner and reopens the sheet that was open", () => {
        const html = renderSettingsStoresV2Page(
            view({
                error: "That store already exists.",
                openModalId: STORES_ADD_SHEET_ID,
            }),
        );
        expect(html).toContain('role="alert">That store already exists.');
        expect(html).toMatch(
            new RegExp(
                `id="${STORES_ADD_SHEET_ID}"[^>]*data-sheet-open-on-load`,
            ),
        );
        expect(html).not.toMatch(
            new RegExp(
                `id="${STORES_REORDER_SHEET_ID}"[^>]*data-sheet-open-on-load`,
            ),
        );
    });

    test("store names are escaped", () => {
        const html = renderSettingsStoresV2Page(
            view({
                stores: [
                    {
                        id: "s1",
                        name: "<img src=x onerror=alert(1)>",
                        sectionCount: 1,
                        lineCount: 0,
                    },
                ],
            }),
        );
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x");
    });
});
