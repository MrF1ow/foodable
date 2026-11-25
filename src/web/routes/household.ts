import { Hono, type Context } from "hono";

import {
    listAllRefusalHosts,
    renderHouseholdMemberRoute,
    renderHouseholdReadersRoute,
    renderHouseholdRestockRoute,
    renderHouseholdTokenRoute,
    renderHouseholdTimezoneRoute,
    renderHouseholdSettingsRoute,
} from "../loaders.js";
import { formText } from "../form.js";
import {
    USUAL_GRAMS_PER_EACH_FIELD,
    USUAL_GRAMS_PER_ML_FIELD,
    USUAL_WEIGHTS_MARKER,
    USUAL_WHEN_LOW_FIELD,
    USUAL_WHEN_LOW_MARKER,
} from "../pages/v2/kitchen-usuals.js";
import {
    requireAction,
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
    mergeHouseholdConfig,
    parseHouseholdConfigPatch,
    parseHouseholdSettingsForm,
} from "../../household.js";
import { can } from "../../domain/permissions.js";
import {
    generateHouseholdToken,
    hashHouseholdToken,
    householdTokenHashHex,
} from "../../household-token.js";
import {
    addAllergen,
    addDislike,
    addPersonRule,
    removePersonRuleRow,
    RulesInputError,
    type PersonRuleKind,
} from "../../domain/rules.js";
import {
    createGroceryStore,
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
    removeHouseholdMemberAccount,
    setPluralsSameFood,
    updateHouseholdConfig,
    updateSocialReaderEnabled,
} from "../../db/household.js";
import { liveNotifier } from "../../db/notify.js";
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
import { householdClock, householdToday } from "../../db/restock.js";
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
    setUsualSchedule,
    updateFood,
} from "../../domain/foods.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import {
    renderUsualProductsListPage,
    renderSettingsDuplicateCompareRoute,
    renderSettingsDuplicatesRoute,
    renderSettingsSavedV2Route,
} from "../loaders.js";
import { viewerFlagsFor } from "../attention.js";
import {
    dismissNotice,
    type NoticesForDeps,
} from "../../domain/notices-for.js";
import { NoticeDismissError } from "../../domain/notice-dismissals.js";
import {
    safeReturnPath,
    usualProductsPickerHref,
} from "../usual-products-path.js";
import { HOUSEHOLD_ADD_MEMBER_SHEET_ID } from "../pages/v2/settings-household-add-member.js";
import {
    HOUSEHOLD_LOCATION_SHEET_ID,
    HOUSEHOLD_NAME_SHEET_ID,
} from "../pages/v2/settings-household.js";
import { RESTOCK_PATH } from "../pages/v2/settings-restock.js";
import { READERS_PATH } from "../pages/v2/settings-readers.js";
import type { SocialReaderId } from "../../copy/social-readers.js";
import {
    FOODS_MERGE_MODAL_ID,
    savedFoodDeleteSheetId,
} from "../pages/v2/settings-saved.js";
import {
    DUPLICATES_PATH,
    DUPLICATES_VIEW_COMPARE,
    duplicatesBackFrom,
    type DuplicateMergePost,
} from "../pages/v2/settings-duplicates.js";
import {
    normalizeMemoryHost,
    type FetchMemoryStore,
} from "../../domain/fetch-memory.js";
import { recipeFetchMemory } from "../../db/fetch-memory.js";
import { householdStoresRoutes } from "./household-stores.js";
import {
    createHouseholdInvite,
    listHouseholdInvites,
    isInviteId,
    revokeHouseholdInvite,
} from "../../db/invites.js";
import { renderHouseholdInvitesPage } from "../pages/v2/settings-household-invites.js";
import { getProfile } from "../../db/profiles.js";
import { viewerChromeWithAttention } from "../attention.js";
import { settingsBackHref } from "../settings-back.js";
import { getBaseUrl } from "../../url.js";
import { forbiddenDashboardHtml } from "../loaders.js";

// TOAST_KEYS: "household.fetch-refusal.cleared", "household.fetch-refusals.cleared-all", "household.restock.saved", "household.timezone.saved"

