export type NoticeSeverity = "block" | "warn" | "info";

export type NoticeSubject =
    | { kind: "food"; id: string }
    | { kind: "recipe"; id: string }
    | { kind: "recipe_ingredient"; id: string; recipeId: string }
    | { kind: "fridge_item"; id: string }
    | { kind: "grocery_line"; id: string };

export type NoticeCode =
    | "recipe.no_food"
    | "recipe.no_nutrition"
    | "recipe.partial_nutrition"
    | "recipe.unknown_unit"
    | "recipe.missing_grams_per_each"
    | "recipe.missing_grams_per_ml";

export const NOTICE_CODES: readonly NoticeCode[] = [
    "recipe.no_food",
    "recipe.no_nutrition",
    "recipe.partial_nutrition",
    "recipe.unknown_unit",
    "recipe.missing_grams_per_each",
    "recipe.missing_grams_per_ml",
];

export const NOTICE_SEVERITY: Record<NoticeCode, NoticeSeverity> = {
    "recipe.no_food": "warn",
    "recipe.no_nutrition": "warn",
    "recipe.partial_nutrition": "warn",
    "recipe.unknown_unit": "warn",
    "recipe.missing_grams_per_each": "warn",
    "recipe.missing_grams_per_ml": "warn",
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
export function sortNotices(notices: readonly Notice[]): Notice[] {
    const indexed = notices.map((n, i) => ({ n, i }));
    indexed.sort((a, b) => {
        const da = SEVERITY_ORDER[a.n.severity] - SEVERITY_ORDER[b.n.severity];
        if (da !== 0) return da;
        return a.i - b.i;
    });
    return indexed.map(({ n }) => n);
}
