import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { parseAppearanceInput } from "../shell.js";

import { parseNutritionPrefsInput } from "../pages/v2/settings-account.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderSettingsAccountPage,
    renderSettingsAiV2Route,
    renderSettingsAccountV2Route,
    renderSettingsTimezoneV2Route,
    renderSettingsNutrientsV2Route,
    renderSettingsUnitsV2Route,
    alcoholOf,
    renderSettingsGoalsV2Route,
    renderSettingsHelpRoute,
    renderSettingsHomeRoute,
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
    AI_AGENT_DELETE_PATH,
    AI_DESTRUCTIVE_PATH,
    AI_DISCONNECT_PATH,
    AI_PAGE_PATH,
    AI_WIDGETS_PATH,
    parseAiUndoBack,
    UNKNOWN_APP_MARKER,
} from "../pages/v2/settings-ai.js";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import { liveSettingsStore } from "../../db/settings.js";
import {
    undoAgentAction,
    type AgentUndoStatus,
} from "../../domain/agent-actions.js";
import { exportAllData } from "../../domain/export.js";
import { checkRateLimit } from "../../rate-limit.js";
import { isValidDisplayTheme } from "../pages/v2/settings-home.js";
import { formText } from "../form.js";
import {
    requireManager,
    requireMember,
    requireAction,
    requireSiteUser,
    siteMember,
} from "../middleware.js";
import {
    canManageHousehold,
    HouseholdAlreadyExistsError,
} from "../../household.js";
import {
    createHouseholdForCaller,
    getHouseholdMembership,
    householdExists,
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
    isHideableNutrient,
    setNutrientHidden,
    timezoneFromProfile,
    upsertProfile,
} from "../../db/profiles.js";
import {
    isSwitchableNutrient,
    NUTRIENTS_PATH,
} from "../pages/v2/settings-nutrients.js";
import {
    UNITS_DRINKS_SHEET_ID,
    UNITS_PATH,
    UNITS_WEIGHT_SHEET_ID,
} from "../pages/v2/settings-units.js";
import { isDrinkUnit } from "../../alcohol.js";
import { isWeightUnit } from "../../domain/units.js";
import {
    clearGoalDays,
    getAllGoalDays,
    getNutritionGoals,
    upsertNutritionGoals,
    type NutritionGoalsInput,
} from "../../db/nutrition.js";
import { isCalendarDate } from "../../domain/insights.js";
import { todayInTz, validateTz } from "../../domain/tz.js";
import {
    GOALS_FORM_FIELDS,
    goalsDraftFrom,
    parseGoalsForm,
    type GoalsFormDraft,
} from "../pages/v2/settings-goals-form.js";
import { getBaseUrl } from "../../url.js";
import { settingsBackHref, settingsUrlWithBack } from "../settings-back.js";
import { APP_PATHS } from "../route-map.js";
import { avatarRoutes } from "./avatars.js";

export const settingsRoutes = new Hono();
settingsRoutes.route("/", avatarRoutes);

function resolveBackHref(c: Context) {
    return settingsBackHref({
        from: c.req.query("from"),
        referer: c.req.header("referer"),
        origin: getBaseUrl(c),
    });
}

