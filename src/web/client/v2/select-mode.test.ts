import { describe, expect, test } from "bun:test";

type Handler = (event: Record<string, unknown>) => void;

/** Just enough of an element for the selectors select-mode.js uses. */
class El {
    attrs = new Map<string, string>();
    children: El[] = [];
    parent: El | null = null;
    hidden = false;
    disabled = false;
    checked = false;
    textContent = "";
    focused = false;
    constructor(
        public tag: string,
        attrs: Record<string, string> = {},
        public props: { name?: string; value?: string } = {},
    ) {
        for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    }
    get name() {
        return this.props.name ?? "";
    }
    get value() {
        return this.props.value ?? "";
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
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }
    removeAttribute(name: string) {
        this.attrs.delete(name);
    }
    focus() {
        this.focused = true;
    }
    private is(sel: string): boolean {
        return sel.split(",").some((one) => {
            const m = one
                .trim()
                .match(/^([a-z]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/);
            if (!m) return false;
            if (m[1] && m[1] !== this.tag) return false;
            for (const cls of (m[2] ?? "").split(".").filter(Boolean)) {
                if (!(this.attrs.get("class") ?? "").split(" ").includes(cls))
                    return false;
            }
            for (const part of (m[3] ?? "").split("]").filter(Boolean)) {
                const [k, v] = part.slice(1).split("=");
                if (!this.attrs.has(k!)) return false;
                if (
                    v !== undefined &&
                    this.attrs.get(k!) !== v.replace(/"/g, "")
                )
                    return false;
            }
            return true;
        });
    }
    closest(sel: string): El | null {
        for (let el: El | null = this; el; el = el.parent) {
            if (el.is(sel)) return el;
        }
        return null;
    }
    contains(other: El): boolean {
        for (let el: El | null = other; el; el = el.parent) {
            if (el === this) return true;
        }
        return false;
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

type Event = {
    target: El;
    key?: string;
    stopped: boolean;
    prevented: boolean;
    defaultPrevented: boolean;
    stopPropagation(): void;
    preventDefault(): void;
    formData?: FormDataLike;
};
type FormDataLike = {
    entries: [string, string][];
    append(k: string, v: string): void;
};

async function setup(menu?: "before" | "after") {
    const doc = new El("document");
    const listeners: Record<string, { fn: Handler; capture: boolean }[]> = {};
    const document = Object.assign(doc, {
        addEventListener(type: string, fn: Handler, capture?: boolean) {
            (listeners[type] ??= []).push({ fn, capture: capture === true });
        },
    });
    let onLoad: ((scope: unknown) => void) | undefined;
    const window = {
        FoodableApp: {
            onLoad: (fn: (scope: unknown) => void) => {
                onLoad = fn;
                fn(document);
            },
        },
    };

    // The page: a tools row with the toggle, and the list root.
    const toggle = new El("button", { "data-fd-select-toggle": "groceries" });
    const root = new El("div", { "data-fd-select": "groceries" });
    const count = new El("span", { "data-fd-select-count": "" });
    count.textContent = "0 selected";
    const action = new El("button", { "data-fd-select-action": "" });
    action.disabled = true;
    const cancel = new El("button", { "data-fd-select-cancel": "" });
    const bar = new El("div", { "data-fd-select-bar": "groceries" });
    bar.hidden = true;
    bar.add(count, action, cancel);
    const message = new El("p", {
        "data-fd-select-message": "",
        "data-one": "Delete 1 item?",
        "data-many": "Delete {n} items?",
    });
    message.textContent = "Delete the selected items?";
    const confirmForm = new El("form", { "data-fd-select-form": "" }).add(
        message,
    );
    const dialog = new El("dialog").add(confirmForm);
    const plainForm = new El("form", { "data-fd-select-form": "" });
    bar.add(plainForm);
    const otherForm = new El("form");

    function row(id: string, family = "fd-row") {
        const box = new El(
            "input",
            { "data-fd-select-item": "" },
            { name: "ids[]", value: id },
        );
        const label = new El("label", { class: `${family}__select` }).add(box);
        const title = new El("span", { class: `${family}__title` });
        const li = new El("li", {
            "data-fd-select-row": "",
            tabindex: "0",
        }).add(label, title);
        return { li, box, label, title };
    }
    const a = row("a");
    const b = row("b");
    const c = row("c");
    const item = row("item", "fd-item-row");
    const list = new El("ul").add(a.li, b.li, c.li, item.li);
    root.add(bar, list, dialog);
    document.add(new El("div").add(toggle), root, otherForm);

    // An anchored menu inside the list, open. Its own Escape listener closes
    // every open menu and prevents the default, as menu.js does.
    const panel = new El("div", { class: "fd-menu__panel" });
    const menuRoot = new El("div", { "data-fd-menu": "" }).add(panel);
    if (menu) {
        a.li.add(menuRoot);
        panel.hidden = false;
    } else panel.hidden = true;
    const addMenuListener = () =>
        document.addEventListener(
            "keydown",
            ((event: Event) => {
                if (event.key !== "Escape") return;
                let handled = false;
                for (const root of document.querySelectorAll(
                    "[data-fd-menu]",
                )) {
                    const p = root.querySelector(".fd-menu__panel");
                    if (!p || p.hidden) continue;
                    p.hidden = true;
                    handled = true;
                }
                if (handled) event.preventDefault();
            }) as Handler,
            true,
        );
    if (menu === "before") addMenuListener();

    const src = await Bun.file("./src/web/client/v2/select-mode.js").text();
    new Function("window", "document", src)(window, document);
    if (menu === "after") addMenuListener();

    function event(target: El, extra: Record<string, unknown> = {}): Event {
        const e: Event = {
            target,
            stopped: false,
            prevented: false,
            get defaultPrevented() {
                return e.prevented;
            },
            stopPropagation() {
                e.stopped = true;
            },
            preventDefault() {
                e.prevented = true;
            },
            ...extra,
        };
        return e;
    }
    /** Runs the document's listeners for `type`, capture phase first. */
    function fire(type: string, e: Event) {
        const all = listeners[type] ?? [];
        for (const { fn } of all.filter((l) => l.capture)) {
            if (!e.stopped) fn(e as never);
        }
        for (const { fn } of all.filter((l) => !l.capture)) {
            if (!e.stopped) fn(e as never);
        }
        return e;
    }
    const click = (target: El) => fire("click", event(target));
    const formData = (): FormDataLike => {
        const entries: [string, string][] = [];
        return { entries, append: (k, v) => entries.push([k, v]) };
    };
    const send = (form: El) => {
        const fd = formData();
        fire("formdata", event(form, { formData: fd }));
        return fd.entries;
    };
    const tick = (box: El, on: boolean) => {
        box.checked = on;
        fire("change", event(box));
    };
    return {
        root,
        toggle,
        bar,
        count,
        action,
        cancel,
        message,
        dialog,
        a,
        b,
        c,
        item,
        confirmForm,
        plainForm,
        otherForm,
        list,
        click,
        fire,
        event,
        send,
        tick,
        rerun: () => onLoad!(document),
        panel,
        openDialog: () => dialog.setAttribute("open", ""),
    };
}

describe("select mode", () => {
    test("Select puts the list in select mode: bar shown, toggle hidden, nothing picked", async () => {
        const t = await setup();
        expect(t.bar.hidden).toBe(true);
        t.click(t.toggle);
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(true);
        expect(t.bar.hidden).toBe(false);
        expect(t.toggle.hidden).toBe(true);
        expect(t.count.textContent).toBe("0 selected");
        expect(t.action.disabled).toBe(true);
        // Focus lands on the first row's box so the keyboard can carry on.
        expect(t.a.box.focused).toBe(true);
    });

    test("Select focuses the first box that is not disabled", async () => {
        const t = await setup();
        t.a.box.disabled = true;
        t.click(t.toggle);
        expect(t.a.box.focused).toBe(false);
        expect(t.b.box.focused).toBe(true);
    });

    test("ticking rows counts them, enables the actions and words the confirm", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.tick(t.a.box, true);
        expect(t.count.textContent).toBe("1 selected");
        expect(t.action.disabled).toBe(false);
        expect(t.message.textContent).toBe("Delete 1 item?");
        t.tick(t.b.box, true);
        expect(t.count.textContent).toBe("2 selected");
        expect(t.message.textContent).toBe("Delete 2 items?");
        t.tick(t.a.box, false);
        t.tick(t.b.box, false);
        expect(t.count.textContent).toBe("0 selected");
        expect(t.action.disabled).toBe(true);
    });

    test("in select mode a tap anywhere on a row picks it and does nothing else", async () => {
        const t = await setup();
        t.click(t.toggle);
        const tap = t.click(t.b.title);
        expect(t.b.box.checked).toBe(true);
        expect(tap.prevented).toBe(true);
        expect(tap.stopped).toBe(true);
        expect(t.count.textContent).toBe("1 selected");
        t.click(t.b.title);
        expect(t.b.box.checked).toBe(false);
    });

    test("a tap on the box itself is left to the checkbox, so it does not toggle twice", async () => {
        const t = await setup();
        t.click(t.toggle);
        const tap = t.click(t.a.label);
        expect(tap.prevented).toBe(false);
        expect(tap.stopped).toBe(true);
        expect(t.a.box.checked).toBe(false);
    });

    test("the Item row's own box is left to the checkbox too, and the rest of that row picks it", async () => {
        const t = await setup();
        t.click(t.toggle);
        const onBox = t.click(t.item.label);
        expect(onBox.prevented).toBe(false);
        expect(onBox.stopped).toBe(true);
        expect(t.item.box.checked).toBe(false);
        const onRow = t.click(t.item.title);
        expect(onRow.prevented).toBe(true);
        expect(onRow.stopped).toBe(true);
        expect(t.item.box.checked).toBe(true);
    });

    test("outside select mode a row is left alone", async () => {
        const t = await setup();
        const tap = t.click(t.a.title);
        expect(tap.stopped).toBe(false);
        expect(tap.prevented).toBe(false);
        expect(t.a.box.checked).toBe(false);
    });

    test("Cancel clears the picks and leaves select mode", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.tick(t.a.box, true);
        t.tick(t.c.box, true);
        t.click(t.cancel);
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(false);
        expect(t.bar.hidden).toBe(true);
        expect(t.toggle.hidden).toBe(false);
        expect(t.a.box.checked).toBe(false);
        expect(t.c.box.checked).toBe(false);
        expect(t.count.textContent).toBe("0 selected");
        expect(t.toggle.focused).toBe(true);
    });

    test("a form of the list sends the picked ids as it is submitted, in page order", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.tick(t.c.box, true);
        t.tick(t.a.box, true);
        expect(t.send(t.confirmForm)).toEqual([
            ["ids[]", "a"],
            ["ids[]", "c"],
        ]);
        expect(t.send(t.plainForm)).toEqual([
            ["ids[]", "a"],
            ["ids[]", "c"],
        ]);
    });

    test("other forms on the page are not touched", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.tick(t.a.box, true);
        expect(t.send(t.otherForm)).toEqual([]);
    });

    test("Enter or Space on a focused row picks it; typing in a box is left alone", async () => {
        const t = await setup();
        t.click(t.toggle);
        const enter = t.fire("keydown", t.event(t.b.li, { key: "Enter" }));
        expect(t.b.box.checked).toBe(true);
        expect(enter.prevented).toBe(true);
        expect(enter.stopped).toBe(true);
        t.fire("keydown", t.event(t.b.li, { key: " " }));
        expect(t.b.box.checked).toBe(false);
        const onBox = t.fire("keydown", t.event(t.c.box, { key: " " }));
        expect(onBox.prevented).toBe(false);
        expect(t.c.box.checked).toBe(false);
    });

    test("Enter on a row outside select mode is left to the row", async () => {
        const t = await setup();
        const e = t.fire("keydown", t.event(t.a.li, { key: "Enter" }));
        expect(e.stopped).toBe(false);
        expect(t.a.box.checked).toBe(false);
    });

    test("Escape leaves select mode, unless a sheet is open (it closes that first)", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.openDialog();
        t.fire("keydown", t.event(t.root, { key: "Escape" }));
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(true);
        t.dialog.removeAttribute("open");
        t.fire("keydown", t.event(t.root, { key: "Escape" }));
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(false);
    });

