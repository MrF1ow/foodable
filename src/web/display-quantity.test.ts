import { test, expect } from "bun:test";
import {
    formatQuantityDisplay,
    formatQuantityDisplayParts,
    quantityUnitOptionLabel,
} from "./display-quantity.js";
import { formatQuantity } from "../domain/quantity.js";

test("formatQuantityDisplay omits each but keeps other units", () => {
    expect(formatQuantityDisplay({ amount: 4, unit: "each" })).toBe("4");
    expect(formatQuantityDisplay({ amount: 0.5, unit: "each" })).toBe("0.5");
    expect(formatQuantityDisplay({ amount: 48, unit: "oz" })).toBe("48 oz");
});

test("formatQuantityDisplayParts matches display helper for known units", () => {
    expect(formatQuantityDisplayParts(3, "each")).toBe("3");
    expect(formatQuantityDisplayParts(200, "g")).toBe("200 g");
    expect(formatQuantityDisplayParts(2, "roll")).toBe("2 roll");
});

test("quantityUnitOptionLabel maps each to count", () => {
    expect(quantityUnitOptionLabel("each")).toBe("count");
    expect(quantityUnitOptionLabel("g")).toBe("g");
});

test("MCP-style formatQuantity is unchanged for each", () => {
    expect(formatQuantity({ amount: 4, unit: "each" })).toBe("4 each");
});
