import { Hono } from "hono";
import { renderFridgeInventoryPage } from "../loaders.js";

import { formAmount, formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { lookupBarcode } from "../../foods.js";
import {
    addLocation,
    deleteLocation,
    FridgeInputError,
    freezeFridgeItem,
    moveItem,
    prepareAddFoodById,
    prepareAddManualFood,
    prepareAddSupply,
} from "../../domain/fridge.js";
import {
    addFridgeItemAdjust,
    deleteFridgeItemAdjust,
    discardFridgeItem,
    eatFridgeItem,
    fridgeEatLogsMeal,
    StockInputError,
    updateFridgeItemQuantityAdjust,
} from "../../domain/stock.js";
import { findFoodById } from "../../domain/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import {
    findOrCreateFoodByBarcodeResult,
    linkProductPromptPath,
} from "../../domain/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveStockStore } from "../../db/stock.js";
import { insertMeal, snapshotToMealItemWrite } from "../../db/nutrition.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";
import { redirectWithToast } from "../components/toast.js";
import {
    addFridgeItemToGrocery,
    GroceryInputError,
} from "../../domain/grocery.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveSettingsStore } from "../../db/settings.js";
import { safeReturnPath } from "../usual-products-path.js";
import { buildDidYouMeanModal } from "../components/did-you-mean.js";
import {
    fridgeItemRetryFields,
    isSimilarFoodsError,
    manualOnSimilar,
    rememberAliasIfRequested,
} from "../form.js";

export const fridgeRoutes = new Hono();

export async function fridgeBarcodeLookup(
    barcode: string,
    householdId: string,
) {
    return lookupBarcode(barcode, { householdId });
}

async function fridgeFormError(
    userId: string,
    err: unknown,
    openModalId?: string,
    extras?: {
        didYouMean?: import("../components/did-you-mean.js").DidYouMeanModal;
    },
    opts?: { openItemId?: string },
) {
    const message =
        err instanceof FridgeInputError
            ? err.message
            : err instanceof StockInputError
              ? err.message
              : err instanceof GroceryInputError
                ? err.message
                : err instanceof MealItemsError
                  ? err.message
                  : err instanceof Error
                    ? err.message
                    : "Could not update the fridge.";
    const page = await renderFridgeInventoryPage(
        userId,
        message,
        openModalId,
        extras,
        opts,
    );
    return { html: page.html, status: 400 as const };
}

function fridgeReturnTo(body: Record<string, string | File>) {
    return safeReturnPath(formText(body, "return_to"), "/kitchen/fridge");
}

function formFieldSent(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): boolean {
    return Object.hasOwn(body, key);
}

fridgeRoutes.get("/kitchen/fridge", requireSiteUser, async (c) => {
    const page = await renderFridgeInventoryPage(
        c.get("userId"),
        undefined,
        undefined,
        undefined,
        {
            openItemId: c.req.query("item"),
            openAdd: c.req.query("add") === "1",
        },
    );
    return c.html(page.html, page.status);
});

fridgeRoutes.post("/kitchen/fridge/locations", requireMember, async (c) => {
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
        const page = await fridgeFormError(userId, err, "fridge-add-location");
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/kitchen/fridge", "fridge.location.added");
});

