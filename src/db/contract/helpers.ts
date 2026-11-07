import type { Food } from "../../domain/foods.js";
import type { FridgeItem, FridgeLocation } from "../../domain/fridge.js";
import type { GroceryLine } from "../../domain/grocery.js";
import type { Recipe, RecipeIngredient } from "../../domain/recipes.js";
import type {
    MemberAllergen,
    MemberDislike,
    PersonRule,
    StoreRule,
} from "../../domain/rules.js";
import type { StockMovement } from "../../domain/stock.js";
import type { GrocerySection, GroceryStore } from "../../domain/settings.js";

export type StoreContractCtx = {
    householdId: string;
    userId: string;
    otherHouseholdId: string;
    storeId: string;
    sectionId: string;
    foodId: string;
    locationId: string;
    setLineCreatedAt?: (lineId: string, createdAt: string) => Promise<void>;
    setAllergenCreatedAt?: (id: string, createdAt: string) => Promise<void>;
    setDislikeCreatedAt?: (id: string, createdAt: string) => Promise<void>;
    setFridgeItemCreatedAt?: (id: string, createdAt: string) => Promise<void>;
    sql?: import("bun").SQL;
};

export function sampleFood(
    householdId: string,
    overrides: Partial<Food> = {},
): Food {
    const id = overrides.id ?? crypto.randomUUID();
    const now = "2026-03-01T12:00:00+00:00";
    return {
        id,
        householdId,
        kind: "food",
        name: "Apple",
        normalizedName: "apple",
        brand: null,
        defaultUnit: "g",
        gramsPerEach: null,
        gramsPerMl: null,
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        allergens: [],
        offSourceId: null,
        genericFoodId: null,
        usualProductId: null,
        usualStoreId: null,
        usualAmount: null,
        createdBy: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function sampleMovement(
    ctx: StoreContractCtx,
    overrides: Partial<StockMovement> = {},
): StockMovement {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        foodId: ctx.foodId,
        fridgeItemId: null,
        delta: 1,
        unit: "g",
        reason: "purchase",
        groceryLineId: null,
        recipeId: null,
        mealId: null,
        actorUserId: ctx.userId,
        createdAt: "2026-01-02T12:00:00+00:00",
        ...overrides,
    };
}

export function sampleGroceryLine(
    ctx: StoreContractCtx,
    overrides: Partial<GroceryLine> = {},
): GroceryLine {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        storeId: ctx.storeId,
        sectionId: ctx.sectionId,
        kind: "food",
        displayName: "Milk",
        quantity: { amount: 1, unit: "L" },
        foodId: ctx.foodId,
        checked: false,
        note: null,
        ...overrides,
    };
}

export function sampleFridgeLocation(
    ctx: StoreContractCtx,
    overrides: Partial<FridgeLocation> = {},
): FridgeLocation {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        name: "Pantry",
        sortOrder: 1,
        ...overrides,
    };
}

export function sampleFridgeItem(
    ctx: StoreContractCtx,
    overrides: Partial<FridgeItem> = {},
): FridgeItem {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        locationId: ctx.locationId,
        kind: "food",
        displayName: "Yogurt",
        quantity: { amount: 1, unit: "each" },
        foodId: ctx.foodId,
        purchasedOn: null,
        openedOn: null,
        expiresOn: null,
        ...overrides,
    };
}

export function sampleGroceryStoreRow(
    ctx: StoreContractCtx,
    overrides: Partial<GroceryStore> = {},
): GroceryStore {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        name: "Corner shop",
        sortOrder: 1,
        ...overrides,
    };
}

export function sampleGrocerySectionRow(
    ctx: StoreContractCtx,
    overrides: Partial<GrocerySection> = {},
): GrocerySection {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        storeId: ctx.storeId,
        name: "Dry goods",
        sortOrder: 1,
        hidden: false,
        isOther: false,
        ...overrides,
    };
}

export function sampleStoreRule(
    ctx: StoreContractCtx,
    overrides: Partial<StoreRule> = {},
): StoreRule {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        storeId: ctx.storeId,
        body: "Buy organic",
        sortOrder: 0,
        ...overrides,
    };
}

export function samplePersonRule(
    ctx: StoreContractCtx,
    overrides: Partial<PersonRule> = {},
): PersonRule {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        userId: ctx.userId,
        body: "No peanuts",
        sortOrder: 0,
        ...overrides,
    };
}

export function sampleAllergen(
    ctx: StoreContractCtx,
    overrides: Partial<MemberAllergen> = {},
): MemberAllergen {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        userId: ctx.userId,
        allergen: "peanut",
        otherLabel: null,
        ...overrides,
    };
}

export function sampleDislike(
    ctx: StoreContractCtx,
    overrides: Partial<MemberDislike> = {},
): MemberDislike {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        userId: ctx.userId,
        displayName: "Olives",
        ...overrides,
    };
}

export function sampleRecipe(
    ctx: StoreContractCtx,
    overrides: Partial<Recipe> = {},
): Recipe {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        creatorId: ctx.userId,
        name: "Soup",
        yieldPortions: 4,
        instructions: null,
        sourceUrl: null,
        tags: ["quick"],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "verified",
        updatedAt: "2026-03-01T12:00:00+00:00",
        ...overrides,
    };
}

export function sampleIngredient(
    ctx: StoreContractCtx,
    recipeId: string,
    overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        recipeId,
        kind: "food",
        displayName: "Carrot",
        quantity: { amount: 2, unit: "each" },
        foodId: ctx.foodId,
        sortOrder: 0,
        note: null,
        ...overrides,
    };
}
