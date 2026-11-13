import { Hono } from "hono";
import {
    deleteMeal,
    getMealById,
    insertMeal,
    updateMeal,
    type Meal,
    type MealInput,
    type MealItemWrite,
} from "../../db/nutrition.js";
import { liveFoodsStore } from "../../db/foods.js";
import { getProfile } from "../../db/profiles.js";
import { liveRecipesStore } from "../../db/recipes.js";
import {
    decodeUndoSnapshotPayload,
    dropMissingItemRefs,
    mealUndoSnapshot,
    mintUndoFlash,
    parseUndoSnapshot,
    verifyUndoToken,
} from "../../domain/meal-undo.js";
import { MealItemsError } from "../../domain/meals.js";
import {
    itemSpecsFromStoredItems,
    mealEditPatchFromItemAmounts,
    mealLocalTimeValue,
    mealLoggedAtFromLocalTime,
    recoverLoggingSpecsFromMeal,
    scaleMealTotals,
    submittedItemAmountsUnchanged,
} from "../../domain/today-edit.js";
import { itemListDigest } from "../../domain/meals.js";
import { dateInTz, validateTz } from "../../domain/tz.js";
import { resolveWriteTimestamp } from "../../meal-write.js";
import { resolveSessionSigningSecret } from "../../site-session.js";
import { formAmount, formText } from "../form.js";
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

const MEAL_ID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireOwnedMeal(
    userId: string,
    id: string,
): Promise<Meal | Response> {
    // A non-uuid id would fail the uuid cast in the query (a 500); it names
    // no meal, so it is the same 404 as a meal that is not yours.
    if (!MEAL_ID_RE.test(id)) return new Response("Not found", { status: 404 });
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

todayMealsRoutes.post("/meals/:id/edit", requireMember, async (c) => {
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
        const timeUnchanged =
            logged_time.trim() === mealLocalTimeValue(meal.logged_at, day, tz);
        let patch: Parameters<typeof updateMeal>[2] = { meal_type };
        if (!timeUnchanged) {
            const loggedAtLocal = mealLoggedAtFromLocalTime(
                parseTodayDateParam(day, day),
                logged_time,
                tz,
            );
            const { iso } = await resolveWriteTimestamp(userId, loggedAtLocal);
            patch.logged_at = iso;
        }
        const items = meal.items ?? [];
        if (items.length > 0) {
            const amounts = submittedItemAmountMap(meal, body);
            const loggingSpecs = recoverLoggingSpecsFromMeal(userId, meal);
            const digestSpecs = loggingSpecs ?? itemSpecsFromStoredItems(items);
            if (!submittedItemAmountsUnchanged(items, amounts)) {
                const computed = await mealEditPatchFromItemAmounts(
                    member.householdId,
                    items,
                    amounts,
                    {
                        storedDescription: meal.description,
                        loggingSpecs,
                    },
                );
                patch = {
                    ...patch,
                    description: computed.description,
                    calories: computed.calories,
                    protein_g: computed.protein_g,
                    carbs_g: computed.carbs_g,
                    fat_g: computed.fat_g,
                    fiber_g: computed.fiber_g,
                    sugar_g: computed.sugar_g,
                    alcohol_g: computed.alcohol_g,
                    caffeine_mg: computed.caffeine_mg,
                    items: computed.items,
                    item_digest: computed.item_digest,
                };
            } else if (timeUnchanged && meal_type === meal.meal_type) {
                // Nothing changed. Rebuilding the digest from the stored
                // rows would move the key of a meal logged with an
                // omitted unit or portions (the rows hold the defaults),
                // so a replay of that call would stop deduping.
                return redirectWithToast(c, returnTo, "nutrition.meal.updated");
            } else {
                patch.item_digest = itemListDigest(digestSpecs);
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
});

todayMealsRoutes.post("/meals/:id/delete", requireMember, async (c) => {
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
    return redirectWithToast(c, returnTo, "nutrition.meal.deleted", undefined, {
        dismissMs: 6000,
        action: undoAction,
    });
});

todayMealsRoutes.post("/meals/undo", requireMember, async (c) => {
    const member = siteMember(c);
    const userId = member.userId;
    const body = await c.req.parseBody();
    const returnTo = safeReturnPath(formText(body, "return_to"), "/");
    const { token, snapshotPayload } = readUndoCookies(c.req.header("cookie"));
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
    const items = input.items
        ? await withLiveItemRefs(member.householdId, input.items)
        : undefined;
    const result = await insertMeal(userId, {
        ...input,
        ...(items ? { items } : {}),
        idempotency_key: key ?? undefined,
    });
    const msg = result.deduplicated
        ? "nutrition.meal.undo.noop"
        : "nutrition.meal.undo.restored";
    return redirectWithToast(c, returnTo, msg);
});

/** The snapshot's items, minus references to foods or recipes deleted since. */
async function withLiveItemRefs(
    householdId: string,
    items: MealItemWrite[],
): Promise<MealItemWrite[]> {
    const foodIds = [
        ...new Set(
            items.flatMap((item) => (item.food_id ? [item.food_id] : [])),
        ),
    ];
    const recipeIds = [
        ...new Set(
            items.flatMap((item) => (item.recipe_id ? [item.recipe_id] : [])),
        ),
    ];
    const foods =
        foodIds.length > 0
            ? await liveFoodsStore().getFoodsByIds(householdId, foodIds)
            : new Map();
    const recipes = liveRecipesStore();
    const liveRecipeIds = new Set<string>();
    for (const id of recipeIds) {
        if (await recipes.getRecipe(householdId, id)) liveRecipeIds.add(id);
    }
    return dropMissingItemRefs(items, new Set(foods.keys()), liveRecipeIds);
}
