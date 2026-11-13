import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { isLocalDev } from "../../flags.js";
import { getProfile } from "../../db/profiles.js";
import { getHouseholdMembership } from "../../db/household.js";
import { forbiddenDashboardHtml } from "../loaders.js";
import { viewerChromeWithAttention } from "../attention.js";
import { requireSiteUser } from "../middleware.js";
import { renderDevGalleryV2Page } from "../pages/dev-gallery.js";

export const devGalleryRoutes = new Hono();

const localDevOnly = createMiddleware(async (c, next) => {
    if (!isLocalDev()) {
        return c.text("Not found", 404);
    }
    return next();
});

devGalleryRoutes.get(
    "/dev/gallery-v2",
    requireSiteUser,
    localDevOnly,
    async (c) => {
        const userId = c.get("userId");
        const member = await getHouseholdMembership(userId);
        if (member == null) {
            return c.html(forbiddenDashboardHtml(), 403);
        }
        const profile = await getProfile(userId);
        const chrome = await viewerChromeWithAttention(profile, member);
        return c.html(renderDevGalleryV2Page(chrome));
    },
);
