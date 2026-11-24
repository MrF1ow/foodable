import {
    recipeFromRow,
    recipeIngredientFromRow,
    recipeIngredientToRow,
    recipePortionFromRow,
    recipePortionToRow,
    recipeToRow,
    type RecipesStore,
} from "../domain/recipes.js";
import {
    cleanupDismissalsForRecipeTx,
    cleanupDismissalsForSubjectTx,
} from "./notice-dismissals.js";
import {
    recipeImportFromRow,
    recipeImportToRow,
} from "../domain/recipe-import.js";
import {
    mergeWithEarlier,
    overrideFromRow,
    type RecipeVariantsStore,
} from "../domain/recipe-variants.js";
import { RecipeInputError } from "../domain/recipes.js";
import {
    definedColumns,
    insertReturning,
    maybeOne,
    one,
    pgError,
    rows,
    run,
    type Tx,
} from "./sql.js";

const RECIPES = "recipes";
const RECIPE_INGREDIENTS = "recipe_ingredients";
const RECIPE_PORTIONS = "recipe_portions";
const RECIPE_IMPORTS = "recipe_imports";
const RECIPE_FAVOURITES = "recipe_favourites";
const RECIPE_VARIANT_OVERRIDES = "recipe_variant_overrides";
const OVERRIDE_COLS =
    "id, household_id, recipe_id, user_id, ingredient_id, action, amount, unit, food_id, display_name, created_at, updated_at";
const RECIPE_COLS =
    "id, household_id, creator_id, name, yield_portions, instructions, source_url, tags, notes, prep_minutes, cook_minutes, verification, updated_at";
const RECIPE_INGREDIENT_COLS =
    "id, household_id, recipe_id, kind, display_name, amount, unit, food_id, sort_order, note";
const RECIPE_PORTION_COLS = "recipe_id, household_id, user_id, portion_count";
const RECIPE_IMPORT_COLS =
    "recipe_id, household_id, source_kind, source_url, source_text, source_text_origin, transcript, credit, unresolved_lines, problems, dismissed_mentions, imported_at";

export function recipeImportSqlValues(
    row: ReturnType<typeof recipeImportToRow>,
) {
    return {
        unresolvedLinesJson: JSON.stringify(row.unresolved_lines),
        problemsJson: JSON.stringify(row.problems),
        dismissedMentionsJson: JSON.stringify(row.dismissed_mentions),
    };
}

function patchKeys(keys: string[]): [string, ...string[]] {
    return keys as [string, ...string[]];
}

function recipeRowForWrite(
    tx: Tx,
    row: ReturnType<typeof recipeToRow>,
): Record<string, unknown> {
    return {
        ...row,
        tags: tx.array(Array.isArray(row.tags) ? row.tags : [], "text"),
    };
}

async function touchRecipeUpdatedAt(
    tx: Tx,
    householdId: string,
    recipeId: string,
): Promise<void> {
    await rows(
        tx,
        tx`
            update ${tx.unsafe(RECIPES)}
            set updated_at = now()
            where id = ${recipeId}
              and household_id = ${householdId}
            returning id
        `,
    );
}

