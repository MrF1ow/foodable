import { TOASTS, type ToastKey } from "../copy/toasts.js";
import type { FetchFailure } from "../fetch-safe.js";
import type { SafeFetcher } from "../fetch-safe.js";
import {
    findOrCreateManualFood,
    FoodsInputError,
    type FoodsStore,
} from "./foods.js";
import { storedFoodUnit } from "./food-quantity.js";
import { parseIngredientLines } from "./ingredient-lines.js";
import {
    cleanRecipeLink,
    recipeSource,
    validateRecipeLink,
} from "./recipe-link.js";
import { readRecipeJsonLd } from "./recipe-jsonld.js";
export { NOT_MEASURED_PHRASES, isNotMeasuredNote } from "./not-measured.js";
import { isNotMeasuredNote } from "./not-measured.js";
import type { Recipe, RecipeIngredient, RecipesStore } from "./recipes.js";
import { createRecipe, RecipeInputError, recipeSteps } from "./recipes.js";

export type RecipeVerification = "verified" | "unverified";

export type RecipeSourceKind =
    | "website"
    | "instagram"
    | "facebook"
    | "threads"
    | "tiktok"
    | "pinterest"
    | "youtube"
    | "text";

export type RecipeTextOrigin = "pasted" | "shared" | "read";

export type RecipeProblemCode =
    | "no_name"
    | "no_ingredients"
    | "ingredient_no_food"
    | "ingredient_no_amount"
    | "unresolved_lines"
    | "no_instructions";

export type RecipeProblem = {
    code: RecipeProblemCode;
    message: string;
    ingredientId: string | null;
    line: string | null;
};

export type RecipeImport = {
    recipeId: string;
    householdId: string;
    sourceKind: RecipeSourceKind;
    sourceUrl: string | null;
    sourceText: string | null;
    sourceTextOrigin: RecipeTextOrigin | null;
    transcript: string | null;
    credit: string | null;
    unresolvedLines: string[];
    problems: RecipeProblem[];
    importedAt: string;
};

export class RecipeUnverifiedError extends Error {
    readonly code = "recipe_unverified" as const;

    constructor(recipeName: string, firstProblem: string) {
        super(
            `${recipeName} is unverified: ${firstProblem}. Fix it, then check again.`,
        );
        this.name = "RecipeUnverifiedError";
    }
}

function ingredientAmountOk(ingredient: RecipeIngredient): boolean {
    if (ingredient.quantity != null) return true;
    return isNotMeasuredNote(ingredient.note);
}

export function verifyRecipe(
    recipe: Recipe,
    ingredients: RecipeIngredient[],
    importRow: RecipeImport | null,
): { verified: boolean; problems: RecipeProblem[] } {
    const problems: RecipeProblem[] = [];

    if (!recipe.name.trim()) {
        problems.push({
            code: "no_name",
            message: "Add a recipe name.",
            ingredientId: null,
            line: null,
        });
    }

    if (ingredients.length === 0) {
        problems.push({
            code: "no_ingredients",
            message: "Add at least one ingredient.",
            ingredientId: null,
            line: null,
        });
    }

    for (const ingredient of ingredients) {
        if (!ingredient.foodId) {
            problems.push({
                code: "ingredient_no_food",
                message: `${ingredient.displayName} is not linked to a food.`,
                ingredientId: ingredient.id,
                line: null,
            });
        }
        if (!ingredientAmountOk(ingredient)) {
            problems.push({
                code: "ingredient_no_amount",
                message: `${ingredient.displayName} has no amount. Add one, or note "to taste".`,
                ingredientId: ingredient.id,
                line: null,
            });
        }
    }

    if (importRow) {
        for (const line of importRow.unresolvedLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            problems.push({
                code: "unresolved_lines",
                message: `"${trimmed}" couldn't be read as an ingredient.`,
                ingredientId: null,
                line: trimmed,
            });
        }
    }

    if (recipeSteps(recipe.instructions).length === 0) {
        problems.push({
            code: "no_instructions",
            message: "Add the steps.",
            ingredientId: null,
            line: null,
        });
    }

    return { verified: problems.length === 0, problems };
}

