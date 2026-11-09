import { Hono, type Context } from "hono";

import { renderHouseholdSettingsRoute } from "../loaders.js";
import { formText } from "../form.js";
import {
    requireManager,
    requireMember,
    requireOwner,
    requireSiteUser,
    siteMember,
} from "../middleware.js";
import {
    canEditPersonRules,
    checkManagedMember,
    type HouseholdMember,
    parseMemberInput,
    parseUnverifiedRecipeExpiryDays,
    mergeHouseholdConfig,
} from "../../household.js";
import {
    generateHouseholdToken,
    hashHouseholdToken,
    householdTokenHashHex,
} from "../../household-token.js";
import {
    addAllergen,
    addDislike,
    addPersonRule,
    addStoreRule,
    removePersonRuleRow,
    RulesInputError,
    type PersonRuleKind,
} from "../../domain/rules.js";
import {
    createGroceryStore,
    renameSection,
    setHouseholdLocation,
    SettingsInputError,
} from "../../domain/settings.js";
import {
    addHouseholdMemberForHousehold,
    getHouseholdConfig,
    getHouseholdMembership,
    rotateHouseholdMcpToken,
    setHouseholdMemberRole,
    transferHouseholdOwnership,
    updateHouseholdConfig,
    updateSocialReaderEnabled,
} from "../../db/household.js";
import { deleteAllUserData } from "../../db/nutrition.js";
import { liveRulesStore } from "../../db/rules.js";
import { liveSettingsStore } from "../../db/settings.js";
import {
    liveFoodsStore,
    mergeLiveFoodPair,
    mergeLiveFoods,
} from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { householdToday } from "../../db/restock.js";
import {
    buildFoodUpdate,
    addProduct,
    createProduct,
    findFoodById,
    findOrCreateFoodByBarcode,
    FoodsInputError,
    MERGE_PAIR_PICK_FIELDS,
    type MergePairPickField,
    linkProduct,
    parseUsualPurchase,
    removeProduct,
    setUsualProduct,
    updateFood,
} from "../../domain/foods.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import {
    renderFridgeInventoryPage,
    renderGroceryListPage,
    renderRecipeDetailRoute,
    renderSettingsFoodsPage,
    renderUsualProductsListPage,
    renderUsualProductsPickerPage,
    renderPossibleDuplicatesRoute,
} from "../loaders.js";
import {
    dismissNotice,
    type NoticesForDeps,
} from "../../domain/notices-for.js";
import { NoticeDismissError } from "../../domain/notice-dismissals.js";
import {
    safeReturnPath,
    usualProductsPickerHref,
} from "../usual-products-path.js";
import { canonicalAppPath } from "../route-map.js";
import {
    HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    HOUSEHOLD_ADD_STORE_MODAL_ID,
    HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID,
    HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
} from "../pages/household.js";
import { SOCIAL_READER_LABELS } from "../../copy/social-readers.js";
import { FOODS_MERGE_MODAL_ID } from "../pages/foods.js";
import { DUP_MERGE_MODAL_ID } from "../pages/possible-duplicates.js";
import { householdPersonRuleRemovedKey } from "../components/toast-flash.js";
import { redirectWithToast } from "../components/toast.js";
import {
    normalizeMemoryHost,
    type FetchMemoryStore,
} from "../../domain/fetch-memory.js";
import { recipeFetchMemory } from "../../db/fetch-memory.js";
import { truncateToastParam } from "../truncate-toast-param.js";

// TOAST_KEYS: "household.fetch-refusal.cleared"

export const householdRoutes = new Hono();

async function householdFormError(
    userId: string,
    err: unknown,
    openModalId?: string,
) {
    const message =
        err instanceof SettingsInputError || err instanceof RulesInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update household settings.";
    const page = await renderHouseholdSettingsRoute(userId, {
        error: message,
        openModalId,
    });
    return { html: page.html, status: 400 as const };
}

householdRoutes.get("/settings/household", requireSiteUser, async (c) => {
    const page = await renderHouseholdSettingsRoute(c.get("userId"), {
        refusalsAfter: c.req.query("refusals_after") ?? undefined,
    });
    return c.html(page.html, page.status);
});

