import { Hono } from "hono";
import { groceryAllergenMembers, renderGroceryListPage } from "../loaders.js";

import { formAmount, formOptionalNumber, formText } from "../form.js";
import { gatedRoute } from "../gated.js";
import { safeReturnPath } from "../usual-products-path.js";
import type { PutAwayDraft } from "../pages/v2/kitchen-groceries.js";
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

function storeFilterFromReturnTo(returnTo: string): string | undefined {
    try {
        const u = new URL(returnTo, "http://foodable.local");
        const store = u.searchParams.get("store");
        return store && store.trim() !== "" ? store : undefined;
    } catch {
        return undefined;
    }
}

async function groceryFormError(
    userId: string,
    err: unknown,
    openModalId?: string,
    extras?: {
        openPutAway?: boolean;
        putAwayDraft?: PutAwayDraft;
        openLineId?: string;
        returnTo?: string;
    },
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
        openPutAway: extras?.openPutAway,
        putAwayDraft: extras?.putAwayDraft,
        openLineId: extras?.openLineId,
        storeFilter: extras?.returnTo
            ? storeFilterFromReturnTo(extras.returnTo)
            : undefined,
    });
    return { html: page.html, status: 400 as const };
}

function groceryReturnTo(body: Record<string, string | File>) {
    return safeReturnPath(formText(body, "return_to"), "/kitchen/groceries");
}

function putAwayDraftFromBody(
    body: Record<string, string | File | (string | File)[]>,
    lineIds: string[],
): PutAwayDraft {
    const draft: PutAwayDraft = {};
    for (const id of lineIds) {
        draft[id] = {
            locationId: formText(body, `location_id_${id}`) || undefined,
            expiresOn: formText(body, `expires_on_${id}`) || undefined,
            productFoodId: formText(body, `product_food_id_${id}`) || undefined,
            putAwayAmount: formText(body, `put_away_amount_${id}`) || undefined,
        };
    }
    return draft;
}

groceryRoutes.get("/kitchen/groceries", requireSiteUser, async (c) => {
    const page = await renderGroceryListPage(c.get("userId"), {
        linkProductId: c.req.query("link_product"),
        storeFilter: c.req.query("store"),
        openLineId: c.req.query("line"),
        openPutAway: c.req.query("put-away") === "1",
    });
    return c.html(page.html, page.status);
});

groceryRoutes.post("/kitchen/groceries/stores", requireManager, async (c) => {
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
    return redirectWithToast(c, "/kitchen/groceries", "grocery.store.added");
});

groceryRoutes.post("/kitchen/groceries/lines", requireMember, async (c) => {
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
                        member.householdId,
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
                    (barcode) =>
                        fridgeBarcodeLookup(barcode, member.householdId),
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
                        "/kitchen/groceries",
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
                "/kitchen/groceries/lines",
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
    return redirectWithToast(c, "/kitchen/groceries", "grocery.line.added");
});

groceryRoutes.post(
    "/kitchen/groceries/lines/:id/check",
    requireMember,
    async (c) => {
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
                return c.redirect(groceryReturnTo(body), 303);
            }
        } catch (err) {
            const page = await groceryFormError(userId, err, undefined, {
                returnTo: groceryReturnTo(body),
            });
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            groceryReturnTo(body),
            groceryLineCheckToastKey(checked),
        );
    },
);

groceryRoutes.post(
    "/kitchen/groceries/clear-checked",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
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
        return redirectWithToast(
            c,
            groceryReturnTo(body),
            "grocery.checked.cleared",
        );
    },
);

groceryRoutes.post(
    "/kitchen/groceries/put-away",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const lineIds = formText(body, "line_ids")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
        const draft = putAwayDraftFromBody(body, lineIds);
        try {
            const productFoodIds: Record<string, string> = {};
            const perLine: Record<
                string,
                { locationId?: string; expiresOn?: string }
            > = {};
            const amountOverrides: Record<
                string,
                { amount: number; unit?: string | null }
            > = {};
            for (const lineId of lineIds) {
                const row = draft[lineId];
                if (!row) continue;
                perLine[lineId] = {
                    locationId: row.locationId,
                    expiresOn: row.expiresOn || undefined,
                };
                if (row.productFoodId) {
                    productFoodIds[lineId] = row.productFoodId;
                }
                const amt = row.putAwayAmount
                    ? formOptionalNumber(
                          { [`put_away_amount_${lineId}`]: row.putAwayAmount },
                          `put_away_amount_${lineId}`,
                      )
                    : null;
                if (amt != null) {
                    amountOverrides[lineId] = { amount: amt };
                }
            }
            await putAwayGroceryLines(
                liveGroceryStore(),
                liveFridgeStore(),
                liveStockStore(),
                liveFoodsStore(),
                {
                    householdId: member.householdId,
                    lineIds,
                    actorUserId: userId,
                    perLine,
                    productFoodIds:
                        Object.keys(productFoodIds).length > 0
                            ? productFoodIds
                            : undefined,
                    amountOverrides:
                        Object.keys(amountOverrides).length > 0
                            ? amountOverrides
                            : undefined,
                },
            );
        } catch (err) {
            const page = await groceryFormError(userId, err, undefined, {
                openPutAway: true,
                putAwayDraft: draft,
                returnTo: groceryReturnTo(body),
            });
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            groceryReturnTo(body),
            "grocery.line.put-away",
        );
    },
);

groceryRoutes.post(
    "/kitchen/groceries/lines/:id/put-away",
    requireMember,
    async (c) => {
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
        return redirectWithToast(
            c,
            "/kitchen/groceries",
            "grocery.line.put-away",
        );
    },
);
