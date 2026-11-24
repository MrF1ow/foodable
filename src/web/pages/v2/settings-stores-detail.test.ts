import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { GrocerySection } from "../../../domain/settings.js";
import {
    renderSettingsStoreV2Page,
    STORE_ADD_RULE_ID,
    STORE_ADD_SECTION_ID,
    STORE_DELETE_SHEET_ID,
    type SettingsStoreV2View,
} from "./settings-stores-detail.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

function section(
    id: string,
    name: string,
    over: Partial<GrocerySection> = {},
): GrocerySection {
    return {
        id,
        storeId: "s1",
        name,
        position: 0,
        isOther: false,
        hidden: false,
        ...over,
    } as GrocerySection;
}

function view(over: Partial<SettingsStoreV2View> = {}): SettingsStoreV2View {
    return {
        chrome,
        store: { id: "s1", name: "Costco" } as SettingsStoreV2View["store"],
        sections: [
            section("a", "Produce"),
            section("b", "Bakery"),
            section("c", "Meat"),
            section("d", "Other", { isOther: true }),
            section("e", "Frozen", { hidden: true }),
        ],
        sectionLineCounts: new Map([["c", 1]]),
        lineCount: 0,
        rules: [],
        moveTarget: null,
        canManage: true,
        ...over,
    };
}

