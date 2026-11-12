import { expect, test } from "bun:test";

type Listener = () => void;

/** Lets the promise chains the script starts run to the end, without timers. */
async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function setup(opts: { clipboard: "ok" | "denied" | "none" }) {
    const written: string[] = [];
    let selected = 0;
    let execCopies = 0;
    const source = {
        textContent: "https://food.example.test/mcp",
    };
    const status = { textContent: "" };
    const clicks: Listener[] = [];
    const button = {
        addEventListener: (_t: string, fn: Listener) => clicks.push(fn),
    };
    const box = {
        querySelector: (sel: string) =>
            sel === "[data-fd-copy-source]"
                ? source
                : sel === "[data-fd-copy-trigger]"
                  ? button
                  : sel === "[data-fd-copy-status]"
                    ? status
                    : null,
    };
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-copy-address]" ? [box] : [],
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
    const range = { selectNodeContents: () => {} };
    const selection = {
        removeAllRanges: () => {},
        addRange: () => {
            selected += 1;
        },
    };
    const document = {
        createRange: () => range,
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
        getSelection: () => selection,
    };
    const src = await Bun.file("./src/web/client/v2/copy-address.js").text();
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
        rerun: () => hook!(page),
    };
}

test("it copies nothing until the button is pressed", async () => {
    const t = await setup({ clipboard: "ok" });
    expect(t.written).toEqual([]);
    expect(t.status.textContent).toBe("");
});

test("pressing the button copies the address and says so", async () => {
    const t = await setup({ clipboard: "ok" });
    t.clicks[0]!();
    await flush();
    expect(t.written).toEqual(["https://food.example.test/mcp"]);
    expect(t.status.textContent).toBe("Copied to the clipboard.");
});

test("a refused clipboard selects the address and says how to copy it", async () => {
    const t = await setup({ clipboard: "denied" });
    t.clicks[0]!();
    await flush();
    expect(t.selected()).toBeGreaterThan(0);
    expect(t.execCopies()).toBeGreaterThan(0);
    expect(t.status.textContent).toBe("Press and hold the address to copy it.");
});

test("no clipboard API at all behaves like a refused one", async () => {
    const t = await setup({ clipboard: "none" });
    t.clicks[0]!();
    await flush();
    expect(t.written).toEqual([]);
    expect(t.status.textContent).toBe("Press and hold the address to copy it.");
});

test("running again on the same box does not bind twice", async () => {
    const t = await setup({ clipboard: "ok" });
    t.rerun();
    expect(t.clicks).toHaveLength(1);
});
