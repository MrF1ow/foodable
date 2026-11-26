import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";
import { menu, menuRow, type MenuItem } from "./menu.js";

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

test("a plain destructive item still asks in place but is not drawn in the danger tone", () => {
    const html = anchored([
        {
            kind: "destructive",
            label: "Align",
            action: "/a",
            plain: true,
        },
    ]);
    expect(html).toContain("data-fd-menu-confirm");
    expect(html).toContain(
        '<form class="fd-menu__form" method="post" action="/a">',
    );
    expect(html).not.toContain("fd-menu__item--danger");
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

test("the current tick of a pull-down only closes the menu: no form, nothing posted", () => {
    const html = anchored([
        { kind: "checked", label: "40%", checked: true, current: true },
        {
            kind: "checked",
            label: "50%",
            checked: false,
            action: "/settings/product-score",
            fields: { preset: "custom" },
        },
    ]);
    expect(html).toContain(
        'class="fd-menu__item" role="menuitemcheckbox" aria-checked="true" data-fd-menu-close>',
    );
    expect(html.match(/<form /g)?.length).toBe(1);
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

test("a row menu is a whole-row pull-down: the trigger reads title and value, and shows no chevron", () => {
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
    // A drop-down opens in place, so it carries no chevron.
    expect(html).not.toContain("fd-item-row__chevron");
    expect(html).not.toContain("fd-icon--chevron-right");
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

test("an opens item can be marked danger: red label, the sheet is the confirm step", () => {
    const html = menu({
        label: "Actions",
        items: [
            { kind: "opens", label: "Delete", sheetId: "fd-del", danger: true },
            { kind: "opens", label: "Other", sheetId: "fd-other" },
        ],
    });
    expect(html).toContain(
        `<button type="button" class="fd-menu__item fd-menu__item--danger" role="menuitem" command="show-modal" commandfor="fd-del">`,
    );
    expect(html).toContain(
        `<button type="button" class="fd-menu__item" role="menuitem" command="show-modal" commandfor="fd-other">`,
    );
});

test("a button item is a plain button the page script reads, and closes the menu", () => {
    const html = anchored([
        {
            kind: "button",
            label: "Select",
            data: { "fd-select-toggle": "saved" },
        },
    ]);
    expect(html).toContain("fd-menu--anchored");
    expect(html).toContain(
        '<button type="button" class="fd-menu__item" role="menuitem" data-fd-menu-close data-fd-select-toggle="saved"><span class="fd-menu__text"><span class="fd-menu__label">Select</span></span></button>',
    );
    expect(html).not.toContain("<form");
});

test("an opens item can say what the shared sheet holds when it opens", () => {
    const html = anchored([
        {
            kind: "opens",
            label: "Edit",
            sheetId: "fd-saved-edit",
            set: {
                "@action": "/items/1",
                name: 'Eggs "large"',
                allergens: ["egg", "milk"],
            },
        },
    ]);
    expect(html).toContain(
        `command="show-modal" commandfor="fd-saved-edit" data-fd-menu-set="{&quot;@action&quot;:&quot;/items/1&quot;,&quot;name&quot;:&quot;Eggs \\&quot;large\\&quot;&quot;,&quot;allergens&quot;:[&quot;egg&quot;,&quot;milk&quot;]}"`,
    );
    // Without it the markup is what it was.
    expect(
        anchored([{ kind: "opens", label: "Edit", sheetId: "x" }]),
    ).not.toContain("data-fd-menu-set");
});

test("a row menu's trigger can carry a subtitle under the title", () => {
    const html = String(
        menu({
            label: "Nutrition weight",
            anchor: "row",
            row: { title: "Nutrition", subtitle: "Nutri-Score", value: "40%" },
            items: [
                { kind: "checked", label: "40", checked: true, action: "/p" },
            ],
        }),
    );
    expect(html).toContain(
        '<span class="fd-item-row__subtitle">Nutri-Score</span>',
    );
    expect(html).toContain('<span class="fd-item-row__value">40%</span>');
    expect(
        String(
            menu({
                label: "x",
                anchor: "row",
                row: { title: "T", value: "V" },
                items: [],
            }),
        ),
    ).not.toContain("fd-item-row__subtitle");
});

test("an anchored menu panel paints above the phone Nav bar and scrolls inside when it is long", () => {
    const css = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/menu.css"),
        "utf8",
    );
    const panel = css.match(
        /\.fd-menu--anchored \.fd-menu__panel \{[^}]*\}/,
    )![0];
    // The Nav bar is z-index 50.
    expect(Number(panel.match(/z-index:\s*(\d+)/)![1])).toBeGreaterThan(50);
    expect(panel).toContain("overflow-y: auto");
});

test("a note is a dimmed, disabled item that says why, and not a button or a form", () => {
    const html = String(
        menu({
            label: "Actions for Cleared 20 grocery lines",
            items: [{ kind: "note", label: "Sam or the owner can undo" }],
        }),
    );
    // A note alone still makes the anchored form (it needs the script's keys).
    expect(html).toContain("fd-menu--anchored");
    expect(html).toContain('role="menu"');
    expect(html).toContain(
        `<div class="fd-menu__item fd-menu__note" role="menuitem" aria-disabled="true" tabindex="-1"><span class="fd-menu__text"><span class="fd-menu__label">Sam or the owner can undo</span></span></div>`,
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    const escaped = String(
        menu({ label: "x", items: [{ kind: "note", label: XSS }] }),
    );
    expect(escaped).toContain(XSS_ESCAPED);
    expect(injectedAttributes(escaped)).resolves.toEqual([]);
});

test("the tick column is a flex box, so the 24 px tick centres on the label's line", () => {
    const css = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/menu.css"),
        "utf8",
    );
    const check = css.match(/\.fd-menu__check \{[^}]*\}/)![0];
    expect(check).toContain("display: flex");
    expect(check).toContain("align-items: center");
    expect(check).not.toContain("display: grid");
});

test("a pull-down with a field keeps its choice in a hidden input and tags each item with its value", () => {
    const html = menu({
        label: "Unit",
        anchor: "row",
        row: { title: "Unit", value: "count" },
        field: { name: "usual_unit", value: "each" },
        items: [
            { kind: "checked", label: "count", checked: true, value: "each" },
            { kind: "checked", label: "No amount", checked: false, value: "" },
        ],
    });
    expect(html).toContain(
        '<input type="hidden" name="usual_unit" value="each" data-fd-menu-field>',
    );
    expect(html).toContain('data-fd-menu-value="each"');
    expect(html).toContain('data-fd-menu-value=""');
    // No form is posted: the items are buttons the menu script reads.
    expect(html).not.toContain("<form");
});

test("a menu row is the row menu in its list item, and nothing else", () => {
    const html = String(
        menuRow({
            label: "Store",
            row: { title: "Store", value: "Costco" },
            items: [{ kind: "checked", label: "Costco", checked: true }],
        }),
    );
    expect(html.startsWith('<li class="fd-item-row"><div class="fd-menu')).toBe(
        true,
    );
    expect(html.endsWith("</div></li>")).toBe(true);
    expect(html).toContain('data-anchor="row"');
});

test("a link menu hangs from a small Link button that reads its own label", () => {
    const html = menu({
        label: "Whose version",
        anchor: "link",
        link: { label: "Per serving · Ethan", icon: "users" },
        items: [
            {
                kind: "checked",
                label: "Base",
                checked: false,
                href: "/r?member=base",
            },
            { kind: "checked", label: "Ethan", checked: true, href: "/r" },
            { kind: "link", label: "Compare versions", href: "/r/compare" },
        ],
    });
    expect(html).toContain("fd-menu--link");
    expect(html).toContain('data-anchor="link"');
    const trigger = html.match(
        /<button[^>]*data-fd-menu-trigger[^>]*>[\s\S]*?<\/button>/,
    )![0];
    expect(trigger).toContain("fd-btn--link");
    expect(trigger).toContain("fd-btn--sm");
    expect(trigger).toContain("fd-icon--users");
    expect(trigger).toContain("Per serving · Ethan");
    // The label is the words; there is no aria-label saying something else.
    expect(trigger).not.toContain("aria-label");
    expect(html).toContain(
        '<div class="fd-menu__panel" role="menu" aria-label="Whose version" hidden>',
    );
    expect(html).toContain('href="/r/compare"');
});

test("a link menu needs its link", () => {
    expect(() =>
        menu({
            label: "x",
            anchor: "link",
            items: [{ kind: "link", label: "a", href: "/a" }],
        }),
    ).toThrow("link menu needs its link");
});

test("a field that is a list posts its name once per value", () => {
    const html = menu({
        label: "Actions",
        items: [
            {
                kind: "destructive",
                label: "Delete",
                action: "/reset",
                fields: { user_id: "u1", row_keys: ["a@1", "b@2"] },
            },
        ],
    });
    expect(html).toContain('<input type="hidden" name="user_id" value="u1">');
    expect(html).toContain('<input type="hidden" name="row_keys" value="a@1">');
    expect(html).toContain('<input type="hidden" name="row_keys" value="b@2">');
    const none = menu({
        label: "Actions",
        items: [
            {
                kind: "destructive",
                label: "Delete",
                action: "/reset",
                fields: { row_keys: [] },
            },
        ],
    });
    expect(none).not.toContain('name="row_keys"');
});
