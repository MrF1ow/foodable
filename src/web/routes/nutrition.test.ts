import { afterAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualLoadersToday from "../loaders-today.js";
import * as actualLoadersPlan from "../loaders-plan.js";
import { buildWeekPlanView } from "../pages/v2/recipes-plan.js";
import * as actualAttention from "../attention.js";
import { nutritionRoutes } from "./nutrition.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { buildPreviewTodayView } from "../pages/v2/today.js";
import {
    annotateWeekDays,
    sundayWeekStart,
    weekDates,
} from "../../domain/today.js";
import { shiftLocalDate } from "../../domain/tz.js";
import { renderDashboardPage } from "../loaders.js";
import * as actualDashboardData from "../../dashboard-data.js";
import * as actualNutrition from "../../db/nutrition.js";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realLoadersToday = { ...actualLoadersToday };
const realLoadersPlan = { ...actualLoadersPlan };
const realAttention = { ...actualAttention };
const realDashboardData = { ...actualDashboardData };
const realNutrition = { ...actualNutrition };

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const owner: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

const member: HouseholdMember = {
    userId: BOB,
    householdId: "hh-1",
    role: "member",
    displayName: "Bob",
};

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) => {
        if (userId === ALICE) return owner;
        if (userId === BOB) return member;
        return null;
    },
    householdExists: async () => true,
    listHouseholdMembers: async () => [owner, member],
}));

mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) => ({
        user_id: userId,
        timezone: "UTC",
        preferred_weight_unit: "kg",
        widgets_enabled: true,
        alcohol_tracking_enabled: false,
        preferred_drink_unit: null,
        theme: "light",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    }),
    alcoholTrackingEnabledFromProfile: () => false,
    preferredDrinkUnitFromProfile: () => null,
    preferredWeightUnitFromProfile: () => "kg" as const,
}));

function todayViewForDate(date: string) {
    const base = buildPreviewTodayView(date);
    const weekStart = sundayWeekStart(date);
    const dates = weekDates(weekStart);
    return {
        ...base,
        date,
        week: {
            ...annotateWeekDays(dates, date, date, {
                prevWeekStart: shiftLocalDate(weekStart, -7),
                nextWeekStart: shiftLocalDate(weekStart, 7),
            }),
            dots: base.week.dots,
        },
    };
}

// This week reads the plans table; these tests do not run against one.
mock.module("../loaders-plan.js", () => ({
    ...realLoadersPlan,
    loadWeekPlanView: async () =>
        buildWeekPlanView({
            today: "2026-11-10",
            plans: [],
            recipes: [],
            stock: [],
            foodsById: new Map(),
        }),
}));

// What the page handed the chrome as already-loaded notices, per render.
const chromeSeen: { prefetched: unknown; todayNotices: unknown }[] = [];
let lastTodayView: ReturnType<typeof todayViewForDate> | null = null;

mock.module("../loaders-today.js", () => ({
    ...realLoadersToday,
    loadToday: async (_viewer: HouseholdMember, date?: string) => {
        lastTodayView = todayViewForDate(date ?? "2026-11-10");
        return lastTodayView;
    },
}));

mock.module("../../dashboard-data.js", () => ({
    ...realDashboardData,
    getNutritionSummaryPayload: async () => ({
        drink_unit: null,
    }),
    getGoalProgressPayload: async () => ({}),
    getTrendsPayload: async () => ({}),
    getWeightTrendsPayload: async () => ({ unit: "kg" }),
}));

mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    getLatestWeight: async () => null,
}));

mock.module("../attention.js", () => ({
    ...realAttention,
    viewerChromeWithAttention: async (
        profile: { theme?: string | null } | null,
        viewer: HouseholdMember,
        prefetched?: unknown,
    ) => {
        chromeSeen.push({
            prefetched,
            todayNotices: lastTodayView?.attention.notices,
        });
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
                memberCount: 2,
            },
        };
    },
}));

