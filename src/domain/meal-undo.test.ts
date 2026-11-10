import { expect, setSystemTime, test } from "bun:test";
import type { Meal, MealItem } from "../db/nutrition.js";
import { gzipSync } from "node:zlib";
import {
    decodeUndoSnapshotPayload,
    encodeUndoSnapshotPayload,
    mealUndoSnapshot,
    mintUndoFlash,
    parseUndoSnapshot,
    verifyUndoToken,
} from "./meal-undo.js";
import {
    UNDO_SNAPSHOT_COOKIE,
    undoCookieLineBytes,
    undoCookiesFit,
} from "../web/meal-undo-flash.js";
import { UNDO_COOKIE } from "./meal-undo.js";

const SECRET = "01234567890123456789012345678901";
const USER = "11111111-1111-4111-8111-111111111111";

const sampleMeal: Meal = {
    id: "m1",
    user_id: USER,
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
    idempotency_key: "auto:abc",
    items: [],
};

function itemRow(index: number, pad = "", uniqueFood = false): MealItem {
    const label = `Ingredient number ${index} with a realistic product name${pad}`;
    return {
        id: `item-${index}`,
        meal_id: "m1",
        household_id: "hh",
        food_id: uniqueFood ? crypto.randomUUID() : `food-${index}`,
        recipe_id: null,
        label,
        amount: 100,
        unit: "g",
        grams: 100,
        portions: null,
        calories: 120,
        protein_g: 10,
        carbs_g: 5,
        fat_g: 3,
        fiber_g: 1,
        sugar_g: 2,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: index,
        user_id: USER,
        created_at: "2026-03-01T12:00:00.000Z",
    };
}

function mealWithItems(count: number, pad = "", uniqueFood = false): Meal {
    return {
        ...sampleMeal,
        description: `${count} items`,
        items: Array.from({ length: count }, (_, i) =>
            itemRow(i, pad, uniqueFood),
        ),
    };
}

test("undo round-trip verifies compressed payload", () => {
    const snap = mealUndoSnapshot(sampleMeal, "hh");
    const flash = mintUndoFlash(USER, snap, SECRET, Date.now());
    expect(flash.snapshotPayload).not.toContain("{");
    expect(
        verifyUndoToken(
            flash.token,
            flash.snapshotPayload,
            USER,
            Date.now(),
            SECRET,
        ),
    ).toBe(true);
    const parsed = parseUndoSnapshot(flash.snapshotJson);
    expect(parsed?.idempotency_key).toBe("auto:abc");
    expect(encodeUndoSnapshotPayload(flash.snapshotJson)).toBe(
        flash.snapshotPayload,
    );
});

test("forged token rejected", () => {
    const snap = mealUndoSnapshot(sampleMeal, "hh");
    const flash = mintUndoFlash(USER, snap, SECRET, Date.now());
    expect(
        verifyUndoToken(
            `${flash.token}x`,
            flash.snapshotPayload,
            USER,
            Date.now(),
            SECRET,
        ),
    ).toBe(false);
});

test("expired token rejected", () => {
    const now = Date.parse("2026-03-01T12:00:00.000Z");
    setSystemTime(now);
    const snap = mealUndoSnapshot(sampleMeal, "hh");
    const flash = mintUndoFlash(USER, snap, SECRET, now);
    setSystemTime(now + 11 * 60 * 1000);
    expect(
        verifyUndoToken(
            flash.token,
            flash.snapshotPayload,
            USER,
            Date.now(),
            SECRET,
        ),
    ).toBe(false);
    setSystemTime();
});

test("20-item meal fits undo cookies", () => {
    const snap = mealUndoSnapshot(mealWithItems(20), "hh");
    const flash = mintUndoFlash(USER, snap, SECRET, Date.now());
    expect(undoCookiesFit(flash, false)).toBe(true);
    expect(
        undoCookieLineBytes(UNDO_COOKIE, flash.token, false),
    ).toBeLessThanOrEqual(4096);
    expect(
        undoCookieLineBytes(UNDO_SNAPSHOT_COOKIE, flash.snapshotPayload, false),
    ).toBeLessThanOrEqual(4096);
});

test("decodeUndoSnapshotPayload refuses decompress bomb", () => {
    const huge = JSON.stringify({ x: "a".repeat(512 * 1024) });
    const payload = gzipSync(Buffer.from(huge, "utf8")).toString("base64url");
    expect(decodeUndoSnapshotPayload(payload)).toBeNull();
});

test("pathological 200-item meal exceeds cookie budget", () => {
    const snap = mealUndoSnapshot(
        mealWithItems(200, "200".repeat(20), true),
        "hh",
    );
    const flash = mintUndoFlash(USER, snap, SECRET, Date.now());
    expect(undoCookiesFit(flash, false)).toBe(false);
});
