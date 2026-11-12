import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** Every global these tests (or the scripts they eval) put on globalThis. */
const STUBBED_GLOBALS = [
    "window",
    "document",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "FoodableApp",
    "setTimeout",
    "clearTimeout",
    "FOODABLE_EXPOSE_TODAY_WEEK",
    "FOODABLE_EXPOSE_TODAY_EDIT",
] as const;
const REAL_GLOBALS = new Map(
    STUBBED_GLOBALS.map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
);
const REAL_SET_TIMEOUT = globalThis.setTimeout;

function restoreGlobals(): void {
    for (const [key, descriptor] of REAL_GLOBALS) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
    }
}

afterEach(restoreGlobals);

type WeekApi = (opts: {
    dx: number;
    dy: number;
    threshold?: number;
}) => "prev" | "next" | null;

const weekDecision: WeekApi = (() => {
    const src = readFileSync(new URL("./today.js", import.meta.url), "utf8");
    let fn: WeekApi = () => null;
    const g = globalThis as typeof globalThis & {
        window?: Record<string, unknown>;
        FOODABLE_EXPOSE_TODAY_WEEK?: (f: WeekApi) => void;
        FoodableApp?: { onLoad: (cb: (root: unknown) => void) => void };
    };
    // @ts-expect-error test harness stubs browser globals
    g.window = globalThis;
    g.FOODABLE_EXPOSE_TODAY_WEEK = (f) => {
        fn = f;
    };
    g.FoodableApp = { onLoad() {} };
    eval(src);
    restoreGlobals();
    return fn;
})();

type TodayEditExpose = {
    parseNum: (raw: string | null) => number | null;
    updateMacroTiles: (
        container: {
            querySelectorAll: (sel: string) => Array<{
                querySelector: (sel: string) => { textContent: string } | null;
            }>;
        },
        macros: {
            calories: number | null;
            protein_g: number | null;
            carbs_g: number | null;
            fat_g: number | null;
        },
    ) => void;
    scaleTiles: (
        root: { getAttribute: (n: string) => string | null },
        factor: number,
    ) => {
        calories: number | null;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
    };
};

const loadTodayEdit = (): TodayEditExpose => {
    const src = readFileSync(new URL("./today.js", import.meta.url), "utf8");
    let api: TodayEditExpose | null = null;
    const g = globalThis as typeof globalThis & {
        window?: Record<string, unknown>;
        FOODABLE_EXPOSE_TODAY_EDIT?: (x: TodayEditExpose) => void;
        FoodableApp?: { onLoad: () => void };
    };
    // @ts-expect-error test harness stubs browser globals
    g.window = globalThis;
    g.FOODABLE_EXPOSE_TODAY_EDIT = (x) => {
        api = x;
    };
    g.FoodableApp = { onLoad() {} };
    eval(src);
    if (!api) throw new Error("today edit api missing");
    return api;
};

test("parseNum treats empty attributes as null", () => {
    const { parseNum } = loadTodayEdit();
    expect(parseNum("")).toBeNull();
    expect(parseNum("12")).toBe(12);
});

test("null macros stay dash when scaling tiles", () => {
    const { scaleTiles, updateMacroTiles } = loadTodayEdit();
    const root = {
        getAttribute(name: string) {
            if (name === "data-fd-calories") return "";
            if (name === "data-fd-protein") return "";
            return null;
        },
    };
    const scaled = scaleTiles(root, 2);
    expect(scaled.calories).toBeNull();
    const values: string[] = [];
    const container = {
        querySelectorAll(sel: string) {
            if (!sel.includes("fd-tile")) return [];
            return [
                {
                    querySelector(part: string) {
                        if (part.includes("label"))
                            return { textContent: "kcal" };
                        values.push("—");
                        return { textContent: "—" };
                    },
                },
            ];
        },
    };
    updateMacroTiles(container, scaled);
    expect(values[0]).toBe("—");
});

test("week swipe ignores mostly vertical motion", () => {
    expect(weekDecision({ dx: 80, dy: 120 })).toBe(null);
});

test("week swipe crosses threshold to next week", () => {
    expect(weekDecision({ dx: -60, dy: 4 })).toBe("next");
    expect(weekDecision({ dx: 60, dy: 4 })).toBe("prev");
});

