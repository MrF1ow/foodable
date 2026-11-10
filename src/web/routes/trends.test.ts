import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualNutrition from "../../db/nutrition.js";
import * as actualAttention from "../attention.js";
import { trendsRoutes } from "./trends.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realNutrition = { ...actualNutrition };
const realAttention = { ...actualAttention };

const ALICE = "11111111-1111-4111-8111-111111111111";

const member: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns a household stub in this file
mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE ? member : null,
    householdExists: async () => true,
    listHouseholdMembers: async () => [member],
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
        theme: "light",
        nutrition_layout: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    }),
    alcoholTrackingEnabledFromProfile: () => false,
    preferredDrinkUnitFromProfile: () => null,
    preferredWeightUnitFromProfile: () => "kg" as const,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns a nutrition stub in this file
mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    getMealsInRange: async () => [],
    getWaterInRange: async () => [],
    getWeightInRange: async () => [],
    getGoalsForRange: async () => ({
        defaults: null,
        forDate: () => null,
    }),
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

afterAll(() => {
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the household stub window
    mock.module("../../db/household.js", () => realHousehold);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the profiles stub window
    mock.module("../../db/profiles.js", () => realProfiles);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the nutrition stub window
    mock.module("../../db/nutrition.js", () => realNutrition);
    mock.module("../attention.js", () => realAttention);
});

afterEach(() => {
    resetFlagsForTests();
});

const hono = new Hono();
hono.route("/", trendsRoutes);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("GET /trends", () => {
    test("404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await hono.request("http://test/trends", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("renders v2 trends page when ui-v2 is on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await hono.request("http://test/trends", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("fd-trends-page");
        expect(html).toContain('href="/trends"');
    });
});
