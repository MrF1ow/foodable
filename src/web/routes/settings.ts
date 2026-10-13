import { Hono } from "hono";
import { parseAppearanceInput } from "../../app/shell.js";
import { parseNutritionPrefsInput } from "../pages/settings.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderHouseholdSettingsRoute,
    renderSettingsAccountPage,
    renderSettingsFoodsPage,
} from "../dashboard.js";
import { formText } from "../form.js";
import {
    requireMember,
    requireOwner,
    requireSiteUser,
    siteMember,
} from "../middleware.js";
import {
    checkManagedMember,
    HouseholdAlreadyExistsError,
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
    RulesInputError,
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

export const settingsRoutes = new Hono();

async function householdFormError(userId: string, err: unknown) {
    const message =
        err instanceof SettingsInputError || err instanceof RulesInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update household settings.";
    const page = await renderHouseholdSettingsRoute(userId, { error: message });
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
        return c.redirect("/settings");
    }
    const appearance = parseAppearanceInput({ theme: body.theme });
    await upsertProfile(userId, appearance);
    const displayName = formText(body, "display_name").trim();
    if (displayName) {
        await updateMemberDisplayName(member.householdId, userId, displayName);
    }
    return c.redirect("/settings");
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
    return c.redirect("/");
});

settingsRoutes.post("/settings/household", requireOwner, async (c) => {
    const userId = c.get("userId");
    const owner = siteMember(c);
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
        });
        return c.html(page.html, 400);
    }
    const added = await addHouseholdMemberForHousehold(
        owner.householdId,
        parsed.value,
    );
    if (!added.ok) {
        const page = await renderHouseholdSettingsRoute(userId, {
            error: added.error,
        });
        return c.html(page.html, 400);
    }
    return c.redirect("/settings/household");
});

settingsRoutes.post("/settings/household/name", requireOwner, async (c) => {
    const userId = c.get("userId");
    const owner = siteMember(c);
    const body = await c.req.parseBody();
    const name = formText(body, "name").trim();
    if (!name) {
        const page = await renderHouseholdSettingsRoute(userId, {
            error: "Enter a household name.",
        });
        return c.html(page.html, 400);
    }
    const config = await getHouseholdConfig(owner.householdId);
    await updateHouseholdConfig(owner.householdId, { ...config, name });
    return c.redirect("/settings/household");
});

settingsRoutes.post("/settings/household/location", requireOwner, async (c) => {
    const owner = siteMember(c);
    const body = await c.req.parseBody();
    await setHouseholdLocation(
        liveSettingsStore(),
        owner.householdId,
        formText(body, "location"),
    );
    return c.redirect("/settings/household");
});

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
        const check = checkManagedMember(owner, target, "transfer");
        if (!check.ok) {
            const page = await householdFormError(
                userId,
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
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
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
        const check = checkManagedMember(owner, target, "remove");
        if (!check.ok) {
            const page = await householdFormError(
                userId,
                new Error(check.error),
            );
            return c.html(page.html, page.status);
        }
        if (formText(body, "confirm") !== "yes") {
            const page = await householdFormError(
                userId,
                new Error(
                    `Tick the box to confirm removing ${check.target.displayName}.`,
                ),
            );
            return c.html(page.html, page.status);
        }
        try {
            await deleteAllUserData(check.target.userId);
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
    },
);

settingsRoutes.post("/settings/household/stores", requireOwner, async (c) => {
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
        const page = await householdFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/settings/household");
});

settingsRoutes.post(
    "/settings/household/sections/:id",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await renameSection(
                liveSettingsStore(),
                owner.householdId,
                c.req.param("id"),
                formText(body, "name"),
            );
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
    },
);

settingsRoutes.post(
    "/settings/household/stores/:id/rules",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addStoreRule(liveRulesStore(), {
                householdId: owner.householdId,
                storeId: c.req.param("id"),
                body: formText(body, "body"),
            });
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
    },
);

settingsRoutes.post(
    "/settings/household/members/:userId/allergens",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addAllergen(liveRulesStore(), {
                householdId: owner.householdId,
                userId: c.req.param("userId"),
                allergen: formText(body, "allergen"),
                otherLabel: formText(body, "other_label"),
            });
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
    },
);

settingsRoutes.post(
    "/settings/household/members/:userId/dislikes",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addDislike(liveRulesStore(), {
                householdId: owner.householdId,
                userId: c.req.param("userId"),
                displayName: formText(body, "display_name"),
            });
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
    },
);

settingsRoutes.post(
    "/settings/household/members/:userId/rules",
    requireOwner,
    async (c) => {
        const userId = c.get("userId");
        const owner = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addPersonRule(liveRulesStore(), {
                householdId: owner.householdId,
                userId: c.req.param("userId"),
                body: formText(body, "body"),
            });
        } catch (err) {
            const page = await householdFormError(userId, err);
            return c.html(page.html, page.status);
        }
        return c.redirect("/settings/household");
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

async function foodsFormError(userId: string, err: unknown) {
    const message =
        err instanceof FoodsInputError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not update foods.";
    const page = await renderSettingsFoodsPage(userId, message);
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
        const page = await foodsFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/settings/foods");
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
        const page = await foodsFormError(userId, err);
        return c.html(page.html, page.status);
    }
    return c.redirect("/settings/foods");
});
