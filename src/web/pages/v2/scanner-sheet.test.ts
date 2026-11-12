import { describe, expect, test } from "bun:test";
import {
    FD_BARCODE_SCAN_SHEET_ID,
    renderBarcodeScannerSheet,
} from "./scanner-sheet.js";

describe("renderBarcodeScannerSheet", () => {
    test("includes type-the-number and camera chrome", () => {
        const html = renderBarcodeScannerSheet();
        expect(html).toContain(`id="${FD_BARCODE_SCAN_SHEET_ID}"`);
        expect(html).toContain("Scan a barcode");
        expect(html).toContain("Use your camera, or type the number");
        expect(html).toContain("Type the number instead");
        expect(html).toContain("playsinline");
        expect(html).toContain("data-fd-scanner-torch");
    });

    test("preview mode uses a static feed", () => {
        const html = renderBarcodeScannerSheet({
            previewStatic: true,
            openOnLoad: true,
        });
        expect(html).toContain("fd-scanner--preview");
        expect(html).toContain("fd-scanner-preview-feed");
        expect(html).toContain("fd-scanner-viewfinder");
        expect(html).toContain("Hold steady. It scans by itself.");
        expect(html).toContain("Hold the barcode up to the camera");
        expect(html).not.toMatch(/class="fd-scanner-camera" hidden/);
        expect(html).toContain(" open");
    });

    test("kill switch off is type-only", () => {
        const html = renderBarcodeScannerSheet({ barcodeCamera: false });
        expect(html).toContain("fd-scanner--type-only");
        expect(html).toContain('class="fd-scanner-camera" hidden');
    });
});
