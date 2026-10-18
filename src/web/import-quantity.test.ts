import { test, expect } from "bun:test";
import { formatQuantityDisplayParts } from "./display-quantity.js";
import { formatQuantity } from "../domain/quantity.js";

test("web pages use display quantity formatting, not MCP formatQuantity", () => {
    expect(formatQuantityDisplayParts(48, "oz")).toBe("48 oz");
    expect(formatQuantityDisplayParts(4, "each")).toBe("4");
    expect(formatQuantity({ amount: 4, unit: "each" })).toBe("4 each");
});
