import { describe, expect, test } from "bun:test";

type Listener = (event: Record<string, unknown>) => void;

class Node {
    listeners: Record<string, Listener[]> = {};
    attrs = new Map<string, string>();
    constructor(
        public kind: string,
        public props: Record<string, unknown> = {},
    ) {}
    addEventListener(type: string, fn: Listener) {
        (this.listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: Listener) {
        this.listeners[type] = (this.listeners[type] ?? []).filter(
            (l) => l !== fn,
        );
    }
    dispatch(type: string, event: Record<string, unknown> = {}) {
        for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
    }
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }
    removeAttribute(name: string) {
        this.attrs.delete(name);
    }
}

/** A list of rows; each row is its own node with an `order` field and a handle. */
function makeForm(ids: string[]) {
    const submits: number[] = [];
    const list = new Node("ul") as Node & Record<string, any>;
    const rows: (Node & Record<string, any>)[] = [];
    const handles = new Map<string, Node & Record<string, any>>();
    list.children = rows;
    list.insertBefore = (row: Node, reference: Node | null) => {
        const from = rows.indexOf(row as never);
        rows.splice(from, 1);
        const at = reference ? rows.indexOf(reference as never) : rows.length;
        rows.splice(at, 0, row as never);
    };
    list.appendChild = (row: Node) => {
        const from = rows.indexOf(row as never);
        if (from >= 0) rows.splice(from, 1);
        rows.push(row as never);
    };
    for (const [i, id] of ids.entries()) {
        const row = new Node("li") as Node & Record<string, any>;
        row.setAttribute("data-fd-order-item", "");
        row.top = i * 50;
        row.querySelector = (sel: string) =>
            sel === 'input[name="order"]' ? { value: id } : null;
        row.getBoundingClientRect = () => ({
            top: rows.indexOf(row) * 50,
            height: 50,
        });
        const handle = new Node("span") as Node & Record<string, any>;
        handle.closest = (sel: string) =>
            sel === "[data-fd-order-handle]"
                ? handle
                : sel === "[data-fd-order-item]"
                  ? row
                  : null;
        handles.set(id, handle);
        rows.push(row);
    }
    const form = new Node("form") as Node & Record<string, any>;
    form.querySelector = (sel: string) =>
        sel === "[data-fd-order-list]" ? list : null;
    form.requestSubmit = () => {
        submits.push(rows.length);
        form.submittedOrder = rows.map(
            (row) => (row.querySelector('input[name="order"]') as any).value,
        );
    };
    const order = () =>
        rows.map(
            (row) => (row.querySelector('input[name="order"]') as any).value,
        );
    return { form, list, rows, handles, submits, order };
}

type MoveButton = { value: string; disabled: boolean };

type Helpers = {
    sectionTrigger(
        rows: { id: string; querySelector(sel: string): unknown }[],
        id: string,
    ): unknown;
    moveFocusTarget(buttons: MoveButton[], wanted: string): MoveButton | null;
    restoreMoveFocus(
        root: { querySelectorAll(sel: string): unknown[] },
        win: unknown,
    ): void;
    focusAutofocus(root: { querySelector(sel: string): unknown }): void;
    reorderByPointer(
        ids: string[],
        id: string,
        y: number,
        mids: number[],
    ): string[];
};

/** Runs the script against a window whose onLoad hook runs at once on `page`. */
async function load(
    page: { querySelectorAll(sel: string): unknown[] },
    doc: unknown = undefined,
) {
    let helpers: Helpers | null = null;
    const events = new Node("window");
    const window = {
        FOODABLE_EXPOSE_STORES: (h: Helpers) => {
            helpers = h;
        },
        FoodableApp: { onLoad: (fn: (scope: unknown) => void) => fn(page) },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    };
    const src = await Bun.file("./src/web/client/v2/stores.js").text();
    new Function("window", "document", "WeakSet", "Map", src)(
        window,
        doc,
        WeakSet,
        Map,
    );
    return { helpers: helpers!, events };
}

const EMPTY_PAGE = { querySelectorAll: () => [] };