settingsRoutes.get("/settings", requireSiteUser, async (c) => {
    const page = await renderSettingsHomeRoute(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/account", requireSiteUser, async (c) => {
    const backHref = resolveBackHref(c);
    const page = await renderSettingsAccountV2Route(c.get("userId"), {
        backHref,
    });
    return c.html(page.html, page.status);
});

// Time zone is a page of its own, with a search field (`?q=`).
settingsRoutes.get(APP_PATHS.settingsTimezone, requireSiteUser, async (c) => {
    const page = await renderSettingsTimezoneV2Route(c.get("userId"), {
        backHref: resolveBackHref(c),
        q: c.req.query("q"),
    });
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/units", requireSiteUser, async (c) => {
    const page = await renderSettingsUnitsV2Route(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.get("/settings/nutrients", requireSiteUser, async (c) => {
    const page = await renderSettingsNutrientsV2Route(c.get("userId"));
    return c.html(page.html, page.status);
});

// Display and Export data are rows on Settings now; their old pages are gone,
// so a bookmark lands there.
settingsRoutes.get("/settings/display", (c) => {
    // toast: none (retired page)
    return c.redirect(APP_PATHS.settings, 301);
});
settingsRoutes.get("/settings/export", (c) => {
    // toast: none (retired page)
    return c.redirect(APP_PATHS.settings, 301);
});

settingsRoutes.get("/settings/goals", requireSiteUser, async (c) => {
    const page = await renderSettingsGoalsV2Route(c.get("userId"));
    return c.html(page.html, page.status);
});

// One goal at a time: the page edits in place and each field posts alone when
// it is left. The new value is validated against the stored goals (so the
// "at least one daily target" rule still holds), and only that column is
// written, so two quick edits to different fields cannot overwrite each other.
settingsRoutes.post("/settings/goals/field", requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const field = formText(body, "field");
    const known = GOALS_FORM_FIELDS.find((f) => f === field);
    const profile = await getProfile(userId);
    const alcohol = alcoholOf(profile);
    // The alcohol field is not on the page with tracking off.
    if (!known || (known === "daily_alcohol_g" && alcohol == null)) {
        return c.text("Unknown goals field.", 400);
    }
    const value = formText(body, "value");
    const stored = await getNutritionGoals(userId);
    const values = {
        ...goalsDraftFrom(stored, alcohol),
        [known]: value,
    } as GoalsFormDraft;
    let parsed = parseGoalsForm(values, { alcohol, stored });
    let judgedAlone = false;
    // A stored value the form's bounds no longer accept (one set through MCP,
    // or rounded into a drink unit) must not block saving another field: judge
    // the posted field alone, with the refused stored ones left out.
    if (!parsed.ok && parsed.invalid && !parsed.invalid.includes(known)) {
        const others = Object.fromEntries(
            parsed.invalid.map((f) => [f, ""]),
        ) as Partial<GoalsFormDraft>;
        const retry = parseGoalsForm(
            { ...values, ...others },
            {
                alcohol,
                stored,
            },
        );
        if (retry.ok) {
            parsed = retry;
            judgedAlone = true;
        }
    }
    if (!parsed.ok) {
        const page = await renderSettingsGoalsV2Route(userId, {
            error: parsed.errors.join(" "),
            draft: values,
            invalid:
                parsed.invalid && parsed.invalid.length > 0
                    ? parsed.invalid
                    : [known],
        });
        // A non-member gets the membership page with its own status.
        return c.html(page.html, page.status === 200 ? 422 : page.status);
    }
    // A save that changes a target is the day those goals were set; a
    // rename alone is not, the same rule set_nutrition_goals follows.
    const input: NutritionGoalsInput = { [known]: parsed.input[known] };
    // Judged alone, the left-out fields read as changed: only this one counts.
    const changesTargets = judgedAlone
        ? known !== "goal_name" &&
          known !== "goal_note" &&
          parsed.input[known] !== (stored?.[known] ?? null)
        : parsed.changesTargets;
    if (changesTargets) {
        input.goals_set_on = todayInTz(timezoneFromProfile(profile) ?? "UTC");
    }
    await upsertNutritionGoals(userId, input);
    // toast: none
    return c.redirect("/settings/goals", 303);
});

settingsRoutes.post("/settings/goals/days/clear", requireMember, async (c) => {
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
    // toast: none
    return c.redirect("/settings/goals", 303);
});

// Clear all goals: the person's own standing targets, goal name and note, and
// every per-day override, in one step (the MCP twin is set_nutrition_goals with
// clear: true and the standing fields null). Only ever the caller's rows: the
// id comes from the session, never the form.
settingsRoutes.post("/settings/goals/clear-all", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const days = await getAllGoalDays(userId);
    await clearGoalDays(
        userId,
        member.householdId,
        days.map((day) => day.date),
    );
    if ((await getNutritionGoals(userId)) != null) {
        await upsertNutritionGoals(userId, {
            daily_calories: null,
            daily_protein_g: null,
            daily_carbs_g: null,
            daily_fat_g: null,
            daily_fiber_g: null,
            daily_sugar_g: null,
            daily_alcohol_g: null,
            daily_caffeine_mg: null,
            daily_water_ml: null,
            target_weight_g: null,
            goal_name: null,
            goal_note: null,
            goals_set_on: null,
        });
    }
    // toast: none
    return c.redirect("/settings/goals", 303);
});

settingsRoutes.get(SCORE_PATH, requireSiteUser, async (c) => {
    const page = await renderSettingsScoreV2Route(c.get("userId"));
    return c.html(page.html, page.status);
});

settingsRoutes.post(SCORE_PATH, requireMember, async (c) => {
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
            await updateMemberScoreSettings(store, member.householdId, userId, {
                choice: null,
            });
            // toast: none
            return c.redirect(SCORE_PATH, 303);
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
            // toast: none — the switch itself shows the new state
            return c.redirect(SCORE_PATH, 303);
        }
        case "choice": {
            const parsed = parseScoreForm(body);
            if (!parsed.ok) {
                return refusedScorePage(c, parsed.error, parsed.draft);
            }
            await updateMemberScoreSettings(store, member.householdId, userId, {
                choice: parsed.choice,
            });
            // toast: none
            return c.redirect(SCORE_PATH, 303);
        }
        default: {
            const page = await renderSettingsScoreV2Route(userId, {
                error: "Choose what to save.",
            });
            return c.html(page.html, 400);
        }
    }
});

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

