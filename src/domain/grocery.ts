import { catalogIdentity } from "./food-identity.js";
import type { FoodIdentity, SupplyIdentity } from "./food-identity.js";
import type { FoodResult } from "../foods.js";
import {
    findFoodById,
    findOrCreateFoodByBarcode,
    findOrCreateManualFood,
    FoodsInputError,
    normalizeFoodName,
    type FoodsStore,
} from "./foods.js";
import { storedFoodUnit } from "./food-quantity.js";
import type {
    GrocerySection,
    GroceryStore,
    SettingsStore,
} from "./settings.js";
import {
    ALLERGEN_LABELS,
    type AllergenCode,
    type MemberAllergen,
} from "./rules.js";

export type GroceryKind = "food" | "supply";

export type GroceryQuantity = { amount: number; unit: string };

export type GroceryLine = {
    id: string;
    householdId: string;
    storeId: string;
    sectionId: string;
    kind: GroceryKind;
    displayName: string;
    quantity: GroceryQuantity;
    identity: FoodIdentity | SupplyIdentity;
    foodId: string | null;
    checked: boolean;
};

export type GrocerySnapshot = {
    stores: GroceryStore[];
    sections: GrocerySection[];
    lines: GroceryLine[];
};

export type GroceryListStore = {
    listLines(householdId: string): Promise<GroceryLine[]>;
    insertLine(row: GroceryLine): Promise<GroceryLine>;
    updateLine(row: GroceryLine): Promise<GroceryLine | null>;
    deleteLine(householdId: string, id: string): Promise<boolean>;
};

export type GroceryAllergenMember = {
    displayName: string;
    allergens: MemberAllergen[];
};

export type GroceryAllergenWarning = {
    blocking: boolean;
    text: string;
};

export class GroceryInputError extends Error {
    readonly code = "grocery_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "GroceryInputError";
    }
}

export function createMemoryGroceryStore(): GroceryListStore {
    const lines: GroceryLine[] = [];
    return {
        async listLines(householdId) {
            return lines
                .filter((row) => row.householdId === householdId)
                .map((row) => ({
                    ...row,
                    quantity: { ...row.quantity },
                }));
        },
        async insertLine(row) {
            const saved = { ...row, quantity: { ...row.quantity } };
            lines.push(saved);
            return { ...saved, quantity: { ...saved.quantity } };
        },
        async updateLine(row) {
            const idx = lines.findIndex(
                (line) =>
                    line.id === row.id && line.householdId === row.householdId,
            );
            if (idx < 0) return null;
            lines[idx] = { ...row, quantity: { ...row.quantity } };
            return { ...row, quantity: { ...row.quantity } };
        },
        async deleteLine(householdId, id) {
            const before = lines.length;
            const next = lines.filter(
                (line) => !(line.householdId === householdId && line.id === id),
            );
            const removed = next.length < before;
            lines.length = 0;
            lines.push(...next);
            return removed;
        },
    };
}

function parseAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new GroceryInputError("Enter an amount greater than zero.");
    }
    return amount;
}

export async function resolveGrocerySectionId(
    settings: SettingsStore,
    storeId: string,
    sectionId?: string,
): Promise<string> {
    const sections = await settings.listSections(storeId);
    if (sectionId) {
        const match = sections.find((row) => row.id === sectionId);
        if (match) return match.id;
    }
    const other = sections.find((row) => row.isOther);
    if (!other) throw new GroceryInputError("Unknown section.");
    return other.id;
}

/**
 * Aisles for the default sections. `sections` matches a section by a word in
 * its name, so a renamed "Meat & fish" still counts. `phrases` are whole
 * multi-word names checked before single words, so "peanut butter" lands in
 * Pantry rather than Dairy.
 */
