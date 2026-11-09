import type { Context, Next } from "hono";
import type { AuthContext } from "./auth-context.js";
import { rateLimitKey } from "./auth-context.js";
import { withActor } from "./db/actor.js";
import {
    actorForValidBearer,
    lookupBearerAsSystem,
} from "./household-token.js";
import { maskIp } from "./net.js";
import { resourceMetadataUrl } from "./discovery.js";
import { getBaseUrl } from "./url.js";
import { getConnInfo } from "hono/bun";
import {
    getClientIpConfig,
    rateLimitKeyForIp,
    resolveClientIp,
} from "./client-ip.js";

// Declare the context variables this middleware sets. Without it, c.get/c.set on
// an untyped `new Hono()` app types its keys as `never`, so index.ts cannot read
// suppressAccessLog.
declare module "hono" {
    interface ContextVariableMap {
        authContext: AuthContext;
        accessToken: string;
        suppressAccessLog: boolean;
        clientIp: string;
        // The protocol era /mcp actually negotiated for this request, set by
        // handleMcp and read by the access log in index.ts. Optional: requests
        // refused before the SDK builds a server never carry one.
        mcpEra: "legacy" | "modern";
        // Sanitized "name/version" of the MCP client, when the protocol carried
        // it. Modern requests carry it in the envelope every time; 2025-era
        // requests only on `initialize`.
        mcpClient: string;
    }
}
import {
    checkRateLimit,
    checkAuthRateLimit,
    noteAuthFailure,
    clearAuthFailures,
    getBanState,
} from "./rate-limit.js";

function socketIpFromContext(c: Context): string | null {
    try {
        return getConnInfo(c).remote.address ?? null;
    } catch {
        return null;
    }
}

/** Which normalized address rate limits and bans are keyed on (memoized on context). */
export function clientIp(c: Context): string {
    const memo = c.get("clientIp");
    if (memo !== undefined) return memo;

    const config = getClientIpConfig();
    const resolved = resolveClientIp(
        {
            header: (name) => c.req.header(name),
            socketIp: socketIpFromContext(c),
        },
        config,
    );
    c.set("clientIp", resolved);
    return resolved;
}

function rateLimitIp(c: Context): string {
    return rateLimitKeyForIp(clientIp(c));
}

// Shared 401 path. Every rejection also counts a strike against the client IP so
// a client that never recovers eventually gets shed by banRepeatAuthFailures.
function rejectUnauthenticated(
    c: Context,
    error: "unauthorized" | "invalid_token",
    description: string,
) {
    const ip = rateLimitIp(c);
    const ban = noteAuthFailure(ip);
    // Reaching here means the ban guard let the request through, so a banned
    // result is necessarily a *newly* tripped ban — log the transition once
    // rather than on every suppressed request that follows.
    if (ban.banned) {
        console.log(
            `[ban] ${maskIp(clientIp(c))} repeated auth failures on ${c.req.path} — shedding for ${ban.retryAfterSeconds}s`,
        );
    }

    c.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${resourceMetadataUrl(getBaseUrl(c))}"`,
    );
    return c.json({ error, error_description: description }, 401);
}

export const authenticateBearer = async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return rejectUnauthenticated(
            c,
            "unauthorized",
            "Bearer token required",
        );
    }

    const token = authHeader.substring(7);
    const lookup = await lookupBearerAsSystem(token);

    if (lookup.status === "unavailable") {
        // We could not verify the token, so this is not the client's fault:
        // answer 401 as before, but record no strike. Otherwise a database
        // outage would ban every active user and outlast the outage itself.
        c.header(
            "WWW-Authenticate",
            `Bearer resource_metadata="${resourceMetadataUrl(getBaseUrl(c))}"`,
        );
        return c.json(
            {
                error: "invalid_token",
                error_description: "Unable to verify token, try again",
            },
            401,
        );
    }

    if (lookup.status === "invalid") {
        return rejectUnauthenticated(
            c,
            "invalid_token",
            "Token is invalid or expired",
        );
    }

    // A success clears the IP's strike count. This is what keeps a shared egress
    // IP — one broken client alongside working ones — from ever accumulating the
    // consecutive failures a ban requires.
    clearAuthFailures(rateLimitIp(c));

    c.set("accessToken", token);
    const authContext: AuthContext =
        lookup.kind === "user"
            ? { kind: "user", userId: lookup.userId }
            : { kind: "household", householdId: lookup.householdId };
    c.set("authContext", authContext);
    const actor = await actorForValidBearer(lookup);
    return withActor(actor, () => next());
};

// Sheds clients that have failed authentication many times in a row — in
// practice an abandoned MCP client retrying a dead token indefinitely. Runs
// ahead of authenticateBearer so a banned IP costs one Map lookup instead of a
// token verification, and marks the request so the access log skips it: a single
// stuck client can otherwise outnumber real traffic in the logs by an order of
// magnitude and hide everything worth seeing.
export const banRepeatAuthFailures = async (c: Context, next: Next) => {
    const ban = getBanState(rateLimitIp(c));
    if (ban.banned) {
        c.set("suppressAccessLog", true);
        c.header("Retry-After", String(ban.retryAfterSeconds ?? 60));
        return c.json(
            {
                error: "rate_limited",
                error_description: `Too many failed authentication attempts. Retry after ${ban.retryAfterSeconds}s.`,
            },
            429,
        );
    }
    await next();
};

// Per-IP rate limiter for the unauthenticated OAuth endpoints, where there is
// no user id yet. Guards against bulk signups and credential stuffing.
export const rateLimitAuth = async (c: Context, next: Next) => {
    const result = checkAuthRateLimit(rateLimitIp(c));
    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds ?? 60));
        return c.json(
            {
                error: "rate_limited",
                error_description: `Rate limit exceeded (${result.limit} requests per minute). Retry after ${result.retryAfterSeconds}s.`,
            },
            429,
        );
    }
    await next();
};

export const rateLimit = async (c: Context, next: Next) => {
    const auth = c.get("authContext");
    if (!auth) {
        await next();
        return;
    }
    const result = checkRateLimit(rateLimitKey(auth));
    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds ?? 60));
        return c.json(
            {
                error: "rate_limited",
                error_description: `Rate limit exceeded (${result.limit} requests per minute). Retry after ${result.retryAfterSeconds}s.`,
            },
            429,
        );
    }
    await next();
};
