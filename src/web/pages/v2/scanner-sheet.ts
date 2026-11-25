import { esc } from "../../components/v2/html.js";
import { button } from "../../components/v2/button.js";
import { cameraView } from "../../components/v2/camera-view.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { searchField } from "../../components/v2/search-field.js";

export const FD_BARCODE_SCAN_SHEET_ID = "fd-barcode-scan";

export type RenderBarcodeScannerOpts = {
    openOnLoad?: boolean;
    /** Preview fixture: static layout without a live camera. */
    previewStatic?: boolean;
    /** Kill switch `barcode-camera`: when false there is no camera, only the number field. */
    barcodeCamera?: boolean;
    zxingScriptHref?: string;
    wasmHref?: string;
};

/**
 * The scanner, the design's Log · scan barcode: a Detail bar (Back, the title,
 * the flashlight), the Camera view and the Search field that takes the number
 * by hand. Nothing explains it. With `barcode-camera` off the camera and the
 * flashlight are not drawn and the dialog is the number field alone, which is
 * what Add a usual's "Enter a barcode" opens.
 */
export function renderBarcodeScannerSheet(
    opts: RenderBarcodeScannerOpts = {},
): string {
    const camera = opts.barcodeCamera !== false;
    const preview = opts.previewStatic === true;
    const dataZxing = opts.zxingScriptHref
        ? ` data-fd-scanner-zxing="${esc(opts.zxingScriptHref)}"`
        : "";
    const dataWasm = opts.wasmHref
        ? ` data-fd-scanner-wasm="${esc(opts.wasmHref)}"`
        : "";
    const classes = [
        "fd-scanner",
        preview && "fd-scanner--preview",
        !camera && "fd-scanner--type-only",
    ]
        .filter(Boolean)
        .join(" ");
    const title = camera ? "Scan a barcode" : "Enter a barcode";
    const bar = detailBar({
        title,
        back: {
            label: "Close scanner",
            attrs: { "data-fd-scanner-close": "" },
        },
        trailing: camera
            ? {
                  slot: button({
                      round: true,
                      icon: "bolt",
                      label: "Toggle flashlight",
                      // Hidden until the running camera has a flashlight; the
                      // static preview shows it, as the design draws it.
                      attrs: {
                          "data-fd-scanner-torch": "",
                          "aria-pressed": "false",
                          ...(preview ? {} : { hidden: "" }),
                      },
                  }),
              }
            : undefined,
        balance: !camera,
    });
    const typed = searchField({
        style: "boxed",
        label: "Barcode number",
        name: "barcode",
        id: "fd-scanner-manual",
        placeholder: "Type the number",
        lead: "scan",
        inputmode: "numeric",
        enterkeyhint: "go",
        go: { label: "Look up" },
    });
    return `<dialog class="${classes}" id="${FD_BARCODE_SCAN_SHEET_ID}" aria-label="${title}"${dataZxing}${dataWasm}${opts.openOnLoad ? " open" : ""}>
<div class="fd-scanner__stage">
${bar}
${cameraView({ preview, hidden: !camera })}
<p class="fd-scanner__error" data-fd-scanner-error hidden role="alert"></p>
<form class="fd-scanner__type" data-fd-scanner-form>${typed}</form>
</div>
</dialog>`;
}
