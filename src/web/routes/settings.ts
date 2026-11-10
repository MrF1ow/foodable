import { Hono, type Context } from "hono";
import { parseAppearanceInput } from "../shell.js";

import { parseNutritionPrefsInput } from "../pages/settings.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderSettingsAccountPage,
    renderSettingsAccountV2Route,
    renderSettingsDisplayV2Route,
    renderSettingsHelpRoute,
    renderSettingsHomeRoute,
    renderSettingsHouseholdRoute,
} from "../loaders.js";
import { isValidDisplayTheme } from "../pages/v2/settings-display.js";
import { viewerFlagsFor } from "../attention.js";
import { gatedRoute } from "../gated.js";
import { formText } from "../form.js";
import {
    requireManager,
    requireMember,
    requireSiteUser,
    siteMember,
} from "../middleware.js";
import {
    HouseholdAlreadyExistsError,
    isRestockWeekday,
    mergeHouseholdConfig,
    parseHouseholdConfigPatch,
    RESTOCK_WEEKDAY_ERROR,
} from "../../household.js";
import {
    createHouseholdForCaller,
    getHouseholdMembership,
    getHouseholdConfig,
    householdExists,
    updateHouseholdConfig,
    updateMemberDisplayName,
} from "../../db/household.js";
import { authUserCount } from "../../db/users.js";
import {
    canSignUp,
    getSignupPolicy,
    signupPolicyForRoutes,
} from "../../domain/signup.js";
import { upsertProfile } from "../../db/profiles.js";
import { validateTz } from "../../domain/tz.js";
import { redirectWithToast } from "../components/toast.js";
import { getBaseUrl } from "../../url.js";
import {
    householdSettingsUrlWithBack,
    settingsBackHref,
    settingsUrlWithBack,
} from "../settings-back.js";

export const settingsRoutes = new Hono();

function resolveBackHref(c: Context) {
    return settingsBackHref({
        from: c.req.query("from"),
        referer: c.req.header("referer"),
        origin: getBaseUrl(c),
    });
}

settingsRoutes.get("/settings", requireSiteUser, async (c) => {
    const userId = c.get("userId");
    const member = await getHouseholdMembership(userId);
    const flags = member ? await viewerFlagsFor(member) : null;
    if (flags?.uiV2) {
        const page = await renderSettingsHomeRoute(userId);
        return c.html(page.html, page.status);
    }
    const backHref = resolveBackHref(c);
    const page = await renderSettingsAccountPage(userId, { backHref });
    return c.html(page.html, page.status);
});

settingsRoutes.get(
    "/settings/account",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const backHref = resolveBackHref(c);
        const page = await renderSettingsAccountV2Route(c.get("userId"), {
            backHref,
        });
        return c.html(page.html, page.status);
    },
);

settingsRoutes.get(
    "/settings/display",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const page = await renderSettingsDisplayV2Route(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

settingsRoutes.post(
    "/settings/display",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const body = await c.req.parseBody();
        const themeRaw = formText(body, "theme");
        if (!isValidDisplayTheme(themeRaw)) {
            const page = await renderSettingsDisplayV2Route(userId, {
                error: "Choose Auto, Light, or Dark.",
            });
            return c.html(page.html, 400);
        }
        const appearance = parseAppearanceInput({
            theme: themeRaw === "system" ? "system" : themeRaw,
        });
        await upsertProfile(userId, appearance);
        // toast: none full reload refreshes theme chrome on this page
        return c.redirect("/settings/display", 303);
    },
);

settingsRoutes.get("/settings/help", requireSiteUser, async (c) => {
    const backHref = resolveBackHref(c);
    const page = await renderSettingsHelpRoute(c.get("userId"), { backHref });
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/household-settings", requireMember, async (c) => {
    const backHref = resolveBackHref(c);
    const page = await renderSettingsHouseholdRoute(c.get("userId"), {
        backHref,
    });
    return c.html(page.html, page.status);
});

settingsRoutes.post(
    "/settings/household-settings",
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const origin = getBaseUrl(c);
        const backHref = settingsBackHref({
            from: formText(body, "from"),
            referer: undefined,
            origin,
        });
        const redirectTo = householdSettingsUrlWithBack(backHref);
        const timezoneRaw = formText(body, "timezone");
        const restockWeekdayRaw = formText(body, "restock_weekday");
        const restockTime = formText(body, "restock_time");
        const restockEnabled = formText(body, "restock_enabled") === "true";
        const draft = {
            timezone: timezoneRaw === "" ? null : timezoneRaw,
            restockEnabled,
            restockWeekday: restockWeekdayRaw,
            restockTime,
        };

        const weekdayTrimmed = restockWeekdayRaw.trim();
        if (weekdayTrimmed === "" || !/^\d+$/.test(weekdayTrimmed)) {
            const page = await renderSettingsHouseholdRoute(userId, {
                backHref,
                error: RESTOCK_WEEKDAY_ERROR,
                draft,
            });
            return c.html(page.html, 400);
        }
        const restockWeekday = Number(weekdayTrimmed);
        if (!isRestockWeekday(restockWeekday)) {
            const page = await renderSettingsHouseholdRoute(userId, {
                backHref,
                error: RESTOCK_WEEKDAY_ERROR,
                draft,
            });
            return c.html(page.html, 400);
        }

        const patchInput = {
            timezone: timezoneRaw === "" ? null : timezoneRaw,
            restock_enabled: restockEnabled,
            restock_weekday: restockWeekday,
            restock_time: restockTime,
        };
        const parsed = parseHouseholdConfigPatch(patchInput);
        if (!parsed.ok) {
            const page = await renderSettingsHouseholdRoute(userId, {
                backHref,
                error: parsed.error,
                draft,
            });
            return c.html(page.html, 400);
        }
        const current = await getHouseholdConfig(member.householdId);
        await updateHouseholdConfig(
            member.householdId,
            mergeHouseholdConfig(current, parsed.value),
        );
        return redirectWithToast(
            c,
            redirectTo,
            "settings.household-settings.saved",
        );
    },
);

settingsRoutes.post("/settings", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const origin = getBaseUrl(c);
    const backHref = settingsBackHref({
        from: formText(body, "from"),
        referer: undefined,
        origin,
    });
    const redirectTo = settingsUrlWithBack(backHref);
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
                const page = await renderSettingsAccountPage(userId, {
                    backHref,
                    error: "Enter a valid IANA timezone.",
                });
                return c.html(page.html, 400);
            }
        } else {
            delete prefs.timezone;
        }
        await upsertProfile(userId, prefs);
        return redirectWithToast(c, redirectTo, "settings.nutrition.saved");
    }
    if ("theme" in body) {
        const appearance = parseAppearanceInput({ theme: body.theme });
        await upsertProfile(userId, appearance);
    }
    const displayName = formText(body, "display_name").trim();
    if (displayName) {
        await updateMemberDisplayName(member.householdId, userId, displayName);
    }
    return redirectWithToast(c, redirectTo, "settings.profile.saved");
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
    const policy = signupPolicyForRoutes(getSignupPolicy());
    const createHousehold = canSignUp(policy, {
        userCount: await authUserCount(),
        householdExists: await householdExists(),
        mode: "create-household",
        callerHasHousehold: (await getHouseholdMembership(userId)) != null,
    });
    if (!createHousehold.ok) {
        return c.html(forbiddenDashboardHtml(), 403);
    }
    try {
        await createHouseholdForCaller(userId, name, displayName, {
            allowAdditional: policy === "open",
        });
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
    return redirectWithToast(c, "/", "settings.household.created");
});
