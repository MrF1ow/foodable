import { describe, expect, test } from "bun:test";

// Hand-rolled fakes: just the DOM and timer surface client/toast.js touches.

type Handler = (event?: unknown) => void;

class FakeEl {
    className = "";
    hidden = false;
    type = "";
    textContent = "";
    parentNode: FakeEl | null = null;
    children: FakeEl[] = [];
    attrs = new Map<string, string>();
    listeners = new Map<string, Handler[]>();
    styles = new Map<string, string>();
    tag: string;
    firstElementChild: FakeEl | null = null;
    constructor(tag: string) {
        this.tag = tag;
    }
    get classList() {
        const el = this;
        return {
            add(c: string) {
                if (!el.has(c)) el.className = `${el.className} ${c}`.trim();
            },
            contains: (c: string) => el.has(c),
            remove(c: string) {
                el.className = el.className
                    .split(" ")
                    .filter((x) => x !== c)
                    .join(" ");
            },
        };
    }
    has(c: string) {
        return this.className.split(" ").includes(c);
    }
    get isConnected() {
        return this.parentNode != null;
    }
    get firstChild(): FakeEl | null {
        return this.children[0] ?? null;
    }
    get lastChild(): FakeEl | null {
        return this.children[this.children.length - 1] ?? null;
    }
    style = { setProperty: (k: string, v: string) => this.styles.set(k, v) };
    setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
    }
    getAttribute(k: string) {
        return this.attrs.get(k) ?? null;
    }
    set innerHTML(_html: string) {
        // The action form markup: a form holding one submit button.
        const form = new FakeEl("form");
        form.appendChild(new FakeEl("button"));
        this.firstElementChild = form;
    }
    appendChild(child: FakeEl) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    insertBefore(child: FakeEl, ref: FakeEl | null) {
        child.parentNode = this;
        const at = ref ? this.children.indexOf(ref) : this.children.length;
        this.children.splice(at, 0, child);
        return child;
    }
    removeChild(child: FakeEl) {
        this.children = this.children.filter((c) => c !== child);
        child.parentNode = null;
        return child;
    }
    remove() {
        this.parentNode?.removeChild(this);
    }
    querySelectorAll(sel: string) {
        return sel === ".toast-item" ? [...this.children] : [];
    }
    querySelector(_sel: string): FakeEl | null {
        return null;
    }
    addEventListener(type: string, fn: Handler) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    fire(type: string) {
        for (const fn of this.listeners.get(type) ?? []) fn({});
    }
}

