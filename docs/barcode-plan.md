# Camera barcode scanning: plan

Status: proposed. Moved out of [ROADMAP.md](../ROADMAP.md) on 2026-11-07, unchanged.

Scan a barcode with the phone camera in the web app instead of typing the digits. The lookup side already exists: `lookupBarcode` / `normalizeBarcode` (Open Food Facts) behind the web food picker (`runBarcodeLookupAction` in `src/web/components/food-picker.ts`), and the `lookup_barcode` MCP tool, which takes digits typed by the user or read from a photo of the package.

- Add a Scan button beside the barcode field that opens the camera, decodes EAN/UPC, and fills the field. The decoder (decided 2026-11-08, BAR-1): the browser's native `BarcodeDetector` where it exists, with a bundled ZXing WebAssembly decoder as the fallback, which is what iPhones use. Bundle it into `/app.js`. No CDN.
- Camera access needs HTTPS (or localhost). The production deploy has it; the tailnet `:8080` dev deploy may not.
- MCP agents already have `lookup_barcode`. Check whether they need more, for example a tool that adds a scanned product straight to the fridge or grocery list as a food with its barcode attached.
