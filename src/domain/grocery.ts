import type { FoodResult } from "../foods.js";
import {
    effectiveFoodsByIds,
    familyOf,
    findFoodById,
    findOrCreateFoodByBarcode,
    findManualFood,
    findOrCreateManualFood,
    FoodsInputError,
    markUsualRestocked,
    type OnSimilar,
    normalizeFoodName,
    type Food,
    type FoodsStore,
    type UsualAmount,
} from "./foods.js";
import { placeholderAmountUnit, storedFoodUnit } from "./food-quantity.js";
import type {
    GroceryPreferences,
    GrocerySection,
    GroceryStore,
    SettingsStore,
} from "./settings.js";
import {
    ALLERGEN_LABELS,
    type AllergenCode,
    type MemberAllergen,
} from "./rules.js";
import type { Notice } from "./notices.js";
import { NOTICE_SEVERITY } from "./notices.js";
import { noticeSentence, UNKNOWN_ALLERGEN_TEXT } from "../copy/notices.js";
import type { FridgeItem, FridgeStore } from "./fridge.js";
import { canonicalUnitText, isQuantityUnit } from "./quantity.js";
import {
    cleanupDismissalsForSubject,
    type MemoryNoticeDismissalsHolder,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";

export const GROCERY_LINE_SOURCES = [
    "manual",
    "recipe",
    "restock",
    "notice",
    "plan",
] as const;
export type GroceryLineSource = (typeof GROCERY_LINE_SOURCES)[number];

export type GroceryKind = "food" | "supply";

export type GroceryQuantity = { amount: number; unit: string };

/**
 * `preferred` is the household's saved default store; `default` is the
 * first-store fallback when nothing else decided.
 */
export type GroceryStorePickReason =
    "chosen" | "usual" | "list" | "preferred" | "default";
export type GroceryAmountPickReason = "chosen" | "usual" | "default";

export type GroceryLine = {
    id: string;
    householdId: string;
    storeId: string;
    sectionId: string;
    kind: GroceryKind;
    displayName: string;
    quantity: GroceryQuantity;
    foodId: string | null;
    checked: boolean;
    source: GroceryLineSource;
    sourceFridgeItemId: string | null;
    note: string | null;
};

export type GrocerySnapshot = {
    stores: GroceryStore[];
    sections: GrocerySection[];
    lines: GroceryLine[];
};

/** A food's family and every catalog food in it: what "already on the list" matches on. */
export type GroceryFamily = { familyId: string; foodIds: readonly string[] };

/** The family of `food` among `catalog`, always including `food` itself. */
export function groceryFamilyOf(
    food: Pick<Food, "id" | "genericFoodId">,
    catalog: readonly Pick<Food, "id" | "genericFoodId">[],
): GroceryFamily {
    const familyId = familyOf(food);
    const foodIds = catalog
        .filter((candidate) => familyOf(candidate) === familyId)
        .map((candidate) => candidate.id);
    if (!foodIds.includes(food.id)) foodIds.push(food.id);
    return { familyId, foodIds };
}

export type GroceryListStore = {
    listLines(householdId: string): Promise<GroceryLine[]>;
    insertLine(row: GroceryLine): Promise<GroceryLine>;
    /**
     * Inserts `row` unless the same store already has an unticked line for one
     * of the family's foods, and returns that line instead (`existed`). The
     * live store serialises concurrent calls for one family and store, so two
     * adds at once still leave one line.
     */
    insertLineUnlessListed(
        row: GroceryLine,
        family: GroceryFamily,
    ): Promise<{ line: GroceryLine; existed: boolean }>;
    updateLine(row: GroceryLine): Promise<GroceryLine | null>;
    deleteLine(householdId: string, id: string): Promise<boolean>;
};

export type GroceryAllergenMember = {
    displayName: string;
    userId?: string;
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

type MemoryGroceryLine = GroceryLine & { createdAt: string };

// createdAt only orders the memory list, like the live store's
// `order by created_at`; it is not part of GroceryLine, so it never leaves.
function publicLine({
    createdAt: _createdAt,
    ...row
}: MemoryGroceryLine): GroceryLine {
    return { ...row, quantity: { ...row.quantity } };
}

export type MemoryGroceryListStore = GroceryListStore &
    MemoryNoticeDismissalsHolder;

export function createMemoryGroceryStore(): MemoryGroceryListStore {
    const lines: MemoryGroceryLine[] = [];
    let linkedDismissals: NoticeDismissalsStore | undefined;
    const store: MemoryGroceryListStore & {
        __paritySetLineCreatedAt(id: string, createdAt: string): void;
    } = {
        linkDismissals(s) {
            linkedDismissals = s;
        },
        dismissalsStore() {
            return linkedDismissals;
        },
        async listLines(householdId) {
            return lines
                .filter((row) => row.householdId === householdId)
                .slice()
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map(publicLine);
        },
        async insertLine(row) {
            const saved: MemoryGroceryLine = {
                ...row,
                quantity: { ...row.quantity },
                createdAt: new Date().toISOString(),
            };
            lines.push(saved);
            return publicLine(saved);
        },
        async insertLineUnlessListed(row, family) {
            // No await between the check and the push, so two calls cannot
            // both miss the other's line.
            const existing = lines
                .filter(
                    (line) =>
                        line.householdId === row.householdId &&
                        line.storeId === row.storeId &&
                        !line.checked &&
                        line.foodId != null &&
                        family.foodIds.includes(line.foodId),
                )
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
            if (existing) return { line: publicLine(existing), existed: true };
            return { line: await store.insertLine(row), existed: false };
        },
        async updateLine(row) {
            const idx = lines.findIndex(
                (line) =>
                    line.id === row.id && line.householdId === row.householdId,
            );
            if (idx < 0) return null;
            lines[idx] = {
                ...row,
                quantity: { ...row.quantity },
                createdAt: lines[idx]!.createdAt,
            };
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
            if (removed) {
                await cleanupDismissalsForSubject(
                    linkedDismissals,
                    householdId,
                    "grocery_line",
                    id,
                );
            }
            return removed;
        },
        __paritySetLineCreatedAt(id, createdAt) {
            const row = lines.find((line) => line.id === id);
            if (row) row.createdAt = createdAt;
        },
    };
    return store;
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
function familyFromMap(
    foodId: string | null,
    familyById: ReadonlyMap<string, string> | undefined,
): string | null {
    if (!foodId) return null;
    return familyById?.get(foodId) ?? foodId;
}

export function suggestGrocerySection(input: {
    sections: GrocerySection[];
    lines: GroceryLine[];
    allSections?: GrocerySection[];
    kind: GroceryKind;
    foodId: string | null;
    displayName: string;
    familyById?: ReadonlyMap<string, string>;
}): GrocerySection | null {
    const visible = input.sections.filter((row) => !row.hidden && !row.isOther);
    if (visible.length === 0) return null;
    const name = normalizeFoodName(input.displayName);
    const inputFamily = familyFromMap(input.foodId, input.familyById);
    const sameFood = input.lines.filter((line) =>
        input.foodId
            ? familyFromMap(line.foodId, input.familyById) === inputFamily
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
    foods?: FoodsStore,
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
    let familyById: Map<string, string> | undefined;
    if (foods) {
        const listed = await foods.listFoods(input.householdId);
        familyById = new Map(listed.map((row) => [row.id, familyOf(row)]));
    }
    const suggested = suggestGrocerySection({
        sections: allSections.filter((row) => row.storeId === input.storeId),
        allSections,
        lines: await grocery.listLines(input.householdId),
        kind: input.kind,
        foodId: input.foodId,
        displayName: input.displayName,
        familyById,
    });
    return suggested?.id ?? resolveGrocerySectionId(settings, input.storeId);
}

export function pickGroceryStore(input: {
    chosenStoreId?: string | null;
    usualStoreId: string | null;
    stores: GroceryStore[];
    lines: GroceryLine[];
    foodId: string | null;
    familyById?: ReadonlyMap<string, string>;
    /**
     * Household preferences. A saved default store always beats the first-store
     * fallback; with `useUsualStore: true` it also beats the list history,
     * coming right after the food's usual store. With no default store saved,
     * the pick is what it always was.
     */
    prefs?: GroceryPreferences;
}): { storeId: string; reason: GroceryStorePickReason } {
    const chosen = input.chosenStoreId?.trim();
    if (chosen) {
        return { storeId: chosen, reason: "chosen" };
    }
    const idSet = new Set(input.stores.map((s) => s.id));
    const usual = input.usualStoreId;
    if (usual && idSet.has(usual)) {
        return { storeId: usual, reason: "usual" };
    }
    const savedDefault = input.prefs?.defaultStoreId ?? null;
    const preferred =
        savedDefault && idSet.has(savedDefault) ? savedDefault : null;
    if (preferred && input.prefs?.useUsualStore) {
        return { storeId: preferred, reason: "preferred" };
    }
    if (input.foodId) {
        const fam = familyFromMap(input.foodId, input.familyById);
        for (let i = input.lines.length - 1; i >= 0; i--) {
            const line = input.lines[i]!;
            if (!line.foodId) continue;
            if (familyFromMap(line.foodId, input.familyById) !== fam) continue;
            if (idSet.has(line.storeId)) {
                return { storeId: line.storeId, reason: "list" };
            }
        }
    }
    if (preferred) {
        return { storeId: preferred, reason: "preferred" };
    }
    if (input.stores.length === 0) {
        throw new GroceryInputError("Add a store first.");
    }
    return { storeId: input.stores[0]!.id, reason: "default" };
}

export function pickGroceryAmount(input: {
    amount?: number | null;
    unit?: string;
    usual: UsualAmount | null;
    food: { defaultUnit: string };
}): { quantity: GroceryQuantity; reason: GroceryAmountPickReason } {
    /** Any non-nullish amount is "chosen"; non-finite values fail in parseAmount. */
    const hasChosen = input.amount !== null && input.amount !== undefined;
    if (hasChosen) {
        return {
            quantity: {
                amount: parseAmount(input.amount as number),
                unit: storedFoodUnit(input.unit, input.food),
            },
            reason: "chosen",
        };
    }
    const usual = input.usual;
    const givenUnit = canonicalUnitText(input.unit ?? "");
    if (usual != null && (!givenUnit || givenUnit === usual.unit)) {
        return {
            quantity: { amount: usual.amount, unit: usual.unit },
            reason: "usual",
        };
    }
    // No amount from the caller and no usual one: "1 of it". The unit the
    // caller named stays; otherwise the food's own, except that 1 g or 1 ml is
    // never a shopping amount (see placeholderAmountUnit).
    return {
        quantity: {
            amount: 1,
            unit: givenUnit || placeholderAmountUnit(input.food),
        },
        reason: "default",
    };
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

/** Only `undefined` / `null` means "pick a store"; whitespace still counts as an explicit (possibly invalid) id. */
function explicitStoreId(
    storeId: string | null | undefined,
): string | undefined {
    if (storeId === undefined || storeId === null) return undefined;
    return String(storeId).trim();
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

function parseGroceryLineSource(raw: unknown): GroceryLineSource {
    if (raw == null) return "manual";
    const value = String(raw);
    if ((GROCERY_LINE_SOURCES as readonly string[]).includes(value)) {
        return value as GroceryLineSource;
    }
    throw new Error(`Invalid grocery line source: ${value}`);
}

export async function resolveGroceryLineSource(
    fridge: Pick<FridgeStore, "listItems"> | undefined,
    householdId: string,
    input: {
        source?: GroceryLineSource;
        sourceFridgeItemId?: string | null;
    },
): Promise<{ source: GroceryLineSource; sourceFridgeItemId: string | null }> {
    let source: GroceryLineSource = "manual";
    if (input.source !== undefined) {
        if (
            !(GROCERY_LINE_SOURCES as readonly string[]).includes(input.source)
        ) {
            throw new GroceryInputError("Unknown grocery line source.");
        }
        source = input.source;
    }

    let sourceFridgeItemId: string | null = null;
    const rawId = input.sourceFridgeItemId;
    if (rawId != null && String(rawId).trim() !== "") {
        sourceFridgeItemId = String(rawId).trim();
    }

    if (sourceFridgeItemId) {
        if (source === "manual" || source === "recipe" || source === "plan") {
            throw new GroceryInputError(
                "A fridge item can only be named for a restock or notice line.",
            );
        }
        if (!fridge) {
            throw new GroceryInputError(
                "A fridge item id requires a fridge store to verify.",
            );
        }
        const items = await fridge.listItems(householdId);
        if (!items.some((row) => row.id === sourceFridgeItemId)) {
            throw new GroceryInputError("Unknown fridge item.");
        }
    }

    return { source, sourceFridgeItemId };
}

/** What an add reports when the line it asked for was already on the list. */
type ReuseListed = {
    /** Called with the existing line instead of a new one being inserted. */
    onReused?: (line: GroceryLine) => void;
};

/**
 * Whether an add folds into an unticked line the store already has for the
 * food: always for a restock line, and whenever the caller asks.
 */
function reuseFor(input: {
    reuseListed?: boolean;
    source?: GroceryLineSource;
}): boolean {
    return input.reuseListed ?? input.source === "restock";
}

async function insertFromFood(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        storeId: string;
        sectionId?: string;
        amount: number;
        unit: string;
        food: Awaited<ReturnType<typeof findFoodById>>;
        source: GroceryLineSource;
        sourceFridgeItemId: string | null;
        /** Same rule the restock runner uses: an unticked line in the food's family counts as already listed. */
        reuseListed?: boolean;
    } & ReuseListed,
): Promise<GroceryLine> {
    const sectionId = await placeGroceryLine(
        grocery,
        settings,
        {
            householdId: input.householdId,
            storeId: input.storeId,
            sectionId: input.sectionId,
            kind: input.food.kind,
            foodId: input.food.id,
            displayName: input.food.name,
        },
        foods,
    );
    const row: GroceryLine = {
        id: crypto.randomUUID(),
        householdId: input.householdId,
        storeId: input.storeId,
        sectionId,
        kind: input.food.kind,
        displayName: input.food.name,
        quantity: { amount: input.amount, unit: input.unit },
        foodId: input.food.id,
        checked: false,
        source: input.source,
        sourceFridgeItemId: input.sourceFridgeItemId,
        note: null,
    };
    if (!input.reuseListed) return grocery.insertLine(row);
    const catalog = await foods.listFoods(input.householdId);
    const { line, existed } = await grocery.insertLineUnlessListed(
        row,
        groceryFamilyOf(input.food, catalog),
    );
    if (existed) input.onReused?.(line);
    return line;
}

type GroceryPickCallback = (pick: {
    storeId: string;
    storeReason: GroceryStorePickReason;
    quantity: GroceryQuantity;
    amountReason: GroceryAmountPickReason;
}) => void;

/**
 * A line with no store picks one, and that needs at least one store. Checked
 * before the food is found or created, so a household with no stores never
 * gets a new catalog row from a line that cannot be placed.
 */
async function requireAnyStore(
    settings: SettingsStore,
    householdId: string,
): Promise<void> {
    const stores = await settings.listStores(householdId);
    if (stores.length === 0) {
        throw new GroceryInputError("Add a store first.");
    }
}

function groceryLineFamily(
    line: Pick<GroceryLine, "foodId">,
    foodsById: ReadonlyMap<string, Pick<Food, "id" | "genericFoodId">>,
): string | null {
    if (!line.foodId) return null;
    const row = foodsById.get(line.foodId);
    return row ? familyOf(row) : line.foodId;
}

export function onGroceryList(
    item: Pick<FridgeItem, "foodId">,
    lines: readonly Pick<GroceryLine, "foodId" | "checked">[],
    foodsById: ReadonlyMap<string, Pick<Food, "id" | "genericFoodId">>,
): boolean {
    if (!item.foodId) return false;
    const row = foodsById.get(item.foodId);
    const itemFamily = row ? familyOf(row) : item.foodId;
    for (const line of lines) {
        if (line.checked) continue;
        const lineFamily = groceryLineFamily(line, foodsById);
        if (lineFamily === itemFamily) return true;
    }
    return false;
}

function firstUncheckedFamilyLine(
    itemFamily: string,
    lines: readonly GroceryLine[],
    foodsById: ReadonlyMap<string, Pick<Food, "id" | "genericFoodId">>,
): GroceryLine | null {
    for (const line of lines) {
        if (line.checked) continue;
        const lineFamily = groceryLineFamily(line, foodsById);
        if (lineFamily === itemFamily) return line;
    }
    return null;
}

export async function addFridgeItemToGrocery(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    fridge: FridgeStore,
    input: {
        householdId: string;
        itemId: string;
        onPicked?: GroceryPickCallback;
    },
): Promise<{ added: boolean; line: GroceryLine }> {
    const items = await fridge.listItems(input.householdId);
    const item = items.find((row) => row.id === input.itemId);
    if (!item) {
        throw new GroceryInputError("That item is no longer in the fridge.");
    }
    if (item.kind !== "food" || item.foodId == null) {
        throw new GroceryInputError(
            "Only food can be added to the grocery list from here.",
        );
    }
    const food = await findFoodById(foods, input.householdId, item.foodId);
    const plainId = familyOf(food);
    const lines = await grocery.listLines(input.householdId);
    const listed = await foods.listFoods(input.householdId);
    const foodsById = new Map(
        listed.map((row) => [
            row.id,
            { id: row.id, genericFoodId: row.genericFoodId },
        ]),
    );
    const itemFamily = familyOf(food);
    if (onGroceryList(item, lines, foodsById)) {
        const existing = firstUncheckedFamilyLine(itemFamily, lines, foodsById);
        if (existing) return { added: false, line: existing };
    }
    const effMap = await effectiveFoodsByIds(foods, input.householdId, [
        plainId,
    ]);
    const plain = effMap.get(plainId)!;
    const base = {
        householdId: input.householdId,
        foodId: plainId,
        source: "notice" as const,
        sourceFridgeItemId: item.id,
        fridge,
        onPicked: input.onPicked,
    };
    if (plain.usualAmount != null) {
        const line = await addGroceryFoodById(grocery, settings, foods, base);
        return { added: true, line };
    }
    const { amount, unit } = item.quantity;
    if (isQuantityUnit(unit)) {
        const line = await addGroceryFoodById(grocery, settings, foods, {
            ...base,
            amount,
            unit,
        });
        return { added: true, line };
    }
    const line = await addGroceryFoodById(grocery, settings, foods, base);
    return { added: true, line };
}

export async function addGroceryFoodById(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        storeId?: string;
        sectionId?: string;
        foodId: string;
        amount?: number | null;
        unit?: string;
        onPicked?: GroceryPickCallback;
        source?: GroceryLineSource;
        sourceFridgeItemId?: string | null;
        /** Fold into an unticked line the store already has for the food. Default: only for restock lines. */
        reuseListed?: boolean;
        /** Called with the existing line when the add folded into it. */
        onReused?: (line: GroceryLine) => void;
        fridge?: Pick<FridgeStore, "listItems">;
    },
): Promise<GroceryLine> {
    const explicit = explicitStoreId(input.storeId);
    const hasExplicitStore = explicit !== undefined;
    const hasExplicitAmount =
        input.amount !== undefined && input.amount !== null;

    if (hasExplicitStore) {
        await requireStore(settings, input.householdId, explicit!);
        await resolveGrocerySectionId(settings, explicit!, input.sectionId);
    } else {
        await requireAnyStore(settings, input.householdId);
    }
    if (hasExplicitAmount) {
        parseAmount(Number(input.amount));
    }
    const lineSource = await resolveGroceryLineSource(
        input.fridge,
        input.householdId,
        {
            source: input.source,
            sourceFridgeItemId: input.sourceFridgeItemId,
        },
    );

    try {
        const food = await findFoodById(foods, input.householdId, input.foodId);
        if (food.kind !== "food") {
            throw new GroceryInputError("That catalog item is a supply.");
        }

        let storeId: string;
        let storeReason: GroceryStorePickReason;
        let quantity: GroceryQuantity;
        let amountReason: GroceryAmountPickReason;

        if (explicit !== undefined && hasExplicitAmount) {
            storeId = explicit!;
            storeReason = "chosen";
            const picked = pickGroceryAmount({
                amount: input.amount,
                unit: input.unit,
                usual: null,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        } else {
            const stores = await settings.listStores(input.householdId);
            const lines = await grocery.listLines(input.householdId);
            const listed = await foods.listFoods(input.householdId);
            const familyById = new Map(
                listed.map((row) => [row.id, familyOf(row)]),
            );
            const effMap = await effectiveFoodsByIds(foods, input.householdId, [
                food.id,
            ]);
            const eff = effMap.get(food.id)!;

            if (explicit !== undefined) {
                storeId = explicit!;
                storeReason = "chosen";
            } else {
                const p = pickGroceryStore({
                    chosenStoreId: null,
                    usualStoreId: eff.usualStoreId,
                    stores,
                    lines,
                    foodId: food.id,
                    familyById,
                    prefs: await settings.getGroceryPreferences(
                        input.householdId,
                    ),
                });
                storeId = p.storeId;
                storeReason = p.reason;
                await requireStore(settings, input.householdId, storeId);
            }
            await resolveGrocerySectionId(settings, storeId, input.sectionId);
            const picked = pickGroceryAmount({
                amount: hasExplicitAmount ? input.amount : undefined,
                unit: input.unit,
                usual: eff.usualAmount,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        }

        input.onPicked?.({
            storeId,
            storeReason,
            quantity,
            amountReason,
        });

        return insertFromFood(grocery, settings, foods, {
            householdId: input.householdId,
            storeId,
            sectionId: input.sectionId,
            amount: quantity.amount,
            unit: quantity.unit,
            food,
            source: lineSource.source,
            sourceFridgeItemId: lineSource.sourceFridgeItemId,
            reuseListed: reuseFor({
                reuseListed: input.reuseListed,
                source: lineSource.source,
            }),
            onReused: input.onReused,
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
        storeId?: string;
        sectionId?: string;
        barcode: string;
        amount?: number | null;
        unit?: string;
        onPicked?: GroceryPickCallback;
        source?: GroceryLineSource;
        sourceFridgeItemId?: string | null;
        /** Fold into an unticked line the store already has for the food. Default: only for restock lines. */
        reuseListed?: boolean;
        /** Called with the existing line when the add folded into it. */
        onReused?: (line: GroceryLine) => void;
        fridge?: Pick<FridgeStore, "listItems">;
    },
    opts: {
        lookup: (barcode: string) => Promise<FoodResult | null>;
    },
): Promise<GroceryLine> {
    const explicit = explicitStoreId(input.storeId);
    const hasExplicitStore = explicit !== undefined;
    const hasExplicitAmount =
        input.amount !== undefined && input.amount !== null;

    if (hasExplicitStore) {
        await requireStore(settings, input.householdId, explicit!);
        await resolveGrocerySectionId(settings, explicit!, input.sectionId);
    } else {
        await requireAnyStore(settings, input.householdId);
    }
    if (hasExplicitAmount) {
        parseAmount(Number(input.amount));
    }
    const lineSource = await resolveGroceryLineSource(
        input.fridge,
        input.householdId,
        {
            source: input.source,
            sourceFridgeItemId: input.sourceFridgeItemId,
        },
    );

    try {
        const food = await findOrCreateFoodByBarcode(
            foods,
            input.householdId,
            input.barcode,
            opts.lookup,
        );

        let storeId: string;
        let storeReason: GroceryStorePickReason;
        let quantity: GroceryQuantity;
        let amountReason: GroceryAmountPickReason;

        if (explicit !== undefined && hasExplicitAmount) {
            storeId = explicit!;
            storeReason = "chosen";
            const picked = pickGroceryAmount({
                amount: input.amount,
                unit: input.unit,
                usual: null,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        } else {
            const stores = await settings.listStores(input.householdId);
            const lines = await grocery.listLines(input.householdId);
            const listed = await foods.listFoods(input.householdId);
            const familyById = new Map(
                listed.map((row) => [row.id, familyOf(row)]),
            );
            const effMap = await effectiveFoodsByIds(foods, input.householdId, [
                food.id,
            ]);
            const eff = effMap.get(food.id)!;

            if (explicit !== undefined) {
                storeId = explicit!;
                storeReason = "chosen";
            } else {
                const p = pickGroceryStore({
                    chosenStoreId: null,
                    usualStoreId: eff.usualStoreId,
                    stores,
                    lines,
                    foodId: food.id,
                    familyById,
                    prefs: await settings.getGroceryPreferences(
                        input.householdId,
                    ),
                });
                storeId = p.storeId;
                storeReason = p.reason;
                await requireStore(settings, input.householdId, storeId);
            }
            await resolveGrocerySectionId(settings, storeId, input.sectionId);
            const picked = pickGroceryAmount({
                amount: hasExplicitAmount ? input.amount : undefined,
                unit: input.unit,
                usual: eff.usualAmount,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        }

        input.onPicked?.({
            storeId,
            storeReason,
            quantity,
            amountReason,
        });

        return insertFromFood(grocery, settings, foods, {
            householdId: input.householdId,
            storeId,
            sectionId: input.sectionId,
            amount: quantity.amount,
            unit: quantity.unit,
            food,
            source: lineSource.source,
            sourceFridgeItemId: lineSource.sourceFridgeItemId,
            reuseListed: reuseFor({
                reuseListed: input.reuseListed,
                source: lineSource.source,
            }),
            onReused: input.onReused,
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
        storeId?: string;
        sectionId?: string;
        name: string;
        amount?: number | null;
        unit?: string;
        onPicked?: GroceryPickCallback;
        source?: GroceryLineSource;
        sourceFridgeItemId?: string | null;
        /** Fold into an unticked line the store already has for the food. Default: only for restock lines. */
        reuseListed?: boolean;
        /** Called with the existing line when the add folded into it. */
        onReused?: (line: GroceryLine) => void;
        fridge?: Pick<FridgeStore, "listItems">;
        onSimilar?: OnSimilar;
    },
): Promise<GroceryLine> {
    const explicit = explicitStoreId(input.storeId);
    const hasExplicitStore = explicit !== undefined;
    const hasExplicitAmount =
        input.amount !== undefined && input.amount !== null;

    if (hasExplicitStore) {
        await requireStore(settings, input.householdId, explicit!);
        await resolveGrocerySectionId(settings, explicit!, input.sectionId);
    } else {
        await requireAnyStore(settings, input.householdId);
    }
    if (hasExplicitAmount) {
        parseAmount(Number(input.amount));
    }
    const lineSource = await resolveGroceryLineSource(
        input.fridge,
        input.householdId,
        {
            source: input.source,
            sourceFridgeItemId: input.sourceFridgeItemId,
        },
    );

    try {
        const food = await findOrCreateManualFood(
            foods,
            input.householdId,
            "food",
            input.name,
            { onSimilar: input.onSimilar },
        );

        let storeId: string;
        let storeReason: GroceryStorePickReason;
        let quantity: GroceryQuantity;
        let amountReason: GroceryAmountPickReason;

        if (explicit !== undefined && hasExplicitAmount) {
            storeId = explicit!;
            storeReason = "chosen";
            const picked = pickGroceryAmount({
                amount: input.amount,
                unit: input.unit,
                usual: null,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        } else {
            const stores = await settings.listStores(input.householdId);
            const lines = await grocery.listLines(input.householdId);
            const listed = await foods.listFoods(input.householdId);
            const familyById = new Map(
                listed.map((row) => [row.id, familyOf(row)]),
            );
            const effMap = await effectiveFoodsByIds(foods, input.householdId, [
                food.id,
            ]);
            const eff = effMap.get(food.id)!;

            if (explicit !== undefined) {
                storeId = explicit!;
                storeReason = "chosen";
            } else {
                const p = pickGroceryStore({
                    chosenStoreId: null,
                    usualStoreId: eff.usualStoreId,
                    stores,
                    lines,
                    foodId: food.id,
                    familyById,
                    prefs: await settings.getGroceryPreferences(
                        input.householdId,
                    ),
                });
                storeId = p.storeId;
                storeReason = p.reason;
                await requireStore(settings, input.householdId, storeId);
            }
            await resolveGrocerySectionId(settings, storeId, input.sectionId);
            const picked = pickGroceryAmount({
                amount: hasExplicitAmount ? input.amount : undefined,
                unit: input.unit,
                usual: eff.usualAmount,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        }

        input.onPicked?.({
            storeId,
            storeReason,
            quantity,
            amountReason,
        });

        return insertFromFood(grocery, settings, foods, {
            householdId: input.householdId,
            storeId,
            sectionId: input.sectionId,
            amount: quantity.amount,
            unit: quantity.unit,
            food,
            source: lineSource.source,
            sourceFridgeItemId: lineSource.sourceFridgeItemId,
            reuseListed: reuseFor({
                reuseListed: input.reuseListed,
                source: lineSource.source,
            }),
            onReused: input.onReused,
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
        storeId?: string;
        sectionId?: string;
        name: string;
        amount?: number | null;
        unit?: string;
        foodId?: string;
        onPicked?: GroceryPickCallback;
        source?: GroceryLineSource;
        sourceFridgeItemId?: string | null;
        /** Fold into an unticked line the store already has for the food. Default: only for restock lines. */
        reuseListed?: boolean;
        /** Called with the existing line when the add folded into it. */
        onReused?: (line: GroceryLine) => void;
        fridge?: Pick<FridgeStore, "listItems">;
        onSimilar?: OnSimilar;
    },
): Promise<GroceryLine> {
    const explicit = explicitStoreId(input.storeId);
    const hasExplicitStore = explicit !== undefined;
    const hasExplicitAmount =
        input.amount !== undefined && input.amount !== null;

    if (hasExplicitStore) {
        await requireStore(settings, input.householdId, explicit!);
        await resolveGrocerySectionId(settings, explicit!, input.sectionId);
    } else {
        await requireAnyStore(settings, input.householdId);
    }
    const lineSource = await resolveGroceryLineSource(
        input.fridge,
        input.householdId,
        {
            source: input.source,
            sourceFridgeItemId: input.sourceFridgeItemId,
        },
    );
    if (hasExplicitAmount) {
        const u = input.unit?.trim() ?? "";
        if (!u) throw new GroceryInputError("Enter a unit.");
        parseAmount(Number(input.amount));
    } else if (!input.unit?.trim()) {
        // No amount and no unit: only an existing supply's usual pair can
        // supply them. A name that is not in the catalog yet has none, so
        // refuse before findOrCreateManualFood would insert it.
        const existing = input.foodId
            ? await foods.getFood(input.householdId, input.foodId)
            : await findManualFood(
                  foods,
                  input.householdId,
                  "supply",
                  input.name,
              );
        if (!existing) throw new GroceryInputError("Enter a unit.");
    }

    try {
        const food = input.foodId
            ? await findFoodById(foods, input.householdId, input.foodId)
            : await findOrCreateManualFood(
                  foods,
                  input.householdId,
                  "supply",
                  input.name,
                  { onSimilar: input.onSimilar },
              );
        if (food.kind !== "supply") {
            throw new GroceryInputError("That catalog item is a food.");
        }

        let storeId: string;
        let storeReason: GroceryStorePickReason;
        let quantity: GroceryQuantity;
        let amountReason: GroceryAmountPickReason;

        if (explicit !== undefined && hasExplicitAmount) {
            storeId = explicit!;
            storeReason = "chosen";
            const picked = pickGroceryAmount({
                amount: input.amount,
                unit: input.unit,
                usual: null,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
        } else {
            const stores = await settings.listStores(input.householdId);
            const lines = await grocery.listLines(input.householdId);
            const listed = await foods.listFoods(input.householdId);
            const familyById = new Map(
                listed.map((row) => [row.id, familyOf(row)]),
            );
            const effMap = await effectiveFoodsByIds(foods, input.householdId, [
                food.id,
            ]);
            const eff = effMap.get(food.id)!;

            if (explicit !== undefined) {
                storeId = explicit!;
                storeReason = "chosen";
            } else {
                const p = pickGroceryStore({
                    chosenStoreId: null,
                    usualStoreId: eff.usualStoreId,
                    stores,
                    lines,
                    foodId: food.id,
                    familyById,
                    prefs: await settings.getGroceryPreferences(
                        input.householdId,
                    ),
                });
                storeId = p.storeId;
                storeReason = p.reason;
                await requireStore(settings, input.householdId, storeId);
            }
            await resolveGrocerySectionId(settings, storeId, input.sectionId);
            const picked = pickGroceryAmount({
                amount: hasExplicitAmount ? input.amount : undefined,
                unit: input.unit,
                usual: eff.usualAmount,
                food,
            });
            quantity = picked.quantity;
            amountReason = picked.reason;
            const givenUnit = canonicalUnitText(input.unit ?? "");
            const usual = eff.usualAmount;
            const usualSuppliesUnit =
                usual != null && (!givenUnit || givenUnit === usual.unit);
            if (!hasExplicitAmount && !usualSuppliesUnit && givenUnit === "") {
                throw new GroceryInputError("Enter a unit.");
            }
        }

        input.onPicked?.({
            storeId,
            storeReason,
            quantity,
            amountReason,
        });

        return insertFromFood(grocery, settings, foods, {
            householdId: input.householdId,
            storeId,
            sectionId: input.sectionId,
            amount: quantity.amount,
            unit: quantity.unit,
            food,
            source: lineSource.source,
            sourceFridgeItemId: lineSource.sourceFridgeItemId,
            reuseListed: reuseFor({
                reuseListed: input.reuseListed,
                source: lineSource.source,
            }),
            onReused: input.onReused,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

/**
 * Ticks a line off or back on. Ticking a food-backed line off stamps the day
 * its usual was last restocked when `restocked` names the foods store and the
 * household-local day (`YYYY-MM-DD`); unticking never touches the stamp.
 *
 * A failed stamp never undoes the tick: it is logged, and only delays the next
 * schedule.
 */
export async function checkGroceryLine(
    grocery: GroceryListStore,
    householdId: string,
    lineId: string,
    checked: boolean,
    restocked?: {
        foods: FoodsStore;
        today: string;
    },
): Promise<GroceryLine | null> {
    const lines = await grocery.listLines(householdId);
    const current = lines.find((line) => line.id === lineId);
    if (!current) return null;
    const updated = await grocery.updateLine({ ...current, checked });
    if (checked && restocked && current.foodId) {
        // The tick is saved; a failed stamp only delays the next schedule.
        const foodId = current.foodId;
        const stamp = () =>
            markUsualRestocked(
                restocked.foods,
                householdId,
                foodId,
                restocked.today,
            );
        try {
            await stamp();
        } catch (err) {
            console.error(
                `[restock] stamp failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    return updated;
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

export type GroceryAllergenMatch =
    { members: GroceryAllergenMember[]; labels: string[] } | "unknown";

/** Pure matcher: hit members in input order, allergen labels in insertion order (Set). */
export function matchGroceryAllergens(
    displayName: string,
    members: GroceryAllergenMember[],
    foodAllergens?: readonly string[] | null,
): GroceryAllergenMatch | null {
    if (foodAllergens != null) {
        const hay = new Set(
            foodAllergens.map((code) => code.trim().toLowerCase()),
        );
        const hitMembers: GroceryAllergenMember[] = [];
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
            hitMembers.push(member);
            for (const row of matched) {
                hitCodes.add(
                    row.allergen === "other"
                        ? (row.otherLabel ?? "allergen")
                        : ALLERGEN_LABELS[row.allergen].toLowerCase(),
                );
            }
        }
        if (hitMembers.length === 0) return null;
        return { members: hitMembers, labels: [...hitCodes] };
    }
    const haystack = displayName.toLowerCase();
    const hitMembers: GroceryAllergenMember[] = [];
    const hitCodes = new Set<string>();
    for (const member of members) {
        const matched = member.allergens.some((row) =>
            allergenNeedle(row.allergen, row.otherLabel).some((needle) =>
                needle ? haystack.includes(needle) : false,
            ),
        );
        if (!matched) continue;
        hitMembers.push(member);
        for (const row of member.allergens) {
            for (const needle of allergenNeedle(row.allergen, row.otherLabel)) {
                if (needle && haystack.includes(needle)) hitCodes.add(needle);
            }
        }
    }
    if (hitMembers.length === 0) {
        const anyAllergen = members.some((row) => row.allergens.length > 0);
        if (!anyAllergen) return null;
        return "unknown";
    }
    return { members: hitMembers, labels: [...hitCodes] };
}

function allergenHitNotice(
    subject:
        { kind: "grocery_line"; id: string } | { kind: "recipe"; id: string },
    match: { members: GroceryAllergenMember[]; labels: string[] },
): Notice {
    const code =
        subject.kind === "grocery_line"
            ? "grocery.allergen"
            : "recipe.allergen";
    return {
        code,
        severity: NOTICE_SEVERITY[code],
        subject,
        related: match.members.map((member) => ({
            kind: "member" as const,
            id: member.userId ?? member.displayName,
            name: member.displayName,
        })),
        params: { allergens: match.labels },
    };
}

export function allergenNotices(
    subject:
        { kind: "grocery_line"; id: string } | { kind: "recipe"; id: string },
    displayName: string,
    members: GroceryAllergenMember[],
    foodAllergens?: readonly string[] | null,
): Notice[] {
    const match = matchGroceryAllergens(displayName, members, foodAllergens);
    if (match == null || match === "unknown") return [];
    return [allergenHitNotice(subject, match)];
}

export function groceryAllergenWarning(
    displayName: string,
    members: GroceryAllergenMember[],
    foodAllergens?: readonly string[] | null,
): GroceryAllergenWarning | null {
    const match = matchGroceryAllergens(displayName, members, foodAllergens);
    if (match == null) return null;
    if (match === "unknown") {
        return { blocking: false, text: UNKNOWN_ALLERGEN_TEXT };
    }
    return {
        blocking: true,
        text: noticeSentence(
            allergenHitNotice({ kind: "grocery_line", id: "" }, match),
        ),
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
    source?: unknown;
    source_fridge_item_id?: unknown;
    note?: unknown;
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
        foodId:
            row.food_id == null || row.food_id === ""
                ? null
                : String(row.food_id),
        checked: Boolean(row.checked),
        source: parseGroceryLineSource(row.source),
        sourceFridgeItemId:
            row.source_fridge_item_id == null ||
            row.source_fridge_item_id === ""
                ? null
                : String(row.source_fridge_item_id),
        note: row.note == null || row.note === "" ? null : String(row.note),
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
        source: row.source,
        source_fridge_item_id: row.sourceFridgeItemId,
        note: row.note,
    };
}
