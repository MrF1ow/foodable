import { expect, test } from "bun:test";
import { renderKitchenHead } from "./kitchen-head.js";

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
