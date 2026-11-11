import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Listener = (e: Record<string, unknown>) => void;

class FakeEl {
    listeners: Record<string, Listener[]> = {};
    attrs: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: FakeEl[] = [];
    hidden = false;
    open = true;
    textContent = "";
    className = "";
    srcObject: unknown = null;
    value = "";
    constructor(
        readonly tag: string,
        public parent: FakeEl | null = null,
        readonly classes: string[] = [],
    ) {
        parent?.children.push(this);
    }
    get classList() {
        return {
            contains: (c: string) => this.classes.includes(c),
        };
    }
    addEventListener(type: string, fn: Listener) {
        (this.listeners[type] ??= []).push(fn);
    }
    fire(type: string, detail: Record<string, unknown> = {}) {
        const event = { type, ...detail, target: detail.target ?? this };
        for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
    }
    querySelector(sel: string): FakeEl | null {
        if (sel === ".fd-scanner-video" && this.tag === "dialog") {
            return this.video;
        }
        if (sel === "[data-fd-scanner-error]") return this.errorEl;
        if (sel === "[data-fd-scanner-type-panel]") return this.typePanel;
        if (sel === ".fd-scanner-help") return this.help;
        if (sel === ".fd-scanner-camera") return this.camera;
        if (sel === ".fd-scanner-type-input") return this.typeInput;
        if (sel === "[data-fd-scanner-torch]") return this.torch;
        if (sel === "[data-fd-scanner-submit]") return this.submitBtn;
        if (sel === "input") return this.typeInput;
        for (const ch of this.children) {
            const hit = ch.querySelector(sel);
            if (hit) return hit;
        }
        return null;
    }
    setAttribute() {}
    getAttribute() {
        return null;
    }
    closest() {
        return null;
    }
    focus() {}
    close() {
        this.open = false;
        this.fire("close");
    }
    video!: FakeEl;
    errorEl!: FakeEl;
    typePanel!: FakeEl;
    help!: FakeEl;
    camera!: FakeEl;
    typeInput!: FakeEl;
    torch!: FakeEl;
    submitBtn!: FakeEl;
}

function makeScannerDialog(): FakeEl {
    const dialog = new FakeEl("dialog", null, ["fd-scanner"]);
    dialog.video = new FakeEl("video", dialog);
    dialog.errorEl = new FakeEl("p", dialog);
    dialog.typePanel = new FakeEl("div", dialog);
    dialog.help = new FakeEl("div", dialog);
    dialog.camera = new FakeEl("div", dialog);
    dialog.typeInput = new FakeEl("input", dialog);
    dialog.torch = new FakeEl("button", dialog);
    dialog.submitBtn = new FakeEl("button", dialog);
    return dialog;
}

type ScriptStub = {
    _onload: (() => void) | null;
    _onerror: (() => void) | null;
    async: boolean;
    src?: string;
};

async function flushPromises(times = 16) {
    for (let i = 0; i < times; i++) await Promise.resolve();
}

async function loadScannerModule(
    overrides: Record<string, unknown> = {},
    opts: { scriptStubs?: ScriptStub[] } = {},
) {
    const tracks: { stopped: boolean; stop: () => void }[] = [];
    const getUserMediaQueue: Array<(stream: unknown) => void> = [];
    const getUserMedia = () =>
        new Promise((resolve) => {
            getUserMediaQueue.push(resolve);
        });
    const assigns: string[] = [];
    const dialog = makeScannerDialog();
    dialog.open = false;
    const docListeners: Record<string, Listener[]> = {};
    const document = {
        addEventListener: (type: string, fn: Listener) => {
            (docListeners[type] ??= []).push(fn);
        },
        getElementById: (id: string) =>
            id === "fd-barcode-scan" ? dialog : null,
        querySelector: () => null,
        createElement: (tag: string) => {
            if (tag === "script") {
                const stub: ScriptStub = {
                    async: true,
                    _onload: null,
                    _onerror: null,
                };
                Object.defineProperty(stub, "src", {
                    set(_v: string) {},
                    configurable: true,
                });
                Object.defineProperty(stub, "onload", {
                    get() {
                        return stub._onload;
                    },
                    set(fn: (() => void) | null) {
                        stub._onload = fn;
                    },
                    configurable: true,
                });
                Object.defineProperty(stub, "onerror", {
                    get() {
                        return stub._onerror;
                    },
                    set(fn: (() => void) | null) {
                        stub._onerror = fn;
                    },
                    configurable: true,
                });
                opts.scriptStubs?.push(stub);
                return stub;
            }
            return new FakeEl(tag);
        },
        head: { appendChild: () => {} },
    };
    const window = {
        isSecureContext: true,
        location: { assign: (url: string) => assigns.push(url) },
        FoodableApp: {
            onLoad: (fn: () => void) => fn(),
        },
        FoodableScannerPick: {
            pickDecoder: () => "native" as const,
        },
        BarcodeDetector: class {
            static async getSupportedFormats() {
                return ["ean_13"];
            }
            async detect() {
                return [{ rawValue: "1234567890123" }];
            }
        },
        navigator: {
            mediaDevices: { getUserMedia },
        },
        addEventListener: () => {},
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame: (fn: () => void) => {
            queueMicrotask(fn);
            return 1;
        },
        cancelAnimationFrame: () => {},
        HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
        createImageBitmap: async () => ({
            close: () => {},
        }),
        ...overrides,
    };
    Object.defineProperty(dialog.video, "readyState", {
        value: 2,
        configurable: true,
    });
    const videoEl = dialog.video as FakeEl & {
        play: () => Promise<void>;
        pause: () => void;
    };
    videoEl.play = async () => {};
    videoEl.pause = () => {};
    Object.defineProperty(window, "createImageBitmap", {
        value: window.createImageBitmap,
        configurable: true,
    });
    const makeStream = () => {
        const track = {
            stopped: false,
            stop() {
                this.stopped = true;
            },
            getCapabilities: () => ({}),
            applyConstraints: async () => {},
        };
        tracks.push(track);
        return { getTracks: () => [track], getVideoTracks: () => [track] };
    };
    const src = readFileSync(join(import.meta.dir, "scanner.js"), "utf8");
    new Function(
        "window",
        "document",
        "navigator",
        "BarcodeDetector",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "createImageBitmap",
        "HTMLMediaElement",
        src,
    )(
        window,
        document,
        window.navigator,
        window.BarcodeDetector,
        window.requestAnimationFrame,
        window.cancelAnimationFrame,
        window.createImageBitmap,
        window.HTMLMediaElement,
    );
    const resolveGetUserMedia = () => {
        getUserMediaQueue.shift()?.(makeStream());
    };
    return {
        dialog,
        assigns,
        tracks,
        resolveGetUserMedia,
        getUserMediaQueue,
        docListeners,
        window,
    };
}

