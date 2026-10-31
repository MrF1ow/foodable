import { expect, test } from "bun:test";
import { Glob } from "bun";
import { field } from "./ui.js";

test("field wraps the label and its control in one .field", () => {
    expect(
        field({
            id: "section-s1",
            label: "Section & aisle",
            control: '<select id="section-s1"></select>',
        }),
    ).toBe(`<div class="field">
<label for="section-s1">Section &amp; aisle</label>
<select id="section-s1"></select>
</div>`);
    expect(
        field({
            id: "x",
            label: "X",
            control: '<input id="x" />',
            className: "span-2",
        }),
    ).toStartWith('<div class="field span-2">');
});

// A bare `<label for>` followed by its control leaned on the parent's gap and
// rode up over its label wherever that parent was not a gapped grid. Every
// visible label-for-control pair goes through field(); only visually hidden
// labels (in-row controls) are written by hand.
test("no page or component hand-writes a visible <label for>", async () => {
    const offenders: string[] = [];
    for await (const path of new Glob("src/web/**/*.ts").scan(".")) {
        if (path.endsWith(".test.ts") || path.endsWith("components/ui.ts")) {
            continue;
        }
        const src = await Bun.file(path).text();
        for (const m of src.matchAll(/<label\b[^>]*\bfor=[^>]*>/g)) {
            if (!m[0].includes("visually-hidden")) {
                offenders.push(`${path}: ${m[0]}`);
            }
        }
    }
    expect(offenders).toEqual([]);
});

test("form spacing never pulls a control up with a negative margin", async () => {
    const css = await Bun.file("public/app/app.css").text();
    expect(css).not.toMatch(/margin[\w-]*:\s*calc\(var\(--gap-label\)\s*-/);
    expect(css).not.toMatch(/label:has\(\s*\+/);
});
