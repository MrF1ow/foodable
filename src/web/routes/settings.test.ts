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
            attention: { count: 0, tabs: {} },
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

function postGoals(fields: Record<string, string>) {
    return hono.request("http://test/settings/goals", {
        method: "POST",
        headers: { cookie: cookie(ALICE), ...FORM_HEADERS },
        body: new URLSearchParams(fields),
    });
}

function postClearDay(fields: Record<string, string>) {
    return hono.request("http://test/settings/goals/days/clear", {
        method: "POST",
        headers: { cookie: cookie(ALICE), ...FORM_HEADERS },
        body: new URLSearchParams(fields),
    });
}

const FULL_FORM = {
    goal_name: "Cut",
    goal_note: "until spring",
    daily_calories: "2100",
    daily_protein_g: "150.5",
    daily_carbs_g: "180",
    daily_fat_g: "60",
    daily_water_ml: "3000",
    daily_fiber_g: "35",
    daily_sugar_g: "40",
    // Typed in drinks (US): 0.5 of a 14 g drink.
    daily_alcohol_g: "0.5",
    daily_caffeine_mg: "300",
};

describe("settings goals form routes", () => {
    test("GET shows the standing goals in the form and the days with their own", async () => {
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
        expect(html).toContain(
            'name="daily_calories" type="text" inputmode="decimal" value="2200"',
        );
        // The sheet starts closed: the page reads like the design's cards.
        expect(html).not.toContain("data-sheet-open-on-load");
        expect(html).toContain("Edit goals");
        expect(html).toContain("Since Oct 2");
        expect(html).toContain("Sat, Nov 14");
        // Past days and other members' days are not listed.
        expect(html).not.toContain("Tue, Nov 10");
        expect(html).not.toContain("1999");
    });

    test("POST saves every field and stamps today in the member's timezone", async () => {
        alcoholTracking = true;
        profileTimezone = "Pacific/Auckland";
        // 20:00 UTC on the 12th is already the 13th in Auckland.
        setSystemTime(new Date("2026-11-12T20:00:00Z"));
        const res = await postGoals(FULL_FORM);
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/goals");
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
        expect(goalUpserts).toEqual([
            {
                goal_name: "Cut",
                goal_note: "until spring",
                daily_calories: 2100,
                daily_protein_g: 150.5,
                daily_carbs_g: 180,
                daily_fat_g: 60,
                daily_water_ml: 3000,
                daily_fiber_g: 35,
                daily_sugar_g: 40,
                daily_alcohol_g: 7,
                daily_caffeine_mg: 300,
                goals_set_on: "2026-11-13",
            },
        ]);
    });

    test("POST with only the name or note changed leaves the set day alone", async () => {
        alcoholTracking = true;
        goalsState = STORED_GOALS;
        const res = await postGoals({
            goal_name: "Maintain",
            goal_note: "",
            daily_calories: "2200",
            daily_protein_g: "140",
            daily_carbs_g: "200",
            daily_fat_g: "70",
            daily_water_ml: "2500",
            daily_fiber_g: "30",
            daily_sugar_g: "50",
            daily_alcohol_g: "1",
            daily_caffeine_mg: "400",
        });
        expect(res.status).toBe(303);
        expect(goalUpserts).toHaveLength(1);
        expect(goalUpserts[0]!.goal_name).toBe("Maintain");
        expect(goalUpserts[0]!.goal_note).toBeNull();
        expect(goalUpserts[0]!.goals_set_on).toBeUndefined();
        expect(goalsState!.goals_set_on).toBe("2026-10-02");
    });

    test("POST with alcohol tracking off keeps the stored alcohol limit", async () => {
        goalsState = STORED_GOALS;
        const { daily_alcohol_g: _skip, ...noAlcohol } = FULL_FORM;
        const res = await postGoals(noAlcohol);
        expect(res.status).toBe(303);
        expect("daily_alcohol_g" in goalUpserts[0]!).toBe(false);
        expect(goalsState!.daily_alcohol_g).toBe(14);
    });

    test("POST takes the alcohol limit in the member's drink unit", async () => {
        alcoholTracking = true;
        drinkUnit = "uk";
        const res = await postGoals({ ...FULL_FORM, daily_alcohol_g: "2" });
        expect(res.status).toBe(303);
        // 2 UK units of 7.893 g.
        expect(goalUpserts[0]!.daily_alcohol_g).toBe(15.79);
    });

    test("GET shows the alcohol limit in drinks on the form", async () => {
        alcoholTracking = true;
        goalsState = { ...STORED_GOALS, daily_alcohol_g: 28 };
        const res = await hono.request("http://test/settings/goals", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await res.text();
        expect(html).toContain(
            'name="daily_alcohol_g" type="text" inputmode="decimal" value="2"',
        );
        expect(html).toContain("(US drinks)");
        expect(html).toContain("<dd>2 US drinks</dd>");
        expect(html).not.toContain("28 g");
    });

    test("POST an untouched UK alcohol limit does not rewrite it or re-stamp the day", async () => {
        alcoholTracking = true;
        drinkUnit = "uk";
        // 10 g is 1.27 units: the form shows 1.27, and sends it back as is.
        goalsState = { ...STORED_GOALS, daily_alcohol_g: 10 };
        const res = await postGoals({
            goal_name: "Recomp",
            goal_note: "",
            daily_calories: "2200",
            daily_protein_g: "140",
            daily_carbs_g: "200",
            daily_fat_g: "70",
            daily_water_ml: "2500",
            daily_fiber_g: "30",
            daily_sugar_g: "50",
            daily_alcohol_g: "1.27",
            daily_caffeine_mg: "400",
        });
        expect(res.status).toBe(303);
        expect(goalUpserts[0]!.daily_alcohol_g).toBe(10);
        expect(goalUpserts[0]!.goals_set_on).toBeUndefined();
    });

    test("POST a decimal calorie count the store rounded does not re-stamp the day", async () => {
        goalsState = { ...STORED_GOALS, daily_calories: 1801 };
        const res = await postGoals({
            goal_name: "Recomp",
            goal_note: "",
            daily_calories: "1800.5",
            daily_protein_g: "140",
            daily_carbs_g: "200",
            daily_fat_g: "70",
            daily_water_ml: "2500",
            daily_fiber_g: "30",
            daily_sugar_g: "50",
            daily_caffeine_mg: "400",
        });
        expect(res.status).toBe(303);
        expect(goalUpserts[0]!.goals_set_on).toBeUndefined();
    });

    test('POST "Calories 0" alone is refused: a floor of 0 is not a target', async () => {
        const res = await postGoals({ goal_name: "x", daily_calories: "0" });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Set at least one daily target.");
        expect(goalUpserts).toHaveLength(0);
    });

    test("a refused save re-renders with the sheet open on load, errors and draft kept", async () => {
        const res = await postGoals({ ...FULL_FORM, daily_calories: "99999" });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toMatch(
            /<dialog[^>]*id="fd-goals-edit"[^>]*data-sheet-open-on-load/,
        );
        // The error sits inside the sheet, not under the page header.
        const sheetHtml = html.slice(html.indexOf('id="fd-goals-edit"'));
        expect(sheetHtml).toContain("Calories must be at most 20000.");
        expect(html.slice(0, html.indexOf('id="fd-goals-edit"'))).not.toContain(
            "Calories must be at most 20000.",
        );
        expect(html).toContain('value="99999"');
    });

    test("POST out-of-bounds values re-render 400 with the typed values and errors", async () => {
        const res = await postGoals({
            ...FULL_FORM,
            daily_calories: "99999",
            goal_name: "x".repeat(41),
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Goal name must be at most 40 characters.");
        expect(html).toContain("Calories must be at most 20000.");
        expect(html).toContain('value="99999"');
        expect(html).toContain(`value="${"x".repeat(41)}"`);
        expect(html).toContain('value="150.5"');
        expect(goalUpserts).toHaveLength(0);
    });

    test("POST with no target at all is refused, so no all-blank row is made", async () => {
        const res = await postGoals({ goal_name: "Only a name" });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Set at least one daily target.");
        expect(goalUpserts).toHaveLength(0);
        expect(goalsState).toBeNull();
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