function loadPickDecoder(): (
    env: Record<string, unknown>,
) => "native" | "wasm" {
    const src = readFileSync(join(import.meta.dir, "scanner-pick.js"), "utf8");
    return new Function(`${src}\nreturn pickDecoder;`)() as (
        env: Record<string, unknown>,
    ) => "native" | "wasm";
}

describe("pickDecoder", () => {
    const pickDecoder = loadPickDecoder();

    test("chooses wasm without BarcodeDetector", () => {
        expect(pickDecoder({ isSecureContext: true })).toBe("wasm");
    });

    test("chooses wasm when ean_13 is unsupported", () => {
        expect(
            pickDecoder({
                isSecureContext: true,
                BarcodeDetector: () => {},
                barcodeDetectorFormats: ["qr_code"],
            }),
        ).toBe("wasm");
    });

    test("chooses native when ean_13 is supported", () => {
        expect(
            pickDecoder({
                isSecureContext: true,
                BarcodeDetector: () => {},
                barcodeDetectorFormats: ["ean_13", "qr_code"],
            }),
        ).toBe("native");
    });

    test("chooses wasm on insecure contexts", () => {
        expect(
            pickDecoder({
                isSecureContext: false,
                BarcodeDetector: () => {},
                barcodeDetectorFormats: ["ean_13"],
            }),
        ).toBe("wasm");
    });
});

describe("scanner camera lifecycle", () => {
    test("closing while getUserMedia is pending stops tracks and skips navigation", async () => {
        const ctx = await loadScannerModule();
        ctx.dialog.fire("toggle", { newState: "open" });
        await Promise.resolve();
        ctx.dialog.close();
        ctx.resolveGetUserMedia();
        await Promise.resolve();
        await Promise.resolve();
        expect(ctx.tracks.some((t) => t.stopped)).toBe(true);
        expect(ctx.assigns).toEqual([]);
    });

    test("decode after close does not navigate", async () => {
        const ctx = await loadScannerModule();
        ctx.dialog.fire("toggle", { newState: "open" });
        ctx.resolveGetUserMedia();
        await Promise.resolve();
        await Promise.resolve();
        ctx.dialog.close();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(ctx.assigns).toEqual([]);
    });

    test("short typed code shows inline error", async () => {
        const ctx = await loadScannerModule();
        ctx.dialog.typeInput.value = "123";
        for (const fn of ctx.dialog.listeners.click ?? []) {
            fn({
                target: {
                    closest: (sel: string) =>
                        sel === "[data-fd-scanner-submit]" ? {} : null,
                },
                preventDefault: () => {},
            });
        }
        expect(ctx.assigns).toEqual([]);
        expect(ctx.dialog.errorEl.textContent).toContain("8 digits");
    });

    test("wasm reopen after close before script onload keeps second session", async () => {
        const scripts: ScriptStub[] = [];
        const zxing = {
            configureScannerWasm: () => {},
            decodeBarcodeImageData: async () => null as string | null,
        };
        let decodeTicks = 0;
        let rafBudget = 8;
        const ctx = await loadScannerModule(
            {
                BarcodeDetector: undefined,
                FoodableScannerPick: { pickDecoder: () => "wasm" as const },
                matchMedia: () => ({ matches: false }),
                requestAnimationFrame: (fn: () => void) => {
                    if (rafBudget-- <= 0) return 0;
                    decodeTicks += 1;
                    queueMicrotask(fn);
                    return decodeTicks;
                },
            },
            { scriptStubs: scripts },
        );

        ctx.dialog.fire("toggle", { newState: "open" });
        ctx.resolveGetUserMedia();
        await flushPromises();
        const firstTrack = ctx.tracks[0]!;
        expect(firstTrack).toBeDefined();
        expect(scripts.length).toBeGreaterThan(0);
        expect(scripts[0]?._onload).toBeTypeOf("function");

        ctx.dialog.close();
        ctx.dialog.open = true;
        ctx.dialog.fire("toggle", { newState: "open" });
        ctx.resolveGetUserMedia();
        await flushPromises();
        const secondTrack = ctx.tracks[1]!;
        expect(secondTrack).toBeDefined();
        expect(firstTrack.stopped).toBe(true);

        (
            ctx.window as { FoodableScannerZxing?: typeof zxing }
        ).FoodableScannerZxing = zxing;
        const script = scripts[0];
        expect(script?._onload).toBeTypeOf("function");
        script?._onload?.();
        await flushPromises();

        expect(secondTrack.stopped).toBe(false);
        expect(decodeTicks).toBeGreaterThan(0);
    });
});
