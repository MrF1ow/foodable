import { expect, test } from "bun:test";
import { Glob } from "bun";
import { POSSIBLE_DUPLICATE_OF_PREFIX } from "./notices.js";

/** The tail of the phrase, so "Possible duplicate " + "of" style splits are caught too. */
const PATTERN = /duplicate of/i;

test("Possible duplicate link wording lives only in the notices copy", async () => {
    expect(POSSIBLE_DUPLICATE_OF_PREFIX).toBe("Possible duplicate of");
    const offenders: string[] = [];
    // Every web module, the notices renderer included: it must read the
    // phrase from the copy constant, never spell it out.
    for await (const path of new Glob("src/web/**/*.ts").scan(".")) {
        if (path.endsWith(".test.ts")) continue;
        const src = await Bun.file(path).text();
        if (PATTERN.test(src)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
});
