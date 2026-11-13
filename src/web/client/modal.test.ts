import { expect, test } from "bun:test";

// Drives the real modal.js (the household app's dialog.modal) against a fake
// window / document / dialog: the backdrop dismissal, which rides on capture
// listeners on `document` because iOS may hand a backdrop tap to the page
// behind the dialog rather than to the dialog. Its twin for the redesign's
// sheets is v2/sheet.test.ts.

type Listener = (e: any) => void;

class FakeEl {
    listeners: Record<string, Listener[]> = {};
    style: Record<string, string> = {};
    children: FakeEl[] = [];
    constructor(public parent: FakeEl | null = null) {
        parent?.children.push(this);
    }
    addEventListener(type: string, fn: Listener) {
        (this.listeners[type] ??= []).push(fn);
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
    contains(other: FakeEl | null) {
        for (let el: FakeEl | null = other; el; el = el.parent) {
            if (el === this) return true;
        }
        return false;
    }
}

class FakeDialog extends FakeEl {
    readonly tagName = "DIALOG";
    open = false;
    rect = { left: 0, right: 390, top: 300, bottom: 844 };
    sheet = new FakeEl(this);
    body = new FakeEl(this.sheet);
    constructor(private doc: FakeDoc) {
        super();
        doc.dialogs.push(this);
    }
    showModal() {
        this.open = true;
        // A dialog's events pass the document in the capture phase.
        this.doc.fire("beforetoggle", { newState: "open", target: this });
        this.fire("toggle");
        this.doc.fire("toggle", { target: this });
    }
    close() {
        if (!this.open) return;
        this.open = false;
        this.fire("toggle");
        this.doc.fire("close", { target: this });
    }
    getBoundingClientRect() {
        return this.rect;
    }
    querySelector(sel: string) {
        return sel === ".modal-sheet" ? this.sheet : null;
    }
    hasAttribute() {
        return false;
    }
}

/**
 * A modal dialog that is not a `dialog.modal`: the redesign's full-screen
 * barcode scanner, or a sheet. It sits in the top layer above whatever opened
 * it, which stays open beneath.
 */
class FakeOtherDialog extends FakeEl {
    readonly tagName = "DIALOG";
    open = false;
    rect = { left: 0, right: 390, top: 0, bottom: 844 };
    closeButton = new FakeEl(this);
    constructor(private doc: FakeEl) {
        super();
    }
    showModal() {
        this.doc.fire("beforetoggle", { newState: "open", target: this });
        this.open = true;
        this.doc.fire("toggle", { target: this });
    }
    close() {
        if (!this.open) return;
        this.open = false;
        this.doc.fire("close", { target: this });
    }
    getBoundingClientRect() {
        return this.rect;
    }
}

class FakeDoc extends FakeEl {
    dialogs: FakeDialog[] = [];
    body = new FakeEl();
    querySelectorAll(sel: string) {
        if (sel === "dialog.modal") return this.dialogs;
        if (sel === "dialog[open]") return this.dialogs.filter((d) => d.open);
        return [];
    }
}

const source = await Bun.file("./src/web/client/modal.js").text();

function rig(dialogs = 1) {
    const doc = new FakeDoc();
    const made = Array.from({ length: dialogs }, () => new FakeDialog(doc));
    const window = {
        FoodableApp: { onLoad: (fn: (root: FakeDoc) => void) => fn(doc) },
        matchMedia: () => ({ matches: false }),
        scrollY: 0,
        scrollTo() {},
        dispatchEvent() {},
    };
    new Function("window", "document", "CustomEvent", source)(
        window,
        doc,
        class {},
    );
    for (const d of made) d.showModal();
    return { doc, dialog: made[0]!, dialogs: made };
}

type Spy = {
    stopped: boolean;
    prevented: boolean;
    stopPropagation: () => void;
    preventDefault: () => void;
};
function spy(): Spy {
    const s: Spy = {
        stopped: false,
        prevented: false,
        stopPropagation: () => (s.stopped = true),
        preventDefault: () => (s.prevented = true),
    };
    return s;
}
function click(
    r: ReturnType<typeof rig>,
    target: FakeEl,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
) {
    const s = spy();
    r.doc.fire("click", {
        target,
        clientX: x,
        clientY: y,
        detail: 1,
        ...s,
        ...extra,
    });
    return s;
}
function press(
    r: ReturnType<typeof rig>,
    target: FakeEl,
    x: number,
    y: number,
) {
    r.doc.fire("pointerdown", { target, clientX: x, clientY: y });
}
function touch(x: number, y: number) {
    return { clientX: x, clientY: y };
}
function touchStart(
    r: ReturnType<typeof rig>,
    target: FakeEl,
    x: number,
    y: number,
) {
    r.doc.fire("touchstart", { target, touches: [touch(x, y)] });
}
function touchEnd(
    r: ReturnType<typeof rig>,
    target: FakeEl,
    x: number,
    y: number,
) {
    const s = spy();
    r.doc.fire("touchend", {
        target,
        touches: [],
        changedTouches: [touch(x, y)],
        cancelable: true,
        ...s,
    });
    return s;
}

test("the dismissal listeners live on the document, not the dialog", () => {
    const r = rig();
    for (const type of ["click", "pointerdown", "touchstart", "touchend"]) {
        expect(r.doc.count(type)).toBe(1);
    }
    expect(r.dialog.count("click")).toBe(0);
});

test("a backdrop click closes even when no pointerdown reached the dialog", () => {
    const r = rig();
    const s = click(r, r.dialog, 200, 100);
    expect(r.dialog.open).toBe(false);
    expect(s.stopped && s.prevented).toBe(true);
});

test("a backdrop tap delivered to the page behind (target = body) closes it and the page gets no click", () => {
    const r = rig();
    press(r, r.doc.body, 200, 100);
    const s = click(r, r.doc.body, 200, 100);
    expect(r.dialog.open).toBe(false);
    expect(s.stopped && s.prevented).toBe(true);
});

test("a click inside the dialog never closes it and is left alone", () => {
    const r = rig();
    press(r, r.dialog.body, 200, 500);
    const s = click(r, r.dialog.body, 200, 500);
    expect(r.dialog.open).toBe(true);
    expect(s.stopped || s.prevented).toBe(false);
});

test("a click on the dialog's own box does not close", () => {
    const r = rig();
    press(r, r.dialog, 3, 500);
    click(r, r.dialog, 3, 500);
    expect(r.dialog.open).toBe(true);
});

test("a press that began inside and was released on the backdrop does not close", () => {
    const r = rig();
    press(r, r.dialog.body, 200, 500);
    click(r, r.dialog, 200, 100);
    expect(r.dialog.open).toBe(true);
    click(r, r.dialog, 200, 100);
    expect(r.dialog.open).toBe(false);
});

test("a click with no pointer position does not dismiss", () => {
    const r = rig();
    click(r, r.dialog, 200, 100, { detail: 0 });
    click(r, r.dialog, 0, 0);
    r.doc.fire("click", { target: r.dialog, ...spy() });
    expect(r.dialog.open).toBe(true);
});

test("only the topmost open dialog is dismissed", () => {
    const r = rig(2);
    click(r, r.doc.body, 200, 100);
    expect(r.dialogs[1]!.open).toBe(false);
    expect(r.dialogs[0]!.open).toBe(true);
    click(r, r.doc.body, 200, 100);
    expect(r.dialogs[0]!.open).toBe(false);
});

test("a tap on a dialog opened over it is not a tap on the dialog's backdrop", () => {
    const r = rig();
    const over = new FakeOtherDialog(r.doc);
    over.showModal();
    press(r, over.closeButton, 40, 60);
    const s = click(r, over.closeButton, 40, 60);
    expect(r.dialog.open).toBe(true);
    // Left alone, so the dialog over it gets its own click.
    expect(s.stopped || s.prevented).toBe(false);
    touchStart(r, over.closeButton, 40, 60);
    const t = touchEnd(r, over.closeButton, 40, 60);
    expect(r.dialog.open).toBe(true);
    expect(t.stopped || t.prevented).toBe(false);
    // A tap delivered to the page behind goes to the dialog on top, not here.
    click(r, r.doc.body, 200, 100);
    expect(r.dialog.open).toBe(true);
});

test("once the dialog over it closes, the dialog is dismissed by its backdrop again", () => {
    const r = rig();
    const over = new FakeOtherDialog(r.doc);
    over.showModal();
    over.close();
    const s = click(r, r.dialog, 200, 100);
    expect(r.dialog.open).toBe(false);
    expect(s.stopped && s.prevented).toBe(true);
});

test("a dialog opened over another dialog is still the one a backdrop tap dismisses", () => {
    const r = rig(2);
    const over = new FakeOtherDialog(r.doc);
    r.dialogs[1]!.close();
    over.showModal();
    r.dialogs[1]!.showModal();
    click(r, r.doc.body, 200, 100);
    expect(r.dialogs[1]!.open).toBe(false);
    click(r, r.doc.body, 200, 100);
    expect(r.dialogs[0]!.open).toBe(true);
});

test("a still tap on the backdrop (target = body) closes on touchend and cancels the click", () => {
    const r = rig();
    touchStart(r, r.doc.body, 200, 100);
    const s = touchEnd(r, r.doc.body, 201, 100);
    expect(r.dialog.open).toBe(false);
    expect(s.prevented && s.stopped).toBe(true);
    const followUp = click(r, r.doc.body, 201, 100);
    expect(followUp.stopped && followUp.prevented).toBe(true);
    const later = click(r, r.doc.body, 201, 100);
    expect(later.stopped || later.prevented).toBe(false);
});

test("a touch that starts inside, drags, or is cancelled does not close", () => {
    const r = rig();
    touchStart(r, r.dialog.body, 200, 500);
    touchEnd(r, r.dialog, 200, 100);
    expect(r.dialog.open).toBe(true);
    touchStart(r, r.dialog, 200, 100);
    touchEnd(r, r.dialog, 200, 160);
    expect(r.dialog.open).toBe(true);
    touchStart(r, r.dialog, 200, 100);
    r.doc.fire("touchcancel");
    touchEnd(r, r.dialog, 200, 100);
    expect(r.dialog.open).toBe(true);
});
