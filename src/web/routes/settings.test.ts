import {
    afterAll,
    afterEach,
    describe,
    expect,
    mock,
    setSystemTime,
    test,
} from "bun:test";
import { Hono } from "hono";
import {
    createMemoryExportArchiveStore,
    type ExportArchiveStore,
} from "../../db/exports.js";
import type {
    Meal,
    NutritionGoals,
    NutritionGoalsInput,
} from "../../db/nutrition.js";
import type { GoalDayOverride } from "../../domain/insights.js";
import * as actualNutrition from "../../db/nutrition.js";
import * as actualExports from "../../db/exports.js";
import { createExportsRouter } from "../../exports-route.js";
import { verifyExportToken } from "../../domain/export-link.js";
import { _resetBuckets } from "../../rate-limit.js";
import {
    resetSessionSecretWarningForTest,
    resolveSessionSigningSecret,
} from "../../site-session.js";
import { resetFlagsForTests } from "../../flags.js";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";

const ALICE = "11111111-1111-4111-8111-111111111111";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realNutrition = { ...actualNutrition };
const realExports = { ...actualExports };

const EXPORT_MEAL: Meal = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: ALICE,
    logged_at: "2026-06-20T14:30:00.000Z",
    meal_type: "lunch",
    description: "Test meal",
    calories: 400,
    protein_g: 30,
    carbs_g: 20,
    fat_g: 10,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    caffeine_mg: null,
    notes: null,
    idempotency_key: null,
};

let exportArchiveStore = createMemoryExportArchiveStore();

const exportArchiveProxy: ExportArchiveStore = {
    put(userId, archive, ttlSeconds) {
        return exportArchiveStore.put(userId, archive, ttlSeconds);
    },
    read(userId) {
        return exportArchiveStore.read(userId);
    },
    sweepExpired() {
        return exportArchiveStore.sweepExpired();
    },
    remove(userId) {
        return exportArchiveStore.remove(userId);
    },
};

const member: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

let profileTheme: string | null = "light";
let profileTimezone = "UTC";
let alcoholTracking = false;
let drinkUnit: "us" | "uk" = "us";
let upsertPatch: Record<string, unknown> | undefined;

const BOB = "22222222-2222-4222-8222-222222222222";

// In-memory goals and per-day overrides behind the db stub. clearGoalDays
// filters on the user and household it is handed, as the SQL does, so a test
// can tell whose rows a request reached.
const STORED_GOALS: NutritionGoals = {
    user_id: ALICE,
    daily_calories: 2200,
    daily_protein_g: 140,
    daily_carbs_g: 200,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 50,
    daily_alcohol_g: 14,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: null,
    goal_name: "Recomp",
    goal_note: null,
    goals_set_on: "2026-10-02",
    updated_at: "2026-10-02T00:00:00.000Z",
};
let goalsState: NutritionGoals | null = null;
let goalDaysState: (GoalDayOverride & { household_id: string })[] = [];
let goalUpserts: NutritionGoalsInput[] = [];
let goalClears: { userId: string; householdId: string; dates: string[] }[] = [];

function goalDay(
    userId: string,
    date: string,
    over: Partial<GoalDayOverride> = {},
): GoalDayOverride & { household_id: string } {
    return {
        user_id: userId,
        household_id: "hh-1",
        date,
        daily_calories: 1800,
        daily_protein_g: null,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_fiber_g: null,
        daily_sugar_g: null,
        daily_alcohol_g: null,
        daily_caffeine_mg: null,
        daily_water_ml: null,
        updated_at: "2026-11-01T00:00:00.000Z",
        ...over,
    };
}

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns a household stub in this file
mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE ? member : null,
    householdExists: async () => true,
    listHouseholdMembers: async () => [member],
    getHousehold: async () => ({ id: "hh-1", name: "Test" }),
    updateMemberDisplayName: async () => undefined,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns a profiles stub in this file
mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async () => ({
        user_id: ALICE,
        timezone: profileTimezone,
        preferred_weight_unit: "kg",
        widgets_enabled: true,
        alcohol_tracking_enabled: false,
        preferred_drink_unit: null,
        theme: profileTheme,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    }),
    upsertProfile: async (_userId: string, patch: Record<string, unknown>) => {
        upsertPatch = patch;
        if (patch.theme !== undefined) {
            profileTheme = patch.theme as string | null;
        }
    },
    alcoholTrackingEnabledFromProfile: () => alcoholTracking,
    preferredDrinkUnitFromProfile: () => (alcoholTracking ? drinkUnit : null),
    preferredWeightUnitFromProfile: () => "kg" as const,
    widgetsEnabledFromProfile: () => true,
}));

