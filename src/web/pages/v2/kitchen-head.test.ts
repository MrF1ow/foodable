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

test("every tab marks itself in the section switch and nothing else differs", () => {
    const heads = (["fridge", "groceries", "usuals"] as const).map((active) =>
        renderKitchenHead({
            active,
            phoneSubtitle: "3 items",
            desktopSubtitle: "3 items",
        }),
    );
    const marked = heads.map(
        (h) =>
            h.match(/fd-seg-btn--on" aria-current="page" href="([^"]+)"/)?.[1],
    );
    expect(marked).toEqual([
        "/kitchen/fridge",
        "/kitchen/groceries",
        "/kitchen/usuals",
    ]);
    const bare = heads.map((h) =>
        h.replace(/ fd-seg-btn--on" aria-current="page"/, '"'),
    );
    expect(new Set(bare).size).toBe(1);
});

test("the phone title is the first element, so the tabs land right under it", () => {
    const head = renderKitchenHead({
        active: "groceries",
        phoneSubtitle: "4 to get",
        desktopSubtitle: "4 to get",
        desktopTools: "<button>Share</button>",
    });
    expect(head.startsWith('<h1 class="fd-kitchen-fridge-title ')).toBe(true);
    expect(head).toContain("<button>Share</button>");
});

describe("the add button", () => {
    const chrome = {
        theme: "light" as const,
        attention: { count: 0, tabs: {} },
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

    for (const tab of ["fridge", "groceries", "usuals"] as const) {
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

        test(`${tab}: the desktop head carries the labelled button after the section switch`, () => {
            expect(pages[tab]).toMatch(
                new RegExp(
                    `</nav>\\n<button[^>]*class="fd-btn fd-btn--primary fd-kitchen-overview-add"[^>]*>[\\s\\S]*?<span>${labels[tab]}</span></button>`,
                ),
            );
        });
    }

    test("the three plus buttons are the same markup apart from what they open", () => {
        const plus = (tab: keyof typeof pages) =>
            pages[tab]
                .match(
                    /<button[^>]*fd-kitchen-fridge-add[^>]*>[\s\S]*?<\/button>/,
                )![0]
                .replace(/aria-label="[^"]*"|title="[^"]*"/g, "")
                .replace(/commandfor="[^"]*"/, "");
        expect(
            new Set(
                ["fridge", "groceries", "usuals"].map((t) => plus(t as never)),
            ).size,
        ).toBe(1);
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
