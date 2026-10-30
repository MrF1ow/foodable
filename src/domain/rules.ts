export const NAMED_ALLERGENS = [
    "peanut",
    "tree_nut",
    "milk",
    "egg",
    "wheat",
    "soy",
    "fish",
    "shellfish",
    "sesame",
] as const;

export const ALLERGEN_OTHER = "other" as const;

export type NamedAllergen = (typeof NAMED_ALLERGENS)[number];
export type AllergenCode = NamedAllergen | typeof ALLERGEN_OTHER;

export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
    peanut: "Peanut",
    tree_nut: "Tree nut",
    milk: "Milk",
    egg: "Egg",
    wheat: "Wheat",
    soy: "Soy",
    fish: "Fish",
    shellfish: "Shellfish",
    sesame: "Sesame",
    other: "Other",
};

export type StoreRule = {
    id: string;
    householdId: string;
    storeId: string;
    body: string;
    sortOrder: number;
};

export type PersonRule = {
    id: string;
    householdId: string;
    userId: string;
    body: string;
    sortOrder: number;
};

export type MemberAllergen = {
    id: string;
    householdId: string;
    userId: string;
    allergen: AllergenCode;
    otherLabel: string | null;
};

export type MemberDislike = {
    id: string;
    householdId: string;
    userId: string;
    displayName: string;
};

export type RulesStore = {
    listStoreRules(storeId: string): Promise<StoreRule[]>;
    insertStoreRule(row: StoreRule): Promise<StoreRule>;
    listPersonRules(householdId: string, userId: string): Promise<PersonRule[]>;
    insertPersonRule(row: PersonRule): Promise<PersonRule>;
    listAllergens(
        householdId: string,
        userId: string,
    ): Promise<MemberAllergen[]>;
    insertAllergen(row: MemberAllergen): Promise<MemberAllergen>;
    listDislikes(householdId: string, userId: string): Promise<MemberDislike[]>;
    insertDislike(row: MemberDislike): Promise<MemberDislike>;
    /** Each delete is scoped to one person: an id that belongs to someone
     * else matches nothing. Resolves true when a row was removed. */
    deletePersonRule(ref: PersonRowRef): Promise<boolean>;
    deleteAllergen(ref: PersonRowRef): Promise<boolean>;
    deleteDislike(ref: PersonRowRef): Promise<boolean>;
};

export type PersonRowRef = { householdId: string; userId: string; id: string };

export type PersonRuleKind = "rule" | "allergen" | "dislike";

export class RulesInputError extends Error {
    readonly code = "rules_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "RulesInputError";
    }
}

export function isNamedAllergen(value: string): value is NamedAllergen {
    return (NAMED_ALLERGENS as readonly string[]).includes(value);
}

export function isAllergenCode(value: string): value is AllergenCode {
    return isNamedAllergen(value) || value === ALLERGEN_OTHER;
}

export function createMemoryRulesStore(): RulesStore {
    const storeRules: StoreRule[] = [];
    const personRules: PersonRule[] = [];
    const allergens: MemberAllergen[] = [];
    const dislikes: MemberDislike[] = [];

    return {
        async listStoreRules(storeId) {
            return storeRules
                .filter((row) => row.storeId === storeId)
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((row) => ({ ...row }));
        },
        async insertStoreRule(row) {
            storeRules.push({ ...row });
            return { ...row };
        },
        async listPersonRules(householdId, userId) {
            return personRules
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.userId === userId,
                )
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((row) => ({ ...row }));
        },
        async insertPersonRule(row) {
            personRules.push({ ...row });
            return { ...row };
        },
        async listAllergens(householdId, userId) {
            return allergens
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.userId === userId,
                )
                .map((row) => ({ ...row }));
        },
        async insertAllergen(row) {
            allergens.push({ ...row });
            return { ...row };
        },
        async listDislikes(householdId, userId) {
            return dislikes
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.userId === userId,
                )
                .map((row) => ({ ...row }));
        },
        async insertDislike(row) {
            dislikes.push({ ...row });
            return { ...row };
        },
        async deletePersonRule(ref) {
            return spliceRef(personRules, ref);
        },
        async deleteAllergen(ref) {
            return spliceRef(allergens, ref);
        },
        async deleteDislike(ref) {
            return spliceRef(dislikes, ref);
        },
    };
}

function spliceRef(
    rows: Array<{ id: string; householdId: string; userId: string }>,
    ref: PersonRowRef,
): boolean {
    const index = rows.findIndex(
        (row) =>
            row.id === ref.id &&
            row.householdId === ref.householdId &&
            row.userId === ref.userId,
    );
    if (index < 0) return false;
    rows.splice(index, 1);
    return true;
}

/** Removes one of a person's rules, allergens or dislikes. Throws when the
 * row is not theirs, so a stale page reads as an error rather than a no-op. */
