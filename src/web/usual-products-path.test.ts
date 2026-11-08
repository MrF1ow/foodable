import { expect, test } from "bun:test";
import { isSafeAppBackPath } from "./settings-back.js";
import {
    plainFoodIdForUsualPicker,
    safeReturnPath,
} from "./usual-products-path.js";

test("safeReturnPath rejects unsafe from values", () => {
    expect(safeReturnPath("//evil.com", "/settings/household/items")).toBe(
        "/settings/household/items",
    );
    expect(safeReturnPath("https://evil.com", "/kitchen/groceries")).toBe(
        "/kitchen/groceries",
    );
    expect(isSafeAppBackPath("https://evil.com")).toBe(false);
    expect(safeReturnPath("/recipes/r1", "/settings/household/items")).toBe(
        "/recipes/r1",
    );
    expect(safeReturnPath("/kitchen/fridge/../logout", "/kitchen/fridge")).toBe(
        "/kitchen/fridge",
    );
    expect(safeReturnPath("/./logout", "/kitchen/fridge")).toBe(
        "/kitchen/fridge",
    );
    expect(safeReturnPath("/%2e%2e/logout", "/kitchen/fridge")).toBe(
        "/kitchen/fridge",
    );
    expect(safeReturnPath("/kitchen/fridge?q=1", "/kitchen/fridge")).toBe(
        "/kitchen/fridge?q=1",
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