const SECTION_AISLES: readonly {
    sections: readonly string[];
    words: readonly string[];
    phrases?: readonly string[];
}[] = [
    {
        sections: ["produce", "fruit", "vegetable", "veg"],
        words: [
            "apple",
            "avocado",
            "banana",
            "basil",
            "berry",
            "blueberry",
            "broccoli",
            "cabbage",
            "carrot",
            "celery",
            "cilantro",
            "cucumber",
            "garlic",
            "ginger",
            "grape",
            "kale",
            "leek",
            "lemon",
            "lettuce",
            "lime",
            "mango",
            "mushroom",
            "onion",
            "orange",
            "parsley",
            "peach",
            "pear",
            "pepper",
            "potato",
            "scallion",
            "spinach",
            "squash",
            "strawberry",
            "tomato",
            "zucchini",
        ],
        phrases: ["bell pepper", "green onion", "sweet potato"],
    },
    {
        sections: ["dairy", "egg"],
        words: [
            "butter",
            "buttermilk",
            "cheddar",
            "cheese",
            "cream",
            "egg",
            "feta",
            "milk",
            "mozzarella",
            "parmesan",
            "yogurt",
        ],
        phrases: ["sour cream", "cream cheese", "heavy cream"],
    },
    {
        sections: ["meat", "seafood", "fish", "butcher", "deli"],
        words: [
            "bacon",
            "beef",
            "chicken",
            "cod",
            "fish",
            "ham",
            "lamb",
            "pork",
            "salmon",
            "sausage",
            "shrimp",
            "steak",
            "tilapia",
            "tuna",
            "turkey",
        ],
        phrases: ["ground beef", "ground turkey"],
    },
    {
        sections: ["bakery", "bread"],
        words: ["bagel", "baguette", "bread", "bun", "croissant", "tortilla"],
    },
    {
        sections: ["frozen"],
        words: ["frozen"],
        phrases: ["ice cream"],
    },
    {
        sections: ["pantry", "dry", "baking", "canned"],
        words: [
            "bean",
            "broth",
            "cereal",
            "chocolate",
            "cinnamon",
            "flour",
            "honey",
            "ketchup",
            "lentil",
            "mayonnaise",
            "mustard",
            "noodle",
            "nutmeg",
            "oat",
            "oil",
            "pasta",
            "quinoa",
            "rice",
            "salt",
            "sauce",
            "spice",
            "stock",
            "sugar",
            "syrup",
            "vanilla",
            "vinegar",
            "walnut",
            "yeast",
        ],
        phrases: [
            "almond butter",
            "baking powder",
            "baking soda",
            "black pepper",
            "brown sugar",
            "chocolate chip",
            "coconut milk",
            "olive oil",
            "peanut butter",
            "soy sauce",
            "tomato paste",
            "tomato sauce",
            "vanilla extract",
        ],
    },
    {
        sections: ["beverage", "drink"],
        words: ["coffee", "juice", "soda", "tea", "water", "wine", "beer"],
    },
];

function singular(word: string): string {
    if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
    if (/(oes|ches|shes)$/.test(word)) return word.slice(0, -2);
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
}

function nameWords(name: string): string[] {
    return normalizeFoodName(name)
        .split(/[^a-z]+/)
        .filter(Boolean)
        .map(singular);
}

function sectionForAisle(
    sections: GrocerySection[],
    aisle: (typeof SECTION_AISLES)[number],
): GrocerySection | null {
    return (
        sections.find((section) =>
            nameWords(section.name).some((word) =>
                aisle.sections.includes(word),
            ),
        ) ?? null
    );
}

/** Aisle for a name: a known phrase wins, then "frozen", then the last known word. */
function aisleForName(name: string): (typeof SECTION_AISLES)[number] | null {
    const words = nameWords(name);
    const joined = ` ${words.join(" ")} `;
    let best: {
        aisle: (typeof SECTION_AISLES)[number];
        length: number;
    } | null = null;
    for (const aisle of SECTION_AISLES) {
        for (const phrase of aisle.phrases ?? []) {
            const key = ` ${nameWords(phrase).join(" ")} `;
            if (joined.includes(key) && (!best || key.length > best.length)) {
                best = { aisle, length: key.length };
            }
        }
    }
    if (best) return best.aisle;
    if (words.includes("frozen")) {
        return SECTION_AISLES.find((aisle) => aisle.words.includes("frozen"))!;
    }
    for (const word of words.toReversed()) {
        const aisle = SECTION_AISLES.find((row) => row.words.includes(word));
        if (aisle) return aisle;
    }
    return null;
}

