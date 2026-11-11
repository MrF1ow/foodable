import { expect, test } from "bun:test";

// Drives the real sheet.js against a fake window / document / dialog, the way
// src/app-js.test.ts drives modal.js. No DOM library: the fakes implement only
// what the module touches.

type Listener = (e: any) => void;

class FakeEl {
    listeners: Record<string, Listener[]> = {};
    style: Record<string, string> = {};
    attrs = new Set<string>();
    children: FakeEl[] = [];
    focused = false;
    isConnected = true;
    classList = { contains: (c: string) => this.classes.includes(c) };
    constructor(
        readonly tag: string,
        readonly classes: string[] = [],
        public parent: FakeEl | null = null,
    ) {
        parent?.children.push(this);
    }
    addEventListener(type: string, fn: Listener, opts?: { once?: boolean }) {
        const wrapped: Listener = opts?.once
            ? (e) => {
                  this.removeEventListener(type, wrapped);
                  fn(e);
              }
            : fn;
        (this.listeners[type] ??= []).push(wrapped);
    }
    removeEventListener(type: string, fn: Listener) {
        this.listeners[type] = (this.listeners[type] ?? []).filter(
            (l) => l !== fn,
        );
    }
    fire(type: string, e: Record<string, unknown> = {}) {
        const event = { type, target: this, ...e };
        for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
    }
    count(type: string) {
        return (this.listeners[type] ?? []).length;
    }
    matches(sel: string) {
        return sel.split(",").some((part) => {
            const s = part.trim();
            return s.startsWith(".")
                ? this.classes.includes(s.slice(1))
                : this.tag === s;
        });
    }
    closest(sel: string): FakeEl | null {
        for (let el: FakeEl | null = this; el; el = el.parent) {
            if (el.matches(sel)) return el;
        }
        return null;
    }
    contains(other: FakeEl) {
        for (let el: FakeEl | null = other; el; el = el.parent) {
            if (el === this) return true;
        }
        return false;
    }
    focus() {
        focusLog.push(this);
        this.focused = true;
    }
}

const focusLog: FakeEl[] = [];

class FakeDialog extends FakeEl {
    open = false;
    showCalls = 0;
    closeCalls = 0;
    /** Real browsers queue the close event; hold it until flush(). */
    deferClose = false;
    private pendingClose = false;
    field: FakeEl | null = null;
    panel: FakeEl;
    handle: FakeEl;
    head: FakeEl;
    headButton: FakeEl;
    body: FakeEl;
    constructor(
        readonly doc: FakeDoc,
        withField = false,
        reopen = false,
    ) {
        super("dialog", ["fd-sheet"]);
        if (reopen) this.attrs.add("data-sheet-open-on-load");
        this.panel = new FakeEl("div", ["fd-sheet-panel"], this);
        this.handle = new FakeEl("div", ["fd-sheet-handle"], this.panel);
        this.head = new FakeEl("header", ["fd-sheet-head"], this.panel);
        this.headButton = new FakeEl("button", [], this.head);
        this.body = new FakeEl("div", ["fd-sheet-body"], this.panel);
        if (withField) this.field = new FakeEl("input", [], this.body);
        doc.dialogs.push(this);
    }
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    querySelector(sel: string) {
        if (sel.includes("input")) return this.field;
        if (sel === ".fd-sheet-panel") return this.panel;
        return null;
    }
    showModal() {
        this.showCalls += 1;
        this.fire("beforetoggle", {
            newState: "open",
            target: this,
        });
        this.open = true;
        // The real toggle event is queued; tests fire it on demand.
    }
    close() {
        this.closeCalls += 1;
        if (!this.open) return;
        this.open = false;
        if (this.deferClose) this.pendingClose = true;
        else this.fire("close");
    }
    flush() {
        if (!this.pendingClose) return;
        this.pendingClose = false;
        this.fire("close");
    }
    setPointerCapture() {}
    releasePointerCapture() {}
}

class FakeDoc extends FakeEl {
    dialogs: FakeDialog[] = [];
    /** Open old-style modal.js dialogs (`dialog.modal[open]`). */
    openModals: FakeEl[] = [];
    body = new FakeEl("body");
    activeElement: FakeEl | null = null;
    constructor() {
        super("document");
    }
    querySelectorAll(sel: string) {
        if (sel === "dialog.fd-sheet[open]") {
            return this.dialogs.filter((d) => d.open);
        }
        if (sel === "dialog.modal[open]") return this.openModals;
        return sel === "dialog.fd-sheet" ? this.dialogs : [];
    }
}