export async function recheckRecipe(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
): Promise<{
    verified: boolean;
    problems: RecipeProblem[];
    verification: RecipeVerification;
}> {
    const recipe = await store.getRecipe(householdId, recipeId);
    if (!recipe) {
        throw new RecipeInputError("Unknown recipe.");
    }
    const ingredients = await store.listIngredients(householdId, recipeId);
    const importRow = await store.getImport(householdId, recipeId);
    const result = verifyRecipe(recipe, ingredients, importRow);
    // A recipe with no import row was made by a person, who is the source:
    // the plan keeps hand-made recipes verified. The check still reports what
    // it found, but it never demotes them.
    if (!importRow && recipe.verification === "verified") {
        return { ...result, verification: "verified" };
    }
    const verification: RecipeVerification = result.verified
        ? "verified"
        : "unverified";
    await store.setVerification(
        householdId,
        recipeId,
        verification,
        result.problems,
    );
    return { ...result, verification };
}

export async function assertRecipeVerified(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
): Promise<void> {
    const recipe = await store.getRecipe(householdId, recipeId);
    if (!recipe || recipe.verification === "verified") return;
    const ingredients = await store.listIngredients(householdId, recipeId);
    const importRow = await store.getImport(householdId, recipeId);
    const { problems } = verifyRecipe(recipe, ingredients, importRow);
    const first = problems[0]?.message ?? "It did not pass the check.";
    throw new RecipeUnverifiedError(recipe.name, first);
}

export function recipeImportFromRow(row: {
    recipe_id: unknown;
    household_id: unknown;
    source_kind: unknown;
    source_url?: unknown;
    source_text?: unknown;
    source_text_origin?: unknown;
    transcript?: unknown;
    credit?: unknown;
    unresolved_lines?: unknown;
    problems?: unknown;
    imported_at: unknown;
}): RecipeImport {
    return {
        recipeId: String(row.recipe_id),
        householdId: String(row.household_id),
        sourceKind: String(row.source_kind) as RecipeSourceKind,
        sourceUrl:
            row.source_url == null || row.source_url === ""
                ? null
                : String(row.source_url),
        sourceText:
            row.source_text == null || row.source_text === ""
                ? null
                : String(row.source_text),
        sourceTextOrigin:
            row.source_text_origin == null || row.source_text_origin === ""
                ? null
                : (String(row.source_text_origin) as RecipeTextOrigin),
        transcript:
            row.transcript == null || row.transcript === ""
                ? null
                : String(row.transcript),
        credit:
            row.credit == null || row.credit === "" ? null : String(row.credit),
        unresolvedLines: parseStringArray(row.unresolved_lines),
        problems: parseProblems(row.problems),
        importedAt: String(row.imported_at),
    };
}

export function recipeImportToRow(row: RecipeImport) {
    return {
        recipe_id: row.recipeId,
        household_id: row.householdId,
        source_kind: row.sourceKind,
        source_url: row.sourceUrl,
        source_text: row.sourceText,
        source_text_origin: row.sourceTextOrigin,
        transcript: row.transcript,
        credit: row.credit,
        unresolved_lines: row.unresolvedLines,
        problems: row.problems,
        imported_at: row.importedAt,
    };
}

function parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item));
}

function parseProblems(value: unknown): RecipeProblem[] {
    if (!Array.isArray(value)) return [];
    const out: RecipeProblem[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (typeof row.code !== "string" || typeof row.message !== "string") {
            continue;
        }
        out.push({
            code: row.code as RecipeProblemCode,
            message: row.message,
            ingredientId:
                row.ingredientId == null && row.ingredient_id == null
                    ? null
                    : String(row.ingredientId ?? row.ingredient_id),
            line: row.line == null || row.line === "" ? null : String(row.line),
        });
    }
    return out;
}