/**
 * A member who is not an owner or admin is told what they cannot do here, not
 * that they need a membership (requireManager's answer for anyone refused).
 */
const explainManagerOnly = createMiddleware(async (c, next) => {
    const member = c.get("siteMembership");
    if (member != null && !canManageHousehold(member)) {
        return c.html(
            forbiddenDashboardHtml(
                "system",
                "Only an owner or admin can change the household default.",
            ),
            403,
        );
    }
    await next();
});

settingsRoutes.get(
    SCORE_HOUSEHOLD_PATH,
    requireSiteUser,
    explainManagerOnly,
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
    explainManagerOnly,
    requireManager,
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const store = liveScoreSettingsStore();
        const intent = formText(body, "intent");
        if (intent === "clear") {
            await updateHouseholdScoreDefault(store, member.householdId, null);
            // toast: none
            return c.redirect(SCORE_HOUSEHOLD_PATH, 303);
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
        // Back to the editor: the default saves as it changes.
        // toast: none
        return c.redirect(SCORE_HOUSEHOLD_PATH, 303);
    },
);

settingsRoutes.get("/settings/ai-connections", requireSiteUser, async (c) => {
    const page = await renderSettingsAiV2Route(c.get("userId"), {
        mcpUrl: `${getBaseUrl(c)}/mcp`,
    });
    return c.html(page.html, page.status);
});

// The longest id an app can hold: a uuid, or the deploy-wide client id.
const CLIENT_ID_MAX = 200;
// Postgres text cannot hold a NUL, and no app id carries any control
// character, so a value with one is a bad choice rather than a database error.
const CONTROL_CHARACTER = /\p{Cc}/u;

settingsRoutes.post(AI_DISCONNECT_PATH, requireMember, async (c) => {
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
    await revokeConnection(
        userId,
        client === UNKNOWN_APP_MARKER ? null : client,
    );
    // toast: none
    return c.redirect("/settings/ai-connections", 303);
});

