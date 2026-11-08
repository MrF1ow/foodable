import { Hono } from "hono";
import { groceryAllergenMembers, renderGroceryListPage } from "../loaders.js";

import { formAmount, formOptionalNumber, formText } from "../form.js";
import {
    requireMember,
    requireManager,
    requireSiteUser,
    siteMember,
} from "../middleware.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import { normalizeBarcode } from "../../foods.js";
import {
    addGroceryFoodById,
    addGroceryManualFood,
    addGrocerySupply,
    checkGroceryLine,
    clearCheckedLines,
    allergenNotices,
    GroceryInputError,
} from "../../domain/grocery.js";
import {
    NotedGroceryLineAmountRequiredError,
    putAwayGroceryLines,
    StockInputError,
} from "../../domain/stock.js";
import { createGroceryStore } from "../../domain/settings.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import {
    effectiveFoodsByIds,
    findFoodById,
    findOrCreateFoodByBarcodeResult,
    linkProductPromptPath,
} from "../../domain/foods.js";
import { groceryLineCheckToastKey } from "../components/toast-flash.js";
import { redirectWithToast } from "../components/toast.js";
import { buildDidYouMeanModal } from "../components/did-you-mean.js";
import {
    groceryLineRetryFields,
    isSimilarFoodsError,
    manualOnSimilar,
    rememberAliasIfRequested,
} from "../form.js";

export const groceryRoutes = new Hono();

async function groceryFormError(
    userId: string,
    err: unknown,
    openModalId?: string,
) {
    const message =
        err instanceof GroceryInputError
            ? err.message
            : err instanceof NotedGroceryLineAmountRequiredError
              ? err.webMessage
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
    const page = await renderGroceryListPage(c.get("userId"), {
        linkProductId: c.req.query("link_product"),
    });
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
    return redirectWithToast(c, "/grocery", "grocery.store.added");
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
                const catalog = await effectiveFoodsByIds(
                    foods,
                    member.householdId,
                    [foodId],
                );
                catalogAllergens = catalog.get(foodId)?.allergens ?? null;
            } else if (formText(body, "barcode")) {
                try {
                    const hit = await fridgeBarcodeLookup(
                        normalizeBarcode(formText(body, "barcode")) ??
                            formText(body, "barcode"),
                    );
                    previewName = hit?.name ?? previewName;
                } catch {
                    // OFF unreachable; keep the typed name for allergen preview.
                }
            }
            const notices = allergenNotices(
                { kind: "grocery_line", id: "" },
                previewName,
                members,
                catalogAllergens,
            );
            if (notices.length > 0 && !confirmed) {
                const page = await renderGroceryListPage(userId, {
                    allergenNotices: notices,
                    openModalId: `grocery-add-food-${storeId}`,
                    allergenRetry: {
                        storeId,
                        fields: groceryLineRetryFields(body, storeId),
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
                await rememberAliasIfRequested(
                    foods,
                    member.householdId,
                    body,
                    foodId,
                );
            } else if (formText(body, "barcode")) {
                const { food, created } = await findOrCreateFoodByBarcodeResult(
                    foods,
                    member.householdId,
                    formText(body, "barcode"),
                    fridgeBarcodeLookup,
                );
                await addGroceryFoodById(grocery, settings, foods, {
                    householdId: member.householdId,
                    storeId,
                    sectionId,
                    foodId: food.id,
                    amount,
                    unit: formText(body, "qty_unit"),
                });
                if (created) {
                    const catalog = await foods.listFoods(member.householdId);
                    const prompt = linkProductPromptPath(
                        food,
                        catalog,
                        "/grocery",
                    );
                    if (prompt) {
                        // toast: none (link-product prompt on destination)
                        return c.redirect(prompt, 303);
                    }
                }
            } else {
                await addGroceryManualFood(grocery, settings, foods, {
                    householdId: member.householdId,
                    storeId,
                    sectionId,
                    name: formText(body, "food_name"),
                    amount,
                    unit: formText(body, "qty_unit"),
                    onSimilar: manualOnSimilar(body),
                });
            }
        }
    } catch (err) {
        if (isSimilarFoodsError(err)) {
            const modalId = `grocery-add-food-${storeId}`;
            const didYouMean = buildDidYouMeanModal(
                err,
                groceryLineRetryFields(body, storeId),
                modalId,
                "/grocery/lines",
            );
            if (didYouMean) {
                const page = await renderGroceryListPage(userId, {
                    openModalId: modalId,
                    didYouMean,
                });
                return c.html(page.html, 409);
            }
        }
        const page = await groceryFormError(
            userId,
            err,
            `grocery-add-food-${storeId}`,
        );
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/grocery", "grocery.line.added");
});

groceryRoutes.post("/grocery/lines/:id/check", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const checked = formText(body, "checked") !== "0";
    try {
        const line = await checkGroceryLine(
            liveGroceryStore(),
            member.householdId,
            c.req.param("id"),
            checked,
        );
        if (!line) {
            // toast: none (no-op)
            return c.redirect("/grocery", 303);
        }
    } catch (err) {
        const page = await groceryFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/grocery", groceryLineCheckToastKey(checked));
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
    return redirectWithToast(c, "/grocery", "grocery.checked.cleared");
});

groceryRoutes.post("/grocery/lines/:id/put-away", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    try {
        const productRaw = formText(body, "product_food_id");
        const productFoodIds =
            productRaw.trim() === ""
                ? undefined
                : { [c.req.param("id")]: productRaw.trim() };
        const lineId = c.req.param("id");
        const putAwayAmount = formOptionalNumber(body, "put_away_amount");
        await putAwayGroceryLines(
            liveGroceryStore(),
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            {
                householdId: member.householdId,
                lineIds: [lineId],
                locationId: formText(body, "location_id") || undefined,
                actorUserId: userId,
                productFoodIds,
                amountOverrides:
                    putAwayAmount != null
                        ? { [lineId]: { amount: putAwayAmount } }
                        : undefined,
            },
        );
    } catch (err) {
        const page = await groceryFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/grocery", "grocery.line.put-away");
});