import * as actualAttention from "../attention.js";

const realAttention = { ...actualAttention };

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- settings export route test
mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    getAllMeals: async (userId: string) =>
        userId === ALICE ? [EXPORT_MEAL] : [],
    getAllMealItems: async () => [],
    getAllWater: async () => [],
    getAllWeight: async () => [],
    getNutritionGoals: async () => goalsState,
    getAllGoalDays: async (userId: string) =>
        goalDaysState
            .filter((d) => d.user_id === userId)
            .sort((a, b) => a.date.localeCompare(b.date)),
    getGoalsForDate: async () => goalsState,
    upsertNutritionGoals: async (
        userId: string,
        input: NutritionGoalsInput,
    ) => {
        goalUpserts.push(input);
        const defined = Object.fromEntries(
            Object.entries(input).filter(([, v]) => v !== undefined),
        );
        goalsState = {
            ...(goalsState ?? {
                ...STORED_GOALS,
                user_id: userId,
                goal_name: null,
                goals_set_on: null,
            }),
            ...defined,
        } as NutritionGoals;
        return goalsState;
    },
    clearGoalDays: async (
        userId: string,
        householdId: string,
        dates: string[],
    ) => {
        goalClears.push({ userId, householdId, dates });
        const before = goalDaysState.length;
        goalDaysState = goalDaysState.filter(
            (d) =>
                !(
                    d.user_id === userId &&
                    d.household_id === householdId &&
                    dates.includes(d.date)
                ),
        );
        return before - goalDaysState.length;
    },
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- settings export route test
mock.module("../../db/exports.js", () => ({
    ...realExports,
    liveExportArchiveStore: () => exportArchiveStore,
}));

mock.module("../attention.js", () => ({
    ...realAttention,
    viewerChromeWithAttention: async (
        profile: { theme?: string | null } | null,
        viewer: HouseholdMember,
    ) => {
        const flags = await realAttention.viewerFlagsFor(viewer);
        return {
            theme:
                profile?.theme === "light" || profile?.theme === "dark"
                    ? profile.theme
                    : "light",
            flags,
            identity: {
                viewerName: viewer.displayName,
                viewerRole: viewer.role,
                householdName: "Test household",
                memberCount: 1,
            },
        };
    },
}));

const { settingsRoutes } = await import("./settings.js");

afterAll(() => {
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the household stub window
    mock.module("../../db/household.js", () => realHousehold);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the profiles stub window
    mock.module("../../db/profiles.js", () => realProfiles);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the nutrition stub window
    mock.module("../../db/nutrition.js", () => realNutrition);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the exports stub window
    mock.module("../../db/exports.js", () => realExports);
    mock.module("../attention.js", () => realAttention);
});

afterEach(() => {
    resetFlagsForTests();
    upsertPatch = undefined;
    profileTheme = "light";
    profileTimezone = "UTC";
    alcoholTracking = false;
    drinkUnit = "us";
    goalsState = null;
    goalDaysState = [];
    goalUpserts = [];
    goalClears = [];
    setSystemTime();
    exportArchiveStore = createMemoryExportArchiveStore();
    _resetBuckets();
});

const hono = new Hono();
hono.route("/", settingsRoutes);
hono.route("/", createExportsRouter(exportArchiveProxy));

