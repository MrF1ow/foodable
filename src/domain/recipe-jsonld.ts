export type JsonLdRecipe = {
    name: string | null;
    ingredients: string[];
    instructions: string[];
    sections: { name: string; steps: string[] }[] | null;
    yieldPortions: number | null;
    yieldText: string | null;
    prepMinutes: number | null;
    cookMinutes: number | null;
    totalMinutes: number | null;
    keywords: string[];
};

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    frac12: "½",
    deg: "°",
    ndash: "–",
    mdash: "—",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    hellip: "…",
};

function codePointChar(code: number): string {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
    // Lone surrogates are not characters.
    if (code >= 0xd800 && code <= 0xdfff) return "";
    try {
        return String.fromCodePoint(code);
    } catch {
        return "";
    }
}

function decodeOnce(text: string): string {
    let out = text.replace(/&#(\d+);/g, (_, code) =>
        codePointChar(Number(code)),
    );
    out = out.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        codePointChar(parseInt(hex, 16)),
    );
    return out.replace(
        /&([a-z][a-z0-9]*);/gi,
        (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

/** Decode entities until the text stops changing (twice-escaped `&amp;#39;`
 *  included), with a pass cap so no input can loop. Unknown or malformed
 *  entities (`&frac;`, `&#;`) are left as they are. */
function decodeEntities(text: string): string {
    let out = text.replace(/<[^>]+>/g, " ");
    for (let pass = 0; pass < 4; pass++) {
        const next = decodeOnce(out);
        if (next === out) break;
        out = next;
    }
    out = out.replace(/<[^>]+>/g, " ");
    return out.replace(/\s+/g, " ").trim();
}

function normalizeType(value: unknown): string[] {
    if (typeof value === "string") {
        return [stripType(value)];
    }
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === "string")
            .map(stripType);
    }
    return [];
}

