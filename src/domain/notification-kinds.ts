import type { NoticeCode } from "./notices.js";

/** Every kind of notification a person can receive. A closed list: a new kind
 * is a new line here. */
export type NotificationKind =
    | "allergens"
    | "food_expiring"
    | "running_low"
    | "weigh_in_due"
    | "recipe_changes"
    | "week_plan_changes"
    | "new_usuals";

/** A condition is computed from the household's data and clears when the data
 * does; an event is written once when someone acts. */
export type NotificationSource = "condition" | "event";

/** Personal goes only to the member it names; household goes to every member. */
export type NotificationBucket = "personal" | "household";

export type NotificationKindSpec = {
    id: NotificationKind;
    source: NotificationSource;
    bucket: NotificationBucket;
    /** What a person gets until they change it. */
    defaultOn: boolean;
    /** False for Allergens: always on, no preference row, never dismissed. */
    canDisable: boolean;
    /** Notice codes that feed a condition kind. Empty for events. */
    noticeCodes: readonly NoticeCode[];
};

export const NOTIFICATION_KINDS: Record<
    NotificationKind,
    NotificationKindSpec
> = {
    allergens: {
        id: "allergens",
        source: "condition",
        bucket: "household",
        defaultOn: true,
        canDisable: false,
        noticeCodes: [
            "grocery.allergen",
            "recipe.allergen",
            "food.product_allergen",
        ],
    },
    food_expiring: {
        id: "food_expiring",
        source: "condition",
        bucket: "household",
        defaultOn: true,
        canDisable: true,
        noticeCodes: ["fridge.expiring", "fridge.expired"],
    },
    running_low: {
        id: "running_low",
        source: "condition",
        bucket: "household",
        defaultOn: true,
        canDisable: true,
        noticeCodes: ["grocery.running_low"],
    },
    weigh_in_due: {
        id: "weigh_in_due",
        source: "condition",
        bucket: "personal",
        defaultOn: true,
        canDisable: true,
        noticeCodes: ["nutrition.weigh_in_due"],
    },
    // Events: written by deleteRecipe, planRecipe / unplanRecipe, and
    // setUsualProduct / Add a usual.
    recipe_changes: {
        id: "recipe_changes",
        source: "event",
        bucket: "household",
        defaultOn: false,
        canDisable: true,
        noticeCodes: [],
    },
    week_plan_changes: {
        id: "week_plan_changes",
        source: "event",
        bucket: "household",
        defaultOn: false,
        canDisable: true,
        noticeCodes: [],
    },
    new_usuals: {
        id: "new_usuals",
        source: "event",
        bucket: "household",
        defaultOn: false,
        canDisable: true,
        noticeCodes: [],
    },
};

/** Registry order: the order Settings lists them in. */
export const NOTIFICATION_KIND_IDS: readonly NotificationKind[] = [
    "allergens",
    "food_expiring",
    "running_low",
    "weigh_in_due",
    "recipe_changes",
    "week_plan_changes",
    "new_usuals",
];

export function isNotificationKind(value: unknown): value is NotificationKind {
    return (
        typeof value === "string" && Object.hasOwn(NOTIFICATION_KINDS, value)
    );
}

const KIND_BY_CODE: ReadonlyMap<NoticeCode, NotificationKind> = new Map(
    NOTIFICATION_KIND_IDS.flatMap((id) =>
        NOTIFICATION_KINDS[id].noticeCodes.map(
            (code) => [code, id] as [NoticeCode, NotificationKind],
        ),
    ),
);

/** The inbox kind a notice code feeds, or null for a code that is not a
 * notification (data-quality marks, plan gaps, restocked). */
export function kindForNoticeCode(code: NoticeCode): NotificationKind | null {
    return KIND_BY_CODE.get(code) ?? null;
}
