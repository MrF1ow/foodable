import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { formatLogMacroGrams } from "../../../domain/log-macro-format.js";

type LogMacroApi = {
    formatLogMacroGrams: (value: number) => string;
    macrosFor: (
        item: Record<string, unknown>,
        amount: number,
        unit: string,
    ) => Record<string, number | null> | null;
    allowedUnits: (item: Record<string, unknown>) => string[];
    portionLabel: (
        serving: { amount: number; unit: string },
        portions: number,
    ) => string;
    amountAfterUnitChange: (
        prev: string | undefined,
        next: string,
        current: string,
    ) => string;
    recentChipHtml: (item: Record<string, unknown>) => string;
    rebuildUnitChips: (
        form: { querySelector: (sel: string) => unknown },
        units: string[],
        selected: string,
    ) => void;
};

type ShortcutEvent = {
    defaultPrevented: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
};

type FakeEl = EventTarget & {
    tagName?: string;
    type?: string;
    disabled?: boolean;
    readOnly?: boolean;
    isContentEditable?: boolean;
    closest?: (sel: string) => FakeEl | null;
    matches?: (sel: string) => boolean;
    classList?: { contains: (c: string) => boolean };
};

type LogKeyboardApi = {
    isEditableTarget: (el: EventTarget | null) => boolean;
    isLogSearchShortcut: (event: ShortcutEvent) => boolean;
    nextSearchRowIndex: (
        current: number,
        count: number,
        direction: 1 | -1,
    ) => number;
    shouldAmountEnterSubmit: (target: EventTarget | null) => boolean;
    amountFormSubmitButton: (
        form: { id?: string; querySelector: (sel: string) => unknown } | null,
        dialog: { querySelector: (sel: string) => unknown } | null,
    ) => unknown;
};

const docListeners: Array<{ type: string; capture: boolean }> = [];
const onLoadHooks: Array<(root: unknown) => void> = [];
const rootStub = {
    querySelector(sel: string) {
        if (sel === ".fd-shell") return rootStub;
        return null;
    },
    querySelectorAll() {
        return [];
    },
};
const documentStub = {
    querySelector(sel: string) {
        if (sel === ".fd-shell") return rootStub;
        return null;
    },
    getElementById() {
        return null;
    },
    addEventListener(type: string, _fn: unknown, capture?: boolean) {
        docListeners.push({ type, capture: capture === true });
    },
};

const savedDocument = (globalThis as unknown as { document: unknown }).document;
class Element {}
class HTMLElement extends Element {
    tagName = "";
    disabled = false;
    readOnly = false;
    isContentEditable = false;
    closest() {
        return null;
    }
    matches() {
        return false;
    }
    classList = { contains: () => false };
}
class HTMLFormElement extends HTMLElement {
    id = "";
    querySelector() {
        return null;
    }
}
class HTMLButtonElement extends HTMLElement {}
const g = globalThis as typeof globalThis & {
    window?: Record<string, unknown>;
    document?: unknown;
    HTMLDialogElement?: unknown;
    Element?: typeof Element;
    HTMLElement?: typeof HTMLElement;
    HTMLFormElement?: typeof HTMLFormElement;
    HTMLButtonElement?: typeof HTMLButtonElement;
};
g.document = documentStub;
g.Element = Element;
g.HTMLElement = HTMLElement;
g.HTMLFormElement = HTMLFormElement;
g.HTMLButtonElement = HTMLButtonElement;
g.HTMLDialogElement = class HTMLDialogElement extends HTMLElement {};
g.window = {
    location: { pathname: "/", search: "?date=2026-11-10" },
    FOODABLE_EXPOSE_LOG_MACROS: (fn: LogMacroApi) => {
        api = fn;
    },
    FOODABLE_EXPOSE_LOG_KEYBOARD: (fn: LogKeyboardApi) => {
        keyboard = fn;
    },
    FoodableApp: {
        onLoad(fn: (root: unknown) => void) {
            onLoadHooks.push(fn);
        },
    },
};

let api: LogMacroApi;
let keyboard: LogKeyboardApi;
// oxlint-disable-next-line no-eval -- test seam matches other v2 client modules
eval(readFileSync("./src/web/client/v2/log-sheet.js", "utf8"));
onLoadHooks.forEach((fn) => fn(rootStub));
g.document = savedDocument;