export function liveRecipesStore(): RecipesStore {
    return {
        async listRecipes(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_COLS)}
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                            order by name asc
                        `,
                    );
                    return data.map((row) => recipeFromRow(row as never));
                } catch (err) {
                    throw pgError("list recipes", err);
                }
            });
        },
        async getRecipe(householdId, id) {
            if (!UUID_SHAPE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_COLS)}
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                              and id = ${id}
                        `,
                        "load recipe",
                    );
                    return data ? recipeFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load recipe", err);
                }
            });
        },
        async insertRecipe(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    RECIPES,
                    recipeRowForWrite(tx, recipeToRow(row)),
                    RECIPE_COLS,
                    "add recipe",
                );
                return recipeFromRow(data as never);
            });
        },
        async updateRecipe(row) {
            return run(async (tx) => {
                try {
                    const payload = {
                        ...recipeRowForWrite(tx, recipeToRow(row)),
                        updated_at: new Date().toISOString(),
                    };
                    const { row: patch, keys } = definedColumns(payload);
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPES)} set ${tx(patch, ...patchKeys(keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(RECIPE_COLS)}
                        `,
                        "update recipe",
                    );
                    return data ? recipeFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update recipe", err);
                }
            });
        },
        async deleteRecipe(householdId, id) {
            return run(async (tx) => {
                try {
                    // An align of the recipe is in flight or finished before
                    // the delete takes the recipe row: it would otherwise hold
                    // an ingredient while the delete's cascade waits for it,
                    // and then want the recipe row the delete holds.
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${alignLockKey(id)}, 0))`;
                    await cleanupDismissalsForRecipeTx(tx, householdId, id);
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPES)}
                            where id = ${id}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete recipe", err);
                }
            });
        },
        async listIngredients(householdId, recipeId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_INGREDIENT_COLS)}
                            from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                            order by sort_order asc
                        `,
                    );
                    return data.map((row) =>
                        recipeIngredientFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list recipe ingredients", err);
                }
            });
        },
        async listIngredientsForHousehold(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_INGREDIENT_COLS)}
                            from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where household_id = ${householdId}
                            order by recipe_id asc, sort_order asc
                        `,
                    );
                    return data.map((row) =>
                        recipeIngredientFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list recipe ingredients for household", err);
                }
            });
        },
        async insertIngredient(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    RECIPE_INGREDIENTS,
                    recipeIngredientToRow(row),
                    RECIPE_INGREDIENT_COLS,
                    "add recipe ingredient",
                );
                await touchRecipeUpdatedAt(tx, row.householdId, row.recipeId);
                return recipeIngredientFromRow(data as never);
            });
        },
        async updateIngredient(row) {
            return run(async (tx) => {
                try {
                    const { row: patch, keys } = definedColumns(
                        recipeIngredientToRow(row),
                    );
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_INGREDIENTS)} set ${tx(patch, ...patchKeys(keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(RECIPE_INGREDIENT_COLS)}
                        `,
                        "update recipe ingredient",
                    );
                    await touchRecipeUpdatedAt(
                        tx,
                        row.householdId,
                        row.recipeId,
                    );
                    return data ? recipeIngredientFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update recipe ingredient", err);
                }
            });
        },
        async deleteIngredient(householdId, ingredientId) {
            return run(async (tx) => {
                try {
                    const target = await maybeOne<{
                        recipe_id: string;
                    }>(
                        tx,
                        tx`
                            select recipe_id
                            from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where id = ${ingredientId}
                              and household_id = ${householdId}
                        `,
                        "load recipe ingredient",
                    );
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where id = ${ingredientId}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    if (data.length > 0) {
                        await cleanupDismissalsForSubjectTx(
                            tx,
                            householdId,
                            "recipe_ingredient",
                            ingredientId,
                        );
                    }
                    if (data.length > 0 && target) {
                        await touchRecipeUpdatedAt(
                            tx,
                            householdId,
                            String(target.recipe_id),
                        );
                    }
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete recipe ingredient", err);
                }
            });
        },
        async getPortion(householdId, recipeId, userId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_PORTION_COLS)}
                            from ${tx.unsafe(RECIPE_PORTIONS)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                              and user_id = ${userId}
                        `,
                        "load recipe portion",
                    );
                    return data ? recipePortionFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load recipe portion", err);
                }
            });
        },
        async upsertPortion(row) {
            return run(async (tx) => {
                try {
                    const payload = recipePortionToRow(row);
                    const { row: patch, keys } = definedColumns(payload);
                    const data = await one<Record<string, unknown>>(
                        tx,
                        tx`
                            insert into ${tx.unsafe(RECIPE_PORTIONS)} ${tx(patch, ...patchKeys(keys))}
                            on conflict (recipe_id, user_id) do update set
                                household_id = excluded.household_id,
                                portion_count = excluded.portion_count
                            returning ${tx.unsafe(RECIPE_PORTION_COLS)}
                        `,
                        "save recipe portion",
                    );
                    return recipePortionFromRow(data as never);
                } catch (err) {
                    throw pgError("save recipe portion", err);
                }
            });
        },
        async recipeActivityMsById(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{
                        id: string;
                        activity_at: string;
                    }>(
                        tx,
                        tx`
                            select id, coalesce(updated_at, created_at) as activity_at
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                        `,
                    );
                    const map = new Map<string, number>();
                    for (const row of data) {
                        map.set(String(row.id), Date.parse(row.activity_at));
                    }
                    return map;
                } catch (err) {
                    throw pgError("list recipe activity", err);
                }
            });
        },
        async getImport(householdId, recipeId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_IMPORT_COLS)}
                            from ${tx.unsafe(RECIPE_IMPORTS)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                        `,
                        "load recipe import",
                    );
                    return data ? recipeImportFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load recipe import", err);
                }
            });
        },
        async upsertImport(row) {
            return run(async (tx) => {
                try {
                    const payload = recipeImportToRow(row);
                    const {
                        unresolvedLinesJson,
                        problemsJson,
                        dismissedMentionsJson,
                    } = recipeImportSqlValues(payload);
                    const data = await one<Record<string, unknown>>(
                        tx,
                        tx`
                            insert into ${tx.unsafe(RECIPE_IMPORTS)} (
                                recipe_id,
                                household_id,
                                source_kind,
                                source_url,
                                source_text,
                                source_text_origin,
                                transcript,
                                credit,
                                unresolved_lines,
                                problems,
                                dismissed_mentions,
                                imported_at
                            )
                            values (
                                ${payload.recipe_id},
                                ${payload.household_id},
                                ${payload.source_kind},
                                ${payload.source_url},
                                ${payload.source_text},
                                ${payload.source_text_origin},
                                ${payload.transcript},
                                ${payload.credit},
                                ${unresolvedLinesJson}::jsonb,
                                ${problemsJson}::jsonb,
                                ${dismissedMentionsJson}::jsonb,
                                ${payload.imported_at}
                            )
                            on conflict (recipe_id) do update set
                                household_id = excluded.household_id,
                                source_kind = excluded.source_kind,
                                source_url = excluded.source_url,
                                source_text = excluded.source_text,
                                source_text_origin = excluded.source_text_origin,
                                transcript = excluded.transcript,
                                credit = excluded.credit,
                                unresolved_lines = excluded.unresolved_lines,
                                problems = excluded.problems,
                                imported_at = excluded.imported_at
                            returning ${tx.unsafe(RECIPE_IMPORT_COLS)}
                        `,
                        "save recipe import",
                    );
                    return recipeImportFromRow(data as never);
                } catch (err) {
                    throw pgError("save recipe import", err);
                }
            });
        },
        async addDismissedMention(householdId, recipeId, key) {
            return run(async (tx) => {
                try {
                    // One statement appends the key where it is missing, so a
                    // concurrent write to the row cannot lose it, and a key
                    // already there changes nothing.
                    const changed = await rows(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_IMPORTS)}
                            set dismissed_mentions = dismissed_mentions
                                || jsonb_build_array(${key}::text)
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                              and not dismissed_mentions
                                  @> jsonb_build_array(${key}::text)
                            returning recipe_id
                        `,
                    );
                    if (changed.length > 0) return true;
                    const present = await rows(
                        tx,
                        tx`
                            select recipe_id
                            from ${tx.unsafe(RECIPE_IMPORTS)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                        `,
                    );
                    return present.length > 0;
                } catch (err) {
                    throw pgError("dismiss recipe mention", err);
                }
            });
        },
        async setVerification(householdId, recipeId, verification, problems) {
            return run(async (tx) => {
                try {
                    await rows(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPES)}
                            set verification = ${verification}
                            where id = ${recipeId}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    await rows(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_IMPORTS)}
                            set problems = ${JSON.stringify(problems)}::jsonb
                            where recipe_id = ${recipeId}
                              and household_id = ${householdId}
                            returning recipe_id
                        `,
                    );
                } catch (err) {
                    throw pgError("set recipe verification", err);
                }
            });
        },
        async deleteStaleUnverified(householdId, before) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                              and verification = 'unverified'
                              and updated_at < ${before.toISOString()}
                            returning id
                        `,
                    );
                    return data.length;
                } catch (err) {
                    throw pgError("delete stale unverified recipes", err);
                }
            });
        },
        async findRecipeBySourceUrl(householdId, urls) {
            return run(async (tx) => {
                const cleaned = urls.map((u) => u.trim()).filter(Boolean);
                if (cleaned.length === 0) return null;
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_COLS)}
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                              and source_url = any(${tx.array(cleaned, "text")})
                            limit 1
                        `,
                        "find recipe by source url",
                    );
                    return data ? recipeFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("find recipe by source url", err);
                }
            });
        },
        async listImports(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_IMPORT_COLS)}
                            from ${tx.unsafe(RECIPE_IMPORTS)}
                            where household_id = ${householdId}
                        `,
                    );
                    return data.map((row) => recipeImportFromRow(row as never));
                } catch (err) {
                    throw pgError("list recipe imports", err);
                }
            });
        },
        async setFavourite(householdId, userId, recipeId, on) {
            return run(async (tx) => {
                try {
                    // A recipe id from outside the household is refused, not starred.
                    const recipe = await rows<{ id: string }>(
                        tx,
                        tx`
                            select id
                            from ${tx.unsafe(RECIPES)}
                            where id = ${recipeId}
                              and household_id = ${householdId}
                        `,
                    );
                    if (recipe.length === 0) return false;
                    if (on) {
                        await rows(
                            tx,
                            tx`
                                insert into ${tx.unsafe(RECIPE_FAVOURITES)} (
                                    household_id, user_id, recipe_id
                                )
                                values (${householdId}, ${userId}, ${recipeId})
                                on conflict (user_id, recipe_id) do nothing
                                returning recipe_id
                            `,
                        );
                    } else {
                        await rows(
                            tx,
                            tx`
                                delete from ${tx.unsafe(RECIPE_FAVOURITES)}
                                where household_id = ${householdId}
                                  and user_id = ${userId}
                                  and recipe_id = ${recipeId}
                                returning recipe_id
                            `,
                        );
                    }
                    return true;
                } catch (err) {
                    throw pgError("set recipe favourite", err);
                }
            });
        },
        async listFavourites(householdId, userId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ recipe_id: string }>(
                        tx,
                        tx`
                            select recipe_id
                            from ${tx.unsafe(RECIPE_FAVOURITES)}
                            where household_id = ${householdId}
                              and user_id = ${userId}
                            order by created_at asc, recipe_id asc
                        `,
                    );
                    return data.map((row) => String(row.recipe_id));
                } catch (err) {
                    throw pgError("list recipe favourites", err);
                }
            });
        },
    };
}

