import { Hono } from "hono";
import {
    deleteMeal,
    getMealById,
    insertMeal,
    updateMeal,
    type Meal,
    type MealInput,
} from "../../db/nutrition.js";
import { getProfile } from "../../db/profiles.js";
import {
    decodeUndoSnapshotPayload,
    mealUndoSnapshot,
    mintUndoFlash,
    parseUndoSnapshot,
    verifyUndoToken,
} from "../../domain/meal-undo.js";
import { MealItemsError, type MealItemSpec } from "../../domain/meals.js";
import {
    mealLoggedAtFromLocalTime,
    scaleMealTotals,
    submittedItemAmountsUnchanged,
} from "../../domain/today-edit.js";
import { dateInTz, validateTz } from "../../domain/tz.js";
import { mealWriteFromItems, resolveWriteTimestamp } from "../../meal-write.js";
import { resolveSessionSigningSecret } from "../../site-session.js";
import { formAmount, formText } from "../form.js";
import { gatedRoute } from "../gated.js";
import { renderDashboardPage } from "../loaders.js";
import { requireMember, siteMember } from "../middleware.js";
import { redirectWithToast, type ToastAction } from "../components/toast.js";
import {
    readUndoCookies,
    undoClearCookieHeaders,
    undoCookiesFit,
    undoSetCookieHeaders,
} from "../meal-undo-flash.js";
import { safeReturnPath } from "../usual-products-path.js";
import { parseTodayDateParam } from "../pages/v2/today.js";

export const todayMealsRoutes = new Hono();

function parseMealType(raw: string): MealInput["meal_type"] {
    const v = raw.trim().toLowerCase();
    if (v === "breakfast" || v === "lunch" || v === "dinner" || v === "snack") {
        return v;
    }
    throw new Error("Choose a meal type.");
}

async function requireOwnedMeal(
    userId: string,
    id: string,
): Promise<Meal | Response> {
    const meal = await getMealById(userId, id);
    if (!meal) return new Response("Not found", { status: 404 });
    return meal;
}

async function todayEditError(
    userId: string,
    mealId: string,
    error: string,
    member?: string,
    date?: string,
) {
    const page = await renderDashboardPage(
        userId,
        member,
        undefined,
        undefined,
        undefined,
        date,
        { openEditMealId: mealId, editError: error },
    );
    return { html: page.html, status: 400 as const };
}

function submittedItemAmountMap(
    meal: Meal,
    body: Record<string, string | File | (string | File)[]>,
): Map<string, number> {
    const items = meal.items ?? [];
    const out = new Map<string, number>();
    for (const item of items) {
        const amountKey = `item_amount_${item.id}`;
        const amount = formAmount(
            { [amountKey]: body[amountKey] } as Record<string, string | File>,
            amountKey,
        );
        if (amount == null || amount <= 0) {
            throw new MealItemsError("Enter an amount greater than zero.");
        }
        out.set(item.id, amount);
    }
    return out;
}

function itemSpecsFromForm(
    meal: Meal,
    amounts: ReadonlyMap<string, number>,
): MealItemSpec[] {
    const items = meal.items ?? [];
    const specs: MealItemSpec[] = [];
    for (const item of items) {
        const amount = amounts.get(item.id);
        if (amount == null || amount <= 0) {
            throw new MealItemsError("Enter an amount greater than zero.");
        }
        if (item.food_id) {
            specs.push({
                foodId: item.food_id,
                amount,
                unit: item.unit?.trim() || "g",
            });
        } else if (item.recipe_id) {
            specs.push({
                recipeId: item.recipe_id,
                portions: amount,
            });
        } else {
            specs.push({
                name: item.label,
                amount,
                unit: item.unit?.trim() || "g",
            });
        }
    }
    return specs;
}

