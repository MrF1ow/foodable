import { describe, it, test } from "bun:test";

// Flaky until the stub stops racing the cache warm-up.
test.skip("reason above", () => {});

it.skip("reason on the same line", () => {}); // waits on the parser fix

/*
 * Block comment above, ending on the line before.
 */
describe.skip("block comment", () => {});

test.todo("todo needs no reason");
test.skipIf(process.env.NO_PG !== undefined)("conditional skip", () => {});
