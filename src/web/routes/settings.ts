import { Hono } from "hono";
import { parseAppearanceInput } from "../shell.js";

import { parseNutritionPrefsInput } from "../pages/settings.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderSettingsAccountPage,
    renderSettingsHelpRoute,
} from "../loaders.js";
import { formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { HouseholdAlreadyExistsError } from "../../household.js";
import {
    createHouseholdForCaller,
    updateMemberDisplayName,
} from "../../db/household.js";
import { upsertProfile } from "../../db/profiles.js";
import { validateTz } from "../../domain/tz.js";
import { redirectWithToast } from "../components/toast.js";

export const settingsRoutes = new Hono();

settingsRoutes.get("/settings", requireSiteUser, async (c) => {
    const page = await renderSettingsAccountPage(c.get("userId"));
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
        return redirectWithToast(c, "/settings", "settings.nutrition.saved");
    }
    const appearance = parseAppearanceInput({ theme: body.theme });
    await upsertProfile(userId, appearance);
    const displayName = formText(body, "display_name").trim();
    if (displayName) {
        await updateMemberDisplayName(member.householdId, userId, displayName);
    }
    return redirectWithToast(c, "/settings", "settings.profile.saved");
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
    return redirectWithToast(c, "/", "settings.household.created");
});
