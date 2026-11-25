import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { icon } from "./icon.js";
import { itemRow } from "./item-row.js";
import { raw } from "./html.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

const MACROS = { protein: 26, carbs: 0, fat: 11 };

test("a row is an li holding a face with the text block", () => {
    const html = itemRow({ title: "Eggs" });
    expect(html).toStartWith(`<li class="fd-item-row">`);
    expect(html).toContain(`<div class="fd-item-row__face">`);
    expect(html).toContain(
        `<span class="fd-item-row__title" title="Eggs">Eggs</span>`,
    );
    expect(html).not.toContain("__lead");
    expect(html).not.toContain("__value");
    expect(html).not.toContain("__sub");
});

test("title, meta, subtitle and value each have their own element", () => {
    const html = itemRow({
        title: "Eggs",
        meta: "9",
        subtitle: "In your fridge",
        value: "Nov 19",
    });
    expect(html).toContain(`<span class="fd-item-row__meta">9</span>`);
    expect(html).toContain(
        `<span class="fd-item-row__subtitle">In your fridge</span>`,
    );
    expect(html).toContain(`<span class="fd-item-row__value">Nov 19</span>`);
});

test("an empty meta, subtitle or value draws nothing", () => {
    const html = itemRow({ title: "Eggs", meta: "", subtitle: "", value: "" });
    expect(html).not.toContain("__meta");
    expect(html).not.toContain("__subtitle");
    expect(html).not.toContain("__value");
});

test("the Checkbox lead is a real checkbox named after the row, unchecked by default", () => {
    const html = itemRow({
        title: "Milk",
        lead: { kind: "checkbox", label: "Milk" },
    });
    expect(html).toContain(
        `<label class="fd-item-row__lead fd-item-row__check">`,
    );
    expect(html).toContain(
        `<input type="checkbox" class="fd-item-row__check-input" aria-label="Milk">`,
    );
    expect(html).toContain(`<span class="fd-item-row__check-box"`);
});

test("a checked Checkbox lead posts under its name and value", () => {
    const html = itemRow({
        title: "Milk",
        lead: {
            kind: "checkbox",
            label: "Milk",
            checked: true,
            name: "ids[]",
            value: "7",
        },
    });
    expect(html).toContain(
        `<input type="checkbox" class="fd-item-row__check-input" name="ids[]" value="7" checked aria-label="Milk">`,
    );
});

test("the Radio lead is a ring in a group, and the row is its label", () => {
    const html = itemRow({
        title: "America/Denver",
        value: "UTC-7",
        lead: {
            kind: "radio",
            label: "America/Denver",
            name: "timezone",
            value: "America/Denver",
            checked: true,
        },
    });
    expect(html).toContain(
        `<label class="fd-item-row__face fd-item-row__face--choice">`,
    );
    expect(html).toContain(
        `<input type="radio" class="fd-item-row__check-input" name="timezone" value="America/Denver" checked aria-label="America/Denver">`,
    );
    // The lead is a span inside the label: labels do not nest.
    expect(html).toContain(
        `<span class="fd-item-row__lead fd-item-row__check fd-item-row__check--radio">`,
    );
    expect(html.match(/<label/g)).toHaveLength(1);
    expect(() =>
        itemRow({
            title: "x",
            href: "/x",
            lead: { kind: "radio", label: "x", name: "n", value: "v" },
        }),
    ).toThrow("link row");
});

test("a submit row is one button holding the face, inside its own form", () => {
    const html = itemRow({
        title: "Export data",
        value: "ZIP",
        lead: { kind: "icon", name: "download" },
        submit: {
            action: "/settings/export",
            formData: { turbo: "false" },
        },
    });
    expect(html).toContain(
        `<form class="fd-inline-form" method="post" action="/settings/export" data-turbo="false">`,
    );
    expect(html).toContain(
        `<button type="submit" class="fd-item-row__face fd-item-row__face--link">`,
    );
    expect(html).toContain(`<span class="fd-item-row__value">ZIP</span>`);
    expect(() =>
        itemRow({ title: "x", href: "/x", submit: { action: "/y" } }),
    ).toThrow("link or a button");
    expect(() =>
        itemRow({
            title: "x",
            submit: { action: "/y" },
            trailing: { kind: "add", label: "Add" },
        }),
    ).toThrow("link row");
});

