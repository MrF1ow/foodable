import { expect, test } from "bun:test";
import { Glob } from "bun";

// A bare `<label for>` followed by its control leaned on the parent's gap and
// rode up over its label wherever that parent was not a gapped grid. Every
// visible label-for-control pair goes through the Field component
// (components/v2/field.ts); only visually hidden labels (in-row controls) are
// written by hand.
test("no page or component hand-writes a visible <label for>", async () => {
    const offenders: string[] = [];
    for await (const path of new Glob("src/web/**/*.ts").scan(".")) {
        if (path.endsWith(".test.ts")) continue;
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
