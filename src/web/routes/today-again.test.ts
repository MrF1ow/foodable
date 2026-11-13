import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { TOAST_COOKIE } from "../components/toast.js";
import { resetFlagsForTests } from "../../flags.js";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualNutrition from "../../db/nutrition.js";
import * as actualProfiles from "../../db/profiles.js";
import { nutritionRoutes } from "./nutrition.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { type MealInput } from "../../db/nutrition.js";

const realHousehold = { ...actualHousehold };
const realNutrition = { ...actualNutrition };
const realProfiles = { ...actualProfiles };

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const owner: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";
process.env.SESSION_SECRET ||= "01234567890123456789012345678901";

mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) => {
        if (userId === ALICE) return owner;
        if (userId === BOB)
            return {
                userId: BOB,
                householdId: "hh-1",
                role: "member" as const,
                displayName: "Bob",
            };
        return null;
    },
}));

const mealStore = new Map<string, actualNutrition.Meal>();
let insertCount = 0;

mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    getMealById: async (userId: string, id: string) => {
        const meal = mealStore.get(id);
        if (!meal || meal.user_id !== userId) return null;
        return { ...meal, items: meal.items ?? [] };
    },
    insertMeal: async (userId: string, input: MealInput) => {
        insertCount += 1;
        const id = crypto.randomUUID();
        const meal = {
            id,
            user_id: userId,
            description: input.description,
            meal_type: input.meal_type,
            logged_at: input.logged_at ?? new Date().toISOString(),
            calories: input.calories ?? null,
            protein_g: input.protein_g ?? null,
            carbs_g: input.carbs_g ?? null,
            fat_g: input.fat_g ?? null,
            fiber_g: input.fiber_g ?? null,
            sugar_g: input.sugar_g ?? null,
            alcohol_g: input.alcohol_g ?? null,
            caffeine_mg: input.caffeine_mg ?? null,
            notes: input.notes ?? null,
            idempotency_key: input.idempotency_key ?? "auto:test",
            items: input.items ?? [],
        } as actualNutrition.Meal;
        mealStore.set(id, meal);
        return { meal, deduplicated: false };
    },
}));

mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) => {
        if (userId === ALICE) {
            return {
                user_id: ALICE,
                timezone: "America/Los_Angeles",
            };
        }
        return null;
    },
}));

afterAll(() => {
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../../db/nutrition.js", () => realNutrition);
    mock.module("../../db/profiles.js", () => realProfiles);
});

afterEach(() => {
    resetFlagsForTests();
    mealStore.clear();
    insertCount = 0;
});

const hono = new Hono();
hono.route("/", nutritionRoutes);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("today again route", () => {
    test("cannot repeat another member's meal", async () => {
        mealStore.set("m-bob", {
            id: "m-bob",
            user_id: BOB,
            description: "Bob meal",
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            calories: 100,
            protein_g: 10,
            carbs_g: 10,
            fat_g: 5,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: null,
            idempotency_key: null,
            items: [],
        });
        const res = await hono.request("http://test/meals/m-bob/again", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/&date=2026-03-01",
        });
        expect(res.status).toBe(404);
        expect(insertCount).toBe(0);
    });

    test("again redirects with toast", async () => {
        mealStore.set("m-src", {
            id: "m-src",
            user_id: ALICE,
            description: "Oats",
            meal_type: "breakfast",
            logged_at: "2026-03-01T08:00:00.000Z",
            calories: 300,
            protein_g: 10,
            carbs_g: 50,
            fat_g: 6,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: null,
            idempotency_key: "auto:src",
            items: [],
        });
        const before = mealStore.size;
        const res = await hono.request("http://test/meals/m-src/again", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(res.status).toBe(303);
        expect(mealStore.size).toBe(before + 1);
        expect(insertCount).toBe(1);
        expect(
            res.headers
                .getSetCookie()
                .some((c) => c.startsWith(`${TOAST_COOKIE}=`)),
        ).toBe(true);
    });
});
