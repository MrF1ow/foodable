import { describe, expect, test } from "bun:test";
import { raw } from "./html.js";
import { itemRow } from "./item-row.js";
import { monthPicker, monthPickerLabel } from "./month-picker.js";
import { DOLLAR_PAYLOADS, injectedAttributes, XSS } from "./test-helpers.js";

// 2026-11-12 is a Thursday; November 2026 starts on a Sunday.
const TODAY = "2026-11-12";

const base = {
    id: "starts",
    name: "date",
    title: "Starts",
    value: TODAY,
    today: TODAY,
    min: TODAY,
};

/** The opening tag of the first element that carries `needle`, found by text. */
function tagWith(html: string, needle: string): string {
    const at = html.indexOf(needle);
    expect(at).toBeGreaterThanOrEqual(0);
    return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

describe("monthPicker (FigCraft Month picker)", () => {
    test("the row is an Item row: its title, the day it holds and the field the day posts as, with no chevron", () => {
        const { row } = monthPicker(base);
        expect(row).toContain('<li class="fd-item-row');
        expect(row).toContain(
            '<input type="hidden" name="date" value="2026-11-12"',
        );
        expect(row).toContain('fd-item-row__title" title="Starts">Starts<');
        expect(row).toContain('fd-item-row__value">Today<');
        expect(row).not.toContain("fd-item-row__chevron");
        expect(row).not.toContain("fd-icon--chevron-right");
        const toggle = tagWith(row, "data-fd-month-toggle");
        expect(toggle).toContain('aria-controls="starts-picker"');
        expect(toggle).toContain('aria-expanded="false"');
    });

    test("the row is built by itemRow, so a change there reaches it", () => {
        const { row } = monthPicker(base);
        expect(String(row)).toBe(
            String(
                itemRow({
                    title: "Starts",
                    value: "Today",
                    toggles: {
                        controls: "starts-picker",
                        expanded: false,
                        data: { "fd-month-toggle": "starts-picker" },
                    },
                    overlay: raw(
                        '<input type="hidden" name="date" value="2026-11-12" data-fd-month-field>',
                    ),
                }),
            ),
        );
    });

    test("the picker is closed by default and open when asked", () => {
        expect(monthPicker(base).picker).toContain(" hidden>");
        const open = monthPicker({ ...base, open: true });
        expect(tagWith(open.picker, 'id="starts-picker"')).not.toContain(
            "hidden",
        );
        expect(tagWith(open.row, "data-fd-month-toggle")).toContain(
            'aria-expanded="true"',
        );
    });

    test("names the month, the weekday letters Sunday first, and a button per day", () => {
        const { picker } = monthPicker(base);
        expect(picker).toContain(">November 2026<");
        expect(picker).toContain(
            "<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>",
        );
        expect(picker.match(/data-fd-month-day="/g)).toHaveLength(30);
        expect(tagWith(picker, 'data-fd-month-day="2026-11-12"')).toContain(
            'aria-label="Thursday 12 November"',
        );
    });

    test("blanks fill the grid up to the first weekday", () => {
        // December 2026 starts on a Tuesday: two blanks.
        const { picker } = monthPicker({ ...base, value: "2026-12-05" });
        expect(picker).toContain(">December 2026<");
        expect(picker.match(/fd-month-picker__blank/g)).toHaveLength(2);
        expect(picker.match(/data-fd-month-day="/g)).toHaveLength(31);
    });

    test("the picked day is pressed, today is current, and earlier days are disabled", () => {
        const { picker } = monthPicker({ ...base, value: "2026-11-20" });
        const picked = tagWith(picker, 'data-fd-month-day="2026-11-20"');
        expect(picked).toContain("fd-month-picker__day--picked");
        expect(picked).toContain('aria-pressed="true"');
        const today = tagWith(picker, 'data-fd-month-day="2026-11-12"');
        expect(today).toContain('aria-current="date"');
        expect(today).not.toContain("disabled");
        expect(tagWith(picker, 'data-fd-month-day="2026-11-11"')).toContain(
            "disabled",
        );
        expect(picker.match(/ disabled>/g)?.length).toBeGreaterThanOrEqual(11);
    });

    test("without a min every day can be picked", () => {
        const { picker } = monthPicker({ ...base, min: undefined });
        expect(picker).not.toContain(
            'aria-label="Previous month" data-fd-month-prev="" disabled',
        );
        expect(tagWith(picker, 'data-fd-month-day="2026-11-01"')).not.toContain(
            "disabled",
        );
    });

    test("the previous month is out of reach in the month of the first pickable day only", () => {
        expect(
            tagWith(monthPicker(base).picker, "data-fd-month-prev"),
        ).toContain(" disabled");
        const later = monthPicker({ ...base, value: "2026-12-05" }).picker;
        expect(tagWith(later, "data-fd-month-prev")).not.toContain(" disabled");
    });

    test("a value that is not a day is shown as typed and picks nothing", () => {
        const { row, picker } = monthPicker({ ...base, value: "2026-13-45" });
        expect(row).toContain('fd-item-row__value">2026-13-45<');
        expect(row).toContain('value="2026-13-45"');
        expect(picker).toContain(">November 2026<");
        expect(picker).not.toContain('aria-pressed="true"');
    });

    test("escapes hostile text and never lets an id or title carry attributes", async () => {
        const hostile = monthPicker({
            ...base,
            id: XSS,
            name: XSS,
            title: XSS,
            value: XSS,
        });
        expect(hostile.row).not.toContain("<script>");
        expect(hostile.picker).not.toContain("<script>");
        for (const payload of DOLLAR_PAYLOADS) {
            const html = monthPicker({ ...base, id: payload, title: payload });
            expect(
                await injectedAttributes(`${html.row}${html.picker}`),
            ).toEqual([]);
        }
    });
});

describe("monthPickerLabel", () => {
    test("Today, Tomorrow, then the weekday, date and month", () => {
        expect(monthPickerLabel("2026-11-12", TODAY)).toBe("Today");
        expect(monthPickerLabel("2026-11-13", TODAY)).toBe("Tomorrow");
        expect(monthPickerLabel("2026-11-21", TODAY)).toBe("Sat 21 Nov");
        // Tomorrow crosses a month and a year.
        expect(monthPickerLabel("2027-01-01", "2026-12-31")).toBe("Tomorrow");
    });

    test("anything that is not a real day comes back as it was", () => {
        for (const bad of ["", "soon", "2026-02-30", "2026-13-01"]) {
            expect(monthPickerLabel(bad, TODAY)).toBe(bad);
        }
    });
});
