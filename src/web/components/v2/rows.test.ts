import { expect, test } from "bun:test";
import { raw } from "./html.js";
import { iconRepeat } from "./icons.js";
import {
    foodRow,
    fridgeRow,
    groceryRow,
    macroLine,
    partRow,
    rowList,
    searchResultRow,
    sectionHeader,
    usualRow,
} from "./rows.js";
import { XSS, XSS_ESCAPED, text } from "./test-helpers.js";

const MACROS = { protein: 19, carbs: 2, fat: 15 };

test("macroLine shows 'P 19 C 2 F 15' in the macro classes, with spoken names", () => {
    const html = macroLine(MACROS);
    expect(html).toContain(`fd-macro fd-macro--protein`);
    expect(html).toContain(`fd-macro fd-macro--carbs`);
    expect(html).toContain(`fd-macro fd-macro--fat`);
    expect(html).toContain(`<span aria-hidden="true">P </span>`);
    expect(html).toContain(`<span class="fd-sr">Protein </span>19`);
    expect(html).toContain(`<span class="fd-sr">Fat </span>15`);
});

test("foodRow: title, inline meta, macros and a trailing value in one li", () => {
    const html = foodRow({
        title: "Scrambled eggs",
        meta: "3 large",
        macros: MACROS,
        trailing: 216,
    });
    expect(html).toStartWith(`<li class="fd-row fd-row--food">`);
    expect(html).toContain(`<div class="fd-row__body">`);
    expect(html).toContain(`<span class="fd-row__title">Scrambled eggs</span>`);
    expect(html).toContain(`<span class="fd-row__meta">3 large</span>`);
    expect(html).toContain(`<span class="fd-row__value">216</span>`);
    expect(html).toEndWith("</li>");
});

test("optional parts are left out, not rendered empty", () => {
    const html = foodRow({ title: "Toast" });
    expect(html).not.toContain("fd-row__meta");
    expect(html).not.toContain("fd-macros");
    expect(html).not.toContain("fd-row__value");
    expect(html).not.toContain("fd-row--swipe");
});

test("searchResultRow: subtitle, macros, score badge and a named add button", () => {
    const html = searchResultRow({
        title: "Chicken noodle soup",
        score: 41,
        subtitle: "Campbell's · 1 cup · 90 kcal",
        macros: { protein: 5, carbs: 12, fat: 2 },
        add: { label: "Add Chicken noodle soup" },
    });
    expect(html).toContain("fd-row--search");
    expect(html).toContain(`fd-score--middling`);
    expect(html).toContain(
        `<span class="fd-row__sub">Campbell&#039;s`.replace("&#039;", "'"),
    );
    expect(html).toContain(
        `<button type="button" class="fd-icon-btn" aria-label="Add Chicken noodle soup">`,
    );
});

test("searchResultRow without a score shows no badge; a form add submits", () => {
    const html = searchResultRow({
        title: "Eggs",
        score: Number.NaN,
        add: {
            label: "Add Eggs",
            form: { action: "/log", fields: { food_id: "f1" } },
            name: "go",
            value: "add",
        },
    });
    expect(html).not.toContain("fd-score");
    expect(html).toContain(
        `<form class="fd-inline-form" method="post" action="/log">`,
    );
    expect(html).toContain(`<input type="hidden" name="food_id" value="f1">`);
    expect(html).toContain(`type="submit"`);
});

test("groceryRow off: unchecked checkbox button, no strike-through", () => {
    const html = groceryRow({
        title: "Kirkland 2% milk",
        subtitle: "Milk",
        tag: "usual",
        amount: "1 gal",
        toggle: { form: { action: "/grocery/1/check" } },
    });
    expect(html).toContain("fd-row--grocery");
    expect(html).not.toContain("fd-row--checked");
    expect(html).not.toContain("fd-row__title--done");
    expect(html).toContain(`class="fd-check"`);
    expect(html).toContain(`role="checkbox" aria-checked="false"`);
    expect(html).toContain(`aria-label="Kirkland 2% milk"`);
    expect(html).toContain(`<span class="fd-tag">usual</span>`);
    expect(html).toContain(`<span class="fd-row__amount">1 gal</span>`);
});

