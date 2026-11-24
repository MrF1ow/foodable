import { expect, test } from "bun:test";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";
import { menu, type MenuItem } from "./menu.js";

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

// The pinned bytes of today's <details> menu for the call shapes the
// possible-duplicates page uses. New behaviour is opt-in, so these must not
// move.
const PIN_DOTS = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>`;

test("a menu without anchor renders byte for byte what it always did", () => {
    const html = menu({
        label: "Actions for Milk · Whole milk",
        className: "fd-dup-menu",
        items: [
            {
                kind: "post",
                label: "Merge into Milk",
                hint: "Keeps Milk · 3 uses",
                action: "/settings/duplicates/merge",
                fields: { food_a: "a", food_b: "b", keep_id: "a" },
            },
            {
                kind: "post",
                label: "Not the same",
                action: "/settings/duplicates/keep-separate",
                fields: {
                    subject_id: "a",
                    related_id: "b",
                    back: "/settings/duplicates",
                },
            },
            { kind: "separator" },
            {
                kind: "link",
                label: "More…",
                hint: "Compare details first",
                href: "/settings/duplicates/compare?a=a&b=b",
            },
            { kind: "post", label: "Delete", action: "/d", danger: true },
        ],
    });
    expect(String(html)).toBe(
        `<details class="fd-menu fd-dup-menu"><summary class="fd-menu__trigger" aria-label="Actions for Milk · Whole milk" title="Actions for Milk · Whole milk">${PIN_DOTS}</summary><div class="fd-menu__panel" role="group" aria-label="Actions for Milk · Whole milk"><form class="fd-menu__form" method="post" action="/settings/duplicates/merge"><input type="hidden" name="food_a" value="a"><input type="hidden" name="food_b" value="b"><input type="hidden" name="keep_id" value="a"><button type="submit" class="fd-menu__item"><span class="fd-menu__label">Merge into Milk</span><span class="fd-menu__hint">Keeps Milk · 3 uses</span></button></form><form class="fd-menu__form" method="post" action="/settings/duplicates/keep-separate"><input type="hidden" name="subject_id" value="a"><input type="hidden" name="related_id" value="b"><input type="hidden" name="back" value="/settings/duplicates"><button type="submit" class="fd-menu__item"><span class="fd-menu__label">Not the same</span></button></form><hr class="fd-menu__sep"><a class="fd-menu__item" href="/settings/duplicates/compare?a=a&amp;b=b"><span class="fd-menu__label">More…</span><span class="fd-menu__hint">Compare details first</span></a><form class="fd-menu__form" method="post" action="/d"><button type="submit" class="fd-menu__item fd-menu__item--danger"><span class="fd-menu__label">Delete</span></button></form></div></details>`,
    );
    expect(
        String(
            menu({
                label: "L",
                items: [{ kind: "separator" }],
                data: { "x-y": "1" },
            }),
        ),
    ).toBe(
        `<details class="fd-menu" data-x-y="1"><summary class="fd-menu__trigger" aria-label="L" title="L">${PIN_DOTS}</summary><div class="fd-menu__panel" role="group" aria-label="L"><hr class="fd-menu__sep"></div></details>`,
    );
});

// ---- The anchored menu: opt-in, built on the Icon button / Filter button.

const anchored = (items: Parameters<typeof menu>[0]["items"]) =>
    String(menu({ label: "Actions for Milk", anchor: "more", items }));

test("an anchored menu is a div around a visible button trigger and a hidden menu panel", () => {
    const html = anchored([
        { kind: "link", label: "Open", href: "/x" },
        { kind: "separator" },
    ]);
    expect(html).toStartWith(
        '<div class="fd-menu fd-menu--anchored fd-menu--more" data-fd-menu data-anchor="more">',
    );
    // The ⋯ trigger is the design's round Icon button, named for the menu.
    expect(html).toContain(
        '<button type="button" class="fd-btn fd-btn--sm fd-btn--icon" data-fd-btn aria-label="Actions for Milk" data-fd-menu-trigger="" aria-haspopup="menu" aria-expanded="false">',
    );
    expect(html).toContain("fd-icon--more");
    expect(html).toContain(
        '<div class="fd-menu__panel" role="menu" aria-label="Actions for Milk" hidden>',
    );
    expect(html).toContain(
        '<a class="fd-menu__item" role="menuitem" href="/x"><span class="fd-menu__text"><span class="fd-menu__label">Open</span></span></a>',
    );
    expect(html).toContain('<hr class="fd-menu__sep">');
    expect(html).not.toContain("<details");
});

test("the filter anchor uses the Filter button with its count in the name", () => {
    const html = String(
        menu({
            label: "Filter recipes",
            anchor: "filter",
            filterCount: 2,
            items: [{ kind: "link", label: "All", href: "/" }],
        }),
    );
    expect(html).toContain("fd-menu--filter");
    expect(html).toContain('data-anchor="filter"');
    expect(html).toContain("fd-btn--filter");
    expect(html).toContain('aria-label="Filter recipes, 2 on"');
    expect(html).toContain('<span class="fd-btn__badge">2</span>');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
});

test("className and data keep working beside the anchor", () => {
    const html = String(
        menu({
            label: "L",
            anchor: "more",
            className: "mine",
            data: { id: "7" },
            items: [{ kind: "separator" }],
        }),
    );
    expect(html).toContain(
        'class="fd-menu fd-menu--anchored fd-menu--more mine"',
    );
    expect(html).toContain('data-id="7"');
});

test("link and post items keep their markup inside an anchored menu", () => {
    const html = anchored([
        {
            kind: "post",
            label: "Merge",
            hint: "Keeps Milk",
            action: "/merge",
            fields: { a: "1" },
        },
        { kind: "post", label: "Remove", action: "/r" },
    ]);
    expect(html).toContain(
        '<form class="fd-menu__form" method="post" action="/merge"><input type="hidden" name="a" value="1"><button type="submit" class="fd-menu__item" role="menuitem"><span class="fd-menu__text"><span class="fd-menu__label">Merge</span><span class="fd-menu__hint">Keeps Milk</span></span></button></form>',
    );
    expect(html).toContain(
        '<form class="fd-menu__form" method="post" action="/r"><button type="submit" class="fd-menu__item" role="menuitem">',
    );
});

test("a checked item is a menuitemcheckbox with a tick, and the menu gets a check column", () => {
    const html = anchored([
        { kind: "checked", label: "Cookable now", checked: true },
        { kind: "checked", label: "Favourites", checked: false, href: "/f" },
        { kind: "link", label: "Clear", href: "/c" },
    ]);
    expect(html).toContain(
        '<button type="button" class="fd-menu__item" role="menuitemcheckbox" aria-checked="true"><span class="fd-menu__check" aria-hidden="true"><svg class="fd-icon fd-icon--check"',
    );
    expect(html).toContain(
        '<a class="fd-menu__item" role="menuitemcheckbox" aria-checked="false" href="/f">',
    );
    // A plain item in the same menu keeps the column, empty, so labels align.
    expect(html).toContain(
        '<a class="fd-menu__item" role="menuitem" href="/c"><span class="fd-menu__check" aria-hidden="true"></span><span class="fd-menu__text"><span class="fd-menu__label">Clear</span>',
    );
});

test("a menu with no checked item has no check column", () => {
    expect(
        anchored([{ kind: "link", label: "Open", href: "/x" }]),
    ).not.toContain("fd-menu__check");
});

test("a destructive item is an arm button and a hidden Cancel + verb row that posts", () => {
    const html = anchored([
        {
            kind: "destructive",
            label: "Discard",
            confirmLabel: "Discard 3",
            action: "/discard",
            fields: { ids: "a,b,c" },
        },
    ]);
    expect(html).toContain(
        '<div class="fd-menu__confirm" data-fd-menu-confirm><button type="button" class="fd-menu__item fd-menu__item--danger" role="menuitem" data-fd-menu-arm><span class="fd-menu__text"><span class="fd-menu__label">Discard</span></span></button><div class="fd-menu__confirm-row" role="group" aria-label="Confirm Discard 3" hidden>',
    );
    expect(html).toContain(
        '<button type="button" class="fd-menu__item" role="menuitem" data-fd-menu-cancel><span class="fd-menu__text"><span class="fd-menu__label">Cancel</span></span></button>',
    );
    expect(html).toContain(
        '<form class="fd-menu__form" method="post" action="/discard"><input type="hidden" name="ids" value="a,b,c"><button type="submit" class="fd-menu__item fd-menu__item--danger" role="menuitem"><span class="fd-menu__text"><span class="fd-menu__label">Discard 3</span></span></button></form>',
    );
    // No "Yes", no second popup.
    expect(html).not.toContain("Yes");
    expect(html).not.toContain("<dialog");
});

test("confirmLabel defaults to the label", () => {
    const html = anchored([
        { kind: "destructive", label: "Delete", action: "/d" },
    ]);
    expect(html.match(/>Delete</g)?.length).toBe(2);
});

test("a new item kind with no anchor opens as a ⋯ menu", () => {
    const html = String(
        menu({
            label: "L",
            items: [{ kind: "checked", label: "A", checked: true }],
        }),
    );
    expect(html).toContain("fd-menu--more");
    expect(html).not.toContain("<details");
});

test("anchored menus escape every string and refuse a javascript: link", async () => {
    const html = String(
        menu({
            label: XSS,
            anchor: "filter",
            filterCount: 1,
            items: [
                { kind: "link", label: XSS, hint: XSS, href: `/p?x=${XSS}` },
                {
                    kind: "checked",
                    label: XSS,
                    checked: true,
                    href: `/q?x=${XSS}`,
                },
                {
                    kind: "destructive",
                    label: XSS,
                    confirmLabel: XSS,
                    action: `/a${XSS}`,
                    fields: { [XSS]: XSS },
                },
            ],
        }),
    );
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
    expect(() =>
        menu({
            label: "x",
            anchor: "more",
            items: [
                {
                    kind: "checked",
                    label: "x",
                    checked: false,
                    href: "javascript:alert(1)",
                },
            ],
        }),
    ).toThrow();
});

test("the armed confirm row is a group named for what it confirms", () => {
    const html = anchored([
        {
            kind: "destructive",
            label: "Discard",
            confirmLabel: 'Discard "3"',
            action: "/d",
        },
    ]);
    expect(html).toContain(
        '<div class="fd-menu__confirm-row" role="group" aria-label="Confirm Discard &quot;3&quot;" hidden>',
    );
    const plain = anchored([
        { kind: "destructive", label: "Delete", action: "/d" },
    ]);
    expect(plain).toContain('role="group" aria-label="Confirm Delete"');
});

test("a danger post item is refused in an anchored menu, kept in the details menu", () => {
    const danger: MenuItem = {
        kind: "post",
        label: "Delete",
        action: "/d",
        danger: true,
    };
    expect(() => menu({ label: "x", anchor: "more", items: [danger] })).toThrow(
        /destructive/,
    );
    expect(() =>
        menu({
            label: "x",
            items: [
                danger,
                { kind: "destructive", label: "Wipe", action: "/w" },
            ],
        }),
    ).toThrow(/destructive/);
    expect(String(menu({ label: "x", items: [danger] }))).toContain(
        "fd-menu__item--danger",
    );
});

test("an opens item is a button that opens the named dialog, in the anchored menu", () => {
    const html = anchored([
        { kind: "opens", label: "Make owner", sheetId: "fd-owner" },
    ]);
    expect(html).toContain("fd-menu--anchored");
    expect(html).toContain(
        '<button type="button" class="fd-menu__item" role="menuitem" command="show-modal" commandfor="fd-owner"><span class="fd-menu__text"><span class="fd-menu__label">Make owner</span></span></button>',
    );
    // It is a menu item, not a form: it submits nothing.
    expect(html).not.toContain("<form");
});

test("an opens item escapes its label and dialog id", async () => {
    const html = anchored([{ kind: "opens", label: XSS, sheetId: XSS }]);
    expect(await injectedAttributes(html)).toEqual([]);
});

test("a checked item with an action posts its fields and keeps its tick", () => {
    const html = anchored([
        {
            kind: "checked",
            label: "Sunday",
            checked: true,
            action: "/settings/household/restock",
            fields: { restock_weekday: "0" },
        },
        {
            kind: "checked",
            label: "Monday",
            checked: false,
            action: "/settings/household/restock",
            fields: { restock_weekday: "1" },
        },
    ]);
    expect(html).toContain(
        '<form class="fd-menu__form" method="post" action="/settings/household/restock"><input type="hidden" name="restock_weekday" value="0"><button type="submit" class="fd-menu__item" role="menuitemcheckbox" aria-checked="true">',
    );
    expect(html).toContain('role="menuitemcheckbox" aria-checked="false"');
    expect(html.match(/<form /g)?.length).toBe(2);
});

test("a row menu is a whole-row pull-down: the trigger reads title, value and a chevron", () => {
    const html = String(
        menu({
            label: "Day",
            anchor: "row",
            row: { title: "Day", value: "Sunday" },
            items: [
                {
                    kind: "checked",
                    label: "Sunday",
                    checked: true,
                    action: "/p",
                    fields: { d: "0" },
                },
            ],
        }),
    );
    expect(html).toContain("fd-menu--row");
    expect(html).toContain('data-anchor="row"');
    expect(html).toContain(
        '<button type="button" class="fd-item-row__face fd-item-row__face--link fd-menu__row" data-fd-menu-trigger aria-haspopup="menu" aria-expanded="false">',
    );
    expect(html).toContain('<span class="fd-item-row__title"');
    expect(html).toContain('<span class="fd-item-row__value">Sunday</span>');
    expect(html).toContain("fd-item-row__chevron");
    expect(html).toContain('role="menu" aria-label="Day" hidden');
});

test("a row menu needs its row, and escapes it", async () => {
    expect(() => menu({ label: "x", anchor: "row", items: [] })).toThrow(/row/);
    const html = String(
        menu({
            label: XSS,
            anchor: "row",
            row: { title: XSS, value: XSS },
            items: [
                {
                    kind: "checked",
                    label: XSS,
                    checked: false,
                    action: XSS,
                    fields: { [XSS]: XSS },
                },
            ],
        }),
    );
    expect(await injectedAttributes(html)).toEqual([]);
});