householdRoutes.post(
    "/settings/household/fetch-refusals/clear",
    requireManager,
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const hostRaw = formText(body, "host").trim();
        const host = normalizeMemoryHost(hostRaw);
        if (!host) {
            return c.text("Bad Request", 400);
        }
        const memory: FetchMemoryStore = recipeFetchMemory();
        await memory.clearRefusal(member.householdId, host);
        return redirectWithToast(
            c,
            "/settings/household",
            "household.fetch-refusal.cleared",
            { host: truncateToastParam(host) },
        );
    },
);

householdRoutes.get("/settings/household/items", requireSiteUser, async (c) => {
    const page = await renderSettingsFoodsPage(c.get("userId"), {
        linkProductId: c.req.query("link_product"),
        from: c.req.query("from") ?? "/settings/household/items",
    });
    return c.html(page.html, page.status);
});

householdRoutes.get("/kitchen/usuals", requireSiteUser, async (c) => {
    const food = c.req.query("food");
    if (food) {
        const raw = c.req.query("from");
        const from = raw ? canonicalAppPath(raw) : raw;
        const target = `/kitchen/usuals/${encodeURIComponent(food)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
        // toast: none (picker shortcut)
        return c.redirect(target, 302);
    }
    const page = await renderUsualProductsListPage(c.get("userId"), {
        from: c.req.query("from"),
        q: c.req.query("q"),
    });
    return c.html(page.html, page.status);
});

householdRoutes.get("/kitchen/usuals/:foodId", requireSiteUser, async (c) => {
    const page = await renderUsualProductsPickerPage(
        c.get("userId"),
        c.req.param("foodId"),
        { from: c.req.query("from") },
    );
    return c.html(page.html, page.status);
});

async function usualPickerFormError(
    userId: string,
    foodId: string,
    err: unknown,
    from?: string,
) {
    const message =
        err instanceof FoodsInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update the usual product.";
    const page = await renderUsualProductsPickerPage(userId, foodId, {
        error: message,
        from,
    });
    return { html: page.html, status: 400 as const };
}

householdRoutes.post("/kitchen/usuals/:foodId", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const foodId = c.req.param("foodId");
    const body = await c.req.parseBody();
    const from = formText(body, "from");
    const productRaw = formText(body, "product_food_id");
    const productId = productRaw.trim() === "" ? null : productRaw.trim();
    const usualAmountRaw = formText(body, "usual_amount").trim();
    const usualUnitRaw = formText(body, "usual_unit").trim();
    const usualStoreRaw = formText(body, "usual_store_id").trim();
    const purchase = {
        usualStoreId: usualStoreRaw === "" ? null : usualStoreRaw,
        usualAmount:
            usualAmountRaw === "" && usualUnitRaw === ""
                ? null
                : {
                      amount:
                          usualAmountRaw === "" ? null : Number(usualAmountRaw),
                      unit: usualUnitRaw === "" ? null : usualUnitRaw,
                  },
    };
    try {
        await setUsualProduct(
            liveFoodsStore(),
            member.householdId,
            foodId,
            productId,
            {
                purchase,
                stores: liveSettingsStore(),
            },
        );
    } catch (err) {
        const page = await usualPickerFormError(userId, foodId, err, from);
        return c.html(page.html, page.status);
    }
    // toast: none (return path after pick)
    return c.redirect(safeReturnPath(from, "/kitchen/usuals"), 303);
});

householdRoutes.post(
    "/kitchen/usuals/:foodId/pick",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const foodId = c.req.param("foodId");
        const body = await c.req.parseBody();
        const from = formText(body, "from");
        const store = liveFoodsStore();
        try {
            const pickedId = formText(body, "food_id");
            const picked = pickedId
                ? await findFoodById(store, member.householdId, pickedId)
                : formText(body, "barcode")
                  ? await findOrCreateFoodByBarcode(
                        store,
                        member.householdId,
                        formText(body, "barcode"),
                        (barcode) =>
                            fridgeBarcodeLookup(barcode, member.householdId),
                    )
                  : null;
            if (!picked) {
                throw new FoodsInputError("Pick a food or scan a barcode.");
            }
            await addProduct(store, member.householdId, foodId, picked.id);
        } catch (err) {
            const page = await usualPickerFormError(userId, foodId, err, from);
            return c.html(page.html, page.status);
        }
        // toast: none. Back to the list, which now shows the product.
        return c.redirect(usualProductsPickerHref(foodId, from), 303);
    },
);

householdRoutes.post(
    "/kitchen/usuals/:foodId/products",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const foodId = c.req.param("foodId");
        const body = await c.req.parseBody({ all: true });
        const asText = body as Record<string, string | File>;
        const from = formText(asText, "from");
        try {
            const store = liveFoodsStore();
            const plain = await findFoodById(store, member.householdId, foodId);
            await createProduct(store, member.householdId, foodId, {
                name: formText(asText, "name"),
                brand: formText(asText, "brand"),
                gramsPerEach: formOptionalNutrient(asText, "grams_per_each"),
                gramsPerMl: formOptionalNutrient(asText, "grams_per_ml"),
                calories: formOptionalNutrient(asText, "calories"),
                proteinG: formOptionalNutrient(asText, "protein_g"),
                carbsG: formOptionalNutrient(asText, "carbs_g"),
                fatG: formOptionalNutrient(asText, "fat_g"),
                fiberG: formOptionalNutrient(asText, "fiber_g"),
                sugarG: formOptionalNutrient(asText, "sugar_g"),
                alcoholG: formOptionalNutrient(asText, "alcohol_g"),
                caffeineMg: formOptionalNutrient(asText, "caffeine_mg"),
                allergens: formAllergens(body),
                // Same rule as addProduct: the first product is usual.
                makeUsual: !plain.usualProductId,
            });
        } catch (err) {
            const page = await usualPickerFormError(userId, foodId, err, from);
            return c.html(page.html, page.status);
        }
        // toast: none. Back to the list, which now shows the product.
        return c.redirect(usualProductsPickerHref(foodId, from), 303);
    },
);

householdRoutes.post(
    "/kitchen/usuals/:foodId/products/:productId/remove",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const foodId = c.req.param("foodId");
        const body = await c.req.parseBody();
        const from = formText(body, "from");
        try {
            await removeProduct(
                liveFoodsStore(),
                member.householdId,
                foodId,
                c.req.param("productId"),
            );
        } catch (err) {
            const page = await usualPickerFormError(userId, foodId, err, from);
            return c.html(page.html, page.status);
        }
        // toast: none. The list shows the product is gone.
        return c.redirect(usualProductsPickerHref(foodId, from), 303);
    },
);

async function linkProductFormError(
    userId: string,
    productId: string,
    from: string | undefined,
    err: unknown,
) {
    const message =
        err instanceof FoodsInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not link that food.";
    const back = safeReturnPath(from, "/settings/household/items");
    if (back.startsWith("/kitchen/groceries")) {
        const page = await renderGroceryListPage(userId, {
            error: message,
            linkProductId: productId,
        });
        return { html: page.html, status: 400 as const };
    }
    if (back.startsWith("/kitchen/fridge")) {
        const page = await renderFridgeInventoryPage(
            userId,
            message,
            undefined,
            productId,
        );
        return { html: page.html, status: 400 as const };
    }
    if (back.startsWith("/recipes/")) {
        const recipeId = back.slice("/recipes/".length).split("?")[0]!;
        const page = await renderRecipeDetailRoute(userId, recipeId, {
            error: message,
            linkProductId: productId,
        });
        return { html: page.html, status: 400 as const };
    }
    const page = await renderSettingsFoodsPage(userId, {
        error: message,
        openModalId: `food-belongs-${productId}`,
        linkProductId: productId,
        from: back,
    });
    return { html: page.html, status: 400 as const };
}

householdRoutes.post(
    "/settings/household/items/:id/link",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const productId = c.req.param("id");
        const body = await c.req.parseBody();
        const from = formText(body, "from");
        const plainRaw = formText(body, "food_id");
        const plainId = plainRaw.trim() === "" ? null : plainRaw.trim();
        const makeUsual = formText(body, "make_usual") === "1";
        const store = liveFoodsStore();
        try {
            await linkProduct(store, member.householdId, productId, plainId);
            if (makeUsual && plainId) {
                await setUsualProduct(
                    store,
                    member.householdId,
                    plainId,
                    productId,
                    { stores: liveSettingsStore() },
                );
            }
        } catch (err) {
            const page = await linkProductFormError(
                userId,
                productId,
                from,
                err,
            );
            return c.html(page.html, page.status);
        }
        // toast: none (return path after link)
        return c.redirect(
            safeReturnPath(from, "/settings/household/items"),
            303,
        );
    },
);

householdRoutes.post("/settings/household", requireManager, async (c) => {
    const userId = c.get("userId");
    const manager = siteMember(c);
    const body = await c.req.parseBody();
    const parsed = parseMemberInput({
        display_name: String(body.display_name ?? ""),
        password: String(body.password ?? ""),
        email: String(body.email ?? ""),
        username: String(body.username ?? ""),
        login: String(body.login ?? ""),
    });
    if (!parsed.ok) {
        const page = await renderHouseholdSettingsRoute(userId, {
            error: parsed.error,
            openModalId: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
        });
        return c.html(page.html, 400);
    }
    const added = await addHouseholdMemberForHousehold(
        manager.householdId,
        parsed.value,
    );
    if (!added.ok) {
        const page = await renderHouseholdSettingsRoute(userId, {
            error: added.error,
            openModalId: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
        });
        return c.html(page.html, 400);
    }
    return redirectWithToast(
        c,
        "/settings/household",
        "settings.household.member.added",
    );
});

householdRoutes.post("/settings/household/name", requireManager, async (c) => {
    const userId = c.get("userId");
    const manager = siteMember(c);
    const body = await c.req.parseBody();
    const name = formText(body, "name").trim();
    if (!name) {
        const page = await renderHouseholdSettingsRoute(userId, {
            error: "Enter a household name.",
        });
        return c.html(page.html, 400);
    }
    const config = await getHouseholdConfig(manager.householdId);
    await updateHouseholdConfig(manager.householdId, { ...config, name });
    return redirectWithToast(
        c,
        "/settings/household",
        "settings.household.name.saved",
    );
});

householdRoutes.post(
    "/settings/household/social-readers",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        const readerRaw = formText(body, "reader").trim();
        const enabledRaw = formText(body, "enabled").trim();
        const reader =
            readerRaw === "tiktok" || readerRaw === "facebook"
                ? readerRaw
                : null;
        const enabled = enabledRaw === "1";
        const modalId =
            reader === "tiktok"
                ? HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID
                : reader === "facebook"
                  ? HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID
                  : undefined;
        if (!reader || (enabledRaw !== "1" && enabledRaw !== "0")) {
            const page = await renderHouseholdSettingsRoute(userId, {
                error: "Unknown reader.",
            });
            return c.html(page.html, 400);
        }
        if (enabled && formText(body, "confirm").trim() !== "1") {
            const page = await renderHouseholdSettingsRoute(userId, {
                error: "Confirm you understand the terms before turning this on.",
                openModalId: modalId,
            });
            return c.html(page.html, 400);
        }
        await updateSocialReaderEnabled(owner.householdId, reader, enabled);
        return redirectWithToast(
            c,
            "/settings/household",
            enabled
                ? "household.social-reader.on"
                : "household.social-reader.off",
            { platform: SOCIAL_READER_LABELS[reader] },
        );
    },
);

householdRoutes.post(
    "/settings/household/recipe-settings",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        const raw = formText(body, "unverified_recipe_expiry_days").trim();
        const parsed = parseUnverifiedRecipeExpiryDays(
            raw === "" ? null : raw,
            false,
        );
        if (!parsed.ok) {
            const page = await renderHouseholdSettingsRoute(userId, {
                error: parsed.error,
            });
            return c.html(page.html, 400);
        }
        const config = await getHouseholdConfig(manager.householdId);
        await updateHouseholdConfig(
            manager.householdId,
            mergeHouseholdConfig(config, {
                preferences: { unverifiedRecipeExpiryDays: parsed.value },
            }),
        );
        return redirectWithToast(
            c,
            "/settings/household",
            "household.recipe-settings.saved",
        );
    },
);

householdRoutes.post(
    "/settings/household/location",
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        await setHouseholdLocation(
            liveSettingsStore(),
            manager.householdId,
            formText(body, "location"),
        );
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.location.saved",
        );
    },
);

householdRoutes.post(
    "/settings/household/rotate-token",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const token = generateHouseholdToken();
        await rotateHouseholdMcpToken({
            householdId: owner.householdId,
            tokenHashHex: householdTokenHashHex(hashHouseholdToken(token)),
            issuedBy: owner.userId,
        });
        const page = await renderHouseholdSettingsRoute(userId, {
            issuedToken: token,
        });
        return c.html(page.html, 200);
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/make-owner",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const target = await getHouseholdMembership(
            c.req.param("userId"),
            owner.householdId,
        );
        const targetId = c.req.param("userId");
        const makeOwnerModal = `household-make-owner-${targetId}`;
        const check = checkManagedMember(owner, target, "transfer");
        if (!check.ok) {
            const page = await householdFormError(
                userId,
                new Error(check.error),
                makeOwnerModal,
            );
            return c.html(page.html, page.status);
        }
        try {
            await transferHouseholdOwnership(
                owner.householdId,
                owner.userId,
                check.target.userId,
            );
        } catch (err) {
            const page = await householdFormError(userId, err, makeOwnerModal);
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.ownership.transferred",
        );
    },
);

// Removing a person erases their login, tokens and personal nutrition history
// through the same path as delete_account. Shared household data (fridge,
// grocery, recipes, foods) stays.
householdRoutes.post(
    "/settings/household/members/:userId/remove",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        const target = await getHouseholdMembership(
            c.req.param("userId"),
            owner.householdId,
        );
        const targetId = c.req.param("userId");
        const removeModal = `household-remove-${targetId}`;
        const check = checkManagedMember(owner, target, "remove");
        if (!check.ok) {
            const page = await householdFormError(
                userId,
                new Error(check.error),
                removeModal,
            );
            return c.html(page.html, page.status);
        }
        if (formText(body, "confirm") !== "yes") {
            const page = await householdFormError(
                userId,
                new Error(
                    `Tick the box to confirm removing ${check.target.displayName}.`,
                ),
                removeModal,
            );
            return c.html(page.html, page.status);
        }
        try {
            await deleteAllUserData(check.target.userId);
        } catch (err) {
            const page = await householdFormError(userId, err, removeModal);
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.member.removed",
        );
    },
);

householdRoutes.post(
    "/settings/household/stores",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await createGroceryStore(
                liveSettingsStore(),
                manager.householdId,
                formText(body, "name"),
            );
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                HOUSEHOLD_ADD_STORE_MODAL_ID,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.store.added",
        );
    },
);

householdRoutes.post(
    "/settings/household/sections/:id",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await renameSection(
                liveSettingsStore(),
                manager.householdId,
                c.req.param("id"),
                formText(body, "name"),
            );
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.section.renamed",
        );
    },
);

householdRoutes.post(
    "/settings/household/stores/:id/rules",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        const storeId = c.req.param("id");
        try {
            await addStoreRule(liveRulesStore(), {
                householdId: manager.householdId,
                storeId,
                body: formText(body, "body"),
            });
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                `household-store-rule-${storeId}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.store-rule.added",
        );
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/allergens",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addAllergen(liveRulesStore(), {
                householdId: manager.householdId,
                userId: c.req.param("userId"),
                allergen: formText(body, "allergen"),
                otherLabel: formText(body, "other_label"),
            });
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                `household-member-rules-${c.req.param("userId")}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.allergen.added",
        );
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/dislikes",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addDislike(liveRulesStore(), {
                householdId: manager.householdId,
                userId: c.req.param("userId"),
                displayName: formText(body, "display_name"),
            });
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                `household-member-rules-${c.req.param("userId")}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.dislike.added",
        );
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/rules",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addPersonRule(liveRulesStore(), {
                householdId: manager.householdId,
                userId: c.req.param("userId"),
                body: formText(body, "body"),
            });
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                `household-member-rules-${c.req.param("userId")}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.rule.added",
        );
    },
);

// Who may edit a person's allergens, dislikes and rules: that person, or an
// owner or admin. The target must be in the viewer's household.
async function personRulesTarget(
    c: Context,
): Promise<
    | { ok: true; member: HouseholdMember }
    | { ok: false; page: Awaited<ReturnType<typeof householdFormError>> }
> {
    const viewer = siteMember(c);
    const targetId = c.req.param("userId") ?? "";
    const modalId = `household-member-rules-${targetId}`;
    const target = await getHouseholdMembership(targetId, viewer.householdId);
    if (target == null) {
        return {
            ok: false,
            page: await householdFormError(
                viewer.userId,
                new Error("That person is not in this household."),
            ),
        };
    }
    if (!canEditPersonRules(viewer, target.userId)) {
        return {
            ok: false,
            page: await householdFormError(
                viewer.userId,
                new Error("You can only edit your own rules."),
                modalId,
            ),
        };
    }
    return { ok: true, member: target };
}

const PERSON_RULE_KINDS: Record<string, PersonRuleKind> = {
    rules: "rule",
    allergens: "allergen",
    dislikes: "dislike",
};

householdRoutes.post(
    "/settings/household/members/:userId/:kind/:id/remove",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const kind = PERSON_RULE_KINDS[c.req.param("kind")];
        if (kind == null) return c.notFound();
        const target = await personRulesTarget(c);
        if (!target.ok) return c.html(target.page.html, target.page.status);
        try {
            await removePersonRuleRow(liveRulesStore(), kind, {
                householdId: target.member.householdId,
                userId: target.member.userId,
                id: c.req.param("id"),
            });
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                `household-member-rules-${target.member.userId}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            householdPersonRuleRemovedKey(kind),
        );
    },
);

