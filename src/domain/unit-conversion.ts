/**
 * The transformation layer between units. Within mass or within volume a
 * conversion is a fixed factor from the unit table (`quantity.ts`). Between
 * mass, volume and count it needs a property of the food itself: its density
 * (grams per ml) or what one item weighs (grams per item). Those come only
 * from measured data, in this order, and never from a guess:
 *
 *   1. the usual product's own stored factor,
 *   2. the usual product's serving line, when it states both a volume and a
 *      weight ("2 tbsp (30 g)" is 30 g in 30 ml),
 *   3. the plain food's own stored factor,
 *   4. the plain food's serving line, the same way.
 *
 * When none has it the conversion is refused and says which factor is
 * missing. Pure: no database, so it unit-tests with plain objects.
 */
import {
    canonicalFactor,
    dimensionOf,
    resolveQuantityUnit,
    type QuantityUnit,
} from "./quantity.js";

/** The serving line a pack lists: its text, and its size in g or ml. */
export type ServingLine = {
    label: string;
    amount: number;
    unit: "g" | "ml";
};

/** What a food row offers the conversion: stored factors and its serving. */
export type ConversionFoodRow = {
    id: string;
    name: string;
    gramsPerMl: number | null;
    gramsPerEach: number | null;
    serving: ServingLine | null;
};

export type FactorSource =
    "product" | "product_serving" | "food" | "food_serving";

export type ResolvedFactor = {
    value: number;
    source: FactorSource;
    /** The row the value was read from. */
    foodId: string;
    foodName: string;
    /** The serving text it was worked out from, for a serving source. */
    servingLabel: string | null;
};

export type ResolvedFactors = {
    gramsPerMl: ResolvedFactor | null;
    gramsPerEach: ResolvedFactor | null;
};

/**
 * Densities outside this range are not food: the lightest (puffed cereal,
 * dried herbs) sit near 0.05 g/ml and the heaviest (honey, syrups, salt)
 * below 1.6. A serving line that works out outside it is misread, so it is
 * ignored rather than trusted.
 */
const MIN_DENSITY = 0.03;
const MAX_DENSITY = 2.5;

const FRACTION_CHARS: Record<string, number> = {
    "½": 0.5,
    "¼": 0.25,
    "¾": 0.75,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "⅛": 0.125,
};

function parseAmountText(raw: string): number | null {
    const text = raw.trim();
    const fractionChar = FRACTION_CHARS[text.slice(-1)];
    if (fractionChar != null) {
        const whole = text.slice(0, -1).trim();
        const base = whole === "" ? 0 : Number(whole);
        return Number.isFinite(base) ? base + fractionChar : null;
    }
    const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) {
        const den = Number(mixed[3]);
        return den > 0 ? Number(mixed[1]) + Number(mixed[2]) / den : null;
    }
    const frac = text.match(/^(\d+)\/(\d+)$/);
    if (frac) {
        const den = Number(frac[2]);
        return den > 0 ? Number(frac[1]) / den : null;
    }
    const n = Number(text.replace(",", "."));
    return Number.isFinite(n) ? n : null;
}

const MEASURE_RE =
    /(\d+\s+\d+\/\d+|\d+\/\d+|\d*[.,]?\d+\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])\s*(fl\.?\s*oz|[a-z]+)\.?/gi;

/** Every "<amount> <unit>" in a serving line whose unit the table knows. */
export function measuresInLabel(
    label: string,
): { amount: number; unit: QuantityUnit }[] {
    const out: { amount: number; unit: QuantityUnit }[] = [];
    for (const match of label.matchAll(MEASURE_RE)) {
        const amount = parseAmountText(match[1] ?? "");
        const unit = resolveQuantityUnit(match[2] ?? "");
        if (amount == null || !(amount > 0) || unit == null) continue;
        if (unit === "each") continue;
        out.push({ amount, unit });
    }
    return out;
}

