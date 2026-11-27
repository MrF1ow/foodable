import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Handler = (event: any) => void;

/** Just enough of an element for the script: attributes, hidden, text, listeners. */
class El {
    hidden = false;
    disabled = false;
    open = false;
    shown = 0;
    textContent = "";
    value = "";
    attrs = new Map<string, string>();
    classes = new Set<string>();
    inside = new Set<El>();
    classList = {
        toggle: (name: string, on: boolean) => {
            if (on) this.classes.add(name);
            else this.classes.delete(name);
        },
    };
    listeners: Record<string, Handler> = {};
    children: Record<string, El | El[]> = {};
    submitted = 0;
    constructor(text = "") {
        this.textContent = text;
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
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    contains(other: El) {
        return other === this || this.inside.has(other);
    }
    showModal() {
        this.open = true;
        this.shown += 1;
    }
    addEventListener(type: string, fn: Handler) {
        const before = this.listeners[type];
        this.listeners[type] = (event) => {
            before?.(event);
            fn(event);
        };
    }
    querySelector(selector: string) {
        const found = this.children[selector];
        return Array.isArray(found) ? (found[0] ?? null) : (found ?? null);
    }
    querySelectorAll(selector: string) {
        const found = this.children[selector];
        return Array.isArray(found) ? found : found ? [found] : [];
    }
    requestSubmit() {
        this.submitted += 1;
    }
}

class FakeInput extends El {}

const RECIPE = "6f1c2f0e-1111-4222-8333-444455556666";

function row(title: string) {
    const r = new El();
    r.children[".fd-item-row__title"] = new El(title);
    return r;
}

class FakeElement extends El {
    /** What `closest` finds, by selector. */
    closers: Record<string, El | null> = {};
    closest(selector: string) {
        return this.closers[selector] ?? null;
    }
}

function setup(opts: {
    heading?: string;
    count?: string;
    rows: string[];
    /** The "Discard this recipe?" sheet, when the page is the importer's landing. */
    leaveSheet?: El;
    /** Where the page is. */
    path?: string;
    /** `Turbo.cache.clear` calls are counted here. */
    turbo?: { cleared: number };
}) {
    const input = new FakeInput();
    const box = new El();
    const clear = new El();
    clear.hidden = true;
    const go = new El();
    go.hidden = true;
    const form = new El();
    form.children[".fd-search-field__input"] = input;
    form.children[".fd-search-field"] = box;
    form.children["[data-fd-recipes-import-go]"] = go;
    form.children["[data-fd-search-clear]"] = clear;
    const label = new El(opts.heading ?? "All recipes");
    const count = new El(opts.count ?? String(opts.rows.length));
    const section = new El();
    section.attrs.set("data-fd-recipes-total", String(opts.rows.length));
    section.children[".fd-section-header__label"] = label;
    if (opts.count !== "")
        section.children[".fd-section-header__count"] = count;
    const rows = opts.rows.map(row);
    const documentListeners: { type: string; fn: Handler; capture: unknown }[] =
        [];
    const leaveForm = new El();
    leaveForm.attrs.set("action", `/recipes/${RECIPE}/discard`);
    const document = {
        querySelector: (sel: string) =>
            sel === "[data-fd-recipes-total]" ? section : null,
        querySelectorAll: (sel: string) =>
            sel === ".fd-recipes-row" ? rows : [],
        getElementById: (id: string) =>
            id === "fd-recipe-leave-sheet"
                ? (opts.leaveSheet ?? null)
                : id === "fd-recipe-leave-form" && opts.leaveSheet
                  ? leaveForm
                  : null,
        addEventListener: (type: string, fn: Handler, capture: unknown) => {
            documentListeners.push({ type, fn, capture });
        },
    };
    const load: ((root: any) => void)[] = [];
    const root = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-recipes-search]" ? [form] : [],
    };
    const src = readFileSync("./src/web/client/v2/recipes.js", "utf8");
    new Function(
        "document",
        "HTMLInputElement",
        "Element",
        "FoodableApp",
        "WeakSet",
        "location",
        "Turbo",
        src,
    )(
        document,
        FakeInput,
        FakeElement,
        { onLoad: (fn: (root: any) => void) => load.push(fn) },
        WeakSet,
        { pathname: opts.path ?? `/recipes/${RECIPE}`, href: "http://x/" },
        {
            cache: {
                clear: () => {
                    if (opts.turbo) opts.turbo.cleared += 1;
                },
            },
        },
    );
    for (const fn of load) fn(root);
    const type = (text: string) => {
        input.value = text;
        input.listeners.input?.({});
    };
    const again = () => {
        for (const fn of load) fn(root);
    };
    return {
        input,
        clear,
        go,
        form,
        label,
        count,
        rows,
        type,
        documentListeners,
        again,
    };
}

