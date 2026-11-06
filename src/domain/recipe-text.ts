import { parseIngredientLines } from "./ingredient-lines.js";
import { isNotMeasuredNote } from "./not-measured.js";
import type { ParsedIngredient } from "./ingredient-lines.js";

export type ParseRecipeTextResult = {
    name: string | null;
    ingredients: ParsedIngredient[];
    steps: string[];
    unresolved: string[];
    hasRecipe: boolean;
};

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const VARIATION_SELECTOR_RE = /[\uFE00-\uFE0F]/g;

const INGREDIENT_HEADER_RE =
    /^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}]*?(?:ingredients|you(?:'|')ll need|you will need|what you need|shopping list)\s*:?\s*$/iu;
const STEP_HEADER_RE =
    /^[\s\p{Extended_Pictographic}\uFE0F?\u20E3]*?(?:directions|instructions|method|steps|how to make(?: it)?|preparation)\s*:?\s*$/iu;

const BULLET_PREFIX_RE =
    /^[\s\p{Extended_Pictographic}\uFE0F?\u20E3]*(?:[•\-\*▪️✅✔️👉🔸]|\u2022)\s*/u;

const NUMBERED_STEP_RE =
    /^\s*(?:step\s*)?\d+\s*[.)]\s*|^\s*step\s+\d+\s*:?\s*/i;
const KEYCAP_STEP_RE = /^\s*(\d)\uFE0F?\u20E3\s*/;