test("a link row can carry data attributes on its link", () => {
    const html = itemRow({
        title: "Log out",
        href: "/logout",
        linkData: { turbo: "false" },
    });
    expect(html).toContain(
        `<a class="fd-item-row__face fd-item-row__face--link" href="/logout" data-turbo="false">`,
    );
});

test("an opens row is a button that shows the sheet", () => {
    const html = itemRow({
        title: "Name",
        value: "Ethan Flow",
        trailing: { kind: "chevron" },
        opens: "fd-account-name",
    });
    expect(html).toContain(
        `<button type="button" class="fd-item-row__face fd-item-row__face--link" commandfor="fd-account-name" command="show-modal">`,
    );
    expect(html).toContain("fd-item-row__chevron");
});

test("the Avatar lead shows initials and is decorative", () => {
    const html = itemRow({
        title: "Sam",
        lead: { kind: "avatar", initials: "S" },
    });
    expect(html).toContain(
        `<span class="fd-item-row__lead fd-item-row__avatar" aria-hidden="true">S</span>`,
    );
});

test("the Avatar lead puts a member's picture over the initials only when one is set", () => {
    const withPicture = itemRow({
        title: "Sam",
        lead: {
            kind: "avatar",
            initials: "S",
            picture: { userId: "u 1", version: 1700000000000 },
        },
    });
    expect(withPicture).toContain(
        "fd-avatar fd-item-row__lead fd-item-row__avatar fd-avatar--photo",
    );
    expect(withPicture).toContain('src="/avatars/u%201?v=1700000000000"');
    expect(withPicture).toContain(">S<img");
    const without = itemRow({
        title: "Sam",
        lead: {
            kind: "avatar",
            initials: "S",
            picture: { userId: "u1", version: null },
        },
    });
    expect(without).not.toContain("<img");
    expect(without).toContain(
        `<span class="fd-item-row__lead fd-item-row__avatar" aria-hidden="true">S</span>`,
    );
});

test("the Icon lead draws the named design icon", () => {
    const html = itemRow({
        title: "Show cards in chat",
        lead: { kind: "icon", name: "cart" },
    });
    expect(html).toContain(
        `<span class="fd-item-row__lead fd-item-row__icon">${icon("cart")}</span>`,
    );
});

test("the Dot lead is the accent dot, or the colour asked for", () => {
    expect(itemRow({ title: "Salmon", lead: { kind: "dot" } })).toContain(
        `<span class="fd-item-row__lead fd-item-row__dot fd-dot--good" aria-hidden="true"></span>`,
    );
    expect(
        itemRow({ title: "Salmon", lead: { kind: "dot", color: "warn" } }),
    ).toContain("fd-dot--warn");
});

test("Score and Macros sit in the text block, the score on the title line", () => {
    const html = itemRow({
        title: "Eggs",
        score: 74,
        subtitle: "In your fridge",
        macros: MACROS,
    });
    const main = html.slice(html.indexOf("fd-item-row__main"));
    expect(main.indexOf("fd-score")).toBeLessThan(main.indexOf("__subtitle"));
    expect(main.indexOf("__subtitle")).toBeLessThan(main.indexOf("fd-macros"));
    expect(html).toContain(`<span class="fd-sr">Protein </span>26`);
    expect(html).toContain(`aria-label="Product score 74 of 100, good"`);
});

test("a score that is not a number draws no badge", () => {
    expect(itemRow({ title: "Eggs", score: null })).not.toContain("fd-score");
});

test("Chevron is decorative", () => {
    const html = itemRow({ title: "Milk", trailing: { kind: "chevron" } });
    expect(html).toContain(
        `<span class="fd-item-row__trail fd-item-row__chevron" aria-hidden="true">${icon("chevron-right")}</span>`,
    );
});

test("More is a button named after what it opens", () => {
    const html = itemRow({
        title: "Eggs",
        trailing: { kind: "more", label: "More for Eggs" },
    });
    expect(html).toContain(
        `<button type="button" class="fd-item-row__trail fd-item-row__more" aria-label="More for Eggs" aria-haspopup="menu">${icon("more")}</button>`,
    );
});