export type RecipeImportStatus =
    | "imported"
    | "unverified_needs_review"
    | "paste_needed"
    | "no_recipe_in_text"
    | "no_recipe_on_page"
    | "robots_disallowed"
    | "site_refused"
    | "not_found"
    | "timeout"
    | "duplicate"
    | "invalid_link";

export type RecipeImportOutcome = {
    status: RecipeImportStatus;
    recipeId: string | null;
    recipeName: string | null;
    verification: RecipeVerification | null;
    problems: RecipeProblem[];
    source: {
        kind: RecipeSourceKind;
        url: string | null;
        label: string;
    } | null;
    unresolvedLines: string[];
    readerFailure: string | null;
};

export function outcomeFromFetchFailure(
    reason: FetchFailure,
): RecipeImportStatus {
    switch (reason) {
        case "robots_disallowed":
            return "robots_disallowed";
        case "site_refused":
            return "site_refused";
        case "not_found":
            return "not_found";
        case "timeout":
        case "network_error":
            return "timeout";
        case "invalid_link":
        case "blocked_address":
            return "invalid_link";
        case "too_large":
        case "bad_content_type":
            return "no_recipe_on_page";
        case "http_error":
        case "too_many_redirects":
            return "site_refused";
    }
}

function emptyOutcome(
    status: RecipeImportStatus,
    partial: Partial<RecipeImportOutcome> = {},
): RecipeImportOutcome {
    return {
        status,
        recipeId: null,
        recipeName: null,
        verification: null,
        problems: [],
        source: null,
        unresolvedLines: [],
        readerFailure: null,
        ...partial,
    };
}

function sourceFromInfo(
    info: ReturnType<typeof recipeSource>,
    url: string | null,
): RecipeImportOutcome["source"] {
    return { kind: info.kind, url, label: info.label };
}

export function importReviewCount(problems: RecipeProblem[]): string {
    const ingredientIds = new Set<string>();
    let looseIngredients = 0;
    for (const problem of problems) {
        if (
            problem.code === "ingredient_no_food" ||
            problem.code === "ingredient_no_amount"
        ) {
            if (problem.ingredientId) ingredientIds.add(problem.ingredientId);
            else looseIngredients += 1;
        }
    }
    const ingredientTotal = ingredientIds.size + looseIngredients;
    if (ingredientTotal > 0) {
        return ingredientTotal === 1
            ? "1 ingredient"
            : `${ingredientTotal} ingredients`;
    }
    const lineCount = problems.filter(
        (p) => p.code === "unresolved_lines",
    ).length;
    if (lineCount > 0) {
        return lineCount === 1 ? "1 line" : `${lineCount} lines`;
    }
    if (problems.some((p) => p.code === "no_instructions")) return "the steps";
    if (problems.some((p) => p.code === "no_name")) return "the name";
    if (problems.some((p) => p.code === "no_ingredients")) {
        return "the ingredients";
    }
    const n = problems.length;
    return n === 1 ? "1 problem" : `${n} problems`;
}

function importReviewUsesSingularVerb(countPhrase: string): boolean {
    return (
        countPhrase === "1 ingredient" ||
        countPhrase === "1 line" ||
        countPhrase === "the name" ||
        countPhrase === "1 problem"
    );
}

function fillToastTemplate(
    template: string,
    params: Record<string, string>,
): string {
    return template.replace(
        /\{([a-z_][a-z0-9_]*)\}/gi,
        (match, name: string) => params[name] ?? match,
    );
}

export function importOutcomeToastKey(outcome: RecipeImportOutcome): ToastKey {
    if (outcome.status === "unverified_needs_review") {
        const count = importReviewCount(outcome.problems);
        return importReviewUsesSingularVerb(count)
            ? "recipes.import.unverified_needs_review_one"
            : "recipes.import.unverified_needs_review";
    }
    if (outcome.status === "paste_needed") {
        if (outcome.readerFailure) {
            return "recipes.import.paste_needed_reader";
        }
        if (outcome.source?.kind === "website") {
            return "recipes.import.paste_needed_site";
        }
    }
    return `recipes.import.${outcome.status}` as ToastKey;
}

