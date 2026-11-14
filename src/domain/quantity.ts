import {
    GRAMS_PER_KILOGRAM,
    GRAMS_PER_LB,
    GRAMS_PER_MG,
    GRAMS_PER_OZ,
    ML_PER_CUP,
    ML_PER_FL_OZ,
    ML_PER_GALLON,
    ML_PER_L,
    ML_PER_PINT,
    ML_PER_QUART,
    ML_PER_TBSP,
    ML_PER_TSP,
} from "./units.js";

export type CanonicalDimension = "mass" | "volume" | "count";

export type MassUnit = "mg" | "g" | "kg" | "oz" | "lb";
export type VolumeUnit =
    "ml" | "l" | "tsp" | "tbsp" | "fl oz" | "cup" | "pint" | "quart" | "gallon";
export type CountUnit = "each";
export type QuantityUnit = MassUnit | VolumeUnit | CountUnit;

/**
 * Every unit Foodable converts, in picker order. Within a dimension the
 * factors below are fixed by definition; between mass, volume and count a
 * conversion needs the food's own grams per ml or grams per item.
 */
export const FOOD_QUANTITY_UNITS: readonly QuantityUnit[] = [
    "g",
    "kg",
    "mg",
    "oz",
    "lb",
    "ml",
    "l",
    "tsp",
    "tbsp",
    "fl oz",
    "cup",
    "pint",
    "quart",
    "gallon",
    "each",
];

export type MassQuantity = { amount: number; unit: MassUnit };
export type VolumeQuantity = { amount: number; unit: VolumeUnit };
export type CountQuantity = {
    amount: number;
    unit: CountUnit;
    gramsPerEach?: number;
};
export type Quantity = MassQuantity | VolumeQuantity | CountQuantity;

const MASS_UNITS = new Set<string>(["mg", "g", "kg", "oz", "lb"]);
const VOLUME_UNITS = new Set<string>([
    "ml",
    "l",
    "tsp",
    "tbsp",
    "fl oz",
    "cup",
    "pint",
    "quart",
    "gallon",
]);
const COUNT_UNITS = new Set<string>(["each"]);

const TO_CANONICAL: Record<QuantityUnit, number> = {
    mg: GRAMS_PER_MG,
    g: 1,
    kg: GRAMS_PER_KILOGRAM,
    oz: GRAMS_PER_OZ,
    lb: GRAMS_PER_LB,
    ml: 1,
    l: ML_PER_L,
    tsp: ML_PER_TSP,
    tbsp: ML_PER_TBSP,
    "fl oz": ML_PER_FL_OZ,
    cup: ML_PER_CUP,
    pint: ML_PER_PINT,
    quart: ML_PER_QUART,
    gallon: ML_PER_GALLON,
    each: 1,
};

/** Grams per unit for a mass unit, ml per unit for a volume unit. */
export function canonicalFactor(unit: QuantityUnit): number {
    return TO_CANONICAL[unit];
}

/**
 * Spellings people and agents write, mapped to the unit they mean. Matched
 * after trimming, lower-casing and collapsing spaces and a trailing dot.
 * Ambiguous shorthands ("T" vs "t", "c", "pt" for a UK pint) are left out on
 * purpose: a wrong unit is worse than an unknown one.
 */
const UNIT_ALIASES: Record<string, QuantityUnit> = {
    mg: "mg",
    milligram: "mg",
    milligrams: "mg",
    g: "g",
    gr: "g",
    gram: "g",
    grams: "g",
    gramme: "g",
    grammes: "g",
    kg: "kg",
    kgs: "kg",
    kilo: "kg",
    kilos: "kg",
    kilogram: "kg",
    kilograms: "kg",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    ml: "ml",
    millilitre: "ml",
    millilitres: "ml",
    milliliter: "ml",
    milliliters: "ml",
    l: "l",
    litre: "l",
    litres: "l",
    liter: "l",
    liters: "l",
    tsp: "tsp",
    tsps: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    tbsp: "tbsp",
    tbsps: "tbsp",
    tbs: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    "fl oz": "fl oz",
    floz: "fl oz",
    "fl. oz": "fl oz",
    "fluid ounce": "fl oz",
    "fluid ounces": "fl oz",
    cup: "cup",
    cups: "cup",
    pint: "pint",
    pints: "pint",
    quart: "quart",
    quarts: "quart",
    qt: "quart",
    qts: "quart",
    gallon: "gallon",
    gallons: "gallon",
    gal: "gallon",
    each: "each",
    ea: "each",
};

/**
 * The unit a written spelling means ("Cups", "tablespoons", "litres",
 * "pints"), or null when it is not one Foodable converts. Count nouns such
 * as "clove" or "can" are not units here: they stay as written.
 */
export function resolveQuantityUnit(raw: string): QuantityUnit | null {
    const key = raw
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/\.$/, "");
    if (key === "") return null;
    return UNIT_ALIASES[key] ?? null;
}

/**
 * The unit to store for a written one: the canonical name when Foodable knows
 * the spelling, otherwise the trimmed text unchanged (a free-text unit such as
 * "bag" still saves, it just never converts).
 */
export function canonicalUnitText(raw: string): string {
    return resolveQuantityUnit(raw) ?? raw.trim();
}

export function dimensionOf(unit: QuantityUnit): CanonicalDimension {
    if (MASS_UNITS.has(unit)) return "mass";
    if (VOLUME_UNITS.has(unit)) return "volume";
    if (COUNT_UNITS.has(unit)) return "count";
    throw new Error(`Unknown quantity unit: ${unit}`);
}

export function isQuantityUnit(x: unknown): x is QuantityUnit {
    return typeof x === "string" && x in TO_CANONICAL;
}

export function parseQuantity(raw: string): Quantity {
    const trimmed = raw.trim();
    const match = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(.+)$/);
    if (!match) {
        throw new Error(`Invalid quantity: ${raw}`);
    }
    const amountRaw = match[1];
    const unitRaw = match[2];
    if (amountRaw === undefined || unitRaw === undefined) {
        throw new Error(`Invalid quantity: ${raw}`);
    }
    const amount = Number(amountRaw);
    const unit = unitRaw.trim();
    if (!Number.isFinite(amount)) {
        throw new Error(`Invalid quantity amount: ${raw}`);
    }
    if (!isQuantityUnit(unit)) {
        throw new Error(`Unknown quantity unit: ${unit}`);
    }
    const dim = dimensionOf(unit);
    if (dim === "mass") return { amount, unit: unit as MassUnit };
    if (dim === "volume") return { amount, unit: unit as VolumeUnit };
    return { amount, unit: "each" };
}

export function formatQuantity(q: Quantity): string {
    return `${q.amount} ${q.unit}`;
}

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

export function convertQuantity(q: Quantity, to: QuantityUnit): Quantity {
    if (!Number.isFinite(q.amount)) {
        throw new Error(`Invalid quantity amount: ${q.amount}`);
    }
    const fromDim = dimensionOf(q.unit);
    const toDim = dimensionOf(to);
    if (fromDim !== toDim) {
        throw new Error(
            `Cannot convert ${q.unit} (${fromDim}) to ${to} (${toDim})`,
        );
    }
    if (q.unit === "each" && to === "each") {
        return { amount: q.amount, unit: "each", gramsPerEach: q.gramsPerEach };
    }
    const canonical = q.amount * TO_CANONICAL[q.unit];
    const amount = roundAmount(canonical / TO_CANONICAL[to]);
    if (toDim === "mass") return { amount, unit: to as MassUnit };
    return { amount, unit: to as VolumeUnit };
}
