import { expect, test } from "bun:test";
import { isSafeAppBackPath } from "./settings-back.js";
import {
    plainFoodIdForUsualPicker,
    safeReturnPath,
    usualProductsPickerHref,
} from "./usual-products-path.js";

test("usualProductsPickerHref carries a pre-move from as its new path", () => {
    expect(usualProductsPickerHref("F1", "/settings/foods")).toBe(
        "/kitchen/usuals/F1?from=%2Fsettings%2Fhousehold%2Fitems",
    );
    expect(usualProductsPickerHref("F1", "/grocery")).toBe(
        "/kitchen/usuals/F1?from=%2Fkitchen%2Fgroceries",
    );
    expect(usualProductsPickerHref("F1", "/settings/help")).toBe(
        "/kitchen/usuals/F1",
    );
    expect(usualProductsPickerHref("F1", "//evil.example")).toBe(
        "/kitchen/usuals/F1",
    );
});

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
