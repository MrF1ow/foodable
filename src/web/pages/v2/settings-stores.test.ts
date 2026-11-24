import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    renderSettingsStoresV2Page,
    STORES_ADD_ID,
    type SettingsStoresV2View,
} from "./settings-stores.js";

const chrome = {
    theme: "light" as const,
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
        expect(html).toContain('data-fd-settings-page="household"');
        // The desktop menu has no Stores row (the design's list of ten): the
        // page belongs to Household, which it keeps current.
        expect(html).toContain(
            'href="/settings/household" aria-current="page"',
        );
        expect(html).toContain('href="/settings/household/stores/s1"');
        expect(html).toContain("6 sections · 5 on the list");
        expect(html).toContain("1 section · 0 on the list");
        // A store with no sections leaves the sections part out.
        expect(html).toContain(">0 on the list<");
        expect(html).not.toContain("No sections");
        // The phone back arrow goes to the household, not Settings home.
        expect(html).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings\/household"/,
        );
    });

    test("is built from components: no intro, no hints, no sheets, no Turbo opt-out", () => {
        const html = renderSettingsStoresV2Page(view());
        expect(html).not.toContain("fd-stores-intro");
        expect(html).not.toContain("fd-stores-hint");
        expect(html).not.toContain("Groceries are grouped by store");
        expect(html).not.toMatch(/<dialog[^>]*id="fd-stores/);
        expect(html).not.toContain('data-turbo="false"');
        expect(html).toContain("When adding to the list");
    });

    test("managers get an inline add row, the ⋯ with Reorder, the default pull-down and the switch", () => {
        const html = renderSettingsStoresV2Page(view());
        expect(html).toContain("fd-add-row");
        expect(html).toContain('action="/settings/household/stores/add"');
        expect(html).toContain('name="name"');
        expect(html).toMatch(
            /role="menuitem" href="\/settings\/household\/stores\?reorder=1"/,
        );
        // Default store is a pull-down on the row: the trigger reads the
        // current store; None and each store post their id.
        expect(html).toContain('data-anchor="row"');
        expect(html).toContain('class="fd-item-row__value">Costco</span>');
        expect(html).toContain('name="default_store_id" value=""');
        for (const id of ["s1", "s2", "s3"]) {
            expect(html).toContain(`name="default_store_id" value="${id}"`);
        }
        expect(html).toContain('role="menuitemcheckbox" aria-checked="true"');
        // The switch posts the opposite of what it shows.
        expect(html).toContain('role="switch" aria-checked="true"');
        expect(html).toContain('name="use_usual_store" value="0"');
    });

    test("the add row reopens with the form's error", () => {
        const closed = renderSettingsStoresV2Page(view());
        expect(closed).not.toMatch(/<details[^>]*data-fd-add-row[^>]* open/);
        const open = renderSettingsStoresV2Page(
            view({ open: STORES_ADD_ID, error: "Name is required." }),
        );
        expect(open).toMatch(/<details[^>]*data-fd-add-row[^>]* open/);
        expect(open).toContain("Name is required.");
    });

    test("a member reads: no add row, no ⋯, no pull-down, no switch", () => {
        const html = renderSettingsStoresV2Page(view({ canManage: false }));
        expect(html).not.toContain("fd-add-row");
        expect(html).not.toContain("data-fd-menu");
        expect(html).not.toContain("?reorder=1");
        expect(html).not.toContain('role="switch"');
        expect(html).not.toContain("/stores/preferences");
        expect(html).toContain('class="fd-item-row__value">Costco</span>');
        expect(html).toContain('class="fd-item-row__value">On</span>');
    });

    test("with no default store the row reads None", () => {
        const html = renderSettingsStoresV2Page(view({ defaultStoreId: null }));
        expect(html).toContain('class="fd-item-row__value">None</span>');
        expect(html).toMatch(
            /name="default_store_id" value=""[^>]*>[\s\S]*?role="menuitemcheckbox" aria-checked="true"/,
        );
    });

    test("one store has nothing to reorder, so no ⋯", () => {
        const html = renderSettingsStoresV2Page(
            view({ stores: [view().stores[0]!], reorder: true }),
        );
        expect(html).not.toContain("?reorder=1");
        expect(html).not.toContain("data-fd-order-form");
        expect(html).toContain("fd-add-row");
    });

    test("no stores shows an empty state, and an owner still gets the add row", () => {
        const html = renderSettingsStoresV2Page(
            view({ stores: [], defaultStoreId: null }),
        );
        expect(html).toContain("fd-add-row");
        const member = renderSettingsStoresV2Page(
            view({ stores: [], defaultStoreId: null, canManage: false }),
        );
        expect(member).toContain("No stores yet");
    });

    test("reorder mode: a handle, a hidden order field and arrows per store, a check ends it", () => {
        const html = renderSettingsStoresV2Page(view({ reorder: true }));
        expect(html).toContain('action="/settings/household/stores/order"');
        expect(html).toContain("data-fd-order-form");
        expect(html).toContain("data-fd-order-list");
        for (const id of ["s1", "s2", "s3"]) {
            expect(html).toContain(`name="order" value="${id}"`);
            expect(html).toContain(`name="move" value="${id}:up"`);
            expect(html).toContain(`name="move" value="${id}:down"`);
        }
        expect(html.match(/data-fd-order-handle/g)).toHaveLength(3);
        // The subtitle is the sections alone (the design's reorder frame).
        expect(html).toContain("6 sections<");
        expect(html).toContain("No sections<");
        expect(html).not.toContain("on the list");
        // The ends have no arrow past them.
        expect(html).toMatch(/name="move" value="s1:up"[^>]*disabled/);
        expect(html).toMatch(/name="move" value="s3:down"[^>]*disabled/);
        expect(html).not.toMatch(/name="move" value="s1:down"[^>]*disabled/);
        // Done is the round check at the end of the bar, back to the list.
        expect(html).toMatch(
            /<a[^>]*aria-label="Done"[^>]*href="\/settings\/household\/stores"/,
        );
        // Reorder mode shows only the list.
        expect(html).not.toContain("When adding to the list");
        expect(html).not.toContain("fd-add-row");
        expect(html).not.toContain('data-turbo="false"');
    });

    test("reorder mode is for managers only", () => {
        const html = renderSettingsStoresV2Page(
            view({ reorder: true, canManage: false }),
        );
        expect(html).not.toContain("data-fd-order-form");
        expect(html).toContain("When adding to the list");
    });
});