describe("reorderByPointer", () => {
    // Four rows 50px apart: midpoints 25, 75, 125, 175.
    const ids = ["a", "b", "c", "d"];
    const mids = [25, 75, 125, 175];

    test("dropped over its own place keeps the order", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        expect(helpers.reorderByPointer(ids, "b", 80, mids)).toEqual(ids);
    });

    test("dragged down past a row goes after it", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        expect(helpers.reorderByPointer(ids, "a", 130, mids)).toEqual([
            "b",
            "c",
            "a",
            "d",
        ]);
    });

    test("dragged above the first row or below the last reaches the ends", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        expect(helpers.reorderByPointer(ids, "d", -40, mids)).toEqual([
            "d",
            "a",
            "b",
            "c",
        ]);
        expect(helpers.reorderByPointer(ids, "a", 900, mids)).toEqual([
            "b",
            "c",
            "d",
            "a",
        ]);
    });

    test("an id that is not in the list leaves the order as it was", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        expect(helpers.reorderByPointer(ids, "zzz", 100, mids)).toEqual(ids);
        // The input list is not mutated.
        expect(ids).toEqual(["a", "b", "c", "d"]);
    });
});

describe("dragging a handle", () => {
    async function drag(
        ids: string[],
        id: string,
        ys: number[],
        end: "up" | "cancel" = "up",
    ) {
        const built = makeForm(ids);
        const { events } = await load({
            querySelectorAll: (sel: string) =>
                sel === "[data-fd-order-form]" ? [built.form] : [],
        });
        const handle = built.handles.get(id)!;
        built.list.dispatch("pointerdown", {
            target: handle,
            button: 0,
            pointerId: 1,
            preventDefault() {},
        });
        for (const y of ys) events.dispatch("pointermove", { clientY: y });
        events.dispatch(end === "up" ? "pointerup" : "pointercancel", {
            pointerId: 1,
        });
        return built;
    }

    test("a drag down reorders the rows and submits the new order once", async () => {
        const built = await drag(["a", "b", "c", "d"], "a", [60, 110, 140]);
        expect(built.order()).toEqual(["b", "c", "a", "d"]);
        expect(built.submits.length).toBe(1);
        expect(built.form.submittedOrder).toEqual(["b", "c", "a", "d"]);
    });

    test("a drag back to where it started submits nothing", async () => {
        const built = await drag(["a", "b", "c"], "b", [120, 70]);
        expect(built.order()).toEqual(["a", "b", "c"]);
        expect(built.submits.length).toBe(0);
    });

    test("a cancelled drag puts the rows back and submits nothing", async () => {
        const built = await drag(["a", "b", "c"], "a", [140], "cancel");
        expect(built.order()).toEqual(["a", "b", "c"]);
        expect(built.submits.length).toBe(0);
    });
});

describe("add row", () => {
    async function row(open: boolean) {
        const details = new Node("details") as Node & Record<string, any>;
        const focused: string[] = [];
        details.open = open;
        details.querySelector = (sel: string) =>
            sel === "input" ? { focus: () => focused.push("input") } : null;
        await load({
            querySelectorAll: (sel: string) =>
                sel === "details[data-fd-add-row]" ? [details] : [],
        });
        return { details, focused };
    }

    test("opening it puts focus in its field", async () => {
        const { details, focused } = await row(true);
        details.dispatch("toggle");
        expect(focused).toEqual(["input"]);
    });

    test("closing it does not", async () => {
        const { details, focused } = await row(false);
        details.dispatch("toggle");
        expect(focused).toEqual([]);
    });
});