function totalIn(
    measures: { amount: number; unit: QuantityUnit }[],
    dim: "mass" | "volume",
): number | null {
    const ofDim = measures.filter((m) => dimensionOf(m.unit) === dim);
    if (ofDim.length === 0) return null;
    // Two different readings of one dimension ("1 cup (240 ml)") must agree
    // within label rounding; when they do not, the line is not trusted.
    const values = ofDim.map((m) => m.amount * canonicalFactor(m.unit));
    const first = values[0]!;
    const agree = values.every(
        (v) => Math.abs(v - first) <= Math.max(1, 0.06 * first),
    );
    return agree ? first : null;
}

/**
 * Grams per ml from a serving line whose own text states both a volume and a
 * weight ("2 tbsp (30 g)", "1 cup (240 ml) 245 g"), or null. The text must
 * carry both: a serving amount alone is not evidence, because a database can
 * fill "15 g" in for "1 tbsp (15 ml)" by assuming 1 g = 1 ml, which is the
 * guess this module exists to avoid. The serving amount is only a cross-check
 * that has to agree with the text.
 */
export function densityFromServing(
    serving: ServingLine | null | undefined,
): number | null {
    if (serving == null) return null;
    const measures = measuresInLabel(serving.label);
    if (totalIn(measures, "mass") == null) return null;
    if (totalIn(measures, "volume") == null) return null;
    if (serving.amount > 0) {
        measures.push({ amount: serving.amount, unit: serving.unit });
    }
    const grams = totalIn(measures, "mass");
    const ml = totalIn(measures, "volume");
    if (grams == null || ml == null || !(ml > 0)) return null;
    const density = grams / ml;
    if (density < MIN_DENSITY || density > MAX_DENSITY) return null;
    return Math.round(density * 1000) / 1000;
}

