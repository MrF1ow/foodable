import { snapshotToMealItemWrite, type MealInput } from "./db/nutrition.js";
import { getProfile, timezoneFromProfile } from "./db/profiles.js";
import { liveFoodsStore } from "./db/foods.js";
import { liveRecipesStore } from "./db/recipes.js";
import { LoggedAtError, resolveWriteLoggedAt } from "./domain/tz.js";
import type { OnSimilar } from "./domain/foods.js";
import {
    descriptionFromItems,
    itemListDigest,
    resolveAndBuildMeal,
    type MealItemSpec,
} from "./domain/meals.js";

export async function resolveWriteTimestamp(
    userId: string,
    raw: string | undefined,
): Promise<{ iso: string | undefined; note: string }> {
    const profile = await getProfile(userId);
    const tz = timezoneFromProfile(profile);
    const unsetTzNote = (value: string) =>
        `${JSON.stringify(value)} carries no UTC offset and this account has no timezone set, so it was read as UTC. Set one with set_timezone.`;

    if (raw === undefined) {
        const note =
            tz === null
                ? "\n\nNote: this account has no timezone set, so today's date is being read in UTC — set one with set_timezone."
                : "";
        return { iso: undefined, note };
    }

    let resolved;
    try {
        resolved = resolveWriteLoggedAt(raw, tz ?? "UTC", Date.now());
    } catch (err) {
        if (
            err instanceof LoggedAtError &&
            err.usedProfileTimezone &&
            tz === null
        ) {
            throw new Error(`${err.message} ${unsetTzNote(raw)}`);
        }
        throw err;
    }

    const note =
        resolved.usedProfileTimezone && tz === null
            ? `\n\nNote: ${unsetTzNote(raw)} Then re-check this entry.`
            : "";
    return { iso: resolved.instant.toISOString(), note };
}

/** One meal row built from catalog foods or recipes (same path as MCP log_meal). */
export async function mealWriteFromItems(
    householdId: string,
    items: MealItemSpec[],
    onSimilar?: OnSimilar,
): Promise<{
    totals: Pick<
        MealInput,
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
    >;
    items: MealInput["items"];
    item_digest: string;
    unknownNote: string;
    description: string;
}> {
    const { built, specs: resolved } = await resolveAndBuildMeal({
        householdId,
        foods: liveFoodsStore(),
        recipes: liveRecipesStore(),
        items,
        onSimilar,
    });
    return {
        totals: {
            calories: built.totals.calories ?? undefined,
            protein_g: built.totals.protein_g ?? undefined,
            carbs_g: built.totals.carbs_g ?? undefined,
            fat_g: built.totals.fat_g ?? undefined,
            fiber_g: built.totals.fiber_g ?? undefined,
            sugar_g: built.totals.sugar_g ?? undefined,
            alcohol_g: built.totals.alcohol_g ?? undefined,
            caffeine_mg: built.totals.caffeine_mg ?? undefined,
        },
        items: built.items.map((item) =>
            snapshotToMealItemWrite(item, householdId),
        ),
        item_digest: itemListDigest(resolved),
        unknownNote:
            built.unknownItems.length > 0
                ? `\n\nNutrition unknown for: ${built.unknownItems.join(", ")}.`
                : "",
        description: descriptionFromItems(built.items),
    };
}
