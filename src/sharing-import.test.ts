import { expect, test } from "bun:test";
import { sharedImportFailure } from "./sharing-import.js";

test("a unique violation under a wrapped error is a friendly refusal, not a throw", () => {
    const pg = Object.assign(new Error("duplicate key"), { errno: "23505" });
    const wrapped = new Error("Failed to add food: duplicate key", {
        cause: pg,
    });
    expect(sharedImportFailure(wrapped)).toEqual({
        code: "not_recipe",
        message:
            "Your foods changed while that recipe was being imported. Try again.",
    });
});

test("any other database error is still ours to let through", () => {
    const pg = Object.assign(new Error("deadlock"), { errno: "40P01" });
    expect(sharedImportFailure(new Error("x", { cause: pg }))).toBeNull();
    expect(sharedImportFailure(new Error("boom"))).toBeNull();
});