test("undo toast action submits and auto-dismisses after six seconds", () => {
    const timeouts: Array<{ ms: number; fn: () => void }> = [];
    const regionChildren: HTMLElement[] = [];
    const region = {
        firstChild: null as HTMLElement | null,
        insertBefore(el: HTMLElement) {
            el.parentNode = region;
            regionChildren.unshift(el);
            this.firstChild = regionChildren[0] ?? null;
        },
        removeChild(el: HTMLElement) {
            const i = regionChildren.indexOf(el);
            if (i >= 0) regionChildren.splice(i, 1);
            this.firstChild = regionChildren[0] ?? null;
        },
        querySelectorAll(sel: string) {
            return sel === ".toast-item" ? regionChildren : [];
        },
        get children() {
            return regionChildren;
        },
    };
    const seed = {
        getAttribute(name: string) {
            if (name === "data-toast-kind") return "success";
            if (name === "data-toast-text") return "Meal deleted";
            if (name === "data-toast-dismiss-ms") return "6000";
            if (name === "data-toast-has-action") return "1";
            return null;
        },
        querySelector() {
            return {
                outerHTML:
                    '<form class="toast-action" method="post" action="/meals/undo"><button type="submit">Undo</button></form>',
            };
        },
        remove() {},
    };
    class HTMLElement {
        tagName = "DIV";
        type = "";
        className = "";
        firstElementChild: HTMLElement | null = null;
        set innerHTML(html: string) {
            if (!html.includes("toast-action")) return;
            const form = new HTMLFormElement();
            form.className = "toast-action";
            const btn = new HTMLButtonElement();
            btn.type = "submit";
            form.children.push(btn);
            this.firstElementChild = form;
        }
        style = { setProperty() {} };
        hidden = false;
        children: HTMLElement[] = [];
        parentNode: unknown = null;
        isConnected = true;
        appendChild(child: HTMLElement) {
            this.children.push(child);
            return child;
        }
        addEventListener() {}
        classList = { add() {}, remove() {} };
        setAttribute() {}
        getAttribute() {
            return null;
        }
    }
    class HTMLButtonElement extends HTMLElement {
        override tagName = "BUTTON";
    }
    class HTMLFormElement extends HTMLElement {
        override tagName = "FORM";
    }
    const documentStub = {
        getElementById(id: string) {
            return id === "toast-region" ? region : null;
        },
        querySelector(sel: string) {
            return sel === "#toast-seed" ? seed : null;
        },
        createElement(tag: string) {
            if (tag === "form" || tag === "FORM") return new HTMLFormElement();
            if (tag === "button") return new HTMLButtonElement();
            const el = new HTMLElement();
            el.tagName = tag.toUpperCase();
            return el;
        },
    };
    const onLoadHooks: Array<(root: unknown) => void> = [];
    const g = globalThis as typeof globalThis & {
        document?: unknown;
        HTMLElement?: typeof HTMLElement;
        HTMLButtonElement?: typeof HTMLButtonElement;
        HTMLFormElement?: typeof HTMLFormElement;
        FoodableApp?: {
            onLoad: (cb: (root: unknown) => void) => void;
            toast?: unknown;
        };
        setTimeout?: typeof setTimeout;
        clearTimeout?: typeof clearTimeout;
    };
    g.HTMLElement = HTMLElement;
    g.HTMLButtonElement = HTMLButtonElement;
    g.HTMLFormElement = HTMLFormElement;
    g.document = documentStub;
    g.FoodableApp = {
        onLoad(cb) {
            onLoadHooks.push(cb);
        },
    };
    // @ts-expect-error test harness stubs browser globals
    g.window = globalThis;
    g.setTimeout = ((fn: () => void, ms?: number) => {
        timeouts.push({ ms: Number(ms ?? 0), fn });
        return timeouts.length;
    }) as unknown as typeof setTimeout;
    g.clearTimeout = () => {};
    const toastSrc = readFileSync(
        new URL("../toast.js", import.meta.url),
        "utf8",
    );
    eval(toastSrc);
    for (const hook of onLoadHooks) hook(documentStub);
    expect(regionChildren).toHaveLength(1);
    const toastEl = regionChildren[0]!;
    const form = toastEl.children.find((c) =>
        c.className.includes("toast-action"),
    );
    expect(form).toBeTruthy();
    const undoBtn = form!.children[0]!;
    expect(undoBtn.tagName).toBe("BUTTON");
    expect(timeouts[0]?.ms).toBe(6000);
    timeouts[0]!.fn();
    const exitAnim = timeouts.find((t) => t.ms === 220);
    exitAnim?.fn();
    expect(regionChildren).toHaveLength(0);
});