function stripType(type: string): string {
    return type
        .replace(/^https?:\/\/schema\.org\//i, "")
        .replace(/^schema:/i, "")
        .trim();
}

function isRecipeNode(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    const types = normalizeType((node as Record<string, unknown>)["@type"]);
    return types.some((t) => t.toLowerCase() === "recipe");
}

function recipeIngredientCount(node: Record<string, unknown>): number {
    const modern = node.recipeIngredient;
    const legacy = node.ingredients;
    const list = Array.isArray(modern)
        ? modern
        : Array.isArray(legacy)
          ? legacy
          : typeof modern === "string"
            ? [modern]
            : typeof legacy === "string"
              ? [legacy]
              : [];
    return list.filter((line) => String(line).trim()).length;
}

function collectNodes(value: unknown, out: Record<string, unknown>[]): void {
    if (!value) return;
    if (Array.isArray(value)) {
        for (const item of value) {
            collectNodes(item, out);
        }
        return;
    }
    if (typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (isRecipeNode(obj)) {
        out.push(obj);
    }
    if (obj["@graph"]) {
        collectNodes(obj["@graph"], out);
    }
    for (const key of Object.keys(obj)) {
        if (key === "@graph") continue;
        const child = obj[key];
        if (child && typeof child === "object") {
            collectNodes(child, out);
        }
    }
}

function pickRecipe(
    nodes: Record<string, unknown>[],
): Record<string, unknown> | null {
    if (nodes.length === 0) return null;
    const withIngredients = nodes.filter((n) => recipeIngredientCount(n) > 0);
    return withIngredients[0] ?? nodes[0] ?? null;
}

function parseYieldValue(value: unknown): {
    portions: number | null;
    text: string | null;
} {
    if (value == null) return { portions: null, text: null };
    if (typeof value === "number" && Number.isFinite(value)) {
        return { portions: Math.round(value), text: null };
    }
    if (Array.isArray(value)) {
        let portions: number | null = null;
        let text: string | null = null;
        for (const item of value) {
            const parsed = parseYieldValue(item);
            if (portions == null && parsed.portions != null) {
                portions = parsed.portions;
            }
            if (typeof item === "string" && /\D/.test(item)) {
                text = decodeEntities(item.trim());
            } else if (parsed.text && /\D/.test(parsed.text)) {
                text = parsed.text;
            }
        }
        return { portions, text };
    }
    if (typeof value === "string") {
        const trimmed = decodeEntities(value);
        const range = trimmed.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
        if (range) {
            return {
                portions: Math.round(Number(range[1])),
                text: trimmed,
            };
        }
        const num = trimmed.match(/(\d+(?:\.\d+)?)/);
        if (num) {
            const portions = Math.round(Number(num[1]));
            return { portions, text: trimmed };
        }
        return { portions: null, text: trimmed };
    }
    if (typeof value === "object") {
        // schema.org QuantitativeValue: { value: 4, unitText: "servings" }.
        const obj = value as Record<string, unknown>;
        const inner = parseYieldValue(obj.value);
        const unit =
            typeof obj.unitText === "string"
                ? decodeEntities(obj.unitText)
                : "";
        if (inner.portions != null) {
            return {
                portions: inner.portions,
                text: unit ? `${inner.portions} ${unit}` : inner.text,
            };
        }
    }
    return { portions: null, text: null };
}

function parseIsoDuration(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const match = value.match(
        /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
    );
    if (!match) return null;
    const days = Number(match[1] ?? 0);
    const hours = Number(match[2] ?? 0);
    const minutes = Number(match[3] ?? 0);
    const seconds = Number(match[4] ?? 0);
    const total = days * 24 * 60 + hours * 60 + minutes + seconds / 60;
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.round(total);
}

function stripStepNumbering(line: string): string {
    return line
        .replace(/^\s*\d+[\.)]\s+/, "")
        .replace(/^\s*step\s+\d+\s*:\s*/i, "")
        .trim();
}

function instructionText(value: unknown): string | null {
    if (typeof value === "string") {
        const text = decodeEntities(value);
        return text || null;
    }
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    const types = normalizeType(obj["@type"]);
    if (types.some((t) => t.toLowerCase() === "howtostep")) {
        if (typeof obj.text === "string") return decodeEntities(obj.text);
        if (typeof obj.name === "string") return decodeEntities(obj.name);
    }
    if (typeof obj.text === "string") return decodeEntities(obj.text);
    if (typeof obj.name === "string") return decodeEntities(obj.name);
    // An ItemList's ListItem can carry its step under `item`.
    if (obj.item && typeof obj.item === "object") {
        return instructionText(obj.item);
    }
    return null;
}

function parseInstructions(value: unknown): {
    steps: string[];
    sections: { name: string; steps: string[] }[] | null;
} {
    if (value == null) return { steps: [], sections: null };
    if (typeof value === "object" && !Array.isArray(value)) {
        const types = normalizeType(
            (value as Record<string, unknown>)["@type"],
        );
        if (types.some((t) => t.toLowerCase() === "itemlist")) {
            return parseInstructions([value]);
        }
    }
    if (typeof value === "string") {
        const lines = value
            .split(/\r?\n/)
            .map((line) => stripStepNumbering(decodeEntities(line)))
            .filter(Boolean);
        return { steps: lines, sections: null };
    }
    if (!Array.isArray(value)) {
        const single = instructionText(value);
        return { steps: single ? [single] : [], sections: null };
    }

    const flat: string[] = [];
    const sections: { name: string; steps: string[] }[] = [];

    for (const item of value) {
        if (typeof item === "string") {
            const line = stripStepNumbering(decodeEntities(item));
            if (line) flat.push(line);
            continue;
        }
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const types = normalizeType(obj["@type"]);
        if (types.some((t) => t.toLowerCase() === "itemlist")) {
            const elements = obj.itemListElement;
            if (Array.isArray(elements)) {
                for (const el of elements) {
                    const text = instructionText(el);
                    if (text) flat.push(stripStepNumbering(text));
                }
            }
            continue;
        }
        if (types.some((t) => t.toLowerCase() === "howtosection")) {
            const name =
                typeof obj.name === "string"
                    ? decodeEntities(obj.name)
                    : "Section";
            const sectionSteps: string[] = [];
            const elements = obj.itemListElement;
            if (Array.isArray(elements)) {
                for (const el of elements) {
                    const text = instructionText(el);
                    if (text) {
                        const step = stripStepNumbering(text);
                        sectionSteps.push(step);
                        flat.push(step);
                    }
                }
            }
            if (sectionSteps.length) {
                sections.push({ name, steps: sectionSteps });
            }
            continue;
        }
        const text = instructionText(item);
        if (text) flat.push(stripStepNumbering(text));
    }

    return {
        steps: flat,
        sections: sections.length ? sections : null,
    };
}

function parseIngredients(node: Record<string, unknown>): string[] {
    const raw = node.recipeIngredient ?? node.ingredients;
    if (raw == null) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list
        .map((item) => {
            if (typeof item === "string") return decodeEntities(item);
            if (item && typeof item === "object") {
                const obj = item as Record<string, unknown>;
                if (typeof obj.name === "string")
                    return decodeEntities(obj.name);
            }
            return decodeEntities(String(item));
        })
        .filter(Boolean);
}

function parseKeywords(value: unknown): string[] {
    if (value == null) return [];
    if (typeof value === "string") {
        return value
            .split(/[,;]/)
            .map((k) => decodeEntities(k))
            .filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value
            .map((k) => (typeof k === "string" ? decodeEntities(k) : ""))
            .filter(Boolean);
    }
    return [];
}

function parseJsonLdBlock(raw: string): unknown {
    let text = raw.trim();
    if (text.endsWith(";")) text = text.slice(0, -1).trim();
    if (text.startsWith("<!--")) {
        // HTML also ends a comment with "--!>".
        text = text.replace(/^<!--\s*/, "").replace(/\s*--!?>$/, "");
    }
    return JSON.parse(text);
}

const LD_JSON_SCRIPT =
    /<script[^>]*type\s*=\s*["']?\s*application\/ld\+json\s*["']?[^>]*>([\s\S]*?)<\/script>/gi;

export function readRecipeJsonLd(html: string): JsonLdRecipe | null {
    const recipeNodes: Record<string, unknown>[] = [];

    for (const match of html.matchAll(LD_JSON_SCRIPT)) {
        const block = match[1];
        if (!block) continue;
        try {
            const parsed = parseJsonLdBlock(block);
            collectNodes(parsed, recipeNodes);
        } catch {
            // skip invalid blocks
        }
    }

    const node = pickRecipe(recipeNodes);
    if (!node) return null;

    const { portions, text: yieldText } = parseYieldValue(node.recipeYield);
    const { steps, sections } = parseInstructions(node.recipeInstructions);

    return {
        name: typeof node.name === "string" ? decodeEntities(node.name) : null,
        ingredients: parseIngredients(node),
        instructions: steps,
        sections,
        yieldPortions: portions,
        yieldText,
        prepMinutes: parseIsoDuration(node.prepTime),
        cookMinutes: parseIsoDuration(node.cookTime),
        totalMinutes: parseIsoDuration(node.totalTime),
        keywords: parseKeywords(node.keywords),
    };
}