/**
 * Picks a section for a new line when the caller named none. In order: the
 * section this food already sits in at this store, a section with the same
 * name it sits in at another store, a supply's "Household" section, then the
 * aisle its name suggests. Returns null for "Other". Hidden sections and the
 * Other section are never suggested.
 */
export function suggestGrocerySection(input: {
    sections: GrocerySection[];
    lines: GroceryLine[];
    allSections?: GrocerySection[];
    kind: GroceryKind;
    foodId: string | null;
    displayName: string;
}): GrocerySection | null {
    const visible = input.sections.filter((row) => !row.hidden && !row.isOther);
    if (visible.length === 0) return null;
    const name = normalizeFoodName(input.displayName);
    const sameFood = input.lines.filter((line) =>
        input.foodId
            ? line.foodId === input.foodId
            : normalizeFoodName(line.displayName) === name,
    );
    for (const line of sameFood.toReversed()) {
        const here = visible.find((row) => row.id === line.sectionId);
        if (here) return here;
    }
    for (const line of sameFood.toReversed()) {
        const there = input.allSections?.find(
            (row) => row.id === line.sectionId && !row.isOther,
        );
        const match =
            there &&
            visible.find(
                (row) =>
                    normalizeFoodName(row.name) ===
                    normalizeFoodName(there.name),
            );
        if (match) return match;
    }
    if (input.kind === "supply") {
        return (
            visible.find((row) => nameWords(row.name).includes("household")) ??
            null
        );
    }
    const aisle = aisleForName(input.displayName);
    return aisle ? sectionForAisle(visible, aisle) : null;
}

/**
 * The section for a new line: the caller's section when given, else the
 * suggested one, else Other.
 */
export async function placeGroceryLine(
    grocery: GroceryListStore,
    settings: SettingsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        kind: GroceryKind;
        foodId: string | null;
        displayName: string;
    },
): Promise<string> {
    if (input.sectionId) {
        return resolveGrocerySectionId(
            settings,
            input.storeId,
            input.sectionId,
        );
    }
    const stores = await settings.listStores(input.householdId);
    const allSections = (
        await Promise.all(
            stores.map((store) => settings.listSections(store.id)),
        )
    ).flat();
    const suggested = suggestGrocerySection({
        sections: allSections.filter((row) => row.storeId === input.storeId),
        allSections,
        lines: await grocery.listLines(input.householdId),
        kind: input.kind,
        foodId: input.foodId,
        displayName: input.displayName,
    });
    return suggested?.id ?? resolveGrocerySectionId(settings, input.storeId);
}

async function requireStore(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
): Promise<GroceryStore> {
    const stores = await settings.listStores(householdId);
    const store = stores.find((row) => row.id === storeId);
    if (!store) throw new GroceryInputError("Unknown store.");
    return store;
}

export async function listGrocery(
    grocery: GroceryListStore,
    settings: SettingsStore,
    householdId: string,
): Promise<GrocerySnapshot> {
    const stores = await settings.listStores(householdId);
    const sections = (
        await Promise.all(
            stores.map((store) => settings.listSections(store.id)),
        )
    ).flat();
    const lines = await grocery.listLines(householdId);
    return { stores, sections, lines };
}

function wrapFoodsError(err: unknown): never {
    if (err instanceof FoodsInputError) {
        throw new GroceryInputError(err.message);
    }
    throw err;
}

