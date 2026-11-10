import { createMiddleware } from "hono/factory";
import { buildFlagContext, type FlagName } from "../flags.js";
import { getHouseholdMembership } from "../db/household.js";
import type { HouseholdMember } from "../household.js";
import {
    loadViewerFlags,
    isViewerFlagOn,
    type ViewerFlags,
} from "../viewer-flags.js";

/**
 * Runs after requireMember / requireOwner / requireManager / requireSiteUser.
 * Those middlewares must set userId; member-bearing ones set member as well.
 */
export const GATED_ROUTE = Symbol.for("foodable.gatedRoute");

export type GatedRouteMeta =
    { flag: FlagName; redirectTo: string } | { flag: FlagName; notFound: true };

export function gatedRouteInfo(handler: unknown): GatedRouteMeta | undefined {
    if (typeof handler !== "function") return undefined;
    const meta = Object.getOwnPropertyDescriptor(handler, GATED_ROUTE)
        ?.value as GatedRouteMeta | undefined;
    return meta;
}

declare module "hono" {
    interface ContextVariableMap {
        viewerFlags: ViewerFlags;
    }
}

export function gatedRoute(
    flag: FlagName,
    opts: { redirectTo: string } | { notFound: true },
) {
    const meta: GatedRouteMeta =
        "notFound" in opts && opts.notFound === true
            ? { flag, notFound: true }
            : { flag, redirectTo: (opts as { redirectTo: string }).redirectTo };
    const middleware = createMiddleware(async (c, next) => {
        const userId = c.get("userId");
        if (!userId) {
            throw new Error(
                "gatedRoute: declare an auth middleware before gatedRoute",
            );
        }
        let member = c.get("member") as HouseholdMember | null | undefined;
        if (member == null) {
            member = await getHouseholdMembership(userId);
        }
        const flagCtx = buildFlagContext({
            auth: { kind: "user", userId },
            member,
        });
        const flags = await loadViewerFlags(flagCtx);
        c.set("viewerFlags", flags);
        if (isViewerFlagOn(flags, flag)) {
            return next();
        }
        const method = c.req.method;
        if (method === "GET" || method === "HEAD") {
            if ("notFound" in meta && meta.notFound) {
                return c.text("Not found", 404);
            }
            return c.redirect(
                "redirectTo" in meta ? meta.redirectTo : "/",
                302,
            );
        }
        return c.text("Not found", 404);
    });
    Object.defineProperty(middleware, GATED_ROUTE, {
        value: meta,
        enumerable: false,
        configurable: true,
    });
    return middleware;
}
