import { parseIngredient, extractMeasurements } from "parse-ingredient";
import { isNotMeasuredNote, NOT_MEASURED_PHRASES } from "./recipe-import.js";
import type { QuantityUnit } from "./quantity.js";

export type ParsedIngredient = {
    line: string;
    name: string;
    quantity: { amount: number; unit: QuantityUnit } | null;
    note: string | null;
    section: string | null;
};

const COUNT_UNITS = new Set([
    "clove",
    "cloves",
    "can",
    "cans",
    "slice",
    "slices",
    "piece",
    "pieces",
    "bunch",
    "bunches",
    "sprig",
    "sprigs",
    "stick",
    "sticks",
    "head",
    "heads",
    "package",
    "packages",
    "pkg",
    "pkgs",
    "jar",
    "jars",
    "bottle",
    "bottles",
]);

const SIZE_WORDS = new Set(["large", "medium", "small"]);

const RUN_TOGETHER_RE =
    /\d+(?:\.\d+)?(?:\s+\d+\/\d+)?(?:\s*\/\s*\d+)?\s*(?:kg|kilograms?|g|grams?|mg|lb|lbs|pounds?|oz|ounces?|ml|milliliters?|l|liters?|litres?|cups?|tbsp|tablespoons?|tsp|teaspoons?|fl\s*oz|fluid\s*ounces?|cloves?|cans?|slices?|pieces?|bunch(?:es)?|sprigs?|sticks?|heads?|packages?|pkgs?|jars?|bottles?)\b/gi;

function countRunTogetherTokens(line: string): number {
    const matches = line.match(RUN_TOGETHER_RE);
    return matches?.length ?? 0;
}

export function mapUnit(
    unitId: string | null,
    unitText: string | null,
): { unit: QuantityUnit; countNote: string | null } | null {
    if (!unitId && !unitText) return null;
    const id = (unitId ?? unitText ?? "").toLowerCase();
    const text = (unitText ?? unitId ?? "").toLowerCase();

    if (SIZE_WORDS.has(id) || SIZE_WORDS.has(text)) return null;

    const massMap: Record<string, QuantityUnit> = {
        g: "g",
        gram: "g",
        grams: "g",
        kg: "g",
        kilogram: "g",
        kilograms: "g",
        mg: "g",
        oz: "oz",
        ounce: "oz",
        ounces: "oz",
        lb: "lb",
        lbs: "lb",
        pound: "lb",
        pounds: "lb",
    };
    const volumeMap: Record<string, QuantityUnit> = {
        ml: "ml",
        milliliter: "ml",
        milliliters: "ml",
        l: "ml",
        liter: "ml",
        liters: "ml",
        litre: "ml",
        litres: "ml",
        "fl oz": "fl oz",
        "fluid ounce": "fl oz",
        "fluid ounces": "fl oz",
        cup: "cup",
        cups: "cup",
        tbsp: "tbsp",
        tablespoon: "tbsp",
        tablespoons: "tbsp",
        tsp: "tsp",
        teaspoon: "tsp",
        teaspoons: "tsp",
    };

    if (massMap[id]) {
        return { unit: massMap[id]!, countNote: null };
    }
    if (volumeMap[id]) {
        return { unit: volumeMap[id]!, countNote: null };
    }

    if (COUNT_UNITS.has(id) || COUNT_UNITS.has(text)) {
        return { unit: "each", countNote: unitText ?? unitId };
    }

    if (!unitId && !unitText) {
        return { unit: "each", countNote: null };
    }

    return null;
}

function scaleAmount(amount: number, unitId: string | null): number {
    const id = (unitId ?? "").toLowerCase();
    if (id === "kg" || id === "kilogram" || id === "kilograms") {
        return amount * 1000;
    }
    if (id === "mg") return amount / 1000;
    if (
        id === "l" ||
        id === "liter" ||
        id === "liters" ||
        id === "litre" ||
        id === "litres"
    ) {
        return amount * 1000;
    }
    return amount;
}

