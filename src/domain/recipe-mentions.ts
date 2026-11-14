import { looseFoodKey, pluralFreeFoodKey } from "./foods.js";
import {
    BUNDLED_MENTION_WORDS,
    MENTION_KINDS,
    MENTION_NOT_FOOD_WORDS,
    MENTION_OWN_FOODS,
    MENTION_PART_WORDS,
    MENTION_SYNONYMS,
} from "./recipe-mention-words.js";
import { recipeSteps } from "./recipes.js";

/**
 * Foods a recipe's steps name that its ingredient list does not. Pure and
 * deterministic: no store, no model. A warning is advice for the household,
 * never a verification problem, and the matcher would rather miss a gap than
 * raise a false one (see `covers`).
 */

/** A name the steps can mention: a household catalog food or alias, or a bundled word. */
export type MentionVocabEntry = { name: string; foodId?: string };

export type MentionWarning = {
    /**
     * The food as a lower-case, accent-free name. A bundled word keeps its
     * singular spelling ("egg"); a household food no bundled word matches is
     * the household's own name as written, plural and all ("pickled beets").
     */
    food: string;
    /**
     * Stable key for dismissals: the same text as `food`. Every spelling of a
     * bundled food shares it, and a dismissal matches whatever plural or
     * synonym spelling it is written in.
     */
    key: string;
    /** Set when the mention matched a household catalog food. */
    foodId?: string;
    /** The sentence of the first mention, trimmed and clipped. */
    excerpt: string;
    /** Which step (index into `recipeSteps`) holds the first mention. */
    stepIndex: number;
    /**
     * Where the mention sits in that step once it is NFC-normalized, as
     * [start, end) offsets into the string. A page that marks it up
     * normalizes the step the same way first.
     */
    start: number;
    end: number;
    /** The same span inside `excerpt`. */
    excerptStart: number;
    excerptEnd: number;
    /** A number right before the mention ("add 2 eggs" is 2), else null. */
    amount: number | null;
    /** Descriptive words right before the mention ("lightly beaten"), else null. */
    note: string | null;
    message: string;
};

export type MentionIngredient = {
    name: string;
    foodName?: string | null;
    foodId?: string | null;
};

const EXCERPT_MAX = 160;

/** Words that are never a food to buy, whatever the catalog calls them. */
const NEVER_FLAGGED = new Set(["water", "ice"]);

/** Foods that are also verbs: skipped where the step uses them as one. */
const VERB_LIKE_FOODS = [
    "bread",
    "butter",
    "cream",
    "flour",
    "oil",
    "pepper",
    "salt",
    "squash",
    "sugar",
];

/** Words that follow a verb and open its object ("cream the butter"). */
const OBJECT_OPENERS = new Set([
    "a",
    "an",
    "it",
    "that",
    "the",
    "them",
    "this",
    "your",
]);

/** Words that put "orange" on a plate rather than on the colour wheel. */
const ORANGE_LEADS = new Set([
    "a",
    "an",
    "each",
    "half",
    "of",
    "some",
    "the",
    "with",
]);

/** Words that describe how a food is prepared; kept as the mention's note. */
const NOTE_WORDS = new Set([
    "beaten",
    "boiled",
    "chilled",
    "chopped",
    "cold",
    "cooked",
    "crushed",
    "cubed",
    "diced",
    "dried",
    "finely",
    "fresh",
    "frozen",
    "grated",
    "ground",
    "halved",
    "hot",
    "large",
    "lightly",
    "medium",
    "melted",
    "minced",
    "peeled",
    "raw",
    "ripe",
    "roughly",
    "shredded",
    "sliced",
    "small",
    "softened",
    "thinly",
    "toasted",
    "warm",
    "whisked",
]);

/**
 * Words that measure a food rather than count it: "3 garlic cloves" is not 3
 * garlic. A number before the mention is dropped when one of these follows.
 */
const MEASURE_WORDS = new Set([
    "bag",
    "bar",
    "block",
    "bottle",
    "box",
    "bunch",
    "bundle",
    "can",
    "carton",
    "clove",
    "cube",
    "cup",
    "dash",
    "drop",
    "fillet",
    "g",
    "gallon",
    "gram",
    "handful",
    "head",
    "inch",
    "jar",
    "kg",
    "kilogram",
    "l",
    "lb",
    "liter",
    "litre",
    "ml",
    "ounce",
    "oz",
    "packet",
    "piece",
    "pinch",
    "pint",
    "pound",
    "quart",
    "rib",
    "slice",
    "sprig",
    "stalk",
    "stick",
    "strip",
    "tbsp",
    "teaspoon",
    "tablespoon",
    "tin",
    "tsp",
    "wedge",
]);