test("meal row keydown ignores Enter from swipe delete control", () => {
    const opened: string[] = [];
    const keydownHandlers: Array<
        (e: {
            key: string;
            target: unknown;
            preventDefault: () => void;
        }) => void
    > = [];
    const row = {
        dataset: {} as Record<string, string>,
        getAttribute(name: string) {
            if (name === "data-sheet-id") return "fd-edit-meal-1";
            return null;
        },
        addEventListener(
            ev: string,
            fn: (e: {
                key: string;
                target: unknown;
                preventDefault: () => void;
            }) => void,
        ) {
            if (ev === "keydown") keydownHandlers.push(fn);
        },
        closest() {
            return null;
        },
    };
    const src = readFileSync(new URL("./today.js", import.meta.url), "utf8");
    const g = globalThis as typeof globalThis & {
        document?: {
            getElementById: (id: string) => {
                open: boolean;
                showModal: () => void;
            };
        };
        window?: unknown;
        FoodableApp?: { onLoad: (cb: (root: unknown) => void) => void };
        FOODABLE_EXPOSE_TODAY_WEEK?: () => void;
        FOODABLE_EXPOSE_TODAY_EDIT?: () => void;
    };
    // @ts-expect-error test harness stubs browser globals
    g.window = globalThis;
    g.document = {
        getElementById: (id: string) => ({
            open: false,
            showModal: () => opened.push(id),
        }),
    };
    g.FOODABLE_EXPOSE_TODAY_WEEK = () => {};
    g.FOODABLE_EXPOSE_TODAY_EDIT = () => {};
    const hooks: Array<(root: unknown) => void> = [];
    g.FoodableApp = {
        onLoad(cb) {
            hooks.push(cb);
        },
    };
    eval(src);
    const scope = {
        querySelector() {
            return null;
        },
        querySelectorAll(sel: string) {
            if (sel === "[data-fd-meal-row]") return [row];
            if (sel === "[data-fd-edit-macros]") return [];
            return [];
        },
    };
    for (const hook of hooks) hook(scope);
    expect(keydownHandlers).toHaveLength(1);
    const handler = keydownHandlers[0]!;
    const button = { tagName: "BUTTON" };
    handler({ key: "Enter", target: button, preventDefault() {} });
    expect(opened).toHaveLength(0);
    handler({ key: "Enter", target: row, preventDefault() {} });
    expect(opened).toEqual(["fd-edit-meal-1"]);
});

test("stepper change updates fd-tile macro values", () => {
    const { parseNum, scaleTiles, updateMacroTiles } = loadTodayEdit();
    const host = {
        getAttribute(name: string) {
            if (name === "data-fd-calories") return "200";
            if (name === "data-fd-protein") return "20";
            if (name === "data-fd-carbs") return "10";
            if (name === "data-fd-fat") return "5";
            if (name === "data-fd-base-amount") return "100";
            return null;
        },
    };
    const doubled = scaleTiles(host, 2);
    expect(doubled.calories).toBe(400);
    const texts = new Map<string, string>();
    const container = {
        querySelectorAll(sel: string) {
            if (!sel.includes("fd-tile")) return [];
            return (["kcal", "Protein", "Carbs", "Fat"] as const).map(
                (label) => ({
                    querySelector(part: string) {
                        if (part.includes("label"))
                            return { textContent: label };
                        const key = label.toLowerCase();
                        return {
                            set textContent(v: string) {
                                texts.set(key, v);
                            },
                            get textContent() {
                                return texts.get(key) ?? "";
                            },
                        };
                    },
                }),
            );
        },
    };
    updateMacroTiles(container, doubled);
    expect(texts.get("kcal")).toBe("400");
    expect(texts.get("protein")).toBe("40");
    expect(parseNum("")).toBeNull();
});

test("tile update keeps the unit and a tenth under 10 g", () => {
    const { updateMacroTiles } = loadTodayEdit();
    const out = new Map<string, { text: string; unitKept: boolean }>();
    const container = {
        querySelectorAll(sel: string) {
            if (!sel.includes("fd-tile")) return [];
            return (["kcal", "Protein", "Fat"] as const).map((label) => {
                const unit = { cls: "fd-stat__unit" };
                const state = { text: "", unitKept: false };
                out.set(label, state);
                const valueEl = {
                    set textContent(v: string) {
                        state.text = v;
                        state.unitKept = false;
                    },
                    querySelector: () => (label === "kcal" ? null : unit),
                    append(node: unknown) {
                        if (node === unit) state.unitKept = true;
                    },
                };
                return {
                    querySelector: (part: string) =>
                        part.includes("label")
                            ? { textContent: label }
                            : valueEl,
                };
            });
        },
    };
    updateMacroTiles(container, {
        calories: 201.6,
        protein_g: null,
        carbs_g: null,
        fat_g: 5.05,
    });
    expect(out.get("kcal")).toEqual({ text: "202", unitKept: false });
    expect(out.get("Protein")).toEqual({ text: "—", unitKept: true });
    expect(out.get("Fat")?.text).toBe("5.1");
    expect(out.get("Fat")?.unitKept).toBe(true);
});

test("the browser globals the other tests stub are back as they were", () => {
    // Bun runs every test file in one process, so a global left behind here is
    // seen by whatever file runs next. Compared with the values this file
    // found, not with "absent": an earlier file may have left its own.
    for (const key of STUBBED_GLOBALS) {
        const had = REAL_GLOBALS.get(key);
        const now = Object.getOwnPropertyDescriptor(globalThis, key);
        expect({ key, value: now?.value }).toEqual({
            key,
            value: had?.value,
        });
    }
    expect(globalThis.setTimeout).toBe(REAL_SET_TIMEOUT);
});