function findNotMeasuredPhrase(text: string): string | null {
    const lower = text.toLowerCase();
    for (const phrase of NOT_MEASURED_PHRASES) {
        const re = new RegExp(
            `(^|[^a-z])${phrase.replace(/ /g, "\\s+")}([^a-z]|$)`,
            "i",
        );
        const match = lower.match(re);
        if (match && match.index != null) {
            const start = match.index + (match[1]?.length ?? 0);
            return text
                .slice(start, start + phrase.length)
                .replace(/\s+/g, " ");
        }
    }
    return null;
}

function splitNameAndNote(description: string): {
    name: string;
    note: string | null;
} {
    const trimmed = description.trim().replace(/,\s*$/, "");
    const comma = trimmed.lastIndexOf(",");
    if (comma > 0) {
        const name = trimmed.slice(0, comma).trim();
        const note = trimmed.slice(comma + 1).trim();
        if (name && note) return { name, note };
    }
    const paren = trimmed.match(/^(.+?)\s*(\([^)]+\))\s*$/);
    if (paren) {
        return { name: paren[1]!.trim(), note: paren[2]!.trim() };
    }
    return { name: trimmed, note: null };
}

function buildNoteParts(
    parts: Array<string | null | undefined>,
): string | null {
    const joined = parts
        .filter((p): p is string => Boolean(p?.trim()))
        .join(", ");
    return joined || null;
}

export function parseIngredientLines(lines: string[]): {
    items: ParsedIngredient[];
    unresolved: string[];
} {
    const items: ParsedIngredient[] = [];
    const unresolved: string[] = [];
    let section: string | null = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (countRunTogetherTokens(line) >= 2) {
            unresolved.push(rawLine);
            continue;
        }

        let parsed;
        try {
            parsed = parseIngredient(line)[0];
        } catch {
            unresolved.push(rawLine);
            continue;
        }

        if (!parsed) {
            unresolved.push(rawLine);
            continue;
        }

        if (parsed.isGroupHeader) {
            section = parsed.description.replace(/:\s*$/, "").trim() || null;
            continue;
        }

        if (!parsed.description.trim()) {
            unresolved.push(rawLine);
            continue;
        }

        const notMeasured = findNotMeasuredPhrase(line);
        if (notMeasured || isNotMeasuredNote(parsed.description)) {
            const phrase =
                notMeasured ?? findNotMeasuredPhrase(parsed.description);
            let name = parsed.description;
            if (phrase) {
                const re = new RegExp(
                    `[,\s]*${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[.\s]*`,
                    "i",
                );
                name = name.replace(re, "").trim().replace(/,\s*$/, "");
            }
            items.push({
                line: rawLine,
                name: name || parsed.description,
                quantity: null,
                note: phrase,
                section,
            });
            continue;
        }

        const mapped = mapUnit(parsed.unitOfMeasureID, parsed.unitOfMeasure);

        if (parsed.quantity == null) {
            const { name, note } = splitNameAndNote(parsed.description);
            items.push({
                line: rawLine,
                name,
                quantity: null,
                note,
                section,
            });
            continue;
        }

        if (!mapped) {
            unresolved.push(rawLine);
            continue;
        }

        let amount = scaleAmount(parsed.quantity, parsed.unitOfMeasureID);
        const notes: Array<string | null> = [];

        if (parsed.quantity2 != null && parsed.unitOfMeasure) {
            notes.push(
                `${parsed.quantity}–${parsed.quantity2} ${parsed.unitOfMeasure}`,
            );
        }

        const { name, note: trailingNote } = splitNameAndNote(
            parsed.description,
        );
        if (trailingNote) notes.push(trailingNote);
        if (mapped.countNote) notes.push(mapped.countNote);

        items.push({
            line: rawLine,
            name,
            quantity: { amount, unit: mapped.unit },
            note: buildNoteParts(notes),
            section,
        });
    }

    return { items, unresolved };
}

export function lineLooksRunTogether(line: string): boolean {
    return (
        countRunTogetherTokens(line) >= 2 ||
        extractMeasurements(line).length >= 2
    );
}