describe("focus after an arrow press", () => {
    const btn = (value: string, disabled = false): MoveButton => ({
        value,
        disabled,
    });

    test("goes to the arrow that was pressed", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        const buttons = [
            btn("a:up", true),
            btn("a:down"),
            btn("b:up"),
            btn("b:down"),
        ];
        expect(helpers.moveFocusTarget(buttons, "b:up")).toBe(buttons[2]!);
    });

    test("a row that reached an end hands focus to its other arrow", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        const buttons = [
            btn("a:up", true),
            btn("a:down"),
            btn("b:up"),
            btn("b:down", true),
        ];
        expect(helpers.moveFocusTarget(buttons, "b:down")).toBe(buttons[2]!);
        expect(helpers.moveFocusTarget(buttons, "a:up")).toBe(buttons[1]!);
    });

    test("a row that is gone gets nothing", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        expect(helpers.moveFocusTarget([btn("a:up")], "zzz:up")).toBeNull();
        expect(helpers.moveFocusTarget([btn("a:up")], "junk")).toBeNull();
    });

    function page(url: string, buttons: MoveButton[]) {
        const focused: string[] = [];
        const els = buttons.map((b) => ({
            ...b,
            focus() {
                focused.push(b.value);
            },
        }));
        const replaced: string[] = [];
        const win = {
            location: { href: url },
            history: {
                state: { turbo: 1 },
                replaceState(state: unknown, _t: string, next: string) {
                    replaced.push(next);
                    expect(state).toEqual({ turbo: 1 });
                },
            },
        };
        const root = {
            querySelectorAll: (sel: string) =>
                sel === 'button[name="move"]' ? els : [],
        };
        return { win, root, focused, replaced };
    }

    test("focuses the pressed arrow, then drops focus from the URL and keeps the mode", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        const p = page(
            "http://x/settings/household/stores?reorder=1&focus=b%3Adown#top",
            [btn("a:down"), btn("b:down")],
        );
        helpers.restoreMoveFocus(p.root, p.win);
        expect(p.focused).toEqual(["b:down"]);
        expect(p.replaced).toEqual([
            "/settings/household/stores?reorder=1#top",
        ]);
    });

    test("a reorder page with no focus asked for is left alone", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        const p = page("http://x/settings/household/stores?reorder=1", [
            btn("a:down"),
        ]);
        helpers.restoreMoveFocus(p.root, p.win);
        expect(p.focused).toEqual([]);
        expect(p.replaced).toEqual([]);
    });

    test("a section's ⋯ move comes back to that section's ⋯ trigger", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        const focused: string[] = [];
        const row = (id: string) => ({
            id: `fd-section-${id}`,
            querySelector: (sel: string) =>
                sel === "[data-fd-menu-trigger]"
                    ? { focus: () => focused.push(id) }
                    : null,
        });
        const rows = [row("a"), row("b")];
        const replaced: string[] = [];
        const win = {
            location: {
                href: "http://x/settings/household/stores/s1?focus=b",
            },
            history: {
                state: null,
                replaceState(_s: unknown, _t: string, next: string) {
                    replaced.push(next);
                },
            },
        };
        helpers.restoreMoveFocus(
            {
                querySelectorAll: (sel: string) =>
                    sel === '[id^="fd-section-"]' ? rows : [],
            },
            win,
        );
        expect(focused).toEqual(["b"]);
        expect(replaced).toEqual(["/settings/household/stores/s1"]);
        expect(helpers.sectionTrigger(rows, "zzz")).toBeNull();
    });

    test("a plain page load leaves the URL and focus alone", async () => {
        const { helpers } = await load(EMPTY_PAGE);
        const p = page("http://x/settings/household/stores/s1", [
            btn("a:down"),
        ]);
        helpers.restoreMoveFocus(p.root, p.win);
        expect(p.focused).toEqual([]);
        expect(p.replaced).toEqual([]);
    });
});

describe("autofocus", () => {
    function field() {
        const focused: string[] = [];
        return {
            focused,
            root: {
                querySelectorAll: () => [],
                querySelector: (sel: string) =>
                    sel === "[data-fd-autofocus]:not([disabled])"
                        ? { focus: () => focused.push("field") }
                        : null,
            },
        };
    }

    test("focuses the field the server asked for when nothing has focus", async () => {
        const f = field();
        const body = {};
        const { helpers } = await load(f.root, {
            body,
            activeElement: body,
        });
        helpers.focusAutofocus(f.root);
        expect(f.focused).toEqual(["field", "field"]);
    });

    test("leaves focus where the person put it", async () => {
        const f = field();
        await load(f.root, {
            body: {},
            activeElement: { matches: () => true },
        });
        expect(f.focused).toEqual([]);
    });

    test("does nothing without a document", async () => {
        const f = field();
        const { helpers } = await load(f.root);
        helpers.focusAutofocus(f.root);
        expect(f.focused).toEqual([]);
    });
});
