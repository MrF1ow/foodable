import { describe, expect, test } from "bun:test";
import {
    FD_BARCODE_SCAN_SHEET_ID,
    renderBarcodeScannerSheet,
} from "./scanner-sheet.js";

describe("renderBarcodeScannerSheet", () => {
    test("is a Detail bar, a Camera view and the number field", () => {
        const html = renderBarcodeScannerSheet();
        expect(html).toContain(`id="${FD_BARCODE_SCAN_SHEET_ID}"`);
        expect(html).toContain("fd-detail-bar");
        expect(html).toContain(">Scan a barcode</h1>");
        expect(html).toContain('aria-label="Close scanner"');
        expect(html).toContain("data-fd-scanner-close");
        expect(html).toContain("data-fd-camera-view");
        expect(html).toContain("playsinline");
        expect(html).toContain("fd-camera-view__frame");
        expect(html).toContain("data-fd-scanner-torch");
        expect(html).toContain('placeholder="Type the number"');
        expect(html).toContain('inputmode="numeric"');
        expect(html).toContain("fd-btn--go");
    });

    test("explains nothing: the instructions and the subtitle are gone", () => {
        const html = renderBarcodeScannerSheet();
        for (const text of [
            "Use your camera, or type the number",
            "Type the number instead",
            "Point at a barcode",
            "Hold steady",
            "Hold the barcode up",
            "Foodable fills in",
            "or</span>",
        ]) {
            expect(html).not.toContain(text);
        }
    });

    test("preview mode uses a static feed", () => {
        const html = renderBarcodeScannerSheet({
            previewStatic: true,
            openOnLoad: true,
        });
        expect(html).toContain("fd-scanner--preview");
        expect(html).toContain('class="fd-camera-view__feed"');
        expect(html).not.toContain("<video");
        expect(html).not.toMatch(/data-fd-camera-view hidden/);
        expect(html).toContain(" open");
    });

    test("kill switch off keeps the number field and draws no camera or flashlight", () => {
        const html = renderBarcodeScannerSheet({ barcodeCamera: false });
        expect(html).toContain("fd-scanner--type-only");
        expect(html).toContain(">Enter a barcode</h1>");
        expect(html).not.toContain("Scan a barcode");
        expect(html).toMatch(/data-fd-camera-view hidden/);
        expect(html).not.toContain("data-fd-scanner-torch");
        expect(html).toContain('placeholder="Type the number"');
    });

    test("the number field raises a numeric keypad whose Enter key reads Go", () => {
        const html = renderBarcodeScannerSheet({ barcodeCamera: false });
        const input =
            html.match(/<input[^>]*id="fd-scanner-manual"[^>]*>/)?.[0] ?? "";
        expect(input).toContain('inputmode="numeric"');
        expect(input).toContain('enterkeyhint="go"');
    });
});