import { usualAddRoutes } from "./usual-add.js";

export const householdRoutes = new Hono();
householdRoutes.route("/", usualAddRoutes);

// Settings › Household › Stores in the new app (own file: ten routes of its own).
householdRoutes.route("/", householdStoresRoutes);

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

/**
 * A refused member action (role, ownership, removal) shows its reason on that
 * person's page, where the menu is. When that page cannot be drawn (they are
 * not in this household), the reason shows on the Household page instead.
 */
async function memberActionError(
    userId: string,
    targetId: string,
    err: unknown,
) {
    const message =
        err instanceof Error ? err.message : "Could not update that member.";
    const member = await renderHouseholdMemberRoute(userId, targetId, {
        error: message,
    });
    if (member.status === 200) {
        return { html: member.html, status: 400 as const };
    }
    const page = await renderHouseholdSettingsRoute(userId, {
        error: message,
    });
    return { html: page.html, status: 400 as const };
}

householdRoutes.get("/settings/household", requireSiteUser, async (c) => {
    const page = await renderHouseholdSettingsRoute(c.get("userId"));
    return c.html(page.html, page.status);
});

householdRoutes.get(
    "/settings/household/members/:userId",
    requireSiteUser,
    async (c) => {
        const page = await renderHouseholdMemberRoute(
            c.get("userId"),
            c.req.param("userId"),
        );
        return c.html(page.html, page.status);
    },
);

async function readersFormError(
    userId: string,
    message: string,
    confirmReader?: SocialReaderId,
) {
    const page = await renderHouseholdReadersRoute(userId, {
        error: message,
        confirmReader,
    });
    return { html: page.html, status: 400 as const };
}

/** The form fields an owner/admin settings post carries, by name. */
function householdFormFields(
    body: Record<string, unknown>,
    keys: readonly string[],
): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const key of keys) {
        if (key in body) out[key] = formText(body as never, key);
    }
    return out;
}

/** Parses a household settings form and saves it over the current config. */
async function saveHouseholdSettingsForm(
    householdId: string,
    body: Record<string, unknown>,
    keys: readonly string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
    const patch = parseHouseholdConfigPatch(
        parseHouseholdSettingsForm(householdFormFields(body, keys)),
    );
    if (!patch.ok) return patch;
    const config = await getHouseholdConfig(householdId);
    await updateHouseholdConfig(
        householdId,
        mergeHouseholdConfig(config, patch.value),
    );
    return { ok: true };
}

