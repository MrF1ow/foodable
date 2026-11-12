import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { TOAST_COOKIE } from "../components/toast.js";
import { UNDO_COOKIE } from "../../domain/meal-undo.js";
import { UNDO_SNAPSHOT_COOKIE } from "../meal-undo-flash.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualNutrition from "../../db/nutrition.js";
import { nutritionRoutes } from "./nutrition.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";

const realHousehold = { ...actualHousehold };
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

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";
process.env.SESSION_SECRET ||= "01234567890123456789012345678901";

mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) => {
        if (userId === ALICE) return owner;
        if (userId === BOB) return member;
        return null;
    },
}));

const mealStore = new Map<string, actualNutrition.Meal>();

mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    getMealById: async (userId: string, id: string) => {
        const meal = mealStore.get(id);
        if (!meal || meal.user_id !== userId) return null;
        return { ...meal, items: meal.items ?? [] };
    },
    updateMeal: async (
        userId: string,
        id: string,
        fields: Partial<actualNutrition.MealInput>,
    ) => {
        const meal = mealStore.get(id);
        if (!meal || meal.user_id !== userId) {
            throw new Error("meal not found");
        }
        const updated = { ...meal, ...fields };
        mealStore.set(id, updated as actualNutrition.Meal);
        return updated as actualNutrition.Meal;
    },
    deleteMeal: async (userId: string, id: string) => {
        const meal = mealStore.get(id);
        if (!meal || meal.user_id !== userId) return false;
        mealStore.delete(id);
        return true;
    },
    insertMeal: async (userId: string, input: actualNutrition.MealInput) => {
        const key = input.idempotency_key ?? "auto:test";
        for (const m of mealStore.values()) {
            if (m.user_id === userId && m.idempotency_key === key) {
                return { meal: m, deduplicated: true };
            }
        }
        const id = crypto.randomUUID();
        const meal = {
            id,
            user_id: userId,
            ...input,
            calories: input.calories ?? null,
            protein_g: input.protein_g ?? null,
            carbs_g: input.carbs_g ?? null,
            fat_g: input.fat_g ?? null,
            fiber_g: input.fiber_g ?? null,
            sugar_g: input.sugar_g ?? null,
            alcohol_g: input.alcohol_g ?? null,
            caffeine_mg: input.caffeine_mg ?? null,
            notes: input.notes ?? null,
            idempotency_key: key,
            items: [],
        } as actualNutrition.Meal;
        mealStore.set(id, meal);
        return { meal, deduplicated: false };
    },
}));

afterAll(() => {
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../../db/nutrition.js", () => realNutrition);
});

afterEach(() => {
    resetFlagsForTests();
    mealStore.clear();
});

const hono = new Hono();
hono.route("/", nutritionRoutes);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("today meal routes", () => {
    test("edit route 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await hono.request("http://test/meals/x/edit", {
            method: "POST",
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("cannot edit another member's meal", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        mealStore.set("00000000-0000-4000-8000-0000000000b0", {
            id: "00000000-0000-4000-8000-0000000000b0",
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
        const res = await hono.request(
            "http://test/meals/00000000-0000-4000-8000-0000000000b0/edit",
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "meal_type=lunch&logged_time=12:00&date=2026-03-01&return_to=/",
            },
        );
        expect(res.status).toBe(404);
    });

    test("a non-uuid meal id is 404, not a uuid-cast 500", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        for (const action of ["edit", "delete"]) {
            const res = await hono.request(
                `http://test/meals/not-a-uuid/${action}`,
                {
                    method: "POST",
                    headers: {
                        cookie: cookie(ALICE),
                        "content-type": "application/x-www-form-urlencoded",
                    },
                    body: "return_to=/&date=2026-03-01",
                },
            );
            expect(res.status).toBe(404);
        }
    });

    test("delete keeps toast and both undo cookies", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        mealStore.set("00000000-0000-4000-8000-0000000000d1", {
            id: "00000000-0000-4000-8000-0000000000d1",
            user_id: ALICE,
            description: "Eggs",
            meal_type: "breakfast",
            logged_at: "2026-03-01T12:00:00.000Z",
            calories: 200,
            protein_g: 12,
            carbs_g: 1,
            fat_g: 14,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: null,
            idempotency_key: "auto:del",
            items: [],
        });
        const res = await hono.request(
            "http://test/meals/00000000-0000-4000-8000-0000000000d1/delete",
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "return_to=/?date=2026-03-01&date=2026-03-01",
            },
        );
        expect(res.status).toBe(303);
        const setCookies = res.headers.getSetCookie();
        expect(setCookies.some((c) => c.startsWith(`${TOAST_COOKIE}=`))).toBe(
            true,
        );
        expect(setCookies.some((c) => c.startsWith(`${UNDO_COOKIE}=`))).toBe(
            true,
        );
        expect(
            setCookies.some((c) => c.startsWith(`${UNDO_SNAPSHOT_COOKIE}=`)),
        ).toBe(true);
        expect(setCookies.length).toBeGreaterThanOrEqual(3);
    });

    test("undo POST restores meal from delete cookies", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const id = "00000000-0000-4000-8000-0000000000e2";
        const key = "auto:undo-http";
        mealStore.set(id, {
            id,
            user_id: ALICE,
            description: "Restore",
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            calories: 100,
            protein_g: 5,
            carbs_g: 10,
            fat_g: 3,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: null,
            idempotency_key: key,
            items: [],
        });
        const del = await hono.request(`http://test/meals/${id}/delete`, {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(mealStore.has(id)).toBe(false);
        const pairs = del.headers
            .getSetCookie()
            .map((line) => line.split(";")[0]!)
            .join("; ");
        const undo = await hono.request("http://test/meals/undo", {
            method: "POST",
            headers: {
                cookie: `${cookie(ALICE)}; ${pairs}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(undo.status).toBe(303);
        const restored = [...mealStore.values()].find(
            (m) => m.idempotency_key === key,
        );
        expect(restored?.description).toBe("Restore");
    });
});