test("Add is a round button, a submit button inside a form when given one", () => {
    const plain = itemRow({
        title: "Chicken",
        trailing: { kind: "add", label: "Add Chicken" },
    });
    expect(plain).toContain(
        `<button type="button" class="fd-item-row__trail fd-item-row__add" aria-label="Add Chicken">${icon("plus")}</button>`,
    );
    const form = itemRow({
        title: "Chicken",
        trailing: {
            kind: "add",
            label: "Add Chicken",
            form: { action: "/log", fields: { id: "1" } },
        },
    });
    expect(form).toContain(
        `<form class="fd-inline-form" method="post" action="/log"><input type="hidden" name="id" value="1"><button type="submit"`,
    );
});

test("Add with an href is a link that still goes there with no script", () => {
    const html = itemRow({
        title: "Nothing yet",
        trailing: {
            kind: "add",
            label: "Log lunch",
            href: "/#log",
            data: { "open-sheet": "x" },
        },
    });
    expect(html).toContain(
        `<a class="fd-item-row__trail fd-item-row__add" href="/#log" aria-label="Log lunch" data-open-sheet="x">${icon("plus")}</a>`,
    );
});

test("Toggle is a switch with aria-checked for On and Off", () => {
    const on = itemRow({
        title: "Show cards",
        trailing: { kind: "toggle", on: true, label: "Show cards" },
    });
    expect(on).toContain(`role="switch"`);
    expect(on).toContain(`aria-checked="true"`);
    expect(on).toContain(`fd-item-row__toggle`);
    expect(on).toContain(`<span class="fd-item-row__knob"></span>`);
    const off = itemRow({
        title: "Show cards",
        trailing: { kind: "toggle", on: false, label: "Show cards" },
    });
    expect(off).toContain(`aria-checked="false"`);
});

test("Control takes the caller's markup in a slot", () => {
    const html = itemRow({
        title: "Whose",
        trailing: { kind: "control", html: raw(`<b>seg</b>`) },
    });
    expect(html).toContain(
        `<span class="fd-item-row__trail fd-item-row__control"><b>seg</b></span>`,
    );
});

test("the value comes before the trailing control", () => {
    const html = itemRow({
        title: "Eggs",
        value: "Nov 19",
        trailing: { kind: "more", label: "More" },
    });
    expect(html.indexOf("__value")).toBeLessThan(html.indexOf("__more"));
});

test("a disabled row is greyed, aria-disabled, and its controls are disabled", () => {
    const html = itemRow({
        title: "Milk",
        state: "disabled",
        lead: { kind: "checkbox", label: "Milk" },
        trailing: { kind: "toggle", on: false, label: "Milk" },
    });
    expect(html).toStartWith(`<li class="fd-item-row fd-item-row--disabled"`);
    expect(html).toContain(`aria-disabled="true"`);
    expect(html).toContain(
        `<input type="checkbox" class="fd-item-row__check-input" disabled`,
    );
    expect(html).toMatch(/<button[^>]* disabled/);
    expect(html).toContain("Milk"); // greyed, not removed
});

test("a disabled row draws no swipe beds and no pick that can be ticked", () => {
    const swiped = itemRow({
        title: "Milk",
        state: "disabled",
        swipe: {
            left: { form: { action: "/x" } },
            right: { form: { action: "/y" } },
            open: "left",
        },
    });
    expect(swiped).not.toContain("__bed");
    expect(swiped).not.toContain("fd-item-row--swipe");
    expect(swiped).not.toContain("data-swipe-open");
    expect(swiped).not.toContain("<button");
    const picked = itemRow({ title: "Milk", state: "disabled", select: true });
    expect(picked).toMatch(/<input[^>]*data-fd-select-item[^>]* disabled/);
    expect(picked).not.toContain("data-fd-select-row");
});

