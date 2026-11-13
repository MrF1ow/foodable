import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Listener = (e: Record<string, unknown>) => void;

class FakeEl {
    listeners: Record<string, Listener[]> = {};
    style: Record<string, string> & {
        setProperty?: (k: string, v: string) => void;
        removeProperty?: (k: string) => void;
    } = {};
    attrs: Record<string, string> = {};
    classes: string[];
    children: FakeEl[] = [];
    parent: FakeEl | null = null;
    constructor(
        readonly tag: string,
        classes: string[] = [],
        parent: FakeEl | null = null,
    ) {
        this.classes = classes;
        parent?.children.push(this);
        this.parent = parent;
    }
    classList = {
        contains: (c: string) => this.classes.includes(c),
        add: (...cs: string[]) => {
            for (const c of cs)
                if (!this.classes.includes(c)) this.classes.push(c);
        },
        remove: (...cs: string[]) => {
            this.classes = this.classes.filter((c) => !cs.includes(c));
        },
    };
    addEventListener(type: string, fn: Listener) {
        (this.listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: Listener) {
        this.listeners[type] = (this.listeners[type] ?? []).filter(
            (l) => l !== fn,
        );
    }
    fire(type: string, e: Record<string, unknown> = {}) {
        const event: Record<string, unknown> & {
            preventDefault?: () => void;
            stopPropagation?: () => void;
        } = {
            type,
            target: e.target ?? this,
            ...e,
            prevented: false,
            propagationStopped: false,
        };
        event.preventDefault = () => {
            event.prevented = true;
        };
        event.stopPropagation = () => {
            event.propagationStopped = true;
        };
        for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
        return event;
    }
    count(type: string) {
        return (this.listeners[type] ?? []).length;
    }
    matchesPart(part: string): boolean {
        const token = part.trim();
        if (token === "button") return this.tag === "button";
        if (token === "a") return this.tag === "a";
        if (token === "input") return this.tag === "input";
        if (token === "select") return this.tag === "select";
        if (token === "textarea") return this.tag === "textarea";
        if (token === "label") return this.tag === "label";
        if (token === "form") return this.tag === "form";
        if (token.startsWith("[") && token.endsWith("]")) {
            return token.slice(1, -1) in this.attrs;
        }
        if (token.startsWith(".")) {
            const cls = token.slice(1).split(".")[0] ?? "";
            return cls.length > 0 && this.classes.includes(cls);
        }
        return false;
    }
    closest(sel: string): FakeEl | null {
        const parts = sel.split(",");
        for (let el: FakeEl | null = this; el; el = el.parent) {
            for (const part of parts) {
                if (el.matchesPart(part)) return el;
            }
        }
        return null;
    }
    contains(other: FakeEl): boolean {
        const walk = (el: FakeEl): boolean => {
            if (el === other) return true;
            return el.children.some(walk);
        };
        return walk(this);
    }
    querySelector(sel: string): FakeEl | null {
        const walk = (el: FakeEl): FakeEl | null => {
            if (sel.includes("fd-row__action--lead")) {
                if (
                    el.classes.includes("fd-row__action--lead") ||
                    (el.classes.includes("fd-row__action") &&
                        el.classes.includes("fd-row__action--lead"))
                )
                    return el;
            } else if (sel.includes("fd-row__action--trail")) {
                if (el.classes.includes("fd-row__action--trail")) return el;
            } else if (sel === ".fd-row__body--link") {
                if (el.classes.includes("fd-row__body--link")) return el;
            } else if (sel === ".fd-row__body") {
                if (el.classes.includes("fd-row__body")) return el;
            } else if (sel === "form.fd-inline-form, form" || sel === "form") {
                if (el.tag === "form") return el;
            } else if (sel === 'button[type="submit"]') {
                if (el.tag === "button") return el;
            }
            for (const c of el.children) {
                const hit = walk(c);
                if (hit) return hit;
            }
            return null;
        };
        return walk(this);
    }
    setAttribute(name: string, value: string) {
        this.attrs[name] = value;
    }
    removeAttribute(name: string) {
        delete this.attrs[name];
    }
    getAttribute(name: string) {
        return this.attrs[name] ?? null;
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    get clientWidth() {
        return 320;
    }
}

class FakeForm extends FakeEl {
    requestSubmits: FakeEl[] = [];
    requestSubmit(btn?: FakeEl) {
        if (btn) this.requestSubmits.push(btn);
    }
}

function swipeRow(opts: { hrefBody?: boolean } = {}) {
    const row = new FakeEl("li", ["fd-row", "fd-row--swipe", "fd-row--food"]);
    const leadWrap = new FakeEl(
        "div",
        ["fd-row__action", "fd-row__action--lead"],
        row,
    );
    const leadForm = new FakeForm("form", [], leadWrap);
    const leadBtn = new FakeEl("button", [], leadForm);
    const bodyTag = opts.hrefBody ? "a" : "div";
    const bodyClasses = opts.hrefBody
        ? ["fd-row__body", "fd-row__body--link"]
        : ["fd-row__body"];
    const body = new FakeEl(bodyTag, bodyClasses, row);
    body.style.setProperty = (k: string, v: string) => {
        body.style[k] = v;
    };
    body.style.removeProperty = (k: string) => {
        delete body.style[k];
    };
    const trailWrap = new FakeEl(
        "div",
        ["fd-row__action", "fd-row__action--trail"],
        row,
    );
    const trailForm = new FakeForm("form", [], trailWrap);
    new FakeEl("button", [], trailForm);
    return { row, body, leadForm, trailForm, leadBtn };
}

type SwipeDecision = (opts: {
    dx: number;
    dy: number;
    width: number;
    threshold?: number;
    release?: boolean;
    horizontalLocked?: boolean;
}) => "lead" | "trail" | "cancel" | "pending";

type Setup = ReturnType<typeof setup>;

class FakeDoc extends FakeEl {
    rows: FakeEl[] = [];
    constructor() {
        super("document");
    }
    querySelectorAll(sel: string) {
        if (sel === ".fd-row--swipe") return this.rows;
        return [];
    }
}

function setup(
    media: { coarse?: boolean; fineHover?: boolean; reduced?: boolean } = {},
) {
    let swipeDecision: SwipeDecision | undefined;
    const state = {
        coarse: true,
        fineHover: false,
        reduced: false,
        ...media,
    };
    const hooks: Array<(root: FakeDoc) => void> = [];
    const doc = new FakeDoc();
    const window = {
        FoodableApp: {
            onLoad: (fn: (root: FakeDoc) => void) => {
                hooks.push(fn);
                fn(doc);
            },
        },
        matchMedia: (q: string) => ({
            matches:
                (q.includes("pointer: coarse") && state.coarse) ||
                (q.includes("hover: hover") &&
                    q.includes("pointer: fine") &&
                    state.fineHover) ||
                (q.includes("prefers-reduced-motion") && state.reduced),
        }),
        FOODABLE_EXPOSE_SWIPE_DECISION: (fn: SwipeDecision) => {
            swipeDecision = fn;
        },
    };
    return { doc, window, hooks, state, getDecision: () => swipeDecision! };
}

const source = readFileSync("./src/web/client/v2/swipe-rows.js", "utf8");

function load(ctx: Setup) {
    new Function("window", "document", source)(ctx.window, ctx.doc);
}

const componentsCss = readFileSync("./public/app/v2/components.css", "utf8");

test("past threshold fires", () => {
    const ctx = setup();
    const { row, body, leadForm, leadBtn, trailForm } = swipeRow();
    ctx.doc.rows.push(row);
    load(ctx);
    body.fire("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 50,
    });
    ctx.doc.fire("pointermove", {
        pointerId: 1,
        clientX: 210,
        clientY: 52,
    });
    ctx.doc.fire("pointerup", {
        pointerId: 1,
        clientX: 210,
        clientY: 52,
    });
    expect(leadForm.requestSubmits).toEqual([leadBtn]);

    body.fire("pointerdown", {
        pointerId: 2,
        button: 0,
        clientX: 200,
        clientY: 50,
    });
    ctx.doc.fire("pointermove", {
        pointerId: 2,
        clientX: 80,
        clientY: 52,
    });
    const trailBtn = trailForm.querySelector('button[type="submit"]')!;
    ctx.doc.fire("pointerup", {
        pointerId: 2,
        clientX: 80,
        clientY: 52,
    });
    expect(trailForm.requestSubmits).toEqual([trailBtn]);
});

test("in a list in select mode a swipe on a row fires nothing", () => {
    const ctx = setup();
    const { row, body, leadForm, trailForm } = swipeRow();
    const list = new FakeEl("div");
    list.setAttribute("data-fd-selecting", "");
    row.parent = list;
    list.children.push(row);
    ctx.doc.rows.push(row);
    load(ctx);
    for (const [id, from, to] of [
        [1, 100, 230],
        [2, 230, 90],
    ] as const) {
        body.fire("pointerdown", {
            pointerId: id,
            button: 0,
            clientX: from,
            clientY: 50,
        });
        ctx.doc.fire("pointermove", {
            pointerId: id,
            clientX: to,
            clientY: 52,
        });
        ctx.doc.fire("pointerup", { pointerId: id, clientX: to, clientY: 52 });
    }
    expect(leadForm.requestSubmits).toEqual([]);
    expect(trailForm.requestSubmits).toEqual([]);
});

test("below threshold cancels", () => {
    const ctx = setup();
    load(ctx);
    const d = ctx.getDecision();
    expect(d({ dx: 40, dy: 0, width: 320, release: true })).toBe("cancel");
    expect(d({ dx: -50, dy: 1, width: 320, release: true })).toBe("cancel");
});

test("vertical move cancels", () => {
    const ctx = setup();
    load(ctx);
    const d = ctx.getDecision();
    expect(d({ dx: 12, dy: 40, width: 320 })).toBe("cancel");
    expect(d({ dx: 200, dy: 220, width: 320, release: true })).toBe("cancel");
    expect(
        d({
            dx: 200,
            dy: 220,
            width: 320,
            release: true,
            horizontalLocked: true,
        }),
    ).toBe("lead");
});

test("fine pointer shows buttons", () => {
    const ctx = setup({ coarse: false, fineHover: true });
    const { row, body } = swipeRow();
    ctx.doc.rows.push(row);
    load(ctx);
    expect(body.count("pointerdown")).toBe(0);
    expect(componentsCss).toContain(
        "@media (hover: hover) and (pointer: fine)",
    );
    expect(componentsCss).toMatch(
        /\.fd-row--swipe:not\(\[data-swipe-open\]\):hover \.fd-row__action/,
    );
});

test("registers once with FoodableApp.onLoad", () => {
    const ctx = setup();
    load(ctx);
    expect(ctx.hooks.length).toBe(1);
});

test("pointercancel never submits", () => {
    const ctx = setup();
    const { row, body, trailForm } = swipeRow();
    ctx.doc.rows.push(row);
    load(ctx);
    body.fire("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 180,
        clientY: 50,
    });
    ctx.doc.fire("pointermove", {
        pointerId: 1,
        clientX: 40,
        clientY: 50,
    });
    expect(body.style.transform).toBe("translateX(-96px)");
    expect(row.getAttribute("data-swipe-dragging")).toBe("");
    ctx.doc.fire("pointercancel", {
        pointerId: 1,
        clientX: 0,
        clientY: 0,
    });
    expect(trailForm.requestSubmits).toEqual([]);
    expect(body.style.transform).toBe("");
    expect(row.getAttribute("data-swipe-dragging")).toBeNull();
});

