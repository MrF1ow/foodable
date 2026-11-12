import { describe, expect, test } from "bun:test";
import { formatBarcodeDisplay } from "./format-barcode-display.js";

describe("formatBarcodeDisplay", () => {
    test("EAN-13 groups 1-6-6", () => {
        expect(formatBarcodeDisplay("5201054017463")).toBe("5 201054 017463");
    });

    test("UPC-A groups 1-5-5-1", () => {
        expect(formatBarcodeDisplay("737628064502")).toBe("7 37628 06450 2");
    });

    test("other lengths pass through digits only", () => {
        expect(formatBarcodeDisplay("12345678")).toBe("12345678");
    });
});