    for (const order of ["before", "after"] as const) {
        test(`Escape that closes an open menu keeps select mode on (menu listener ${order} select mode's)`, async () => {
            const t = await setup(order);
            t.click(t.toggle);
            t.fire("keydown", t.event(t.root, { key: "Escape" }));
            expect(t.panel.hidden).toBe(true);
            expect(t.root.hasAttribute("data-fd-selecting")).toBe(true);
            // The next Escape, with the menu gone, leaves select mode.
            t.fire("keydown", t.event(t.root, { key: "Escape" }));
            expect(t.root.hasAttribute("data-fd-selecting")).toBe(false);
        });
    }

    test("plain Escape with no menu leaves select mode", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.fire("keydown", t.event(t.root, { key: "Escape" }));
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(false);
    });

    test("an Escape something else already handled keeps select mode on", async () => {
        const t = await setup();
        t.click(t.toggle);
        const e = t.event(t.root, { key: "Escape" });
        e.preventDefault();
        t.fire("keydown", e);
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(true);
    });

    test("a page shown again in select mode (Turbo restore) starts over", async () => {
        const t = await setup();
        t.click(t.toggle);
        t.tick(t.a.box, true);
        t.rerun();
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(false);
        expect(t.bar.hidden).toBe(true);
        expect(t.toggle.hidden).toBe(false);
        expect(t.a.box.checked).toBe(false);
    });
});

