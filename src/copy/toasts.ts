export const TOASTS = {
    "fridge.location.added": { kind: "success", text: "Location added" },
    "fridge.location.removed": { kind: "success", text: "Location removed" },
    "fridge.item.added": { kind: "success", text: "Added to the fridge" },
    "fridge.item.removed": {
        kind: "success",
        text: "Removed from the fridge",
    },
    "fridge.item.updated": { kind: "success", text: "Fridge item updated" },
    "fridge.item.eaten": { kind: "success", text: "Marked as eaten" },
    "fridge.item.discarded": { kind: "success", text: "Item discarded" },

    "grocery.store.added": { kind: "success", text: "Store added" },
    "grocery.line.added": {
        kind: "success",
        text: "Added to the grocery list",
    },
    "grocery.line.checked": { kind: "success", text: "Grocery line updated" },
    "grocery.checked.cleared": {
        kind: "success",
        text: "Checked items cleared",
    },
    "grocery.line.put-away": {
        kind: "success",
        text: "Put away in the fridge",
    },

    "nutrition.meal.logged": { kind: "success", text: "Meal logged" },
    "nutrition.water.logged": { kind: "success", text: "Water logged" },
    "nutrition.weight.logged": { kind: "success", text: "Weight logged" },
    "nutrition.layout.saved": {
        kind: "success",
        text: "Dashboard layout saved",
    },

    "recipes.created": { kind: "success", text: "Recipe created" },
    "recipes.portion.logged": { kind: "success", text: "Portion logged" },
    "recipes.cooked": { kind: "success", text: "Recipe cooked" },
    "recipes.updated": { kind: "success", text: "Recipe saved" },
    "recipes.ingredient.removed": {
        kind: "success",
        text: "Ingredient removed",
    },
    "recipes.ingredient.reordered": {
        kind: "success",
        text: "Ingredient order updated",
    },
    "recipes.ingredient.updated": {
        kind: "success",
        text: "Ingredient updated",
    },
    "recipes.deleted": { kind: "success", text: "Recipe deleted" },
    "recipes.ingredient.added": {
        kind: "success",
        text: "Ingredient added",
    },
    "recipes.portion.saved": {
        kind: "success",
        text: "Your portion size saved",
    },
    "recipes.added-to-grocery": {
        kind: "success",
        text: "Added to the grocery list",
    },

    "settings.nutrition.saved": {
        kind: "success",
        text: "Nutrition preferences saved",
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
    "settings.household.role.updated": {
        kind: "success",
        text: "Role updated",
    },
    "settings.foods.merged": { kind: "success", text: "Foods merged" },
    "settings.foods.updated": { kind: "success", text: "Food saved" },
} as const;

export type ToastKey = keyof typeof TOASTS;
export type ToastKind = (typeof TOASTS)[ToastKey]["kind"];