test("a disabled link row is not a link: no href, no anchor, still its words", () => {
    const html = itemRow({
        title: "Eggs",
        href: "/foods/1",
        state: "disabled",
        trailing: { kind: "chevron" },
    });
    expect(html).not.toContain("href");
    expect(html).not.toContain("<a ");
    expect(html).toContain(`aria-disabled="true"`);
    expect(html).toContain("Eggs");
    const picked = itemRow({
        title: "Eggs",
        href: "/foods/1",
        state: "disabled",
        select: true,
    });
    expect(picked).not.toContain("href");
    expect(picked).not.toContain("<a ");
    expect(picked).toContain("data-fd-select-item");
});

test("a warning row says it in words", () => {
    const html = itemRow({
        title: "Milk",
        state: "warning",
        subtitle: "low now",
    });
    expect(html).toContain(`fd-item-row--warning`);
    expect(html).toContain("low now");
    expect(() => itemRow({ title: "Milk", state: "warning" })).toThrow(/words/);
});

test("a link row makes the whole face the link", () => {
    const html = itemRow({
        title: "Milk",
        href: "/kitchen/1",
        trailing: { kind: "chevron" },
    });
    expect(html).toContain(
        `<a class="fd-item-row__face fd-item-row__face--link" href="/kitchen/1">`,
    );
});

test("a link row cannot hold another control", () => {
    expect(() =>
        itemRow({
            title: "Milk",
            href: "/x",
            trailing: { kind: "more", label: "More" },
        }),
    ).toThrow();
    expect(() =>
        itemRow({
            title: "Milk",
            href: "/x",
            lead: { kind: "checkbox", label: "Milk" },
        }),
    ).toThrow();
    expect(() =>
        itemRow({ title: "Milk", href: "javascript:alert(1)" }),
    ).toThrow();
});

test("swipe puts the Delete bed on the right and the Again bed on the left, icons only", () => {
    const html = itemRow({
        title: "Eggs",
        swipe: {
            left: { form: { action: "/meals/1/delete" } },
            right: { form: { action: "/meals/1/again" } },
        },
    });
    expect(html).toContain(`fd-item-row--swipe`);
    expect(html).toContain(
        `<div class="fd-item-row__bed fd-item-row__bed--again">`,
    );
    expect(html).toContain(
        `<div class="fd-item-row__bed fd-item-row__bed--delete">`,
    );
    expect(html).toContain(`aria-label="Again"`);
    expect(html).toContain(`aria-label="Delete"`);
    expect(html).toContain(icon("repeat"));
    expect(html).toContain(icon("trash"));
    expect(html).toContain(`action="/meals/1/delete"`);
    // The beds sit behind the face.
    expect(html.indexOf("--again")).toBeLessThan(html.indexOf("__face"));
    expect(html.indexOf("__face")).toBeLessThan(html.indexOf("--delete"));
    expect(html).not.toContain("fd-item-row__bed-text");
});

test("a swipe with one side draws one bed, and open starts it swiped", () => {
    const html = itemRow({
        title: "Eggs",
        swipe: { left: {}, open: "left" },
    });
    expect(html).toContain(`data-swipe-open="left"`);
    expect(html).toContain("--delete");
    expect(html).not.toContain("--again");
});

test("a row without swipe has no beds", () => {
    expect(itemRow({ title: "Eggs" })).not.toContain("__bed");
});

test("select mode shows the pick box, wired for the list's select client", () => {
    const html = itemRow({
        title: "Eggs",
        select: { name: "ids[]", value: "3" },
    });
    expect(html).toContain(`fd-item-row--select`);
    expect(html).toContain(` data-fd-select-row`);
    expect(html).toContain(
        `<input type="checkbox" class="fd-item-row__select-input" data-fd-select-item name="ids[]" value="3" aria-label="Select Eggs">`,
    );
    expect(itemRow({ title: "Eggs", select: true })).toContain(
        `<input type="checkbox" class="fd-item-row__select-input" data-fd-select-item aria-label="Select Eggs">`,
    );
});

test("a selectable row can also swipe, and its pick box sits in the face", () => {
    const html = itemRow({
        title: "Eggs",
        select: { name: "ids[]", value: "3" },
        swipe: { left: { form: { action: "/x" } } },
    });
    expect(html).toContain("fd-item-row--swipe");
    expect(html).toContain("fd-item-row--select");
    expect(html).toContain(" data-fd-select-row");
    expect(html).toContain("fd-item-row__bed--delete");
    expect(html).toMatch(
        /<div class="fd-item-row__face"><label class="fd-item-row__select">/,
    );
});

