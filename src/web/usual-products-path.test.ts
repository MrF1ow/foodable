import { expect, test } from "bun:test";
import { isSafeAppBackPath } from "./settings-back.js";
import {
    plainFoodIdForUsualPicker,
    safeReturnPath,
} from "./usual-products-path.js";

test("safeReturnPath rejects unsafe from values", () => {
    expect(safeReturnPath("//evil.com", "/household/items")).toBe(
        "/household/items",
    );
    expect(safeReturnPath("https://evil.com", "/grocery")).toBe("/grocery");
    expect(isSafeAppBackPath("https://evil.com")).toBe(false);
    expect(safeReturnPath("/recipes/r1", "/household/items")).toBe(
        "/recipes/r1",
    );
});

test("plainFoodIdForUsualPicker uses generic parent for products", () => {
    expect(
        plainFoodIdForUsualPicker("prod-1", { genericFoodId: "plain-1" }),
    ).toBe("plain-1");
    expect(plainFoodIdForUsualPicker("plain-1", { genericFoodId: null })).toBe(
        "plain-1",
    );
});