/**
 * An align takes this lock exclusively (`recipeAlignTransaction`); every write
 * to a person's version takes it shared, so a save, a delete or a reset
 * either finishes before an align reads or waits until it has committed. It
 * is what keeps an align from deleting a row as redundant that someone has
 * just saved something else into.
 */
function alignLockKey(recipeId: string): string {
    // One key per recipe whatever the case of the id it was named by: the
    // route's id check lets an upper-case one through, and every writer must
    // wait on the same lock.
    return `recipe-align:${recipeId.toLowerCase()}`;
}

/**
 * Waits for any align of a recipe this person has a version of, and holds new
 * ones back until the transaction ends. Deleting a person's account takes it
 * before the delete: an align holds their rows and then needs their user row
 * (a replaced row is inserted anew), while the delete holds the user row and
 * then needs their rows, so without it the two wait on each other. The keys
 * are taken in sorted order, so two deletes never wait on each other.
 */
export async function lockRecipeAlignsForPerson(
    tx: Tx,
    userId: string,
): Promise<void> {
    const data = await rows<{ recipe_id: string }>(
        tx,
        tx`
            select distinct recipe_id
            from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
            where user_id = ${userId}::uuid
        `,
    );
    const keys = data.map((row) => alignLockKey(String(row.recipe_id))).sort();
    for (const key of keys) {
        await tx`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
    }
}

/** Each person's version of a recipe: their overrides of its base ingredients. */
export function liveRecipeVariantsStore(): RecipeVariantsStore {
    return {
        async listOverrides(householdId, recipeId) {
            if (!UUID_SHAPE.test(recipeId)) return [];
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(OVERRIDE_COLS)}
                            from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                            order by created_at asc, id asc
                        `,
                    );
                    return data.map((row) => overrideFromRow(row as never));
                } catch (err) {
                    throw pgError("list recipe versions", err);
                }
            });
        },
        async listOverridesForRecipes(householdId, recipeIds) {
            if (recipeIds.length === 0) return [];
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(OVERRIDE_COLS)}
                            from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                            where household_id = ${householdId}
                              and recipe_id = any(${tx.array([...recipeIds], "uuid")})
                            order by created_at asc, id asc
                        `,
                    );
                    return data.map((row) => overrideFromRow(row as never));
                } catch (err) {
                    throw pgError("list recipe versions", err);
                }
            });
        },
        async listOverridesByFood(householdId, foodId) {
            if (!UUID_SHAPE.test(foodId)) return [];
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(OVERRIDE_COLS)}
                            from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                            where household_id = ${householdId}
                              and food_id = ${foodId}::uuid
                            order by created_at asc, id asc
                        `,
                    );
                    return data.map((row) => overrideFromRow(row as never));
                } catch (err) {
                    throw pgError("list recipe versions", err);
                }
            });
        },
        async saveOverride(given) {
            return run(async (tx) => {
                try {
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${alignLockKey(given.recipeId)}, 0))`;
                    // The person's earlier row for a base ingredient is read
                    // and merged under a lock on that ingredient, so a swap
                    // and an amount saved at once both land: the second
                    // waits for the first and merges with it.
                    let row = given;
                    if (given.ingredientId != null) {
                        await tx`select pg_advisory_xact_lock(hashtextextended(${`recipe-version:${given.recipeId}:${given.userId}:${given.ingredientId}`}, 0))`;
                        const earlier = await maybeOne<Record<string, unknown>>(
                            tx,
                            tx`
                                select ${tx.unsafe(OVERRIDE_COLS)}
                                from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                                where household_id = ${given.householdId}::uuid
                                  and recipe_id = ${given.recipeId}::uuid
                                  and user_id = ${given.userId}::uuid
                                  and ingredient_id = ${given.ingredientId}::uuid
                            `,
                            "read recipe version",
                        );
                        row = mergeWithEarlier(
                            earlier
                                ? overrideFromRow(earlier as never)
                                : undefined,
                            given,
                        );
                    }
                    // The recipe must be this household's: no row, no insert.
                    // A row on a base ingredient replaces the person's earlier
                    // one for it; an add replaces their earlier add of the
                    // same food, so a retried add is one row.
                    const saved = await one<Record<string, unknown>>(
                        tx,
                        row.ingredientId == null
                            ? tx`
                            insert into ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)} (
                                id, household_id, recipe_id, user_id,
                                ingredient_id, action, amount, unit, food_id,
                                display_name
                            )
                            select
                                ${row.id ?? crypto.randomUUID()}::uuid,
                                r.household_id,
                                r.id,
                                ${row.userId}::uuid,
                                ${row.ingredientId}::uuid,
                                ${row.action}::text,
                                ${row.amount ?? null}::numeric,
                                ${row.unit ?? null}::text,
                                ${row.foodId ?? null}::uuid,
                                ${row.displayName ?? null}::text
                            from ${tx.unsafe(RECIPES)} r
                            where r.id = ${row.recipeId}::uuid
                              and r.household_id = ${row.householdId}::uuid
                            on conflict (recipe_id, user_id, food_id)
                                where action = 'add'
                            do update set
                                amount = excluded.amount,
                                unit = excluded.unit,
                                display_name = excluded.display_name,
                                updated_at = now()
                            returning ${tx.unsafe(OVERRIDE_COLS)}
                        `
                            : tx`
                            insert into ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)} (
                                id, household_id, recipe_id, user_id,
                                ingredient_id, action, amount, unit, food_id,
                                display_name
                            )
                            select
                                ${row.id ?? crypto.randomUUID()}::uuid,
                                r.household_id,
                                r.id,
                                ${row.userId}::uuid,
                                ${row.ingredientId}::uuid,
                                ${row.action}::text,
                                ${row.amount ?? null}::numeric,
                                ${row.unit ?? null}::text,
                                ${row.foodId ?? null}::uuid,
                                ${row.displayName ?? null}::text
                            from ${tx.unsafe(RECIPES)} r
                            where r.id = ${row.recipeId}::uuid
                              and r.household_id = ${row.householdId}::uuid
                            on conflict (recipe_id, user_id, ingredient_id)
                                where ingredient_id is not null
                            do update set
                                action = excluded.action,
                                amount = excluded.amount,
                                unit = excluded.unit,
                                food_id = excluded.food_id,
                                display_name = excluded.display_name,
                                updated_at = now()
                            returning ${tx.unsafe(OVERRIDE_COLS)}
                        `,
                        "save recipe version",
                    );
                    return overrideFromRow(saved as never);
                } catch (err) {
                    if (err instanceof RecipeInputError) throw err;
                    throw pgError("save recipe version", err);
                }
            });
        },
        async deleteOverride(householdId, recipeId, userId, ref) {
            if (!UUID_SHAPE.test(ref)) return false;
            return run(async (tx) => {
                try {
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${alignLockKey(recipeId)}, 0))`;
                    const data = await rows(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}::uuid
                              and user_id = ${userId}::uuid
                              and (id = ${ref}::uuid or ingredient_id = ${ref}::uuid)
                            returning id
                        `,
                    );
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete recipe version", err);
                }
            });
        },
        async deleteOverrideIfUnchanged(householdId, given) {
            if (!UUID_SHAPE.test(given.id)) return false;
            return run(async (tx) => {
                try {
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${alignLockKey(given.recipeId)}, 0))`;
                    const data = await rows(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                            where household_id = ${householdId}
                              and id = ${given.id}::uuid
                              and recipe_id = ${given.recipeId}::uuid
                              and user_id = ${given.userId}::uuid
                              and action = ${given.action}::text
                              and amount::float8 is not distinct from ${given.amount ?? null}::float8
                              and unit is not distinct from ${given.unit ?? null}::text
                              and food_id is not distinct from ${given.foodId ?? null}::uuid
                              and display_name is not distinct from ${given.displayName ?? null}::text
                            returning id
                        `,
                    );
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete recipe version", err);
                }
            });
        },
        async lockVersions(recipeId) {
            return run(async (tx) => {
                try {
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${alignLockKey(recipeId)}, 0))`;
                } catch (err) {
                    throw pgError("lock recipe versions", err);
                }
            });
        },
        async lockBaseIngredient(householdId, ingredientId) {
            if (!UUID_SHAPE.test(ingredientId)) return false;
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select id
                            from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where id = ${ingredientId}::uuid
                              and household_id = ${householdId}::uuid
                            for no key update
                        `,
                    );
                    return data.length > 0;
                } catch (err) {
                    throw pgError("lock recipe ingredient", err);
                }
            });
        },
        async clearVariant(householdId, recipeId, userId) {
            return run(async (tx) => {
                try {
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${alignLockKey(recipeId)}, 0))`;
                    const data = await rows(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPE_VARIANT_OVERRIDES)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}::uuid
                              and user_id = ${userId}::uuid
                            returning id
                        `,
                    );
                    return data.length;
                } catch (err) {
                    throw pgError("clear recipe version", err);
                }
            });
        },
    };
}

/**
 * The `transaction` an align takes, for the live stores: the base edit and
 * every override it removes or converts commit together or not at all, and
 * two aligns of one recipe run one after the other. It also waits for any
 * write to a version of that recipe that is in flight, and holds new ones back
 * until it commits (see `alignLockKey`).
 */
export function recipeAlignTransaction(
    recipeId: string,
): <T>(fn: () => Promise<T>) => Promise<T> {
    return (fn) =>
        run(async (tx) => {
            await tx`select pg_advisory_xact_lock(hashtextextended(${alignLockKey(recipeId)}, 0))`;
            // The recipe row is locked before any ingredient or override row,
            // the order the stale-unverified sweep's cascading delete takes
            // them (recipe, then ingredients, then overrides), so neither
            // waits on a lock the other holds.
            if (!UUID_SHAPE.test(recipeId)) return fn();
            await tx`
                select id
                from ${tx.unsafe(RECIPES)}
                where id = ${recipeId}::uuid
                for no key update
            `;
            return fn();
        });
}

const UUID_SHAPE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