function setup(
    media: {
        coarse?: boolean;
        wide?: boolean;
        reduced?: boolean;
        viewport?: boolean;
    } = {},
) {
    focusLog.length = 0;
    const state = { coarse: true, wide: false, reduced: false, ...media };
    const doc = new FakeDoc();
    const scrolls: Array<[number, number]> = [];
    const dispatched: Array<{ type: string; detail: unknown }> = [];
    const hooks: Array<(root: FakeDoc) => void> = [];
    // A fake visualViewport (844px tall page; the keyboard shrinks `height`).
    const viewport = media.viewport
        ? Object.assign(new FakeEl("visualviewport"), {
              height: 844,
              offsetTop: 0,
          })
        : undefined;
    // The layout viewport stays 844px; iOS shrinks innerHeight with the
    // keyboard, so the module must not read it (set lower here on purpose).
    if (viewport) {
        (doc as any).documentElement = { clientHeight: 844 };
    }
    const window = {
        innerHeight: 600,
        visualViewport: viewport,
        FoodableApp: {
            onLoad: (fn: (root: FakeDoc) => void) => {
                hooks.push(fn);
                fn(doc);
            },
        },
        matchMedia: (q: string) => ({
            matches:
                (q.includes("pointer: coarse") && state.coarse) ||
                (q.includes("min-width: 1024px") && state.wide) ||
                (q.includes("prefers-reduced-motion") && state.reduced),
        }),
        scrollY: 120,
        scrollTo: (x: number, y: number) => scrolls.push([x, y]),
        dispatchEvent: (e: { type: string; detail: unknown }) =>
            dispatched.push({ type: e.type, detail: e.detail }),
    };
    return { doc, window, state, scrolls, dispatched, hooks, viewport };
}

const source = await Bun.file("./src/web/client/v2/sheet.js").text();
const exported = new Function(`return (${JSON.stringify({})}, null)`);
void exported;

function load(ctx: ReturnType<typeof setup>) {
    new Function("window", "document", source)(ctx.window, ctx.doc);
}

function rig(
    opts: Parameters<typeof setup>[0] = {},
    dialogOpts: { field?: boolean; reopen?: boolean } = {},
) {
    const ctx = setup(opts);
    const dialog = new FakeDialog(ctx.doc, dialogOpts.field, dialogOpts.reopen);
    load(ctx);
    return { ...ctx, dialog };
}

function openIt(dialog: FakeDialog) {
    dialog.showModal();
    dialog.fire("toggle");
}

type Step = { y: number; t: number };

// Pointer helpers: pointerdown on the handle, moves on the document.
function drag(
    r: ReturnType<typeof rig>,
    steps: [Step, ...Step[]],
    from: FakeEl = r.dialog.handle,
) {
    const [first, ...rest] = steps;
    r.dialog.fire("pointerdown", {
        target: from,
        pointerId: 1,
        button: 0,
        clientY: first.y,
        timeStamp: first.t,
    });
    for (const s of rest) {
        r.doc.fire("pointermove", {
            pointerId: 1,
            clientY: s.y,
            timeStamp: s.t,
        });
    }
    const last = steps[steps.length - 1] as Step;
    r.doc.fire("pointerup", {
        pointerId: 1,
        clientY: last.y,
        timeStamp: last.t,
    });
}

test("registers once with FoodableApp.onLoad", () => {
    const r = rig();
    expect(r.hooks.length).toBe(1);
});

test("data-sheet-open-on-load opens the sheet and locks page scroll", () => {
    const r = rig({}, { reopen: true });
    expect(r.dialog.showCalls).toBe(1);
    expect(r.dialog.open).toBe(true);
    expect(r.doc.body.style.position).toBe("fixed");
    expect(r.doc.body.style.top).toBe("-120px");
});

test("a sheet without the attribute stays closed", () => {
    const r = rig();
    expect(r.dialog.showCalls).toBe(0);
    expect(r.doc.body.style.position).toBeUndefined();
});