todayMealsRoutes.post(
    "/meals/:id/edit",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const id = c.req.param("id");
        const mealOrRes = await requireOwnedMeal(userId, id);
        if (mealOrRes instanceof Response) return mealOrRes;
        const meal = mealOrRes;
        const body = await c.req.parseBody({ all: true });
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        const day = formText(body, "date") || dateInTz(meal.logged_at, "UTC");
        const memberQuery = new URL(returnTo, "http://local").searchParams.get(
            "member",
        );
        const profile = await getProfile(userId);
        const tz =
            profile?.timezone && validateTz(profile.timezone)
                ? profile.timezone
                : "UTC";
        const logged_time = formText(body, "logged_time");
        try {
            // Inside the try: a missing or bad meal type is a 400 on the
            // sheet, not a 500.
            const meal_type = parseMealType(formText(body, "meal_type"));
            const loggedAtLocal = mealLoggedAtFromLocalTime(
                parseTodayDateParam(day, day),
                logged_time,
                tz,
            );
            const { iso } = await resolveWriteTimestamp(userId, loggedAtLocal);
            let patch: Parameters<typeof updateMeal>[2] = {
                meal_type,
                logged_at: iso,
            };
            const items = meal.items ?? [];
            if (items.length > 0) {
                const amounts = submittedItemAmountMap(meal, body);
                if (!submittedItemAmountsUnchanged(items, amounts)) {
                    const specs = itemSpecsFromForm(meal, amounts);
                    const computed = await mealWriteFromItems(
                        member.householdId,
                        specs,
                    );
                    patch = {
                        ...patch,
                        description: computed.description,
                        ...computed.totals,
                        items: computed.items,
                        item_digest: computed.item_digest,
                    };
                }
            } else {
                const servings = formAmount(body, "servings") ?? 1;
                const scaled = scaleMealTotals(meal, servings);
                patch = {
                    ...patch,
                    calories: scaled.calories ?? undefined,
                    protein_g: scaled.protein_g ?? undefined,
                    carbs_g: scaled.carbs_g ?? undefined,
                    fat_g: scaled.fat_g ?? undefined,
                    fiber_g: scaled.fiber_g ?? undefined,
                    sugar_g: scaled.sugar_g ?? undefined,
                    alcohol_g: scaled.alcohol_g ?? undefined,
                    caffeine_mg: scaled.caffeine_mg ?? undefined,
                };
            }
            await updateMeal(userId, id, patch);
            return redirectWithToast(c, returnTo, "nutrition.meal.updated");
        } catch (err) {
            const message =
                err instanceof MealItemsError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not save this meal.";
            const page = await todayEditError(
                userId,
                id,
                message,
                memberQuery ?? undefined,
                day,
            );
            return c.html(page.html, page.status);
        }
    },
);

todayMealsRoutes.post(
    "/meals/:id/delete",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const id = c.req.param("id");
        const mealOrRes = await requireOwnedMeal(userId, id);
        if (mealOrRes instanceof Response) return mealOrRes;
        const meal = mealOrRes;
        const body = await c.req.parseBody();
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        const day = formText(body, "date") || dateInTz(meal.logged_at, "UTC");
        const snapshot = mealUndoSnapshot(meal, member.householdId);
        const secure =
            c.req.header("x-forwarded-proto") === "https" ||
            new URL(c.req.url).protocol === "https:";
        const flash = mintUndoFlash(
            userId,
            snapshot,
            resolveSessionSigningSecret(),
            Date.now(),
        );
        if (!undoCookiesFit(flash, secure)) {
            const page = await todayEditError(
                userId,
                id,
                "This meal is too large to undo — delete it from chat or export your data first.",
                new URL(returnTo, "http://local").searchParams.get("member") ??
                    undefined,
                day,
            );
            return c.html(page.html, page.status);
        }
        const deleted = await deleteMeal(userId, id);
        if (!deleted) return c.text("Not found", 404);
        for (const header of undoSetCookieHeaders(flash, secure)) {
            c.header("Set-Cookie", header, { append: true });
        }
        const undoAction: ToastAction = {
            label: "Undo",
            action: "/meals/undo",
            fields: { return_to: returnTo, date: day },
        };
        return redirectWithToast(
            c,
            returnTo,
            "nutrition.meal.deleted",
            undefined,
            { dismissMs: 6000, action: undoAction },
        );
    },
);

todayMealsRoutes.post(
    "/meals/undo",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const body = await c.req.parseBody();
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        const { token, snapshotPayload } = readUndoCookies(
            c.req.header("cookie"),
        );
        const secure =
            c.req.header("x-forwarded-proto") === "https" ||
            new URL(c.req.url).protocol === "https:";
        for (const header of undoClearCookieHeaders(secure)) {
            c.header("Set-Cookie", header, { append: true });
        }
        if (
            !token ||
            !snapshotPayload ||
            !verifyUndoToken(
                token,
                snapshotPayload,
                userId,
                Date.now(),
                resolveSessionSigningSecret(),
            )
        ) {
            return c.text("Undo expired or invalid.", 400);
        }
        const snapshotJson = decodeUndoSnapshotPayload(snapshotPayload);
        if (!snapshotJson) return c.text("Undo expired or invalid.", 400);
        const snapshot = parseUndoSnapshot(snapshotJson);
        if (!snapshot) return c.text("Undo expired or invalid.", 400);
        const { input } = snapshot;
        const key = snapshot.idempotency_key ?? input.idempotency_key;
        const result = await insertMeal(userId, {
            ...input,
            idempotency_key: key ?? undefined,
        });
        const msg = result.deduplicated
            ? "nutrition.meal.undo.noop"
            : "nutrition.meal.undo.restored";
        return redirectWithToast(c, returnTo, msg);
    },
);
