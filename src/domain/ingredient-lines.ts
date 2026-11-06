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

const PARSE_INGREDIENT_OPTS = {
    // Size words (and their abbreviations) describe the food, not a unit.
    ignoreUOMs: ["small", "medium", "large", "sm", "med", "md", "lg"],
} as const;

const FOOTNOTE_ONLY_RE = /^[*†]+$/;
const TRAILING_FOOTNOTE_RE = /\s*[*†]+$/;

/** Longest phrases first, so "a pinch" wins over "pinch". */
const PHRASES_LONGEST_FIRST = [...NOT_MEASURED_PHRASES].sort(
    (a, b) => b.length - a.length,
);

/** A bare count ("3 eggs") is only an ingredient when what is left is a real
 *  name: it has a letter, is not just a size word, and holds no other
 *  measure ("1 x 400g tin tomatoes" stays unresolved). */
function countableName(description: string): boolean {
    const rest = stripParentheticalGroups(description)
        .replace(/^x\s+/i, "")
        .trim();
    if (!/[a-z]/i.test(rest)) return false;
    if (SIZE_WORDS.has(rest.toLowerCase())) return false;
    if (/\d/.test(rest)) return false;
    return true;
}

function stripParentheticalGroups(line: string): string {
    let s = line;
    let prev = "";
    while (s !== prev) {
        prev = s;
        s = s.replace(/\([^()]*\)/g, " ");
    }
    return s.replace(/\s+/g, " ").trim();
}

function countRunTogetherTokens(line: string): number {
    const stripped = stripParentheticalGroups(line);
    const matches = stripped.match(RUN_TOGETHER_RE);
    return matches?.length ?? 0;
}

export function mapUnit(
    unitId: string | null,
    unitText: string | null,
): { unit: QuantityUnit; countNote: string | null } | null {
    const id = (unitId ?? unitText ?? "").toLowerCase();
    const text = (unitText ?? unitId ?? "").toLowerCase();

    if (!unitId && !unitText) {
        return { unit: "each", countNote: null };
    }

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
    for (const phrase of PHRASES_LONGEST_FIRST) {
        const capture = new RegExp(
            `(?:^|[^a-z])(${phrase.replace(/ /g, "\\s+")})(?:[^a-z]|$)`,
            "i",
        );
        const match = text.match(capture);
        if (match?.[1]) {
            return match[1].replace(/\s+/g, " ").trim();
        }
    }
    return null;
}

function normalizeNote(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    let note = raw.trim();
    if (!note) return null;
    let prev = "";
    while (note !== prev) {
        prev = note;
        note = note.replace(/^\((.*)\)$/s, "$1").trim();
    }
    note = note
        .replace(/\s+/g, " ")
        .replace(/,\s*$/, "")
        .replace(TRAILING_FOOTNOTE_RE, "")
        .trim();
    if (!note || FOOTNOTE_ONLY_RE.test(note)) return null;
    return note;
}

function splitNameAndNote(description: string): {
    name: string;
    note: string | null;
} {
    let trimmed = description.trim().replace(/,\s*$/, "");
    const inlineNotes: string[] = [];

    let prev = "";
    while (trimmed !== prev) {
        prev = trimmed;
        trimmed = trimmed
            .replace(/\(([^()]*)\)/g, (_m, inner: string) => {
                const part = inner
                    .trim()
                    .replace(/^,\s*/, "")
                    .replace(/\s+/g, " ")
                    .trim();
                if (part) inlineNotes.push(part);
                return " ";
            })
            .replace(/\s+/g, " ")
            .trim();
    }

    const comma = trimmed.lastIndexOf(",");
    if (comma > 0) {
        const name = trimmed.slice(0, comma).trim();
        const note = trimmed.slice(comma + 1).trim();
        if (name && note) inlineNotes.unshift(note);
        trimmed = name || trimmed;
    }

    const name = trimmed.replace(TRAILING_FOOTNOTE_RE, "").trim();
    const note = normalizeNote(
        inlineNotes.length ? inlineNotes.join(", ") : null,
    );
    return { name, note };
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

        if (lineLooksRunTogether(line)) {
            unresolved.push(rawLine);
            continue;
        }

        let parsed;
        try {
            parsed = parseIngredient(line, PARSE_INGREDIENT_OPTS)[0];
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

        const mapped = mapUnit(parsed.unitOfMeasureID, parsed.unitOfMeasure);
        // A measured line keeps its measure even when it also says "optional"
        // or "or to taste"; only an unmeasured line becomes "not measured".
        const measured = parsed.quantity != null && mapped != null;
        const notMeasured = measured ? null : findNotMeasuredPhrase(line);
        if (
            !measured &&
            (notMeasured || isNotMeasuredNote(parsed.description))
        ) {
            const phrase =
                notMeasured ?? findNotMeasuredPhrase(parsed.description);
            let name = parsed.description;
            if (phrase) {
                const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp(
                    `[,\\s]*${escaped.replace(/ /g, "\\s+")}[.\\s]*`,
                    "i",
                );
                name = name
                    .replace(re, " ")
                    .trim()
                    .replace(/^of\s+/i, "")
                    .replace(/,\s*$/, "");
            }
            const split = splitNameAndNote(name || parsed.description);
            items.push({
                line: rawLine,
                name: split.name || parsed.description,
                quantity: null,
                note: buildNoteParts([phrase, split.note]),
                section,
            });
            continue;
        }

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

        if (
            !mapped ||
            (!parsed.unitOfMeasureID &&
                !parsed.unitOfMeasure &&
                !countableName(parsed.description))
        ) {
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
    const stripped = stripParentheticalGroups(line);
    return (
        countRunTogetherTokens(line) >= 2 ||
        extractMeasurements(stripped).length >= 2
    );
}