// The owner raises a member to admin or lowers an admin back to member. The
// owner keeps ownership either way.
householdRoutes.post(
    "/settings/household/members/:userId/role",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        const targetId = c.req.param("userId");
        const manageModal = `household-manage-${targetId}`;
        const role = formText(body, "role");
        const target = await getHouseholdMembership(
            targetId,
            owner.householdId,
        );
        const check = checkManagedMember(owner, target, "role");
        if (!check.ok || (role !== "admin" && role !== "member")) {
            const page = await householdFormError(
                userId,
                new Error(check.ok ? "Choose admin or member." : check.error),
                manageModal,
            );
            return c.html(page.html, page.status);
        }
        try {
            await setHouseholdMemberRole(
                owner.householdId,
                check.target.userId,
                role,
            );
        } catch (err) {
            const page = await householdFormError(userId, err, manageModal);
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.role.updated",
        );
    },
);

function formAllergens(
    body: Record<string, string | File | (string | File)[]>,
): string[] {
    const raw = body.allergens;
    if (Array.isArray(raw)) {
        return raw.filter(
            (value): value is string => typeof value === "string",
        );
    }
    if (typeof raw === "string" && raw) return [raw];
    return [];
}

function formOptionalNutrient(
    body: Record<string, string | File>,
    key: string,
): number | null {
    const raw = formText(body, key).trim();
    if (raw === "") return null;
    return Number(raw);
}