async function insertFromFood(
    grocery: GroceryListStore,
    settings: SettingsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        amount: number;
        unit: string;
        food: Awaited<ReturnType<typeof findFoodById>>;
    },
): Promise<GroceryLine> {
    const sectionId = await placeGroceryLine(grocery, settings, {
        householdId: input.householdId,
        storeId: input.storeId,
        sectionId: input.sectionId,
        kind: input.food.kind,
        foodId: input.food.id,
        displayName: input.food.name,
    });
    return grocery.insertLine({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        storeId: input.storeId,
        sectionId,
        kind: input.food.kind,
        displayName: input.food.name,
        quantity: { amount: input.amount, unit: input.unit },
        identity: catalogIdentity(
            input.food.kind,
            input.food.id,
            input.food.name,
        ),
        foodId: input.food.id,
        checked: false,
    });
}

export async function addGroceryFoodById(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        foodId: string;
        amount: number;
        unit?: string;
    },
): Promise<GroceryLine> {
    await requireStore(settings, input.householdId, input.storeId);
    await resolveGrocerySectionId(settings, input.storeId, input.sectionId);
    const amount = parseAmount(input.amount);
    try {
        const food = await findFoodById(foods, input.householdId, input.foodId);
        if (food.kind !== "food") {
            throw new GroceryInputError("That catalog item is a supply.");
        }
        return insertFromFood(grocery, settings, {
            householdId: input.householdId,
            storeId: input.storeId,
            sectionId: input.sectionId,
            amount,
            unit: storedFoodUnit(input.unit, food),
            food,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addGroceryFoodByBarcode(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        barcode: string;
        amount: number;
        unit?: string;
    },
    opts: {
        lookup: (barcode: string) => Promise<FoodResult | null>;
    },
): Promise<GroceryLine> {
    await requireStore(settings, input.householdId, input.storeId);
    await resolveGrocerySectionId(settings, input.storeId, input.sectionId);
    const amount = parseAmount(input.amount);
    try {
        const food = await findOrCreateFoodByBarcode(
            foods,
            input.householdId,
            input.barcode,
            opts.lookup,
        );
        return insertFromFood(grocery, settings, {
            householdId: input.householdId,
            storeId: input.storeId,
            sectionId: input.sectionId,
            amount,
            unit: storedFoodUnit(input.unit, food),
            food,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addGroceryManualFood(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        name: string;
        amount: number;
        unit?: string;
    },
): Promise<GroceryLine> {
    await requireStore(settings, input.householdId, input.storeId);
    await resolveGrocerySectionId(settings, input.storeId, input.sectionId);
    const amount = parseAmount(input.amount);
    try {
        const food = await findOrCreateManualFood(
            foods,
            input.householdId,
            "food",
            input.name,
        );
        return insertFromFood(grocery, settings, {
            householdId: input.householdId,
            storeId: input.storeId,
            sectionId: input.sectionId,
            amount,
            unit: storedFoodUnit(input.unit, food),
            food,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addGrocerySupply(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        name: string;
        amount: number;
        unit: string;
        foodId?: string;
    },
): Promise<GroceryLine> {
    await requireStore(settings, input.householdId, input.storeId);
    await resolveGrocerySectionId(settings, input.storeId, input.sectionId);
    const unit = input.unit.trim();
    if (!unit) throw new GroceryInputError("Enter a unit.");
    const amount = parseAmount(input.amount);
    try {
        const food = input.foodId
            ? await findFoodById(foods, input.householdId, input.foodId)
            : await findOrCreateManualFood(
                  foods,
                  input.householdId,
                  "supply",
                  input.name,
              );
        if (food.kind !== "supply") {
            throw new GroceryInputError("That catalog item is a food.");
        }
        return insertFromFood(grocery, settings, {
            householdId: input.householdId,
            storeId: input.storeId,
            sectionId: input.sectionId,
            amount,
            unit,
            food,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function checkGroceryLine(
    grocery: GroceryListStore,
    householdId: string,
    lineId: string,
    checked: boolean,
): Promise<GroceryLine | null> {
    const lines = await grocery.listLines(householdId);
    const current = lines.find((line) => line.id === lineId);
    if (!current) return null;
    return grocery.updateLine({ ...current, checked });
}

export async function clearCheckedLines(
    grocery: GroceryListStore,
    householdId: string,
): Promise<number> {
    const lines = await grocery.listLines(householdId);
    let removed = 0;
    for (const line of lines) {
        if (!line.checked) continue;
        if (await grocery.deleteLine(householdId, line.id)) removed += 1;
    }
    return removed;
}

function allergenNeedle(
    code: AllergenCode,
    otherLabel: string | null,
): string[] {
    if (code === "other") {
        return otherLabel ? [otherLabel.toLowerCase()] : [];
    }
    return [code.replaceAll("_", " "), ALLERGEN_LABELS[code].toLowerCase()];
}

export function groceryAllergenWarning(
    displayName: string,
    members: GroceryAllergenMember[],
    foodAllergens?: readonly string[] | null,
): GroceryAllergenWarning | null {
    if (foodAllergens != null) {
        const hay = new Set(
            foodAllergens.map((code) => code.trim().toLowerCase()),
        );
        const hitNames: string[] = [];
        const hitCodes = new Set<string>();
        for (const member of members) {
            const matched = member.allergens.filter((row) => {
                if (row.allergen === "other") {
                    const label = row.otherLabel?.trim().toLowerCase();
                    return (
                        hay.has("other") ||
                        (label
                            ? displayName.toLowerCase().includes(label)
                            : false)
                    );
                }
                return hay.has(row.allergen);
            });
            if (matched.length === 0) continue;
            hitNames.push(member.displayName);
            for (const row of matched) {
                hitCodes.add(
                    row.allergen === "other"
                        ? (row.otherLabel ?? "allergen")
                        : ALLERGEN_LABELS[row.allergen].toLowerCase(),
                );
            }
        }
        if (hitNames.length === 0) return null;
        const label = [...hitCodes][0] ?? "allergen";
        return {
            blocking: true,
            text: `Contains ${label} — ${hitNames.join(", ")}.`,
        };
    }
    const haystack = displayName.toLowerCase();
    const hitNames: string[] = [];
    const hitCodes = new Set<string>();
    for (const member of members) {
        const matched = member.allergens.some((row) =>
            allergenNeedle(row.allergen, row.otherLabel).some((needle) =>
                needle ? haystack.includes(needle) : false,
            ),
        );
        if (!matched) continue;
        hitNames.push(member.displayName);
        for (const row of member.allergens) {
            for (const needle of allergenNeedle(row.allergen, row.otherLabel)) {
                if (needle && haystack.includes(needle)) hitCodes.add(needle);
            }
        }
    }
    if (hitNames.length === 0) {
        const anyAllergen = members.some((row) => row.allergens.length > 0);
        if (!anyAllergen) return null;
        return { blocking: false, text: "unknown allergen data" };
    }
    const label = [...hitCodes][0] ?? "allergen";
    return {
        blocking: true,
        text: `Contains ${label} — ${hitNames.join(", ")}.`,
    };
}

export function groceryLineFromRow(row: {
    id: unknown;
    household_id: unknown;
    store_id: unknown;
    section_id: unknown;
    kind: unknown;
    display_name: unknown;
    amount: unknown;
    unit: unknown;
    checked: unknown;
    food_id?: unknown;
}): GroceryLine {
    const kind = row.kind === "supply" ? "supply" : "food";
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        storeId: String(row.store_id),
        sectionId: String(row.section_id),
        kind,
        displayName: String(row.display_name),
        quantity: {
            amount: Number(row.amount),
            unit: String(row.unit),
        },
        // The identity column is no longer read; Phase 8 drops it.
        identity: catalogIdentity(
            kind,
            String(row.food_id),
            String(row.display_name),
        ),
        foodId:
            row.food_id == null || row.food_id === ""
                ? null
                : String(row.food_id),
        checked: Boolean(row.checked),
    };
}

export function groceryLineToRow(row: GroceryLine) {
    return {
        id: row.id,
        household_id: row.householdId,
        store_id: row.storeId,
        section_id: row.sectionId,
        kind: row.kind,
        display_name: row.displayName,
        amount: row.quantity.amount,
        unit: row.quantity.unit,
        food_id: row.foodId,
        checked: row.checked,
    };
}
