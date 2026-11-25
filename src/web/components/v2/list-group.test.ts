import { expect, test } from "bun:test";
import { itemRow } from "./item-row.js";
import { listGroup } from "./list-group.js";
import { XSS, XSS_ESCAPED, text } from "./test-helpers.js";

const rows = [itemRow({ title: "Eggs" }), itemRow({ title: "Milk" })];

test("Flat is the default and wraps the rows in one list", () => {
    const html = listGroup({ rows });
    expect(html).toStartWith(`<ul class="fd-list-group">`);
    expect(html).toEndWith(`</ul>`);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).not.toContain("--card");
});

test("Card adds its modifier", () => {
    expect(listGroup({ style: "card", rows })).toStartWith(
        `<ul class="fd-list-group fd-list-group--card">`,
    );
});

test("a group with no rows is an empty list", () => {
    expect(text(listGroup({ rows: [] }))).toBe(
        `<ul class="fd-list-group"></ul>`,
    );
});

test("a label names the list and every string is escaped", () => {
    const html = listGroup({ rows, label: XSS, className: XSS, id: XSS });
    expect(html).toContain(`aria-label="${XSS_ESCAPED}"`);
    expect(html).not.toContain("<script>");
});

test("data attributes land on the list", () => {
    const html = listGroup({ rows, data: { "fd-order-list": "" } });
    expect(html).toStartWith(
        `<ul class="fd-list-group" data-fd-order-list="">`,
    );
});

test("a listbox names its role", () => {
    expect(listGroup({ rows, role: "listbox", id: "results" })).toStartWith(
        `<ul class="fd-list-group" id="results" role="listbox">`,
    );
});