householdRoutes.get(
    "/settings/household/restock",
    requireSiteUser,
    async (c) => {
        const page = await renderHouseholdRestockRoute(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

householdRoutes.post(
    "/settings/household/restock",
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        const saved = await saveHouseholdSettingsForm(
            manager.householdId,
            body,
            ["restock_enabled", "restock_weekday", "restock_time"],
        );
        if (!saved.ok) {
            const page = await renderHouseholdRestockRoute(c.get("userId"), {
                error: saved.error,
            });
            return c.html(page.html, 400);
        }
        // toast: none
        return c.redirect(RESTOCK_PATH, 303);
    },
);

householdRoutes.get(
    "/settings/household/readers",
    requireSiteUser,
    async (c) => {
        // `?turn_on=<reader>` opens that reader's terms in place.
        const turnOn = c.req.query("turn_on");
        const page = await renderHouseholdReadersRoute(c.get("userId"), {
            confirmReader:
                turnOn === "tiktok" || turnOn === "facebook"
                    ? turnOn
                    : undefined,
        });
        return c.html(page.html, page.status);
    },
);

// The household's time zone is a page of its own, with a search field
// (`?q=`), for owners and admins.
householdRoutes.get(
    "/settings/household/timezone",
    requireManager,
    async (c) => {
        const page = await renderHouseholdTimezoneRoute(c.get("userId"), {
            q: c.req.query("q"),
        });
        return c.html(page.html, page.status);
    },
);

householdRoutes.post(
    "/settings/household/timezone",
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        const saved = await saveHouseholdSettingsForm(
            manager.householdId,
            body,
            ["timezone"],
        );
        if (!saved.ok) {
            const page = await renderHouseholdTimezoneRoute(c.get("userId"), {
                error: saved.error,
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // toast: none
        return c.redirect("/settings/household", 303);
    },
);

// Clears blocked links: one host when `host` is posted, otherwise every one
// the household has.
householdRoutes.post(
    "/settings/household/fetch-refusals/clear",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const hostRaw = formText(body, "host").trim();
        const memory: FetchMemoryStore = recipeFetchMemory();
        if (hostRaw === "") {
            const hosts = await listAllRefusalHosts(memory, member.householdId);
            for (const host of hosts) {
                await memory.clearRefusal(member.householdId, host);
            }
            // toast: none
            return c.redirect(READERS_PATH, 303);
        }
        const host = normalizeMemoryHost(hostRaw);
        if (!host) {
            const page = await readersFormError(userId, "Enter a valid host.");
            return c.html(page.html, page.status);
        }
        await memory.clearRefusal(member.householdId, host);
        // toast: none
        return c.redirect(READERS_PATH, 303);
    },
);

householdRoutes.get("/settings/household/items", requireSiteUser, (c) => {
    const q = c.req.query("q");
    const target = q
        ? `/settings/saved?q=${encodeURIComponent(q)}`
        : "/settings/saved";
    // toast: none
    return c.redirect(target, 302);
});

householdRoutes.get("/kitchen/usuals", requireSiteUser, async (c) => {
    const page = await renderUsualProductsListPage(c.get("userId"), {
        from: c.req.query("from"),
        q: c.req.query("q"),
        storeFilter: c.req.query("store"),
        openFoodId: c.req.query("food"),
    });
    return c.html(page.html, page.status);
});

householdRoutes.get("/kitchen/usuals/:foodId", requireSiteUser, (c) => {
    const from = c.req.query("from");
    const qs = new URLSearchParams({ food: c.req.param("foodId") });
    if (from) qs.set("from", from);
    return c.redirect(`/kitchen/usuals?${qs.toString()}`, 302);
});

async function usualPickerFormError(
    userId: string,
    foodId: string,
    err: unknown,
    from?: string,
    returnTo?: string,
) {
    const message =
        err instanceof FoodsInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update the usual product.";
    const page = await renderUsualProductsListPage(userId, {
        error: message,
        openFoodId: foodId,
        from: safeReturnPath(returnTo ?? from, "/kitchen/usuals"),
        // Keep the store chip the user was on.
        storeFilter:
            new URL(
                safeReturnPath(returnTo ?? from, "/kitchen/usuals"),
                "http://local",
            ).searchParams.get("store") ?? undefined,
    });
    return { html: page.html, status: 400 as const };
}

householdRoutes.post("/kitchen/usuals/:foodId", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const foodId = c.req.param("foodId");
    const body = await c.req.parseBody();
    const from = formText(body, "from");
    const returnTo = formText(body, "return_to");
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
                notify: liveNotifier(member.householdId, userId),
            },
        );
        // The new edit sheet posts "Add when it runs low" with the rest. An
        // unchecked box posts nothing, so only the marker says it was on the
        // form: a post without it (the old app) leaves the setting alone.
        if (formText(body, USUAL_WHEN_LOW_MARKER) === "1") {
            await setUsualSchedule(
                liveFoodsStore(),
                member.householdId,
                foodId,
                {
                    restockWhenLow:
                        formText(body, USUAL_WHEN_LOW_FIELD) === "1",
                },
            );
        }
        // The sheet's weight fields: grams per ml and grams per item on the
        // plain food, which recipes read for cups, spoons and counts. A blank
        // field clears that factor; only a post that carries the marker
        // touches them.
        if (formText(body, USUAL_WEIGHTS_MARKER) === "1") {
            await updateFood(liveFoodsStore(), member.householdId, foodId, {
                gramsPerMl: formOptionalNutrient(
                    body,
                    USUAL_GRAMS_PER_ML_FIELD,
                ),
                gramsPerEach: formOptionalNutrient(
                    body,
                    USUAL_GRAMS_PER_EACH_FIELD,
                ),
            });
        }
    } catch (err) {
        const page = await usualPickerFormError(
            userId,
            foodId,
            err,
            from,
            returnTo,
        );
        return c.html(page.html, page.status);
    }
    // toast: none (return path after pick)
    return c.redirect(safeReturnPath(returnTo || from, "/kitchen/usuals"), 303);
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
            await addProduct(store, member.householdId, foodId, picked.id, {
                notify: liveNotifier(member.householdId, userId),
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
                notify: liveNotifier(member.householdId, userId),
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

householdRoutes.post("/settings/household", requireManager, async (c) => {
    const userId = c.get("userId");
    const manager = siteMember(c);
    const body = await c.req.parseBody();
    // Only the owner chooses a role. A role an admin posts is refused, so a
    // forged form cannot make an admin; the sheet an admin sees has no Role.
    // Every submitted value counts (`role` repeated, or `role[]`), not just
    // the last one: a forged `role=admin&role=` must not read as no role.
    const form = await c.req.formData();
    const roles = [...form.getAll("role"), ...form.getAll("role[]")]
        .map((value) => (typeof value === "string" ? value.trim() : "x"))
        .filter((value) => value !== "");
    const isOwner = can(manager, "household.owner_only").ok;
    let role: "admin" | "member" = "member";
    if (roles.length > 0) {
        const chosen = roles[0]!;
        // oxlint-disable-next-line foodable/no-raw-role-check -- validates the submitted form value, not the actor's role
        const valid = chosen === "admin" || chosen === "member";
        if (!isOwner || !valid || roles.some((value) => value !== chosen)) {
            const page = await renderHouseholdSettingsRoute(userId, {
                error: isOwner
                    ? "Choose admin or member."
                    : "Only the owner can choose a role.",
                openModalId: HOUSEHOLD_ADD_MEMBER_SHEET_ID,
            });
            return c.html(page.html, 400);
        }
        role = chosen;
    }
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
            openModalId: HOUSEHOLD_ADD_MEMBER_SHEET_ID,
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
            openModalId: HOUSEHOLD_ADD_MEMBER_SHEET_ID,
        });
        return c.html(page.html, 400);
    }
    // oxlint-disable-next-line foodable/no-raw-role-check -- the role chosen in the form, already checked against the owner above, not the actor's role
    if (role === "admin") {
        try {
            await setHouseholdMemberRole(
                manager.householdId,
                added.userId,
                role,
            );
        } catch {
            // They were added, as a member: say so, and where the role can be
            // changed again (their page, which this answer shows).
            const page = await memberActionError(
                userId,
                added.userId,
                new Error(
                    `${parsed.value.displayName} was added as a member, but making them an admin didn't work. Use Make admin in their ⋯ menu to try again.`,
                ),
            );
            return c.html(page.html, page.status);
        }
    }
    // toast: none
    return c.redirect("/settings/household", 303);
});

