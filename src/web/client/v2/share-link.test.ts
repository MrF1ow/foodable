import { expect, test } from "bun:test";

type Listener = () => void;

/** Lets the promise chains the script starts run to the end, without timers. */
async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function setup(opts: { clipboard: "ok" | "denied" | "none" }) {
    const written: string[] = [];
    let selected = false;
    let execCopies = 0;
    const input = {
        value: "https://example.test/s/abc",
        focus() {},
        select() {
            selected = true;
        },
    };
    const status = { textContent: "" };
    const clicks: Listener[] = [];
    const button = {
        addEventListener: (_t: string, fn: Listener) => clicks.push(fn),
    };
    const box = {
        parentNode: {
            querySelector: (sel: string) =>
                sel === "[data-fd-share-status]" ? status : null,
        },
        querySelector: (sel: string) =>
            sel === "[data-fd-share-url]"
                ? input
                : sel === "[data-fd-share-copy]"
                  ? button
                  : null,
    };
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-share-made]" ? [box] : [],
    };
    const navigator =
        opts.clipboard === "none"
            ? {}
            : {
                  clipboard: {
                      writeText: async (text: string) => {
                          if (opts.clipboard === "denied") {
                              throw new Error("NotAllowedError");
                          }
                          written.push(text);
                      },
                  },
              };
    const listeners: Record<string, Listener[]> = {};
    const document = {
        addEventListener: (type: string, fn: Listener) => {
            (listeners[type] ||= []).push(fn);
        },
        execCommand: () => {
            execCopies += 1;
            return false;
        },
    };
    let hook: ((scope: unknown) => void) | undefined;
    const window = {
        FoodableApp: {
            onLoad: (fn: (scope: unknown) => void) => {
                hook = fn;
                fn(page);
            },
        },
    };
    const src = await Bun.file("./src/web/client/v2/share-link.js").text();
    new Function("window", "document", "navigator", "WeakSet", src)(
        window,
        document,
        navigator,
        WeakSet,
    );
    await flush();
    return {
        written,
        status,
        clicks,
        selected: () => selected,
        execCopies: () => execCopies,
        input,
        fire: (type: string) => (listeners[type] || []).forEach((fn) => fn()),
        rerun: () => hook!(page),
    };
}

test("it selects the address and copies it on load when the browser allows", async () => {
    const t = await setup({ clipboard: "ok" });
    expect(t.selected()).toBe(true);
    expect(t.written).toEqual(["https://example.test/s/abc"]);
    expect(t.status.textContent).toBe("Copied to the clipboard.");
});

test("Copy link copies again and says so", async () => {
    const t = await setup({ clipboard: "ok" });
    t.status.textContent = "";
    t.clicks[0]!();
    await flush();
    expect(t.written).toHaveLength(2);
    expect(t.status.textContent).toBe("Copied to the clipboard.");
});

test("a refused clipboard says nothing on load, and Copy falls back to a hint", async () => {
    const t = await setup({ clipboard: "denied" });
    expect(t.status.textContent).toBe("");
    t.clicks[0]!();
    await flush();
    expect(t.execCopies()).toBeGreaterThan(0);
    expect(t.status.textContent).toBe("Press and hold the link to copy it.");
});

test("running again on the same box does not bind twice", async () => {
    const t = await setup({ clipboard: "ok" });
    t.rerun();
    expect(t.clicks).toHaveLength(1);
});

test("the address is cleared before Turbo caches the page for Back", async () => {
    const t = await setup({ clipboard: "ok" });
    expect(t.input.value).toBe("https://example.test/s/abc");
    t.fire("turbo:before-cache");
    expect(t.input.value).toBe("");
});
