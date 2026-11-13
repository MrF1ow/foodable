// GET /s/:token: the public page for a share link. No sign-in, no cookie
// read, no account chrome. The token names one recipe or the grocery list of
// one household and grants nothing else.
//
// GET /s/:token.json: the same link as a portable recipe document (see
// domain/sharing-document.ts) for another deploy's importer. Recipe links
// only. No credentials are involved and the token is a bearer secret, so the
// global CORS policy (src/index.ts) is harmless here. It goes through the same
// rate limit, token check, flag check and 404 as the page.
//
// Every refusal is the same 404 (same status, body and headers): an unknown,
// malformed, expired or revoked token, a recipe that was deleted, a link whose
// object cannot be loaded, and a deploy where the pages are not switched on.
// A visitor cannot tell them apart, so they cannot probe which tokens exist.
//
// Not exempted anywhere, by where it is mounted (src/index.ts): it comes
// before the flash-toast and legacy-redirect middleware, so neither touches
// it, and the page has no toast region for a visitor's own cookie to paint
// onto anyway. There is no CSRF layer to exempt (the page is GET only, with no
// form), and the Turbo login reload meta only lives on the login template.

import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { rateLimitKeyForIp } from "../../client-ip.js";
import { withActor } from "../../db/actor.js";
import { getHouseholdMembership } from "../../db/household.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveShareLinkStore } from "../../db/share-links.js";
import type { AuthContext } from "../../auth-context.js";
import {
    resolveShareToken,
    type ShareLink,
    type ShareLinkStore,
    type ShareView,
} from "../../domain/sharing.js";
import { buildFlagContext } from "../../flags.js";
import { clientIp } from "../../middleware.js";
import { checkShareRateLimit } from "../../rate-limit.js";
import { isViewerFlagOn, loadViewerFlags } from "../../viewer-flags.js";
import type { ShareDocument } from "../../domain/sharing-document.js";
import { renderShareViewPage } from "../pages/share-view.js";
import { loadShareDocument, loadShareView } from "./share-links-load.js";

/** One body for every refusal, so a caller cannot tell the causes apart. */
export const SHARE_NOT_FOUND_BODY = "Not found";

/**
 * Sent on every /s/* response. The page is a credential in a URL: it must not
 * be indexed, must not leak the URL through Referer, and must not sit in a
 * cache (a revoked link has to stop working at once). The CSP is tighter than
 * the app's: the page has no script, no form and nothing to connect to.
 */
