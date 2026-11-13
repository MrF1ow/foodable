// Barcode camera scanner for the v2 shell. The WASM decoder loads from /app-v2-scanner.js
// on first use; pickDecoder lives in scanner-pick.js (same bundle).
const SCANNER_ID = "fd-barcode-scan";
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

let activeSession = null;
let startupStream = null;
let sessionGeneration = 0;
let decodeBusy = false;
let navigating = false;
let pageExitHooksBound = false;

function digitsOnly(raw) {
    return String(raw ?? "").replace(/\D/g, "");
}

const DEFAULT_TARGET = "/foods/by-barcode/{code}";

// Where a read code goes is a path template on this site with one `{code}`.
// The log sheet's scanner keeps the default; an opener (Add a usual) names
// another for the one open.
function safeTarget(value) {
    return typeof value === "string" &&
        /^\/(?!\/)[\w\-./?=&%]*\{code\}[\w\-./?=&%]*$/.test(value)
        ? value
        : null;
}

let openerTarget = null;

function barcodeUrl(code) {
    const template = openerTarget ?? DEFAULT_TARGET;
    return template.replace("{code}", () => encodeURIComponent(code));
}

function stopTracks(stream) {
    if (!stream) return;
    for (const track of stream.getTracks() ?? []) {
        track.stop();
    }
}

function turnTorchOff(session) {
    if (session?.torchTrack && session.torchOn) {
        session.torchOn = false;
        session.torchTrack
            .applyConstraints({ advanced: [{ torch: false }] })
            .catch(() => {});
    }
}

function goBarcode(code) {
    if (navigating) return;
    const digits = digitsOnly(code);
    const dialog = activeSession?.dialog ?? scannerDialog();
    if (digits.length < 8) {
        setError(dialog, "Enter at least 8 digits.");
        return;
    }
    setError(dialog, "");
    navigating = true;
    stopSession();
    window.location.assign(barcodeUrl(digits));
}

// Off window: a bare `BarcodeDetector?.x` throws where it is undeclared (iOS).
function nativeDetectorClass() {
    const ctor = window.BarcodeDetector;
    return typeof ctor === "function" ? ctor : null;
}

async function supportedNativeFormats() {
    const ctor = nativeDetectorClass();
    if (typeof ctor?.getSupportedFormats !== "function") return [];
    try {
        return await ctor.getSupportedFormats();
    } catch (_) {
        return [];
    }
}

function scannerDialog() {
    return document.getElementById(SCANNER_ID);
}

/** Only a path on this origin (`/…`, never `//host`) may name a script or
 *  wasm file to load; anything else falls back to the built-in path. */
function sameOriginPath(value, fallback) {
    return typeof value === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(value)
        ? value
        : fallback;
}

function decoderScriptHref(dialog) {
    return sameOriginPath(
        dialog?.getAttribute("data-fd-scanner-zxing") ||
            document.querySelector('meta[name="foodable-scanner-zxing"]')
                ?.content,
        "/app-v2-scanner.js",
    );
}

function decoderWasmHref(dialog) {
    return sameOriginPath(
        dialog?.getAttribute("data-fd-scanner-wasm") ||
            document.querySelector('meta[name="foodable-scanner-wasm"]')
                ?.content,
        "/app-v2-scanner.wasm",
    );
}

let decoderLoadPromise;

function loadDecoderBundle(dialog) {
    if (window.FoodableScannerZxing) {
        window.FoodableScannerZxing.configureScannerWasm(
            decoderWasmHref(dialog),
        );
        return Promise.resolve(window.FoodableScannerZxing);
    }
    if (!decoderLoadPromise) {
        decoderLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = decoderScriptHref(dialog);
            script.async = true;
            script.onload = () => {
                const api = window.FoodableScannerZxing;
                if (!api) {
                    decoderLoadPromise = undefined;
                    reject(new Error("scanner chunk missing"));
                    return;
                }
                api.configureScannerWasm(decoderWasmHref(dialog));
                resolve(api);
            };
            script.onerror = () => {
                decoderLoadPromise = undefined;
                reject(new Error("scanner chunk failed"));
            };
            document.head.appendChild(script);
        });
    }
    return decoderLoadPromise;
}

