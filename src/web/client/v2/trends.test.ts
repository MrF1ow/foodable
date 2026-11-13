import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { goalsResolver } from "../../../domain/insights.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { TrendsDay } from "../../../domain/trends-view.js";
import {
    buildPreviewTrendsPageData,
    renderTrendsBody,
} from "../../pages/v2/trends.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";

const baseGoals: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2200,
    daily_protein_g: 160,
    daily_carbs_g: 220,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 45,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

function denseDays(today: string, count: number): TrendsDay[] {
    const out: TrendsDay[] = [];
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        out.push({
            date,
            calories: 2000 + i,
            protein_g: 120,
            carbs_g: 200,
            fat_g: 60,
            logged: true,
        });
    }
    return out;
}

type MockEl = {
    nodeName: string;
    attributes: Map<string, string>;
    children: MockEl[];
    parent: MockEl | null;
    classList: {
        toggle: (c: string, on?: boolean) => void;
    };
    matches: (sel: string) => boolean;
    closest: (sel: string) => MockEl | null;
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    removeAttribute: (name: string) => void;
    querySelector: (sel: string) => MockEl | null;
    querySelectorAll: (sel: string) => MockEl[];
    contains: (node: unknown) => boolean;
    click: () => void;
    addEventListener: (type: string, fn: (e: unknown) => void) => void;
};

function parseAttrs(raw: string): Map<string, string> {
    const attrs = new Map<string, string>();
    const re = /([\w-]+)(?:="([^"]*)"|='([^']*)'|=(?:""|''))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
        const name = m[1]!;
        if (name === "hidden" && !m[2] && !m[3]) {
            attrs.set("hidden", "");
            continue;
        }
        attrs.set(name, m[2] ?? m[3] ?? "");
    }
    return attrs;
}

function createEl(
    tag: string,
    attrs: Map<string, string>,
    parent: MockEl | null,
): MockEl {
    const el: MockEl = {
        nodeName: tag.toUpperCase(),
        attributes: attrs,
        children: [],
        parent,
        classList: {
            toggle(className: string, on?: boolean) {
                const cur = el.attributes.get("class") ?? "";
                const parts = new Set(cur.split(/\s+/).filter(Boolean));
                const shouldOn = on ?? !parts.has(className);
                if (shouldOn) parts.add(className);
                else parts.delete(className);
                if (parts.size)
                    el.attributes.set("class", [...parts].join(" "));
                else el.attributes.delete("class");
            },
        },
        matches(sel: string) {
            return matchesSel(el, sel);
        },
        closest(sel: string) {
            let node: MockEl | null = el;
            while (node) {
                if (node.matches(sel)) return node;
                node = node.parent;
            }
            return null;
        },
        getAttribute(name: string) {
            return el.attributes.has(name)
                ? (el.attributes.get(name) ?? "")
                : null;
        },
        setAttribute(name: string, value: string) {
            el.attributes.set(name, value);
        },
        removeAttribute(name: string) {
            el.attributes.delete(name);
        },
        querySelector(sel: string) {
            const all = el.querySelectorAll(sel);
            return all[0] ?? null;
        },
        querySelectorAll(sel: string) {
            const out: MockEl[] = [];
            function walk(node: MockEl) {
                if (node !== el && matchesSel(node, sel)) out.push(node);
                for (const child of node.children) walk(child);
            }
            walk(el);
            return out;
        },
        contains(node: unknown) {
            if (node === el) return true;
            let cur = node as MockEl | null;
            while (cur?.parent) {
                if (cur.parent === el) return true;
                cur = cur.parent;
            }
            return false;
        },
        click() {
            const event = {
                target: {
                    closest(sel: string) {
                        return el.closest(sel);
                    },
                },
                preventDefault() {},
            };
            let node: MockEl | null = el;
            while (node) {
                for (const fn of listenersFor(node).click) fn(event);
                node = node.parent;
            }
        },
        addEventListener(type: string, fn: (e: unknown) => void) {
            if (type === "click") listenersFor(el).click.push(fn);
            else if (type === "keydown") listenersFor(el).keydown.push(fn);
        },
    };
    el.addEventListener = el.addEventListener;
    return el;
}

const elListeners = new WeakMap<
    MockEl,
    { click: Array<(e: unknown) => void>; keydown: Array<(e: unknown) => void> }
>();

function listenersFor(el: MockEl) {
    let bag = elListeners.get(el);
    if (!bag) {
        bag = { click: [], keydown: [] };
        elListeners.set(el, bag);
    }
    return bag;
}

function matchesSel(el: MockEl, sel: string): boolean {
    if (sel === "[data-fd-trends-root]")
        return el.attributes.has("data-fd-trends-root");
    if (sel === "[data-fd-trends-panel]")
        return el.attributes.has("data-fd-trends-panel");
    if (sel === "[data-fd-trends-range]")
        return el.attributes.has("data-fd-trends-range");
    const notHidden = sel.match(/^\[data-fd-trends-panel\]:not\(\[hidden\]\)$/);
    if (notHidden)
        return (
            el.attributes.has("data-fd-trends-panel") &&
            !el.attributes.has("hidden")
        );
    const attrEq = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
    if (attrEq) return el.attributes.get(attrEq[1]!) === attrEq[2];
    const attrPressed = sel.match(
        /^\[data-fd-trends-range\]\[aria-pressed="true"\]$/,
    );
    if (attrPressed) {
        return (
            el.attributes.has("data-fd-trends-range") &&
            el.attributes.get("aria-pressed") === "true"
        );
    }
    const twoAttr = sel.match(/^\[([\w-]+)\]\[([\w-]+)="([^"]*)"\]$/);
    if (twoAttr) {
        return (
            el.attributes.has(twoAttr[1]!) &&
            el.attributes.get(twoAttr[2]!) === twoAttr[3]
        );
    }
    return false;
}

