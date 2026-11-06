import robotsParser from "robots-parser";
import { VERSION } from "./version.js";

export const FOODABLE_USER_AGENT = `Mozilla/5.0 (compatible; Foodable/${VERSION}; +https://github.com/MrF1ow/foodable/blob/main/docs/fetcher.md)`;

const ROBOTS_UA = "Foodable";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 512 * 1024;
const MAX_PAGE_REDIRECTS = 3;
const MAX_ROBOTS_REDIRECTS = 5;
const DEFAULT_ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

export type FetchFailure =
    | "invalid_link"
    | "blocked_address"
    | "robots_disallowed"
    | "site_refused"
    | "not_found"
    | "timeout"
    | "too_large"
    | "bad_content_type"
    | "too_many_redirects"
    | "http_error"
    | "network_error";

export type FetchOutcome =
    | {
          ok: true;
          url: string;
          status: number;
          contentType: string;
          body: string;
      }
    | {
          ok: false;
          reason: FetchFailure;
          status: number | null;
          detail: string;
      };

export type SafeFetcher = ReturnType<typeof createSafeFetcher>;

type RobotsPolicy =
    | { kind: "allow_all" }
    | { kind: "disallow_all" }
    | { kind: "parsed"; body: string };

type RobotsCacheEntry = {
    expiresAt: number;
    policy: RobotsPolicy;
};

function parseIpv4(ip: string): number[] | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const octets: number[] = [];
    for (const part of parts) {
        if (part === "" || !/^\d+$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        octets.push(n);
    }
    return octets;
}

function ipv4InCidr(
    octets: number[],
    base: number[],
    prefixLen: number,
): boolean {
    const ip =
        ((octets[0]! << 24) |
            (octets[1]! << 16) |
            (octets[2]! << 8) |
            octets[3]!) >>>
        0;
    const network =
        ((base[0]! << 24) | (base[1]! << 16) | (base[2]! << 8) | base[3]!) >>>
        0;
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
    return (ip & mask) === (network & mask);
}