test("typing reads N of M recipes in the heading and shows the clear X; emptying the field restores them", () => {
    const t = setup({
        rows: ["Pasta", "Pancakes", "Tacos", "Paella", "Soup"],
    });
    expect(t.clear.hidden).toBe(true);
    t.type("pa");
    expect(t.label.textContent).toBe("3 of 5 recipes");
    expect(t.count.hidden).toBe(true);
    expect(t.clear.hidden).toBe(false);
    expect(t.rows.map((r) => r.hidden)).toEqual([
        false,
        false,
        true,
        false,
        true,
    ]);
    t.type("pasta");
    expect(t.label.textContent).toBe("1 of 5 recipes");
    t.type("");
    expect(t.label.textContent).toBe("All recipes");
    expect(t.count.textContent).toBe("5");
    expect(t.count.hidden).toBe(false);
    expect(t.clear.hidden).toBe(true);
    expect(t.rows.every((r) => !r.hidden)).toBe(true);
});

test("a pasted link keeps the heading and shows the clear X", () => {
    const t = setup({ rows: ["Pasta", "Tacos"] });
    t.type("https://example.com/pasta");
    expect(t.label.textContent).toBe("All recipes");
    expect(t.clear.hidden).toBe(false);
    expect(t.rows.every((r) => !r.hidden)).toBe(true);
});

test("a list that opens already searched puts its own heading back when the field is emptied", () => {
    const t = setup({
        heading: "2 of 5 recipes",
        count: "",
        rows: ["Pasta", "Pancakes", "Tacos", "Paella", "Soup"],
    });
    t.type("pasta");
    expect(t.label.textContent).toBe("1 of 5 recipes");
    t.type("");
    expect(t.label.textContent).toBe("2 of 5 recipes");
});

test("the clear X empties the field and submits the search", () => {
    const t = setup({ rows: ["Pasta"] });
    t.type("pa");
    t.form.listeners.click?.({
        target: {
            closest: (sel: string) =>
                sel === "[data-fd-search-clear]" ? t.clear : null,
        },
    });
    expect(t.input.value).toBe("");
    expect(t.form.submitted).toBe(1);
    expect(t.clear.hidden).toBe(true);
});

/** A click as the document's capture listener sees it. */
function click(over: Partial<Record<string, unknown>> & { link?: El | null }) {
    const link = over.link === undefined ? new El() : over.link;
    const target = new FakeElement();
    target.closers["a[href]"] = link;
    const event = {
        defaultPrevented: false,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target,
        prevented: 0,
        stopped: 0,
        preventDefault() {
            this.prevented += 1;
        },
        stopPropagation() {
            this.stopped += 1;
        },
        ...over,
    };
    return event as typeof event & { prevented: number; stopped: number };
}

function linkTo(href: string, attrs: Record<string, string> = {}) {
    const link = new El();
    link.attrs.set("href", href);
    for (const [k, v] of Object.entries(attrs)) link.attrs.set(k, v);
    return link;
}

test("the leave guard is one capture listener on the document, however often the page loads", () => {
    const t = setup({ rows: [] });
    t.again();
    t.again();
    for (const type of [
        "click",
        "submit",
        "turbo:before-visit",
        "turbo:submit-end",
        "turbo:load",
    ]) {
        expect(t.documentListeners.filter((l) => l.type === type)).toHaveLength(
            1,
        );
    }
    expect(t.documentListeners.find((l) => l.type === "click")!.capture).toBe(
        true,
    );
    expect(t.documentListeners.find((l) => l.type === "submit")!.capture).toBe(
        true,
    );
    // No beforeunload prompt: the back button and a closed tab are not held.
    expect(t.documentListeners.some((l) => l.type === "beforeunload")).toBe(
        false,
    );
});

