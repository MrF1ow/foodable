import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Meal, MealInput } from "../db/nutrition.js";
import { snapshotToMealItemWrite } from "../db/nutrition.js";

const TOKEN_VERSION = "e1";
const UNDO_KEY_INFO = "foodable meal undo v1";
export const UNDO_TTL_MS = 10 * 60 * 1000;
/** Max bytes per Set-Cookie header line (name, value, attributes). */
export const UNDO_COOKIE_LINE_MAX_BYTES = 4096;
export const UNDO_COOKIE = "foodable_undo";
/** Refuse gunzip output beyond this (compressed cookie bomb guard). */
export const UNDO_SNAPSHOT_MAX_GUNZIP_BYTES = 256 * 1024;

function deriveUndoKey(sessionSecret: string): string {
    return createHmac("sha256", sessionSecret)
        .update(UNDO_KEY_INFO)
        .digest("hex");
}

function signPayload(payload: string, sessionSecret: string): string {
    return createHmac("sha256", deriveUndoKey(sessionSecret))
        .update(payload)
        .digest("hex");
}

export type MealUndoSnapshot = {
    idempotency_key: string | null;
    input: MealInput;
};

/** Serializable meal for undo re-insert (original idempotency key preserved). */
export function mealUndoSnapshot(
    meal: Meal,
    householdId: string,
): MealUndoSnapshot {
    const items =
        meal.items && meal.items.length > 0
            ? meal.items.map((item) =>
                  snapshotToMealItemWrite(
                      {
                          foodId: item.food_id,
                          recipeId: item.recipe_id,
                          label: item.label,
                          amount: item.amount,
                          unit: item.unit,
                          grams: item.grams,
                          portions: item.portions,
                          sortOrder: item.sort_order,
                          calories: item.calories,
                          protein_g: item.protein_g,
                          carbs_g: item.carbs_g,
                          fat_g: item.fat_g,
                          fiber_g: item.fiber_g,
                          sugar_g: item.sugar_g,
                          alcohol_g: item.alcohol_g,
                          caffeine_mg: item.caffeine_mg,
                      },
                      householdId,
                  ),
              )
            : undefined;
    return {
        idempotency_key: meal.idempotency_key,
        input: {
            description: meal.description,
            meal_type: (meal.meal_type as MealInput["meal_type"]) ?? "snack",
            calories: meal.calories ?? undefined,
            protein_g: meal.protein_g ?? undefined,
            carbs_g: meal.carbs_g ?? undefined,
            fat_g: meal.fat_g ?? undefined,
            fiber_g: meal.fiber_g ?? undefined,
            sugar_g: meal.sugar_g ?? undefined,
            alcohol_g: meal.alcohol_g ?? undefined,
            caffeine_mg: meal.caffeine_mg ?? undefined,
            logged_at: meal.logged_at,
            notes: meal.notes ?? undefined,
            idempotency_key: meal.idempotency_key ?? undefined,
            items,
        },
    };
}

function snapshotDigest(snapshotPayload: string): string {
    return createHash("sha256").update(snapshotPayload, "utf8").digest("hex");
}

/** Gzip + base64url for cookie transport; HMAC binds to this exact string. */
export function encodeUndoSnapshotPayload(snapshotJson: string): string {
    const gz = gzipSync(Buffer.from(snapshotJson, "utf8"));
    return gz.toString("base64url");
}

export function decodeUndoSnapshotPayload(payload: string): string | null {
    try {
        const buf = Buffer.from(payload, "base64url");
        return gunzipSync(buf, {
            maxOutputLength: UNDO_SNAPSHOT_MAX_GUNZIP_BYTES,
        }).toString("utf8");
    } catch {
        return null;
    }
}

export type UndoFlash = {
    token: string;
    /** Gzip/base64url cookie value (not raw JSON). */
    snapshotPayload: string;
    snapshotJson: string;
};

/** Mint undo token + snapshot for cookies (caller checks cookie line size). */
export function mintUndoFlash(
    userId: string,
    snapshot: MealUndoSnapshot,
    sessionSecret: string,
    nowMs: number,
): UndoFlash {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        throw new Error("invalid user id");
    }
    const exp = Math.floor((nowMs + UNDO_TTL_MS) / 1000);
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotPayload = encodeUndoSnapshotPayload(snapshotJson);
    const digest = snapshotDigest(snapshotPayload);
    const payload = `${TOKEN_VERSION}.${userId}.${exp}.${digest}`;
    const mac = signPayload(payload, sessionSecret);
    return {
        token: `${payload}.${mac}`,
        snapshotPayload,
        snapshotJson,
    };
}

export function verifyUndoToken(
    token: string,
    snapshotPayload: string,
    userId: string,
    nowMs: number,
    sessionSecret: string,
): boolean {
    if (!token || !snapshotPayload) return false;
    const parts = token.split(".");
    if (parts.length !== 5) return false;
    const [version, tokUser, expRaw, digest, mac] = parts;
    if (version !== TOKEN_VERSION || tokUser !== userId || !expRaw || !digest)
        return false;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp * 1000 <= nowMs) return false;
    const payload = `${TOKEN_VERSION}.${userId}.${exp}.${digest}`;
    const expected = signPayload(payload, sessionSecret);
    const a = Buffer.from(mac ?? "", "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const actualDigest = snapshotDigest(snapshotPayload);
    if (actualDigest !== digest) return false;
    return true;
}

export function parseUndoSnapshot(json: string): MealUndoSnapshot | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const input = (parsed as { input?: unknown }).input;
    if (!input || typeof input !== "object") return null;
    const key = (parsed as { idempotency_key?: unknown }).idempotency_key;
    if (key != null && typeof key !== "string") return null;
    return parsed as MealUndoSnapshot;
}