function stripIpv6Brackets(ip: string): string {
    const trimmed = ip.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function ipv4OctetsToHextets(octets: number[]): [bigint, bigint] {
    const v =
        ((octets[0]! << 24) |
            (octets[1]! << 16) |
            (octets[2]! << 8) |
            octets[3]!) >>>
        0;
    return [BigInt(v >>> 16), BigInt(v & 0xffff)];
}

function expandIpv6SegmentList(segments: string[]): string[] | null {
    const out: string[] = [];
    for (const seg of segments) {
        if (seg.includes(".")) {
            const octets = parseIpv4(seg);
            if (!octets) return null;
            const [hi, lo] = ipv4OctetsToHextets(octets);
            out.push(hi.toString(16), lo.toString(16));
        } else if (seg) {
            out.push(seg);
        }
    }
    return out;
}

function expandIpv6(ip: string): bigint[] | null {
    const lower = stripIpv6Brackets(ip).toLowerCase();
    if (!/^[0-9a-f:.]+$/i.test(lower)) return null;
    let head: string[];
    let tail: string[];
    if (lower.includes("::")) {
        const [h, t] = lower.split("::");
        const headRaw = h ? h.split(":").filter(Boolean) : [];
        const tailRaw = t ? t.split(":").filter(Boolean) : [];
        const headExpanded = expandIpv6SegmentList(headRaw);
        const tailExpanded = expandIpv6SegmentList(tailRaw);
        if (!headExpanded || !tailExpanded) return null;
        head = headExpanded;
        tail = tailExpanded;
    } else {
        const expanded = expandIpv6SegmentList(lower.split(":"));
        if (!expanded) return null;
        head = expanded;
        tail = [];
    }
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    const parts = [...head, ...Array(missing).fill("0"), ...tail];
    if (parts.length !== 8) return null;
    try {
        return parts.map((p) => BigInt(`0x${p}`));
    } catch {
        return null;
    }
}

function ipv6InCidr(
    parts: bigint[],
    base: bigint[],
    prefixLen: number,
): boolean {
    let ip = 0n;
    for (const part of parts) {
        ip = (ip << 16n) | part;
    }
    let network = 0n;
    for (const part of base) {
        network = (network << 16n) | part;
    }
    const shift = 128 - prefixLen;
    return ip >> BigInt(shift) === network >> BigInt(shift);
}

function isPrivateIpv4(octets: number[]): boolean {
    if (octets.join(".") === "255.255.255.255") return true;
    const checks: Array<[number[], number]> = [
        [[0, 0, 0, 0], 8],
        [[10, 0, 0, 0], 8],
        [[100, 64, 0, 0], 10],
        [[127, 0, 0, 0], 8],
        [[169, 254, 0, 0], 16],
        [[172, 16, 0, 0], 12],
        [[192, 0, 0, 0], 24],
        [[192, 0, 2, 0], 24],
        [[192, 168, 0, 0], 16],
        [[198, 18, 0, 0], 15],
        [[198, 51, 100, 0], 24],
        [[203, 0, 113, 0], 24],
        [[224, 0, 0, 0], 4],
        [[240, 0, 0, 0], 4],
    ];
    return checks.some(([base, len]) => ipv4InCidr(octets, base, len));
}

function isPrivateIpv6(parts: bigint[]): boolean {
    if (parts.every((p) => p === 0n)) return true;
    if (parts.slice(0, 7).every((p) => p === 0n) && parts[7] === 1n) {
        return true;
    }
    const checks: Array<[bigint[], number]> = [
        [[0xfc00n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], 7],
        [[0xfe80n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], 10],
        [[0xff00n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], 8],
        [[0x2001n, 0x0db8n, 0n, 0n, 0n, 0n, 0n, 0n], 32],
        [[0x0064n, 0xff9bn, 0n, 0n, 0n, 0n, 0n, 0n], 96],
        // 6to4 tunnels an IPv4 address inside the prefix; a recipe site never
        // needs one, so the whole prefix is refused.
        [[0x2002n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], 16],
    ];
    if (checks.some(([base, len]) => ipv6InCidr(parts, base, len))) {
        return true;
    }
    if (
        parts[0] === 0n &&
        parts[1] === 0n &&
        parts[2] === 0n &&
        parts[3] === 0n
    ) {
        if (parts[4] === 0n && parts[5] === 0xffffn) {
            const octets = [
                Number(parts[6]! >> 8n),
                Number(parts[6]! & 0xffn),
                Number(parts[7]! >> 8n),
                Number(parts[7]! & 0xffn),
            ];
            return isPrivateIpv4(octets);
        }
        if (parts[4] === 0n && parts[5] === 0n) {
            const v32 =
                (Number(parts[6]! >> 8n) << 24) |
                (Number(parts[6]! & 0xffn) << 16) |
                (Number(parts[7]! >> 8n) << 8) |
                Number(parts[7]! & 0xffn);
            const octets = [
                (v32 >>> 24) & 0xff,
                (v32 >>> 16) & 0xff,
                (v32 >>> 8) & 0xff,
                v32 & 0xff,
            ];
            return isPrivateIpv4(octets);
        }
    }
    return false;
}

export function isPublicAddress(ip: string): boolean {
    const trimmed = stripIpv6Brackets(ip.trim());
    if (!trimmed) return false;
    const v4 = parseIpv4(trimmed);
    if (v4) return !isPrivateIpv4(v4);
    if (trimmed.includes(":")) {
        const parts = expandIpv6(trimmed);
        if (!parts) return false;
        return !isPrivateIpv6(parts);
    }
    return false;
}

const BLOCKED_HOST_SUFFIXES = [
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
] as const;

function isBlockedHostname(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost") return true;
    for (const suffix of BLOCKED_HOST_SUFFIXES) {
        if (host === suffix.slice(1) || host.endsWith(suffix)) return true;
    }
    return false;
}

export function urlAllowedForFetch(url: URL): boolean {
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase();
    if (isBlockedHostname(host)) return false;
    const ipHost = stripIpv6Brackets(host);
    const isIpv4 = parseIpv4(ipHost) !== null;
    const isIpv6 = ipHost.includes(":");
    if (isIpv4 || isIpv6) {
        return isPublicAddress(ipHost);
    }
    return host.includes(".");
}

/** Settle with `"timeout"` as soon as `signal` aborts, so DNS and a
 *  redirect hop's robots.txt check share the page's one deadline. */
function beforeDeadline<T>(
    work: Promise<T>,
    signal: AbortSignal,
): Promise<T | "timeout"> {
    if (signal.aborted) return Promise.resolve("timeout");
    return new Promise((resolve, reject) => {
        const onAbort = () => resolve("timeout");
        signal.addEventListener("abort", onAbort, { once: true });
        work.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            },
        );
    });
}