async function setup() {
    const region = new FakeEl("div");
    const docListeners = new Map<string, Handler[]>();
    let seedEl: FakeEl | null = null;
    // A fake clock: timers fire only when time is advanced.
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const advance = (ms: number) => {
        const target = now + ms;
        for (;;) {
            const due = [...timers.entries()]
                .filter(([, t]) => t.at <= target)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            timers.delete(due[0]);
            now = due[1].at;
            due[1].fn();
        }
        now = target;
    };
    const hooks: Array<(root: unknown) => void> = [];
    const document = {
        getElementById: (id: string) => (id === "toast-region" ? region : null),
        createElement: (tag: string) => new FakeEl(tag),
        addEventListener: (type: string, fn: Handler) => {
            const list = docListeners.get(type) ?? [];
            list.push(fn);
            docListeners.set(type, list);
        },
        querySelector: (sel: string) => (sel === "#toast-seed" ? seedEl : null),
    };
    const FoodableApp: Record<string, unknown> = {
        onLoad: (fn: (root: unknown) => void) => {
            hooks.push(fn);
            fn(document);
        },
    };
    const window = {
        FoodableApp,
        setTimeout: (fn: () => void, ms: number) => {
            const id = nextId++;
            timers.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimeout: (id: number) => {
            timers.delete(id);
        },
    };
    const src = await Bun.file("./src/web/client/toast.js").text();
    new Function("window", "document", src)(window, document);
    const show = (FoodableApp.toast as { show: (o: unknown) => void }).show;
    const dispatch = (type: string) => {
        for (const fn of docListeners.get(type) ?? []) fn({});
    };
    // Turbo: turbo:visit starts the visit, turbo:load renders it and re-runs the hooks.
    const visit = () => dispatch("turbo:visit");
    const load = () => {
        for (const fn of hooks) fn(document);
    };
    const seed = (kind: string, text: string) => {
        const el = new FakeEl("div");
        el.setAttribute("data-toast-kind", kind);
        el.setAttribute("data-toast-text", text);
        seedEl = el;
        // consumeToastSeed removes the seed once it reads it.
        el.remove = () => {
            seedEl = null;
        };
    };
    return { region, show, advance, visit, load, seed };
}

const texts = (region: FakeEl) =>
    region.children.map((el) => el.children[1]?.textContent);

describe("toast lifecycle", () => {
    test("dismisses after 3000 ms, not before", async () => {
        const t = await setup();
        t.show({ kind: "success", text: "Saved" });
        expect(texts(t.region)).toEqual(["Saved"]);
        t.advance(2999);
        expect(t.region.children[0]?.has("toast-item--out")).toBe(false);
        t.advance(1);
        expect(t.region.children[0]?.has("toast-item--out")).toBe(true);
        t.advance(220);
        expect(t.region.children).toHaveLength(0);
    });

    test("a tap on the toast dismisses it before the timer", async () => {
        const t = await setup();
        t.show({ kind: "success", text: "Saved" });
        t.advance(500);
        t.region.children[0]!.fire("click");
        t.advance(220);
        expect(t.region.children).toHaveLength(0);
    });

    test("an action button runs, then the toast goes", async () => {
        const t = await setup();
        t.show({ kind: "info", text: "Removed", actionForm: "<form></form>" });
        const el = t.region.children[0]!;
        const form = el.children[2]!;
        const order: string[] = [];
        form.addEventListener("submit", () => order.push("action"));
        // The browser dispatches the click (bubbling to the toast), then submits.
        el.fire("click");
        order.push("clicked");
        form.fire("submit");
        // The form is still in the page when the action runs.
        expect(el.isConnected).toBe(true);
        expect(order).toEqual(["clicked", "action"]);
        t.advance(220);
        expect(t.region.children).toHaveLength(0);
    });

    test("mouseenter and focusin do not pause it", async () => {
        const t = await setup();
        t.show({ kind: "success", text: "Saved" });
        const el = t.region.children[0]!;
        t.advance(1000);
        el.fire("mouseenter");
        el.fire("focusin");
        expect(el.listeners.has("mouseenter")).toBe(false);
        expect(el.listeners.has("focusin")).toBe(false);
        t.advance(2000);
        t.advance(220);
        expect(t.region.children).toHaveLength(0);
    });

    test("turbo:visit clears every toast at once", async () => {
        const t = await setup();
        t.show({ kind: "success", text: "One" });
        t.show({ kind: "info", text: "Two" });
        expect(t.region.children).toHaveLength(2);
        t.visit();
        expect(t.region.children).toHaveLength(0);
        // The cleared toasts' timers are gone: nothing fires later.
        t.advance(5000);
        expect(t.region.children).toHaveLength(0);
    });

    test("a toast seeded after a redirect, after the visit's clear, still shows", async () => {
        const t = await setup();
        t.show({ kind: "success", text: "Old page" });
        // A POST redirects: turbo:visit clears, then turbo:load reads the seed.
        t.visit();
        t.seed("success", "Saved on the new page");
        t.load();
        expect(texts(t.region)).toEqual(["Saved on the new page"]);
        // It has its own full 3 s.
        t.advance(2999);
        expect(t.region.children[0]?.has("toast-item--out")).toBe(false);
        t.advance(1);
        t.advance(220);
        expect(t.region.children).toHaveLength(0);
    });

    test("a toast pushed out by a fourth does not fire a stale timer", async () => {
        const t = await setup();
        for (const n of ["a", "b", "c", "d"]) t.show({ text: n });
        expect(texts(t.region)).toEqual(["d", "c", "b"]);
        t.advance(3000);
        t.advance(220);
        expect(t.region.children).toHaveLength(0);
    });
});
