import { Hono } from "hono";
import { renderFridgeInventoryPage } from "../loaders.js";

import { formAmount, formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { lookupBarcode } from "../../foods.js";
import {
    addLocation,
    deleteLocation,
    FridgeInputError,
    moveItem,
    prepareAddFoodByBarcode,
    prepareAddFoodById,
    prepareAddManualFood,
    prepareAddSupply,
} from "../../domain/fridge.js";
import {
    addFridgeItemAdjust,
    deleteFridgeItemAdjust,
    discardFridgeItem,
    eatFridgeItem,
    StockInputError,
    updateFridgeItemQuantityAdjust,
} from "../../domain/stock.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveStockStore } from "../../db/stock.js";
import { insertMeal, snapshotToMealItemWrite } from "../../db/nutrition.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";

export const fridgeRoutes = new Hono();

export async function fridgeBarcodeLookup(barcode: string) {
    try {
        return await lookupBarcode(barcode);
    } catch {
        return null;
    }
}

async function fridgeFormError(userId: string, err: unknown) {
    const message =
        err instanceof FridgeInputError
            ? err.message
            : err instanceof StockInputError
              ? err.message
              : err instanceof MealItemsError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Could not update the fridge.";
    const page = await renderFridgeInventoryPage(userId, message);
    return { html: page.html, status: 400 as const };
}

fridgeRoutes.get("/fridge", requireSiteUser, async (c) => {
    const page = await renderFridgeInventoryPage(c.get("userId"));
    return c.html(page.html, page.status);
});

fridgeRoutes.post("/fridge/locations", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    try {
        await addLocation(
            liveFridgeStore(),
            member.householdId,
            formText(body, "name"),
        );
    } catch (err) {
        const page = await fridgeFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/fridge");
});

fridgeRoutes.post("/fridge/locations/:id/delete", requireMember, async (c) => {
    const member = siteMember(c);
    await deleteLocation(
        liveFridgeStore(),
        member.householdId,
        c.req.param("id"),
    );
    return c.redirect("/fridge");
});

fridgeRoutes.post("/fridge/items", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const store = liveFridgeStore();
    const foods = liveFoodsStore();
    const locationId = formText(body, "location_id");
    const kind = formText(body, "kind");
    const amount = formAmount(body, "qty_amount");
    try {
        const prepared =
            kind === "supply"
                ? await prepareAddSupply(store, foods, {
                      householdId: member.householdId,
                      locationId,
                      name: formText(body, "name"),
                      amount,
                      unit: formText(body, "qty_unit"),
                      foodId: formText(body, "food_id") || undefined,
                  })
                : formText(body, "food_id")
                  ? await prepareAddFoodById(store, foods, {
                        householdId: member.householdId,
                        locationId,
                        foodId: formText(body, "food_id"),
                        amount,
                        unit: formText(body, "qty_unit"),
                    })
                  : formText(body, "barcode")
                    ? await prepareAddFoodByBarcode(
                          store,
                          foods,
                          {
                              householdId: member.householdId,
                              locationId,
                              barcode: formText(body, "barcode"),
                              amount,
                              unit: formText(body, "qty_unit"),
                          },
                          { lookup: fridgeBarcodeLookup },
                      )
                    : await prepareAddManualFood(store, foods, {
                          householdId: member.householdId,
                          locationId,
                          name: formText(body, "food_name"),
                          amount,
                          unit: formText(body, "qty_unit"),
                      });
        await addFridgeItemAdjust(store, liveStockStore(), foods, {
            householdId: prepared.householdId,
            foodId: prepared.food.id,
            amount: prepared.amount,
            unit: prepared.unit,
            locationId: prepared.locationId,
            actorUserId: userId,
        });
    } catch (err) {
        const page = await fridgeFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/fridge");
});

fridgeRoutes.post("/fridge/items/:id/delete", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    try {
        await deleteFridgeItemAdjust(
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                itemId: c.req.param("id"),
                actorUserId: userId,
            },
        );
    } catch (err) {
        const page = await fridgeFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/fridge");
});

fridgeRoutes.post("/fridge/items/:id", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const store = liveFridgeStore();
    const itemId = c.req.param("id");
    try {
        await updateFridgeItemQuantityAdjust(
            store,
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                itemId,
                amount: formAmount(body, "qty_amount"),
                unit: formText(body, "qty_unit"),
                actorUserId: userId,
            },
        );
        const locationId = formText(body, "location_id");
        if (locationId) {
            await moveItem(store, member.householdId, itemId, locationId);
        }
        const expiresOn = formText(body, "expires_on").trim();
        const items = await store.listItems(member.householdId);
        const current = items.find((item) => item.id === itemId);
        if (current) {
            await store.updateItem({
                ...current,
                expiresOn: expiresOn || null,
            });
        }
    } catch (err) {
        const page = await fridgeFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/fridge");
});

fridgeRoutes.post("/fridge/items/:id/eat", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    try {
        const eaten = await eatFridgeItem(
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                itemId: c.req.param("id"),
                actorUserId: userId,
            },
        );
        const applied = Math.abs(eaten.movement.delta);
        if (applied > 0 && eaten.itemBefore.foodId) {
            const { built, specs } = await resolveAndBuildMeal({
                householdId: member.householdId,
                foods: liveFoodsStore(),
                recipes: liveRecipesStore(),
                items: [
                    {
                        foodId: eaten.itemBefore.foodId,
                        amount: applied,
                        unit: eaten.itemBefore.quantity.unit,
                        name: eaten.itemBefore.displayName,
                    },
                ],
            });
            const { meal } = await insertMeal(userId, {
                description: descriptionFromItems(built.items),
                meal_type: "snack",
                calories: built.totals.calories ?? undefined,
                protein_g: built.totals.protein_g ?? undefined,
                carbs_g: built.totals.carbs_g ?? undefined,
                fat_g: built.totals.fat_g ?? undefined,
                fiber_g: built.totals.fiber_g ?? undefined,
                sugar_g: built.totals.sugar_g ?? undefined,
                alcohol_g: built.totals.alcohol_g ?? undefined,
                caffeine_mg: built.totals.caffeine_mg ?? undefined,
                items: built.items.map((item) =>
                    snapshotToMealItemWrite(item, member.householdId),
                ),
                item_digest: itemListDigest(specs),
            });
            await liveStockStore().linkMeal(
                member.householdId,
                eaten.movement.id,
                meal.id,
            );
        }
    } catch (err) {
        const page = await fridgeFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/fridge");
});

fridgeRoutes.post("/fridge/items/:id/discard", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    try {
        await discardFridgeItem(
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                itemId: c.req.param("id"),
                actorUserId: userId,
            },
        );
    } catch (err) {
        const page = await fridgeFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/fridge");
});