export function importRecipeFromUrlAnalyticsOutcome(
    status: RecipeImportStatus | undefined,
): { success: true } | { success: false; errorCategory: "recipe_import" } {
    const ok =
        status === "imported" ||
        status === "unverified_needs_review" ||
        status === "duplicate" ||
        status === "paste_needed" ||
        status === "no_recipe_in_text";
    return ok
        ? { success: true }
        : { success: false, errorCategory: "recipe_import" };
}

export function importOutcomeMessage(outcome: RecipeImportOutcome): string {
    const key = importOutcomeToastKey(outcome);
    const template = TOASTS[key].text;
    const params: Record<string, string> = {};
    if (outcome.recipeName) params.name = outcome.recipeName;
    if (outcome.source?.label) {
        params.site = outcome.source.label;
        params.platform = outcome.source.label;
    }
    if (outcome.status === "unverified_needs_review") {
        params.count = importReviewCount(outcome.problems);
    }
    if (outcome.readerFailure) params.reason = outcome.readerFailure;
    return fillToastTemplate(template, params);
}

const SOCIAL_KINDS = new Set<RecipeSourceKind>([
    "instagram",
    "facebook",
    "threads",
    "tiktok",
    "pinterest",
    "youtube",
]);

function isSocialSource(kind: RecipeSourceKind): boolean {
    return SOCIAL_KINDS.has(kind);
}

export function recipeDisplaySource(
    recipe: Pick<Recipe, "sourceUrl">,
    importRow: Pick<RecipeImport, "sourceKind" | "sourceUrl"> | null,
): { kind: RecipeSourceKind; label: string; url: string } | null {
    const url = importRow?.sourceUrl ?? recipe.sourceUrl;
    if (!url) return null;
    try {
        const info = recipeSource(new URL(url));
        return {
            kind: importRow?.sourceKind ?? info.kind,
            label: info.label,
            url,
        };
    } catch {
        return null;
    }
}

