import { describe, expect, test } from "bun:test";
import * as tableRowModule from "./table-row.js";
import { tableRows, type TableRowOptions } from "./table-row.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

/** One row, through the only entry point: the table's inner markup. */
const tableRow = (row: TableRowOptions) =>
    String(tableRows({ label: "Table", rows: [row] }))
        .replace(/^<div[^>]*role="table"[^>]*>/, "")
        .replace(/<\/div>$/, "");

test("the single row is not exported; tableRows is the entry point", () => {
    expect("tableRow" in tableRowModule).toBe(false);
    expect("tableRows" in tableRowModule).toBe(true);
});

describe("tableRow (FigCraft 381695)", () => {
    test("a row: the label, then one right-aligned cell per column", () => {
        expect(
            String(tableRow({ label: "Calories", cols: ["40", "133"] })),
        ).toBe(
            '<div class="fd-table-row" role="row"><span class="fd-table-row__label" role="rowheader">Calories</span><span class="fd-table-row__col" role="cell">40</span><span class="fd-table-row__col" role="cell">133</span></div>',
        );
    });

    test("the header kind is small caps text with column headers", () => {
        const html = String(
            tableRow({
                kind: "header",
                label: "Calories",
                cols: ["1 serving (30 ml)", "100 ml"],
            }),
        );
        expect(html).toContain("fd-table-row fd-table-row--header");
        expect(html).toContain('role="columnheader">1 serving (30 ml)<');
        expect(html).not.toContain('role="cell"');
    });

    test("an unknown cell is an en dash (392480), a zero stays zero", () => {
        const html = String(tableRow({ label: "Fat", cols: [null, 0] }));
        expect(html).toContain("–");
        expect(html).toContain("no data");
        expect(html).toContain('role="cell">0<');
    });

    test("tableRows wraps rows in a named table", () => {
        const html = String(
            tableRows({
                label: "Nutrition",
                rows: [
                    { kind: "header", label: "Per", cols: ["100 g"] },
                    { label: "Protein", cols: ["3 g"] },
                ],
            }),
        );
        expect(
            html.startsWith(
                '<div class="fd-table-rows" role="table" aria-label="Nutrition">',
            ),
        ).toBe(true);
        expect(html.match(/role="row"/g)?.length).toBe(2);
    });

    test("escapes every string", () => {
        const html = String(
            tableRow({ label: XSS, cols: [XSS], className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(3);
    });
});

describe("tableRow header cells", () => {
    test("an empty or missing column heading stays empty, never a dash", () => {
        const html = String(
            tableRow({
                kind: "header",
                label: "Calories",
                cols: ["", null, "100 ml"],
            }),
        );
        expect(html).not.toContain("—");
        expect(html).not.toContain("no data");
        expect(html).toContain('role="columnheader"></span>');
        expect(html).toContain('role="columnheader">100 ml<');
    });
});