test("href body rows still swipe; a drag suppresses the following click", () => {
    const ctx = setup();
    const { row, body, leadForm, leadBtn } = swipeRow({ hrefBody: true });
    ctx.doc.rows.push(row);
    load(ctx);
    expect(body.count("pointerdown")).toBe(1);
    body.fire("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 50,
        target: body,
    });
    ctx.doc.fire("pointermove", {
        pointerId: 1,
        clientX: 210,
        clientY: 52,
    });
    ctx.doc.fire("pointerup", {
        pointerId: 1,
        clientX: 210,
        clientY: 52,
    });
    expect(leadForm.requestSubmits).toEqual([leadBtn]);
    const click = body.fire("click", { target: body });
    expect(click.prevented).toBe(true);
});

test("row inside an outer form still swipes from the body", () => {
    const ctx = setup();
    const outerForm = new FakeForm("form", [], null);
    const { row, body } = swipeRow();
    row.parent = outerForm;
    outerForm.children.push(row);
    ctx.doc.rows.push(row);
    load(ctx);
    expect(body.count("pointerdown")).toBe(1);
});

test("re-running onLoad is idempotent", () => {
    const ctx = setup();
    const { row, body } = swipeRow();
    ctx.doc.rows.push(row);
    load(ctx);
    const before = body.count("pointerdown");
    for (const hook of ctx.hooks) hook(ctx.doc);
    expect(body.count("pointerdown")).toBe(before);
});