test("groceryRow on: filled check with the icon, struck-through title, row class", () => {
    const html = groceryRow({ title: "Olive oil", checked: true });
    expect(html).toContain("fd-row--checked");
    expect(html).toContain("fd-check fd-check--on");
    expect(html).toContain(`role="img" aria-label="Checked off"`);
    expect(html).not.toContain("<button");
    expect(html).toContain("fd-row__title fd-row__title--done");
    expect(html).toContain("<svg");
    expect(html).not.toContain("fd-tag");
});

test("fridgeRow: inline qty, tertiary date; dateTime makes a <time>", () => {
    const plain = fridgeRow({ title: "Eggs", qty: 9, date: "Nov 19" });
    expect(plain).toContain(`<span class="fd-row__meta">9</span>`);
    expect(plain).toContain(`<span class="fd-row__date">Nov 19</span>`);
    const timed = fridgeRow({
        title: "Eggs",
        date: "Nov 19",
        dateTime: "2026-11-19",
    });
    expect(timed).toContain(
        `<time class="fd-row__date" datetime="2026-11-19">Nov 19</time>`,
    );
});

test("usualRow: the whole row is a link with parts joined by hidden dots and a chevron", () => {
    const html = usualRow({
        title: "Eggs",
        meta: "Vital Farms large",
        href: "/kitchen/usuals/eggs",
        parts: ["Costco", 24, "Every week", { text: "low now", tone: "warn" }],
    });
    expect(html).toContain(
        `<a class="fd-row__body fd-row__body--link" href="/kitchen/usuals/eggs">`,
    );
    expect(html).toContain(`fd-row__meta fd-row__meta--lg`);
    expect(html).toContain(
        `<span class="fd-tone fd-tone--warn">low now</span>`,
    );
    expect(html.match(/fd-sep/g)?.length).toBe(3);
    expect(html).toContain(
        `<span class="fd-sep" aria-hidden="true"> · </span>`,
    );
    expect(html).toContain(`<span class="fd-row__chevron" aria-hidden="true">`);
    expect(html).not.toContain("<button");
});

test("partRow: label, value and a named status dot", () => {
    const html = partRow({
        label: "Sugar",
        value: "4 g per 100 g · low",
        status: "good",
    });
    expect(html).toContain(`<span class="fd-row__label">Sugar</span>`);
    expect(html).toContain(
        `<span class="fd-row__partvalue">4 g per 100 g · low</span>`,
    );
    expect(html).toContain(`fd-dot fd-dot--good`);
    expect(html).toContain(`role="img" aria-label="Good"`);
    expect(partRow({ label: "a", value: "b", status: "warn" })).toContain(
        `aria-label="Moderate"`,
    );
    expect(
        partRow({
            label: "a",
            value: "b",
            status: "over",
            statusLabel: "High",
        }),
    ).toContain(`aria-label="High"`);
    expect(partRow({ label: "a", value: "b" })).not.toContain("fd-dot");
});

test("leading dot and leading markup slots", () => {
    expect(foodRow({ title: "x", lead: { dot: "protein" } })).toContain(
        `<span class="fd-row__lead"><span class="fd-dot fd-dot--protein"`,
    );
    expect(foodRow({ title: "x", lead: { html: raw("<b>EF</b>") } })).toContain(
        `<span class="fd-row__lead"><b>EF</b></span>`,
    );
});

test("swipe slots are real buttons in the DOM, lead before the body and trail after", () => {
    const html = foodRow({
        title: "Scrambled eggs",
        swipe: {
            lead: {
                label: "Again",
                icon: iconRepeat(),
                form: { action: "/meals/1/again" },
            },
            trail: { label: "Delete", data: { action: "delete" } },
        },
    });
    expect(html).toContain("fd-row fd-row--food fd-row--swipe");
    const lead = html.indexOf("fd-row__action--lead");
    const body = html.indexOf("fd-row__body");
    const trail = html.indexOf("fd-row__action--trail");
    expect(lead).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(lead);
    expect(trail).toBeGreaterThan(body);
    expect(html).toContain(`fd-swipe-btn fd-swipe-btn--accent`);
    expect(html).toContain(`fd-swipe-btn fd-swipe-btn--danger`);
    expect(html).toContain(
        `<form class="fd-inline-form" method="post" action="/meals/1/again">`,
    );
    expect(html).toContain(`data-action="delete"`);
    // Never hidden from the accessibility tree or the tab order.
    expect(html).not.toContain(" hidden");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("data-swipe-open");
});

