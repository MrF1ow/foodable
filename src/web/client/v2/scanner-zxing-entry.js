import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

let wasmHref = "/app-v2-scanner.wasm";
/** @type {ReturnType<typeof prepareZXingModule> | null} */
let prepared = null;

function ensurePrepared() {
    if (!prepared) {
        prepared = prepareZXingModule({
            overrides: {
                locateFile: () => wasmHref,
            },
        });
    }
    return prepared;
}

export function configureScannerWasm(href) {
    wasmHref = href;
    prepared = null;
}

export async function decodeBarcodeImageData(imageData) {
    await ensurePrepared();
    const results = await readBarcodes(imageData, {
        formats: ["EAN13", "EAN8", "UPCA", "UPCE"],
        tryHarder: true,
        maxNumberOfSymbols: 1,
    });
    const text = results[0]?.text;
    return text ? String(text).replace(/\D/g, "") : null;
}

if (typeof globalThis.window !== "undefined") {
    globalThis.window.FoodableScannerZxing = {
        configureScannerWasm,
        decodeBarcodeImageData,
    };
}