let prevExportSessionSecret: string | undefined;

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("settings routes", () => {
    test("GET /settings serves home", async () => {
        const res = await hono.request("http://test/settings", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('data-fd-settings-page="home"');
    });

    test("GET /settings/help serves v2 help when flag on", async () => {
        const res = await hono.request("http://test/settings/help", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('data-fd-settings-page="help"');
    });

    test("POST /settings/display saves theme and redirects", async () => {
        const body = new URLSearchParams({ theme: "dark" });
        const res = await hono.request("http://test/settings/display", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/display");
        expect(upsertPatch).toEqual({ theme: "dark" });
    });

    test("POST /settings/display from Settings home returns there", async () => {
        for (const [ret, want] of [
            ["/settings", "/settings"],
            ["https://evil.example/", "/settings/display"],
            ["/settings/../x", "/settings/display"],
        ] as const) {
            const res = await hono.request("http://test/settings/display", {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ theme: "light", return: ret }),
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(want);
        }
    });

    test("POST /settings/display invalid theme re-renders 400", async () => {
        const body = new URLSearchParams({ theme: "sepia" });
        const res = await hono.request("http://test/settings/display", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Choose Auto, Light, or Dark.");
    });

    test("POST /settings group=account without theme leaves stored theme", async () => {
        profileTheme = "dark";
        const body = new URLSearchParams({
            group: "account",
            display_name: "Alice Renamed",
        });
        const res = await hono.request("http://test/settings", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        expect(res.status).toBe(303);
        expect(profileTheme).toBe("dark");
        expect(upsertPatch?.theme).toBeUndefined();
    });

    test("POST /settings group=account with theme saves theme (legacy form)", async () => {
        profileTheme = "dark";
        const body = new URLSearchParams({
            group: "account",
            theme: "light",
            display_name: "Alice",
        });
        const res = await hono.request("http://test/settings", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        expect(res.status).toBe(303);
        expect(profileTheme).toBe("light");
        expect(upsertPatch).toEqual({ theme: "light" });
    });

    test("POST /settings/export redirects to signed archive", async () => {
        prevExportSessionSecret = process.env.SESSION_SECRET;
        process.env.SESSION_SECRET = "settings-export-test-secret-32chars!!";
        resetSessionSecretWarningForTest();
        const res = await hono.request("http://test/settings/export", {
            method: "POST",
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(303);
        const location = res.headers.get("location");
        expect(location).toMatch(/^\/exports\/e1\./);
        const token = location!.slice("/exports/".length);
        expect(
            verifyExportToken(token, Date.now(), resolveSessionSigningSecret()),
        ).toBe(ALICE);
        const zipRes = await hono.request(`http://test${location}`);
        expect(zipRes.status).toBe(200);
        expect(zipRes.headers.get("Content-Type")).toBe("application/zip");
        const body = new Uint8Array(await zipRes.arrayBuffer());
        expect(body.byteLength).toBeGreaterThan(0);
        if (prevExportSessionSecret === undefined) {
            delete process.env.SESSION_SECRET;
        } else {
            process.env.SESSION_SECRET = prevExportSessionSecret;
        }
        resetSessionSecretWarningForTest();
    });

    test("POST /settings/export bad PUBLIC_ORIGIN redirects without throw", async () => {
        prevExportSessionSecret = process.env.SESSION_SECRET;
        process.env.SESSION_SECRET = "settings-export-test-secret-32chars!!";
        resetSessionSecretWarningForTest();
        const prevOrigin = process.env.PUBLIC_ORIGIN;
        process.env.PUBLIC_ORIGIN = "not-a-url";
        const res = await hono.request("http://test/settings/export", {
            method: "POST",
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(303);
        const location = res.headers.get("location");
        expect(location).toMatch(/^\/exports\/e1\./);
        if (prevOrigin === undefined) {
            delete process.env.PUBLIC_ORIGIN;
        } else {
            process.env.PUBLIC_ORIGIN = prevOrigin;
        }
        if (prevExportSessionSecret === undefined) {
            delete process.env.SESSION_SECRET;
        } else {
            process.env.SESSION_SECRET = prevExportSessionSecret;
        }
        resetSessionSecretWarningForTest();
    });

    test("GET /settings/export page renders", async () => {
        const res = await hono.request("http://test/settings/export", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('data-fd-settings-page="export"');
    });
});

const FORM_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
};

function postField(field: string, value: string) {
    return hono.request("http://test/settings/goals/field", {
        method: "POST",
        headers: { cookie: cookie(ALICE), ...FORM_HEADERS },
        body: new URLSearchParams({ field, value }),
    });
}

function postClearDay(fields: Record<string, string>) {
    return hono.request("http://test/settings/goals/days/clear", {
        method: "POST",
        headers: { cookie: cookie(ALICE), ...FORM_HEADERS },
        body: new URLSearchParams(fields),
    });
}

/** The `value` input of one goal's form in a rendered page. */
function fieldInput(html: string, field: string): string {
    const form = html.match(
        new RegExp(
            `<form[^>]*data-fd-autosave[^>]*><input type="hidden" name="field" value="${field}" />[\\s\\S]*?</form>`,
        ),
    );
    expect(form).not.toBeNull();
    return form![0].match(/<input[^>]*name="value"[^>]*>/)![0];
}

describe("settings goals field routes", () => {
    test("GET shows the standing goals in their fields and the days with their own", async () => {
        goalsState = STORED_GOALS;
        setSystemTime(new Date("2026-11-12T12:00:00Z"));
        goalDaysState = [
            goalDay(ALICE, "2026-11-10", { daily_calories: 1111 }),
            goalDay(ALICE, "2026-11-14", { daily_calories: 1800 }),
            goalDay(BOB, "2026-11-15", { daily_calories: 1999 }),
        ];
        const res = await hono.request("http://test/settings/goals", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(fieldInput(html, "daily_calories")).toContain('value="2200"');
        // No Edit sheet: the numbers are the fields.
        expect(html).not.toContain("Edit goals");
        expect(html).not.toContain("fd-goals-edit");
        expect(html).toContain("Since Oct 2");
        // The per-day list stays, with Clear.
        expect(html).toContain("Sat, Nov 14");
        expect(html).toContain("Clear day");
        // Past days and other members' days are not listed.
        expect(html).not.toContain("Tue, Nov 10");
        expect(html).not.toContain("1999");
    });

    test("POST /settings/goals/field daily_protein_g 180 answers 303 and keeps the other fields", async () => {
        goalsState = STORED_GOALS;
        setSystemTime(new Date("2026-11-14T12:00:00Z"));
        const res = await postField("daily_protein_g", "180");
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/goals");
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
        expect(goalsState).toMatchObject({
            ...STORED_GOALS,
            daily_protein_g: 180,
            // A changed target is the day the goals were set.
            goals_set_on: "2026-11-14",
            updated_at: STORED_GOALS.updated_at,
        });
        // Only that column is written, so a concurrent edit to another field
        // cannot be overwritten with a stale copy.
        expect(Object.keys(goalUpserts[0]!).sort()).toEqual([
            "daily_protein_g",
            "goals_set_on",
        ]);
    });

    test("a changed target stamps today in the member's timezone", async () => {
        profileTimezone = "Pacific/Auckland";
        goalsState = STORED_GOALS;
        // 20:00 UTC on the 12th is already the 13th in Auckland.
        setSystemTime(new Date("2026-11-12T20:00:00Z"));
        const res = await postField("daily_calories", "2100");
        expect(res.status).toBe(303);
        expect(goalUpserts).toEqual([
            { daily_calories: 2100, goals_set_on: "2026-11-13" },
        ]);
    });

    test("the first goal on an empty account is a target", async () => {
        setSystemTime(new Date("2026-11-12T12:00:00Z"));
        const res = await postField("daily_calories", "2000");
        expect(res.status).toBe(303);
        expect(goalUpserts).toEqual([
            { daily_calories: 2000, goals_set_on: "2026-11-12" },
        ]);
    });

    test("a name or note alone leaves the set day alone", async () => {
        goalsState = STORED_GOALS;
        let res = await postField("goal_name", "Maintain");
        expect(res.status).toBe(303);
        res = await postField("goal_note", "");
        expect(res.status).toBe(303);
        expect(goalUpserts).toEqual([
            { goal_name: "Maintain" },
            { goal_note: null },
        ]);
        expect(goalsState!.goals_set_on).toBe("2026-10-02");
    });

    test("a value the field already holds does not re-stamp the day", async () => {
        goalsState = STORED_GOALS;
        const res = await postField("daily_protein_g", "140");
        expect(res.status).toBe(303);
        expect(goalUpserts[0]!.goals_set_on).toBeUndefined();
    });

    test("alcohol is typed in the member's drink unit", async () => {
        alcoholTracking = true;
        drinkUnit = "uk";
        goalsState = STORED_GOALS;
        const res = await postField("daily_alcohol_g", "2");
        expect(res.status).toBe(303);
        // 2 UK units of 7.893 g.
        expect(goalUpserts[0]!.daily_alcohol_g).toBe(15.79);
    });

    test("an untouched UK alcohol limit does not rewrite it or re-stamp the day", async () => {
        alcoholTracking = true;
        drinkUnit = "uk";
        // 10 g is 1.27 units: the field shows 1.27, and sends it back as is.
        goalsState = { ...STORED_GOALS, daily_alcohol_g: 10 };
        const res = await postField("daily_alcohol_g", "1.27");
        expect(res.status).toBe(303);
        expect(goalUpserts[0]!.daily_alcohol_g).toBe(10);
        expect(goalUpserts[0]!.goals_set_on).toBeUndefined();
    });

    test("alcohol with tracking off is not a field", async () => {
        goalsState = STORED_GOALS;
        const res = await postField("daily_alcohol_g", "1");
        expect(res.status).toBe(400);
        expect(goalUpserts).toHaveLength(0);
        expect(goalsState!.daily_alcohol_g).toBe(14);
    });

    test("a decimal calorie count the store rounded does not re-stamp the day", async () => {
        goalsState = { ...STORED_GOALS, daily_calories: 1801 };
        const res = await postField("daily_calories", "1800.5");
        expect(res.status).toBe(303);
        expect(goalUpserts[0]!.goals_set_on).toBeUndefined();
    });

    test("an unknown field answers 400 and writes nothing", async () => {
        goalsState = STORED_GOALS;
        for (const field of ["", "target_weight_g", "user_id", "__proto__"]) {
            const res = await postField(field, "1");
            expect(res.status).toBe(400);
        }
        expect(goalUpserts).toHaveLength(0);
    });

    test("an out-of-bounds value answers 422 with the error on that field and the stored value unchanged", async () => {
        goalsState = STORED_GOALS;
        const res = await postField("daily_calories", "99999");
        expect(res.status).toBe(422);
        const html = await res.text();
        const calories = fieldInput(html, "daily_calories");
        expect(calories).toContain('value="99999"');
        expect(calories).toContain('aria-invalid="true"');
        expect(html).toContain("Calories must be at most 20000.");
        expect(html.split("fd-settings-goals-field__error")).toHaveLength(2);
        // Every other field still shows what is stored.
        expect(fieldInput(html, "daily_protein_g")).toContain('value="140"');
        expect(goalUpserts).toHaveLength(0);
        expect(goalsState!.daily_calories).toBe(2200);
    });

    test("a name over the limit answers 422 on the name field", async () => {
        goalsState = STORED_GOALS;
        const res = await postField("goal_name", "x".repeat(41));
        expect(res.status).toBe(422);
        expect(await res.text()).toContain(
            "Goal name must be at most 40 characters.",
        );
        expect(goalUpserts).toHaveLength(0);
    });

    test('"Calories 0" alone is refused: a floor of 0 is not a target', async () => {
        const res = await postField("daily_calories", "0");
        expect(res.status).toBe(422);
        expect(await res.text()).toContain("Set at least one daily target.");
        expect(goalUpserts).toHaveLength(0);
    });

    test("a name with no target at all is refused, so no all-blank row is made", async () => {
        const res = await postField("goal_name", "Only a name");
        expect(res.status).toBe(422);
        expect(await res.text()).toContain("Set at least one daily target.");
        expect(goalUpserts).toHaveLength(0);
        expect(goalsState).toBeNull();
    });

    test("clearing the last target is refused", async () => {
        goalsState = {
            ...STORED_GOALS,
            daily_protein_g: null,
            daily_carbs_g: null,
            daily_fat_g: null,
            daily_fiber_g: null,
            daily_sugar_g: null,
            daily_alcohol_g: null,
            daily_caffeine_mg: null,
            daily_water_ml: null,
        };
        const res = await postField("daily_calories", "");
        expect(res.status).toBe(422);
        expect(goalUpserts).toHaveLength(0);
        expect(goalsState!.daily_calories).toBe(2200);
    });

    test("the old whole-form POST is gone", async () => {
        const res = await hono.request("http://test/settings/goals", {
            method: "POST",
            headers: { cookie: cookie(ALICE), ...FORM_HEADERS },
            body: new URLSearchParams({ daily_calories: "2000" }),
        });
        expect(res.status).toBe(404);
    });

    test("POST clear removes that one day and no other", async () => {
        goalDaysState = [
            goalDay(ALICE, "2026-11-14"),
            goalDay(ALICE, "2026-11-15"),
        ];
        const res = await postClearDay({ date: "2026-11-14" });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/goals");
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
        expect(goalClears).toEqual([
            { userId: ALICE, householdId: "hh-1", dates: ["2026-11-14"] },
        ]);
        expect(goalDaysState.map((d) => d.date)).toEqual(["2026-11-15"]);
    });

    test("POST clear cannot reach another member's override", async () => {
        goalDaysState = [goalDay(BOB, "2026-11-14")];
        // A user_id in the body is ignored: the day is cleared for the caller.
        const res = await postClearDay({ date: "2026-11-14", user_id: BOB });
        expect(res.status).toBe(303);
        expect(goalClears).toEqual([
            { userId: ALICE, householdId: "hh-1", dates: ["2026-11-14"] },
        ]);
        expect(goalDaysState.map((d) => d.user_id)).toEqual([BOB]);
    });

    test("POST clear with a bad date re-renders 400 and clears nothing", async () => {
        for (const date of ["", "2026-02-31", "tomorrow"]) {
            const res = await postClearDay({ date });
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Choose a valid day.");
        }
        expect(goalClears).toHaveLength(0);
    });
});
