import { Hono } from "hono";
import { requireMember, siteMember } from "../middleware.js";
import { searchFoodsByName } from "../../food-search.js";
import { liveFoodsStore } from "../../db/foods.js";
import { searchFoodCatalog } from "../../domain/foods.js";
import type { FoodResult } from "../../foods.js";

export const foodsRoutes = new Hono();

foodsRoutes.get("/api/foods/search", requireMember, async (c) => {
    const query = (c.req.query("q") ?? "").trim();
    if (!query) return c.json({ foods: [] });
    const member = siteMember(c);
    let offHits: FoodResult[] = [];
    try {
        offHits = await searchFoodsByName(query, [], {
            householdId: member.householdId,
        });
    } catch {
        offHits = [];
    }
    const foods = await searchFoodCatalog(
        liveFoodsStore(),
        member.householdId,
        query,
        offHits,
    );
    return c.json({ foods });
});