describe("select mode from a menu and a conditional confirm", () => {
    test("a Select in a page's ⋯ becomes Cancel selection, so the menu is never empty, and ends the mode with focus on the ⋯ that shows", async () => {
        const t = await setup();
        // This page has no plain Select button, only the two menus'.
        t.toggle.removeAttribute("data-fd-select-toggle");
        // The Detail bar's ⋯ (phone, not showing on desktop) and the header's (showing).
        const menuItem = (showing: boolean) => {
            const label = new El("span", { class: "fd-menu__label" });
            label.textContent = "Select";
            const item = new El("button", {
                "data-fd-select-toggle": "groceries",
            }).add(label);
            const trigger = new El("button", { "data-fd-menu-trigger": "" });
            Object.assign(trigger, {
                getClientRects: () => (showing ? [1] : []),
            });
            const menu = new El("div", { "data-fd-menu": "" }).add(
                trigger,
                item,
            );
            return { label, item, trigger, menu };
        };
        const phone = menuItem(false);
        const desktop = menuItem(true);
        t.root.parent!.add(phone.menu, desktop.menu);
        t.click(phone.item);
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(true);
        expect(phone.label.textContent).toBe("Cancel selection");
        expect(desktop.label.textContent).toBe("Cancel selection");
        expect(phone.item.hidden).toBe(false);
        // The same item ends the mode and the visible ⋯ takes focus.
        t.click(desktop.item);
        expect(t.root.hasAttribute("data-fd-selecting")).toBe(false);
        expect(desktop.label.textContent).toBe("Select");
        expect(phone.label.textContent).toBe("Select");
        expect(desktop.trigger.focused).toBe(true);
        expect(phone.trigger.focused).toBe(false);
        // Cancel in the bar does the same.
        t.click(desktop.item);
        t.click(t.cancel);
        expect(desktop.trigger.focused).toBe(true);
        expect(phone.trigger.focused).toBe(false);
    });

    test("a confirm can word itself for the kind of row picked", async () => {
        const t = await setup();
        t.message.setAttribute("data-if-name", "recipe_ids[]");
        t.message.setAttribute(
            "data-if-one",
            "Delete 1 item? A recipe cannot be brought back.",
        );
        t.message.setAttribute(
            "data-if-many",
            "Delete {n} items? Recipes cannot be brought back.",
        );
        t.c.box.props.name = "recipe_ids[]";
        t.click(t.toggle);
        t.tick(t.a.box, true);
        t.tick(t.b.box, true);
        expect(t.message.textContent).toBe("Delete 2 items?");
        t.tick(t.c.box, true);
        expect(t.message.textContent).toBe(
            "Delete 3 items? Recipes cannot be brought back.",
        );
        t.tick(t.a.box, false);
        t.tick(t.b.box, false);
        expect(t.message.textContent).toBe(
            "Delete 1 item? A recipe cannot be brought back.",
        );
    });
});
