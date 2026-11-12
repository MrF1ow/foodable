export type NoticeSeverity = "block" | "warn" | "info";

export type NoticeSubject =
    | { kind: "food"; id: string }
    | { kind: "recipe"; id: string }
    | { kind: "recipe_ingredient"; id: string; recipeId: string }
    | { kind: "fridge_item"; id: string }
    | { kind: "grocery_line"; id: string }
    | { kind: "member"; id: string };

export type NoticeCode =
    | "fridge.expired"
    | "fridge.expiring"
    | "grocery.allergen"
    | "recipe.allergen"
    | "recipe.no_food"
    | "recipe.no_amount"
    | "recipe.no_nutrition"
    | "recipe.partial_nutrition"
    | "recipe.unknown_unit"
    | "recipe.missing_grams_per_each"
    | "recipe.missing_grams_per_ml"
    | "food.possible_duplicate"
    | "food.product_allergen"
    | "food.product_trace"
    | "food.product_gluten"
    | "food.product_goal"
    | "food.product_dislike"
    | "grocery.restocked"
    | "grocery.running_low"
    | "plan.missing_ingredient"
    | "nutrition.weigh_in_due";

export const NOTICE_CODES: readonly NoticeCode[] = [
    "fridge.expired",
    "fridge.expiring",
    "grocery.allergen",
    "recipe.allergen",
    "recipe.no_food",
    "recipe.no_amount",
    "recipe.no_nutrition",
    "recipe.partial_nutrition",
    "recipe.unknown_unit",
    "recipe.missing_grams_per_each",
    "recipe.missing_grams_per_ml",
    "food.possible_duplicate",
    "food.product_allergen",
    "food.product_trace",
    "food.product_gluten",
    "food.product_goal",
    "food.product_dislike",
    "grocery.restocked",
    "grocery.running_low",
    "plan.missing_ingredient",
    "nutrition.weigh_in_due",
];

export const NOTICE_SEVERITY: Record<NoticeCode, NoticeSeverity> = {
    "fridge.expired": "warn",
    "fridge.expiring": "info",
    "grocery.allergen": "block",
    "recipe.allergen": "block",
    "recipe.no_food": "warn",
    // An unmeasured ingredient ("salt, to taste") is expected, not a fault.
    "recipe.no_amount": "info",
    "recipe.no_nutrition": "warn",
    "recipe.partial_nutrition": "warn",
    "recipe.unknown_unit": "warn",
    "recipe.missing_grams_per_each": "warn",
    "recipe.missing_grams_per_ml": "warn",
    "food.possible_duplicate": "info",
    "food.product_allergen": "block",
    "food.product_trace": "warn",
    "food.product_gluten": "warn",
    "food.product_goal": "info",
    "food.product_dislike": "info",
    "grocery.restocked": "info",
    "grocery.running_low": "warn",
    "plan.missing_ingredient": "warn",
    "nutrition.weigh_in_due": "info",
};

export type NoticeRelated = {
    kind: NoticeSubject["kind"] | "member";
    id: string;
    name: string;
};

export type Notice = {
    code: NoticeCode;
    severity: NoticeSeverity;
    subject: NoticeSubject;
    related: NoticeRelated[];
    params: Record<string, string | number | string[]>;
};

const SEVERITY_ORDER: Record<NoticeSeverity, number> = {
    block: 0,
    warn: 1,
    info: 2,
};

/** Stable: block, then warn, then info; ties preserve input order. */
/** Tab prefix → notice code prefix for bottom-nav dots. */
export const TAB_NOTICE_PREFIXES = {
    fridge: "fridge.",
    recipes: "recipe.",
    household: "food.",
} as const;

export type AppTabIdForNotices = keyof typeof TAB_NOTICE_PREFIXES;

export function noticeMatchesTab(
    code: NoticeCode,
    tab: AppTabIdForNotices,
): boolean {
    return code.startsWith(TAB_NOTICE_PREFIXES[tab]);
}

export function tabDotsFromNotices(
    notices: readonly Notice[],
): Partial<Record<AppTabIdForNotices, boolean>> {
    const tabs = Object.keys(TAB_NOTICE_PREFIXES) as AppTabIdForNotices[];
    const out: Partial<Record<AppTabIdForNotices, boolean>> = {};
    for (const tab of tabs) {
        const prefix = TAB_NOTICE_PREFIXES[tab];
        if (
            notices.some(
                (n) =>
                    (n.severity === "warn" || n.severity === "info") &&
                    n.code.startsWith(prefix),
            )
        ) {
            out[tab] = true;
        }
    }
    return out;
}

/** Count open warnings and suggestions (never blocks) on a filtered notice list. */
export function needsAttentionCount(notices: readonly Notice[]): number {
    return notices.filter((n) => n.severity === "warn" || n.severity === "info")
        .length;
}

export function sortNotices(notices: readonly Notice[]): Notice[] {
    const indexed = notices.map((n, i) => ({ n, i }));
    indexed.sort((a, b) => {
        const da = SEVERITY_ORDER[a.n.severity] - SEVERITY_ORDER[b.n.severity];
        if (da !== 0) return da;
        return a.i - b.i;
    });
    return indexed.map(({ n }) => n);
}