test("a selectable link row keeps the pick box beside the link, not inside it", () => {
    const html = itemRow({
        title: "Eggs",
        href: "/foods/1",
        trailing: { kind: "chevron" },
        select: true,
    });
    expect(html).toContain(
        `<div class="fd-item-row__face fd-item-row__face--link"><label class="fd-item-row__select">`,
    );
    expect(html).toMatch(
        /<\/label><a class="fd-item-row__anchor" href="\/foods\/1">/,
    );
    const anchor = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
    expect(anchor).not.toContain("<input");
});

test("the pick box is hidden until the list is in select mode", () => {
    const css = readFileSync("./public/app/v2/item-row.css", "utf8");
    expect(css).toMatch(/\.fd-item-row__select \{\s*display: none;/);
    expect(css).toMatch(
        /\[data-fd-selecting\] \.fd-item-row__select \{[^}]*display: grid/,
    );
});

test("in select mode the row only picks: trailing, value and beds step aside, the pick ring fills", () => {
    const css = readFileSync("./public/app/v2/item-row.css", "utf8");
    const rules = [
        ...css.matchAll(/(\[data-fd-selecting\][^{}]*)\{([^{}]*)\}/g),
    ].map((m) => ({ sel: m[1]!, body: m[2]! }));
    const hiding = rules.filter((r) => /display:\s*none/.test(r.body));
    const hidden = hiding.map((r) => r.sel).join(" ");
    for (const part of ["__trail", "__value", "__bed"]) {
        expect(hidden).toContain(part);
    }
    // Every selecting rule is scoped to a selectable row.
    for (const r of rules) {
        expect(r.sel).toMatch(/\[data-fd-selecting\]/);
    }
    // The design draws the pick as the Checkbox ring, filled when picked, and
    // leaves the row itself untinted.
    expect(rules.some((r) => r.sel.includes(":has("))).toBe(false);
    expect(css).toMatch(
        /\.fd-item-row__select-input:checked \+ \.fd-item-row__select-box \{[^}]*background: var\(--accent-fill\)/,
    );
    expect(
        rules.some(
            (r) => r.sel.includes("__face") && /cursor:\s*pointer/.test(r.body),
        ),
    ).toBe(true);
});

test("an id and a class name pass through", () => {
    const html = itemRow({ title: "Eggs", id: "row-1", className: "extra" });
    expect(html).toContain(`class="fd-item-row extra"`);
    expect(html).toContain(`id="row-1"`);
});

test("every string is escaped", () => {
    const html = itemRow({
        title: XSS,
        meta: XSS,
        subtitle: XSS,
        value: XSS,
        id: XSS,
        className: XSS,
        lead: { kind: "avatar", initials: XSS },
        trailing: { kind: "more", label: XSS },
        macros: { protein: XSS, carbs: XSS, fat: XSS },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain(XSS_ESCAPED);
    const checkbox = itemRow({
        title: "x",
        lead: { kind: "checkbox", label: XSS, name: XSS, value: XSS },
        swipe: {
            left: { label: XSS, data: { x: XSS } },
            right: { label: XSS },
        },
    });
    expect(checkbox).not.toContain("<script>");
});

test("a picked row starts ticked, a disabled one never", () => {
    expect(
        itemRow({
            title: "Eggs",
            select: { name: "ids[]", value: "1", checked: true },
        }),
    ).toContain(" checked");
    expect(
        itemRow({
            title: "Eggs",
            state: "disabled",
            select: { name: "ids[]", value: "1", checked: true },
        }),
    ).not.toContain(" checked");
});

test("a disabled row's control slot is inert, an enabled one's is not", () => {
    const trailing = {
        kind: "control" as const,
        html: raw(`<button type="button">+</button>`),
    };
    const off = itemRow({ title: "Milk", state: "disabled", trailing });
    expect(off).toContain(
        `<span class="fd-item-row__trail fd-item-row__control" inert>`,
    );
    // Only the slot: the row's words stay readable.
    expect(off).not.toMatch(/<div class="fd-item-row__face"[^>]* inert/);
    const on = itemRow({ title: "Milk", trailing });
    expect(on).not.toContain("inert");
});

test("open only starts swiped on a side that has a bed", () => {
    const wrongSide = itemRow({
        title: "Eggs",
        swipe: { right: {}, open: "left" },
    });
    expect(wrongSide).toContain("--again");
    expect(wrongSide).not.toContain("data-swipe-open");
    const wrongSideOther = itemRow({
        title: "Eggs",
        swipe: { left: {}, open: "right" },
    });
    expect(wrongSideOther).not.toContain("data-swipe-open");
    const right = itemRow({
        title: "Eggs",
        swipe: { left: {}, right: {}, open: "right" },
    });
    expect(right).toContain(`data-swipe-open="right"`);
});

test("a swipe face takes the card's colour inside a card list group", () => {
    const css = readFileSync("./public/app/v2/item-row.css", "utf8");
    // The row must not set the face colour on itself, or it would shadow the
    // value a card list group hands down.
    const row = css.match(/^\.fd-item-row \{([^}]*)\}/m)?.[1] ?? "";
    expect(row).not.toContain("--fd-item-row-face");
    expect(css).toContain(
        "background: var(--fd-item-row-face, var(--surface-bg));",
    );
    expect(css).toMatch(
        /\.fd-list-group--card \{[^}]*--fd-item-row-face: var\(--surface-panel\)/,
    );
});

test("a reorder row has a handle, its id in a hidden field and the two arrows", () => {
    const html = itemRow({
        title: "Costco",
        subtitle: "6 sections",
        reorder: {
            name: "order",
            value: "s1",
            label: "Costco",
            canUp: false,
            canDown: true,
        },
    });
    expect(html).toContain(`fd-item-row--reorder" data-fd-order-item>`);
    expect(html).toContain(`<input type="hidden" name="order" value="s1">`);
    expect(html).toContain(
        `<span class="fd-item-row__lead fd-item-row__handle" data-fd-order-handle aria-hidden="true">`,
    );
    expect(html).toContain(`<span class="fd-item-row__subtitle">6 sections`);
    // The end of the list has no arrow past it.
    expect(html).toMatch(
        /name="move" value="s1:up"[^>]*aria-label="Move Costco up" disabled/,
    );
    expect(html).toMatch(
        /name="move" value="s1:down"[^>]*aria-label="Move Costco down">/,
    );
    expect(html).not.toMatch(/value="s1:down"[^>]*disabled/);
});

test("a reorder row escapes what it prints", () => {
    const html = itemRow({
        title: XSS,
        reorder: {
            name: "order",
            value: XSS,
            label: XSS,
            canUp: true,
            canDown: true,
        },
    });
    expect(html).not.toContain(XSS);
    expect(html).toContain(XSS_ESCAPED);
});

test("an edit row is a form with a field, Save and Cancel", () => {
    const html = itemRow({
        id: "sec-1",
        title: "Bakery",
        edit: {
            action: "/s/1/rename",
            name: "name",
            value: "Bakery",
            label: "Section name",
            maxlength: 80,
            cancelHref: "/s/1",
            fields: { a: "b" },
        },
    });
    expect(html).toContain(`fd-item-row--edit`);
    expect(html).toContain(`method="post" action="/s/1/rename"`);
    expect(html).toContain(`<input type="hidden" name="a" value="b">`);
    // The field is field(): the label is hidden but names the input.
    expect(html).toContain(
        `<span class="fd-visually-hidden">Section name</span>`,
    );
    expect(html).toMatch(
        /<input[^>]*id="sec-1-field" name="name" type="text" value="Bakery" autocomplete="off" maxlength="80" required autofocus data-fd-autofocus="">/,
    );
    expect(html).not.toContain("aria-invalid");
    expect(html).toContain(`aria-label="Save"`);
    expect(html).toContain(`href="/s/1" aria-label="Cancel"`);
});

test("a refused edit row marks its field aria-invalid with the error tied to it", () => {
    const html = itemRow({
        id: "sec-1",
        title: "Bakery",
        edit: {
            action: "/x",
            name: "name",
            value: "Bakery",
            label: "Section name",
            cancelHref: "/s/1",
            error: "That section already exists.",
        },
    });
    expect(html).toContain(`aria-invalid="true"`);
    expect(html).toContain(`aria-describedby="sec-1-field-error"`);
    expect(html).toContain(
        `<span class="fd-field__error" id="sec-1-field-error">That section already exists.</span>`,
    );
});

test("an edit row needs an id for its field", () => {
    expect(() =>
        itemRow({
            title: "A",
            edit: {
                action: "/x",
                name: "n",
                value: "v",
                label: "L",
                cancelHref: "/",
            },
        }),
    ).toThrow(/needs an id/);
});

test("a reorder or edit row is only a title, so any other option throws", () => {
    const reorder = {
        name: "order",
        value: "a",
        label: "A",
        canUp: true,
        canDown: true,
    };
    expect(() =>
        itemRow({ title: "A", reorder, trailing: { kind: "chevron" } }),
    ).toThrow(/reorder row is only a title/);
    expect(() => itemRow({ title: "A", reorder, href: "/a" })).toThrow();
    const edit = {
        action: "/x",
        name: "n",
        value: "v",
        label: "L",
        cancelHref: "/",
    };
    expect(() => itemRow({ id: "e", title: "A", edit, value: "1" })).toThrow(
        /edit row is only a title/,
    );
    expect(() => itemRow({ id: "e", title: "A", edit, reorder })).toThrow();
});

test("an input row is the title as the label of one autosaving input, with its unit", () => {
    const html = itemRow({
        title: "Calories",
        input: {
            id: "goals-daily-calories",
            action: "/settings/goals/field",
            fields: { field: "daily_calories" },
            value: "2200",
            unit: "kcal",
            placeholder: "Not set",
        },
    });
    expect(html).toStartWith(`<li class="fd-item-row fd-item-row--input">`);
    expect(html).toContain(
        `<form class="fd-autosave-input fd-item-row__face" method="post" action="/settings/goals/field" data-fd-autosave>`,
    );
    expect(html).toContain(
        `<span class="fd-autosave-input__label">Calories</span>`,
    );
    expect(html).toContain(`data-fd-autosave-input`);
    expect(html).toContain(`<span class="fd-autosave-input__unit">kcal</span>`);
    expect(html).not.toContain("fd-item-row__chevron");
});

test("an input row can end in a chevron, hide its label and show a refusal", () => {
    const html = itemRow({
        title: "Goal name",
        input: {
            id: "n",
            action: "/x",
            value: "",
            labelHidden: true,
            chevron: true,
            error: "Too long.",
        },
    });
    expect(html).toContain("fd-item-row--input fd-item-row--input-chevron");
    expect(html).toContain("fd-autosave-input--bare");
    expect(html).toContain(`<span class="fd-visually-hidden">Goal name</span>`);
    expect(html).toContain("fd-item-row__chevron");
    expect(html).toContain(`aria-invalid="true"`);
    expect(html).toContain(`role="alert">Too long.</p>`);
});

test("an input row is only a title and its input, so any other option throws", () => {
    const input = { id: "n", action: "/x", value: "1" };
    for (const extra of [
        { href: "/a" },
        { trailing: { kind: "chevron" as const } },
        { value: "v" },
        { lead: { kind: "icon" as const, name: "plus" as const } },
        { select: true },
    ]) {
        expect(() => itemRow({ title: "A", input, ...extra })).toThrow(
            /only a title and its input/,
        );
    }
});

test("a disabled toggle is a real switch that is held: off, nothing to press, no form, described by the reason", () => {
    const html = itemRow({
        id: "own",
        title: "Your agents can delete",
        subtitle: "Turned off for the household by Ethan",
        trailing: {
            kind: "toggle",
            on: false,
            label: "Your agents can delete",
            disabled: true,
        },
    });
    expect(html).toMatch(
        /<button type="button" class="fd-item-row__trail fd-item-row__toggle" aria-label="Your agents can delete" disabled role="switch" aria-checked="false" aria-describedby="own-reason">/,
    );
    expect(html).toContain(
        '<span class="fd-item-row__subtitle" id="own-reason">Turned off for the household by Ethan</span>',
    );
    expect(html).not.toContain("<form");
    // A live toggle, or a held one with no row id or reason, names no reason.
    const live = itemRow({
        id: "own",
        title: "T",
        subtitle: "S",
        trailing: { kind: "toggle", on: true, label: "T" },
    });
    expect(live).not.toContain("aria-describedby");
    expect(live).not.toContain("own-reason");
    expect(live).not.toContain("disabled");
    const bare = itemRow({
        title: "T",
        trailing: { kind: "toggle", on: false, label: "T", disabled: true },
    });
    expect(bare).toContain("disabled");
    expect(bare).not.toContain("aria-describedby");
});

test("a disclosure row is a details whose summary is the face and whose body is the answer", () => {
    const html = itemRow({
        id: "put-away",
        title: "Put away",
        disclosure: { answer: raw("<p>It moves the amount.</p>") },
    });
    expect(html).toStartWith(
        `<li class="fd-item-row fd-item-row--disclosure"><details class="fd-item-row__disclosure" id="put-away">`,
    );
    expect(html).toContain(
        `<summary class="fd-item-row__face fd-item-row__face--link"><span class="fd-item-row__main"><span class="fd-item-row__line"><span class="fd-item-row__title" title="Put away">Put away</span></span></span><span class="fd-item-row__trail fd-item-row__chevron" aria-hidden="true">`,
    );
    expect(html).toContain(
        `<div class="fd-item-row__answer"><p>It moves the amount.</p></div>`,
    );
    // The title is escaped; the answer is the caller's ready HTML.
    expect(
        itemRow({
            title: XSS,
            disclosure: { answer: raw("") },
        }),
    ).toContain(XSS_ESCAPED);
    expect(
        itemRow({ title: "T", disclosure: { answer: raw("") } }),
    ).not.toContain("id=");
});

test("a disclosure row is only a title and its answer", () => {
    for (const extra of [
        { href: "/x" },
        { lead: { kind: "icon", name: "check" } },
        { trailing: { kind: "chevron" } },
        { value: "v" },
    ] as const) {
        expect(() =>
            itemRow({
                title: "T",
                disclosure: { answer: raw("") },
                ...extra,
            }),
        ).toThrow(/disclosure row/);
    }
});

test("a link row can carry a plus beside its face: the link opens, the plus does the other thing", () => {
    const html = String(
        itemRow({
            title: "Chicken alfredo",
            subtitle: "Your recipe · 1 serving · 690 kcal",
            href: "/recipes/r1",
            trailing: { kind: "chevron" },
            add: {
                kind: "add",
                label: "Add Chicken alfredo",
                data: { "fd-log-pick": "{}" },
            },
            id: "fd-log-result-0",
            role: "option",
            data: { "fd-log-row-pick": "{}" },
        }),
    );
    // The plus is the face's sibling, not inside the link.
    expect(html).toContain(
        '<div class="fd-item-row__face fd-item-row__face--link"><a class="fd-item-row__anchor" href="/recipes/r1">',
    );
    expect(html).toMatch(
        /<\/a><button type="button" class="fd-item-row__trail fd-item-row__add" aria-label="Add Chicken alfredo" data-fd-log-pick="\{\}">/,
    );
    expect(html.indexOf("fd-item-row__chevron")).toBeLessThan(
        html.indexOf("</a>"),
    );
    expect(html).toContain(
        ' id="fd-log-result-0" role="option" data-fd-log-row-pick="{}"',
    );
});

test("a plus needs a link to sit beside, and is not selectable or swipeable", () => {
    const add = { kind: "add", label: "Add" } as const;
    expect(() => itemRow({ title: "T", add })).toThrow(/needs an href/);
    expect(() =>
        itemRow({ title: "T", href: "/x", add, select: true }),
    ).toThrow(/not selectable/);
    expect(() =>
        itemRow({
            title: "T",
            href: "/x",
            add,
            swipe: { left: { label: "Delete" } },
        }),
    ).toThrow(/not selectable/);
});

test("a row's own data and role are escaped", () => {
    const html = String(
        itemRow({ title: "T", role: "option", data: { "fd-x": XSS } }),
    );
    expect(html).toContain('role="option"');
    expect(html).toContain(`data-fd-x="${XSS_ESCAPED}"`);
});