export async function importRecipeFromUrl(
    deps: {
        recipes: RecipesStore;
        foods: FoodsStore;
        fetcher: SafeFetcher;
        transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
        pasteOnlySites?: readonly string[];
    },
    input: { householdId: string; creatorId: string; url: string },
): Promise<RecipeImportOutcome> {
    const validated = validateRecipeLink(input.url);
    if (!validated.ok) {
        return emptyOutcome("invalid_link");
    }

    const cleaned = cleanRecipeLink(validated.url);
    const rawTrimmed = input.url.trim();
    const duplicate = await deps.recipes.findRecipeBySourceUrl(
        input.householdId,
        [cleaned, rawTrimmed],
    );
    if (duplicate) {
        return emptyOutcome("duplicate", {
            recipeId: duplicate.id,
            recipeName: duplicate.name,
            source: duplicate.sourceUrl
                ? sourceFromInfo(
                      recipeSource(new URL(duplicate.sourceUrl)),
                      duplicate.sourceUrl,
                  )
                : null,
        });
    }

    const sourceInfo = recipeSource(validated.url);
    const pasteOnlyList = deps.pasteOnlySites ?? [];
    const pasteOnlyHost =
        sourceInfo.pasteOnly ||
        pasteOnlyList.some((entry) => {
            const host = validated.url.hostname.toLowerCase();
            const e = entry.toLowerCase();
            return host === e || host.endsWith(`.${e}`);
        });

    if (isSocialSource(sourceInfo.kind) || pasteOnlyHost) {
        return emptyOutcome("paste_needed", {
            source: sourceFromInfo(sourceInfo, cleaned),
        });
    }

    const allowed = await deps.fetcher.robotsAllows(cleaned);
    if (!allowed) {
        return emptyOutcome("robots_disallowed", {
            source: sourceFromInfo(sourceInfo, cleaned),
        });
    }

    const fetched = await deps.fetcher.fetchPage(cleaned, {
        accept: ["text/html", "application/xhtml+xml"],
    });
    if (!fetched.ok) {
        return emptyOutcome(outcomeFromFetchFailure(fetched.reason), {
            source: sourceFromInfo(sourceInfo, cleaned),
        });
    }

    const jsonld = readRecipeJsonLd(fetched.body);
    if (!jsonld) {
        return emptyOutcome("no_recipe_on_page", {
            source: sourceFromInfo(sourceInfo, cleaned),
        });
    }

    const prepared = prepareImportedRecipe({
        name: jsonld.name,
        fallbackName: sourceInfo.label,
        yieldPortions: jsonld.yieldPortions,
        steps: jsonld.instructions,
        prepMinutes: jsonld.prepMinutes,
        cookMinutes: jsonld.cookMinutes,
        parsed: parseIngredientLines(jsonld.ingredients),
    });
    const parsed = prepared.parsed;
    const instructions = prepared.instructions;
    const recipeName = prepared.name;

    const runTx = deps.transaction ?? ((fn) => fn());

    // Values were clamped above, so an input error here is unexpected; it
    // still becomes an outcome rather than a 500 or an MCP isError.
    try {
        return await runTx(async () => {
            const resolved: {
                item: (typeof parsed.items)[number];
                food: Awaited<ReturnType<typeof findOrCreateManualFood>>;
            }[] = [];

            for (const item of parsed.items) {
                const food = await findOrCreateManualFood(
                    deps.foods,
                    input.householdId,
                    "food",
                    item.name,
                );
                resolved.push({ item, food });
            }

            const recipe = await createRecipe(deps.recipes, {
                householdId: input.householdId,
                creatorId: input.creatorId,
                name: recipeName,
                yieldPortions: prepared.yieldPortions,
                instructions,
                sourceUrl: cleaned,
                prepMinutes: prepared.prepMinutes,
                cookMinutes: prepared.cookMinutes,
                verification: "unverified",
            });

            const importedAt = new Date().toISOString();
            await deps.recipes.upsertImport({
                recipeId: recipe.id,
                householdId: input.householdId,
                sourceKind: "website",
                sourceUrl: cleaned,
                sourceText: null,
                sourceTextOrigin: null,
                transcript: null,
                credit: null,
                unresolvedLines: parsed.unresolved,
                problems: [],
                importedAt,
            });

            const ingredients: RecipeIngredient[] = [];
            for (const [index, row] of resolved.entries()) {
                const storedQuantity =
                    row.item.quantity == null
                        ? null
                        : {
                              amount: row.item.quantity.amount,
                              unit: storedFoodUnit(
                                  row.item.quantity.unit,
                                  row.food,
                              ),
                          };
                ingredients.push(
                    await deps.recipes.insertIngredient({
                        id: crypto.randomUUID(),
                        householdId: input.householdId,
                        recipeId: recipe.id,
                        kind: "food",
                        displayName: row.food.name,
                        quantity: storedQuantity,
                        foodId: row.food.id,
                        sortOrder: index,
                        note: row.item.note,
                    }),
                );
            }

            const checked = await recheckRecipe(
                deps.recipes,
                input.householdId,
                recipe.id,
            );

            const status: RecipeImportStatus = checked.verified
                ? "imported"
                : "unverified_needs_review";

            return emptyOutcome(status, {
                recipeId: recipe.id,
                recipeName: recipe.name,
                verification: checked.verification,
                problems: checked.problems,
                source: sourceFromInfo(sourceInfo, cleaned),
                unresolvedLines: parsed.unresolved,
            });
        });
    } catch (err) {
        if (err instanceof RecipeInputError || err instanceof FoodsInputError) {
            return emptyOutcome("no_recipe_on_page", {
                source: sourceFromInfo(sourceInfo, cleaned),
            });
        }
        throw err;
    }
}

/** Limits shared with the editors, so an imported recipe can always be
 *  edited and saved as it came in. */
export const IMPORT_LIMITS = {
    recipeName: 80,
    foodName: 120,
    note: 500,
    instructions: 20_000,
    maxYield: 1000,
    maxMinutes: 10_080,
} as const;

