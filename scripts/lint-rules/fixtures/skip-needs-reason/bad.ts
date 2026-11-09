import { describe, it, test } from "bun:test";

test.skip("no reason", () => {});
it.skip("trailing code is not a reason", () => {}); //
describe.skip("blank comment above", () => {});

test("other", () => {}); // not about the next line
test.skip("trailing comment on the line before", () => {});
