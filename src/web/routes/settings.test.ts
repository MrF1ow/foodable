import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryExportArchiveStore,
    type ExportArchiveStore,
} from "../../db/exports.js";
import type { Meal } from "../../db/nutrition.js";
import * as actualNutrition from "../../db/nutrition.js";
import * as actualExports from "../../db/exports.js";
import { createExportsRouter } from "../../exports-route.js";
import { verifyExportToken } from "../../domain/export-link.js";
import { _resetBuckets } from "../../rate-limit.js";
import {
    resetSessionSecretWarningForTest,
    resolveSessionSigningSecret,
} from "../../site-session.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
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
let upsertPatch: Record<string, unknown> | undefined;

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
        timezone: "UTC",
        preferred_weight_unit: "kg",
        widgets_enabled: true,
        alcohol_tracking_enabled: false,
        preferred_drink_unit: null,
        theme: profileTheme,
        nutrition_layout: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    }),
    upsertProfile: async (_userId: string, patch: Record<string, unknown>) => {
        upsertPatch = patch;
        if (patch.theme !== undefined) {
            profileTheme = patch.theme as string | null;
        }
    },
    alcoholTrackingEnabledFromProfile: () => false,
    preferredDrinkUnitFromProfile: () => null,
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
    getNutritionGoals: async () => null,
    getAllGoalDays: async () => [],
    getGoalsForDate: async () => null,
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
            ...(flags.uiV2
                ? {
                      identity: {
                          viewerName: viewer.displayName,
                          viewerRole: viewer.role,
                          householdName: "Test household",
                          memberCount: 1,
                      },
                  }
                : {}),
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

describe("settings routes ui-v2", () => {
    test("GET /settings serves home when ui-v2 is on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await hono.request("http://test/settings", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('data-fd-settings-page="home"');
    });

    test("GET /settings serves legacy account when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await hono.request("http://test/settings", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<nav class="subnav"');
        expect(html).not.toContain('data-fd-settings-page="home"');
    });

    test("GET /settings/help serves v2 help when flag on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await hono.request("http://test/settings/help", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('data-fd-settings-page="help"');
    });

    test("POST /settings/display saves theme and redirects", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
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

    test("GET /settings/account is not found when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await hono.request("http://test/settings/account", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("POST /settings/export redirects to signed archive when ui-v2 on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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

    test("POST /settings/export is not found when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await hono.request("http://test/settings/export", {
            method: "POST",
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("GET /settings/export page renders when ui-v2 on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await hono.request("http://test/settings/export", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('data-fd-settings-page="export"');
    });
});
