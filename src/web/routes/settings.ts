import { Hono, type Context } from "hono";
import { parseAppearanceInput } from "../shell.js";

import { parseNutritionPrefsInput } from "../pages/settings.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderSettingsAccountPage,
    renderSettingsAiV2Route,
    renderSettingsAccountV2Route,
    renderSettingsDisplayV2Route,
    renderSettingsExportV2Route,
    alcoholOf,
    renderSettingsGoalsV2Route,
    renderSettingsHelpRoute,
    renderSettingsHomeRoute,
    renderSettingsHouseholdRoute,
    renderSettingsSavedV2Route,
    renderSettingsScoreHouseholdV2Route,
    renderSettingsScoreV2Route,
} from "../loaders.js";
import { liveScoreSettingsStore } from "../../db/score-settings.js";
import {
    updateHouseholdScoreDefault,
    updateMemberScoreSettings,
} from "../../domain/score-settings.js";
import {
    parseScoreForm,
    parseScoreIntent,
    SCORE_HOUSEHOLD_PATH,
    SCORE_PATH,
    type ScoreFormDraft,
} from "../pages/v2/settings-score.js";
import { liveExportArchiveStore } from "../../db/exports.js";
import { revokeConnection } from "../../db/tokens.js";
import {
    AI_DISCONNECT_PATH,
    UNKNOWN_APP_MARKER,
} from "../pages/v2/settings-ai.js";
import { exportAllData } from "../../domain/export.js";
import { checkRateLimit } from "../../rate-limit.js";
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
import {
    getProfile,
    timezoneFromProfile,
    upsertProfile,
} from "../../db/profiles.js";
import {
    clearGoalDays,
    getNutritionGoals,
    upsertNutritionGoals,
} from "../../db/nutrition.js";
import { isCalendarDate } from "../../domain/insights.js";
import { todayInTz, validateTz } from "../../domain/tz.js";
import {
    GOALS_FORM_FIELDS,
    parseGoalsForm,
    type GoalsFormDraft,
} from "../pages/v2/settings-goals-form.js";
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

