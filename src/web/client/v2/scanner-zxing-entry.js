import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

let wasmHref = "/app-v2-scanner.wasm";
/** @type {Promise<unknown> | null} */
let prepared = null;

// One overrides object per wasm path: the library compares overrides with a
// shallow equality, so a stable object keeps its single module instance and a
// new path (new object) builds a new one.
const overridesFor = (href) => ({ locateFile: () => href });
let overrides = overridesFor(wasmHref);

// fireImmediately makes prepareZXingModule return the module promise. Without
// it the call returns undefined, so `prepared` never stuck and every frame
// prepared again, fetching and compiling the wasm per frame.
function ensurePrepared() {
    if (!prepared) {
        prepared = prepareZXingModule({ overrides, fireImmediately: true });
        prepared.catch(() => {
            prepared = null;
        });
    }
    return prepared;
}

/** Called on every scanner open; only a different path starts over. */
export function configureScannerWasm(href) {
    if (href === wasmHref) return;
    wasmHref = href;
    overrides = overridesFor(href);
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