async function resolveHost(
    host: string,
    resolve: (host: string) => Promise<string[]>,
): Promise<{ ok: true } | { ok: false; reason: FetchFailure; detail: string }> {
    try {
        const addresses = await resolve(host);
        if (addresses.length === 0) {
            return {
                ok: false,
                reason: "network_error",
                detail: "No addresses for host",
            };
        }
        for (const address of addresses) {
            if (!isPublicAddress(address)) {
                return {
                    ok: false,
                    reason: "blocked_address",
                    detail: address,
                };
            }
        }
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            reason: "network_error",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
}

function mediaType(contentType: string | null): string {
    if (!contentType) return "";
    return contentType.split(";")[0]!.trim().toLowerCase();
}

function decodeBody(bytes: Uint8Array, contentType: string | null): string {
    const type = contentType?.toLowerCase() ?? "";
    const charsetMatch = type.match(/charset=([^\s;]+)/i);
    const charset = charsetMatch?.[1]?.replace(/"/g, "").toLowerCase();
    if (charset === "latin1" || charset === "iso-8859-1") {
        return new TextDecoder("latin1").decode(bytes);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

type BodyStreamReadResult = Awaited<
    ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>
>;

async function readWithAbortSignal(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal,
): Promise<BodyStreamReadResult> {
    if (!signal) return reader.read();
    if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort);
        reader.read().then(
            (result) => {
                signal.removeEventListener("abort", onAbort);
                resolve(result);
            },
            (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            },
        );
    });
}

async function readBodyStream(
    response: Response,
    maxBytes: number,
    signal?: AbortSignal,
): Promise<
    | { ok: true; bytes: Uint8Array }
    | { ok: false; reason: FetchFailure; detail: string }
> {
    if (signal?.aborted) {
        return { ok: false, reason: "timeout", detail: "Aborted" };
    }
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader) {
        const len = Number(lengthHeader);
        if (Number.isFinite(len) && len > maxBytes) {
            return { ok: false, reason: "too_large", detail: lengthHeader };
        }
    }
    const reader = response.body?.getReader();
    if (!reader) {
        return { ok: true, bytes: new Uint8Array() };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        if (signal?.aborted) {
            await reader.cancel();
            return { ok: false, reason: "timeout", detail: "Aborted" };
        }
        let readResult: BodyStreamReadResult;
        try {
            readResult = await readWithAbortSignal(
                reader as ReadableStreamDefaultReader<Uint8Array>,
                signal,
            );
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                await reader.cancel().catch(() => {});
                return { ok: false, reason: "timeout", detail: err.message };
            }
            throw err;
        }
        const { done, value } = readResult;
        if (done) break;
        if (value) {
            total += value.length;
            if (total > maxBytes) {
                await reader.cancel();
                return {
                    ok: false,
                    reason: "too_large",
                    detail: String(total),
                };
            }
            chunks.push(value);
        }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return { ok: true, bytes: out };
}

function classifyHttpStatus(status: number): FetchFailure | "ok" {
    if (status >= 200 && status < 300) return "ok";
    if (status === 401 || status === 403 || status === 429)
        return "site_refused";
    if (status === 404 || status === 410) return "not_found";
    return "http_error";
}

async function defaultResolve(host: string): Promise<string[]> {
    const results = await Bun.dns.lookup(host);
    return results.map((row) => row.address);
}

