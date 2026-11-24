import { expect, test } from "bun:test";

// Just enough of a dialog for the selectors `fillSheet` in menu.js uses.
class El {
    removed = false;
    hidden = false;
    classes = new Set<string>();
    attrs = new Map<string, string>();
    value = "";
    checked = false;
    type = "text";
    constructor(
        attrs: Record<string, string> = {},
        public kids: El[] = [],
    ) {
        for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
        this.value = attrs.value ?? "";
        if (attrs.type) this.type = attrs.type;
    }
    getAttribute(name: string) {
        return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }
    removeAttribute(name: string) {
        this.attrs.delete(name);
    }
    remove() {
        this.removed = true;
    }
    get classList() {
        return {
            remove: (name: string) => this.classes.delete(name),
        };
    }
    querySelector(sel: string) {
        return this.all(sel)[0] ?? null;
    }
    all(sel: string): El[] {
        const hit = (el: El): boolean =>
            sel.split(",").some((part) => {
                const p = part.trim();
                if (p === "[name]") return el.attrs.has("name");
                if (p === "[aria-invalid]") return el.attrs.has("aria-invalid");
                if (p === "[data-fd-menu-not]")
                    return el.attrs.has("data-fd-menu-not");
                if (p === "li") return el.attrs.get("tag") === "li";
                if (p === "input") return el.attrs.get("tag") === "input";
                if (p.startsWith("."))
                    return (el.attrs.get("class") ?? "")
                        .split(" ")
                        .includes(p.slice(1));
                return false;
            });
        const out: El[] = [];
        const walk = (el: El) => {
            for (const kid of el.kids) {
                if (hit(kid)) out.push(kid);
                walk(kid);
            }
        };
        walk(this);
        return out;
    }
    querySelectorAll(sel: string) {
        return this.all(sel);
    }
}

async function fill() {
    let exposed: { fillSheet: (d: unknown, spec: string) => void } | null =
        null;
    const src = await Bun.file(
        new URL("./menu.js", import.meta.url).pathname,
    ).text();
    new Function("window", "document", "WeakSet", src)(
        {
            FOODABLE_EXPOSE_MENU: (api: typeof exposed) => (exposed = api),
        },
        { readyState: "loading", addEventListener: () => {} },
        WeakSet,
    );
    return exposed!.fillSheet;
}

const radio = (value: string) =>
    new El({ tag: "li" }, [
        new El({ tag: "input", type: "radio", name: "keep_id", value }),
    ]);

test("opening a sheet from a row drops the refusal it showed and fills the row's values", async () => {
    const fillSheet = await fill();
    const banner = new El({ class: "fd-settings-error" });
    const fieldError = new El({ class: "fd-field__error" });
    const input = new El({ name: "name", "aria-invalid": "true" });
    const invalid = new El({ class: "fd-field--invalid" }, [input]);
    invalid.classes.add("fd-field--invalid");
    const dialog = new El({}, [banner, fieldError, invalid, input]);
    fillSheet(dialog, JSON.stringify({ name: "Milk" }));
    expect(banner.removed).toBe(true);
    expect(fieldError.removed).toBe(true);
    expect(invalid.classes.has("fd-field--invalid")).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.value).toBe("Milk");
});

test("a Merge sets the kept food and hides it from the choices only for the food going in", async () => {
    const fillSheet = await fill();
    const drop = new El({ name: "drop_id", type: "hidden" });
    const a = radio("f-a");
    const b = radio("f-b");
    const c = radio("f-c");
    const group = new El({ "data-fd-menu-not": "drop_id" }, [a, b, c]);
    const dialog = new El({}, [drop, group, ...a.kids, ...b.kids, ...c.kids]);
    fillSheet(dialog, JSON.stringify({ drop_id: "f-b", keep_id: "f-a" }));
    expect(drop.value).toBe("f-b");
    expect(a.hidden).toBe(false);
    expect(b.hidden).toBe(true);
    expect(c.hidden).toBe(false);
    expect((a.kids[0] as El).checked).toBe(true);
    // Another row's Merge: the one hidden before shows again, and the pick
    // from the first row does not carry over.
    fillSheet(dialog, JSON.stringify({ drop_id: "f-c", keep_id: "f-b" }));
    expect(b.hidden).toBe(false);
    expect(c.hidden).toBe(true);
    expect((a.kids[0] as El).checked).toBe(false);
    expect((b.kids[0] as El).checked).toBe(true);
});
