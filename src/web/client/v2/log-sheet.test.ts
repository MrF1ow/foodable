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
    rebuildUnitChips: (
        form: { querySelector: (sel: string) => unknown },
        units: string[],
        selected: string,
    ) => void;
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
const g = globalThis as typeof globalThis & {
    window?: Record<string, unknown>;
    document?: unknown;
    HTMLDialogElement?: unknown;
};
g.document = documentStub;
g.HTMLDialogElement = class HTMLDialogElement {};
g.window = {
    FOODABLE_EXPOSE_LOG_MACROS: (fn: LogMacroApi) => {
        api = fn;
    },
    FoodableApp: {
        onLoad(fn: (root: unknown) => void) {
            onLoadHooks.push(fn);
        },
    },
};

let api: LogMacroApi;
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
