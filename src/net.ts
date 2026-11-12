import { isIP } from "node:net";
import { tryDecodeURI } from "hono/utils/url";
import { normalizeIp } from "./client-ip.js";

// Coarsen a client IP before it ever reaches a log line. A full IP is personal
// data; for diagnosing traffic we only need subnet-level granularity to tell a
// single-source flood from distributed traffic — never to identify or block an
// individual. IPv4 keeps the first three octets, IPv6 the first three hextets,
// with the host portion replaced by "x". The full address is never returned.
export function maskIp(ip: string | undefined): string {
    if (!ip || ip === "unknown") return "-";
    const raw = normalizeIp(ip);
    if (!raw || raw === "unknown") return "-";
    if (isIP(raw) === 6 || raw.includes(":")) {
        const head = raw.split("::")[0]!.split(":").filter(Boolean).slice(0, 3);
        return head.length ? head.join(":") + ":x" : "-";
    }
    if (isIP(raw) === 4) {
        const octets = raw.split(".");
        if (octets.length !== 4 || octets.some((o) => o === "")) return "-";
        return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
    }
    return "-";
}

/**
 * The path the router matches: Hono's own decode of the request path
 * (`getPath` in hono/utils/url), reproduced here because a raw path with
 * "%73" for "s" reaches the share page too. One decode only, with "%25" kept
 * encoded, so "%2573" stays "%2573" and routes nowhere; a malformed escape
 * decodes piecewise instead of throwing.
 */
function routedPath(pathname: string): string {
    if (!pathname.includes("%")) return pathname;
    return tryDecodeURI(
        pathname.includes("%25") ? pathname.replace(/%25/g, "%2525") : pathname,
    );
}

/**
 * Strip export download tokens and share link tokens before a path hits the
 * access log. A share token is the whole credential for a public page.
 * The match runs on the path the router sees, so a percent-encoded spelling of
 * the first segment ("/%73/<token>") is redacted like "/s/<token>".
 */
export function redactPathForAccessLog(pathname: string): string {
    // Collapse repeated slashes and ignore case before matching, so
    // "//exports/<token>" or "/Exports/<token>" never logs the token either
    // (the router is stricter than this; over-redacting costs nothing).
    let routed: string;
    try {
        routed = routedPath(pathname);
    } catch {
        // Not reachable with Hono's decoder, which never throws; if a future
        // one does, a path we cannot read is a path we do not print.
        return "/[redacted]";
    }
    const [, first = "", ...rest] = routed.replace(/\/{2,}/g, "/").split("/");
    if (first.toLowerCase() === "exports" && rest.join("/") !== "") {
        return "/exports/[redacted]";
    }
    if (first.toLowerCase() === "s" && rest.join("/") !== "") {
        return "/s/[redacted]";
    }
    return pathname;
}