function positive(value: number | null | undefined): number | null {
    return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The factors a plain food converts with, each with where it came from. The
 * usual product (when there is one) is read before the plain food, because it
 * is what the household actually buys.
 */
export function resolveFactors(
    plain: ConversionFoodRow,
    usual: ConversionFoodRow | null,
): ResolvedFactors {
    const rows: {
        row: ConversionFoodRow;
        own: FactorSource;
        fromServing: FactorSource;
    }[] = [];
    if (usual) {
        rows.push({
            row: usual,
            own: "product",
            fromServing: "product_serving",
        });
    }
    rows.push({ row: plain, own: "food", fromServing: "food_serving" });

    let gramsPerMl: ResolvedFactor | null = null;
    for (const { row, own, fromServing } of rows) {
        const stored = positive(row.gramsPerMl);
        if (stored != null) {
            gramsPerMl = {
                value: stored,
                source: own,
                foodId: row.id,
                foodName: row.name,
                servingLabel: null,
            };
            break;
        }
        const derived = densityFromServing(row.serving);
        if (derived != null) {
            gramsPerMl = {
                value: derived,
                source: fromServing,
                foodId: row.id,
                foodName: row.name,
                servingLabel: row.serving?.label ?? null,
            };
            break;
        }
    }

    let gramsPerEach: ResolvedFactor | null = null;
    for (const { row, own } of rows) {
        const stored = positive(row.gramsPerEach);
        if (stored != null) {
            gramsPerEach = {
                value: stored,
                source: own,
                foodId: row.id,
                foodName: row.name,
                servingLabel: null,
            };
            break;
        }
    }
    return { gramsPerMl, gramsPerEach };
}

export type ConversionStep =
    | { kind: "table"; from: QuantityUnit; to: QuantityUnit }
    | { kind: "grams_per_ml"; factor: ResolvedFactor }
    | { kind: "grams_per_each"; factor: ResolvedFactor };

export type ConversionResult =
    | {
          ok: true;
          amount: number;
          unit: QuantityUnit;
          /** Unrounded, for chaining. */
          exact: number;
          steps: ConversionStep[];
      }
    | {
          ok: false;
          reason:
              | "unknown_unit"
              | "missing_grams_per_ml"
              | "missing_grams_per_each";
          /** The unit text Foodable did not recognise, for unknown_unit. */
          unknownUnit: string | null;
          message: string;
      };

function roundForDisplay(n: number): number {
    if (n === 0) return 0;
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}

/**
 * Convert an amount from one unit to another for a food. Mass↔mass and
 * volume↔volume use the unit table alone. Mass↔volume needs grams per ml,
 * and anything ↔ count needs grams per item (plus grams per ml when the other
 * side is a volume). A missing factor refuses the conversion and names it.
 */
export function convertAmount(
    amount: number,
    fromRaw: string,
    toRaw: string,
    factors: ResolvedFactors,
    foodName = "This food",
): ConversionResult {
    const from = resolveQuantityUnit(fromRaw);
    const to = resolveQuantityUnit(toRaw);
    if (from == null || to == null) {
        const bad = from == null ? fromRaw : toRaw;
        return {
            ok: false,
            reason: "unknown_unit",
            unknownUnit: bad.trim(),
            message: `"${bad.trim()}" is not a unit Foodable converts. Known units: mg, g, kg, oz, lb, ml, l, tsp, tbsp, fl oz, cup, pint, quart, gallon, each.`,
        };
    }
    const fromDim = dimensionOf(from);
    const toDim = dimensionOf(to);
    const steps: ConversionStep[] = [];
    if (fromDim === toDim) {
        const exact =
            fromDim === "count"
                ? amount
                : (amount * canonicalFactor(from)) / canonicalFactor(to);
        if (from !== to) steps.push({ kind: "table", from, to });
        return {
            ok: true,
            amount: roundForDisplay(exact),
            unit: to,
            exact,
            steps,
        };
    }

    const needsDensity = fromDim === "volume" || toDim === "volume";
    const needsEach = fromDim === "count" || toDim === "count";
    if (needsDensity && factors.gramsPerMl == null) {
        return {
            ok: false,
            reason: "missing_grams_per_ml",
            unknownUnit: null,
            message: `${foodName} has no grams per ml, so ${from} and ${to} cannot be converted. Set its grams per ml, or use a usual product whose serving lists both a volume and a weight.`,
        };
    }
    if (needsEach && factors.gramsPerEach == null) {
        return {
            ok: false,
            reason: "missing_grams_per_each",
            unknownUnit: null,
            message: `${foodName} has no grams per item, so ${from} and ${to} cannot be converted. Set what one weighs.`,
        };
    }

    // Through grams: the one quantity every dimension can reach.
    let grams: number;
    if (fromDim === "mass") {
        grams = amount * canonicalFactor(from);
        if (from !== "g") steps.push({ kind: "table", from, to: "g" });
    } else if (fromDim === "volume") {
        const ml = amount * canonicalFactor(from);
        if (from !== "ml") steps.push({ kind: "table", from, to: "ml" });
        grams = ml * factors.gramsPerMl!.value;
        steps.push({ kind: "grams_per_ml", factor: factors.gramsPerMl! });
    } else {
        grams = amount * factors.gramsPerEach!.value;
        steps.push({ kind: "grams_per_each", factor: factors.gramsPerEach! });
    }

    let exact: number;
    if (toDim === "mass") {
        exact = grams / canonicalFactor(to);
        if (to !== "g") steps.push({ kind: "table", from: "g", to });
    } else if (toDim === "volume") {
        const ml = grams / factors.gramsPerMl!.value;
        if (fromDim !== "volume") {
            steps.push({ kind: "grams_per_ml", factor: factors.gramsPerMl! });
        }
        exact = ml / canonicalFactor(to);
        if (to !== "ml") steps.push({ kind: "table", from: "ml", to });
    } else {
        exact = grams / factors.gramsPerEach!.value;
        if (fromDim !== "count") {
            steps.push({
                kind: "grams_per_each",
                factor: factors.gramsPerEach!,
            });
        }
    }
    return { ok: true, amount: roundForDisplay(exact), unit: to, exact, steps };
}
