import { Hono } from "hono";
import {
    getMealById,
    insertMeal,
    type Meal,
    type MealInput,
} from "../../db/nutrition.js";
import { getProfile } from "../../db/profiles.js";
import { itemSpecsFromStoredItems } from "../../domain/today-edit.js";
import { dateInTz, validateTz } from "../../domain/tz.js";
import { mealWriteFromItems, resolveWriteTimestamp } from "../../meal-write.js";
import { formText } from "../form.js";
import { gatedRoute } from "../gated.js";
import { requireMember, siteMember } from "../middleware.js";
import { redirectWithToast } from "../components/toast.js";
import { safeReturnPath } from "../usual-products-path.js";
import { parseTodayDateParam } from "../pages/v2/today.js";

export const todayAgainRoutes = new Hono();

async function requireOwnedMeal(
    userId: string,
    id: string,
): Promise<Meal | Response> {
    const meal = await getMealById(userId, id);
    if (!meal) return new Response("Not found", { status: 404 });
    return meal;
}

async function loggedAtForAgain(userId: string, day: string): Promise<string> {
    const profile = await getProfile(userId);
    const tz =
        profile?.timezone && validateTz(profile.timezone)
            ? profile.timezone
            : "UTC";
    const today = dateInTz(new Date(), tz);
    const viewDay = parseTodayDateParam(day, today);
    if (viewDay === today) {
        return new Date().toISOString();
    }
    const { iso } = await resolveWriteTimestamp(userId, viewDay);
    if (!iso) {
        throw new Error("Could not resolve when to log this meal.");
    }
    return iso;
}

async function mealInputForAgain(
    householdId: string,
    meal: Meal,
    loggedAt: string,
): Promise<MealInput> {
    const items = meal.items ?? [];
    if (items.length > 0) {
        const specs = itemSpecsFromStoredItems(items);
        const computed = await mealWriteFromItems(householdId, specs);
        return {
            description: computed.description,
            meal_type: meal.meal_type as MealInput["meal_type"],
            logged_at: loggedAt,
            calories: computed.totals.calories,
            protein_g: computed.totals.protein_g,
            carbs_g: computed.totals.carbs_g,
            fat_g: computed.totals.fat_g,
            fiber_g: computed.totals.fiber_g,
            sugar_g: computed.totals.sugar_g,
            alcohol_g: computed.totals.alcohol_g,
            caffeine_mg: computed.totals.caffeine_mg,
            items: computed.items,
            item_digest: computed.item_digest,
        };
    }
    return {
        description: meal.description,
        meal_type: meal.meal_type as MealInput["meal_type"],
        logged_at: loggedAt,
        calories: meal.calories ?? undefined,
        protein_g: meal.protein_g ?? undefined,
        carbs_g: meal.carbs_g ?? undefined,
        fat_g: meal.fat_g ?? undefined,
        fiber_g: meal.fiber_g ?? undefined,
        sugar_g: meal.sugar_g ?? undefined,
        alcohol_g: meal.alcohol_g ?? undefined,
        caffeine_mg: meal.caffeine_mg ?? undefined,
        notes: meal.notes ?? undefined,
    };
}

todayAgainRoutes.post(
    "/meals/:id/again",
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
        const day = formText(body, "date");
        try {
            const loggedAt = await loggedAtForAgain(userId, day);
            const input = await mealInputForAgain(
                member.householdId,
                meal,
                loggedAt,
            );
            await insertMeal(userId, input);
            return redirectWithToast(c, returnTo, "nutrition.meal.logged");
        } catch {
            return c.text("Could not log this meal again.", 400);
        }
    },
);