export async function removePersonRuleRow(
    store: RulesStore,
    kind: PersonRuleKind,
    ref: PersonRowRef,
): Promise<void> {
    const removed =
        kind === "rule"
            ? await store.deletePersonRule(ref)
            : kind === "allergen"
              ? await store.deleteAllergen(ref)
              : await store.deleteDislike(ref);
    if (!removed) {
        throw new RulesInputError("That entry is already gone.");
    }
}

export async function addStoreRule(
    store: RulesStore,
    input: { householdId: string; storeId: string; body: string },
): Promise<StoreRule> {
    const body = input.body.trim();
    if (!body) throw new RulesInputError("Enter a store rule.");
    const existing = await store.listStoreRules(input.storeId);
    const sortOrder =
        existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    return store.insertStoreRule({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        storeId: input.storeId,
        body,
        sortOrder,
    });
}

export async function addPersonRule(
    store: RulesStore,
    input: { householdId: string; userId: string; body: string },
): Promise<PersonRule> {
    const body = input.body.trim();
    if (!body) throw new RulesInputError("Enter a person rule.");
    const existing = await store.listPersonRules(
        input.householdId,
        input.userId,
    );
    const sortOrder =
        existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    return store.insertPersonRule({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        userId: input.userId,
        body,
        sortOrder,
    });
}

export async function addAllergen(
    store: RulesStore,
    input: {
        householdId: string;
        userId: string;
        allergen: string;
        otherLabel?: string;
    },
): Promise<MemberAllergen> {
    if (!isAllergenCode(input.allergen)) {
        throw new RulesInputError("Unknown allergen.");
    }
    const otherLabel =
        input.allergen === ALLERGEN_OTHER
            ? (input.otherLabel ?? "").trim()
            : null;
    if (input.allergen === ALLERGEN_OTHER && !otherLabel) {
        throw new RulesInputError("Enter the other allergen.");
    }
    const existing = await store.listAllergens(input.householdId, input.userId);
    const duplicate = existing.find((row) =>
        input.allergen === ALLERGEN_OTHER
            ? row.allergen === ALLERGEN_OTHER
            : row.allergen === input.allergen,
    );
    if (duplicate) {
        throw new RulesInputError("That allergen is already listed.");
    }
    return store.insertAllergen({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        userId: input.userId,
        allergen: input.allergen,
        otherLabel,
    });
}

export async function addDislike(
    store: RulesStore,
    input: { householdId: string; userId: string; displayName: string },
): Promise<MemberDislike> {
    const displayName = input.displayName.trim();
    if (!displayName) throw new RulesInputError("Enter a food they dislike.");
    const existing = await store.listDislikes(input.householdId, input.userId);
    if (
        existing.some(
            (row) =>
                row.displayName.toLowerCase() === displayName.toLowerCase(),
        )
    ) {
        throw new RulesInputError("That dislike is already listed.");
    }
    return store.insertDislike({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        userId: input.userId,
        displayName,
    });
}

export function storeRuleFromRow(row: {
    id: unknown;
    household_id: unknown;
    store_id: unknown;
    body: unknown;
    sort_order: unknown;
}): StoreRule {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        storeId: String(row.store_id),
        body: String(row.body),
        sortOrder: Number(row.sort_order) || 0,
    };
}

export function personRuleFromRow(row: {
    id: unknown;
    household_id: unknown;
    user_id: unknown;
    body: unknown;
    sort_order: unknown;
}): PersonRule {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        userId: String(row.user_id),
        body: String(row.body),
        sortOrder: Number(row.sort_order) || 0,
    };
}

export function memberAllergenFromRow(row: {
    id: unknown;
    household_id: unknown;
    user_id: unknown;
    allergen: unknown;
    other_label: unknown;
}): MemberAllergen {
    const raw = String(row.allergen);
    const allergen: AllergenCode = isAllergenCode(raw) ? raw : ALLERGEN_OTHER;
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        userId: String(row.user_id),
        allergen,
        otherLabel:
            typeof row.other_label === "string" && row.other_label.trim()
                ? row.other_label.trim()
                : null,
    };
}

export function memberDislikeFromRow(row: {
    id: unknown;
    household_id: unknown;
    user_id: unknown;
    display_name: unknown;
}): MemberDislike {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        userId: String(row.user_id),
        displayName: String(row.display_name),
    };
}

export function storeRuleToRow(row: StoreRule) {
    return {
        id: row.id,
        household_id: row.householdId,
        store_id: row.storeId,
        body: row.body,
        sort_order: row.sortOrder,
    };
}

export function personRuleToRow(row: PersonRule) {
    return {
        id: row.id,
        household_id: row.householdId,
        user_id: row.userId,
        body: row.body,
        sort_order: row.sortOrder,
    };
}

export function memberAllergenToRow(row: MemberAllergen) {
    return {
        id: row.id,
        household_id: row.householdId,
        user_id: row.userId,
        allergen: row.allergen,
        other_label: row.otherLabel,
    };
}

export function memberDislikeToRow(row: MemberDislike) {
    return {
        id: row.id,
        household_id: row.householdId,
        user_id: row.userId,
        display_name: row.displayName,
        identity: null,
    };
}