async function foodsFormError(
    userId: string,
    err: unknown,
    openModalId?: string,
) {
    const message =
        err instanceof FoodsInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update foods.";
    const page = await renderSettingsFoodsPage(userId, {
        error: message,
        openModalId,
    });
    return { html: page.html, status: 400 as const };
}

householdRoutes.post(
    "/settings/household/items/merge",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await mergeLiveFoods(
                member.householdId,
                formText(body, "keep_id"),
                formText(body, "drop_id"),
                liveFoodsStore(),
            );
        } catch (err) {
            const page = await foodsFormError(
                userId,
                err,
                FOODS_MERGE_MODAL_ID,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household/items",
            "settings.foods.merged",
        );
    },
);

householdRoutes.post(
    "/settings/household/items/:id",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const foodId = c.req.param("id");
        const body = await c.req.parseBody({ all: true });
        const asText = body as Record<string, string | File>;
        const store = liveFoodsStore();
        const patch = {
            name: formText(asText, "name"),
            brand: formText(asText, "brand"),
            aliases: formText(asText, "aliases")
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
            defaultUnit: formText(asText, "default_unit"),
            gramsPerEach: formOptionalNutrient(asText, "grams_per_each"),
            gramsPerMl: formOptionalNutrient(asText, "grams_per_ml"),
            calories: formOptionalNutrient(asText, "calories"),
            proteinG: formOptionalNutrient(asText, "protein_g"),
            carbsG: formOptionalNutrient(asText, "carbs_g"),
            fatG: formOptionalNutrient(asText, "fat_g"),
            fiberG: formOptionalNutrient(asText, "fiber_g"),
            sugarG: formOptionalNutrient(asText, "sugar_g"),
            alcoholG: formOptionalNutrient(asText, "alcohol_g"),
            caffeineMg: formOptionalNutrient(asText, "caffeine_mg"),
            allergens: formAllergens(body),
            archived: formText(asText, "archived") === "1",
        };
        const settings = liveSettingsStore();
        try {
            if (
                "usual_amount" in asText ||
                "usual_unit" in asText ||
                "usual_store_id" in asText
            ) {
                const usualAmountRaw = formText(asText, "usual_amount").trim();
                const usualUnitRaw = formText(asText, "usual_unit").trim();
                const usualStoreRaw = formText(asText, "usual_store_id").trim();
                await parseUsualPurchase(
                    member.householdId,
                    {
                        usualStoreId:
                            usualStoreRaw === "" ? null : usualStoreRaw,
                        usualAmount: {
                            amount:
                                usualAmountRaw === ""
                                    ? null
                                    : Number(usualAmountRaw),
                            unit: usualUnitRaw === "" ? null : usualUnitRaw,
                        },
                    },
                    settings,
                );
                Object.assign(patch, {
                    usualStoreId: usualStoreRaw === "" ? null : usualStoreRaw,
                    usualAmount: {
                        amount:
                            usualAmountRaw === ""
                                ? null
                                : Number(usualAmountRaw),
                        unit: usualUnitRaw === "" ? null : usualUnitRaw,
                    },
                });
            }
            await buildFoodUpdate(store, member.householdId, foodId, patch, {
                stores: settings,
            });
            if ("generic_food_id" in asText) {
                const raw = formText(asText, "generic_food_id");
                await linkProduct(
                    store,
                    member.householdId,
                    foodId,
                    raw.trim() === "" ? null : raw.trim(),
                );
            }
            if ("usual_product_id" in asText) {
                const raw = formText(asText, "usual_product_id");
                await setUsualProduct(
                    store,
                    member.householdId,
                    foodId,
                    raw.trim() === "" ? null : raw.trim(),
                    { stores: settings },
                );
            }
            await updateFood(store, member.householdId, foodId, patch, {
                stores: settings,
            });
        } catch (err) {
            const page = await foodsFormError(
                userId,
                err,
                `food-edit-${foodId}`,
            );
            return c.html(page.html, page.status);
        }
        return redirectWithToast(
            c,
            "/settings/household/items",
            "settings.foods.updated",
        );
    },
);

