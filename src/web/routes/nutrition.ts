import { Hono } from "hono";
import {
    logMealFromForm,
    logWaterFromForm,
    logWeightFromForm,
} from "../pages/nutrition.js";
import { renderDashboardPage } from "../loaders.js";

import { formMealItems, formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { insertMeal, insertWater, insertWeight } from "../../db/nutrition.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { getProfile, setNutritionLayout } from "../../db/profiles.js";
import {
    isNutritionCard,
    moveCard,
    nutritionLayoutOrderErrorMessage,
    orderCards,
    sameNutritionCardOrder,
    validateNutritionLayoutOrder,
} from "../../domain/layout.js";
import {
    NUTRITION_ARRANGE_MODAL_ID,
    NUTRITION_LOG_MEAL_MODAL_ID,
    NUTRITION_LOG_WATER_MODAL_ID,
    NUTRITION_LOG_WEIGHT_MODAL_ID,
} from "../pages/nutrition.js";
import { redirectWithToast } from "../toast.js";

export const nutritionRoutes = new Hono();

function nutritionReturnPath(member: string | undefined): string {
    if (member?.trim()) {
        return `/?member=${encodeURIComponent(member.trim())}`;
    }
    return "/";
}

async function nutritionFormError(
    userId: string,
    error: string,
    member?: string,
    openModalId?: string,
) {
    const page = await renderDashboardPage(userId, member, error, openModalId);
    return {
        html: page.html,
        status: 400 as const,
    };
}

nutritionRoutes.get("/", requireSiteUser, async (c) => {
    const page = await renderDashboardPage(
        c.get("userId"),
        c.req.query("member"),
    );
    return c.html(page.html, page.status);
});

nutritionRoutes.post("/log-meal", requireMember, async (c) => {
    const userId = c.get("userId");
    const member = siteMember(c);
    const body = await c.req.parseBody({ all: true });
    const result = await logMealFromForm(
        userId,
        {
            description: formText(body, "description"),
            meal_type: formText(body, "meal_type"),
            calories: formText(body, "calories"),
            protein_g: formText(body, "protein_g"),
            carbs_g: formText(body, "carbs_g"),
            fat_g: formText(body, "fat_g"),
            fiber_g: formText(body, "fiber_g"),
            sugar_g: formText(body, "sugar_g"),
            alcohol_g: formText(body, "alcohol_g"),
            caffeine_mg: formText(body, "caffeine_mg"),
            items: formMealItems(body),
        },
        insertMeal,
        {
            householdId: member.householdId,
            foods: liveFoodsStore(),
            recipes: liveRecipesStore(),
        },
    );
    if (!result.ok) {
        const page = await nutritionFormError(
            userId,
            result.error,
            undefined,
            NUTRITION_LOG_MEAL_MODAL_ID,
        );
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/", "nutrition.meal.logged");
});

nutritionRoutes.post("/log-water", requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const result = await logWaterFromForm(
        userId,
        { amount_ml: formText(body, "amount_ml") },
        insertWater,
    );
    if (!result.ok) {
        const page = await nutritionFormError(
            userId,
            result.error,
            undefined,
            NUTRITION_LOG_WATER_MODAL_ID,
        );
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/", "nutrition.water.logged");
});

nutritionRoutes.post("/log-weight", requireMember, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const result = await logWeightFromForm(
        userId,
        {
            weight: formText(body, "weight"),
            unit: formText(body, "unit"),
        },
        insertWeight,
    );
    if (!result.ok) {
        const page = await nutritionFormError(
            userId,
            result.error,
            undefined,
            NUTRITION_LOG_WEIGHT_MODAL_ID,
        );
        return c.html(page.html, page.status);
    }
    return redirectWithToast(c, "/", "nutrition.weight.logged");
});

nutritionRoutes.get("/nutrition", requireSiteUser, async (c) => {
    // toast: none (canonical)
    return c.redirect("/", 303);
});

function formOrderList(
    body: Record<string, string | File | (string | File)[]>,
): string[] {
    const raw = body.order;
    if (raw == null) return [];
    if (Array.isArray(raw)) {
        return raw.map((v) => (typeof v === "string" ? v : ""));
    }
    return typeof raw === "string" ? [raw] : [];
}

nutritionRoutes.post("/nutrition/layout", requireSiteUser, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody({ all: true });
    const member = formText(body, "member");
    if (member?.trim() && member.trim() !== userId) {
        const page = await nutritionFormError(
            userId,
            "You can only arrange your own nutrition dashboard.",
            member,
        );
        return c.html(page.html, 403);
    }
    const orderSubmitted = formOrderList(body);
    try {
        if (orderSubmitted.length > 0) {
            const validated = validateNutritionLayoutOrder(orderSubmitted);
            if (!Array.isArray(validated)) {
                const page = await nutritionFormError(
                    userId,
                    nutritionLayoutOrderErrorMessage(validated),
                    member,
                    NUTRITION_ARRANGE_MODAL_ID,
                );
                return c.html(page.html, page.status);
            }
            const profile = await getProfile(userId);
            const current = orderCards(profile?.nutrition_layout);
            if (sameNutritionCardOrder(current, validated)) {
                // toast: none (no-op)
                return c.redirect(nutritionReturnPath(member), 303);
            }
            await setNutritionLayout(userId, [...validated]);
            return redirectWithToast(
                c,
                nutritionReturnPath(member),
                "nutrition.layout.saved",
            );
        }

        const card = formText(body, "card");
        const direction = formText(body, "direction");
        if (!isNutritionCard(card)) {
            const page = await nutritionFormError(
                userId,
                "Unknown card.",
                member,
                NUTRITION_ARRANGE_MODAL_ID,
            );
            return c.html(page.html, page.status);
        }
        if (direction !== "up" && direction !== "down") {
            const page = await nutritionFormError(
                userId,
                "Invalid move direction.",
                member,
                NUTRITION_ARRANGE_MODAL_ID,
            );
            return c.html(page.html, page.status);
        }
        const profile = await getProfile(userId);
        const order = orderCards(profile?.nutrition_layout);
        const next = moveCard(order, card, direction);
        if (sameNutritionCardOrder(order, next)) {
            // toast: none (no-op)
            return c.redirect(nutritionReturnPath(member), 303);
        }
        await setNutritionLayout(userId, [...next]);
        return redirectWithToast(
            c,
            nutritionReturnPath(member),
            "nutrition.layout.saved",
        );
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "Could not save card order.";
        const page = await nutritionFormError(
            userId,
            message,
            member,
            NUTRITION_ARRANGE_MODAL_ID,
        );
        return c.html(page.html, page.status);
    }
});
