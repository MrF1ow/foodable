import { expect, test } from "bun:test";

type Img = {
    hidden: boolean;
    complete: boolean;
    naturalWidth: number;
    matches: (sel: string) => boolean;
};

const img = (over: Partial<Img> = {}): Img => ({
    hidden: false,
    complete: false,
    naturalWidth: 0,
    matches: (sel) => sel === "img.fd-avatar__img",
    ...over,
});

/** Runs avatar-fallback.js against a fake document holding `imgs`. */
async function setup(imgs: Img[]) {
    const captured: {
        type: string;
        fn: (e: unknown) => void;
        capture: unknown;
    }[] = [];
    const document = {
        addEventListener: (
            type: string,
            fn: (e: unknown) => void,
            capture: unknown,
        ) => captured.push({ type, fn, capture }),
        querySelectorAll: (sel: string) =>
            sel === "img.fd-avatar__img" ? imgs : [],
    };
    let onLoad: ((scope: unknown) => void) | null = null;
    const window = {
        FoodableApp: {
            onLoad: (fn: (scope: unknown) => void) => (onLoad = fn),
        },
    };
    const src = await Bun.file("./src/web/client/v2/avatar-fallback.js").text();
    new Function("window", "document", src)(window, document);
    return {
        captured,
        scan: () => onLoad!(document),
        fail: (target: unknown) =>
            captured.find((c) => c.type === "error")!.fn({ target }),
    };
}

test("a picture that fails to load is hidden so the initials under it show", async () => {
    const broken = img();
    const t = await setup([broken]);
    // `error` does not bubble: the listener must be a capturing one.
    expect(t.captured.find((c) => c.type === "error")!.capture).toBe(true);
    t.fail(broken);
    expect(broken.hidden).toBe(true);
});

test("an error on something that is not an avatar picture is left alone", async () => {
    const other = img({ matches: () => false });
    const t = await setup([]);
    t.fail(other);
    expect(other.hidden).toBe(false);
});

test("a picture that already failed before the script ran is hidden on scan", async () => {
    const failed = img({ complete: true, naturalWidth: 0 });
    const loaded = img({ complete: true, naturalWidth: 256 });
    const pending = img({ complete: false });
    const t = await setup([failed, loaded, pending]);
    t.scan();
    expect(failed.hidden).toBe(true);
    expect(loaded.hidden).toBe(false);
    expect(pending.hidden).toBe(false);
});

test("the capturing listener is added once however often it scans", async () => {
    const t = await setup([]);
    t.scan();
    t.scan();
    expect(t.captured.filter((c) => c.type === "error")).toHaveLength(1);
});