const SHARE_HEADERS = {
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

/**
 * Whether the public page answers for this link. A share page needs no
 * sign-in, so it is open only while `mcp-share-links` is on, evaluated for the
 * subject that minted this link: the member who created it, in the link's
 * household, with that member's role when they are still in it. A link whose
 * creator is gone is judged as its household. Anyone opening the link is never
 * the subject: a visitor has no identity.
 *
 * The flag is the only switch: links from the app and from an agent follow it
 * alike, and with it off every link answers the standard 404.
 */
export async function shareLinksEnabledFor(link: ShareLink): Promise<boolean> {
    const auth: AuthContext =
        link.createdBy === null
            ? { kind: "household", householdId: link.householdId }
            : { kind: "user", userId: link.createdBy };
    // The membership read is household-scoped, so it runs as the link's
    // household; a creator who has since left simply has no member.
    const member =
        link.createdBy === null
            ? null
            : await withActor(
                  { kind: "household", householdId: link.householdId },
                  () =>
                      getHouseholdMembership(link.createdBy!, link.householdId),
              );
    const flags = await loadViewerFlags(
        buildFlagContext({
            auth,
            member,
            householdId: link.householdId,
        }),
    );
    return isViewerFlagOn(flags, "mcp-share-links");
}

export type ShareLinksDeps = {
    links: ShareLinkStore;
    /** The view for a live link, or null when its object cannot be loaded. */
    load(link: ShareLink): Promise<ShareView | null>;
    /**
     * The portable recipe document for a live recipe link (`/s/:token.json`),
     * or null when there is none: a grocery-list link, a recipe that cannot
     * be loaded, or one outside the document's bounds.
     */
    loadDocument(link: ShareLink): Promise<ShareDocument | null>;
    enabled(link: ShareLink): Promise<boolean>;
    now(): Date;
    /** Per-IP budget check; false when the caller is over it. */
    allow(
        c: Context,
    ): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
};

/**
 * The shared object is read as the link's household, not as the system: row
 * level security then confines every read to that household, whatever the
 * link's `targetId` says.
 */
function liveLoad(link: ShareLink): Promise<ShareView | null> {
    return withActor({ kind: "household", householdId: link.householdId }, () =>
        loadShareView(link, {
            recipes: liveRecipesStore(),
            grocery: liveGroceryStore(),
            settings: liveSettingsStore(),
        }),
    );
}

function liveLoadDocument(link: ShareLink): Promise<ShareDocument | null> {
    return withActor({ kind: "household", householdId: link.householdId }, () =>
        loadShareDocument(link, {
            recipes: liveRecipesStore(),
            foods: liveFoodsStore(),
        }),
    );
}

function liveDeps(): ShareLinksDeps {
    return {
        links: liveShareLinkStore(),
        load: liveLoad,
        loadDocument: liveLoadDocument,
        enabled: shareLinksEnabledFor,
        now: () => new Date(),
        allow: (c) => checkShareRateLimit(rateLimitKeyForIp(clientIp(c))),
    };
}

const DOCUMENT_SUFFIX = ".json";

function notFound(c: Context) {
    return c.body(SHARE_NOT_FOUND_BODY, 404, {
        "Content-Type": "text/plain; charset=utf-8",
    });
}

const shareHeaders: MiddlewareHandler = async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SHARE_HEADERS)) {
        c.res.headers.set(name, value);
    }
};

export function createShareLinksRoutes(
    overrides: Partial<ShareLinksDeps> = {},
): Hono {
    const deps: ShareLinksDeps = { ...liveDeps(), ...overrides };
    const router = new Hono();

    router.use("/s", shareHeaders);
    router.use("/s/*", shareHeaders);

    // One route for the page and the document: `/s/<token>` is the page and
    // `/s/<token>.json` the portable recipe. A token is base64url, so it never
    // holds a ".", and the suffix is stripped exactly once, only when it is
    // exactly ".json": `<token>.JSON`, `<token>.json.json` and the like leave
    // a non-token that resolves to nothing, the same 404 as any other.
    router.get("/s/:file", async (c) => {
        const budget = await deps.allow(c);
        if (!budget.allowed) {
            c.header("Retry-After", String(budget.retryAfterSeconds ?? 60));
            return c.text("Too many requests", 429);
        }
        const file = c.req.param("file");
        const wantsDocument = file.endsWith(DOCUMENT_SUFFIX);
        const token = wantsDocument
            ? file.slice(0, -DOCUMENT_SUFFIX.length)
            : file;
        const link = await resolveShareToken(deps.links, token, deps.now());
        if (!link) return notFound(c);
        if (!(await deps.enabled(link))) return notFound(c);
        if (wantsDocument) {
            // Recipes only: a grocery-list link has no document.
            if (link.kind !== "recipe") return notFound(c);
            const doc = await deps.loadDocument(link);
            if (!doc) return notFound(c);
            // No credentials are involved and the token is a bearer secret,
            // so the global CORS policy is harmless here.
            return c.body(JSON.stringify(doc), 200, {
                "Content-Type": "application/json; charset=utf-8",
            });
        }
        const view = await deps.load(link);
        if (!view) return notFound(c);
        return c.html(renderShareViewPage(view));
    });

    // Anything else under /s (no token, a path past the token, a POST) is the
    // same 404 as a bad token.
    router.all("/s", (c) => notFound(c));
    router.all("/s/*", (c) => notFound(c));

    return router;
}

export const shareLinksRoutes = createShareLinksRoutes();