test("re-running onLoad is idempotent: no doubled listeners, no second open", () => {
    const r = rig({}, { reopen: true });
    const before = {
        click: r.dialog.count("click"),
        close: r.dialog.count("close"),
        pointerdown: r.dialog.count("pointerdown"),
        toggle: r.dialog.count("toggle"),
    };
    for (const hook of r.hooks) hook(r.doc);
    expect(r.dialog.count("click")).toBe(before.click);
    expect(r.dialog.count("close")).toBe(before.close);
    expect(r.dialog.count("pointerdown")).toBe(before.pointerdown);
    expect(r.dialog.count("toggle")).toBe(before.toggle);
    expect(r.dialog.showCalls).toBe(1);
    // The document-level Turbo hooks are registered once per module load.
    expect(r.doc.count("turbo:before-render")).toBe(1);
});

test("open-on-load focuses once: the toggle that follows does not focus again", () => {
    const r = rig({}, { reopen: true, field: true });
    expect(focusLog).toEqual([r.dialog.field!]);
    r.dialog.fire("toggle");
    expect(focusLog).toEqual([r.dialog.field!]);
});

test("a late toggle event does not count an open sheet twice", () => {
    const r = rig({}, { reopen: true });
    r.dialog.fire("toggle");
    r.dialog.close();
    expect(r.doc.body.style.position).toBe("");
    expect(r.scrolls).toEqual([[0, 120]]);
});

test("opening focuses the first field, or the panel when there is none", () => {
    const withField = rig({}, { field: true });
    openIt(withField.dialog);
    expect(focusLog).toEqual([withField.dialog.field!]);
    const bare = rig();
    openIt(bare.dialog);
    expect(focusLog).toEqual([bare.dialog.panel]);
});

test("backdrop click closes; a click inside does not", () => {
    const r = rig();
    openIt(r.dialog);
    r.dialog.fire("pointerdown", { target: r.dialog.body });
    r.dialog.fire("click", { target: r.dialog.body });
    expect(r.dialog.open).toBe(true);
    r.dialog.fire("pointerdown", { target: r.dialog });
    r.dialog.fire("click", { target: r.dialog });
    expect(r.dialog.open).toBe(false);
});

test("a click on the dialog that began inside it (text selection drag) does not close", () => {
    const r = rig();
    openIt(r.dialog);
    r.dialog.fire("pointerdown", { target: r.dialog.body });
    r.dialog.fire("click", { target: r.dialog });
    expect(r.dialog.open).toBe(true);
});

test("closing releases the scroll lock and restores the scroll position", () => {
    const r = rig();
    openIt(r.dialog);
    expect(r.doc.body.style.position).toBe("fixed");
    r.dialog.close();
    expect(r.doc.body.style.position).toBe("");
    expect(r.doc.body.style.top).toBe("");
    expect(r.scrolls).toEqual([[0, 120]]);
});

test("the lock is counted per sheet: it holds until the last one closes", () => {
    const ctx = setup();
    const a = new FakeDialog(ctx.doc);
    const b = new FakeDialog(ctx.doc);
    load(ctx);
    openIt(a);
    openIt(b);
    a.close();
    expect(ctx.doc.body.style.position).toBe("fixed");
    b.close();
    expect(ctx.doc.body.style.position).toBe("");
});

test("Esc (cancel) resets an in-flight drag and the sheet closes", () => {
    const r = rig();
    openIt(r.dialog);
    r.dialog.fire("pointerdown", {
        target: r.dialog.handle,
        pointerId: 1,
        button: 0,
        clientY: 100,
        timeStamp: 0,
    });
    r.doc.fire("pointermove", { pointerId: 1, clientY: 150, timeStamp: 50 });
    expect(r.dialog.style.transform).toBe("translateY(50px)");
    r.dialog.fire("cancel");
    expect(r.dialog.style.transform).toBe("");
    expect(r.dialog.style.transition).toBe("");
    expect(r.doc.count("pointermove")).toBe(0);
    r.dialog.close(); // the browser's own close after cancel
    expect(r.dialog.open).toBe(false);
    // The next gesture starts clean.
    drag(r, [
        { y: 100, t: 0 },
        { y: 110, t: 400 },
    ]);
    expect(r.dialog.style.transform).toBe("");
});

test("focus returns to the invoker after close", () => {
    const r = rig({}, { field: true });
    const trigger = new FakeEl("button");
    r.doc.activeElement = trigger;
    openIt(r.dialog);
    expect(r.dialog.field!.focused).toBe(true);
    r.dialog.close();
    expect(focusLog[focusLog.length - 1]).toBe(trigger);
});

