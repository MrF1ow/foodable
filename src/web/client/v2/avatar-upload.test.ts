import { expect, test } from "bun:test";

type Listener = (event: unknown) => void;

async function flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
}

type Encoder = (
    type: string,
    quality: number,
) => { type: string; size: number } | null;

/** Runs avatar-upload.js against a fake form, file input and canvas. */
async function setup(opts: {
    file?: { name: string; type: string; size: number } | null;
    encode: Encoder;
    decode?: "ok" | "fail";
    noDataTransfer?: boolean;
}) {
    const listeners: Record<string, Listener[]> = {};
    const drawn: unknown[][] = [];
    const encodes: [string, number][] = [];
    const input: { files: unknown[]; name: string } = {
        files:
            opts.file === null
                ? []
                : [
                      opts.file ?? {
                          name: "me.jpg",
                          type: "image/jpeg",
                          size: 900_000,
                      },
                  ],
        name: "photo",
    };
    let submits = 0;
    const form = {
        addEventListener: (t: string, fn: Listener) =>
            (listeners[t] ??= []).push(fn),
        querySelector: (sel: string) =>
            sel === 'input[type="file"]' ? input : null,
        requestSubmit: () => {
            submits += 1;
            // A real submit fires the event again; the script must let it by.
            const event = {
                preventDefault: () => (event.prevented = true),
                prevented: false,
            };
            for (const fn of listeners.submit ?? []) fn(event);
            if (!event.prevented) submitted.push(event);
        },
    };
    const submitted: unknown[] = [];
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            fillStyle: "",
            fillRect: (...a: unknown[]) => drawn.push(["fill", ...a]),
            drawImage: (...a: unknown[]) => drawn.push(["draw", ...a.slice(1)]),
        }),
        toBlob: (cb: (b: unknown) => void, type: string, quality: number) => {
            encodes.push([type, quality]);
            cb(opts.encode(type, quality));
        },
    };
    class FakeFile {
        constructor(
            public parts: unknown[],
            public name: string,
            public opts: { type: string },
        ) {}
        get type() {
            return this.opts.type;
        }
    }
    class FakeDataTransfer {
        files: unknown[] = [];
        items = { add: (f: unknown) => this.files.push(f) };
    }
    const document = {
        createElement: () => canvas,
        querySelectorAll: (sel: string) =>
            sel === "form[data-fd-avatar-upload]" ? [form] : [],
    };
    const window = {
        FoodableApp: { onLoad: (fn: (scope: unknown) => void) => fn(document) },
    };
    const globals: Record<string, unknown> = {
        window,
        document,
        WeakSet,
        File: FakeFile,
        DataTransfer: opts.noDataTransfer ? undefined : FakeDataTransfer,
        createImageBitmap:
            opts.decode === "fail"
                ? async () => {
                      throw new Error("undecodable");
                  }
                : async () => ({ width: 1000, height: 600, close: () => {} }),
        URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
        Image: undefined,
    };
    const src = await Bun.file("./src/web/client/v2/avatar-upload.js").text();
    new Function(...Object.keys(globals), src)(...Object.values(globals));
    const submitEvent = {
        preventDefault: () => (submitEvent.prevented = true),
        prevented: false,
    };
    return {
        input,
        drawn,
        encodes,
        canvas,
        submitEvent,
        submit: async () => {
            for (const fn of listeners.submit ?? []) fn(submitEvent);
            await flush();
        },
        /** Fires a submit without waiting; returns that event. */
        fire: () => {
            const event = {
                preventDefault: () => (event.prevented = true),
                prevented: false,
            };
            for (const fn of listeners.submit ?? []) fn(event);
            return event;
        },
        flush,
        submits: () => submits,
        submitted,
    };
}

const webp =
    (size: number): Encoder =>
    (type) =>
        type === "image/webp" ? { type, size } : null;

test("it crops the middle square to 256 by 256 and swaps in the encoded file", async () => {
    const t = await setup({ encode: webp(20_000) });
    await t.submit();
    expect(t.submitEvent.prevented).toBe(true);
    expect(t.canvas.width).toBe(256);
    expect(t.canvas.height).toBe(256);
    // 1000x600 source: a 600 square from x=200.
    const draw = t.drawn.find((d) => d[0] === "draw")!;
    expect(draw.slice(1)).toEqual([200, 0, 600, 600, 0, 0, 256, 256]);
    expect(t.encodes[0]).toEqual(["image/webp", 0.85]);
    const file = t.input.files[0] as { name: string; type: string };
    expect(file.type).toBe("image/webp");
    expect(file.name).toBe("photo.webp");
    expect(t.submits()).toBe(1);
    expect(t.submitted).toHaveLength(1);
});

test("where the browser cannot encode WebP it falls back to JPEG", async () => {
    // Safari answers a WebP request with a PNG.
    const t = await setup({
        encode: (type) =>
            type === "image/jpeg"
                ? { type, size: 30_000 }
                : { type: "image/png", size: 90_000 },
    });
    await t.submit();
    expect(t.encodes.map((e) => e[0])).toEqual(["image/webp", "image/jpeg"]);
    const file = t.input.files[0] as { name: string; type: string };
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toBe("photo.jpg");
});

test("an over-size result steps the quality down until it fits 64 KB", async () => {
    const t = await setup({
        encode: (type, q) => ({ type, size: q > 0.6 ? 80_000 : 40_000 }),
    });
    await t.submit();
    const file = t.input.files[0] as { type: string };
    expect(file.type).toBe("image/webp");
    expect(t.encodes.map((e) => e[1])).toEqual([0.85, 0.7, 0.55]);
});

test("a picture that cannot be decoded posts as chosen for the server to refuse", async () => {
    const original = { name: "weird.heic", type: "image/heic", size: 1000 };
    const t = await setup({ file: original, encode: webp(1), decode: "fail" });
    await t.submit();
    expect(t.input.files[0]).toBe(original);
    expect(t.submitted).toHaveLength(1);
});

test("a browser without DataTransfer posts the original", async () => {
    const t = await setup({ encode: webp(1000), noDataTransfer: true });
    const original = t.input.files[0];
    await t.submit();
    expect(t.input.files[0]).toBe(original);
    expect(t.submitted).toHaveLength(1);
});

test("no file chosen: the form is left alone for the server's message", async () => {
    const t = await setup({ file: null, encode: webp(1000) });
    await t.submit();
    expect(t.submitEvent.prevented).toBe(false);
    expect(t.encodes).toEqual([]);
});

test("a second submit while the resize is in flight is ignored", async () => {
    const t = await setup({ encode: webp(20_000) });
    const first = t.fire();
    const second = t.fire();
    await t.flush();
    expect(first.prevented).toBe(true);
    // Held back, not posted: the one resized submit is the only one.
    expect(second.prevented).toBe(true);
    expect(t.submits()).toBe(1);
    expect(t.submitted).toHaveLength(1);
    // Once it has been sent, a fresh choice can be submitted again.
    await t.submit();
    expect(t.submits()).toBe(2);
});
