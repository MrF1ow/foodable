import { expect, test } from "bun:test";

// Drives the real food-picker.js against a stub DOM and a fetch whose
// responses we release by hand, so out-of-order arrival is deterministic.

type Stub = {
    value: string;
    innerHTML: string;
    textContent: string;
    listeners: Record<string, (() => void)[]>;
    addEventListener: (type: string, fn: () => void) => void;
    querySelector: (sel: string) => Stub | null;
    querySelectorAll: (sel: string) => Stub[];
    getAttribute: (name: string) => string | null;
};

function stub(parts: Record<string, Stub> = {}): Stub {
    const node: Stub = {
        value: "",
        innerHTML: "",
        textContent: "",
        listeners: {},
        addEventListener(type, fn) {
            (node.listeners[type] ??= []).push(fn);
        },
        querySelector: (sel) => parts[sel] ?? null,
        querySelectorAll: () => [],
        getAttribute: () => null,
    };
    return node;
}

type Pending = {
    url: string;
    signal: AbortSignal | undefined;
    resolve: (foods: { name: string }[]) => void;
};

async function setup() {
    const input = stub();
    const results = stub();
    const picker = stub({
        "[data-search-input]": input,
        "[data-search-results]": results,
    });
    const page = stub();
    page.querySelectorAll = (sel) =>
        sel === "[data-food-picker]" ? [picker] : [];

    const pending: Pending[] = [];
    const fetch = (url: string, init: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
            pending.push({
                url,
                signal: init.signal,
                resolve: (foods) =>
                    resolve({ ok: true, json: async () => ({ foods }) }),
            });
        });
    const timers: (() => void)[] = [];
    const setTimeout = (fn: () => void) => timers.push(fn);
    const clearTimeout = () => {};
    const window = {
        FoodableApp: { onLoad: (fn: (root: Stub) => void) => fn(page) },
    };
    const document = { addEventListener() {} };
    const src = await Bun.file("./src/web/client/food-picker.js").text();
    new Function(
        "window",
        "document",
        "fetch",
        "setTimeout",
        "clearTimeout",
        src,
    )(window, document, fetch, setTimeout, clearTimeout);

    function type(text: string) {
        input.value = text;
        for (const fn of input.listeners.input ?? []) fn();
        // The debounce timer for this keystroke fires.
        timers.shift()?.();
    }
    const settle = () => new Promise((r) => globalThis.setTimeout(r, 0));
    return { results, pending, type, settle };
}

test("a late response for an earlier query does not replace newer results", async () => {
    const { results, pending, type, settle } = await setup();
    type("Pe");
    type("Peanut butter");
    expect(pending.map((p) => p.url)).toEqual([
        "/api/foods/search?q=Pe",
        "/api/foods/search?q=Peanut%20butter",
    ]);
    expect(pending[0]!.signal?.aborted).toBe(true);
    expect(pending[1]!.signal?.aborted).toBe(false);

    pending[1]!.resolve([{ name: "Peanut butter" }]);
    await settle();
    expect(results.innerHTML).toBe("<li>Peanut butter</li>");

    pending[0]!.resolve([{ name: "OE Lemonade" }]);
    await settle();
    expect(results.innerHTML).toBe("<li>Peanut butter</li>");
});

test("clearing the box drops a search still in flight", async () => {
    const { results, pending, type, settle } = await setup();
    type("Pe");
    type("");
    expect(results.innerHTML).toBe("");
    pending[0]!.resolve([{ name: "OE Lemonade" }]);
    await settle();
    expect(results.innerHTML).toBe("");
});