test("the native command event names the invoker, even if focus never landed on it", () => {
    const r = rig({}, { field: true });
    const trigger = new FakeEl("button");
    r.doc.activeElement = r.doc.body; // Safari does not focus buttons on click
    r.dialog.fire("command", { source: trigger });
    openIt(r.dialog);
    r.dialog.close();
    expect(focusLog[focusLog.length - 1]).toBe(trigger);
});

test("focus is not restored to an invoker that left the page", () => {
    const r = rig({}, { field: true });
    const trigger = new FakeEl("button");
    r.doc.activeElement = trigger;
    openIt(r.dialog);
    trigger.isConnected = false;
    focusLog.length = 0;
    r.dialog.close();
    expect(focusLog).toEqual([]);
});

test("drag below the threshold snaps back and leaves the sheet open", () => {
    const r = rig();
    openIt(r.dialog);
    drag(r, [
        { y: 100, t: 0 },
        { y: 140, t: 300 },
        { y: 170, t: 600 }, // 70px, slow
    ]);
    expect(r.dialog.open).toBe(true);
    expect(r.dialog.style.transform).toBe("");
    // Animated snap-back, cleared by transitionend.
    expect(r.dialog.style.transition).toBe("transform 180ms ease-out");
    r.dialog.fire("transitionend");
    expect(r.dialog.style.transition).toBe("");
    expect(r.doc.count("pointermove")).toBe(0);
});

test("a flick whose finger rested before release is stale and snaps back", () => {
    const r = rig();
    openIt(r.dialog);
    r.dialog.fire("pointerdown", {
        target: r.dialog.handle,
        pointerId: 1,
        button: 0,
        clientY: 100,
        timeStamp: 0,
    });
    r.doc.fire("pointermove", { pointerId: 1, clientY: 120, timeStamp: 10 }); // 2px/ms
    r.doc.fire("pointerup", { pointerId: 1, clientY: 120, timeStamp: 1010 });
    expect(r.dialog.open).toBe(true);
    expect(r.dialog.style.transform).toBe("");
});

test("the sheet follows the finger while dragging, never above its resting place", () => {
    const r = rig();
    openIt(r.dialog);
    r.dialog.fire("pointerdown", {
        target: r.dialog.head,
        pointerId: 1,
        button: 0,
        clientY: 100,
        timeStamp: 0,
    });
    expect(r.dialog.style.transition).toBe("none");
    r.doc.fire("pointermove", { pointerId: 1, clientY: 60, timeStamp: 100 });
    expect(r.dialog.style.transform).toBe("translateY(0px)");
    r.doc.fire("pointermove", { pointerId: 1, clientY: 130, timeStamp: 200 });
    expect(r.dialog.style.transform).toBe("translateY(30px)");
});

test("drag past the distance threshold closes", () => {
    const r = rig();
    openIt(r.dialog);
    drag(r, [
        { y: 100, t: 0 },
        { y: 150, t: 400 },
        { y: 200, t: 800 }, // 100px > 80px, slow
    ]);
    expect(r.dialog.open).toBe(false);
    expect(r.dialog.style.transform).toBe("");
});

test("a fast flick closes even below the distance threshold", () => {
    const r = rig();
    openIt(r.dialog);
    drag(r, [
        { y: 100, t: 0 },
        { y: 120, t: 10 },
        { y: 150, t: 30 }, // 50px, 1.5px/ms
    ]);
    expect(r.dialog.open).toBe(false);
});

test("a twitch faster than the flick velocity but shorter than the minimum does not close", () => {
    const r = rig();
    openIt(r.dialog);
    drag(r, [
        { y: 100, t: 0 },
        { y: 105, t: 2 }, // 5px at 2.5px/ms
    ]);
    expect(r.dialog.open).toBe(true);
});

test("drag starting on a button, input or the body is ignored", () => {
    const r = rig({}, { field: true });
    openIt(r.dialog);
    drag(
        r,
        [
            { y: 100, t: 0 },
            { y: 300, t: 100 },
        ],
        r.dialog.headButton,
    );
    expect(r.dialog.open).toBe(true);
    drag(
        r,
        [
            { y: 100, t: 0 },
            { y: 300, t: 100 },
        ],
        r.dialog.field!,
    );
    expect(r.dialog.open).toBe(true);
    drag(
        r,
        [
            { y: 100, t: 0 },
            { y: 300, t: 100 },
        ],
        r.dialog.body,
    );
    expect(r.dialog.open).toBe(true);
    expect(r.dialog.style.transform).toBeUndefined();
});

