import type { RecipeMacros } from "../domain/recipes.js";

/** RecipeMacros for page tests. */
export function recipeMacrosFixture(
    overrides: Partial<RecipeMacros> & Pick<RecipeMacros, "incomplete">,
): RecipeMacros {
    return {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        ...overrides,
    };
}
