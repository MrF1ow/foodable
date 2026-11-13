import { expect, test } from "bun:test";
import { TOASTS } from "./toasts.js";

test("the blocked-recipe toast names no control the app lacks", () => {
    const text = TOASTS["recipes.unverified.blocked"].text;
    expect(text).not.toContain("check again");
    expect(text).toContain("Ask your AI assistant");
});