test("a link that would leave a draft's page opens the Discard this recipe? sheet instead", () => {
    const sheet = new El();
    const t = setup({ rows: [], leaveSheet: sheet });
    const guard = t.documentListeners.find((l) => l.type === "click")!.fn;
    const back = click({ link: linkTo("/recipes") });
    guard(back);
    expect(back.prevented).toBe(1);
    expect(back.stopped).toBe(1);
    expect(sheet.open).toBe(true);
    expect(sheet.shown).toBe(1);
    // Asked twice in a row, the sheet is already open: the click is still held back.
    const again = click({ link: linkTo("/") });
    guard(again);
    expect(again.prevented).toBe(1);
    expect(sheet.shown).toBe(1);
});

test("a page with no leave sheet (a saved recipe) is never held back", () => {
    const t = setup({ rows: [] });
    const guard = t.documentListeners.find((l) => l.type === "click")!.fn;
    const event = click({ link: linkTo("/recipes") });
    guard(event);
    expect(event.prevented).toBe(0);
    expect(event.stopped).toBe(0);
});

test("the leave guard leaves alone a click that is not leaving: a modified click, a new tab, a download, a hash, a link in the sheet, and a click that is not on a link", () => {
    const sheet = new El();
    const inSheet = linkTo("/recipes");
    sheet.inside.add(inSheet);
    const t = setup({ rows: [], leaveSheet: sheet });
    const guard = t.documentListeners.find((l) => l.type === "click")!.fn;
    const cases = [
        click({ link: linkTo("/recipes"), ctrlKey: true }),
        click({ link: linkTo("/recipes"), metaKey: true }),
        click({ link: linkTo("/recipes"), shiftKey: true }),
        click({ link: linkTo("/recipes"), altKey: true }),
        click({ link: linkTo("/recipes"), button: 1 }),
        click({ link: linkTo("/recipes"), defaultPrevented: true }),
        click({ link: linkTo("/x", { target: "_blank" }) }),
        click({ link: linkTo("/x", { download: "" }) }),
        click({ link: linkTo("#fd-recipe-draft") }),
        click({ link: linkTo("") }),
        click({ link: inSheet }),
        click({ link: null }),
    ];
    for (const event of cases) {
        guard(event);
        expect(event.prevented).toBe(0);
    }
    expect(sheet.open).toBe(false);
    // A link that names its own window is not leaving this one.
    const self = click({ link: linkTo("/recipes", { target: "_self" }) });
    guard(self);
    expect(self.prevented).toBe(1);
});

/** A submit as the document's capture listener sees it. */
function submit(
    form: El,
    over: { method?: string; action?: string; submitterAction?: string } = {},
) {
    if (over.action !== undefined) form.attrs.set("action", over.action);
    (form as any).method = over.method ?? "post";
    const event = {
        target: form,
        submitter: over.submitterAction
            ? { formAction: over.submitterAction }
            : null,
        prevented: 0,
        stopped: 0,
        preventDefault() {
            this.prevented += 1;
        },
        stopPropagation() {
            this.stopped += 1;
        },
    };
    return event as typeof event & { prevented: number; stopped: number };
}

function listener(t: ReturnType<typeof setup>, type: string) {
    return t.documentListeners.find((l) => l.type === type)!.fn;
}

function visit(url: string) {
    return {
        detail: { url },
        prevented: 0,
        preventDefault() {
            this.prevented += 1;
        },
    };
}

test("a form that would leave the landing is held back: the shell's search and Log out", () => {
    const sheet = new El();
    const t = setup({ rows: [], leaveSheet: sheet });
    const onSubmit = listener(t, "submit");
    const search = submit(new El(), { method: "get", action: "/search" });
    onSubmit(search);
    expect(search.prevented).toBe(1);
    expect(search.stopped).toBe(1);
    expect(sheet.open).toBe(true);
    const logout = submit(new El(), { method: "post", action: "/logout" });
    onSubmit(logout);
    expect(logout.prevented).toBe(1);
    expect(sheet.shown).toBe(1);
});