const NUMBER_WORDS: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    half: 0.5,
};

const UNICODE_FRACTIONS: Record<string, number> = {
    "¼": 0.25,
    "½": 0.5,
    "¾": 0.75,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
};

/**
 * `text` lower-cased with its accents removed, the same length as the input so
 * positions in one are positions in the other. A character that would change
 * length ("ǆ", Hangul) is kept as it was.
 */
function fold(text: string): string {
    let out = "";
    for (const c of text.normalize("NFC")) {
        const folded = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        out += folded.length === c.length ? folded : c;
    }
    return out;
}

type Token = {
    text: string;
    start: number;
    end: number;
    /** A comma, bracket or sentence end sits between this token and the last. */
    breakBefore: boolean;
};

const TOKEN_RE = /\p{L}+|\d+(?:[./]\d+)?|[¼½¾⅓⅔]/gu;
const BREAK_RE = /[,.;:!?()]/;

/** Tokens of `folded` (already lower-case); a break stops phrases and amounts. */
function tokenize(folded: string): Token[] {
    const tokens: Token[] = [];
    let previousEnd = 0;
    for (const m of folded.matchAll(TOKEN_RE)) {
        const gap = folded.slice(previousEnd, m.index);
        tokens.push({
            text: m[0],
            start: m.index,
            end: m.index + m[0].length,
            breakBefore: tokens.length === 0 || BREAK_RE.test(gap),
        });
        previousEnd = m.index + m[0].length;
    }
    return tokens;
}

/** The words of a name with plural endings removed, the unit of every key here. */
function plainWords(name: string): string[] {
    const key = pluralFreeFoodKey(fold(name));
    return key ? key.split(" ") : [];
}

type Alias = { from: string[]; to: string };

/** Every synonym but the key, longest first, indexed by its first word. */
const ALIASES: Map<string, Alias[]> = (() => {
    const all: Alias[] = [];
    for (const [key, ...others] of MENTION_SYNONYMS) {
        const keyWords = plainWords(key!);
        const to = keyWords.join(" ");
        // A phrase key is one unit, so its own spelling has to collapse too.
        if (keyWords.length > 1) all.push({ from: keyWords, to });
        for (const other of others) {
            all.push({ from: plainWords(other), to });
        }
    }
    all.sort((a, b) => b.from.length - a.from.length);
    const byFirst = new Map<string, Alias[]>();
    for (const alias of all) {
        const list = byFirst.get(alias.from[0]!) ?? [];
        list.push(alias);
        byFirst.set(alias.from[0]!, list);
    }
    return byFirst;
})();

/** One word of a name or a step, which may stand for several tokens. */
type Unit = { word: string; first: number; last: number };

/**
 * `words` with each synonym replaced by its key. `joinable(i)` says whether
 * word `i` continues the word before it, so a phrase never spans a break.
 */
function collapse(
    words: readonly string[],
    joinable: (i: number) => boolean,
): Unit[] {
    const units: Unit[] = [];
    let i = 0;
    while (i < words.length) {
        const alias = ALIASES.get(words[i]!)?.find((a) =>
            a.from.every(
                (w, k) => words[i + k] === w && (k === 0 || joinable(i + k)),
            ),
        );
        const length = alias ? alias.from.length : 1;
        units.push({
            word: alias ? alias.to : words[i]!,
            first: i,
            last: i + length - 1,
        });
        i += length;
    }
    return units;
}

/** The comparison words of a name: no accents, plurals or synonyms. */
function matchWords(name: string): string[] {
    return collapse(plainWords(name), () => true).map((u) => u.word);
}

const idOf = (name: string): string => matchWords(name).join(" ");

const stems = (list: readonly string[]): Set<string> =>
    new Set(list.map((w) => idOf(w)));

const NOT_FOOD_STEMS = stems(MENTION_NOT_FOOD_WORDS);
const VERB_LIKE_STEMS = stems(VERB_LIKE_FOODS);
const OWN_FOOD_IDS = stems(MENTION_OWN_FOODS);
const PART_STEMS = stems(MENTION_PART_WORDS);
const KINDS_BY_HEAD = new Map(
    Object.entries(MENTION_KINDS).map(([head, kinds]) => [
        idOf(head),
        kinds.map(matchWords),
    ]),
);