householdRoutes.post("/settings/household/name", requireManager, async (c) => {
    const userId = c.get("userId");
    const manager = siteMember(c);
    const body = await c.req.parseBody();
    const name = formText(body, "name").trim();
    if (!name) {
        const page = await renderHouseholdSettingsRoute(userId, {
            error: "Enter a household name.",
            openModalId: HOUSEHOLD_NAME_SHEET_ID,
        });
        return c.html(page.html, 400);
    }
    const config = await getHouseholdConfig(manager.householdId);
    await updateHouseholdConfig(manager.householdId, { ...config, name });
    // toast: none
    return c.redirect("/settings/household", 303);
});

householdRoutes.post(
    "/settings/household/social-readers",
    requireAction("household.recipe_link_readers"),
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
        if (!reader || (enabledRaw !== "1" && enabledRaw !== "0")) {
            const page = await readersFormError(userId, "Unknown reader.");
            return c.html(page.html, page.status);
        }
        if (enabled && formText(body, "confirm").trim() !== "1") {
            const page = await readersFormError(
                userId,
                "Confirm you understand the terms before turning this on.",
                reader,
            );
            return c.html(page.html, page.status);
        }
        await updateSocialReaderEnabled(owner.householdId, reader, enabled);
        // toast: none
        return c.redirect(READERS_PATH, 303);
    },
);