test("the page's own forms are never held: Save, the discard form, the menu's Discard, an ingredient action, a form in the sheet", () => {
    const sheet = new El();
    const inSheet = new El();
    sheet.inside.add(inSheet);
    const t = setup({ rows: [], leaveSheet: sheet });
    const onSubmit = listener(t, "submit");
    const own = [
        submit(new El(), { action: `/recipes/${RECIPE}/save` }),
        submit(new El(), { action: `/recipes/${RECIPE}/discard` }),
        submit(new El(), {
            action: `/recipes/${RECIPE}/ingredients/i1/delete`,
        }),
        submit(new El(), {
            action: "/elsewhere",
            submitterAction: `http://x/recipes/${RECIPE}/save`,
        }),
        submit(inSheet, { action: "/anything" }),
        // A GET back to this same page stays too (a refresh of its own address).
        submit(new El(), { method: "get", action: `/recipes/${RECIPE}` }),
    ];
    for (const event of own) {
        onSubmit(event);
        expect(event.prevented).toBe(0);
    }
    expect(sheet.open).toBe(false);
    // A post that stays on the page (the bell's dismiss) is not held either.
    const stays = submit(new El(), { action: "/notices/n1/dismiss" });
    onSubmit(stays);
    expect(stays.prevented).toBe(0);
});

test("a Turbo visit that is not a link click is held; the page's own redirect and its own submit are not", () => {
    const sheet = new El();
    const t = setup({ rows: [], leaveSheet: sheet });
    const onVisit = listener(t, "turbo:before-visit");
    const away = visit("http://x/recipes");
    onVisit(away);
    expect(away.prevented).toBe(1);
    expect(sheet.open).toBe(true);
    // Save's 303 back to this page.
    const back = visit(`http://x/recipes/${RECIPE}`);
    onVisit(back);
    expect(back.prevented).toBe(0);
    // Discard (an own submit) redirects to Recipes: let that one through, once.
    const onSubmit = listener(t, "submit");
    onSubmit(submit(new El(), { action: `/recipes/${RECIPE}/discard` }));
    const discarded = visit("http://x/recipes");
    onVisit(discarded);
    expect(discarded.prevented).toBe(0);
    const next = visit("http://x/recipes");
    onVisit(next);
    expect(next.prevented).toBe(1);
});

test("a post the person sends from the landing (a log sheet's water) is not asked about after it was sent", () => {
    const sheet = new El();
    const t = setup({ rows: [], leaveSheet: sheet });
    const water = submit(new El(), { action: "/log/water" });
    listener(t, "submit")(water);
    expect(water.prevented).toBe(0);
    const redirect = visit("http://x/");
    listener(t, "turbo:before-visit")(redirect);
    expect(redirect.prevented).toBe(0);
    expect(sheet.open).toBe(false);
});

test("an own submit that failed in place no longer lets a visit through", () => {
    const sheet = new El();
    const t = setup({ rows: [], leaveSheet: sheet });
    listener(
        t,
        "submit",
    )(submit(new El(), { action: `/recipes/${RECIPE}/save` }));
    listener(t, "turbo:submit-end")({ detail: { success: false } });
    const away = visit("http://x/recipes");
    listener(t, "turbo:before-visit")(away);
    expect(away.prevented).toBe(1);
});

test("a page with no leave sheet holds back no visit and no form", () => {
    const t = setup({ rows: [] });
    const away = visit("http://x/recipes");
    listener(t, "turbo:before-visit")(away);
    expect(away.prevented).toBe(0);
    const search = submit(new El(), { method: "get", action: "/search" });
    listener(t, "submit")(search);
    expect(search.prevented).toBe(0);
});