function scannerDesktopLayout() {
    return window.matchMedia("(min-width: 1024px)").matches;
}

function discardSessionAttempt(session, stream) {
    turnTorchOff(session);
    stopTracks(stream);
    if (activeSession === session) {
        activeSession = null;
    }
}

// iOS shows black if a <video> holding an ended stream gets a new one.
function detachVideo(video) {
    if (!video) return;
    video.pause?.();
    video.srcObject = null;
}

function stopSession() {
    sessionGeneration += 1;
    if (startupStream) {
        stopTracks(startupStream);
        startupStream = null;
        detachVideo(scannerDialog()?.querySelector(".fd-scanner-video"));
    }
    const session = activeSession;
    activeSession = null;
    if (!session) return;
    if (session.raf) cancelAnimationFrame(session.raf);
    turnTorchOff(session);
    const torchBtn = session.dialog?.querySelector("[data-fd-scanner-torch]");
    torchBtn?.setAttribute("aria-pressed", "false");
    stopTracks(session.stream);
    detachVideo(session.video);
}

function setError(dialog, message) {
    const el = dialog?.querySelector("[data-fd-scanner-error]");
    if (!el) return;
    if (message) {
        el.textContent = message;
        el.hidden = false;
    } else {
        el.textContent = "";
        el.hidden = true;
    }
}

function resetScannerPanels(dialog) {
    const help = dialog.querySelector(".fd-scanner-help");
    const panel = dialog.querySelector("[data-fd-scanner-type-panel]");
    const camera = dialog.querySelector(".fd-scanner-camera");
    const or = dialog.querySelector(".fd-scanner-or");
    const desktop =
        scannerDesktopLayout() &&
        !dialog.classList.contains("fd-scanner--type-only");
    if (desktop) {
        if (panel) panel.hidden = false;
        if (help) help.hidden = true;
        if (or) or.hidden = false;
        if (camera) camera.hidden = false;
        return;
    }
    if (panel) panel.hidden = true;
    if (help) help.hidden = false;
    if (or) or.hidden = true;
    if (camera && !dialog.classList.contains("fd-scanner--type-only")) {
        camera.hidden = false;
    }
}

function showTypePanel(dialog, on) {
    const help = dialog.querySelector(".fd-scanner-help");
    const panel = dialog.querySelector("[data-fd-scanner-type-panel]");
    const camera = dialog.querySelector(".fd-scanner-camera");
    if (
        scannerDesktopLayout() &&
        !dialog.classList.contains("fd-scanner--type-only")
    ) {
        if (on) panel?.querySelector("input")?.focus();
        return;
    }
    if (!panel) return;
    if (on) {
        stopSession();
        panel.hidden = false;
        if (help) help.hidden = true;
        if (camera) camera.hidden = true;
        panel.querySelector("input")?.focus();
    } else {
        panel.hidden = true;
        if (help) help.hidden = false;
        if (camera && !dialog.classList.contains("fd-scanner--type-only")) {
            camera.hidden = false;
            startScanner(dialog);
        }
    }
}

async function decodeNative(detector, video) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const bitmap = await createImageBitmap(video);
    try {
        const codes = await detector.detect(bitmap);
        const hit = codes.find((c) => c.rawValue);
        return hit ? digitsOnly(hit.rawValue) : null;
    } finally {
        bitmap.close();
    }
}

async function decodeWasm(api, video) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return api.decodeBarcodeImageData(ctx.getImageData(0, 0, w, h));
}

