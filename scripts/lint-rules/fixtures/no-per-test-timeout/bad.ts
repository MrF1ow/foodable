import { describe, setDefaultTimeout, test, it } from "bun:test";

setDefaultTimeout(60_000);

test("third argument", () => {}, 5000);
it("options object", () => {}, { timeout: 5000 });
test("options first", { timeout: 5000 }, () => {});
test.only("with modifier", () => {}, 100);
test.each([1, 2])("each %d", () => {}, 100);
// @ts-expect-error bun:test types give describe no timeout argument; the rule must still fire
describe("suite", () => {}, 1000);
