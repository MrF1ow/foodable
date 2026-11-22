/** success = green, info = blue, warning = amber, error = red. Form errors
 *  still render as banners; `error` is for actions that run in the browser. */
export type ToastKind = "success" | "info" | "warning" | "error";

/**
 * The note on a grocery line the plan added at the recipe's full amount
 * because what the kitchen holds could not be counted. The domain's own notice
 * names the food and the amount, which the line already shows.
 */
export const PLAN_UNKNOWN_LINE_NOTE = "Check what you have";

export const TOASTS = {
    "fridge.item.eaten.unknown": {
        kind: "warning",
        text: "Marked as eaten. Nutrition unknown: log it in ml or set its grams per ml",
    },
    "fridge.item.already-on-grocery": {
        kind: "info",
        text: "Already on the grocery list",
    },
    "nutrition.meal.copy-yesterday.none": {
        kind: "info",
        text: "Nothing to copy from yesterday",
    },
    "recipes.cooked.short": {
        kind: "warning",
        text: "Recipe cooked, but some ingredients were short or not counted: {names}",
    },
    "recipes.cooked.changed": {
        kind: "warning",
        text: "Recipe cooked, but your kitchen had changed since the preview: {names}",
    },
    "recipes.mention.error": { kind: "error", text: "{message}" },
    "plan.notice": { kind: "warning", text: "{message}" },
    "plan.missing.added.unknown": {
        kind: "warning",
        text: "Added to the grocery list ({count}). Check what you have of: {names}",
    },
    "plan.missing.none": {
        kind: "info",
        text: "Nothing is missing for the plan",
    },
    "notice.added.check": {
        kind: "warning",
        text: "Added {name} to the grocery list. Check what you have",
    },
    "notice.error": { kind: "warning", text: "{message}" },
    "recipes.unverified.blocked": {
        kind: "info",
        text: "This recipe changed and is unverified now. Ask your AI assistant to fix it before you cook it.",
    },
    "recipes.import.duplicate": {
        kind: "info",
        text: "You already imported this.",
    },
} as const satisfies Record<string, { kind: ToastKind; text: string }>;

export type ToastKey = keyof typeof TOASTS;
