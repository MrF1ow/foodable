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
import { getSupabase } from "./client.js";

const STORE_RULE_COLS = "id, household_id, store_id, body, sort_order";
const PERSON_RULE_COLS = "id, household_id, user_id, body, sort_order";
const ALLERGEN_COLS = "id, household_id, user_id, allergen, other_label";
const DISLIKE_COLS = "id, household_id, user_id, display_name";

export function liveRulesStore(): RulesStore {
    return {
        async listStoreRules(storeId) {
            const { data, error } = await getSupabase()
                .from("store_rules")
                .select(STORE_RULE_COLS)
                .eq("store_id", storeId)
                .order("sort_order", { ascending: true });
            if (error) {
                throw new Error(`Failed to list store rules: ${error.message}`);
            }
            return (data ?? []).map(storeRuleFromRow);
        },
        async insertStoreRule(row) {
            const { data, error } = await getSupabase()
                .from("store_rules")
                .insert(storeRuleToRow(row))
                .select(STORE_RULE_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add store rule: ${error.message}`);
            }
            return storeRuleFromRow(data);
        },
        async listPersonRules(householdId, userId) {
            const { data, error } = await getSupabase()
                .from("person_rules")
                .select(PERSON_RULE_COLS)
                .eq("household_id", householdId)
                .eq("user_id", userId)
                .order("sort_order", { ascending: true });
            if (error) {
                throw new Error(
                    `Failed to list person rules: ${error.message}`,
                );
            }
            return (data ?? []).map(personRuleFromRow);
        },
        async insertPersonRule(row) {
            const { data, error } = await getSupabase()
                .from("person_rules")
                .insert(personRuleToRow(row))
                .select(PERSON_RULE_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add person rule: ${error.message}`);
            }
            return personRuleFromRow(data);
        },
        async listAllergens(householdId, userId) {
            const { data, error } = await getSupabase()
                .from("member_allergens")
                .select(ALLERGEN_COLS)
                .eq("household_id", householdId)
                .eq("user_id", userId)
                .order("created_at", { ascending: true });
            if (error) {
                throw new Error(`Failed to list allergens: ${error.message}`);
            }
            return (data ?? []).map(memberAllergenFromRow);
        },
        async insertAllergen(row) {
            const { data, error } = await getSupabase()
                .from("member_allergens")
                .insert(memberAllergenToRow(row))
                .select(ALLERGEN_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add allergen: ${error.message}`);
            }
            return memberAllergenFromRow(data);
        },
        async listDislikes(householdId, userId) {
            const { data, error } = await getSupabase()
                .from("member_dislikes")
                .select(DISLIKE_COLS)
                .eq("household_id", householdId)
                .eq("user_id", userId)
                .order("created_at", { ascending: true });
            if (error) {
                throw new Error(`Failed to list dislikes: ${error.message}`);
            }
            return (data ?? []).map(memberDislikeFromRow);
        },
        async insertDislike(row) {
            const { data, error } = await getSupabase()
                .from("member_dislikes")
                .insert(memberDislikeToRow(row))
                .select(DISLIKE_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add dislike: ${error.message}`);
            }
            return memberDislikeFromRow(data);
        },
        async deletePersonRule(ref) {
            return deleteRef("person_rules", "person rule", ref);
        },
        async deleteAllergen(ref) {
            return deleteRef("member_allergens", "allergen", ref);
        },
        async deleteDislike(ref) {
            return deleteRef("member_dislikes", "dislike", ref);
        },
    };
}

export type { RulesStore };

async function deleteRef(
    table: "person_rules" | "member_allergens" | "member_dislikes",
    label: string,
    ref: PersonRowRef,
): Promise<boolean> {
    const { data, error } = await getSupabase()
        .from(table)
        .delete()
        .eq("id", ref.id)
        .eq("household_id", ref.householdId)
        .eq("user_id", ref.userId)
        .select("id");
    if (error) {
        throw new Error(`Failed to remove ${label}: ${error.message}`);
    }
    return (data ?? []).length > 0;
}
