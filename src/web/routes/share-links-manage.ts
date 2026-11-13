// Share links from inside the app: a signed-in member makes a link to a recipe
// or the grocery list, sees its address once, and revokes it from Settings.
// The public page a link opens is share-links.ts.
//
// Signed-in members only, and only while `mcp-share-links` is on (a link opens
// a public page that needs no sign-in, so it stays off unless asked for; the
// sheets and the Settings list are left out with it). The household always
// comes from the session, never from the form.
//
// The address is the one thing here that must not leak. It is in the 200 page
// the create handlers answer with, and nowhere else: not a redirect (a
// Location is logged and kept in history), not a toast cookie, not a log line,
// not analytics. The response is no-store. A failure answers without it.

import { Hono } from "hono";
import { getProfile } from "../../db/profiles.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveShareLinkStore } from "../../db/share-links.js";
import {
    createShareLink,
    revokeShareLink,
    ShareLinkInputError,
    type ShareLink,
} from "../../domain/sharing.js";
import { shareLinkUrl } from "../../mcp/tools/sharing.js";
import { getBaseUrl } from "../../url.js";
import { viewerChromeWithAttention } from "../attention.js";
import { redirectWithToast } from "../components/toast.js";
import { formText } from "../form.js";
import { gatedRoute } from "../gated.js";
import {
    renderHouseholdSettingsRoute,
    renderGroceryListPage,
    renderRecipeDetailRoute,
    renderRecipesListPage,
} from "../loaders.js";
import { requireMember, siteMember } from "../middleware.js";
import {
    GROCERY_SHARE_SHEET_ID,
    parseShareExpiry,
    RECIPE_SHARE_SHEET_ID,
    renderShareCreatedPage,
} from "../pages/v2/share-sheet.js";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BAD_EXPIRY = "Choose how long the link should work.";

export const shareLinkManageRoutes = new Hono();

type Made = { link: ShareLink; token: string };

async function createdPage(
    userId: string,
    member: NonNullable<ReturnType<typeof siteMember>>,
    origin: string,
    made: Made,
    shown: {
        what: string;
        name: string | null;
        backHref: string;
        active: "recipes" | "grocery";
    },
): Promise<string> {
    const profile = await getProfile(userId);
    const chrome = await viewerChromeWithAttention(profile, member);
    return renderShareCreatedPage({
        chrome,
        url: shareLinkUrl(origin, made.token),
        what: shown.what,
        name: shown.name,
        expiresAt: made.link.expiresAt,
        backHref: shown.backHref,
        active: shown.active,
    });
}

shareLinkManageRoutes.post(
    "/recipes/:id/share",
    requireMember,
    gatedRoute("mcp-share-links", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const recipeId = c.req.param("id");
        const notFound = async () => {
            // The live recipes store throws a raw cast error on a non-uuid.
            const page = await renderRecipesListPage(userId, {
                error: "That recipe is not in your household.",
            });
            return c.html(page.html, 404);
        };
        if (!UUID_RE.test(recipeId)) return notFound();
        const body = await c.req.parseBody();
        const expiry = parseShareExpiry(formText(body, "expires"));
        if (!expiry.ok) {
            const page = await renderRecipeDetailRoute(userId, recipeId, {
                error: BAD_EXPIRY,
                openModalId: RECIPE_SHARE_SHEET_ID,
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        const recipes = liveRecipesStore();
        let made: Made;
        try {
            made = await createShareLink(
                liveShareLinkStore(),
                {
                    householdId: member.householdId,
                    kind: "recipe",
                    targetId: recipeId,
                    createdBy: userId,
                    expiresInDays: expiry.days,
                },
                new Date(),
                recipes,
            );
        } catch (err) {
            if (err instanceof ShareLinkInputError) return notFound();
            throw err;
        }
        const recipe = await recipes.getRecipe(member.householdId, recipeId);
        c.header("Cache-Control", "no-store");
        return c.html(
            await createdPage(userId, member, getBaseUrl(c), made, {
                what: "recipe",
                name: recipe?.name ?? null,
                backHref: `/recipes/${recipeId}`,
                active: "recipes",
            }),
        );
    },
);

shareLinkManageRoutes.post(
    "/kitchen/groceries/share",
    requireMember,
    gatedRoute("mcp-share-links", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const expiry = parseShareExpiry(formText(body, "expires"));
        if (!expiry.ok) {
            const page = await renderGroceryListPage(userId, {
                error: BAD_EXPIRY,
                openModalId: GROCERY_SHARE_SHEET_ID,
            });
            return c.html(page.html, page.status === 200 ? 400 : page.status);
        }
        let made: Made;
        try {
            made = await createShareLink(
                liveShareLinkStore(),
                {
                    householdId: member.householdId,
                    kind: "grocery_list",
                    targetId: null,
                    createdBy: userId,
                    expiresInDays: expiry.days,
                },
                new Date(),
                liveRecipesStore(),
            );
        } catch (err) {
            if (err instanceof ShareLinkInputError) {
                const page = await renderGroceryListPage(userId, {
                    error: err.message,
                    openModalId: GROCERY_SHARE_SHEET_ID,
                });
                return c.html(page.html, 400);
            }
            throw err;
        }
        c.header("Cache-Control", "no-store");
        return c.html(
            await createdPage(userId, member, getBaseUrl(c), made, {
                what: "grocery list",
                name: null,
                backHref: "/kitchen/groceries",
                active: "grocery",
            }),
        );
    },
);

// Revoking is idempotent: a link already revoked answers like a fresh one. A
// link of another household, an unknown id and a non-uuid are the same 404
// (the store scopes the update to the session's household).
shareLinkManageRoutes.post(
    "/settings/household/shared-links/:id/revoke",
    requireMember,
    gatedRoute("mcp-share-links", { notFound: true }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const link = await revokeShareLink(
            liveShareLinkStore(),
            member.householdId,
            c.req.param("id"),
            new Date(),
        );
        if (!link) {
            const page = await renderHouseholdSettingsRoute(userId, {
                error: "That link was not found.",
            });
            return c.html(page.html, 404);
        }
        return redirectWithToast(
            c,
            "/settings/household",
            "settings.household.shared-link.revoked",
        );
    },
);