function loopDecode(dialog, session) {
    if (activeSession !== session || navigating) return;
    const tick = async () => {
        if (activeSession !== session || navigating) return;
        if (decodeBusy) {
            session.raf = requestAnimationFrame(tick);
            return;
        }
        decodeBusy = true;
        try {
            let code = null;
            if (session.mode === "native" && session.detector) {
                code = await decodeNative(session.detector, session.video);
            } else if (session.mode === "wasm" && session.zxing) {
                code = await decodeWasm(session.zxing, session.video);
            }
            if (activeSession !== session || navigating || !dialog.open) return;
            if (code && code.length >= 8) {
                goBarcode(code);
                return;
            }
        } catch (_) {
            /* next frame */
        } finally {
            decodeBusy = false;
        }
        if (activeSession !== session || navigating) return;
        session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
}

function startupStillValid(generation) {
    return sessionGeneration === generation;
}

// Never fail silently: an error shows the typing panel.
function startScanner(dialog) {
    startCamera(dialog).catch(() => {
        stopSession();
        setError(dialog, "Scanner could not start. Type the number instead.");
        showTypePanel(dialog, true);
    });
}

async function startCamera(dialog) {
    if (dialog.classList.contains("fd-scanner--type-only")) return;
    if (dialog.classList.contains("fd-scanner--preview")) return;
    if (!window.isSecureContext) {
        setError(
            dialog,
            "Camera needs a secure connection (HTTPS). Type the number instead.",
        );
        showTypePanel(dialog, true);
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        setError(
            dialog,
            "Camera is not available here. Type the number instead.",
        );
        showTypePanel(dialog, true);
        return;
    }
    setError(dialog, "");
    stopSession();
    const generation = sessionGeneration;
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
        });
    } catch (_) {
        if (!startupStillValid(generation)) return;
        setError(
            dialog,
            "Camera permission was denied. Type the number instead.",
        );
        showTypePanel(dialog, true);
        return;
    }
    if (!startupStillValid(generation)) {
        stopTracks(stream);
        return;
    }
    startupStream = stream;
    const video = dialog.querySelector(".fd-scanner-video");
    if (!video) {
        stopTracks(stream);
        startupStream = null;
        return;
    }
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (!startupStillValid(generation)) {
        stopTracks(stream);
        startupStream = null;
        return;
    }
    const formats = await supportedNativeFormats();
    if (!startupStillValid(generation)) {
        stopTracks(stream);
        startupStream = null;
        return;
    }
    const pick =
        window.FoodableScannerPick?.pickDecoder({
            isSecureContext: window.isSecureContext,
            BarcodeDetector: window.BarcodeDetector,
            barcodeDetectorFormats: formats,
        }) ?? "wasm";
    const session = {
        dialog,
        video,
        stream,
        mode: pick,
        torchTrack: null,
        torchOn: false,
        raf: 0,
        detector: null,
        zxing: null,
    };
    const videoTrack = stream.getVideoTracks()[0];
    const caps = videoTrack?.getCapabilities?.();
    const torchBtn = dialog.querySelector("[data-fd-scanner-torch]");
    if (torchBtn) {
        torchBtn.setAttribute("aria-pressed", "false");
        if (caps?.torch) {
            session.torchTrack = videoTrack;
            torchBtn.hidden = false;
        }
    }
    activeSession = session;
    startupStream = null;
    const Detector = nativeDetectorClass();
    if (pick === "native" && Detector) {
        try {
            session.detector = new Detector({
                formats: NATIVE_FORMATS.filter((f) => formats.includes(f)),
            });
        } catch (_) {
            session.mode = "wasm";
        }
    }
    if (session.mode === "wasm") {
        try {
            session.zxing = await loadDecoderBundle(dialog);
        } catch (_) {
            if (!startupStillValid(generation) || activeSession !== session) {
                discardSessionAttempt(session, stream);
                return;
            }
            setError(
                dialog,
                "Scanner could not load. Type the number instead.",
            );
            showTypePanel(dialog, true);
            stopSession();
            return;
        }
    }
    if (!startupStillValid(generation) || activeSession !== session) {
        discardSessionAttempt(session, stream);
        return;
    }
    loopDecode(dialog, session);
}

