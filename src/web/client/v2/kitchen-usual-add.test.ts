import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Handler = (event: Record<string, unknown>) => void;

/** Just enough of an element for the selectors the Add a usual script uses. */
class El {
    attrs = new Map<string, string>();
    children: El[] = [];
    parent: El | null = null;
    hidden = false;
    checked = false;
    focused = false;
    value = "";
    dataset: Record<string, string> = {};
    events: string[] = [];
    constructor(
        public tag: string,
        attrs: Record<string, string> = {},
    ) {
        for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    }
    add(...kids: El[]) {
        for (const kid of kids) {
            kid.parent = this;
            this.children.push(kid);
        }
        return this;
    }
    getAttribute(name: string) {
        return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    focus() {
        this.focused = true;
    }
    matches(sel: string) {
        return this.is(sel);
    }
    dispatchEvent(event: { type: string }) {
        this.events.push(event.type);
        return true;
    }
    private is(sel: string): boolean {
        const m = sel.trim().match(/^([a-z]+)?((?:\[[^\]]+\])*)$/);
        if (!m) return false;
        if (m[1] && m[1] !== this.tag) return false;
        for (const part of (m[2] ?? "").split("]").filter(Boolean)) {
            const [k, v] = part.slice(1).split("=");
            if (!this.attrs.has(k!)) return false;
            if (v !== undefined && this.attrs.get(k!) !== v.replace(/"/g, ""))
                return false;
        }
        return true;
    }
    closest(sel: string): El | null {
        for (let el: El | null = this; el; el = el.parent) {
            if (el.is(sel)) return el;
        }
        return null;
    }
    querySelectorAll(sel: string): El[] {
        const out: El[] = [];
        const walk = (el: El) => {
            for (const kid of el.children) {
                if (kid.is(sel)) out.push(kid);
                walk(kid);
            }
        };
        walk(this);
        return out;
    }
    querySelector(sel: string): El | null {
        return this.querySelectorAll(sel)[0] ?? null;
    }
}

function setup() {
    const listeners: Record<string, Handler[]> = {};
    const document = {
        addEventListener(type: string, fn: Handler) {
            (listeners[type] ??= []).push(fn);
        },
    };
    (globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
    const window = { FoodableApp: { onLoad: () => {} } };
    const src = readFileSync(join(import.meta.dir, "kitchen.js"), "utf8");
    new Function("window", "document", src)(window, document);

    // The quick actions: Search your foods and Type it swap the views; Scan a
    // barcode opens the scanner and is no tab.
    const tab = (id: string, pressed: boolean) =>
        new El("button", {
            "data-fd-usual-add-tab": id,
            "aria-pressed": String(pressed),
        });
    const panel = (id: string, shown: boolean) => {
        const p = new El("div", { "data-fd-usual-add-panel": id });
        p.hidden = !shown;
        return p;
    };
    const searchTab = tab("search", true);
    const typeTab = tab("type", false);
    const searchPanel = panel("search", true);
    const typePanel = panel("type", false);
    const backTab = new El("button", { "data-fd-usual-add-tab": "search" });
    const tiles = new El("div", { "data-fd-usual-add-tiles": "" });
    const dialog = new El("dialog").add(
        searchTab,
        typeTab,
        backTab,
        tiles,
        searchPanel,
        typePanel,
    );
    const fire = (type: string, event: Record<string, unknown>) => {
        for (const fn of listeners[type] ?? []) fn(event);
    };
    return {
        fire,
        dialog,
        tabs: { searchTab, typeTab, backTab },
        tiles,
        panels: { searchPanel, typePanel },
    };
}

describe("Add a usual views", () => {
    test("choosing a quick action presses it and shows only its view", () => {
        const ctx = setup();
        ctx.fire("click", { target: ctx.tabs.typeTab });
        expect(ctx.tabs.typeTab.getAttribute("aria-pressed")).toBe("true");
        expect(ctx.tabs.searchTab.getAttribute("aria-pressed")).toBe("false");
        expect(ctx.panels.typePanel.hidden).toBe(false);
        expect(ctx.panels.searchPanel.hidden).toBe(true);
    });

    test("Type it hides the tiles, and Back (a Search tab button with no pressed state) brings them back", () => {
        const ctx = setup();
        ctx.fire("click", { target: ctx.tabs.typeTab });
        expect(ctx.tiles.hidden).toBe(true);
        ctx.fire("click", { target: ctx.tabs.backTab });
        expect(ctx.tiles.hidden).toBe(false);
        expect(ctx.panels.searchPanel.hidden).toBe(false);
        expect(ctx.panels.typePanel.hidden).toBe(true);
        expect(ctx.tabs.backTab.getAttribute("aria-pressed")).toBeNull();
    });

    test("a click that is not on a quick action changes nothing", () => {
        const ctx = setup();
        ctx.fire("click", { target: ctx.panels.searchPanel });
        expect(ctx.panels.searchPanel.hidden).toBe(false);
        expect(ctx.tabs.searchTab.getAttribute("aria-pressed")).toBe("true");
    });

    test("typing a new food's name picks A new food", () => {
        const ctx = setup();
        const form = new El("form");
        const radioHh = new El("input", { name: "food_choice", value: "hh" });
        radioHh.checked = true;
        const radioNew = new El("input", {
            name: "food_choice",
            value: "new",
        });
        const name = new El("input", { "data-fd-usual-add-newname": "" });
        form.add(radioHh, radioNew, name);
        ctx.fire("input", { target: name });
        expect(radioNew.checked).toBe(true);
    });
});

describe("Add a usual offers the amount the food already has", () => {
    /** A form with the amount stepper and the unit pull-down, as the sheet draws them. */
    function purchaseForm() {
        const form = new El("form");
        const amount = new El("input", { name: "usual_amount" });
        amount.value = "1";
        const field = new El("input", {
            name: "usual_unit",
            "data-fd-menu-field": "",
        });
        field.value = "each";
        const each = new El("button", {
            "data-fd-menu-value": "each",
            "aria-checked": "true",
        });
        const litres = new El("button", {
            "data-fd-menu-value": "l",
            "aria-checked": "false",
        });
        const menu = new El("div", { "data-fd-menu": "" }).add(
            field,
            each,
            litres,
        );
        form.add(amount, menu);
        return { form, amount, field, each, litres };
    }

    test("choosing a food that has a usual amount fills the amount and unit", () => {
        const ctx = setup();
        const { form, amount, field, litres } = purchaseForm();
        const radio = new El("input", { name: "food_choice", value: "milk" });
        radio.checked = true;
        form.add(
            new El("li", {
                "data-fd-usual-amount": "2",
                "data-fd-usual-unit": "l",
            }).add(radio),
        );
        ctx.fire("change", { target: radio });
        expect(amount.value).toBe("2");
        expect(field.value).toBe("l");
        expect(litres.getAttribute("aria-checked")).toBe("true");
    });

    test("a food with no usual amount picks No amount", () => {
        const ctx = setup();
        const { form, field } = purchaseForm();
        const radio = new El("input", { name: "food_choice", value: "salt" });
        radio.checked = true;
        form.add(
            new El("li", {
                "data-fd-usual-amount": "",
                "data-fd-usual-unit": "",
            }).add(radio),
        );
        ctx.fire("change", { target: radio });
        expect(field.value).toBe("");
    });

    test("an amount the person typed is not replaced by the next food's", () => {
        const ctx = setup();
        const { form, amount } = purchaseForm();
        const radio = new El("input", { name: "food_choice", value: "milk" });
        radio.checked = true;
        form.add(
            new El("li", {
                "data-fd-usual-amount": "2",
                "data-fd-usual-unit": "l",
            }).add(radio),
        );
        amount.value = "6";
        ctx.fire("input", { target: amount, isTrusted: true });
        ctx.fire("change", { target: radio });
        expect(amount.value).toBe("6");
    });

    test("typing the name of a food that has an amount brings it; a new name starts at one each", () => {
        const ctx = setup();
        const { form, amount, field } = purchaseForm();
        form.setAttribute(
            "data-fd-usual-known",
            JSON.stringify({ milk: [2, "l"], salt: ["", ""] }),
        );
        const name = new El("input", { name: "name" });
        form.add(name);
        name.value = " Milk ";
        ctx.fire("input", { target: name, isTrusted: true });
        expect(amount.value).toBe("2");
        expect(field.value).toBe("l");
        name.value = "Salt";
        ctx.fire("input", { target: name, isTrusted: true });
        expect(field.value).toBe("");
        name.value = "Oat milk";
        ctx.fire("input", { target: name, isTrusted: true });
        expect(amount.value).toBe("1");
        expect(field.value).toBe("each");
    });
});