test("search sheet fetches on first open when query unchanged", () => {
    const source = readFileSync("./src/web/client/v2/log-sheet.js", "utf8");
    expect(source).toMatch(/let lastQ = null/);
    expect(source).toMatch(/if \(lastQ !== cur\)/);
    expect(source).toMatch(/let fetchSeq = 0/);
    expect(source).toMatch(/if \(seq !== fetchSeq\) return/);
});

test("init binds document capture listeners only once", () => {
    const captureClicks = docListeners.filter(
        (l) => l.type === "click" && l.capture,
    ).length;
    expect(captureClicks).toBe(1);
    const source = readFileSync("./src/web/client/v2/log-sheet.js", "utf8");
    expect(source).toContain("openersBound");
    expect(source).toMatch(/if \(openersBound\) return/);
});

const FOOD = {
    kcal_per_100g: 200,
    protein_per_100g: 10,
    carbs_per_100g: 20,
    fat_per_100g: 5,
    grams_per_ml: null,
    grams_per_each: 50,
};

test("grams scale per 100 g nutrition", () => {
    const m = api.macrosFor(FOOD, 150, "g");
    expect(m).toEqual({
        kcal: 300,
        protein_g: 15,
        carbs_g: 30,
        fat_g: 7.5,
    });
});

test("ml uses grams_per_ml", () => {
    const m = api.macrosFor({ ...FOOD, grams_per_ml: 1.03 }, 100, "ml");
    expect(m?.kcal).toBe(206);
});

test("each uses grams_per_each", () => {
    const m = api.macrosFor(FOOD, 2, "each");
    expect(m?.kcal).toBe(200);
});

test("a unit without a factor is not offered", () => {
    const hints = api.allowedUnits({
        grams_per_ml: null,
        grams_per_each: null,
    });
    expect(hints).toEqual(["g"]);
    expect(api.macrosFor(FOOD, 1, "ml")).toBeNull();
});

// Half & Half: 40 kcal in a 30 ml serving, so 133.3 kcal per 100 ml.
const HALF_AND_HALF = {
    kcal_per_100g: (40 / 30) * 100,
    basis: "100ml",
    serving: { label: "1 tbsp (30 ml)", amount: 30, unit: "ml" },
};

test("ml on a per-100 ml food scales directly, with no density", () => {
    expect(api.macrosFor(HALF_AND_HALF, 30, "ml")?.kcal).toBe(40);
    expect(api.macrosFor(HALF_AND_HALF, 100, "ml")?.kcal).toBe(133.3);
});

test("one portion is the pack serving: 1 portion · 30 ml, 40 kcal", () => {
    expect(api.macrosFor(HALF_AND_HALF, 1, "portion")?.kcal).toBe(40);
    expect(api.portionLabel(HALF_AND_HALF.serving, 1)).toBe(
        "1 portion · 30 ml",
    );
});

test("g and each on a per-100 ml food go through its density, never 1 g = 1 ml", () => {
    const oil = { kcal_per_100g: 800, basis: "100ml", grams_per_ml: 0.92 };
    // 92 g at 0.92 g/ml is 100 ml.
    expect(api.macrosFor(oil, 92, "g")?.kcal).toBe(800);
    expect(api.macrosFor({ ...oil, grams_per_each: 46 }, 2, "each")?.kcal).toBe(
        800,
    );
    // No density: g is not guessed.
    expect(
        api.macrosFor({ kcal_per_100g: 42, basis: "100ml" }, 100, "g"),
    ).toBeNull();
    expect(
        api.macrosFor(
            {
                kcal_per_100g: 42,
                basis: "100ml",
                serving: { label: "x", amount: 250, unit: "g" },
            },
            1,
            "portion",
        ),
    ).toBeNull();
});

test("a pack serving leads the unit chips, and a per-100 ml food offers ml", () => {
    expect(api.allowedUnits(HALF_AND_HALF)).toEqual(["portion", "ml"]);
    expect(api.allowedUnits({ basis: "100ml" })).toEqual(["ml"]);
    expect(api.allowedUnits({ basis: "100ml", grams_per_ml: 0.92 })).toEqual([
        "ml",
        "g",
    ]);
    expect(api.allowedUnits({ serving: { amount: 45, unit: "g" } })).toEqual([
        "portion",
        "g",
    ]);
    // A serving in ml needs a density on a per-100 g food.
    expect(api.allowedUnits({ serving: { amount: 30, unit: "ml" } })).toEqual([
        "g",
    ]);
});