function clip(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function hasLetterOrDigit(text: string | null | undefined): boolean {
    return /[\p{L}\p{N}]/u.test(text ?? "");
}

function boundedMinutes(value: number | null): number | null {
    if (value == null || !Number.isFinite(value)) return null;
    const minutes = Math.round(value);
    return minutes >= 0 && minutes <= IMPORT_LIMITS.maxMinutes ? minutes : null;
}

/**
 * Clamp what a page or caption gave us to what the recipe editors and the
 * database accept: a yield of 0 or a billion becomes 1, an absurd duration
 * is dropped, long text is clipped, a line whose name is blank and a line
 * with a non-positive amount go to unresolved instead of creating a food or
 * breaking the amount > 0 check. Pure.
 */
export function prepareImportedRecipe(input: {
    name: string | null;
    fallbackName: string;
    yieldPortions: number | null;
    steps: string[];
    prepMinutes: number | null;
    cookMinutes: number | null;
    parsed: ReturnType<typeof parseIngredientLines>;
}): {
    name: string;
    yieldPortions: number;
    instructions: string | null;
    prepMinutes: number | null;
    cookMinutes: number | null;
    parsed: ReturnType<typeof parseIngredientLines>;
} {
    const rawName = input.name?.trim() ?? "";
    const name = clip(
        hasLetterOrDigit(rawName) ? rawName : input.fallbackName,
        IMPORT_LIMITS.recipeName,
    );
    const yieldRaw = input.yieldPortions;
    const yieldPortions =
        yieldRaw != null &&
        Number.isFinite(yieldRaw) &&
        yieldRaw >= 1 &&
        yieldRaw <= IMPORT_LIMITS.maxYield
            ? Math.round(yieldRaw)
            : 1;
    const joined = input.steps
        .map((step) => step.trim())
        .filter((step) => step.length > 0)
        .join("\n");
    const instructions = joined
        ? clip(joined, IMPORT_LIMITS.instructions)
        : null;
    const unresolved = [...input.parsed.unresolved];
    const items: typeof input.parsed.items = [];
    for (const item of input.parsed.items) {
        const itemName = item.name.trim();
        if (
            !hasLetterOrDigit(itemName) ||
            (item.quantity != null && !(item.quantity.amount > 0))
        ) {
            unresolved.push(item.line);
            continue;
        }
        items.push({
            ...item,
            name: clip(itemName, IMPORT_LIMITS.foodName),
            note:
                item.note == null ? null : clip(item.note, IMPORT_LIMITS.note),
        });
    }
    return {
        name,
        yieldPortions,
        instructions,
        prepMinutes: boundedMinutes(input.prepMinutes),
        cookMinutes: boundedMinutes(input.cookMinutes),
        parsed: { items, unresolved },
    };
}

export type SweepHousehold = {
    id: string;
    preferences: { unverifiedRecipeExpiryDays: number | null };
};

export async function sweepUnverifiedRecipes(opts: {
    households: SweepHousehold[];
    recipes: RecipesStore;
    now: Date;
}): Promise<number> {
    let deleted = 0;
    for (const household of opts.households) {
        const days = household.preferences.unverifiedRecipeExpiryDays;
        if (days == null) continue;
        const before = new Date(opts.now);
        before.setDate(before.getDate() - days);
        deleted += await opts.recipes.deleteStaleUnverified(
            household.id,
            before,
        );
    }
    return deleted;
}

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let sweepRunning = false;

export function startUnverifiedRecipeCleanup(
    loadHouseholds: () => Promise<SweepHousehold[]>,
    recipes: RecipesStore,
): void {
    setInterval(() => {
        if (sweepRunning) return;
        sweepRunning = true;
        loadHouseholds()
            .then((households) =>
                sweepUnverifiedRecipes({
                    households,
                    recipes,
                    now: new Date(),
                }),
            )
            .finally(() => {
                sweepRunning = false;
            });
    }, SWEEP_INTERVAL_MS);
}
