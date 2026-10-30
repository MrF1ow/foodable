import { Hono, type Context } from "hono";
import { parseAppearanceInput } from "../shell.js";

import { parseNutritionPrefsInput } from "../pages/settings.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderHouseholdSettingsRoute,
    renderSettingsAccountPage,
    renderSettingsFoodsPage,
    renderSettingsHelpRoute,
} from "../loaders.js";
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
    HouseholdAlreadyExistsError,
    type HouseholdMember,
    parseMemberInput,
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
    createHouseholdForCaller,
    getHouseholdConfig,
    getHouseholdMembership,
    rotateHouseholdMcpToken,
    setHouseholdMemberRole,
    transferHouseholdOwnership,
    updateHouseholdConfig,
    updateMemberDisplayName,
} from "../../db/household.js";
import { deleteAllUserData } from "../../db/nutrition.js";
import { upsertProfile } from "../../db/profiles.js";
import { liveRulesStore } from "../../db/rules.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveFoodsStore } from "../../db/foods.js";
import { validateTz } from "../../domain/tz.js";
import { FoodsInputError, mergeFoods, updateFood } from "../../domain/foods.js";
import {
    HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    HOUSEHOLD_ADD_STORE_MODAL_ID,
} from "../pages/household.js";
import { FOODS_MERGE_MODAL_ID } from "../pages/foods.js";

export const settingsRoutes = new Hono();

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

settingsRoutes.get("/settings", requireSiteUser, async (c) => {
    const page = await renderSettingsAccountPage(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/household", requireSiteUser, async (c) => {
    const page = await renderHouseholdSettingsRoute(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/foods", requireSiteUser, async (c) => {
    const page = await renderSettingsFoodsPage(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/help", requireSiteUser, async (c) => {
    const page = await renderSettingsHelpRoute(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.post("/settings", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const group = formText(body, "group");
    if (group === "nutrition") {
        const prefs = parseNutritionPrefsInput({
            timezone: body.timezone,
            preferred_weight_unit: body.preferred_weight_unit,
            widgets_enabled: formText(body, "widgets_enabled") === "true",
            alcohol_tracking_enabled:
                formText(body, "alcohol_tracking_enabled") === "true",
            preferred_drink_unit: body.preferred_drink_unit,
        });
        if (prefs.timezone) {
            if (!validateTz(prefs.timezone)) {
                const page = await renderSettingsAccountPage(
                    userId,
                    "Enter a valid IANA timezone.",
                );
                return c.html(page.html, 400);
            }
        } else {
            delete prefs.timezone;
        }
        await upsertProfile(userId, prefs);
        return c.redirect("/settings", 303);
    }
    const appearance = parseAppearanceInput({ theme: body.theme });
    await upsertProfile(userId, appearance);
    const displayName = formText(body, "display_name").trim();
    if (displayName) {
        await updateMemberDisplayName(member.householdId, userId, displayName);
    }
    return c.redirect("/settings", 303);
});

settingsRoutes.post("/create-household", requireSiteUser, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const name = String(body.household_name ?? "").trim();
    const displayName = String(body.display_name ?? "").trim();
    if (!name || !displayName) {
        return c.html(
            createHouseholdFormHtml("Enter a household name and your name."),
            400,
        );
    }
    try {
        await createHouseholdForCaller(userId, name, displayName);
    } catch (err) {
        if (err instanceof HouseholdAlreadyExistsError) {
            return c.html(forbiddenDashboardHtml(), 403);
        }
        const message =
            err instanceof Error
                ? err.message
                : "Could not create the household.";
        return c.html(createHouseholdFormHtml(message), 400);
    }
    return c.redirect("/", 303);
});

settingsRoutes.post("/settings/household", requireManager, async (c) => {
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
    return c.redirect("/settings/household", 303);
});

settingsRoutes.post("/settings/household/name", requireManager, async (c) => {
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
    return c.redirect("/settings/household", 303);
});

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

settingsRoutes.post(
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

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

// Removing a person erases their login, tokens and personal nutrition history
// through the same path as delete_account. Shared household data (fridge,
// grocery, recipes, foods) stays.
settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

settingsRoutes.post("/settings/household/stores", requireManager, async (c) => {
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
    return c.redirect("/settings/household", 303);
});

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

settingsRoutes.post(
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

settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
    },
);

// The owner raises a member to admin or lowers an admin back to member. The
// owner keeps ownership either way.
settingsRoutes.post(
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
        return c.redirect("/settings/household", 303);
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

settingsRoutes.post("/settings/foods/merge", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    try {
        await mergeFoods(
            liveFoodsStore(),
            member.householdId,
            formText(body, "keep_id"),
            formText(body, "drop_id"),
        );
    } catch (err) {
        const page = await foodsFormError(userId, err, FOODS_MERGE_MODAL_ID);
        return c.html(page.html, page.status);
    }
    return c.redirect("/settings/foods", 303);
});

settingsRoutes.post("/settings/foods/:id", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody({ all: true });
    const asText = body as Record<string, string | File>;
    try {
        await updateFood(
            liveFoodsStore(),
            member.householdId,
            c.req.param("id"),
            {
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
            },
        );
    } catch (err) {
        const page = await foodsFormError(
            userId,
            err,
            `food-edit-${c.req.param("id")}`,
        );
        return c.html(page.html, page.status);
    }
    return c.redirect("/settings/foods", 303);
});
