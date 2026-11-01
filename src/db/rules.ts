import {
    memberAllergenFromRow,
    memberAllergenToRow,
    memberDislikeFromRow,
    memberDislikeToRow,
    personRuleFromRow,
    personRuleToRow,
    storeRuleFromRow,
    storeRuleToRow,
    type PersonRowRef,
    type RulesStore,
} from "../domain/rules.js";
import { insertReturning, pgError, rows, run } from "./sql.js";

const STORE_RULES = "store_rules";
const PERSON_RULES = "person_rules";
const MEMBER_ALLERGENS = "member_allergens";
const MEMBER_DISLIKES = "member_dislikes";
const STORE_RULE_COLS = "id, household_id, store_id, body, sort_order";
const PERSON_RULE_COLS = "id, household_id, user_id, body, sort_order";
const ALLERGEN_COLS = "id, household_id, user_id, allergen, other_label";
const DISLIKE_COLS = "id, household_id, user_id, display_name";

export function liveRulesStore(): RulesStore {
    return {
        async listStoreRules(storeId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(STORE_RULE_COLS)}
                            from ${tx.unsafe(STORE_RULES)}
                            where store_id = ${storeId}
                            order by sort_order asc
                        `,
                    );
                    return data.map((row) => storeRuleFromRow(row as never));
                } catch (err) {
                    throw pgError("list store rules", err);
                }
            });
        },
        async insertStoreRule(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    STORE_RULES,
                    storeRuleToRow(row),
                    STORE_RULE_COLS,
                    "add store rule",
                );
                return storeRuleFromRow(data as never);
            });
        },
        async listPersonRules(householdId, userId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(PERSON_RULE_COLS)}
                            from ${tx.unsafe(PERSON_RULES)}
                            where household_id = ${householdId}
                              and user_id = ${userId}
                            order by sort_order asc
                        `,
                    );
                    return data.map((row) => personRuleFromRow(row as never));
                } catch (err) {
                    throw pgError("list person rules", err);
                }
            });
        },
        async insertPersonRule(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    PERSON_RULES,
                    personRuleToRow(row),
                    PERSON_RULE_COLS,
                    "add person rule",
                );
                return personRuleFromRow(data as never);
            });
        },
        async listAllergens(householdId, userId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(ALLERGEN_COLS)}
                            from ${tx.unsafe(MEMBER_ALLERGENS)}
                            where household_id = ${householdId}
                              and user_id = ${userId}
                            order by created_at asc
                        `,
                    );
                    return data.map((row) =>
                        memberAllergenFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list allergens", err);
                }
            });
        },
        async insertAllergen(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    MEMBER_ALLERGENS,
                    memberAllergenToRow(row),
                    ALLERGEN_COLS,
                    "add allergen",
                );
                return memberAllergenFromRow(data as never);
            });
        },
        async listDislikes(householdId, userId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(DISLIKE_COLS)}
                            from ${tx.unsafe(MEMBER_DISLIKES)}
                            where household_id = ${householdId}
                              and user_id = ${userId}
                            order by created_at asc
                        `,
                    );
                    return data.map((row) =>
                        memberDislikeFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list dislikes", err);
                }
            });
        },
        async insertDislike(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    MEMBER_DISLIKES,
                    memberDislikeToRow(row),
                    DISLIKE_COLS,
                    "add dislike",
                );
                return memberDislikeFromRow(data as never);
            });
        },
        async deletePersonRule(ref) {
            return deleteRef(PERSON_RULES, "person rule", ref);
        },
        async deleteAllergen(ref) {
            return deleteRef(MEMBER_ALLERGENS, "allergen", ref);
        },
        async deleteDislike(ref) {
            return deleteRef(MEMBER_DISLIKES, "dislike", ref);
        },
    };
}

export type { RulesStore };

async function deleteRef(
    table: string,
    label: string,
    ref: PersonRowRef,
): Promise<boolean> {
    return run(async (tx) => {
        try {
            const data = await rows<{ id: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(table)}
                    where id = ${ref.id}
                      and household_id = ${ref.householdId}
                      and user_id = ${ref.userId}
                    returning id
                `,
            );
            return data.length > 0;
        } catch (err) {
            throw pgError(`remove ${label}`, err);
        }
    });
}