function noticeDeps(): NoticesForDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
    };
}

householdRoutes.get(
    "/settings/household/possible-duplicates",
    requireSiteUser,
    async (c) => {
        const page = await renderPossibleDuplicatesRoute(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

householdRoutes.post(
    "/settings/household/possible-duplicates/keep-separate",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        try {
            const today = await householdToday(member.householdId);
            await dismissNotice(
                noticeDeps(),
                member.householdId,
                userId,
                {
                    code: "food.possible_duplicate",
                    subjectKind: "food",
                    subjectId: formText(body, "subject_id"),
                    relatedId: formText(body, "related_id"),
                },
                { today },
            );
        } catch (err) {
            const message =
                err instanceof NoticeDismissError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not keep foods separate.";
            const page = await renderPossibleDuplicatesRoute(userId, {
                error: message,
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // toast: none
        return c.redirect("/settings/household/possible-duplicates", 303);
    },
);

function parseMergePicks(
    body: Record<string, string | File>,
): Partial<Record<MergePairPickField, string>> {
    const picks: Partial<Record<MergePairPickField, string>> = {};
    for (const wire of MERGE_PAIR_PICK_FIELDS) {
        const key = `pick_${wire}`;
        if (key in body) {
            picks[wire] = formText(body, key);
        }
    }
    return picks;
}

householdRoutes.post(
    "/settings/household/possible-duplicates/merge",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody({ all: true });
        const asText = body as Record<string, string | File>;
        const foodA = formText(asText, "food_a");
        const foodB = formText(asText, "food_b");
        const keepId = formText(asText, "keep_id");
        const mergePost = {
            foodA,
            foodB,
            keepId,
            picks: parseMergePicks(asText),
        };
        try {
            if (keepId !== foodA && keepId !== foodB) {
                throw new FoodsInputError(
                    "Keep must be one of the two foods in this pair.",
                );
            }
            const dropId = keepId === foodA ? foodB : foodA;
            await mergeLiveFoodPair(member.householdId, {
                keepId,
                dropId,
                picks: mergePost.picks,
            });
        } catch (err) {
            const message =
                err instanceof FoodsInputError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not merge foods.";
            const page = await renderPossibleDuplicatesRoute(userId, {
                error: message,
                openModalId: DUP_MERGE_MODAL_ID,
                mergePost,
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // toast: none
        return c.redirect("/settings/household/possible-duplicates", 303);
    },
);
