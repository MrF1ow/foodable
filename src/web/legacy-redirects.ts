import type { MiddlewareHandler } from "hono";
import { legacyRedirectTarget } from "./route-map.js";

export function legacyRedirects(): MiddlewareHandler {
    return async (c, next) => {
        const url = new URL(c.req.url);
        const target = legacyRedirectTarget(url.pathname + url.search);
        if (target == null) return next();
        const method = c.req.method;
        const status = method === "GET" || method === "HEAD" ? 301 : 308;
        // toast: none (legacy redirect; status is 301 or 308)
        return c.redirect(target, status);
    };
}
