import { Hono } from "hono";
import { renderDashboardPage } from "../loaders.js";
import { requireSiteUser } from "../middleware.js";
import { todayMealsRoutes } from "./today-meals.js";
import { todayAgainRoutes } from "./today-again.js";

export const nutritionRoutes = new Hono();
nutritionRoutes.route("/", todayMealsRoutes);
nutritionRoutes.route("/", todayAgainRoutes);

nutritionRoutes.get("/", requireSiteUser, async (c) => {
    const page = await renderDashboardPage(
        c.get("userId"),
        c.req.query("member"),
        undefined,
        undefined,
        c.req.query("date"),
    );
    return c.html(page.html, page.status);
});

nutritionRoutes.get("/nutrition", requireSiteUser, async (c) => {
    // toast: none (canonical)
    return c.redirect("/", 303);
});

// Card arranging is gone with the old Nutrition page. A bookmark of its page
// lands on Today.
nutritionRoutes.get("/nutrition/layout", async (c) => {
    // toast: none (retired page)
    return c.redirect("/", 301);
});
