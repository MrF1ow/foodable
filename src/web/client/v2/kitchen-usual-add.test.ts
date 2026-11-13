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
    focus() {
        this.focused = true;
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
    const window = { FoodableApp: { onLoad: () => {} } };
    const src = readFileSync(join(import.meta.dir, "kitchen.js"), "utf8");
    new Function("window", "document", src)(window, document);

    const tab = (id: string, selected: boolean) =>
        new El("button", {
            "data-fd-usual-add-tab": id,
            "aria-selected": String(selected),
        });
    const panel = (id: string, shown: boolean) => {
        const p = new El("div", { "data-fd-usual-add-panel": id });
        p.hidden = !shown;
        return p;
    };
    const scanTab = tab("scan", true);
    const searchTab = tab("search", false);
    const typeTab = tab("type", false);
    const scanPanel = panel("scan", true);
    const searchPanel = panel("search", false);
    const typePanel = panel("type", false);
    const dialog = new El("dialog").add(
        scanTab,
        searchTab,
        typeTab,
        scanPanel,
        searchPanel,
        typePanel,
    );
    const fire = (type: string, event: Record<string, unknown>) => {
        for (const fn of listeners[type] ?? []) fn(event);
    };
    return {
        fire,
        dialog,
        tabs: { scanTab, searchTab, typeTab },
        panels: { scanPanel, searchPanel, typePanel },
    };
}

describe("Add a usual tabs", () => {
    test("choosing a tab selects it and shows only its panel", () => {
        const ctx = setup();
        ctx.fire("click", { target: ctx.tabs.typeTab });
        expect(ctx.tabs.typeTab.getAttribute("aria-selected")).toBe("true");
        expect(ctx.tabs.typeTab.getAttribute("tabindex")).toBe("0");
        expect(ctx.tabs.scanTab.getAttribute("aria-selected")).toBe("false");
        expect(ctx.tabs.scanTab.getAttribute("tabindex")).toBe("-1");
        expect(ctx.panels.typePanel.hidden).toBe(false);
        expect(ctx.panels.scanPanel.hidden).toBe(true);
        expect(ctx.panels.searchPanel.hidden).toBe(true);
    });

    test("a click that is not on a tab changes nothing", () => {
        const ctx = setup();
        ctx.fire("click", { target: ctx.panels.scanPanel });
        expect(ctx.panels.scanPanel.hidden).toBe(false);
        expect(ctx.tabs.scanTab.getAttribute("aria-selected")).toBe("true");
    });

    test("arrow keys move to the next tab, wrapping, and focus it", () => {
        const ctx = setup();
        let prevented = false;
        ctx.fire("keydown", {
            key: "ArrowLeft",
            target: ctx.tabs.scanTab,
            preventDefault: () => {
                prevented = true;
            },
        });
        expect(prevented).toBe(true);
        expect(ctx.tabs.typeTab.getAttribute("aria-selected")).toBe("true");
        expect(ctx.tabs.typeTab.focused).toBe(true);
        expect(ctx.panels.typePanel.hidden).toBe(false);
        ctx.fire("keydown", {
            key: "ArrowRight",
            target: ctx.tabs.typeTab,
            preventDefault: () => {},
        });
        expect(ctx.tabs.scanTab.getAttribute("aria-selected")).toBe("true");
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
