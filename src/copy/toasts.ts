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
    "fridge.item.added": { kind: "success", text: "Added to the fridge" },
    "fridge.item.removed": {
        kind: "success",
        text: "Removed from the fridge",
    },
    "fridge.item.updated": { kind: "success", text: "Fridge item updated" },
    "fridge.item.eaten": { kind: "success", text: "Marked as eaten" },
    "fridge.item.eaten.unknown": {
        kind: "warning",
        text: "Marked as eaten. Nutrition unknown: log it in ml or set its grams per ml",
    },
    "fridge.item.discarded": { kind: "success", text: "Item discarded" },
    "fridge.items.discarded": { kind: "success", text: "Items discarded" },
    "fridge.item.added-to-grocery": {
        kind: "success",
        text: "Added to the grocery list",
    },
    "fridge.item.already-on-grocery": {
        kind: "info",
        text: "Already on the grocery list",
    },

    "grocery.line.added": {
        kind: "success",
        text: "Added to the grocery list",
    },
    "grocery.line.checked": { kind: "success", text: "Checked off" },
    "grocery.line.unchecked": { kind: "success", text: "Unchecked" },
    "grocery.lines.removed": { kind: "success", text: "Removed from the list" },
    "grocery.checked.cleared": {
        kind: "success",
        text: "Checked items cleared",
    },
    "grocery.line.put-away": {
        kind: "success",
        text: "Put away in the fridge",
    },

    "usuals.schedule.saved": { kind: "success", text: "Restock saved" },
    "usuals.added": { kind: "success", text: "Added to usuals" },
    "usuals.removed": { kind: "success", text: "Removed from usuals" },

    "nutrition.meal.logged": { kind: "success", text: "Meal logged" },
    "nutrition.meal.updated": { kind: "success", text: "Meal updated" },
    "nutrition.meal.deleted": { kind: "success", text: "Meal deleted" },
    "nutrition.meal.undo.restored": {
        kind: "success",
        text: "Meal restored",
    },
    "nutrition.meal.undo.noop": { kind: "info", text: "Meal already restored" },
    "nutrition.meal.copy-yesterday.noop": {
        kind: "info",
        text: "Already copied from yesterday",
    },
    "nutrition.meal.copy-yesterday.none": {
        kind: "info",
        text: "Nothing to copy from yesterday",
    },
    "nutrition.water.logged": { kind: "success", text: "Water logged" },
    "nutrition.weight.logged": { kind: "success", text: "Weight logged" },

    "recipes.cooked": { kind: "success", text: "Recipe cooked" },
    "recipes.cooked.shortfall": {
        kind: "warning",
        text: "Recipe cooked — some ingredients were short",
    },
    "recipes.cooked.shortfall.unmeasured": {
        kind: "warning",
        text: "Recipe cooked — some ingredients were short. Nothing deducted for: {names}.",
    },
    "recipes.cooked.unmeasured": {
        kind: "info",
        text: "Recipe cooked. Nothing deducted for: {names}.",
    },
    "recipes.cooked.logged": {
        kind: "success",
        text: "Recipe cooked · 1 serving logged to {slot}",
    },
    "recipes.cooked.changed": {
        kind: "warning",
        text: "Recipe cooked, but your kitchen had changed since the preview: {names}",
    },
    "recipes.cooked.changed.logged": {
        kind: "warning",
        text: "Recipe cooked · 1 serving logged to {slot}, but your kitchen had changed since the preview: {names}",
    },
    "recipes.cooked.shortfall.logged": {
        kind: "warning",
        text: "Recipe cooked · 1 serving logged to {slot} — some ingredients were short",
    },
    "recipes.cooked.shortfall.unmeasured.logged": {
        kind: "warning",
        text: "Recipe cooked · 1 serving logged to {slot} — some ingredients were short. Nothing deducted for: {names}.",
    },
    "recipes.cooked.unmeasured.logged": {
        kind: "info",
        text: "Recipe cooked · 1 serving logged to {slot}. Nothing deducted for: {names}.",
    },
    "recipes.cooked.already": {
        kind: "info",
        text: "Already cooked and logged",
    },
    "recipes.deleted": { kind: "success", text: "Recipe deleted" },
    "plan.added": { kind: "success", text: "Planned for {when}" },
    "plan.already": { kind: "info", text: "Already planned for {when}" },
    "plan.moved": { kind: "success", text: "Moved to {when}" },
    "plan.merged": {
        kind: "success",
        text: "Added to the plan already on {when}",
    },
    "plan.removed": { kind: "success", text: "Removed from the plan" },
    "plan.gone": { kind: "info", text: "That plan is already gone" },
    "plan.notice": { kind: "warning", text: "{message}" },
    "plan.missing.added": {
        kind: "success",
        text: "Added to the grocery list ({count})",
    },
    "plan.missing.added.unknown": {
        kind: "warning",
        text: "Added to the grocery list ({count}). Check what you have of: {names}",
    },
    "plan.missing.on-list": {
        kind: "info",
        text: "Already on the grocery list",
    },
    "plan.missing.none": {
        kind: "info",
        text: "Nothing is missing for the plan",
    },
    "notice.added": {
        kind: "success",
        text: "Added {name} to the grocery list",
    },
    "notice.added.check": {
        kind: "warning",
        text: "Added {name} to the grocery list. Check what you have",
    },
    "notice.gone": {
        kind: "info",
        text: "That one is already taken care of",
    },
    "notice.error": { kind: "warning", text: "{message}" },
    "recipes.unverified.blocked": {
        kind: "info",
        text: "This recipe changed and is unverified now. Ask your AI assistant to fix it before you cook it.",
    },
    "recipes.import.imported": {
        kind: "success",
        text: "Imported {name} from {site}.",
    },
    "recipes.import.shared": {
        kind: "success",
        text: "Imported {name}. {matched} matched your foods, {created} added.",
    },
    "recipes.import.unverified_needs_review": {
        kind: "warning",
        text: "Imported as unverified: {count} need checking.",
    },
    "recipes.import.unverified_needs_review_one": {
        kind: "warning",
        text: "Imported as unverified: {count} needs checking.",
    },
    "recipes.import.paste_needed": {
        kind: "info",
        text: "Paste the {platform} caption below.",
    },
    "recipes.import.paste_needed_site": {
        kind: "info",
        text: "Paste the recipe from {site} below.",
    },
    "recipes.import.paste_needed_reader": {
        kind: "info",
        text: "Paste the {platform} caption below. {reason}",
    },
    "recipes.import.no_recipe_in_text": {
        kind: "warning",
        text: "This caption doesn't contain a recipe. If it's in the photos, type it in or send a screenshot to your agent.",
    },
    "recipes.import.no_recipe_on_page": {
        kind: "warning",
        text: "This page doesn't publish its recipe in a form we can read. Paste the recipe instead.",
    },
    "recipes.import.robots_disallowed": {
        kind: "warning",
        text: "This site asks apps not to read this page. Paste the recipe instead.",
    },
    "recipes.import.site_refused": {
        kind: "error",
        text: "The site refused the request. Paste the recipe instead.",
    },
    "recipes.import.site_refused_recent": {
        kind: "warning",
        text: "This site refused Foodable recently. Paste the recipe instead.",
    },
    "recipes.import.not_found": {
        kind: "error",
        text: "That page doesn't exist anymore.",
    },
    "recipes.import.not_found_recent": {
        kind: "error",
        text: "That page doesn't exist anymore.",
    },
    "recipes.import.timeout": {
        kind: "error",
        text: "The page took too long to respond.",
    },
    "recipes.import.duplicate": {
        kind: "info",
        text: "You already imported this.",
    },
    "recipes.import.invalid_link": {
        kind: "error",
        text: "That doesn't look like a web link.",
    },
    "household.recipe-settings.saved": {
        kind: "success",
        text: "Recipe settings saved",
    },
    "household.plurals-same-food.saved": {
        kind: "success",
        text: "Food name matching updated",
    },
    "household.fetch-refusal.cleared": {
        kind: "success",
        text: "{host} can be read again",
    },
    "household.social-reader.on": {
        kind: "success",
        text: "{platform} reader on",
    },
    "household.social-reader.off": {
        kind: "success",
        text: "{platform} reader off",
    },

    "settings.nutrition.saved": {
        kind: "success",
        text: "Nutrition preferences saved",
    },
    "settings.goals.saved": { kind: "success", text: "Goals saved" },
    "settings.goals.day-cleared": {
        kind: "success",
        text: "Day back on your daily goals",
    },
    "settings.score.saved": { kind: "success", text: "Score weights saved" },
    "settings.score.household": {
        kind: "success",
        text: "Using the household default",
    },
    "settings.score.household-saved": {
        kind: "success",
        text: "Household default saved",
    },
    "settings.score.household-cleared": {
        kind: "success",
        text: "Household default cleared",
    },
    "settings.ai.disconnected": { kind: "success", text: "App disconnected" },
    "settings.ai.already-disconnected": {
        kind: "info",
        text: "That app was already disconnected",
    },
    "settings.profile.saved": { kind: "success", text: "Profile updated" },
    "settings.household.created": {
        kind: "success",
        text: "Household created",
    },
    "settings.household.member.added": {
        kind: "success",
        text: "Member added",
    },
    "settings.household.name.saved": {
        kind: "success",
        text: "Household name updated",
    },
    "settings.household.location.saved": {
        kind: "success",
        text: "Location updated",
    },
    "settings.household.shared-link.revoked": {
        kind: "success",
        text: "Link revoked",
    },
    "settings.household.ownership.transferred": {
        kind: "success",
        text: "Ownership transferred",
    },
    "settings.household.member.removed": {
        kind: "success",
        text: "Member removed",
    },
    "settings.household.store.added": { kind: "success", text: "Store added" },
    "settings.household.section.renamed": {
        kind: "success",
        text: "Section renamed",
    },
    "stores.renamed": { kind: "success", text: "Store renamed" },
    "stores.reordered": { kind: "success", text: "Store order saved" },
    "stores.deleted": { kind: "success", text: "Store deleted" },
    "stores.deleted-moved": {
        kind: "success",
        text: "Store deleted. {lines} moved to {store}",
    },
    "stores.preferences.saved": {
        kind: "success",
        text: "Store settings saved",
    },
    "stores.section.added": { kind: "success", text: "Section added" },
    "stores.section.reordered": {
        kind: "success",
        text: "Section order saved",
    },
    "stores.section.hidden": { kind: "success", text: "Section hidden" },
    "stores.section.shown": { kind: "success", text: "Section shown" },
    "settings.household.store-rule.added": {
        kind: "success",
        text: "Store rule added",
    },
    "settings.household.allergen.added": {
        kind: "success",
        text: "Allergen added",
    },
    "settings.household.dislike.added": {
        kind: "success",
        text: "Dislike added",
    },
    "settings.household.rule.added": { kind: "success", text: "Rule added" },
    "settings.household.rule.removed": {
        kind: "success",
        text: "Rule removed",
    },
    "settings.household.allergen.removed": {
        kind: "success",
        text: "Allergen removed",
    },
    "settings.household.dislike.removed": {
        kind: "success",
        text: "Dislike removed",
    },
    "settings.household.role.updated": {
        kind: "success",
        text: "Role updated",
    },
    "settings.foods.merged": { kind: "success", text: "Foods merged" },
    "settings.foods.updated": { kind: "success", text: "Food saved" },
    "settings.saved.deleted": { kind: "success", text: "Deleted" },
} as const satisfies Record<string, { kind: ToastKind; text: string }>;

export type ToastKey = keyof typeof TOASTS;