test("swipe.open stamps data-swipe-open; a row without actions ignores it", () => {
    const open = foodRow({
        title: "x",
        swipe: { lead: { label: "Again" }, open: "lead" },
    });
    expect(open).toContain(`data-swipe-open="lead"`);
    const none = foodRow({ title: "x", swipe: { open: "lead" } });
    expect(none).not.toContain("data-swipe-open");
    expect(none).not.toContain("fd-row--swipe");
});

test("rowList and sectionHeader", () => {
    const list = rowList([foodRow({ title: "a" }), foodRow({ title: "b" })], {
        label: "Breakfast",
    });
    expect(list).toStartWith(`<ul class="fd-list" aria-label="Breakfast"><li`);
    expect(list).toEndWith("</li></ul>");
    expect(text(sectionHeader({ title: "Dairy & eggs", count: 2 }))).toBe(
        `<div class="fd-section-head"><h2 class="fd-section-head__title">Dairy &amp; eggs</h2><span class="fd-section-head__count">2</span></div>`,
    );
    expect(sectionHeader({ title: "Fridge", level: 3 })).toContain("<h3 ");
    expect(sectionHeader({ title: "Fridge" })).not.toContain("count");
    expect(sectionHeader({ title: "Fridge", count: 0 })).toContain(">0<");
});

test("every string parameter is escaped, in text and attributes", () => {
    const swipe = {
        lead: {
            label: XSS,
            form: { action: XSS, fields: { [XSS]: XSS } },
            value: XSS,
        },
        trail: { label: XSS, data: { x: XSS } },
        open: "lead" as const,
    };
    const common = { className: XSS, id: XSS, swipe };
    const rows = [
        foodRow({
            title: XSS,
            meta: XSS,
            trailing: XSS,
            macros: { protein: XSS, carbs: XSS, fat: XSS },
            ...common,
        }),
        searchResultRow({
            title: XSS,
            subtitle: XSS,
            macros: { protein: XSS, carbs: XSS, fat: XSS },
            add: {
                label: XSS,
                name: XSS,
                value: XSS,
                data: { x: XSS },
                form: { action: XSS },
            },
            ...common,
        }),
        groceryRow({
            title: XSS,
            subtitle: XSS,
            tag: XSS,
            amount: XSS,
            checked: true,
            toggle: { name: XSS, value: XSS },
            ...common,
        }),
        fridgeRow({
            title: XSS,
            qty: XSS,
            date: XSS,
            dateTime: XSS,
            ...common,
        }),
        usualRow({
            title: XSS,
            meta: XSS,
            href: `/${XSS}`,
            parts: [XSS, { text: XSS, tone: "warn" }],
            ...common,
        }),
        partRow({
            label: XSS,
            value: XSS,
            status: "good",
            statusLabel: XSS,
            ...common,
        }),
        sectionHeader({ title: XSS, count: XSS, className: XSS, id: XSS }),
        rowList([], { label: XSS, className: XSS }),
    ];
    for (const html of rows) {
        expect(html).not.toContain("<script");
    }
    expect(rows[4]).toContain(`href="/${XSS_ESCAPED}"`);
    expect(rows[0]).toContain(`id="${XSS_ESCAPED}"`);
});

test("groceryRow with a form: the check is a submit button with checkbox state", () => {
    const html = groceryRow({
        title: "Eggs",
        checked: true,
        toggle: { form: { action: "/grocery/2/check" } },
    });
    expect(html).toContain(
        `<form class="fd-inline-form" method="post" action="/grocery/2/check">`,
    );
    expect(html).toContain(`type="submit"`);
    expect(html).toContain(`role="checkbox" aria-checked="true"`);
});

test("groceryRow without a form never renders a dead checkbox button", () => {
    const html = groceryRow({ title: "Rice" });
    expect(html).not.toContain(`role="checkbox"`);
    expect(html).toContain(`role="img" aria-label="Not checked off"`);
});

test("usualRow refuses a script href", () => {
    expect(() =>
        usualRow({ title: "Milk", href: "javascript:alert(1)" }),
    ).toThrow("unsafe href");
});
