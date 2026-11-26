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

// ---- placement of a panel inside a sheet ----
//
// Hand-rolled fakes, like the repo's other client tests: just the parts of the
// DOM that menu.js touches when a menu opens and when the screen changes.

type Rect = { left: number; top: number; right: number; bottom: number };
type Handler = (event: Record<string, unknown>) => void;

class FakeElement {}

class Node_ extends FakeElement {
    tagName = "DIV";
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    hidden = false;
    open = false;
    attrs = new Map<string, string>();
    classes = new Set<string>();
    handlers = new Map<string, Handler[]>();
    offsetWidth = 234;
    scrollHeight = 100;
    rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    kids = new Map<string, Node_>();
    inSheet: Node_ | null = null;
    get classList() {
        return { contains: (name: string) => this.classes.has(name) };
    }
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }
    addEventListener(type: string, fn: Handler) {
        this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    }
    getBoundingClientRect() {
        return this.rect;
    }
    querySelector(sel: string) {
        return this.kids.get(sel) ?? null;
    }
    querySelectorAll() {
        return [];
    }
    closest(sel: string) {
        return sel === ".fd-sheet" ? this.inSheet : null;
    }
    contains(other: unknown) {
        return other === this;
    }
    fire(type: string, event: Record<string, unknown> = {}) {
        for (const fn of this.handlers.get(type) ?? []) fn(event);
    }
}

type Screen = {
    innerHeight: number;
    visualViewport?: { height: number; offsetTop: number };
};

// Loads menu.js against a fake page: one sheet holding an anchored menu (a
// trigger and a panel) and a `<details>` menu.
async function page(screen: Screen) {
    const sheet = new Node_();
    sheet.rect = { left: 0, top: 0, right: 390, bottom: screen.innerHeight };

    const menu = new Node_();
    menu.attrs.set("data-fd-menu", "");
    menu.inSheet = sheet;
    const trigger = new Node_();
    const panel = new Node_();
    panel.hidden = true;
    menu.kids.set("[data-fd-menu-trigger]", trigger);
    menu.kids.set(".fd-menu__panel", panel);

    const details = new Node_();
    details.tagName = "DETAILS";
    details.classes.add("fd-menu");
    details.inSheet = sheet;
    const detailsPanel = new Node_();
    details.kids.set(".fd-menu__panel", detailsPanel);

    const docHandlers = new Map<string, Handler[]>();
    const document = {
        readyState: "complete",
        documentElement: { clientWidth: 390 },
        addEventListener(type: string, fn: Handler) {
            docHandlers.set(type, [...(docHandlers.get(type) ?? []), fn]);
        },
        querySelectorAll(sel: string) {
            if (sel === "[data-fd-menu]") return [menu];
            if (sel === "details.fd-menu[open]")
                return details.open ? [details] : [];
            return [];
        },
    };
    const viewportHandlers = new Map<string, Handler[]>();
    const windowHandlers = new Map<string, Handler[]>();
    const win: Record<string, unknown> = {
        innerHeight: screen.innerHeight,
        addEventListener(type: string, fn: Handler) {
            windowHandlers.set(type, [...(windowHandlers.get(type) ?? []), fn]);
        },
        FoodableApp: { onLoad: (fn: (scope: unknown) => void) => fn(document) },
    };
    let vv = screen.visualViewport;
    if (vv) {
        const live = vv;
        win.visualViewport = {
            get height() {
                return live.height;
            },
            get offsetTop() {
                return live.offsetTop;
            },
            addEventListener(type: string, fn: Handler) {
                viewportHandlers.set(type, [
                    ...(viewportHandlers.get(type) ?? []),
                    fn,
                ]);
            },
        };
    }
    const src = await Bun.file(
        new URL("./menu.js", import.meta.url).pathname,
    ).text();
    new Function("window", "document", "WeakSet", "Element", src)(
        win,
        document,
        WeakSet,
        FakeElement,
    );
    return {
        sheet,
        menu,
        trigger,
        panel,
        details,
        detailsPanel,
        viewport: vv,
        // The screen changed: the keyboard opened or closed.
        resize(next: { height: number; offsetTop: number }) {
            Object.assign(vv!, next);
            for (const fn of viewportHandlers.get("resize") ?? []) fn({});
        },
        pan(next: { height: number; offsetTop: number }) {
            Object.assign(vv!, next);
            for (const fn of viewportHandlers.get("scroll") ?? []) fn({});
        },
        resizeWindow(height: number) {
            win.innerHeight = height;
            for (const fn of windowHandlers.get("resize") ?? []) fn({});
        },
        toggle(target: Node_) {
            for (const fn of docHandlers.get("toggle") ?? []) fn({ target });
        },
        tap() {
            trigger.fire("click", { detail: 1 });
        },
    };
}

const px = (value: string | undefined) => Number.parseFloat(value ?? "NaN");
const EDGE = 8;

test("with the keyboard up, a long list opens above the trigger and ends above the keyboard", async () => {
    // iPhone: the window stays 800 tall under the keyboard; the visual
    // viewport is the 400 that shows.
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 400, offsetTop: 0 },
    });
    p.trigger.rect = { left: 150, top: 300, right: 340, bottom: 340 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 500;
    p.tap();
    expect(p.panel.hidden).toBe(false);
    expect(p.panel.dataset.fixed).toBe("");
    const top = px(p.panel.style.top);
    const height = px(p.panel.style.maxHeight);
    // Capped, scrolling inside, and wholly on the visible part of the screen.
    expect(height).toBeLessThan(500);
    expect(p.panel.style.overflowY).toBe("auto");
    expect(top).toBeGreaterThanOrEqual(EDGE);
    expect(top + height).toBeLessThanOrEqual(400 - EDGE);
    // Above the trigger, since the keyboard leaves no room under it.
    expect(top + height).toBeLessThanOrEqual(300);
});

