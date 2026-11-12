import { Hono } from "hono";
import { getMealById, insertMeal, type Meal } from "../../db/nutrition.js";
import { getProfile } from "../../db/profiles.js";
import { dateInTz, validateTz } from "../../domain/tz.js";
import { resolveWriteTimestamp } from "../../meal-write.js";
import { formText } from "../form.js";
import { gatedRoute } from "../gated.js";
import { requireMember, siteMember } from "../middleware.js";
import { redirectWithToast } from "../components/toast.js";
import { safeReturnPath } from "../usual-products-path.js";
import { parseTodayDateParam } from "../pages/v2/today.js";
import { mealInputForRelog } from "./log-relog.js";

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
            const input = await mealInputForRelog(
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
