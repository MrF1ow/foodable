import { expect, test } from "bun:test";
import { Glob } from "bun";

// The page contract: every page is built from the `fd-` components under
// components/v2/. The old primitives (`components/ui.ts`: pageHeader, panel,
// modal, field) and the old icon functions (`components/icons.ts`) are gone,
// and no page may bring them back.
test("no page module imports the retired ui.ts or the old icon functions", async () => {
    const offenders: string[] = [];
    let scanned = 0;
    for await (const path of new Glob("src/web/pages/**/*.ts").scan(".")) {
        if (path.endsWith(".test.ts")) continue;
        scanned++;
        const src = await Bun.file(path).text();
        for (const m of src.matchAll(
            /from\s+"((?:\.\.?\/)+components\/(?:ui|icons)\.js)"/g,
        )) {
            offenders.push(`${path}: ${m[1]}`);
        }
    }
    expect(scanned).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
});

test("the retired modules are not on disk", async () => {
    for (const path of [
        "src/web/components/ui.ts",
        "src/web/components/icons.ts",
    ]) {
        expect(await Bun.file(path).exists(), path).toBe(false);
    }
});
