import type { Recipe, RecipeIngredient, RecipesStore } from "./recipes.js";
import { recipeSteps } from "./recipes.js";

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
    return Boolean(ingredient.note?.trim());
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
        throw new Error("Unknown recipe.");
    }
    const ingredients = await store.listIngredients(householdId, recipeId);
    const importRow = await store.getImport(householdId, recipeId);
    const result = verifyRecipe(recipe, ingredients, importRow);
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