settingsRoutes.get(
    "/settings/goals",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const page = await renderSettingsGoalsV2Route(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

settingsRoutes.post(
    "/settings/goals",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const body = await c.req.parseBody();
        const values = Object.fromEntries(
            GOALS_FORM_FIELDS.map((f) => [f, formText(body, f)]),
        ) as GoalsFormDraft;
        const profile = await getProfile(userId);
        const stored = await getNutritionGoals(userId);
        const parsed = parseGoalsForm(values, {
            alcohol: alcoholOf(profile),
            stored,
        });
        if (!parsed.ok) {
            const page = await renderSettingsGoalsV2Route(userId, {
                error: parsed.errors.join(" "),
                draft: values,
                invalid: parsed.invalid,
            });
            // A non-member gets the membership page with its own status.
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // A save that changes a target is the day those goals were set; a
        // rename alone is not, the same rule set_nutrition_goals follows.
        const input = parsed.changesTargets
            ? {
                  ...parsed.input,
                  goals_set_on: todayInTz(
                      timezoneFromProfile(profile) ?? "UTC",
                  ),
              }
            : parsed.input;
        await upsertNutritionGoals(userId, input);
        return redirectWithToast(c, "/settings/goals", "settings.goals.saved");
    },
);

settingsRoutes.post(
    "/settings/goals/days/clear",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const date = formText(body, "date").trim();
        if (!isCalendarDate(date)) {
            const page = await renderSettingsGoalsV2Route(userId, {
                error: "Choose a valid day.",
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // Always the caller's own rows: the id comes from the session, never
        // the form.
        await clearGoalDays(userId, member.householdId, [date]);
        return redirectWithToast(
            c,
            "/settings/goals",
            "settings.goals.day-cleared",
        );
    },
);

settingsRoutes.get(
    SCORE_PATH,
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const page = await renderSettingsScoreV2Route(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

settingsRoutes.post(
    SCORE_PATH,
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const store = liveScoreSettingsStore();
        const intent = parseScoreIntent(formText(body, "intent"));
        // Always the caller's own record: the member comes from the session,
        // never the form. Each save is read, patched and written whole, so
        // changing one switch keeps the choice and the other switch.
        switch (intent) {
            case "household":
                await updateMemberScoreSettings(
                    store,
                    member.householdId,
                    userId,
                    { choice: null },
                );
                return redirectWithToast(
                    c,
                    SCORE_PATH,
                    "settings.score.household",
                );
            case "warn_traces":
            case "compare_goals": {
                await updateMemberScoreSettings(
                    store,
                    member.householdId,
                    userId,
                    intent === "warn_traces"
                        ? { warnTraces: formText(body, "value") === "1" }
                        : { compareGoals: formText(body, "value") === "1" },
                );
                // toast: none the switch itself shows the new state
                return c.redirect(SCORE_PATH, 303);
            }
            case "choice": {
                const parsed = parseScoreForm(body);
                if (!parsed.ok) {
                    return refusedScorePage(c, parsed.error, parsed.draft);
                }
                await updateMemberScoreSettings(
                    store,
                    member.householdId,
                    userId,
                    { choice: parsed.choice },
                );
                return redirectWithToast(c, SCORE_PATH, "settings.score.saved");
            }
            default: {
                const page = await renderSettingsScoreV2Route(userId, {
                    error: "Choose what to save.",
                });
                return c.html(page.html, 400);
            }
        }
    },
);

async function refusedScorePage(
    c: Context,
    error: string,
    draft: ScoreFormDraft,
) {
    const page = await renderSettingsScoreV2Route(c.get("userId"), {
        error,
        draft,
    });
    // A non-member gets the membership page with its own status.
    return c.html(page.html, page.status === 200 ? 400 : page.status);
}

settingsRoutes.get(
    SCORE_HOUSEHOLD_PATH,
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    requireManager,
    async (c) => {
        const page = await renderSettingsScoreHouseholdV2Route(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

// Owners and admins only, whatever the page shows: the middleware refuses
// anyone else with 403 before this runs.
settingsRoutes.post(
    SCORE_HOUSEHOLD_PATH,
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const store = liveScoreSettingsStore();
        const intent = formText(body, "intent");
        if (intent === "clear") {
            await updateHouseholdScoreDefault(store, member.householdId, null);
            return redirectWithToast(
                c,
                SCORE_PATH,
                "settings.score.household-cleared",
            );
        }
        if (intent !== "choice") {
            const page = await renderSettingsScoreHouseholdV2Route(userId, {
                error: "Choose what to save.",
            });
            return c.html(page.html, 400);
        }
        const parsed = parseScoreForm(body);
        if (!parsed.ok) {
            const page = await renderSettingsScoreHouseholdV2Route(userId, {
                error: parsed.error,
                draft: parsed.draft,
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        await updateHouseholdScoreDefault(
            store,
            member.householdId,
            parsed.choice,
        );
        return redirectWithToast(
            c,
            SCORE_PATH,
            "settings.score.household-saved",
        );
    },
);

settingsRoutes.get(
    "/settings/ai-connections",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const page = await renderSettingsAiV2Route(c.get("userId"), {
            mcpUrl: `${getBaseUrl(c)}/mcp`,
        });
        return c.html(page.html, page.status);
    },
);

// The longest id an app can hold: a uuid, or the deploy-wide client id.
const CLIENT_ID_MAX = 200;
// Postgres text cannot hold a NUL, and no app id carries any control
// character, so a value with one is a bad choice rather than a database error.
const CONTROL_CHARACTER = /\p{Cc}/u;

settingsRoutes.post(
    AI_DISCONNECT_PATH,
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const body = await c.req.parseBody();
        const client = formText(body, "client").trim();
        if (
            client === "" ||
            client.length > CLIENT_ID_MAX ||
            CONTROL_CHARACTER.test(client)
        ) {
            const page = await renderSettingsAiV2Route(userId, {
                mcpUrl: `${getBaseUrl(c)}/mcp`,
                error: "Choose an app to disconnect.",
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // Always the caller's own tokens: the member comes from the session,
        // never the form. The marker stands for tokens with no recorded app.
        const revoked = await revokeConnection(
            userId,
            client === UNKNOWN_APP_MARKER ? null : client,
        );
        return redirectWithToast(
            c,
            "/settings/ai-connections",
            revoked > 0
                ? "settings.ai.disconnected"
                : "settings.ai.already-disconnected",
        );
    },
);

settingsRoutes.get(
    "/settings/saved",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const page = await renderSettingsSavedV2Route(c.get("userId"), {
            q: c.req.query("q"),
        });
        return c.html(page.html, page.status);
    },
);

settingsRoutes.get(
    "/settings/export",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const page = await renderSettingsExportV2Route(c.get("userId"));
        return c.html(page.html, page.status);
    },
);

settingsRoutes.post(
    "/settings/export",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const limited = await checkRateLimit(userId);
        if (!limited.allowed) {
            return c.text("Too many requests. Try again in a minute.", 429, {
                "Retry-After": String(limited.retryAfterSeconds ?? 60),
            });
        }
        const origin = getBaseUrl(c);
        const result = await exportAllData(
            userId,
            liveExportArchiveStore(),
            origin,
        );
        if (!result.downloadPath) {
            const page = await renderSettingsExportV2Route(userId, {
                error: "Nothing to export yet.",
            });
            // A non-member gets the membership page with its own status.
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        // toast: none
        return c.redirect(result.downloadPath, 303);
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
        // The inline control on Settings home comes back to it; only that
        // exact path is honoured.
        const back =
            formText(body, "return") === "/settings"
                ? "/settings"
                : "/settings/display";
        // toast: none full reload refreshes theme chrome on this page
        return c.redirect(back, 303);
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
