import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Handler = (event: any) => void;

/** Just enough of an element for the script: attributes, hidden, text, listeners. */
class El {
    hidden = false;
    textContent = "";
    value = "";
    attrs = new Map<string, string>();
    listeners: Record<string, Handler> = {};
    children: Record<string, El | El[]> = {};
    submitted = 0;
    constructor(text = "") {
        this.textContent = text;
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
    addEventListener(type: string, fn: Handler) {
        const before = this.listeners[type];
        this.listeners[type] = (event) => {
            before?.(event);
            fn(event);
        };
    }
    querySelector(selector: string) {
        const found = this.children[selector];
        return Array.isArray(found) ? (found[0] ?? null) : (found ?? null);
    }
    querySelectorAll(selector: string) {
        const found = this.children[selector];
        return Array.isArray(found) ? found : found ? [found] : [];
    }
    requestSubmit() {
        this.submitted += 1;
    }
}

class FakeInput extends El {}

function row(title: string) {
    const r = new El();
    r.children[".fd-item-row__title"] = new El(title);
    return r;
}

function setup(opts: { heading?: string; count?: string; rows: string[] }) {
    const input = new FakeInput();
    const box = new El();
    const clear = new El();
    clear.hidden = true;
    const go = new El();
    go.hidden = true;
    const form = new El();
    form.children[".fd-search-field__input"] = input;
    form.children[".fd-search-field"] = box;
    form.children["[data-fd-recipes-import-go]"] = go;
    form.children["[data-fd-search-clear]"] = clear;
    const label = new El(opts.heading ?? "All recipes");
    const count = new El(opts.count ?? String(opts.rows.length));
    const section = new El();
    section.attrs.set("data-fd-recipes-total", String(opts.rows.length));
    section.children[".fd-section-header__label"] = label;
    if (opts.count !== "")
        section.children[".fd-section-header__count"] = count;
    const rows = opts.rows.map(row);
    const document = {
        querySelector: (sel: string) =>
            sel === "[data-fd-recipes-total]" ? section : null,
        querySelectorAll: (sel: string) =>
            sel === ".fd-recipes-row" ? rows : [],
    };
    const load: ((root: any) => void)[] = [];
    const root = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-recipes-search]" ? [form] : [],
    };
    const src = readFileSync("./src/web/client/v2/recipes.js", "utf8");
    new Function("document", "HTMLInputElement", "FoodableApp", "WeakSet", src)(
        document,
        FakeInput,
        { onLoad: (fn: (root: any) => void) => load.push(fn) },
        WeakSet,
    );
    for (const fn of load) fn(root);
    const type = (text: string) => {
        input.value = text;
        input.listeners.input?.({});
    };
    return { input, clear, go, form, label, count, rows, type };
}

test("typing reads N of M recipes in the heading and shows the clear X; emptying the field restores them", () => {
    const t = setup({
        rows: ["Pasta", "Pancakes", "Tacos", "Paella", "Soup"],
    });
    expect(t.clear.hidden).toBe(true);
    t.type("pa");
    expect(t.label.textContent).toBe("3 of 5 recipes");
    expect(t.count.hidden).toBe(true);
    expect(t.clear.hidden).toBe(false);
    expect(t.rows.map((r) => r.hidden)).toEqual([
        false,
        false,
        true,
        false,
        true,
    ]);
    t.type("pasta");
    expect(t.label.textContent).toBe("1 of 5 recipes");
    t.type("");
    expect(t.label.textContent).toBe("All recipes");
    expect(t.count.textContent).toBe("5");
    expect(t.count.hidden).toBe(false);
    expect(t.clear.hidden).toBe(true);
    expect(t.rows.every((r) => !r.hidden)).toBe(true);
});

test("a pasted link keeps the heading and shows the clear X", () => {
    const t = setup({ rows: ["Pasta", "Tacos"] });
    t.type("https://example.com/pasta");
    expect(t.label.textContent).toBe("All recipes");
    expect(t.clear.hidden).toBe(false);
    expect(t.rows.every((r) => !r.hidden)).toBe(true);
});

test("a list that opens already searched puts its own heading back when the field is emptied", () => {
    const t = setup({
        heading: "2 of 5 recipes",
        count: "",
        rows: ["Pasta", "Pancakes", "Tacos", "Paella", "Soup"],
    });
    t.type("pasta");
    expect(t.label.textContent).toBe("1 of 5 recipes");
    t.type("");
    expect(t.label.textContent).toBe("2 of 5 recipes");
});

test("the clear X empties the field and submits the search", () => {
    const t = setup({ rows: ["Pasta"] });
    t.type("pa");
    t.form.listeners.click?.({
        target: {
            closest: (sel: string) =>
                sel === "[data-fd-search-clear]" ? t.clear : null,
        },
    });
    expect(t.input.value).toBe("");
    expect(t.form.submitted).toBe(1);
    expect(t.clear.hidden).toBe(true);
});