test("recipe pick exposes portion unit only", () => {
    expect(
        api.allowedUnits({
            recipe_id: "r1",
            unit_hints: ["portion"],
        }),
    ).toEqual(["portion"]);
});

test("food with grams_per_ml offers ml", () => {
    expect(
        api.allowedUnits({
            grams_per_ml: 1.03,
            grams_per_each: null,
        }),
    ).toEqual(["g", "ml"]);
});

test("recipe portions use per-portion values", () => {
    const m = api.macrosFor(
        {
            recipe_id: "r1",
            kcal: 400,
            protein_g: 20,
            carbs_g: 30,
            fat_g: 10,
        },
        1.5,
        "portion",
    );
    expect(m).toEqual({
        kcal: 600,
        protein_g: 30,
        carbs_g: 45,
        fat_g: 15,
    });
});

test("history recipe uses per-portion kcal not meal total", () => {
    const m = api.macrosFor(
        {
            recipe_id: "r1",
            kcal: 400,
            protein_g: 20,
            meal_kcal: 800,
            amount: 2,
            unit: "portion",
        },
        2,
        "portion",
    );
    expect(m?.kcal).toBe(800);
});

test("formatLogMacroGrams matches domain helper", () => {
    const drifts: string[] = [];
    for (let i = 0; i <= 2000; i++) {
        const v = i / 20;
        const server = formatLogMacroGrams(v);
        const client = api.formatLogMacroGrams(v);
        if (server !== client) drifts.push(`${v}`);
    }
    expect(drifts).toEqual([]);
});

test("a recent single-food log picks the food; a multi-item log is logged again whole", () => {
    const single = api.recentChipHtml({
        id: "meal-1",
        meal_id: "meal-1",
        name: "Banana",
        food_id: "f-banana",
        meal_kcal: 105,
    });
    expect(single).toContain("data-fd-log-pick");
    expect(single).not.toContain("<form");

    const multi = api.recentChipHtml({
        id: "meal-2",
        meal_id: "meal-2",
        name: "Eggs & toast",
        meal_kcal: 432,
    });
    expect(multi).toContain('<form class="fd-log-recent-form" method="post"');
    expect(multi).toContain('action="/meals/meal-2/again"');
    expect(multi).toContain('name="return_to" value="/?date=2026-11-10"');
    expect(multi).toContain('name="date" value="2026-11-10"');
    expect(multi).toMatch(/name="submit_key" value="[^"]{8,}"/);
    // A second render is a second key: one key is one tap.
    expect(
        api
            .recentChipHtml({ id: "meal-2", meal_id: "meal-2", name: "Eggs" })
            .match(/name="submit_key" value="([^"]+)"/)?.[1],
    ).not.toBe(multi.match(/name="submit_key" value="([^"]+)"/)?.[1]);
    expect(multi).toContain("Eggs &amp; toast");
    expect(multi).toContain("432");
    expect(multi).not.toContain("data-fd-log-pick");

    expect(api.recentChipHtml({ name: "Mystery" })).toBe("");
});

test("only the empty search asks for ten recent logs", () => {
    const src = readFileSync(
        new URL("./log-sheet.js", import.meta.url),
        "utf8",
    );
    expect(src).toContain('const limit = q ? "" : "&limit=10";');
    expect(src).not.toContain('"&online=1" : ""}&limit=10');
});

test("isLogSearchShortcut accepts Meta+K and Control+K, not plain K", () => {
    expect(
        keyboard.isLogSearchShortcut({
            defaultPrevented: false,
            altKey: false,
            shiftKey: false,
            metaKey: true,
            ctrlKey: false,
            key: "k",
        }),
    ).toBe(true);
    expect(
        keyboard.isLogSearchShortcut({
            defaultPrevented: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            ctrlKey: true,
            key: "K",
        }),
    ).toBe(true);
    expect(
        keyboard.isLogSearchShortcut({
            defaultPrevented: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            key: "k",
        }),
    ).toBe(false);
});

function fakeEl(
    tag: string,
    extra: Partial<FakeEl> = {},
): EventTarget & FakeEl {
    return Object.assign(Object.create(HTMLElement.prototype), {
        tagName: tag,
        disabled: false,
        readOnly: false,
        closest: () => null,
        matches: () => false,
        classList: { contains: () => false },
        ...extra,
    });
}