function pathAllowed(policy: RobotsPolicy, pageUrl: string): boolean {
    if (policy.kind === "allow_all") return true;
    if (policy.kind === "disallow_all") return false;
    const origin = new URL(pageUrl).origin;
    const parser = robotsParser(origin, policy.body);
    return parser.isAllowed(pageUrl, ROBOTS_UA) !== false;
}

type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createSafeFetcher(deps?: {
    fetch?: FetchFn;
    resolve?: (host: string) => Promise<string[]>;
    now?: () => number;
    robotsTtlMs?: number;
    defaultTimeoutMs?: number;
}) {
    const doFetch: FetchFn = deps?.fetch ?? globalThis.fetch.bind(globalThis);
    const resolve = deps?.resolve ?? defaultResolve;
    const now = deps?.now ?? (() => Date.now());
    const robotsTtlMs = deps?.robotsTtlMs ?? DEFAULT_ROBOTS_TTL_MS;
    const defaultTimeoutMs = deps?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const robotsCache = new Map<string, RobotsCacheEntry>();

    async function fetchBytes(
        url: URL,
        opts: {
            accept?: string[];
            timeoutMs: number;
            maxBytes: number;
            maxRedirects: number;
            enforceContentType: boolean;
        },
    ): Promise<FetchOutcome> {
        if (!urlAllowedForFetch(url)) {
            return {
                ok: false,
                reason: "invalid_link",
                status: null,
                detail: url.href,
            };
        }
        const resolved = await resolveHost(url.hostname, resolve);
        if (!resolved.ok) {
            return {
                ok: false,
                reason: resolved.reason,
                status: null,
                detail: resolved.detail,
            };
        }

        let current = url;
        let redirects = 0;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

        try {
            while (true) {
                let response: Response;
                try {
                    response = await doFetch(current.href, {
                        method: "GET",
                        redirect: "manual",
                        headers: {
                            "User-Agent": FOODABLE_USER_AGENT,
                            Accept: opts.accept
                                ? `${opts.accept.join(", ")}, */*;q=0.1`
                                : "*/*",
                            "Accept-Language": "en",
                        },
                        signal: controller.signal,
                    });
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    const reason =
                        err instanceof Error && err.name === "AbortError"
                            ? "timeout"
                            : "network_error";
                    return {
                        ok: false,
                        reason,
                        status: null,
                        detail: message,
                    };
                }

                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get("location");
                    if (!location) {
                        return {
                            ok: false,
                            reason: "http_error",
                            status: response.status,
                            detail: "Redirect without Location",
                        };
                    }
                    redirects += 1;
                    if (redirects > opts.maxRedirects) {
                        return {
                            ok: false,
                            reason: "too_many_redirects",
                            status: response.status,
                            detail: location,
                        };
                    }
                    let next: URL;
                    try {
                        next = new URL(location, current);
                    } catch {
                        return {
                            ok: false,
                            reason: "invalid_link",
                            status: response.status,
                            detail: location,
                        };
                    }
                    if (next.protocol !== "https:") {
                        return {
                            ok: false,
                            reason: "invalid_link",
                            status: response.status,
                            detail: next.protocol,
                        };
                    }
                    if (!urlAllowedForFetch(next)) {
                        return {
                            ok: false,
                            reason: "invalid_link",
                            status: response.status,
                            detail: next.href,
                        };
                    }
                    const hopResolved = await resolveHost(
                        next.hostname,
                        resolve,
                    );
                    if (!hopResolved.ok) {
                        return {
                            ok: false,
                            reason: hopResolved.reason,
                            status: response.status,
                            detail: hopResolved.detail,
                        };
                    }
                    current = next;
                    continue;
                }

                const status = response.status;
                const classified = classifyHttpStatus(status);
                if (classified !== "ok") {
                    return {
                        ok: false,
                        reason: classified,
                        status,
                        detail: response.statusText || String(status),
                    };
                }

                const contentType = response.headers.get("content-type") ?? "";
                if (opts.enforceContentType && opts.accept?.length) {
                    const type = mediaType(contentType);
                    if (!opts.accept.some((a) => a.toLowerCase() === type)) {
                        return {
                            ok: false,
                            reason: "bad_content_type",
                            status,
                            detail: contentType,
                        };
                    }
                }

                const bodyRead = await readBodyStream(
                    response,
                    opts.maxBytes,
                    controller.signal,
                );
                if (!bodyRead.ok) {
                    return {
                        ok: false,
                        reason: bodyRead.reason,
                        status,
                        detail: bodyRead.detail,
                    };
                }

                return {
                    ok: true,
                    url: current.href,
                    status,
                    contentType,
                    body: decodeBody(bodyRead.bytes, contentType),
                };
            }
        } finally {
            clearTimeout(timer);
        }
    }

    async function loadRobotsPolicy(host: string): Promise<RobotsPolicy> {
        const cacheKey = host.toLowerCase();
        const cached = robotsCache.get(cacheKey);
        if (cached && cached.expiresAt > now()) {
            return cached.policy;
        }

        const robotsUrl = new URL(`https://${host}/robots.txt`);
        const outcome = await fetchBytes(robotsUrl, {
            timeoutMs: defaultTimeoutMs,
            maxBytes: ROBOTS_MAX_BYTES,
            maxRedirects: MAX_ROBOTS_REDIRECTS,
            enforceContentType: false,
        });

        let policy: RobotsPolicy;
        if (!outcome.ok) {
            if (
                outcome.reason === "not_found" ||
                (outcome.status != null &&
                    outcome.status >= 400 &&
                    outcome.status < 500)
            ) {
                policy = { kind: "allow_all" };
            } else {
                policy = { kind: "disallow_all" };
            }
        } else if (outcome.status >= 500) {
            policy = { kind: "disallow_all" };
        } else {
            policy = { kind: "parsed", body: outcome.body };
        }

        robotsCache.set(cacheKey, {
            expiresAt: now() + robotsTtlMs,
            policy,
        });
        return policy;
    }

    async function robotsAllowsUrl(url: URL): Promise<boolean> {
        if (!urlAllowedForFetch(url)) return false;
        const policy = await loadRobotsPolicy(url.hostname);
        return pathAllowed(policy, url.href);
    }

    async function fetchPageWithRedirectChecks(
        start: URL,
        opts: {
            accept: string[];
            checkRobots: boolean;
            maxBytes: number;
            timeoutMs: number;
        },
    ): Promise<FetchOutcome> {
        // Known gap: the address is checked before the connection and fetch
        // cannot pin it (DNS rebinding). Accepted for a one-household app
        // behind sign-in.
        if (!urlAllowedForFetch(start)) {
            return {
                ok: false,
                reason: "invalid_link",
                status: null,
                detail: start.href,
            };
        }
        if (opts.checkRobots) {
            const allowed = await robotsAllowsUrl(start);
            if (!allowed) {
                return {
                    ok: false,
                    reason: "robots_disallowed",
                    status: null,
                    detail: start.pathname,
                };
            }
        }

        let current = start;
        let redirects = 0;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

        try {
            while (true) {
                const resolved = await beforeDeadline(
                    resolveHost(current.hostname, resolve),
                    controller.signal,
                );
                if (resolved === "timeout")
                    return {
                        ok: false,
                        reason: "timeout",
                        status: null,
                        detail: "deadline",
                    };
                if (!resolved.ok) {
                    return {
                        ok: false,
                        reason: resolved.reason,
                        status: null,
                        detail: resolved.detail,
                    };
                }

                let response: Response;
                try {
                    response = await doFetch(current.href, {
                        method: "GET",
                        redirect: "manual",
                        headers: {
                            "User-Agent": FOODABLE_USER_AGENT,
                            Accept: `${opts.accept.join(", ")}, */*;q=0.1`,
                            "Accept-Language": "en",
                        },
                        signal: controller.signal,
                    });
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    const reason =
                        err instanceof Error && err.name === "AbortError"
                            ? "timeout"
                            : "network_error";
                    return {
                        ok: false,
                        reason,
                        status: null,
                        detail: message,
                    };
                }

                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get("location");
                    if (!location) {
                        return {
                            ok: false,
                            reason: "http_error",
                            status: response.status,
                            detail: "Redirect without Location",
                        };
                    }
                    redirects += 1;
                    if (redirects > MAX_PAGE_REDIRECTS) {
                        return {
                            ok: false,
                            reason: "too_many_redirects",
                            status: response.status,
                            detail: location,
                        };
                    }
                    let next: URL;
                    try {
                        next = new URL(location, current);
                    } catch {
                        return {
                            ok: false,
                            reason: "invalid_link",
                            status: response.status,
                            detail: location,
                        };
                    }
                    if (next.protocol !== "https:") {
                        return {
                            ok: false,
                            reason: "invalid_link",
                            status: response.status,
                            detail: next.protocol,
                        };
                    }
                    if (!urlAllowedForFetch(next)) {
                        return {
                            ok: false,
                            reason: "invalid_link",
                            status: response.status,
                            detail: next.href,
                        };
                    }
                    const hopResolved = await beforeDeadline(
                        resolveHost(next.hostname, resolve),
                        controller.signal,
                    );
                    if (hopResolved === "timeout")
                        return {
                            ok: false,
                            reason: "timeout",
                            status: null,
                            detail: "deadline",
                        };
                    if (!hopResolved.ok) {
                        return {
                            ok: false,
                            reason: hopResolved.reason,
                            status: response.status,
                            detail: hopResolved.detail,
                        };
                    }
                    if (opts.checkRobots) {
                        const allowed = await beforeDeadline(
                            robotsAllowsUrl(next),
                            controller.signal,
                        );
                        if (allowed === "timeout")
                            return {
                                ok: false,
                                reason: "timeout",
                                status: null,
                                detail: "deadline",
                            };
                        if (!allowed) {
                            return {
                                ok: false,
                                reason: "robots_disallowed",
                                status: response.status,
                                detail: next.hostname,
                            };
                        }
                    }
                    current = next;
                    continue;
                }

                const status = response.status;
                const classified = classifyHttpStatus(status);
                if (classified !== "ok") {
                    return {
                        ok: false,
                        reason: classified,
                        status,
                        detail: response.statusText || String(status),
                    };
                }

                const contentType = response.headers.get("content-type") ?? "";
                const type = mediaType(contentType);
                if (!opts.accept.some((a) => a.toLowerCase() === type)) {
                    return {
                        ok: false,
                        reason: "bad_content_type",
                        status,
                        detail: contentType,
                    };
                }

                const bodyRead = await readBodyStream(
                    response,
                    opts.maxBytes,
                    controller.signal,
                );
                if (!bodyRead.ok) {
                    return {
                        ok: false,
                        reason: bodyRead.reason,
                        status,
                        detail: bodyRead.detail,
                    };
                }

                return {
                    ok: true,
                    url: current.href,
                    status,
                    contentType,
                    body: decodeBody(bodyRead.bytes, contentType),
                };
            }
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        robotsAllows(url: URL | string): Promise<boolean> {
            try {
                const parsed =
                    typeof url === "string" ? new URL(url) : new URL(url.href);
                return robotsAllowsUrl(parsed);
            } catch {
                return Promise.resolve(false);
            }
        },

        fetchPage(
            url: URL | string,
            opts: {
                accept: string[];
                checkRobots?: boolean;
                maxBytes?: number;
                timeoutMs?: number;
            },
        ): Promise<FetchOutcome> {
            try {
                const parsed =
                    typeof url === "string" ? new URL(url) : new URL(url.href);
                return fetchPageWithRedirectChecks(parsed, {
                    accept: opts.accept,
                    checkRobots: opts.checkRobots !== false,
                    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
                    timeoutMs: opts.timeoutMs ?? defaultTimeoutMs,
                });
            } catch {
                return Promise.resolve({
                    ok: false,
                    reason: "invalid_link",
                    status: null,
                    detail: String(url),
                });
            }
        },
    };
}
