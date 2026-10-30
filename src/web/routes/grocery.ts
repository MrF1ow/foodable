import { Hono } from "hono";
import { groceryAllergenMembers, renderGroceryListPage } from "../loaders.js";

import { formAmount, formText } from "../form.js";
import {
    requireMember,
    requireManager,
    requireSiteUser,
    siteMember,
} from "../middleware.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import { normalizeBarcode } from "../../foods.js";
import {
    addGroceryFoodByBarcode,
    addGroceryFoodById,
    addGroceryManualFood,
    addGrocerySupply,
    checkGroceryLine,
    clearCheckedLines,
    groceryAllergenWarning,
    GroceryInputError,
} from "../../domain/grocery.js";
import { putAwayGroceryLines, StockInputError } from "../../domain/stock.js";
import { createGroceryStore } from "../../domain/settings.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { findFoodById } from "../../domain/foods.js";

export const groceryRoutes = new Hono();

function groceryAllergenRetryFields(
    body: Record<string, File | string>,
    storeId: string,
): Record<string, string> {
    const fields: Record<string, string> = {
        kind: formText(body, "kind") || "food",
        store_id: storeId,
    };
    const sectionId = formText(body, "section_id");
    if (sectionId) fields.section_id = sectionId;
    const foodId = formText(body, "food_id");
    if (foodId) fields.food_id = foodId;
    const foodName = formText(body, "food_name");
    if (foodName) fields.food_name = foodName;
    const barcode = formText(body, "barcode");
    if (barcode) fields.barcode = barcode;
    const amount = formText(body, "qty_amount");
    if (amount) fields.qty_amount = amount;
    const unit = formText(body, "qty_unit");
    if (unit) fields.qty_unit = unit;
    const name = formText(body, "name");
    if (name) fields.name = name;
    return fields;
}

async function groceryFormError(
    userId: string,
    err: unknown,
    openModalId?: string,
) {
    const message =
        err instanceof GroceryInputError
            ? err.message
            : err instanceof StockInputError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Could not update the grocery list.";
    const page = await renderGroceryListPage(userId, {
        error: message,
        openModalId,
    });
    return { html: page.html, status: 400 as const };
}

groceryRoutes.get("/grocery", requireSiteUser, async (c) => {
    const page = await renderGroceryListPage(c.get("userId"));
    return c.html(page.html, page.status);
});

groceryRoutes.post("/grocery/stores", requireManager, async (c) => {
    const userId = c.get("userId");
    const owner = siteMember(c);
    const body = await c.req.parseBody();
    try {
        await createGroceryStore(
            liveSettingsStore(),
            owner.householdId,
            formText(body, "name"),
        );
    } catch (err) {
        const page = await groceryFormError(userId, err, "grocery-add-store");
        return c.html(page.html, page.status);
    }
    return c.redirect("/grocery", 303);
});

groceryRoutes.post("/grocery/lines", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const storeId = formText(body, "store_id");
    const sectionId = formText(body, "section_id") || undefined;
    const amount = formAmount(body, "qty_amount");
    const grocery = liveGroceryStore();
    const settings = liveSettingsStore();
    const foods = liveFoodsStore();
    const confirmed = formText(body, "confirm_allergen") === "1";
    try {
        const kind = formText(body, "kind");
        if (kind === "supply") {
            await addGrocerySupply(grocery, settings, foods, {
                householdId: member.householdId,
                storeId,
                sectionId,
                name: formText(body, "name"),
                amount,
                unit: formText(body, "qty_unit"),
                foodId: formText(body, "food_id") || undefined,
            });
        } else {
            const members = await groceryAllergenMembers(member.householdId);
            const foodId = formText(body, "food_id");
            let previewName = formText(body, "food_name");
            let catalogAllergens: string[] | null = null;
            if (foodId) {
                const food = await findFoodById(
                    foods,
                    member.householdId,
                    foodId,
                );
                previewName = food.name;
                catalogAllergens = food.allergens;
            } else if (formText(body, "barcode")) {
                previewName =
                    (
                        await fridgeBarcodeLookup(
                            normalizeBarcode(formText(body, "barcode")) ??
                                formText(body, "barcode"),
                        )
                    )?.name ?? previewName;
            }
            const warning = groceryAllergenWarning(
                previewName,
                members,
                catalogAllergens,
            );
            if (warning?.blocking && !confirmed) {
                const page = await renderGroceryListPage(userId, {
                    allergenWarning: warning.text,
                    openModalId: `grocery-add-food-${storeId}`,
                    allergenRetry: {
                        storeId,
                        fields: groceryAllergenRetryFields(body, storeId),
                    },
                });
                return c.html(page.html, 400);
            }
            if (foodId) {
                await addGroceryFoodById(grocery, settings, foods, {
                    householdId: member.householdId,
                    storeId,
                    sectionId,
                    foodId,
                    amount,
                    unit: formText(body, "qty_unit"),
                });
            } else if (formText(body, "barcode")) {
                await addGroceryFoodByBarcode(
                    grocery,
                    settings,
                    foods,
                    {
                        householdId: member.householdId,
                        storeId,
                        sectionId,
                        barcode: formText(body, "barcode"),
                        amount,
                        unit: formText(body, "qty_unit"),
                    },
                    { lookup: fridgeBarcodeLookup },
                );
            } else {
                await addGroceryManualFood(grocery, settings, foods, {
                    householdId: member.householdId,
                    storeId,
                    sectionId,
                    name: formText(body, "food_name"),
                    amount,
                    unit: formText(body, "qty_unit"),
                });
            }
        }
    } catch (err) {
        const page = await groceryFormError(
            userId,
            err,
            `grocery-add-food-${storeId}`,
        );
        return c.html(page.html, page.status);
    }
    return c.redirect("/grocery", 303);
});

groceryRoutes.post("/grocery/lines/:id/check", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const checked = formText(body, "checked") !== "0";
    try {
        await checkGroceryLine(
            liveGroceryStore(),
            member.householdId,
            c.req.param("id"),
            checked,
        );
    } catch (err) {
        const page = await groceryFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/grocery", 303);
});

groceryRoutes.post("/grocery/clear-checked", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    try {
        await clearCheckedLines(liveGroceryStore(), member.householdId);
    } catch (err) {
        const page = await groceryFormError(
            userId,
            err,
            "grocery-clear-checked",
        );
        return c.html(page.html, page.status);
    }
    return c.redirect("/grocery", 303);
});

groceryRoutes.post("/grocery/lines/:id/put-away", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    try {
        await putAwayGroceryLines(
            liveGroceryStore(),
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                lineIds: [c.req.param("id")],
                locationId: formText(body, "location_id") || undefined,
                actorUserId: userId,
            },
        );
    } catch (err) {
        const page = await groceryFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/grocery", 303);
});