test("drag is ignored with a fine pointer", () => {
    const r = rig({ coarse: false });
    openIt(r.dialog);
    drag(r, [
        { y: 100, t: 0 },
        { y: 300, t: 100 },
    ]);
    expect(r.dialog.open).toBe(true);
    expect(r.dialog.style.transform).toBeUndefined();
});

test("drag is ignored at the panel breakpoint (>= 1024px)", () => {
    const r = rig({ wide: true });
    openIt(r.dialog);
    drag(r, [
        { y: 100, t: 0 },
        { y: 300, t: 100 },
    ]);
    expect(r.dialog.open).toBe(true);
    expect(r.dialog.style.transform).toBeUndefined();
});

test("reduced motion: the snap back sets no transition", () => {
    const r = rig({ reduced: true });
    openIt(r.dialog);
    const seen: string[] = [];
    let current = "";
    Object.defineProperty(r.dialog.style, "transition", {
        get: () => current,
        set: (v: string) => {
            current = v;
            seen.push(v);
        },
    });
    drag(r, [
        { y: 100, t: 0 },
        { y: 140, t: 300 },
        { y: 160, t: 600 },
    ]);
    expect(r.dialog.open).toBe(true);
    expect(r.dialog.style.transform).toBe("");
    // "none" while the finger is down, then cleared: never an animated one.
    expect(seen.some((v) => v.includes("transform"))).toBe(false);
    expect(current).toBe("");
});

test("turbo:before-render closes open sheets, releases the lock and tells the shell", () => {
    const r = rig();
    r.dialog.deferClose = true;
    openIt(r.dialog);
    r.doc.fire("turbo:before-render");
    expect(r.dialog.open).toBe(false);
    expect(r.doc.body.style.position).toBe("");
    expect(r.scrolls).toEqual([[0, 120]]);
    expect(r.dispatched).toEqual([
        { type: "foodable:scroll-lock-release", detail: { y: 120 } },
    ]);
    // The queued close event then finds nothing left to release.
    r.dialog.flush();
    expect(r.scrolls.length).toBe(1);
    // A second swap with nothing open is a no-op.
    r.doc.fire("turbo:before-render");
    expect(r.scrolls.length).toBe(1);
});

test("turbo:before-morph-element releases the lock only for an fd-sheet", () => {
    const r = rig();
    r.dialog.deferClose = true;
    openIt(r.dialog);
    r.doc.fire("turbo:before-morph-element", {
        detail: { currentElement: new FakeEl("dialog", ["modal"]) },
    });
    expect(r.dialog.open).toBe(true);
    r.doc.fire("turbo:before-morph-element", {
        detail: { currentElement: r.dialog },
    });
    expect(r.dialog.open).toBe(false);
    expect(r.doc.body.style.position).toBe("");
});

test("coexists with modal.js: it closes the sheet first, then ours finds nothing left", () => {
    const r = rig();
    openIt(r.dialog);
    r.dialog.deferClose = true;
    // modal.js's own before-render handler closes every dialog[open] first ...
    r.dialog.close();
    // ... ours then still releases the lock, and the queued close adds nothing.
    r.doc.fire("turbo:before-render");
    r.dialog.flush();
    expect(r.doc.body.style.position).toBe("");
    expect(r.scrolls.length).toBe(1);
});

test("a lock held by modal.js is left alone: the sheet neither takes nor clears it", () => {
    const ctx = setup();
    ctx.doc.body.style.position = "fixed";
    ctx.doc.body.style.top = "-40px";
    ctx.doc.body.style.width = "100%";
    const dialog = new FakeDialog(ctx.doc);
    load(ctx);
    openIt(dialog);
    expect(ctx.doc.body.style).toEqual({
        position: "fixed",
        top: "-40px",
        width: "100%",
    });
    dialog.close();
    expect(ctx.doc.body.style).toEqual({
        position: "fixed",
        top: "-40px",
        width: "100%",
    });
    expect(ctx.scrolls).toEqual([]);
});