test("a trigger behind the keyboard still gets a panel inside the visible area", async () => {
    // The trigger sits at 581-636, below the 200 that shows: the panel opens
    // "above" it, but its bottom is clamped to the visible area, not the trigger.
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 200, offsetTop: 0 },
    });
    p.trigger.rect = { left: 150, top: 581, right: 340, bottom: 636 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 500;
    p.tap();
    const top = px(p.panel.style.top);
    const height = px(p.panel.style.maxHeight);
    expect(p.panel.style.overflowY).toBe("auto");
    expect(top).toBeGreaterThanOrEqual(EDGE);
    expect(top + height).toBeLessThanOrEqual(200 - EDGE);
    // A pan (scroll on the visual viewport) places it again, still on screen.
    p.pan({ height: 200, offsetTop: 0 });
    expect(
        px(p.panel.style.top) + px(p.panel.style.maxHeight),
    ).toBeLessThanOrEqual(200 - EDGE);
});

test("a list that fits under the trigger above the keyboard opens there, uncapped", async () => {
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 500, offsetTop: 0 },
    });
    p.trigger.rect = { left: 150, top: 100, right: 340, bottom: 140 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 200;
    p.tap();
    expect(px(p.panel.style.top)).toBe(144);
    expect(p.panel.style.maxHeight).toBe("");
});

test("a panned visual viewport (offsetTop) moves the room with it", async () => {
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 400, offsetTop: 100 },
    });
    p.trigger.rect = { left: 150, top: 150, right: 340, bottom: 190 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 500;
    p.tap();
    const top = px(p.panel.style.top);
    const height = px(p.panel.style.maxHeight);
    expect(top).toBeGreaterThanOrEqual(100 + EDGE);
    expect(top + height).toBeLessThanOrEqual(100 + 400 - EDGE);
});

test("without a visual viewport the window's height is the room", async () => {
    const p = await page({ innerHeight: 600 });
    p.trigger.rect = { left: 150, top: 100, right: 340, bottom: 140 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 800;
    p.tap();
    // 600 − 8 − (140 + 4) under the trigger.
    expect(p.panel.style.maxHeight).toBe("448px");
    expect(px(p.panel.style.top)).toBe(144);
    expect(p.panel.style.overflowY).toBe("auto");
});

test("an open panel is placed again when the keyboard comes up, and again when it goes", async () => {
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 700, offsetTop: 0 },
    });
    p.trigger.rect = { left: 150, top: 100, right: 340, bottom: 140 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 400;
    p.tap();
    expect(p.panel.style.maxHeight).toBe("");
    expect(px(p.panel.style.top)).toBe(144);

    p.resize({ height: 300, offsetTop: 0 });
    // 300 − 8 − (140 + 4) left under the trigger.
    expect(p.panel.style.maxHeight).toBe("148px");

    p.resize({ height: 700, offsetTop: 0 });
    expect(p.panel.style.maxHeight).toBe("");

    // Panning the page to a focused field shifts the visual viewport.
    p.pan({ height: 300, offsetTop: 0 });
    expect(p.panel.style.maxHeight).toBe("148px");
});

test("a closed menu is not placed by a resize", async () => {
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 700, offsetTop: 0 },
    });
    p.panel.scrollHeight = 400;
    p.resize({ height: 300, offsetTop: 0 });
    expect(p.panel.dataset.fixed).toBeUndefined();
    expect(p.panel.style.top).toBeUndefined();
});

test("without a visual viewport a window resize places it again", async () => {
    const p = await page({ innerHeight: 800 });
    p.trigger.rect = { left: 150, top: 100, right: 340, bottom: 140 };
    p.menu.rect = p.trigger.rect;
    p.panel.scrollHeight = 400;
    p.tap();
    expect(p.panel.style.maxHeight).toBe("");
    p.resizeWindow(300);
    expect(p.panel.style.maxHeight).toBe("148px");
});

test("the details menu inside a sheet is placed on the screen when it opens and let go when it closes", async () => {
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 400, offsetTop: 0 },
    });
    p.details.rect = { left: 300, top: 300, right: 334, bottom: 334 };
    p.detailsPanel.scrollHeight = 500;
    p.details.open = true;
    p.toggle(p.details);
    expect(p.detailsPanel.dataset.fixed).toBe("");
    const top = px(p.detailsPanel.style.top);
    const height = px(p.detailsPanel.style.maxHeight);
    expect(top + height).toBeLessThanOrEqual(400 - EDGE);
    expect(p.detailsPanel.style.overflowY).toBe("auto");

    // The keyboard goes: it is placed again, with the room it has now.
    p.resize({ height: 800, offsetTop: 0 });
    expect(px(p.detailsPanel.style.top)).toBeGreaterThanOrEqual(EDGE);

    p.details.open = false;
    p.toggle(p.details);
    expect(p.detailsPanel.dataset.fixed).toBeUndefined();
    expect(p.detailsPanel.style.top).toBe("");
    expect(p.detailsPanel.style.maxHeight).toBe("");
});

test("a details menu outside a sheet is left to its own CSS", async () => {
    const p = await page({
        innerHeight: 800,
        visualViewport: { height: 400, offsetTop: 0 },
    });
    p.details.inSheet = null;
    p.details.open = true;
    p.toggle(p.details);
    expect(p.detailsPanel.dataset.fixed).toBeUndefined();
});