test("isEditableTarget matches real control kinds", () => {
    expect(keyboard.isEditableTarget(null)).toBe(false);
    expect(
        keyboard.isEditableTarget(
            fakeEl("INPUT", { type: "text" }) as EventTarget,
        ),
    ).toBe(true);
    expect(keyboard.isEditableTarget(fakeEl("TEXTAREA") as EventTarget)).toBe(
        true,
    );
    expect(
        keyboard.isEditableTarget(
            fakeEl("DIV", { isContentEditable: true }) as EventTarget,
        ),
    ).toBe(true);
    expect(keyboard.isEditableTarget(fakeEl("BUTTON") as EventTarget)).toBe(
        false,
    );
    expect(
        keyboard.isEditableTarget(
            fakeEl("INPUT", { type: "checkbox" }) as EventTarget,
        ),
    ).toBe(false);
    expect(
        keyboard.isEditableTarget(
            fakeEl("INPUT", { type: "hidden" }) as EventTarget,
        ),
    ).toBe(false);
});

test("shouldAmountEnterSubmit allows amount field and panel, not chips", () => {
    const numberInput = fakeEl("INPUT", {
        matches: (sel) => sel === 'input[type="number"]',
        closest: () => null,
    });
    expect(keyboard.shouldAmountEnterSubmit(numberInput as EventTarget)).toBe(
        true,
    );
    const chip = fakeEl("SPAN", {
        closest: (sel) => (sel === ".fd-chip" ? chip : null),
    });
    expect(keyboard.shouldAmountEnterSubmit(chip as EventTarget)).toBe(false);
    const panel = Object.assign(Object.create(HTMLElement.prototype), {
        classList: { contains: (c: string) => c === "fd-sheet-panel" },
        matches: () => false,
        closest: () => null,
    });
    expect(keyboard.shouldAmountEnterSubmit(panel)).toBe(true);
});

test("amountFormSubmitButton finds submit outside the form", () => {
    const submit = Object.create(HTMLButtonElement.prototype);
    const form = Object.create(HTMLFormElement.prototype);
    form.id = "fd-log-amount-form";
    form.querySelector = () => null;
    const prev = documentStub.querySelector;
    documentStub.querySelector = (sel: string) => {
        if (sel.includes("fd-log-amount-form")) return submit;
        return prev(sel);
    };
    const prevDoc = g.document;
    g.document = documentStub;
    const btn = keyboard.amountFormSubmitButton(
        form as unknown as HTMLFormElement,
        { querySelector: () => null },
    );
    expect(btn).toBe(submit);
    documentStub.querySelector = prev;
    g.document = prevDoc;
});

test("nextSearchRowIndex wraps at the ends", () => {
    expect(keyboard.nextSearchRowIndex(-1, 3, 1)).toBe(0);
    expect(keyboard.nextSearchRowIndex(-1, 3, -1)).toBe(2);
    expect(keyboard.nextSearchRowIndex(0, 3, -1)).toBe(2);
    expect(keyboard.nextSearchRowIndex(2, 3, 1)).toBe(0);
    expect(keyboard.nextSearchRowIndex(1, 3, 1)).toBe(2);
    expect(keyboard.nextSearchRowIndex(0, 0, 1)).toBe(-1);
});

test("rebuildUnitChips creates only allowed unit radios", () => {
    const fieldset = { innerHTML: "" };
    const form = {
        querySelector() {
            return fieldset;
        },
    };
    api.rebuildUnitChips(form, ["portion"], "portion");
    expect(fieldset.innerHTML).toContain('value="portion" checked');
    expect(fieldset.innerHTML).not.toContain('value="g"');
    api.rebuildUnitChips(form, ["g", "ml"], "ml");
    expect(fieldset.innerHTML).toContain('value="g"');
    expect(fieldset.innerHTML).toContain('value="ml" checked');
});

test("switching from or to portion resets the amount, between g and ml it stays", () => {
    // 1 portion must not become 1 ml.
    expect(api.amountAfterUnitChange("portion", "ml", "1")).toBe("100");
    expect(api.amountAfterUnitChange("ml", "portion", "250")).toBe("1");
    expect(api.amountAfterUnitChange("portion", "g", "2")).toBe("100");
    expect(api.amountAfterUnitChange("ml", "g", "250")).toBe("250");
    expect(api.amountAfterUnitChange("g", "ml", "250")).toBe("250");
    expect(api.amountAfterUnitChange(undefined, "ml", "30")).toBe("30");
    expect(api.amountAfterUnitChange("ml", "ml", "30")).toBe("30");
});