fridgeRoutes.post(
    "/kitchen/fridge/locations/:id/delete",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const id = c.req.param("id");
        try {
            await deleteLocation(liveFridgeStore(), member.householdId, id);
        } catch (err) {
            const page = await fridgeFormError(
                userId,
                err,
                `fridge-remove-location-${id}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/kitchen/fridge",
            "fridge.location.removed",
        );
    },
);

fridgeRoutes.post("/kitchen/fridge/items", requireMember, async (c) => {
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
                    ? await (async () => {
                          const { food, created } =
                              await findOrCreateFoodByBarcodeResult(
                                  foods,
                                  member.householdId,
                                  formText(body, "barcode"),
                                  (barcode) =>
                                      fridgeBarcodeLookup(
                                          barcode,
                                          member.householdId,
                                      ),
                              );
                          const prepared = await prepareAddFoodById(
                              store,
                              foods,
                              {
                                  householdId: member.householdId,
                                  locationId,
                                  foodId: food.id,
                                  amount,
                                  unit: formText(body, "qty_unit"),
                              },
                          );
                          return { ...prepared, barcodeCreated: created };
                      })()
                    : await prepareAddManualFood(store, foods, {
                          householdId: member.householdId,
                          locationId,
                          name: formText(body, "food_name"),
                          amount,
                          unit: formText(body, "qty_unit"),
                          onSimilar: manualOnSimilar(body),
                      });
        await addFridgeItemAdjust(store, liveStockStore(), foods, {
            householdId: prepared.householdId,
            foodId: prepared.food.id,
            amount: prepared.amount,
            unit: prepared.unit,
            locationId: prepared.locationId,
            actorUserId: userId,
        });
        const pickedFoodId =
            kind !== "supply" ? formText(body, "food_id").trim() : "";
        if (pickedFoodId) {
            await rememberAliasIfRequested(
                foods,
                member.householdId,
                body,
                pickedFoodId,
            );
        }
        const created =
            "barcodeCreated" in prepared && prepared.barcodeCreated === true;
        if (created) {
            const catalog = await foods.listFoods(member.householdId);
            const prompt = linkProductPromptPath(
                prepared.food,
                catalog,
                "/kitchen/fridge",
            );
            if (prompt) {
                // toast: none (link-product prompt on destination)
                return c.redirect(prompt, 303);
            }
        }
    } catch (err) {
        const openModalId =
            kind === "supply"
                ? `fridge-add-supply-${locationId}`
                : `fridge-add-food-${locationId}`;
        if (isSimilarFoodsError(err) && kind !== "supply") {
            const didYouMean = buildDidYouMeanModal(
                err,
                fridgeItemRetryFields(body),
                openModalId,
                "/kitchen/fridge/items",
            );
            if (didYouMean) {
                const page = await renderFridgeInventoryPage(
                    userId,
                    undefined,
                    openModalId,
                    { didYouMean },
                );
                return c.html(page.html, 409);
            }
        }
        const page = await fridgeFormError(userId, err, openModalId);
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/kitchen/fridge", "fridge.item.added");
});

fridgeRoutes.post(
    "/kitchen/fridge/items/:id/delete",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        try {
            const removed = await deleteFridgeItemAdjust(
                liveFridgeStore(),
                liveStockStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    itemId: c.req.param("id"),
                    actorUserId: userId,
                },
            );
            if (!removed) {
                throw new StockInputError(
                    "That item is no longer in the fridge.",
                );
            }
        } catch (err) {
            const page = await fridgeFormError(
                userId,
                err,
                `fridge-delete-${c.req.param("id")}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(c, "/kitchen/fridge", "fridge.item.removed");
    },
);

fridgeRoutes.post("/kitchen/fridge/items/:id", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const store = liveFridgeStore();
    const itemId = c.req.param("id");
    const returnTo = fridgeReturnTo(body as Record<string, string | File>);
    try {
        const updated = await updateFridgeItemQuantityAdjust(
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
        if (!updated) {
            throw new StockInputError("That item is no longer in the fridge.");
        }
        const locationId = formText(body, "location_id");
        if (locationId) {
            await moveItem(store, member.householdId, itemId, locationId);
        }
        if (formFieldSent(body, "expires_on")) {
            const expiresOn = formText(body, "expires_on").trim();
            const items = await store.listItems(member.householdId);
            const current = items.find((item) => item.id === itemId);
            if (current) {
                await store.updateItem({
                    ...current,
                    expiresOn: expiresOn || null,
                });
            }
        }
    } catch (err) {
        const page = await fridgeFormError(
            userId,
            err,
            `fridge-edit-${itemId}`,
            undefined,
            { openItemId: itemId },
        );
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, returnTo, "fridge.item.updated");
});

fridgeRoutes.post("/kitchen/fridge/items/:id/eat", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const itemId = c.req.param("id");
    const returnTo = fridgeReturnTo(body as Record<string, string | File>);
    const rawAmount = formText(body, "qty_amount").trim();
    const amount =
        rawAmount === "" ? undefined : formAmount(body, "qty_amount");
    try {
        const eaten = await eatFridgeItem(
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                itemId,
                amount,
                actorUserId: userId,
            },
        );
        const applied = Math.abs(eaten.movement.delta);
        const foodId = eaten.itemBefore.foodId;
        if (applied > 0 && foodId) {
            const food = await findFoodById(
                liveFoodsStore(),
                member.householdId,
                foodId,
            );
            if (!fridgeEatLogsMeal(food)) {
                return redirectWithToast(c, returnTo, "fridge.item.eaten");
            }
            const { built, specs } = await resolveAndBuildMeal({
                householdId: member.householdId,
                foods: liveFoodsStore(),
                recipes: liveRecipesStore(),
                items: [
                    {
                        foodId,
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
            // A per-100 ml food kept in grams with no density logs a meal
            // with no figures; say so rather than a plain success.
            if (built.unknownItems.length > 0) {
                return redirectWithToast(
                    c,
                    returnTo,
                    "fridge.item.eaten.unknown",
                );
            }
        }
    } catch (err) {
        const page = await fridgeFormError(userId, err, undefined, undefined, {
            openItemId: itemId,
        });
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, returnTo, "fridge.item.eaten");
});

fridgeRoutes.post(
    "/kitchen/fridge/items/:id/add-to-grocery",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const from = formText(body, "from");
        const target = safeReturnPath(from, "/kitchen/fridge");
        try {
            const result = await addFridgeItemToGrocery(
                liveGroceryStore(),
                liveSettingsStore(),
                liveFoodsStore(),
                liveFridgeStore(),
                {
                    householdId: member.householdId,
                    itemId: c.req.param("id"),
                },
            );
            return redirectWithToast(
                c,
                target,
                result.added
                    ? "fridge.item.added-to-grocery"
                    : "fridge.item.already-on-grocery",
            );
        } catch (err) {
            const page = await fridgeFormError(
                userId,
                err,
                undefined,
                undefined,
                { openItemId: c.req.param("id") },
            );
            return c.html(page.html, page.status);
        }
    },
);

fridgeRoutes.post(
    "/kitchen/fridge/items/:id/discard",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const itemId = c.req.param("id");
        const returnTo = fridgeReturnTo(body as Record<string, string | File>);
        try {
            await discardFridgeItem(
                liveFridgeStore(),
                liveStockStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    itemId,
                    actorUserId: userId,
                },
            );
        } catch (err) {
            const page = await fridgeFormError(
                userId,
                err,
                undefined,
                undefined,
                {
                    openItemId: itemId,
                },
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(c, returnTo, "fridge.item.discarded");
    },
);

fridgeRoutes.post(
    "/kitchen/fridge/items/:id/freeze",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const itemId = c.req.param("id");
        const returnTo = fridgeReturnTo(body as Record<string, string | File>);
        try {
            await freezeFridgeItem(
                liveFridgeStore(),
                member.householdId,
                itemId,
                formText(body, "expires_on"),
            );
        } catch (err) {
            const page = await fridgeFormError(
                userId,
                err,
                undefined,
                undefined,
                {
                    openItemId: itemId,
                },
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(c, returnTo, "fridge.item.updated");
    },
);