householdRoutes.post(
    "/settings/household/plurals-same-food",
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        const enabled = formText(body, "plurals_same_food") === "true";
        await setPluralsSameFood(manager.householdId, enabled);
        // toast: none
        return c.redirect("/settings/household", 303);
    },
);

householdRoutes.post(
    "/settings/household/location",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await setHouseholdLocation(
                liveSettingsStore(),
                manager.householdId,
                formText(body, "location"),
            );
        } catch (err) {
            const page = await householdFormError(
                userId,
                err,
                HOUSEHOLD_LOCATION_SHEET_ID,
            );
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/household", 303);
    },
);

// A refresh or Back to the token page asks for it with a GET: the token is not
// kept, so send the person to the Household page.
householdRoutes.get("/settings/household/rotate-token", requireOwner, (c) =>
    c.redirect("/settings/household", 303),
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
        // The token is in this page and nowhere else: never cached.
        c.header("Cache-Control", "no-store");
        const page = await renderHouseholdTokenRoute(userId, token);
        return c.html(page.html, page.status);
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
        const check = checkManagedMember(owner, target, "transfer");
        if (!check.ok) {
            const page = await memberActionError(
                userId,
                targetId,
                new Error(check.error),
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
            const page = await memberActionError(userId, targetId, err);
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/household", 303);
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
        const check = checkManagedMember(owner, target, "remove");
        if (!check.ok) {
            const page = await memberActionError(
                userId,
                targetId,
                new Error(check.error),
            );
            return c.html(page.html, page.status);
        }
        if (formText(body, "confirm") !== "yes") {
            const page = await memberActionError(
                userId,
                targetId,
                new Error(
                    `Confirm removing ${check.target.displayName} from the menu.`,
                ),
            );
            return c.html(page.html, page.status);
        }
        try {
            await removeHouseholdMemberAccount(
                owner.householdId,
                check.target.userId,
            );
        } catch (err) {
            const page = await memberActionError(userId, targetId, err);
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/household", 303);
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
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/household", 303);
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/allergens",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const target = await personRulesTarget(c);
        if (!target.ok) return c.html(target.page.html, target.page.status);
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
        // toast: none
        return c.redirect("/settings/household", 303);
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/dislikes",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const target = await personRulesTarget(c);
        if (!target.ok) return c.html(target.page.html, target.page.status);
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
        // toast: none
        return c.redirect("/settings/household", 303);
    },
);

householdRoutes.post(
    "/settings/household/members/:userId/rules",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const manager = siteMember(c);
        const target = await personRulesTarget(c);
        if (!target.ok) return c.html(target.page.html, target.page.status);
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
        // toast: none
        return c.redirect("/settings/household", 303);
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
        // toast: none
        return c.redirect("/settings/household", 303);
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
        const role = formText(body, "role");
        const target = await getHouseholdMembership(
            targetId,
            owner.householdId,
        );
        const check = checkManagedMember(owner, target, "role");
        // oxlint-disable-next-line foodable/no-raw-role-check -- validates the submitted form value, not the actor's role
        if (!check.ok || (role !== "admin" && role !== "member")) {
            const page = await memberActionError(
                userId,
                targetId,
                new Error(check.ok ? "Choose admin or member." : check.error),
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
            const page = await memberActionError(userId, targetId, err);
            return c.html(page.html, page.status);
        }
        // toast: none. The page shows the new role.
        return c.redirect(
            `/settings/household/members/${encodeURIComponent(check.target.userId)}`,
            303,
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
    typed?: Record<string, string | string[]>,
) {
    const message =
        err instanceof FoodsInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update foods.";
    const page = await renderSettingsSavedV2Route(userId, {
        error: message,
        openModalId,
        typed,
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
            // The sheet opens with no Keep chosen, so a merge sent without one
            // is refused in place rather than merged into a food nobody picked.
            if (formText(body, "keep_id") === "") {
                throw new FoodsInputError("Choose the food to keep.");
            }
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
                {
                    keep_id: formText(body, "keep_id"),
                    drop_id: formText(body, "drop_id"),
                },
            );
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/saved", 303);
    },
);

householdRoutes.post(
    "/settings/household/items/:id/archive",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const foodId = c.req.param("id");
        const store = liveFoodsStore();
        try {
            await updateFood(store, member.householdId, foodId, {
                archived: true,
            });
        } catch (err) {
            const page = await foodsFormError(
                userId,
                err,
                savedFoodDeleteSheetId(foodId),
            );
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/saved", 303);
    },
);

/**
 * The aliases a food form posts. `alias_lines` is one alias per line, so an
 * alias may hold a comma ("salt, kosher"); the older `aliases` field is
 * comma-separated. A form that posts neither leaves the food's aliases alone.
 */
function postedAliases(
    body: Record<string, string | File>,
): string[] | undefined {
    const split = (raw: string, on: RegExp) =>
        raw
            .split(on)
            .map((part) => part.trim())
            .filter(Boolean);
    if ("alias_lines" in body) {
        return split(formText(body, "alias_lines"), /\r?\n/);
    }
    if ("aliases" in body) return split(formText(body, "aliases"), /,/);
    return undefined;
}

/** What an edit posted, for a refused save to reopen the sheet with. */
function typedFoodForm(
    body: Record<string, string | File | (string | File)[]>,
): Record<string, string | string[]> {
    const typed: Record<string, string | string[]> = {};
    for (const key of Object.keys(body)) {
        if (key === "allergens") continue;
        typed[key] = formText(body, key);
    }
    typed.allergens = formAllergens(body);
    return typed;
}

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
            aliases: postedAliases(asText),
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
                    { notify: liveNotifier(member.householdId, userId) },
                );
            }
            if ("usual_product_id" in asText) {
                const raw = formText(asText, "usual_product_id");
                await setUsualProduct(
                    store,
                    member.householdId,
                    foodId,
                    raw.trim() === "" ? null : raw.trim(),
                    {
                        stores: settings,
                        notify: liveNotifier(member.householdId, userId),
                    },
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
                typedFoodForm(body),
            );
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/settings/saved", 303);
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

// Settings › Saved foods & recipes › Possible duplicates and one pair's compare
// page. Merge and keep-separate post to the routes further down.
householdRoutes.get(DUPLICATES_PATH, requireSiteUser, async (c) => {
    const page = await renderSettingsDuplicatesRoute(c.get("userId"));
    return c.html(page.html, page.status);
});

householdRoutes.get(`${DUPLICATES_PATH}/:a/:b`, requireSiteUser, async (c) => {
    const page = await renderSettingsDuplicateCompareRoute(
        c.get("userId"),
        c.req.param("a"),
        c.req.param("b"),
    );
    return c.html(page.html, page.status);
});

// The list's old address. An exact route, not a LEGACY_PATH_MOVES entry: those
// prefix-match every method, so the merge and keep-separate posts below would
// answer 308 instead of acting.
householdRoutes.get(
    "/settings/household/possible-duplicates",
    requireSiteUser,
    (c) => c.redirect(`${DUPLICATES_PATH}${new URL(c.req.url).search}`, 301),
);

/**
 * A refused merge or keep-separate: the compare page it came from (404 when
 * the pair is no longer a suggestion falls back to the list) or the list.
 */
async function duplicatesRefusal(
    userId: string,
    input: {
        foodA: string;
        foodB: string;
        back: string;
        view: string;
        message: string;
        mergePost?: DuplicateMergePost;
    },
) {
    const fromCompare =
        input.back !== DUPLICATES_PATH ||
        input.view === DUPLICATES_VIEW_COMPARE;
    if (fromCompare) {
        const page = await renderSettingsDuplicateCompareRoute(
            userId,
            input.foodA,
            input.foodB,
            { error: input.message, mergePost: input.mergePost },
        );
        if (page.status !== 404) {
            return {
                status: page.status === 200 ? (400 as const) : page.status,
                html: page.html,
            };
        }
    }
    const page = await renderSettingsDuplicatesRoute(userId, {
        error: input.message,
    });
    return {
        status: page.status === 200 ? (400 as const) : page.status,
        html: page.html,
    };
}

householdRoutes.post(
    "/settings/household/possible-duplicates/keep-separate",
    requireMember,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const subjectId = formText(body, "subject_id");
        const relatedId = formText(body, "related_id");
        const back = duplicatesBackFrom(formText(body, "back"));
        try {
            const today = await householdToday(member.householdId);
            await dismissNotice(
                noticeDeps(),
                member.householdId,
                userId,
                {
                    code: "food.possible_duplicate",
                    subjectKind: "food",
                    subjectId,
                    relatedId,
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
            const page = await duplicatesRefusal(userId, {
                foodA: subjectId,
                foodB: relatedId,
                back,
                view: formText(body, "view"),
                message,
            });
            return c.html(page.html, page.status);
        }
        // Success goes to the list even from a compare `back`: the pair is gone,
        // so its compare page would 404. A refusal keeps `back` (above).
        // toast: none
        return c.redirect(DUPLICATES_PATH, 303);
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
        const back = duplicatesBackFrom(formText(asText, "back"));
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
            const page = await duplicatesRefusal(userId, {
                foodA,
                foodB,
                back,
                view: formText(asText, "view"),
                message,
                mergePost,
            });
            return c.html(page.html, page.status);
        }
        // Success goes to the list even from a compare `back`: the pair is gone,
        // so its compare page would 404. A refusal keeps `back` (above).
        // toast: none
        return c.redirect(DUPLICATES_PATH, 303);
    },
);

function invitesBackHref(c: Context, from?: string) {
    return settingsBackHref({
        from,
        referer: c.req.header("referer"),
        origin: getBaseUrl(c),
    });
}

async function renderInvitesRoute(
    userId: string,
    backHref: string,
    opts?: { createdCode?: string; error?: string },
) {
    const member = await getHouseholdMembership(userId);
    if (!member) {
        return { status: 403 as const, html: forbiddenDashboardHtml() };
    }
    if (!can(member, "member.manage").ok) {
        return { status: 403 as const, html: forbiddenDashboardHtml() };
    }
    const profile = await getProfile(userId);
    const [chrome, invites, flags, clock] = await Promise.all([
        viewerChromeWithAttention(profile, member),
        listHouseholdInvites(member.householdId),
        viewerFlagsFor(member),
        householdClock(member.householdId),
    ]);
    return {
        status: 200 as const,
        html: renderHouseholdInvitesPage({
            chrome,
            flags,
            backHref,
            member,
            invites,
            timezone: clock.timezone,
            createdCode: opts?.createdCode,
            error: opts?.error,
        }),
    };
}

householdRoutes.get(
    "/settings/household/invites",
    requireAction("member.manage"),
    async (c) => {
        const page = await renderInvitesRoute(
            c.get("userId"),
            invitesBackHref(c, c.req.query("from")),
        );
        return c.html(page.html, page.status);
    },
);

householdRoutes.post(
    "/settings/household/invites",
    requireAction("member.manage"),
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const backHref = invitesBackHref(c, formText(body, "from"));
        try {
            const { code } = await createHouseholdInvite(
                member.householdId,
                member.userId,
            );
            const page = await renderInvitesRoute(member.userId, backHref, {
                createdCode: code,
            });
            return c.html(page.html, page.status);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Could not create invite.";
            const page = await renderInvitesRoute(member.userId, backHref, {
                error: message,
            });
            return c.html(page.html, 400);
        }
    },
);

householdRoutes.post(
    "/settings/household/invites/revoke",
    requireAction("member.manage"),
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const backHref = invitesBackHref(c, formText(body, "from"));
        const inviteId = formText(body, "invite_id");
        if (!inviteId || !isInviteId(inviteId)) {
            return c.text("Bad Request", 400);
        }
        await revokeHouseholdInvite(member.householdId, inviteId);
        return c.redirect(
            `/settings/household/invites${backHref !== "/" ? `?from=${encodeURIComponent(backHref)}` : ""}`,
            303,
        );
    },
);