afterAll(() => {
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../../db/profiles.js", () => realProfiles);
    mock.module("../loaders-today.js", () => realLoadersToday);
    mock.module("../loaders-plan.js", () => realLoadersPlan);
    mock.module("../../dashboard-data.js", () => realDashboardData);
    mock.module("../../db/nutrition.js", () => realNutrition);
    mock.module("../attention.js", () => realAttention);
});

const hono = new Hono();
hono.route("/", nutritionRoutes);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("GET /", () => {
    test("Today on the new app loads the household's notices once: the chrome reuses what the page loaded", async () => {
        chromeSeen.length = 0;
        lastTodayView = null;
        const res = await hono.request("http://test/", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(chromeSeen).toHaveLength(1);
        const seen = chromeSeen[0]!;
        expect(seen.prefetched).toBeDefined();
        expect((seen.prefetched as { notices: unknown }).notices).toBe(
            seen.todayNotices,
        );
    });

    test("flag on renders v2 today", async () => {
        const res = await hono.request("http://test/", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).toContain("fd-today-page");
        expect(html).not.toContain('title="nutrition-summary"');
    });

    test("?date= selects the day", async () => {
        const res = await hono.request("http://test/?date=2026-08-03", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await res.text();
        expect(html).toContain('fd-today-title">Monday</');
        expect(html).toContain("3 August");
    });

    test("invalid date falls back to calendar today weekday title", async () => {
        const res = await hono.request("http://test/?date=2026-99-99", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await res.text();
        // Falls back to the calendar today in the member's zone (UTC here).
        const now = new Date();
        const weekday = now.toLocaleDateString("en-GB", {
            weekday: "long",
            timeZone: "UTC",
        });
        const dayMonth = now.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            timeZone: "UTC",
        });
        expect(html).toContain(`fd-today-title">${weekday}</`);
        expect(html).toContain(dayMonth);
    });

    test("owner can view member day", async () => {
        const res = await hono.request(
            `http://test/?member=${encodeURIComponent(BOB)}`,
            { headers: { cookie: cookie(ALICE) } },
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('role="status"');
        expect(html).toContain("Viewing Bob");
        const meals =
            html.match(
                /<div class="fd-today-meals">[\s\S]*?<\/div><\/main>/,
            )?.[0] ?? "";
        expect(meals).not.toContain("fd-today-section__add");
        expect(meals).not.toContain('class="fd-btn fd-btn--primary"');
    });

    test("member can view owner day in peer mode", async () => {
        const res = await hono.request(
            `http://test/?member=${encodeURIComponent(ALICE)}`,
            { headers: { cookie: cookie(BOB) } },
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Viewing Alice");
        const meals =
            html.match(
                /<div class="fd-today-meals">[\s\S]*?<\/div><\/main>/,
            )?.[0] ?? "";
        expect(meals).not.toContain("fd-today-section__add");
    });

    test("stranger member query is forbidden", async () => {
        const stranger = "33333333-3333-4333-8333-333333333333";
        const res = await hono.request(
            `http://test/?member=${encodeURIComponent(stranger)}`,
            { headers: { cookie: cookie(ALICE) } },
        );
        expect(res.status).toBe(403);
    });

    test("the retired Nutrition page forms are gone: POST log-meal, log-water, log-weight and card layout answer 404", async () => {
        for (const path of [
            "/log-meal",
            "/log-water",
            "/log-weight",
            "/nutrition/layout",
        ]) {
            const res = await hono.request(`http://test${path}`, {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "description=&meal_type=lunch",
            });
            expect(res.status).toBe(404);
        }
    });

    test("a bookmarked /nutrition/layout lands on Today", async () => {
        const res = await hono.request("http://test/nutrition/layout");
        expect(res.status).toBe(301);
        expect(res.headers.get("location")).toBe("/");
    });

    test("v2 log sheet validation error re-renders today with sheet open", async () => {
        const page = await renderDashboardPage(ALICE, undefined, undefined, {
            amountOpenOnLoad: true,
            amountError: "Enter a valid amount",
        });
        expect(page.html).toContain("fd-today-page");
        expect(page.html).toContain('id="fd-log-amount"');
        expect(page.html).toContain("Enter a valid amount");
    });
});
