import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeBody,
} from "./kitchen-fridge.js";
import {
    buildPreviewKitchenGroceriesView,
    renderKitchenGroceriesBody,
} from "./kitchen-groceries.js";
import { renderKitchenHead } from "./kitchen-head.js";
import {
    buildPreviewKitchenUsualsView,
    renderKitchenUsualsBody,
} from "./kitchen-usuals.js";

test("every tab marks itself in the header and nothing else differs", () => {
    const heads = (["fridge", "groceries", "usuals"] as const).map((active) =>
        renderKitchenHead({
            active,
            phoneSubtitle: "3 items",
            desktopSubtitle: "3 items",
        }),
    );
    expect(
        heads.map((h) => h.match(/data-fd-kitchen-tab="([^"]+)"/)?.[1]),
    ).toEqual(["fridge", "groceries", "usuals"]);
    const bare = heads.map((h) =>
        h.replace(/ data-fd-kitchen-tab="[^"]+"/, ""),
    );
    expect(new Set(bare).size).toBe(1);
});

test("the header is the Page header, first in the page, so the tabs land right under it", () => {
    const head = renderKitchenHead({
        active: "groceries",
        phoneSubtitle: "4 to get",
        desktopSubtitle: "4 to get",
        desktopTools: "<button>Share</button>",
    });
    expect(
        head.startsWith('<header class="fd-page-header fd-kitchen-head" '),
    ).toBe(true);
    expect(head).toContain('<h1 class="fd-page-header__title">Kitchen</h1>');
    expect(head).toContain('<p class="fd-page-header__subtitle">4 to get</p>');
    // The tab's tools ride in the Actions slot.
    expect(head).toContain(
        '<div class="fd-page-header__actions"><button>Share</button></div>',
    );
    // The section switch is gone: the sidebar lists the sections.
    expect(head).not.toContain("fd-seg");
});

test("a tab with no tools has no Actions slot", () => {
    const head = renderKitchenHead({
        active: "fridge",
        phoneSubtitle: "1 item",
    });
    expect(head).not.toContain("fd-page-header__actions");
});

describe("the add button", () => {
    const chrome = {
        theme: "light" as const,
        flags: FIXTURE_APP_CHROME_FLAGS,
        identity: {
            viewerName: "Alex",
            viewerRole: "owner" as const,
            householdName: "Home",
            memberCount: 1,
        },
    };
    const stores = [
        {
            id: "st-1",
            householdId: "hh",
            name: "Costco",
            sortOrder: 0,
            rules: [],
            sections: [],
        },
    ];
    const pages = {
        fridge: renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, "2026-11-10"),
        ),
        groceries: renderKitchenGroceriesBody(
            buildPreviewKitchenGroceriesView(chrome, { stores }),
        ),
        usuals: renderKitchenUsualsBody(
            buildPreviewKitchenUsualsView({
                chrome,
                rows: [],
                stores: [],
                rowMeta: new Map(),
            }),
        ),
    };
    const labels = {
        fridge: "Add item",
        groceries: "Add to list",
        usuals: "Add a usual",
    };

    test("fridge: the round plus is the only tool in the tab row", () => {
        const html = pages.fridge;
        expect(html).toMatch(
            /<div class="fd-kitchen-fridge-page">\n<div class="fd-kitchen-fridge-top"><button[^>]*aria-label="Add item"[^>]*commandfor="fd-fridge-add"[^>]*>[\s\S]*?<\/button><\/div>/,
        );
        // The same plus rides in the header's Actions slot.
        expect(html).toMatch(
            /fd-page-header__actions">[\s\S]*?aria-label="Add item"/,
        );
        expect(html).not.toContain("fd-kitchen-overview-add");
    });

    for (const tab of ["groceries", "usuals"] as const) {
        test(`${tab}: a round plus is the first thing in the page, level with the tabs`, () => {
            const html = pages[tab];
            expect(html).toMatch(
                new RegExp(
                    `<div class="fd-kitchen-${tab}-page"[^>]*>\\n<div class="fd-kitchen-fridge-top"><button[^>]*class="fd-icon-btn fd-kitchen-fridge-add"[^>]*aria-label="${labels[tab]}"[^>]*>`,
                ),
            );
            // One plus per page, and no second add control beside the list.
            expect(html.split("fd-kitchen-fridge-add").length - 1).toBe(1);
            expect(html).not.toContain("fd-kitchen-usual-add-btn");
            expect(html).not.toContain("fd-kitchen-grocery-add");
            expect(html).not.toContain("fd-log-search-field");
        });

        test(`${tab}: the header's Actions slot carries the labelled button`, () => {
            expect(pages[tab]).toMatch(
                new RegExp(
                    `fd-page-header__actions">(?:[\\s\\S]*?\\n)?<button[^>]*class="fd-btn fd-btn--primary fd-kitchen-overview-add"[^>]*>[\\s\\S]*?<span>${labels[tab]}</span></button>`,
                ),
            );
        });
    }

    test("the Groceries and Usuals plus buttons are the same markup apart from what they open", () => {
        const plus = (tab: keyof typeof pages) =>
            pages[tab]
                .match(
                    /<button[^>]*fd-kitchen-fridge-add[^>]*>[\s\S]*?<\/button>/,
                )![0]
                .replace(/aria-label="[^"]*"|title="[^"]*"/g, "")
                .replace(/commandfor="[^"]*"/, "");
        expect(
            new Set(["groceries", "usuals"].map((t) => plus(t as never))).size,
        ).toBe(1);
    });

    test("no Kitchen tab has a ⋯, a select mode or an add row in its list", () => {
        for (const html of Object.values(pages)) {
            const tools = `${html.match(/<div class="fd-page-header__actions">[\s\S]*?<\/div><\/div><\/header>/)?.[0] ?? ""}${html.match(/<div class="fd-kitchen-fridge-top">[\s\S]*?<\/div>\n/)?.[0] ?? ""}`;
            expect(tools).toContain("commandfor=");
            expect(tools).not.toContain("fd-menu");
            expect(html).not.toContain('aria-label="Fridge options"');
            expect(html).not.toContain('aria-label="Groceries options"');
            expect(html).not.toContain('aria-label="Usuals options"');
            expect(html).not.toContain("data-fd-select");
            expect(html).not.toContain("fd-selection-bar");
            expect(html).not.toContain("fd-select-");
            expect(html).not.toContain("data-fd-grocery-add-row");
            expect(html).not.toContain("data-fd-usual-add-row");
            expect(html).not.toContain("/bulk/");
        }
    });

    test("the plus opens each tab's own sheet", () => {
        expect(pages.fridge).toContain('commandfor="fd-fridge-add"');
        expect(pages.groceries).toContain('commandfor="fd-grocery-add"');
        expect(pages.usuals).toContain('commandfor="fd-usual-add"');
    });

    test("Groceries without a store has nothing to add to, so no plus", () => {
        const html = renderKitchenGroceriesBody(
            buildPreviewKitchenGroceriesView(chrome, { stores: [] }),
        );
        expect(html).not.toContain("fd-kitchen-fridge-add");
        expect(html).not.toContain("fd-kitchen-overview-add");
    });

    test("Usuals shows the plus with nothing addable and no usuals at all", () => {
        expect(pages.usuals).toContain("fd-kitchen-fridge-add");
        expect(pages.usuals).toContain('id="fd-usual-add"');
    });
});
