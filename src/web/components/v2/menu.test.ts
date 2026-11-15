import { expect, test } from "bun:test";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";
import { menu } from "./menu.js";

test("menu is a details with a named summary trigger and a labelled group panel", () => {
    const html = menu({
        label: "Actions for Milk",
        items: [{ kind: "link", label: "More…", hint: "Compare", href: "/x" }],
    });
    expect(html).toStartWith('<details class="fd-menu"');
    expect(html).toContain(
        '<summary class="fd-menu__trigger" aria-label="Actions for Milk"',
    );
    // Not role="menu": it has no arrow-key or Esc handling, so a screen reader
    // would announce a widget that does not behave like one.
    expect(html).toContain(
        '<div class="fd-menu__panel" role="group" aria-label="Actions for Milk"',
    );
    expect(html).not.toContain("menuitem");
    expect(html).not.toContain('role="menu"');
    expect(html).toContain(
        '<a class="fd-menu__item" href="/x"><span class="fd-menu__label">More…</span><span class="fd-menu__hint">Compare</span></a>',
    );
    // Closed unless a caller opens it: no `open` attribute.
    expect(html).not.toMatch(/<details[^>]* open/);
});

test("a post item is a form with hidden fields around one submit button", () => {
    const html = menu({
        label: "Actions",
        items: [
            {
                kind: "post",
                label: "Merge into Milk",
                action: "/merge",
                fields: { food_a: "a", keep_id: "a" },
            },
            { kind: "separator" },
            { kind: "post", label: "Delete", action: "/d", danger: true },
        ],
    });
    expect(html).toContain(
        '<form class="fd-menu__form" method="post" action="/merge"><input type="hidden" name="food_a" value="a"><input type="hidden" name="keep_id" value="a"><button type="submit" class="fd-menu__item">',
    );
    expect(html).toContain('<hr class="fd-menu__sep">');
    expect(html).toContain("fd-menu__item fd-menu__item--danger");
});

test("every string is escaped and a javascript: link is refused", async () => {
    const html = menu({
        label: XSS,
        items: [
            { kind: "link", label: XSS, hint: XSS, href: `/p?x=${XSS}` },
            {
                kind: "post",
                label: XSS,
                hint: XSS,
                action: `/a${XSS}`,
                fields: { [XSS]: XSS },
            },
        ],
    });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
    expect(() =>
        menu({
            label: "x",
            items: [{ kind: "link", label: "x", href: "javascript:alert(1)" }],
        }),
    ).toThrow();
});