function numberOf(token: string): number | null {
    if (token in NUMBER_WORDS) return NUMBER_WORDS[token]!;
    if (token in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[token]!;
    if (/^\d+\/\d+$/.test(token)) {
        const [a, b] = token.split("/").map(Number);
        return b ? a! / b : null;
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
    return null;
}

type IndexedEntry = {
    words: string[];
    /** The words joined: the identity of a food for dedupe, dismissal and coverage. */
    id: string;
    /** Singular display and dismissal key. */
    canonical: string;
    foodId?: string;
};

type Vocabulary = {
    byId: Map<string, IndexedEntry>;
    byFirstWord: Map<string, IndexedEntry[]>;
};

/**
 * One index of bundled words plus the household's names. A household food
 * wins over a bundled word with the same words (it carries the food id) but
 * takes the bundled word's singular spelling, so "Eggs" and "egg" are one
 * key.
 */
function buildVocabulary(catalog: readonly MentionVocabEntry[]): Vocabulary {
    const byId = new Map<string, IndexedEntry>();
    for (const word of BUNDLED_MENTION_WORDS) {
        const words = matchWords(word);
        if (words.length === 0) continue;
        const id = words.join(" ");
        byId.set(id, { words, id, canonical: looseFoodKey(fold(word)) });
    }
    for (const entry of catalog) {
        const words = matchWords(entry.name);
        if (words.length === 0) continue;
        const id = words.join(" ");
        const bundled = byId.get(id);
        byId.set(id, {
            words,
            id,
            canonical: bundled?.canonical ?? looseFoodKey(fold(entry.name)),
            ...(entry.foodId !== undefined ? { foodId: entry.foodId } : {}),
        });
    }
    const byFirstWord = new Map<string, IndexedEntry[]>();
    for (const entry of byId.values()) {
        const first = entry.words[0]!;
        const list = byFirstWord.get(first) ?? [];
        list.push(entry);
        byFirstWord.set(first, list);
    }
    for (const list of byFirstWord.values()) {
        list.sort((a, b) => b.words.length - a.words.length);
    }
    return { byId, byFirstWord };
}

/** The bundled words by identity, to read a typed key the way the detector would. */
const BUNDLED_CANONICAL: ReadonlyMap<string, string> = (() => {
    const out = new Map<string, string>();
    for (const word of BUNDLED_MENTION_WORDS) {
        const id = idOf(word);
        if (id) out.set(id, looseFoodKey(fold(word)));
    }
    return out;
})();

/**
 * The key a warning for `text` carries, whatever spelling `text` is in:
 * "EGGS", " Egg " and "egg" are all "egg". A bundled food maps to its singular
 * spelling; any other name is its own loose form. Dismissals are stored and
 * matched through this.
 */
export function mentionKey(text: string): string {
    return BUNDLED_CANONICAL.get(idOf(text)) ?? looseFoodKey(fold(text));
}

function isNeverFlagged(entry: IndexedEntry): boolean {
    if (entry.words.some((word) => NEVER_FLAGGED.has(word))) return true;
    return entry.words.length === 1 && NOT_FOOD_STEMS.has(entry.id);
}

type Pantry = {
    foodIds: Set<string>;
    /** Each ingredient name as " word word ", for whole-word run lookups. */
    names: string[];
};

function buildPantry(ingredients: readonly MentionIngredient[]): Pantry {
    const foodIds = new Set<string>();
    const names: string[] = [];
    for (const ingredient of ingredients) {
        if (ingredient.foodId != null) foodIds.add(ingredient.foodId);
        for (const name of [ingredient.name, ingredient.foodName]) {
            if (!name) continue;
            names.push(` ${matchWords(name).join(" ")} `);
        }
    }
    return { foodIds, names };
}

const listsRun = (pantry: Pantry, words: readonly string[]): boolean => {
    const needle = ` ${words.join(" ")} `;
    return pantry.names.some((name) => name.includes(needle));
};

/**
 * An ingredient covers a mention when the mention's words are a contiguous
 * run in the ingredient's line name or its food's name, when both point at
 * the same catalog food, when a listed food is a kind of the mention ("the
 * pasta" and a listed "spaghetti"), or when the mention ends in a shorter
 * food that is covered ("kosher salt" and a listed "salt"), or when it is a
 * part of a listed whole ("lime juice" and a listed "lime"). Deliberately
 * loose: a listed "egg noodles" also covers a bare "egg", because a missed
 * warning costs less than a false one.
 */
function isCovered(
    pantry: Pantry,
    vocabulary: Vocabulary,
    entry: IndexedEntry,
): boolean {
    if (entry.foodId !== undefined && pantry.foodIds.has(entry.foodId)) {
        return true;
    }
    if (listsRun(pantry, entry.words)) return true;
    for (const kind of KINDS_BY_HEAD.get(entry.id) ?? []) {
        if (listsRun(pantry, kind)) return true;
    }
    if (entry.words.length > 1 && PART_STEMS.has(entry.words.at(-1)!)) {
        const head = entry.words.slice(0, -1);
        const whole = vocabulary.byId.get(head.join(" "));
        if (
            whole
                ? isCovered(pantry, vocabulary, whole)
                : listsRun(pantry, head)
        ) {
            return true;
        }
    }
    if (OWN_FOOD_IDS.has(entry.id)) return false;
    for (let from = 1; from < entry.words.length; from++) {
        const tail = vocabulary.byId.get(entry.words.slice(from).join(" "));
        if (tail && isCovered(pantry, vocabulary, tail)) return true;
    }
    return false;
}

function sentenceAt(
    step: string,
    index: number,
): { text: string; start: number } {
    const re = /[.!?;]+(?=\s|$)/g;
    let start = 0;
    for (const m of step.matchAll(re)) {
        const end = m.index + m[0].length;
        if (index < end) return { text: step.slice(start, end), start };
        start = end;
    }
    return { text: step.slice(start), start };
}

/**
 * The sentence clipped to a readable length around the mention, and where the
 * mention starts inside the clipped text.
 */
function clipExcerpt(
    sentence: string,
    mentionAt: number,
): { text: string; at: number } {
    const lead = sentence.length - sentence.trimStart().length;
    const text = sentence.trim();
    const pos = Math.max(0, mentionAt - lead);
    if (text.length <= EXCERPT_MAX) return { text, at: pos };
    let from = Math.max(0, pos - Math.floor(EXCERPT_MAX / 2));
    const to0 = Math.min(text.length, from + EXCERPT_MAX);
    from = Math.max(0, to0 - EXCERPT_MAX);
    let to = to0;
    // Snap to word edges so the clip never cuts a word or the mention.
    if (from > 0) {
        const space = text.indexOf(" ", from);
        if (space !== -1 && space < pos) from = space + 1;
    }
    if (to < text.length) {
        const space = text.lastIndexOf(" ", to);
        if (space > pos) to = space;
    }
    const ellipsis = from > 0 ? "…" : "";
    return {
        text: `${ellipsis}${text.slice(from, to)}${to < text.length ? "…" : ""}`,
        at: ellipsis.length + pos - from,
    };
}

const isFraction = (token: string): boolean =>
    token in UNICODE_FRACTIONS || /^\d+\/\d+$/.test(token);

/** The amount whose last token is `tokens[i]`: "1 1/2" is 1.5, "2-3" is 2. */
function amountEndingAt(
    tokens: readonly Token[],
    folded: string,
    i: number,
): number | null {
    const token = tokens[i]!;
    const value = numberOf(token.text);
    if (value == null) return null;
    const before = tokens[i - 1];
    if (before && !token.breakBefore) {
        const beforeValue = numberOf(before.text);
        const gap = folded.slice(before.end, token.start);
        if (
            beforeValue != null &&
            /^\d+$/.test(before.text) &&
            isFraction(token.text) &&
            value < 1 &&
            gap.trim() === ""
        ) {
            return beforeValue + value;
        }
        if (beforeValue != null && /^\s*[-–]\s*$/.test(gap)) return beforeValue;
        // "2 to 3 eggs" and "2 or 3 eggs": the low end.
        const low = tokens[i - 2];
        if (
            low &&
            (before.text === "to" || before.text === "or") &&
            !before.breakBefore
        ) {
            const lowValue = numberOf(low.text);
            if (lowValue != null) return lowValue;
        }
    }
    return value;
}

function amountAndNote(
    tokens: readonly Token[],
    folded: string,
    firstToken: number,
    afterToken: number,
): { amount: number | null; note: string | null } {
    // Token `i` leads into token `i + 1` unless a break sits between them.
    const leadsIn = (i: number) => !tokens[i + 1]!.breakBefore;
    let i = firstToken - 1;
    const noteWords: string[] = [];
    while (
        i >= 0 &&
        leadsIn(i) &&
        noteWords.length < 3 &&
        NOTE_WORDS.has(tokens[i]!.text)
    ) {
        noteWords.unshift(tokens[i]!.text);
        i--;
    }
    // "3 garlic cloves": the 3 counts cloves, so it is no amount of garlic.
    const after = tokens[afterToken];
    const measured =
        after !== undefined &&
        !after.breakBefore &&
        MEASURE_WORDS.has(plainWords(after.text)[0] ?? after.text);
    const amount =
        !measured && i >= 0 && leadsIn(i)
            ? amountEndingAt(tokens, folded, i)
            : null;
    return {
        amount: amount != null && amount > 0 ? amount : null,
        note: noteWords.length > 0 ? noteWords.join(" ") : null,
    };
}

/**
 * A word the vocabulary knows that the step is not using as a food: the cream
 * in "ice cream", a verb ("cream the butter"), the colour orange, "the sake
 * of". Quiet is the safe answer, so these lean towards skipping.
 */
function isNotUsedAsFood(
    entry: IndexedEntry,
    units: readonly Unit[],
    tokens: readonly Token[],
    at: number,
): boolean {
    const unit = units[at]!;
    const rawOf = (u: Unit) => tokens[u.first]!.text;
    const prev =
        at > 0 && !tokens[unit.first]!.breakBefore ? units[at - 1] : undefined;
    const nextUnit = units[at + entry.words.length];
    const next =
        nextUnit && !tokens[nextUnit.first]!.breakBefore ? nextUnit : undefined;
    if (prev && NEVER_FLAGGED.has(prev.word)) return true;
    if (entry.id === "sake") {
        return (
            prev !== undefined &&
            rawOf(prev) === "the" &&
            next !== undefined &&
            rawOf(next) === "of"
        );
    }
    if (entry.words.length !== 1) return false;
    if (VERB_LIKE_STEMS.has(entry.id) && next) {
        if (OBJECT_OPENERS.has(rawOf(next))) return true;
        const startsClause = at === 0 || tokens[unit.first]!.breakBefore;
        if (startsClause && rawOf(next) !== "and" && rawOf(next) !== "or") {
            return true;
        }
    }
    if (entry.id === "orange" && tokens[unit.first]!.text !== "oranges") {
        return !(
            prev &&
            (ORANGE_LEADS.has(rawOf(prev)) ||
                numberOf(tokens[prev.last]!.text) != null)
        );
    }
    return false;
}

export function findMissingMentions(input: {
    instructions: string | null;
    ingredients: readonly MentionIngredient[];
    vocabulary: readonly MentionVocabEntry[];
    dismissed?: readonly string[];
}): MentionWarning[] {
    const vocabulary = buildVocabulary(input.vocabulary);
    const pantry = buildPantry(input.ingredients);
    const dismissed = new Set((input.dismissed ?? []).map(idOf));
    const seen = new Set<string>();
    const warnings: MentionWarning[] = [];

    for (const [stepIndex, raw] of recipeSteps(input.instructions).entries()) {
        const step = raw.normalize("NFC");
        const folded = fold(step);
        const tokens = tokenize(folded);
        const units = collapse(
            tokens.map((t) => plainWords(t.text)[0] ?? t.text),
            (i) => !tokens[i]!.breakBefore,
        );
        let at = 0;
        while (at < units.length) {
            const entry = vocabulary.byFirstWord
                .get(units[at]!.word)
                ?.find((c) =>
                    c.words.every(
                        (w, k) =>
                            units[at + k]?.word === w &&
                            (k === 0 ||
                                !tokens[units[at + k]!.first]!.breakBefore),
                    ),
                );
            if (!entry) {
                at++;
                continue;
            }
            const here = at;
            at += entry.words.length;
            if (
                seen.has(entry.id) ||
                isNeverFlagged(entry) ||
                dismissed.has(entry.id) ||
                isNotUsedAsFood(entry, units, tokens, here) ||
                isCovered(pantry, vocabulary, entry)
            ) {
                continue;
            }
            seen.add(entry.id);
            const first = units[here]!.first;
            const last = units[here + entry.words.length - 1]!.last;
            const mentionAt = tokens[first]!.start;
            const mentionEnd = tokens[last]!.end;
            const sentence = sentenceAt(step, mentionAt);
            const { amount, note } = amountAndNote(
                tokens,
                folded,
                first,
                last + 1,
            );
            const excerpt = clipExcerpt(
                sentence.text,
                mentionAt - sentence.start,
            );
            warnings.push({
                food: entry.canonical,
                key: entry.canonical,
                ...(entry.foodId !== undefined ? { foodId: entry.foodId } : {}),
                excerpt: excerpt.text,
                stepIndex,
                start: mentionAt,
                end: mentionEnd,
                excerptStart: excerpt.at,
                excerptEnd: excerpt.at + (mentionEnd - mentionAt),
                amount,
                note,
                message: `The steps mention ${entry.canonical}, which isn't an ingredient.`,
            });
        }
    }
    return warnings;
}