test("a discard clears Turbo's cache once the next page has loaded, on any draft page", () => {
    const turbo = { cleared: 0 };
    // No leave sheet: a later visit to a draft, Discard from the Detail bar's menu.
    const t = setup({ rows: [], turbo });
    listener(
        t,
        "submit",
    )(submit(new El(), { action: `/recipes/${RECIPE}/discard` }));
    expect(turbo.cleared).toBe(0);
    listener(t, "turbo:load")({});
    expect(turbo.cleared).toBe(1);
    // Only that one load.
    listener(t, "turbo:load")({});
    expect(turbo.cleared).toBe(1);
    // Another submit does not clear.
    listener(
        t,
        "submit",
    )(submit(new El(), { action: `/recipes/${RECIPE}/save` }));
    listener(t, "turbo:load")({});
    expect(turbo.cleared).toBe(1);
    // A discard refused in place (409) clears nothing.
    listener(
        t,
        "submit",
    )(submit(new El(), { action: `/recipes/${RECIPE}/discard` }));
    listener(t, "turbo:submit-end")({ detail: { success: false } });
    listener(t, "turbo:load")({});
    expect(turbo.cleared).toBe(1);
});

/** The Missing for the plan sheet: a form of ticked boxes and its Add button. */
function setupMissing(ticks: boolean[], values: string[] = []) {
    const label = new El("Add 3 to groceries");
    const add = new El();
    add.children[".fd-btn__label"] = label;
    const boxes = ticks.map((checked, i) => {
        const box = new El();
        (box as any).checked = checked;
        (box as any).value = values[i] ?? "food-" + i;
        return box;
    });
    const form = new El();
    form.attrs.set("id", "fd-plan-missing-form");
    (form as any).id = "fd-plan-missing-form";
    form.children['input[name="food_ids[]"]'] = boxes;
    const document = {
        querySelector: (sel: string) =>
            sel === '[data-fd-plan-missing-add][form="fd-plan-missing-form"]'
                ? add
                : null,
        querySelectorAll: () => [],
        getElementById: () => null,
        addEventListener: () => {},
    };
    const load: ((root: any) => void)[] = [];
    const root = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-plan-missing]" ? [form] : [],
    };
    const src = readFileSync("./src/web/client/v2/recipes.js", "utf8");
    new Function(
        "document",
        "HTMLInputElement",
        "Element",
        "FoodableApp",
        "WeakSet",
        "location",
        "Turbo",
        src,
    )(
        document,
        FakeInput,
        FakeElement,
        { onLoad: (fn: (root: any) => void) => load.push(fn) },
        WeakSet,
        { pathname: "/recipes", href: "http://x/" },
        undefined,
    );
    for (const fn of load) fn(root);
    return {
        add,
        label,
        boxes,
        change: (i: number, checked: boolean) => {
            (boxes[i] as any).checked = checked;
            form.listeners.change?.({ target: boxes[i] });
        },
    };
}

test("the Missing sheet's button counts the ticked foods and follows each tick", () => {
    const t = setupMissing([true, true, true]);
    expect(t.label.textContent).toBe("Add 3 to groceries");
    expect(t.add.disabled).toBe(false);
    t.change(1, false);
    expect(t.label.textContent).toBe("Add 2 to groceries");
    expect(t.add.disabled).toBe(false);
    t.change(1, true);
    expect(t.label.textContent).toBe("Add 3 to groceries");
});

test("the Missing sheet's button is disabled with nothing ticked and live again after a tick", () => {
    const t = setupMissing([true, true]);
    t.change(0, false);
    t.change(1, false);
    expect(t.label.textContent).toBe("Add 0 to groceries");
    expect(t.add.disabled).toBe(true);
    t.change(0, true);
    expect(t.label.textContent).toBe("Add 1 to groceries");
    expect(t.add.disabled).toBe(false);
});

test("the Missing sheet's button counts distinct foods: two boxes of one food are one", () => {
    const t = setupMissing([true, true, true], ["flour", "flour", "eggs"]);
    expect(t.label.textContent).toBe("Add 2 to groceries");
    t.change(0, false);
    // The other flour box is still ticked, so flour still counts.
    expect(t.label.textContent).toBe("Add 2 to groceries");
    t.change(1, false);
    expect(t.label.textContent).toBe("Add 1 to groceries");
    expect(t.add.disabled).toBe(false);
});
