// Sync decoder choice for unit tests (scanner.test.ts evaluates this file).
function pickDecoder(env) {
    if (!env || env.isSecureContext === false) return "wasm";
    if (typeof env.BarcodeDetector !== "function") return "wasm";
    const formats = env.barcodeDetectorFormats;
    if (!Array.isArray(formats)) return "wasm";
    return formats.includes("ean_13") ? "native" : "wasm";
}

if (typeof window !== "undefined") {
    window.FoodableScannerPick = { pickDecoder };
}
