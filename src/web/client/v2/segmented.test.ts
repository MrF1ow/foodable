import { expect, test } from "bun:test";

type Handler = (event: any) => void;

class Seg {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    disabled = false;
    focused = false;
    classList = {
        toggle: (name: string, on: boolean) =>
            on ? this.classes.add(name) : this.classes.delete(name),
    };
    constructor(value: string, checked = false, disabled = false) {
        this.attrs.set("data-value", value);
        this.attrs.set("aria-checked", String(checked));
        this.attrs.set("tabindex", checked ? "0" : "-1");
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

async function setup(segs: Seg[], runTwice = false) {
    const handlers: Record<string, Handler> = {};
    const fired: { value: string }[] = [];
    const added: string[] = [];
    const group = {
        // Every listener a script adds runs, as in a browser.
        addEventListener: (type: string, fn: Handler) => {
            added.push(type);
            const before = handlers[type];
            handlers[type] = (event) => {
                before?.(event);
                fn(event);
            };
        },
        querySelectorAll: () => segs,
        contains: () => true,
        dispatchEvent: (event: { detail: { value: string } }) =>
            fired.push(event.detail),
    };
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-segmented]" ? [group] : [],
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
    const src = await Bun.file("./src/web/client/v2/segmented.js").text();
    new Function("window", "document", "CustomEvent", "WeakSet", src)(
        window,
        undefined,
        FakeCustomEvent,
        WeakSet,
    );
    const key = (
        target: Seg,
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
    return { handlers, fired, key, added };
}

test("a click selects the segment, moves the tab stop, and tells the group", async () => {
    const [a, b] = [new Seg("a", true), new Seg("b")];
    const { handlers, fired } = await setup([a, b]);
    handlers.click!({ target: b });
    expect(a.getAttribute("aria-checked")).toBe("false");
    expect(a.getAttribute("tabindex")).toBe("-1");
    expect(b.getAttribute("aria-checked")).toBe("true");
    expect(b.getAttribute("tabindex")).toBe("0");
    expect(b.classes.has("fd-segmented__segment--selected")).toBe(true);
    expect(a.classes.has("fd-segmented__segment--selected")).toBe(false);
    expect(fired).toEqual([{ value: "b" }]);
});

test("clicking the selected segment changes nothing and fires nothing", async () => {
    const [a, b] = [new Seg("a", true), new Seg("b")];
    const { handlers, fired } = await setup([a, b]);
    handlers.click!({ target: a });
    expect(fired).toEqual([]);
    expect(a.getAttribute("aria-checked")).toBe("true");
});

test("a disabled segment is not selectable", async () => {
    const [a, b] = [new Seg("a", true), new Seg("b", false, true)];
    const { handlers, fired } = await setup([a, b]);
    handlers.click!({ target: b });
    expect(fired).toEqual([]);
    expect(b.getAttribute("aria-checked")).toBe("false");
});

test("arrow keys select the next and previous segment, wrapping, and take focus", async () => {
    const [a, b, c] = [new Seg("a", true), new Seg("b"), new Seg("c")];
    const { fired, key } = await setup([a, b, c]);
    expect(key(a, "ArrowRight")).toBe(true);
    expect(b.focused).toBe(true);
    expect(b.getAttribute("aria-checked")).toBe("true");
    key(b, "ArrowLeft");
    expect(a.getAttribute("aria-checked")).toBe("true");
    key(a, "ArrowLeft");
    expect(c.getAttribute("aria-checked")).toBe("true");
    key(c, "ArrowDown");
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(fired.map((f) => f.value)).toEqual(["b", "a", "c", "a"]);
});

test("Home and End jump, skipping a disabled segment; other keys are left alone", async () => {
    const [a, b, c] = [
        new Seg("a", false, true),
        new Seg("b", true),
        new Seg("c"),
    ];
    const { key } = await setup([a, b, c]);
    key(b, "End");
    expect(c.getAttribute("aria-checked")).toBe("true");
    key(c, "Home");
    expect(b.getAttribute("aria-checked")).toBe("true");
    expect(key(b, "Tab")).toBe(false);
});

test("running onLoad again does not bind the group twice", async () => {
    const [a, b, c] = [new Seg("a", true), new Seg("b"), new Seg("c")];
    const { handlers, fired, key, added } = await setup([a, b, c], true);
    // Selecting is idempotent, so count the listeners as well as the events.
    expect(added).toEqual(["click", "keydown", "change"]);
    handlers.click!({ target: b });
    expect(fired).toEqual([{ value: "b" }]);
    key(b, "ArrowRight");
    expect(fired).toEqual([{ value: "b" }, { value: "c" }]);
});

test("a segment drawn selected and disabled is cleared when another is chosen", async () => {
    const [a, b] = [new Seg("a", true, true), new Seg("b")];
    a.classes.add("fd-segmented__segment--selected");
    const { handlers } = await setup([a, b]);
    handlers.click!({ target: b });
    expect(a.getAttribute("aria-checked")).toBe("false");
    expect(a.classes.has("fd-segmented__segment--selected")).toBe(false);
    expect(a.getAttribute("tabindex")).toBe("-1");
    expect(b.getAttribute("aria-checked")).toBe("true");
});

test("an arrow key with a modifier is left to the browser", async () => {
    const [a, b] = [new Seg("a", true), new Seg("b")];
    const { fired, key } = await setup([a, b]);
    for (const mod of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
        expect(key(a, "ArrowRight", { [mod]: true })).toBe(false);
    }
    expect(b.focused).toBe(false);
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(fired).toEqual([]);
});

test("a native radio's change reaches the group with detail.value, once", async () => {
    const radio = { type: "radio", value: "me" };
    const { handlers } = await setup([]);
    const event: any = { type: "change", target: radio };
    handlers.change!(event);
    expect(event.detail).toEqual({ value: "me" });
    // A change from anything else (a stray input) is left as it is.
    const other: any = { type: "change", target: { type: "text", value: "x" } };
    handlers.change!(other);
    expect(other.detail).toBeUndefined();
});