test("a swap while another module owns the lock does not scroll or announce a release", () => {
    const ctx = setup();
    ctx.doc.body.style.position = "fixed";
    const dialog = new FakeDialog(ctx.doc);
    load(ctx);
    openIt(dialog);
    ctx.doc.fire("turbo:before-render");
    expect(ctx.scrolls).toEqual([]);
    expect(ctx.dispatched).toEqual([]);
    expect(ctx.doc.body.style.position).toBe("fixed");
});

test("closing keeps the styles while an old modal is still open (modal.js clears them)", () => {
    const r = rig();
    openIt(r.dialog);
    expect(r.doc.body.style.position).toBe("fixed");
    r.doc.openModals.push(new FakeEl("dialog", ["modal"]));
    r.dialog.close();
    expect(r.doc.body.style.position).toBe("fixed");
    expect(r.scrolls).toEqual([]);
    // Ownership was handed over: a later sheet open/close does not clear it either.
    r.doc.openModals.length = 0;
    openIt(r.dialog);
    r.dialog.close();
    expect(r.doc.body.style.position).toBe("fixed");
});

test("a second sheet takes the lock once modal.js has let it go", () => {
    const ctx = setup();
    ctx.doc.body.style.position = "fixed";
    const first = new FakeDialog(ctx.doc);
    const second = new FakeDialog(ctx.doc);
    load(ctx);
    openIt(first);
    // The old modal under it closes and modal.js clears the body styles.
    ctx.doc.body.style.position = "";
    openIt(second);
    expect(ctx.doc.body.style.position).toBe("fixed");
    second.close();
    expect(ctx.doc.body.style.position).toBe("fixed");
    first.close();
    expect(ctx.doc.body.style.position).toBe("");
});

// The on-screen keyboard (iOS covers the page instead of shrinking it).
function keyboard(
    r: ReturnType<typeof rig>,
    height: number,
    offsetTop = 0,
    event: "resize" | "scroll" = "resize",
) {
    const vv = r.viewport!;
    Object.assign(vv, { height: 844 - height - offsetTop, offsetTop });
    vv.fire(event);
}

test("an open bottom sheet is lifted above the keyboard and fits what is left", () => {
    const r = rig({ viewport: true }, { field: true });
    openIt(r.dialog);
    expect(r.dialog.style.bottom ?? "").toBe("");
    keyboard(r, 300);
    expect(r.dialog.style.bottom).toBe("300px");
    expect(r.dialog.style.maxHeight).toBe(`${Math.floor(544 * 0.9)}px`);
});

test("a Safari pan of the visual viewport is accounted for", () => {
    const r = rig({ viewport: true }, { field: true });
    openIt(r.dialog);
    // 300px keyboard, view panned 120px down: 424px visible, from y=120.
    keyboard(r, 300, 120, "scroll");
    expect(r.dialog.style.bottom).toBe("300px");
    expect(r.dialog.style.maxHeight).toBe(`${Math.floor(424 * 0.9)}px`);
});

test("the fit is cleared when the keyboard goes away and when the sheet closes", () => {
    const r = rig({ viewport: true }, { field: true });
    openIt(r.dialog);
    keyboard(r, 300);
    keyboard(r, 0);
    expect(r.dialog.style.bottom).toBe("");
    expect(r.dialog.style.maxHeight).toBe("");
    keyboard(r, 300);
    r.dialog.close();
    expect(r.dialog.style.bottom).toBe("");
    expect(r.dialog.style.maxHeight).toBe("");
});

test("a sheet opened while the keyboard is already up is fitted on open", () => {
    const r = rig({ viewport: true }, { field: true });
    keyboard(r, 250);
    openIt(r.dialog);
    expect(r.dialog.style.bottom).toBe("250px");
});

test("no keyboard fit at the panel breakpoint", () => {
    const r = rig({ viewport: true, wide: true }, { field: true });
    openIt(r.dialog);
    keyboard(r, 300);
    expect(r.dialog.style.bottom).toBe("");
});

test("closed sheets and browsers without visualViewport are left alone", () => {
    const r = rig({ viewport: true }, { field: true });
    keyboard(r, 300);
    expect(r.dialog.style.bottom).toBeUndefined();
    const bare = rig({}, { field: true });
    openIt(bare.dialog);
    expect(bare.dialog.style.bottom).toBeUndefined();
});
