import { describe, test, it } from "bun:test";

test("no timeout", () => {});
it("retry option is not a timeout", () => {}, { retry: 2 });
test.each([1, 2])("each %d", () => {});
describe("suite", () => {
    test("nested", () => {});
});

// Not bun:test's test.
function test2(_name: string, _fn: () => void, _ms: number) {}
test2("other", () => {}, 5000);
