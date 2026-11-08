import { isIP } from "node:net";
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

/** Strip export download tokens before a path hits the access log. */
export function redactPathForAccessLog(pathname: string): string {
    // Collapse repeated slashes and ignore case before matching, so
    // "//exports/<token>" or "/Exports/<token>" never logs the token either.
    const [, first = "", ...rest] = pathname.replace(/\/{2,}/g, "/").split("/");
    if (first.toLowerCase() === "exports" && rest.join("/") !== "") {
        return "/exports/[redacted]";
    }
    return pathname;
}