describe("settings store page", () => {
    test("names the store, lists visible sections in order with counts, hidden ones apart", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain("Sections · walking order");
        expect(html).toMatch(/Produce[\s\S]*Bakery[\s\S]*Meat[\s\S]*Other/);
        // The count sits beside the row's ⋯, as the design draws it.
        expect(html).toContain('class="fd-item-row__value">1</span>');
        expect(html).toContain("Hidden sections");
        expect(html).toContain("Frozen");
        // The phone back arrow goes to the stores list.
        expect(html).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings\/household\/stores"/,
        );
    });

    test("each section row has a stable id, so a move finds its ⋯ again", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toMatch(/<li class="fd-item-row" id="fd-section-a">/);
        expect(html).toContain('id="fd-section-b"');
        // The ⋯ trigger of a row sits inside that row.
        expect(html).toMatch(
            /id="fd-section-a"[\s\S]*?data-fd-menu-trigger[\s\S]*?id="fd-section-b"/,
        );
        // A hidden row and a row open for renaming keep theirs too.
        expect(html).toContain('id="fd-section-e"');
        expect(
            renderSettingsStoreV2Page(view({ renameSectionId: "b" })),
        ).toContain(
            '<li class="fd-item-row fd-item-row--edit" id="fd-section-b">',
        );
    });

    test("the Sections, Hidden sections and Store rules headers draw no rule", () => {
        const html = renderSettingsStoreV2Page(view());
        for (const label of [
            "Sections · walking order",
            "Hidden sections",
            "Store rules",
        ]) {
            expect(html).toMatch(
                new RegExp(
                    `<div class="fd-section-header"><h2 class="fd-section-header__label">${label}</h2>`,
                ),
            );
        }
        expect(html).not.toContain("fd-section-header--rule");
    });

    test("a refusal on an open add row is said under its field, once", () => {
        const html = renderSettingsStoreV2Page(
            view({ open: STORE_ADD_SECTION_ID, error: "Taken." }),
        );
        expect(html.match(/Taken\./g)).toHaveLength(1);
        expect(html).toContain('aria-invalid="true"');
        expect(html).toContain(
            `aria-describedby="${STORE_ADD_SECTION_ID}-field-error"`,
        );
        expect(html).not.toContain('class="fd-settings-error"');
        // A rename row says it under its own field too.
        const rename = renderSettingsStoreV2Page(
            view({ renameSectionId: "b", error: "Taken." }),
        );
        expect(rename.match(/Taken\./g)).toHaveLength(1);
        expect(rename).not.toContain('class="fd-settings-error"');
        // A rename for a section that has no row falls back to the banner.
        const gone = renderSettingsStoreV2Page(
            view({ renameSectionId: "zzz", error: "Unknown section." }),
        );
        expect(gone).toContain('class="fd-settings-error"');
        // Any other refusal keeps the banner.
        expect(renderSettingsStoreV2Page(view({ error: "Stale." }))).toContain(
            'class="fd-settings-error"',
        );
    });

    test("no sheet but the delete choice, no Turbo opt-out, no intro or hints", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).not.toContain(`id="${STORE_DELETE_SHEET_ID}"`);
        expect(html).not.toContain('data-turbo="false"');
        expect(html).not.toContain("fd-stores-hint");
        expect(html).not.toContain("Hidden sections stay out");
        expect(html).not.toContain("It goes just before Other");
        expect(html).not.toContain("No rules for this store");
    });

    test("the name is a field, editable only after Rename", () => {
        const closed = renderSettingsStoreV2Page(view());
        expect(closed).toMatch(
            /<input[^>]*name="name"[^>]*value="Costco"[^>]*disabled/,
        );
        expect(closed).not.toContain(
            'action="/settings/household/stores/s1/rename"',
        );
        const open = renderSettingsStoreV2Page(view({ rename: true }));
        expect(open).toContain('action="/settings/household/stores/s1/rename"');
        expect(open).toMatch(/<input[^>]*name="name"[^>]*autofocus/);
        expect(open).not.toMatch(/<input[^>]*name="name"[^>]*disabled/);
        expect(open).toContain("data-fd-autosave");
    });

    test("the ⋯ has Rename and Delete; Delete confirms in place when the store has no lines", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain('href="/settings/household/stores/s1?rename=1"');
        expect(html).toContain("data-fd-menu-confirm");
        expect(html).toContain('action="/settings/household/stores/s1/delete"');
        expect(html).toContain('name="lines" value="0"');
        expect(html).toContain("Delete store");
        expect(html).not.toContain(`id="${STORE_DELETE_SHEET_ID}"`);
    });

    test("a store with lines opens the delete choice sheet: move them or delete them", () => {
        const html = renderSettingsStoreV2Page(
            view({
                lineCount: 3,
                moveTarget: {
                    id: "s2",
                    name: "Trader Joe's",
                } as SettingsStoreV2View["store"],
            }),
        );
        expect(html).toContain(`commandfor="${STORE_DELETE_SHEET_ID}"`);
        expect(html).toMatch(/fd-menu__item--danger[^>]*command="show-modal"/);
        expect(html).toContain(`id="${STORE_DELETE_SHEET_ID}"`);
        expect(html).toContain('name="lines" value="3"');
        expect(html).toContain('name="move_to" value="s2"');
        expect(html).toMatch(/Move them to Trader Joe(&#39;|&#039;|')s/);
        expect(html).toContain("Move 3 lines<");
        expect(html).toContain("Delete the store and its 3 lines");
        expect(html).toContain('name="mode" value="move"');
        expect(html).toContain('name="mode" value="delete"');
        expect(html).not.toContain("data-fd-menu-confirm");
    });

    test("the only store with lines can only delete them with it", () => {
        const html = renderSettingsStoreV2Page(view({ lineCount: 1 }));
        expect(html).toContain("there is no other store to move it to");
        expect(html).toContain('name="mode" value="delete"');
        expect(html).not.toContain('name="mode" value="move"');
        expect(html).not.toContain('name="move_to"');
    });

    test("the delete sheet reopens with its error", () => {
        const html = renderSettingsStoreV2Page(
            view({
                lineCount: 2,
                open: STORE_DELETE_SHEET_ID,
                error: "Stale.",
            }),
        );
        expect(html).toMatch(/<dialog[^>]*data-sheet-open-on-load/);
        expect(html).toContain("Stale.");
    });

    test("a section's ⋯ renames, moves and hides; the ends lose the move past them; Other cannot hide", () => {
        const html = renderSettingsStoreV2Page(view());
        const base = "/settings/household/stores/s1";
        expect(html).toContain(`href="${base}?rename_section=a"`);
        expect(html).toContain(`name="move" value="b:up"`);
        expect(html).toContain(`name="move" value="b:down"`);
        // First: no up. Last movable: no down. Other: no moves at all.
        expect(html).not.toContain('name="move" value="a:up"');
        expect(html).not.toContain('name="move" value="c:down"');
        expect(html).not.toContain('name="move" value="d:up"');
        expect(html).toContain(`action="${base}/sections/order"`);
        expect(html).toContain(`action="${base}/sections/a/visibility"`);
        expect(html).not.toContain(`action="${base}/sections/d/visibility"`);
        expect(html).toContain(`href="${base}?rename_section=d"`);
        // A hidden section's ⋯ shows it again.
        expect(html).toContain(`action="${base}/sections/e/visibility"`);
        expect(html).toMatch(/name="hidden" value="0"/);
    });

    test("a section being renamed is a field with Save and Cancel", () => {
        const html = renderSettingsStoreV2Page(view({ renameSectionId: "b" }));
        const base = "/settings/household/stores/s1";
        expect(html).toContain(`action="${base}/sections/b/rename"`);
        expect(html).toMatch(
            /<input[^>]*name="name"[^>]*value="Bakery"[^>]*autofocus/,
        );
        expect(html).toMatch(
            /aria-label="Cancel"[^>]*>|href="\/settings\/household\/stores\/s1"[^>]*aria-label="Cancel"/,
        );
        // Only that row is open.
        expect(html).not.toContain(`action="${base}/sections/a/rename"`);
    });

    test("Add a section and Add a rule are inline rows that reopen with their error", () => {
        const html = renderSettingsStoreV2Page(view());
        expect(html).toContain(
            'action="/settings/household/stores/s1/sections"',
        );
        expect(html).toContain(
            'action="/settings/household/stores/s1/rules/add"',
        );
        expect(html).toContain("Add a section");
        expect(html).toContain("Add a rule");
        expect(html).not.toMatch(/<details[^>]*data-fd-add-row[^>]* open/);
        const section = renderSettingsStoreV2Page(
            view({ open: STORE_ADD_SECTION_ID, error: "Taken." }),
        );
        expect(
            section.match(/<details[^>]*data-fd-add-row[^>]* open/g),
        ).toHaveLength(1);
        const rule = renderSettingsStoreV2Page(
            view({ open: STORE_ADD_RULE_ID, error: "Too long." }),
        );
        expect(
            rule.match(/<details[^>]*data-fd-add-row[^>]* open/g),
        ).toHaveLength(1);
        expect(rule).toContain("Too long.");
    });

    test("rules are rows that wrap, counted in the header", () => {
        const html = renderSettingsStoreV2Page(
            view({
                rules: [
                    { id: "r1", body: "Bring bags" },
                    { id: "r2", body: "Closed Sundays" },
                ] as SettingsStoreV2View["rules"],
            }),
        );
        expect(html).toContain("Store rules");
        expect(html).toContain("fd-store-rule");
        expect(html).toContain("Bring bags");
        expect(html).toContain("Closed Sundays");
    });

    test("a member reads: no ⋯, no add rows, no field to edit, no sheet", () => {
        const html = renderSettingsStoreV2Page(
            view({ canManage: false, lineCount: 4 }),
        );
        expect(html).not.toContain("data-fd-menu");
        expect(html).not.toContain("fd-add-row");
        expect(html).not.toContain(`id="${STORE_DELETE_SHEET_ID}"`);
        expect(html).not.toContain("?rename");
        expect(html).toMatch(/<input[^>]*name="name"[^>]*disabled/);
        expect(html).toContain("Produce");
    });
});
