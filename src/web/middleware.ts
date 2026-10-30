import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { beginSiteLogin } from "../oauth.js";
import {
    requireManager as managerCheck,
    requireOwner as ownerCheck,
    type HouseholdMember,
} from "../household.js";
import { getHouseholdMembership } from "../db/household.js";
import { readSiteSession, SITE_COOKIE } from "../site-session.js";
import { forbiddenDashboardHtml } from "./loaders.js";

declare module "hono" {
    interface ContextVariableMap {
        userId: string;
        member: HouseholdMember | null;
    }
}

export function siteUserId(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${SITE_COOKIE}=([^;]+)`),
    );
    if (!match?.[1]) return null;
    return readSiteSession(decodeURIComponent(match[1]));
}

export function siteMember(c: Context): HouseholdMember {
    const member = c.get("member");
    if (member == null) {
        throw new Error(
            "web: requireMember/requireManager/requireOwner must run first",
        );
    }
    return member;
}

export const requireSiteUser = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    c.set("userId", userId);
    return next();
});

export const requireMember = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    const member = await getHouseholdMembership(userId);
    if (member == null) return c.html(forbiddenDashboardHtml(), 403);
    c.set("userId", userId);
    c.set("member", member);
    return next();
});

export const requireOwner = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    const member = await getHouseholdMembership(userId);
    const check = ownerCheck(member);
    if (!check.ok) return c.html(forbiddenDashboardHtml(), 403);
    c.set("userId", userId);
    c.set("member", check.member);
    return next();
});

/** Owner or admin. */
export const requireManager = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    const member = await getHouseholdMembership(userId);
    const check = managerCheck(member);
    if (!check.ok) return c.html(forbiddenDashboardHtml(), 403);
    c.set("userId", userId);
    c.set("member", check.member);
    return next();
});
