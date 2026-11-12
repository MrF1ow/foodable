import { escapeHtml } from "../../../html.js";
import { fdIcon } from "../../components/fd-icons.js";
import { field } from "../../components/ui.js";

export const FD_BARCODE_SCAN_SHEET_ID = "fd-barcode-scan";

export type RenderBarcodeScannerOpts = {
    openOnLoad?: boolean;
    /** Preview fixture: static layout without a live camera. */
    previewStatic?: boolean;
    barcodeCamera?: boolean;
    zxingScriptHref?: string;
    wasmHref?: string;
};

function flashIcon(): string {
    return `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13 2L4.5 13.5H11L9 22l10.5-12.5H13.5L13 2z"/></svg>`;
}

function keyboardIcon(): string {
    return `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>`;
}

export function renderBarcodeScannerSheet(
    opts: RenderBarcodeScannerOpts = {},
): string {
    const camera = opts.barcodeCamera !== false;
    const preview = opts.previewStatic === true;
    const reopen = opts.openOnLoad ? " open" : "";
    const dataZxing = opts.zxingScriptHref
        ? ` data-fd-scanner-zxing="${escapeHtml(opts.zxingScriptHref)}"`
        : "";
    const dataWasm = opts.wasmHref
        ? ` data-fd-scanner-wasm="${escapeHtml(opts.wasmHref)}"`
        : "";
    const cameraHidden = camera ? "" : " hidden";
    const previewClass = preview ? " fd-scanner--preview" : "";
    const typeOnly = !camera ? " fd-scanner--type-only" : "";
    const video = preview
        ? `<div class="fd-scanner-preview-feed" aria-hidden="true"></div>`
        : `<video class="fd-scanner-video" playsinline muted autoplay${camera ? "" : " hidden"}></video>`;
    const err = `<p class="fd-scanner-error" data-fd-scanner-error hidden role="alert"></p>`;
    const torchHidden = " hidden";
    return `<dialog class="fd-scanner${previewClass}${typeOnly}" id="${FD_BARCODE_SCAN_SHEET_ID}" aria-labelledby="${FD_BARCODE_SCAN_SHEET_ID}-title"${dataZxing}${dataWasm}${reopen}>
<div class="fd-scanner-stage">
<header class="fd-scanner-head">
<button type="button" class="fd-scanner-icon-btn fd-scanner-head-close" data-fd-scanner-close aria-label="Close scanner"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
<div class="fd-scanner-head-text">
<h2 class="fd-scanner-title" id="${FD_BARCODE_SCAN_SHEET_ID}-title">Scan a barcode</h2>
<p class="fd-scanner-subtitle">Use your camera, or type the number</p>
</div>
<button type="button" class="fd-scanner-icon-btn fd-scanner-torch"${torchHidden} data-fd-scanner-torch aria-label="Toggle flashlight" aria-pressed="false">${flashIcon()}</button>
</header>
<div class="fd-scanner-camera"${cameraHidden}>
${video}
<div class="fd-scanner-viewfinder" aria-hidden="true"><div class="fd-scanner-line" aria-hidden="true"></div></div>
<p class="fd-scanner-hint fd-scanner-hint--mobile">Hold steady. It scans by itself.</p>
<p class="fd-scanner-hint fd-scanner-hint--desktop">Hold the barcode up to the camera</p>
</div>
${err}
<div class="fd-scanner-help">
<p class="fd-scanner-help-title">Point at a barcode</p>
<p class="fd-scanner-help-text">Foodable fills in the food and its nutrition. Anything in your fridge shows first.</p>
<button type="button" class="fd-scanner-type-btn" data-fd-scanner-show-type>${keyboardIcon()}<span>Type the number instead</span></button>
</div>
<div class="fd-scanner-or" hidden aria-hidden="true"><span>or</span></div>
<div class="fd-scanner-type-panel" data-fd-scanner-type-panel hidden>
${field({
    id: "fd-scanner-manual",
    label: "Barcode number",
    control:
        '<input class="fd-scanner-type-input" id="fd-scanner-manual" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="go" placeholder="Barcode number" />',
}).toString()}
<button type="button" class="fd-btn fd-btn--primary fd-scanner-type-submit" data-fd-scanner-submit>Look up</button>
<button type="button" class="fd-scanner-back" data-fd-scanner-back-type>Back to camera</button>
</div>
</div>
</dialog>`;
}
