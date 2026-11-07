import type { FoodsStore } from "./foods.js";
import {
    findFoodById,
    normalizeFoodName,
    SIMILAR_FOODS_LIMIT,
    type SimilarFoodsEntry,
} from "./foods.js";

export type DidYouMeanView = {
    name: string;
    heading: string;
    candidates: { foodId: string; label: string }[];
    aliasLabel: string;
    newFoodLabel: string;
    hiddenFields: Record<string, string>;
};

const HIDDEN_OMIT = new Set(["food_id", "new_food", "remember_alias"]);

function candidateLabel(name: string, brand: string | null): string {
    return brand ? `${brand} · ${name}` : name;
}

export function didYouMeanView(
    entry: SimilarFoodsEntry,
    fields: Record<string, string>,
): DidYouMeanView {
    const hiddenFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (HIDDEN_OMIT.has(key) || value === "") continue;
        hiddenFields[key] = value;
    }
    hiddenFields.alias_name = entry.name;

    const candidates = entry.candidates
        .slice(0, SIMILAR_FOODS_LIMIT)
        .map((row) => ({
            foodId: row.food.id,
            label: candidateLabel(row.food.name, row.food.brand),
        }));

    const heading =
        candidates.length === 1
            ? `Did you mean ${candidates[0]!.label}?`
            : "Did you mean one of these?";

    const aliasLabel =
        candidates.length === 1
            ? `Remember ${entry.name} as another name for ${candidates[0]!.label}`
            : `Remember ${entry.name} as another name for the food you pick`;

    const newFoodLabel = `Add ${entry.name} as a new food`;

    return {
        name: entry.name,
        heading,
        candidates,
        aliasLabel,
        newFoodLabel,
        hiddenFields,
    };
}

export type RememberAliasResult = "set" | "same" | "taken" | "skipped";

export async function rememberAliasForChoice(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    aliasName: string,
): Promise<RememberAliasResult> {
    const trimmed = aliasName.trim();
    if (!trimmed) return "skipped";
    const alias = normalizeFoodName(trimmed);
    if (!alias) return "skipped";

    let food;
    try {
        food = await findFoodById(store, householdId, foodId);
    } catch {
        return "skipped";
    }
    if (alias === food.normalizedName) return "same";

    const taken = await store.getAliasFoodId(householdId, alias);
    if (taken && taken !== foodId) return "taken";
    if (taken === foodId) return "same";

    await store.setAlias(householdId, alias, foodId);
    return "set";
}
