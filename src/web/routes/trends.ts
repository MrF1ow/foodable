import { Hono } from "hono";
import { gatedRoute } from "../gated.js";
import { requireSiteUser } from "../middleware.js";
import {
    loadTrendsPageData,
    renderTrendsV2Page,
    resolveTrendsSubject,
} from "../pages/v2/trends.js";

export const trendsRoutes = new Hono();

trendsRoutes.get(
    "/trends",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = c.req.query("member");
        const resolved = await resolveTrendsSubject(userId, member);
        if (!resolved.ok) {
            return c.html(resolved.html, resolved.status);
        }
        const data = await loadTrendsPageData(
            resolved.subject.userId,
            resolved.chrome,
        );
        return c.html(renderTrendsV2Page(data));
    },
);