const TRAILING_TAGS_RE = /(?:\s+(?:#\w+|@[\w.]+))+$/g;

const NAME_MAX = 120;

function normalizeNewlines(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripZeroWidth(text: string): string {
    return text.replace(ZERO_WIDTH_RE, "").replace(VARIATION_SELECTOR_RE, "");
}

function stripBullet(line: string): string {
    let s = line;
    for (let i = 0; i < 3; i += 1) {
        const next = s.replace(BULLET_PREFIX_RE, "");
        if (next === s) break;
        s = next;
    }
    return s.trim();
}

function stripTrailingTags(line: string): string {
    return line.replace(TRAILING_TAGS_RE, "").trim();
}

function isHashtagMentionOnlyLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    const tokens = trimmed.split(/\s+/);
    if (tokens.every((t) => t.startsWith("#") || t.startsWith("@")))
        return true;
    if (!/[\p{L}\p{N}]/u.test(trimmed.replace(/[#@]/g, ""))) return true;
    return false;
}

function isIngredientHeader(line: string): boolean {
    return INGREDIENT_HEADER_RE.test(line.trim());
}

function isStepHeader(line: string): boolean {
    return STEP_HEADER_RE.test(line.trim());
}

export function stripStepPrefix(line: string): string {
    const keycap = line.match(KEYCAP_STEP_RE);
    if (keycap) {
        return line.slice(keycap[0].length).trim();
    }
    return line.replace(NUMBERED_STEP_RE, "").trim();
}

export function isNumberedStepLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (KEYCAP_STEP_RE.test(trimmed)) return true;
    return NUMBERED_STEP_RE.test(trimmed);
}

function lineHasStrictIngredientSignal(line: string): boolean {
    const { items, unresolved } = parseIngredientLines([line]);
    if (unresolved.length > 0) return true;
    for (const item of items) {
        if (item.quantity != null) return true;
        if (isNotMeasuredNote(item.note)) return true;
    }
    return false;
}

function isIngredientBlockSubheader(line: string): boolean {
    return /^for (?:the )?.+:\s*$/i.test(line.trim());
}

function isProseLine(line: string): boolean {
    const trimmed = stripTrailingTags(stripBullet(line)).trim();
    if (!trimmed) return false;
    if (isIngredientHeader(trimmed) || isStepHeader(trimmed)) return false;
    if (isNumberedStepLine(trimmed)) return false;
    if (lineHasStrictIngredientSignal(trimmed)) return false;
    const words = trimmed.split(/\s+/);
    if (words.length >= 8 || trimmed.length >= 55) return true;
    if (/[.!?]/.test(trimmed) && words.length >= 5) return true;
    return false;
}

function pickName(candidates: string[], fallbackName?: string): string | null {
    for (const raw of candidates) {
        let line = stripTrailingTags(stripBullet(raw)).trim();
        if (!line || isHashtagMentionOnlyLine(line)) continue;
        if (isIngredientHeader(line) || isStepHeader(line)) continue;
        if (isNumberedStepLine(line)) continue;
        if (lineHasStrictIngredientSignal(line)) continue;
        line = line
            .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
            .replace(/#\w+/g, "")
            .replace(/@\w+/g, "")
            .replace(/[.,!?;:]+$/g, "")
            .trim();
        if (!line || line.length > NAME_MAX) continue;
        if (/[\p{L}\p{N}]/u.test(line)) return line;
    }
    return fallbackName?.trim() || null;
}

function longestIngredientRun(lines: string[]): {
    start: number;
    end: number;
} | null {
    let best: { start: number; end: number } | null = null;
    let runStart = -1;
    for (let i = 0; i <= lines.length; i += 1) {
        const line = i < lines.length ? lines[i]! : "";
        const trimmed = stripTrailingTags(stripBullet(line));
        const qualifies =
            i < lines.length &&
            !isHashtagMentionOnlyLine(line) &&
            !isNumberedStepLine(trimmed) &&
            lineHasStrictIngredientSignal(trimmed);
        if (qualifies) {
            if (runStart < 0) runStart = i;
        } else if (runStart >= 0) {
            const end = i;
            if (!best || end - runStart > best.end - best.start) {
                best = { start: runStart, end };
            }
            runStart = -1;
        }
    }
    return best;
}

function parseStructured(lines: string[]): {
    nameCandidates: string[];
    ingredientLines: string[];
    stepLines: string[];
} {
    let mode: "scan" | "ingredients" | "steps" = "scan";
    const nameCandidates: string[] = [];
    const ingredientLines: string[] = [];
    const stepLines: string[] = [];

    for (const raw of lines) {
        const line = stripTrailingTags(stripBullet(raw)).trim();
        if (!line || isHashtagMentionOnlyLine(raw)) continue;

        if (isIngredientHeader(line)) {
            mode = "ingredients";
            continue;
        }
        if (isStepHeader(line)) {
            mode = "steps";
            continue;
        }
        if (isIngredientBlockSubheader(line)) {
            mode = "ingredients";
            ingredientLines.push(raw);
            continue;
        }

        if (mode === "scan") {
            if (lineHasStrictIngredientSignal(line)) {
                mode = "ingredients";
                ingredientLines.push(raw);
            } else if (isNumberedStepLine(line)) {
                stepLines.push(stripStepPrefix(line));
            } else {
                nameCandidates.push(raw);
            }
            continue;
        }
        if (mode === "ingredients") {
            ingredientLines.push(raw);
            continue;
        }
        if (isNumberedStepLine(line)) {
            stepLines.push(stripStepPrefix(line));
        } else {
            stepLines.push(line);
        }
    }

    return { nameCandidates, ingredientLines, stepLines };
}

function hasStructuredHeaders(lines: string[]): boolean {
    return lines.some((raw) => {
        const line = stripTrailingTags(stripBullet(raw)).trim();
        return (
            isIngredientHeader(line) ||
            isStepHeader(line) ||
            isIngredientBlockSubheader(line)
        );
    });
}

function parseHeuristic(lines: string[]): {
    nameCandidates: string[];
    ingredientLines: string[];
    stepLines: string[];
} {
    const run = longestIngredientRun(lines);
    const nameCandidates: string[] = [];
    const ingredientLines: string[] = [];
    const stepLines: string[] = [];

    if (!run) {
        for (const raw of lines) {
            const line = stripTrailingTags(stripBullet(raw)).trim();
            if (!line || isHashtagMentionOnlyLine(raw)) continue;
            if (isNumberedStepLine(line)) {
                stepLines.push(stripStepPrefix(line));
            } else if (!isProseLine(raw)) {
                nameCandidates.push(raw);
            }
        }
        return { nameCandidates, ingredientLines, stepLines };
    }

    for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i]!;
        const line = stripTrailingTags(stripBullet(raw)).trim();
        if (!line || isHashtagMentionOnlyLine(raw)) continue;

        if (i >= run.start && i < run.end) {
            ingredientLines.push(raw);
            continue;
        }
        if (i < run.start) {
            if (!isProseLine(raw) && !isNumberedStepLine(line)) {
                nameCandidates.push(raw);
            } else if (isNumberedStepLine(line)) {
                stepLines.push(stripStepPrefix(line));
            }
            continue;
        }
        if (isNumberedStepLine(line)) {
            stepLines.push(stripStepPrefix(line));
        }
    }

    return { nameCandidates, ingredientLines, stepLines };
}

export function parseRecipeText(
    text: string,
    opts: { fallbackName?: string } = {},
): ParseRecipeTextResult {
    const normalized = stripZeroWidth(normalizeNewlines(text));
    const rawLines = normalized.split("\n");
    const lines: string[] = [];
    for (const raw of rawLines) {
        if (isHashtagMentionOnlyLine(raw)) continue;
        lines.push(raw);
    }

    const structured = hasStructuredHeaders(lines);
    let nameCandidates: string[];
    let ingredientRaw: string[];
    let stepLines: string[];

    if (structured) {
        const block = parseStructured(lines);
        nameCandidates = block.nameCandidates;
        ingredientRaw = block.ingredientLines;
        stepLines = block.stepLines;
    } else {
        const block = parseHeuristic(lines);
        nameCandidates = block.nameCandidates;
        ingredientRaw = block.ingredientLines;
        stepLines = block.stepLines;
    }

    const parsed = parseIngredientLines(
        ingredientRaw.map((l) => stripTrailingTags(stripBullet(l)).trim()),
    );

    const steps = stepLines.map((s) => s.trim()).filter((s) => s.length > 0);

    const ingredientLikeCount = parsed.items.length + parsed.unresolved.length;
    const hasRecipe = ingredientLikeCount > 0;

    const unresolved = [...parsed.unresolved];

    const name = pickName(nameCandidates, opts.fallbackName);

    return {
        name,
        ingredients: parsed.items,
        steps,
        unresolved,
        hasRecipe,
    };
}