// The household switch: only the owner flips it (403 for anyone else). The
// form posts the value the switch should take.
settingsRoutes.post(
    AI_DESTRUCTIVE_PATH,
    requireAction("agents.household_switch"),
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const value = formText(body, "allowed").trim();
        if (value !== "0" && value !== "1") {
            const page = await renderSettingsAiV2Route(c.get("userId"), {
                mcpUrl: `${getBaseUrl(c)}/mcp`,
                error: "Choose Allowed or Off.",
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        const allowed = value === "1";
        await liveSettingsStore().setAgentDestructiveAllowed(
            member.householdId,
            allowed,
        );
        // toast: none — the switch shows the new state
        return c.redirect(AI_PAGE_PATH, 303);
    },
);

// "Your agents can delete": the signed-in member's own switch for the agents
// they connected. The person is the session's, never the form, so a member can
// only ever move their own. It counts only while the household switch is on.
settingsRoutes.post(AI_AGENT_DELETE_PATH, requireMember, async (c) => {
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const value = formText(body, "allowed").trim();
    if (value !== "0" && value !== "1") {
        const page = await renderSettingsAiV2Route(c.get("userId"), {
            mcpUrl: `${getBaseUrl(c)}/mcp`,
            error: "Choose On or Off.",
        });
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
    await liveSettingsStore().setMemberAgentsCanDelete(
        member.householdId,
        member.userId,
        value === "1",
    );
    // toast: none — the switch shows the new state
    return c.redirect(AI_PAGE_PATH, 303);
});

// "Show cards in chat": the member's own switch (profiles.widgets_enabled).
settingsRoutes.post(AI_WIDGETS_PATH, requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const value = formText(body, "enabled").trim();
    if (value !== "0" && value !== "1") {
        const page = await renderSettingsAiV2Route(userId, {
            mcpUrl: `${getBaseUrl(c)}/mcp`,
            error: "Choose On or Off.",
        });
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
    await upsertProfile(userId, { widgets_enabled: value === "1" });
    // toast: none — the switch shows the new state
    return c.redirect(AI_PAGE_PATH, 303);
});

const UNDO_REFUSED_STATUS: Record<
    Exclude<AgentUndoStatus, "undone">,
    400 | 404 | 409
> = {
    not_found: 404,
    already_undone: 409,
    expired: 409,
    not_undoable: 409,
    conflict: 409,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Undo one agent change. Any member may post; the domain lets only the owner
// and the member the agent acted as through. Called at the top level of the
// request, since a conflict rolls its transaction back.
settingsRoutes.post(
    `${AI_PAGE_PATH}/actions/:id/undo`,
    requireMember,
    async (c) => {
        const member = siteMember(c);
        const id = c.req.param("id");
        const body = await c.req.parseBody();
        const back = parseAiUndoBack(formText(body, "back").trim());
        const result = UUID.test(id)
            ? await undoAgentAction(liveAgentActionDeps(), {
                  householdId: member.householdId,
                  userId: member.userId,
                  actionId: id,
                  now: new Date(),
              })
            : ({
                  status: "not_found",
                  message: "That change was not found.",
              } as const);
        if (result.status === "undone") {
            // toast: none
            return c.redirect(back, 303);
        }
        const page = await renderSettingsAiV2Route(member.userId, {
            mcpUrl: `${getBaseUrl(c)}/mcp`,
            error: result.message,
        });
        return c.html(
            page.html,
            page.status === 200
                ? UNDO_REFUSED_STATUS[result.status]
                : page.status,
        );
    },
);

settingsRoutes.get("/settings/saved", requireSiteUser, async (c) => {
    const page = await renderSettingsSavedV2Route(c.get("userId"), {
        q: c.req.query("q"),
    });
    return c.html(page.html, page.status);
});

settingsRoutes.post("/settings/export", requireSiteUser, async (c) => {
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
        const page = await renderSettingsHomeRoute(userId, {
            error: "Nothing to export yet.",
        });
        // A non-member gets the membership page with its own status.
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
    // toast: none
    return c.redirect(result.downloadPath, 303);
});

// Weight and drink units (Settings › Units). Each field is written only when
// the form carries it, and an empty value clears the choice.
settingsRoutes.post(UNITS_PATH, requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const weight = formText(body, "preferred_weight_unit").trim();
    const drink = formText(body, "preferred_drink_unit").trim();
    const hasWeight = "preferred_weight_unit" in body;
    const hasDrink = "preferred_drink_unit" in body;
    if (hasWeight && weight !== "" && !isWeightUnit(weight)) {
        const page = await renderSettingsUnitsV2Route(userId, {
            error: "Choose kg or lb.",
            openSheet: UNITS_WEIGHT_SHEET_ID,
        });
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
    if (hasDrink && drink !== "" && !isDrinkUnit(drink)) {
        const page = await renderSettingsUnitsV2Route(userId, {
            error: "Choose US drinks or UK units.",
            openSheet: UNITS_DRINKS_SHEET_ID,
        });
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
    const prefs = parseNutritionPrefsInput({
        preferred_weight_unit: hasWeight ? weight : undefined,
        preferred_drink_unit: hasDrink ? drink : undefined,
    });
    if (
        prefs.preferred_weight_unit !== undefined ||
        prefs.preferred_drink_unit !== undefined
    ) {
        await upsertProfile(userId, {
            preferred_weight_unit: prefs.preferred_weight_unit,
            preferred_drink_unit: prefs.preferred_drink_unit,
        });
    }
    // toast: none — the row shows the new value
    return c.redirect(UNITS_PATH, 303);
});

// One Nutrients shown switch. Alcohol is its own opt-in; fiber, sugar and
// caffeine are kept in the member's hidden list, edited in place.
settingsRoutes.post(NUTRIENTS_PATH, requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const nutrient = formText(body, "nutrient").trim();
    const shown = formText(body, "shown").trim();
    if (!isSwitchableNutrient(nutrient) || (shown !== "0" && shown !== "1")) {
        const page = await renderSettingsNutrientsV2Route(userId, {
            error: "Choose a nutrient and On or Off.",
        });
        return c.html(page.html, page.status === 200 ? 400 : page.status);
    }
    if (nutrient === "alcohol") {
        await upsertProfile(userId, {
            alcohol_tracking_enabled: shown === "1",
        });
    } else if (isHideableNutrient(nutrient)) {
        await setNutrientHidden(userId, nutrient, shown === "0");
    }
    // toast: none — the switch shows the new state
    return c.redirect(NUTRIENTS_PATH, 303);
});

settingsRoutes.post("/settings/display", requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const themeRaw = formText(body, "theme");
    if (!isValidDisplayTheme(themeRaw)) {
        const page = await renderSettingsHomeRoute(userId, {
            error: "Choose Auto, Light, or Dark.",
        });
        return c.html(page.html, 400);
    }
    const appearance = parseAppearanceInput({
        theme: themeRaw === "system" ? "system" : themeRaw,
    });
    await upsertProfile(userId, appearance);
    // toast: none — Turbo applies the new theme on the page it lands on
    return c.redirect(APP_PATHS.settings, 303);
});

settingsRoutes.get("/settings/help", requireSiteUser, async (c) => {
    const page = await renderSettingsHelpRoute(c.get("userId"));
    return c.html(page.html, page.status);
});

// The old household preferences page is gone; Household in the new app is the
// one place for household settings, so a bookmark lands there.
settingsRoutes.get("/settings/household-settings", async (c) => {
    // toast: none (retired page)
    return c.redirect(APP_PATHS.settingsHousehold, 301);
});

// A checkbox posts nothing when it is off, so "absent" cannot tell Off from
// "this form has no such field". A form that has the checkbox says so with a
// hidden `has_<name>` marker; without the marker or the value the field is
// left out of the patch, and the stored choice survives a partial save.
function carriedCheckbox(
    body: Parameters<typeof formText>[0],
    name: string,
): boolean | undefined {
    if (!(name in body) && !(`has_${name}` in body)) return undefined;
    return formText(body, name) === "true";
}

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
    // The Account name sheet and the time zone page post here and come back
    // to Account; only that exact path is honoured, anything else goes to
    // Settings as before.
    const redirectTo =
        formText(body, "return") === APP_PATHS.settingsAccount
            ? APP_PATHS.settingsAccount
            : settingsUrlWithBack(backHref);
    const group = formText(body, "group");
    if (group === "nutrition") {
        const prefs = parseNutritionPrefsInput({
            timezone: body.timezone,
            preferred_weight_unit: body.preferred_weight_unit,
            widgets_enabled: carriedCheckbox(body, "widgets_enabled"),
            alcohol_tracking_enabled: carriedCheckbox(
                body,
                "alcohol_tracking_enabled",
            ),
            preferred_drink_unit: body.preferred_drink_unit,
        });
        if (prefs.timezone) {
            if (!validateTz(prefs.timezone)) {
                const page = await renderSettingsTimezoneV2Route(userId, {
                    backHref,
                    error: "Choose a time zone from the list.",
                });
                return c.html(
                    page.html,
                    page.status === 200 ? 400 : page.status,
                );
            }
        } else {
            delete prefs.timezone;
        }
        await upsertProfile(userId, prefs);
        // toast: none
        return c.redirect(redirectTo, 303);
    }
    if ("theme" in body) {
        const appearance = parseAppearanceInput({ theme: body.theme });
        await upsertProfile(userId, appearance);
    }
    const displayName = formText(body, "display_name").trim();
    if (displayName) {
        await updateMemberDisplayName(member.householdId, userId, displayName);
    }
    // toast: none
    return c.redirect(redirectTo, 303);
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
    // toast: none
    return c.redirect("/", 303);
});