let openerTargetsBound = false;

// An opener that names a target (data-fd-scanner-target) aims the scanner at
// it for that open; any other opener of the scanner puts the default back.
function bindOpenerTargets() {
    if (openerTargetsBound) return;
    openerTargetsBound = true;
    document.addEventListener(
        "click",
        (event) => {
            const opener = event.target?.closest?.("[data-fd-open-sheet]");
            if (opener?.getAttribute("data-fd-open-sheet") !== SCANNER_ID) {
                return;
            }
            openerTarget = safeTarget(
                opener.getAttribute("data-fd-scanner-target"),
            );
        },
        true,
    );
}

function bindPageExitHooks() {
    if (pageExitHooksBound) return;
    pageExitHooksBound = true;
    const onExit = () => stopSession();
    window.addEventListener("pagehide", onExit);
    document.addEventListener("turbo:before-visit", onExit);
    document.addEventListener("turbo:before-render", onExit);
}

function bindScannerDialog(dialog) {
    if (dialog.dataset.fdScannerBound) return;
    dialog.dataset.fdScannerBound = "1";
    bindPageExitHooks();
    bindOpenerTargets();
    dialog.addEventListener("close", () => {
        openerTarget = null;
        stopSession();
        if (dialog.classList.contains("fd-scanner--type-only")) {
            showTypePanel(dialog, true);
        } else {
            resetScannerPanels(dialog);
        }
        const input = dialog.querySelector(".fd-scanner-type-input");
        if (input) input.value = "";
        setError(dialog, "");
        navigating = false;
    });
    dialog.addEventListener("toggle", (event) => {
        if (event.newState === "open") {
            if (dialog.classList.contains("fd-scanner--type-only")) {
                showTypePanel(dialog, true);
            } else {
                resetScannerPanels(dialog);
                startScanner(dialog);
            }
        } else {
            stopSession();
        }
    });
    dialog.addEventListener("click", (event) => {
        const close = event.target.closest?.("[data-fd-scanner-close]");
        if (close) {
            event.preventDefault();
            dialog.close();
            return;
        }
        const showType = event.target.closest?.("[data-fd-scanner-show-type]");
        if (showType) {
            event.preventDefault();
            showTypePanel(dialog, true);
            return;
        }
        const back = event.target.closest?.("[data-fd-scanner-back-type]");
        if (back) {
            event.preventDefault();
            showTypePanel(dialog, false);
            return;
        }
        const submit = event.target.closest?.("[data-fd-scanner-submit]");
        if (submit) {
            event.preventDefault();
            const input = dialog.querySelector(".fd-scanner-type-input");
            goBarcode(input?.value ?? "");
            return;
        }
        const torch = event.target.closest?.("[data-fd-scanner-torch]");
        if (torch && activeSession?.torchTrack) {
            event.preventDefault();
            const track = activeSession.torchTrack;
            const next = !activeSession.torchOn;
            track
                .applyConstraints({ advanced: [{ torch: next }] })
                .then(() => {
                    if (activeSession?.torchTrack !== track) return;
                    activeSession.torchOn = next;
                    torch.setAttribute("aria-pressed", next ? "true" : "false");
                })
                .catch(() => {});
        }
    });
    const input = dialog.querySelector(".fd-scanner-type-input");
    input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            goBarcode(input.value);
        }
    });
}

function initScanner() {
    const dialog = scannerDialog();
    if (!dialog) return;
    bindScannerDialog(dialog);
    if (dialog.open) {
        if (dialog.classList.contains("fd-scanner--type-only")) {
            showTypePanel(dialog, true);
        } else if (dialog.classList.contains("fd-scanner--preview")) {
            resetScannerPanels(dialog);
        } else {
            resetScannerPanels(dialog);
            startScanner(dialog);
        }
    }
}

if (typeof window !== "undefined" && window.FoodableApp) {
    window.FoodableApp.onLoad(initScanner);
}
