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

export const nutritionRoutes = new Hono();

async function nutritionFormError(userId: string, error: string) {
    const page = await renderDashboardPage(userId, undefined, error);
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
        const page = await nutritionFormError(userId, result.error);
        return c.html(page.html, page.status);
    }
    return c.redirect("/");
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
        const page = await nutritionFormError(userId, result.error);
        return c.html(page.html, page.status);
    }
    return c.redirect("/");
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
        const page = await nutritionFormError(userId, result.error);
        return c.html(page.html, page.status);
    }
    return c.redirect("/");
});

nutritionRoutes.get("/nutrition", requireSiteUser, async (c) => {
    return c.redirect("/");
});