function mountTrendsHtml(html: string): MockEl {
    const stripped = html.replace(/<svg[\s\S]*?<\/svg>/gi, "");
    const root = createEl("div", new Map(), null);
    const stack: MockEl[] = [root];
    const re = /<([a-z][\w-]*)([^>/]*)(\/)?>|<\/([a-z][\w-]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped))) {
        if (m[1]) {
            const attrs = parseAttrs(m[2] ?? "");
            const selfClose = m[3] === "/";
            const el = createEl(m[1], attrs, stack[stack.length - 1]!);
            stack[stack.length - 1]!.children.push(el);
            if (!selfClose) stack.push(el);
        } else if (m[4]) {
            const tag = m[4].toUpperCase();
            while (stack.length > 1) {
                const top = stack.pop()!;
                if (top.nodeName === tag) break;
            }
        }
    }
    const trends =
        root.querySelector("[data-fd-trends-root]") ??
        root.children.find((c) => c.attributes.has("data-fd-trends-root")) ??
        root;
    return trends;
}

const data = buildPreviewTrendsPageData(
    {
        theme: "light",
        flags: FIXTURE_APP_CHROME_FLAGS,
        attention: { count: 0, tabs: {} },
    },
    denseDays("2026-09-01", 90),
    goalsResolver(baseGoals, []),
    [],
    "2026-09-01",
    "kg",
);

const trendsRoot = mountTrendsHtml(String(renderTrendsBody(data)));
const pageRoot = createEl("div", new Map(), null);
pageRoot.children = [trendsRoot];
trendsRoot.parent = pageRoot;
pageRoot.querySelectorAll = (sel: string) => {
    if (sel === "[data-fd-trends-root]") return [trendsRoot];
    return trendsRoot.querySelectorAll(sel);
};
pageRoot.querySelector = (sel: string) => trendsRoot.querySelector(sel);
pageRoot.matches = () => false;
pageRoot.contains = (node: unknown) =>
    trendsRoot.contains(node) || node === pageRoot;
pageRoot.addEventListener = () => {};

let fetchCalls = 0;
const g = globalThis as typeof globalThis & {
    document?: { querySelectorAll: (sel: string) => MockEl[] };
    window?: Record<string, unknown>;
    FoodableApp?: { onLoad: (fn: (root: unknown) => void) => void };
    fetch?: typeof fetch;
};

const onLoadHooks: Array<(root: unknown) => void> = [];
g.FoodableApp = {
    onLoad(fn: (root: unknown) => void) {
        onLoadHooks.push(fn);
    },
};
g.fetch = (() => {
    fetchCalls += 1;
    throw new Error("fetch should not run");
}) as unknown as typeof fetch;
g.window = g.window ?? {};
g.document = {
    querySelectorAll(sel: string) {
        if (sel === "[data-fd-trends-root]") return [trendsRoot];
        return pageRoot.querySelectorAll(sel);
    },
};

let api: {
    setActiveRange: (range: string | number) => void;
    root: MockEl;
} | null = null;

g.window!.FOODABLE_EXPOSE_TRENDS = (exposed: typeof api) => {
    api = exposed;
};

eval(
    `(function () {\n${readFileSync("./src/web/client/v2/trends.js", "utf8").trim()}\n})();`,
);

for (const hook of onLoadHooks) hook(pageRoot);

function visiblePanelRange(root: MockEl): string | null {
    const panel = root.querySelector("[data-fd-trends-panel]:not([hidden])");
    return panel?.getAttribute("data-fd-trends-panel") ?? null;
}

function pressedRange(root: MockEl): string | null {
    const btn = root.querySelector(
        '[data-fd-trends-range][aria-pressed="true"]',
    );
    return btn?.getAttribute("data-fd-trends-range") ?? null;
}

test("toggle shows the matching panel and aria-pressed through 7→30→90→365", () => {
    fetchCalls = 0;
    expect(visiblePanelRange(trendsRoot)).toBe("30");
    expect(pressedRange(trendsRoot)).toBe("30");

    for (const range of ["7", "30", "90", "365"] as const) {
        api!.setActiveRange(range);
        expect(visiblePanelRange(trendsRoot)).toBe(range);
        expect(pressedRange(trendsRoot)).toBe(range);
    }
    expect(fetchCalls).toBe(0);
});

test("click on range button updates visible panel", () => {
    fetchCalls = 0;
    const btn7 = trendsRoot.querySelector('[data-fd-trends-range="7"]')!;
    btn7.click();
    expect(visiblePanelRange(trendsRoot)).toBe("7");
    expect(pressedRange(trendsRoot)).toBe("7");
    expect(fetchCalls).toBe(0);
});
