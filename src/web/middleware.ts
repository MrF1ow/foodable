import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { beginSiteLogin } from "../oauth.js";
import {
    requireManager as managerCheck,
    requireOwner as ownerCheck,
    type HouseholdMember,
} from "../household.js";
import {
    actorFromAuthContext,
    runAsSystem,
    withActor,
    withSiteMembershipPeek,
} from "../db/actor.js";
import { getHouseholdMembership } from "../db/household.js";
import { recordUserSeen } from "../last-seen.js";
import { readSiteSession, SITE_COOKIE } from "../site-session.js";
import { forbiddenDashboardHtml } from "./loaders.js";

declare module "hono" {
    interface ContextVariableMap {
        userId: string;
        member: HouseholdMember | null;
        siteMembershipResolved?: boolean;
        siteMembership?: HouseholdMember | null;
    }
}

async function ensureSiteMembershipResolved(
    c: Context,
    userId: string,
): Promise<HouseholdMember | null> {
    if (c.get("siteMembershipResolved")) {
        return c.get("siteMembership") ?? null;
    }
    // Every signed-in site request counts as the user being active: pages,
    // form posts and the widget frames a page embeds. Static assets never get
    // here and MCP has its own token use. Fire and forget: the recorder
    // throttles to one write an hour and never rejects, so no request waits on
    // it or fails because of it.
    void recordUserSeen(userId);
    const member = await runAsSystem("site membership", () =>
        getHouseholdMembership(userId),
    );
    c.set("siteMembershipResolved", true);
    c.set("siteMembership", member);
    if (member != null) {
        c.set("member", member);
    }
    return member;
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
    const member = await ensureSiteMembershipResolved(c, userId);
    const auth = { kind: "user" as const, userId };
    return withActor(
        actorFromAuthContext(auth, member?.householdId ?? null),
        () => withSiteMembershipPeek(member, () => next()),
    );
});

export const requireMember = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    const member = await ensureSiteMembershipResolved(c, userId);
    if (member == null) return c.html(forbiddenDashboardHtml(), 403);
    c.set("userId", userId);
    c.set("member", member);
    const auth = { kind: "user" as const, userId };
    return withActor(actorFromAuthContext(auth, member.householdId), () =>
        withSiteMembershipPeek(member, () => next()),
    );
});

export const requireOwner = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    const member = await ensureSiteMembershipResolved(c, userId);
    const check = ownerCheck(member);
    if (!check.ok) return c.html(forbiddenDashboardHtml(), 403);
    c.set("userId", userId);
    c.set("member", check.member);
    const auth = { kind: "user" as const, userId };
    return withActor(actorFromAuthContext(auth, check.member.householdId), () =>
        withSiteMembershipPeek(check.member, () => next()),
    );
});

/** Owner or admin. */
export const requireManager = createMiddleware(async (c, next) => {
    const userId = siteUserId(c.req.header("cookie"));
    if (!userId) return beginSiteLogin(c, c.req.query("locale"));
    const member = await ensureSiteMembershipResolved(c, userId);
    const check = managerCheck(member);
    if (!check.ok) return c.html(forbiddenDashboardHtml(), 403);
    c.set("userId", userId);
    c.set("member", check.member);
    const auth = { kind: "user" as const, userId };
    return withActor(actorFromAuthContext(auth, check.member.householdId), () =>
        withSiteMembershipPeek(check.member, () => next()),
    );
});
