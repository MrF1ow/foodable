import { expect, test } from "bun:test";

type Handler = (event: any) => void;

class Chip {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    disabled = false;
    focused = false;
    classList = {
        toggle: (name: string, on: boolean) =>
            on ? this.classes.add(name) : this.classes.delete(name),
    };
    constructor(
        value: string,
        mode: "single" | "multiple",
        on = false,
        disabled = false,
    ) {
        this.attrs.set("data-value", value);
        this.attrs.set(
            mode === "single" ? "aria-checked" : "aria-pressed",
            String(on),
        );
        if (mode === "single") this.attrs.set("tabindex", on ? "0" : "-1");
        this.disabled = disabled;
    }
    getAttribute(name: string) {
        return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }
    closest() {
        return this;
    }
    focus() {
        this.focused = true;
    }
}

async function setup(
    mode: "single" | "multiple",
    chips: Chip[],
    runTwice = false,
) {
    const handlers: Record<string, Handler> = {};
    const fired: { value: string; values: string[] }[] = [];
    const group = {
        getAttribute: (n: string) => (n === "data-fd-chips" ? mode : null),
        // Every listener a script adds runs, as in a browser.
        addEventListener: (type: string, fn: Handler) => {
            const before = handlers[type];
            handlers[type] = (event) => {
                before?.(event);
                fn(event);
            };
        },
        querySelectorAll: () => chips,
        contains: () => true,
        dispatchEvent: (event: {
            detail: { value: string; values: string[] };
        }) => fired.push(event.detail),
    };
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-chips]" ? [group] : [],
    };
    class FakeCustomEvent {
        detail: unknown;
        constructor(
            public type: string,
            init: { detail: unknown },
        ) {
            this.detail = init.detail;
        }
    }
    // Turbo runs every onLoad callback again on each visit and morph.
    const window = {
        FoodableApp: {
            onLoad: (fn: Handler) => {
                fn(page);
                if (runTwice) fn(page);
            },
        },
    };
    const src = await Bun.file("./src/web/client/v2/chips.js").text();
    new Function("window", "document", "CustomEvent", "WeakSet", src)(
        window,
        undefined,
        FakeCustomEvent,
        WeakSet,
    );
    const key = (
        target: Chip,
        name: string,
        mods: Record<string, boolean> = {},
    ) => {
        let prevented = false;
        handlers.keydown!({
            key: name,
            target,
            ...mods,
            preventDefault: () => (prevented = true),
        });
        return prevented;
    };
    return { handlers, fired, key };
}

test("a multiple chip toggles on and off and reports every chip that is on", async () => {
    const [a, b] = [new Chip("a", "multiple", true), new Chip("b", "multiple")];
    const { handlers, fired } = await setup("multiple", [a, b]);
    handlers.click!({ target: b });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.classes.has("fd-pill-chip--on")).toBe(true);
    expect(fired.at(-1)).toEqual({ value: "b", values: ["a", "b"] });
    handlers.click!({ target: a });
    expect(a.getAttribute("aria-pressed")).toBe("false");
    expect(a.classes.has("fd-pill-chip--on")).toBe(false);
    expect(fired.at(-1)).toEqual({ value: "a", values: ["b"] });
});

test("a disabled chip does nothing", async () => {
    const a = new Chip("a", "multiple", false, true);
    const { handlers, fired } = await setup("multiple", [a]);
    handlers.click!({ target: a });
    expect(fired).toEqual([]);
});

test("a single chip selects exclusively and moves the tab stop", async () => {
    const [a, b] = [new Chip("a", "single", true), new Chip("b", "single")];
    const { handlers, fired } = await setup("single", [a, b]);
    handlers.click!({ target: b });
    expect(a.getAttribute("aria-checked")).toBe("false");
    expect(a.getAttribute("tabindex")).toBe("-1");
    expect(b.getAttribute("aria-checked")).toBe("true");
    expect(b.getAttribute("tabindex")).toBe("0");
    expect(fired).toEqual([{ value: "b", values: ["b"] }]);
    // Choosing the chosen one again changes nothing.
    handlers.click!({ target: b });
    expect(fired).toHaveLength(1);
});

test("arrow keys move focus along toggles without changing them", async () => {
    const [a, b] = [new Chip("a", "multiple"), new Chip("b", "multiple")];
    const { key, fired } = await setup("multiple", [a, b]);
    expect(key(a, "ArrowRight")).toBe(true);
    expect(b.focused).toBe(true);
    expect(b.getAttribute("aria-pressed")).toBe("false");
    key(b, "ArrowRight");
    expect(a.focused).toBe(true);
    key(a, "End");
    expect(fired).toEqual([]);
});

test("arrow keys select in a radio group, and Tab is left alone", async () => {
    const [a, b, c] = [
        new Chip("a", "single", true),
        new Chip("b", "single"),
        new Chip("c", "single"),
    ];
    const { key, fired } = await setup("single", [a, b, c]);
    key(a, "ArrowLeft");
    expect(c.getAttribute("aria-checked")).toBe("true");
    expect(c.focused).toBe(true);
    key(c, "Home");
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(key(a, "Tab")).toBe(false);
    expect(fired.map((f) => f.value)).toEqual(["c", "a"]);
});

test("running onLoad again does not bind a multiple group twice", async () => {
    const a = new Chip("a", "multiple");
    const { handlers, fired } = await setup("multiple", [a], true);
    handlers.click!({ target: a });
    // Bound twice, the second handler would toggle it straight back off.
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(fired).toHaveLength(1);
});

test("running onLoad again does not bind a single group twice", async () => {
    const [a, b] = [new Chip("a", "single", true), new Chip("b", "single")];
    const { handlers, fired } = await setup("single", [a, b], true);
    handlers.click!({ target: b });
    expect(fired).toHaveLength(1);
});

test("a single chip drawn on and disabled is cleared when another is chosen", async () => {
    const [a, b] = [
        new Chip("a", "single", true, true),
        new Chip("b", "single"),
    ];
    a.classes.add("fd-pill-chip--on");
    const { handlers } = await setup("single", [a, b]);
    handlers.click!({ target: b });
    expect(a.getAttribute("aria-checked")).toBe("false");
    expect(a.classes.has("fd-pill-chip--on")).toBe(false);
    expect(b.getAttribute("aria-checked")).toBe("true");
});

test("an arrow key with a modifier is left to the browser", async () => {
    const [a, b] = [new Chip("a", "single", true), new Chip("b", "single")];
    const { fired, key } = await setup("single", [a, b]);
    for (const mod of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
        expect(key(a, "ArrowRight", { [mod]: true })).toBe(false);
    }
    expect(b.focused).toBe(false);
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(fired).toEqual([]);
});

test("a multiple chip that is on and disabled stays in values", async () => {
    const [a, b] = [
        new Chip("a", "multiple", true, true),
        new Chip("b", "multiple"),
    ];
    const { handlers, fired } = await setup("multiple", [a, b]);
    handlers.click!({ target: b });
    expect(fired.at(-1)).toEqual({ value: "b", values: ["a", "b"] });
});
