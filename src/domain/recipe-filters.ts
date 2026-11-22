/**
 * The recipe filters, in one place: the Recipes page and the `list_recipes`
 * tool read the same registry, so a filter means the same thing to a person
 * and to an agent. Pure: the caller works out the per-recipe flags (see
 * `recipeFilters` in `recipes.ts`) and which recipes the viewer starred.
 */
import type { Recipe, RecipeFilterFlags } from "./recipes.js";

/** What the filters need to know about the recipes being filtered. */
export type RecipeFilterContext = {
    /** `recipeFilters` flags by recipe id. A recipe with none never passes a flag filter. */
    flags: ReadonlyMap<string, RecipeFilterFlags>;
    /** The recipes the viewer has starred. */
    favouriteIds: ReadonlySet<string>;
};

export type RecipeFilter = {
    id: string;
    label: string;
    test(recipe: Pick<Recipe, "id">, ctx: RecipeFilterContext): boolean;
};

export const RECIPE_FILTERS: readonly RecipeFilter[] = [
    {
        id: "cookable",
        label: "Cookable now",
        test: (recipe, ctx) => ctx.flags.get(recipe.id)?.cookable === true,
    },
    {
        id: "protein",
        label: "High protein",
        test: (recipe, ctx) => ctx.flags.get(recipe.id)?.highProtein === true,
    },
    {
        id: "quick",
        label: "Under 30 min",
        test: (recipe, ctx) => ctx.flags.get(recipe.id)?.quick === true,
    },
    {
        id: "favourites",
        label: "Favourites",
        test: (recipe, ctx) => ctx.favouriteIds.has(recipe.id),
    },
];

export const RECIPE_FILTER_IDS = RECIPE_FILTERS.map((filter) => filter.id) as [
    string,
    ...string[],
];

/** Keeps the recipes that pass every filter in `ids` (AND). Unknown ids are ignored. */
export function applyFilters<T extends Pick<Recipe, "id">>(
    recipes: readonly T[],
    ids: readonly string[],
    ctx: RecipeFilterContext,
): T[] {
    const active = RECIPE_FILTERS.filter((filter) => ids.includes(filter.id));
    return recipes.filter((recipe) =>
        active.every((filter) => filter.test(recipe, ctx)),
    );
}

/**
 * Reads `?filter=a,b`: known ids only, in the order given, each once. Empty,
 * absent and unknown entries are no filter, never an error.
 */
export function parseFilterParam(param: string | undefined): string[] {
    const known = new Set(RECIPE_FILTERS.map((filter) => filter.id));
    const ids: string[] = [];
    for (const part of (param ?? "").split(",")) {
        const id = part.trim();
        if (known.has(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/** The `filter` query value for a list of ids (empty when none). */
export function filterParamValue(ids: readonly string[]): string {
    return ids.join(",");
}

/** The search box: a recipe matches when its name contains the text. */
export function matchesRecipeQuery(
    recipe: Pick<Recipe, "name">,
    query: string,
): boolean {
    const needle = query.trim().toLowerCase();
    return needle === "" || recipe.name.toLowerCase().includes(needle);
}
