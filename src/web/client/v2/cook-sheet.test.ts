import { expect, test } from "bun:test";

type Listener = (event: any) => void;

/**
 * Runs cook-sheet.js against a stub document and fetch. `answers` is the queue
 * of responses fetch gives back, each held until `release()` so a test can
 * answer out of order.
 */
async function setup(initial = "2") {
    const listeners: Record<string, { fn: Listener; capture: boolean }[]> = {};
    const doc = {
        addEventListener(type: string, fn: Listener, capture = false) {
            (listeners[type] ??= []).push({ fn, capture });
        },
        createElement: () => ({
            innerHTML: "",
            content: {
                querySelector: () => template.next,
            },
        }),
    };
    const template: { next: unknown } = { next: null };

    const unit = { textContent: "servings" };
    const attrs: Record<string, string> = {
        "data-fd-cook-preview-url": "/recipes/r1/cook/preview",
    };
    const region = {
        replaced: null as unknown,
        replaceWith(el: unknown) {
            this.replaced = el;
        },
    };
    const input: any = { name: "servings", value: initial };
    const form: any = {
        getAttribute: (n: string) => attrs[n] ?? null,
        setAttribute: (n: string, v: string) => (attrs[n] = v),
        removeAttribute: (n: string) => delete attrs[n],
        querySelector: (sel: string) =>
            sel === '[name="servings"]'
                ? input
                : sel === ".fd-stepper__unit"
                  ? unit
                  : sel === "[data-fd-cook-region]"
                    ? region
                    : null,
    };
    input.closest = (sel: string) =>
        sel === "[data-fd-cook-form]" ? form : null;

    const requests: {
        url: string;
        signal: AbortSignal;
        done: (r: any) => void;
    }[] = [];
    const fetchStub = (url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
            const req = { url, signal: init.signal, done: resolve };
            init.signal.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
            );
            requests.push(req);
        });
    const timeouts: (() => void)[] = [];
    const setTimeoutStub = (fn: () => void) => {
        timeouts.push(fn);
        return timeouts.length;
    };
    const clearTimeoutStub = (id: number) => {
        timeouts[id - 1] = () => {};
    };

    const src = await Bun.file("./src/web/client/v2/cook-sheet.js").text();
    new Function(
        "document",
        "fetch",
        "AbortController",
        "setTimeout",
        "clearTimeout",
        src,
    )(doc, fetchStub, AbortController, setTimeoutStub, clearTimeoutStub);

    const fire = (type: string, event: unknown, capture = false) => {
        for (const l of listeners[type] ?? []) {
            if (l.capture === capture) l.fn(event);
        }
    };
    const flush = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const respond = async (i: number, status: number, html: string) => {
        template.next = { html };
        requests[i]!.done({ status, text: async () => html });
        await flush();
    };
    return {
        input,
        form,
        unit,
        region,
        attrs,
        requests,
        timeouts,
        template,
        type: (value: string) => {
            input.value = value;
            fire("input", { target: input });
        },
        change: () => fire("change", { target: input }),
        run: async () => {
            for (const t of timeouts.splice(0)) t();
            await flush();
        },
        open: (newState = "open") =>
            fire(
                "beforetoggle",
                {
                    newState,
                    target: { querySelector: () => form },
                },
                true,
            ),
        respond,
        flush,
    };
}

test("changing the servings asks for that many and swaps the region in", async () => {
    const s = await setup();
    s.type("4");
    expect(s.requests).toHaveLength(0); // debounced
    await s.run();
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]!.url).toBe("/recipes/r1/cook/preview?servings=4");
    expect(s.attrs["aria-busy"]).toBe("true");
    await s.respond(0, 200, "<div data-fd-cook-region>new</div>");
    expect(s.region.replaced).toEqual({
        html: "<div data-fd-cook-region>new</div>",
    });
    expect(s.attrs["aria-busy"]).toBeUndefined();
});

test("a burst of changes sends one request, for the last value", async () => {
    const s = await setup();
    s.type("3");
    s.type("4");
    s.type("5");
    await s.run();
    expect(s.requests.map((r) => r.url)).toEqual([
        "/recipes/r1/cook/preview?servings=5",
    ]);
});

test("a newer change aborts the older request, so a slow answer cannot land over it", async () => {
    const s = await setup();
    s.type("3");
    await s.run();
    s.type("4");
    await s.run();
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0]!.signal.aborted).toBe(true);
    await s.respond(1, 200, "<div data-fd-cook-region>four</div>");
    expect(s.region.replaced).toEqual({
        html: "<div data-fd-cook-region>four</div>",
    });
});

test("the unit reads serving for one and servings otherwise", async () => {
    const s = await setup();
    s.type("1");
    await s.run();
    expect(s.unit.textContent).toBe("serving");
    s.type("2");
    await s.run();
    expect(s.unit.textContent).toBe("servings");
});

test("a half-typed value keeps the preview as it was", async () => {
    const s = await setup();
    s.type("");
    await s.run();
    s.type("0");
    await s.run();
    expect(s.requests).toHaveLength(0);
});

test("an error answer with a fragment is shown; other failures are not", async () => {
    const s = await setup();
    s.type("2000");
    await s.run();
    await s.respond(0, 400, "<div data-fd-cook-region>too many</div>");
    expect(s.region.replaced).toEqual({
        html: "<div data-fd-cook-region>too many</div>",
    });
    s.region.replaced = null;
    s.type("3");
    await s.run();
    await s.respond(1, 500, "oops");
    expect(s.region.replaced).toBeNull();
});

test("opening the sheet refreshes the preview once", async () => {
    const s = await setup();
    s.open();
    await s.flush();
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]!.url).toBe("/recipes/r1/cook/preview?servings=2");
});

test("closing the sheet does nothing", async () => {
    const s = await setup();
    s.open("closed");
    await s.flush();
    expect(s.requests).toHaveLength(0);
});
