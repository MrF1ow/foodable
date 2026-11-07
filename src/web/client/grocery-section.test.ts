import { expect, test } from "bun:test";

type SectionInput = {
    name: string;
    value: string;
    type: string;
    remove: () => void;
};

type FormStub = {
    closest: (sel: string) => Stub | null;
    querySelector: (sel: string) => SectionInput | null;
};

type Stub = {
    value: string;
    attrs: Record<string, string>;
    listeners: Record<string, (() => void)[]>;
    addEventListener: (type: string, fn: () => void) => void;
    closest: (sel: string) => Stub | null;
    querySelectorAll: (sel: string) => FormStub[];
    getAttribute: (name: string) => string | null;
    transient?: boolean;
};

function makeForm(
    section: SectionInput,
    opts: { transient?: boolean; wrapper?: Stub },
): FormStub {
    return {
        closest(sel: string) {
            if (sel === "[data-fill-transient]" && opts.transient)
                return opts.wrapper ?? ({ transient: true } as Stub);
            return null;
        },
        querySelector(sel: string) {
            return sel === 'input[name="section_id"]' ? section : null;
        },
    };
}

test("syncGrocerySection leaves section_id on transient replay forms", async () => {
    const inferId = "sec-other";
    const transientSection: SectionInput = {
        name: "section_id",
        value: "dairy",
        type: "hidden",
        remove() {
            transientSection.value = "";
        },
    };
    const mainSection: SectionInput = {
        name: "section_id",
        value: "dairy",
        type: "hidden",
        remove() {
            mainSection.value = "";
        },
    };

    const transientWrap: Stub = { transient: true } as Stub;
    const dialog: Stub = {
        value: "",
        attrs: {},
        listeners: {},
        addEventListener() {},
        closest: () => null,
        querySelectorAll(sel) {
            if (sel !== "form") return [];
            return [
                makeForm(mainSection, {}),
                makeForm(transientSection, {
                    transient: true,
                    wrapper: transientWrap,
                }),
            ];
        },
        getAttribute: () => null,
    };

    const select: Stub = {
        value: inferId,
        attrs: { "data-infer-section": inferId },
        listeners: {},
        addEventListener(type, fn) {
            (select.listeners[type] ??= []).push(fn);
        },
        closest(sel) {
            return sel === "dialog" ? dialog : null;
        },
        querySelectorAll: () => [],
        getAttribute(name) {
            return select.attrs[name] ?? null;
        },
    };

    const root: Stub = {
        value: "",
        attrs: {},
        listeners: {},
        addEventListener() {},
        closest: () => null,
        querySelectorAll(sel) {
            return sel === "[data-grocery-section]"
                ? [select as unknown as FormStub]
                : [];
        },
        getAttribute: () => null,
    };

    const window = {
        FoodableApp: { onLoad: (fn: (r: Stub) => void) => fn(root) },
    };
    const document = { addEventListener: () => {} };
    const src = await Bun.file("./src/web/client/grocery.js").text();
    new Function("window", "document", src)(window, document);

    for (const fn of select.listeners.change ?? []) fn();

    expect(mainSection.value).toBe("");
    expect(transientSection.value).toBe("dairy");
});
