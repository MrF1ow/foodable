import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
    CLOUDFLARE_IPV4_CIDRS,
    CLOUDFLARE_IPV6_CIDRS,
} from "./cloudflare-ips.js";

export type ClientIpSource = "socket" | "x-real-ip" | "x-forwarded-for";

export type ClientIpConfig = {
    source: ClientIpSource;
    sourceIsDefault: boolean;
    trustedHops: number;
    cloudflareOriginSecret: string | null;
};

const ORIGIN_SECRET_HEADER = "x-foodable-origin-secret";
const MAX_TRUSTED_HOPS = 10;
const OBSCURED = new Set(["unknown", "anonymous", "hidden", "redacted"]);

function ipv4StringToBytes(ip: string): Uint8Array | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const out = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
        const o = Number(parts[i]);
        if (!Number.isInteger(o) || o < 0 || o > 255) return null;
        out[i] = o;
    }
    return out;
}

/** Parse a pure IPv6 address (no zone, no brackets) into 16 bytes. */
export function parseIpv6ToBytes(ip: string): Uint8Array | null {
    let s = ip.toLowerCase();
    const zone = s.indexOf("%");
    if (zone !== -1) s = s.slice(0, zone);

    const embeddedV4 = (): boolean => {
        const lastColon = s.lastIndexOf(":");
        if (lastColon < 0) return false;
        const tail = s.slice(lastColon + 1);
        if (!tail.includes(".")) return false;
        const v4 = ipv4StringToBytes(tail);
        if (!v4) return false;
        const head = s.slice(0, lastColon);
        const high = ((v4[0]! << 8) | v4[1]!).toString(16);
        const low = ((v4[2]! << 8) | v4[3]!).toString(16);
        s = `${head}:${high}:${low}`;
        return true;
    };
    embeddedV4();

    const hasDouble = s.includes("::");
    let hextets: string[];
    if (!hasDouble) {
        const left = s.split(":").filter((p) => p.length > 0);
        if (left.length !== 8) return null;
        hextets = left;
    } else {
        const [head, tail] = s.split("::");
        const left = head ? head.split(":").filter((p) => p.length > 0) : [];
        const right =
            tail !== undefined
                ? tail.split(":").filter((p) => p.length > 0)
                : [];
        const missing = 8 - left.length - right.length;
        if (missing < 0) return null;
        hextets = [...left, ...Array(missing).fill("0"), ...right];
        if (hextets.length !== 8) return null;
    }

    const out = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
        const h = hextets[i]!;
        if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
        const n = parseInt(h, 16);
        if (n > 0xffff) return null;
        out[i * 2] = (n >> 8) & 0xff;
        out[i * 2 + 1] = n & 0xff;
    }
    return out;
}

function isIpv4Mapped(bytes: Uint8Array): boolean {
    for (let i = 0; i < 10; i++) {
        if (bytes[i] !== 0) return false;
    }
    return bytes[10] === 0xff && bytes[11] === 0xff;
}

function formatRfc5952(bytes: Uint8Array): string {
    const groups: number[] = [];
    for (let i = 0; i < 8; i++) {
        groups.push((bytes[i * 2]! << 8) | bytes[i * 2 + 1]!);
    }
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 0; i < 8;) {
        if (groups[i] === 0) {
            let j = i;
            while (j < 8 && groups[j] === 0) j++;
            const len = j - i;
            if (len > bestLen) {
                bestLen = len;
                bestStart = i;
            }
            i = j;
        } else {
            i++;
        }
    }
    let out = "";
    for (let i = 0; i < 8;) {
        if (bestLen >= 2 && i === bestStart) {
            out += "::";
            i += bestLen;
            continue;
        }
        if (out.length > 0 && !out.endsWith(":")) out += ":";
        out += groups[i]!.toString(16);
        i++;
    }
    return out;
}

function canonicalizeIpv6Host(s: string): string | null {
    const bytes = parseIpv6ToBytes(s);
    if (!bytes) return null;
    if (isIpv4Mapped(bytes)) {
        return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    }
    return formatRfc5952(bytes);
}

/** Trim and validate a single IP string from a header or socket address. */
export function normalizeIp(raw: string | undefined): string | null {
    if (raw == null) return null;
    let s = raw.trim();
    if (
        (s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))
    ) {
        s = s.slice(1, -1).trim();
    }
    if (!s || OBSCURED.has(s.toLowerCase())) return null;

    if (s.startsWith("[")) {
        const close = s.indexOf("]");
        if (close === -1) return null;
        s = s.slice(1, close);
    } else if (s.includes(".") && s.includes(":")) {
        const lastColon = s.lastIndexOf(":");
        const host = s.slice(0, lastColon);
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) s = host;
    }
    // No port stripping for unbracketed IPv6: "1:2:3:4:5:6:7:8:9" is not
    // "1:2:3:4:5:6:7:8" with a port, it is invalid. Proxies bracket IPv6 when
    // they add a port.

    const zone = s.indexOf("%");
    if (zone !== -1) s = s.slice(0, zone);

    const kind = isIP(s);
    if (kind === 0) return null;

    if (kind === 4) return s;

    return canonicalizeIpv6Host(s);
}

function originSecretMatches(
    configured: string,
    provided: string | undefined,
): boolean {
    if (provided == null) return false;
    const a = createHash("sha256").update(configured, "utf8").digest();
    const b = createHash("sha256").update(provided.trim(), "utf8").digest();
    return timingSafeEqual(a, b);
}

export function parseClientIpConfig(
    env: Record<string, string | undefined>,
): ClientIpConfig {
    if (
        Object.prototype.hasOwnProperty.call(env, "TRUST_CLOUDFLARE") &&
        env.TRUST_CLOUDFLARE != null &&
        env.TRUST_CLOUDFLARE !== ""
    ) {
        throw new Error(
            "TRUST_CLOUDFLARE is no longer supported; set CLOUDFLARE_ORIGIN_SECRET and configure the Cloudflare request header transform rule instead",
        );
    }

    const railway = (env.RAILWAY_ENVIRONMENT_ID ?? "").trim();
    let source: ClientIpSource;
    const sourceRaw = (env.CLIENT_IP_SOURCE ?? "").trim();
    const sourceIsDefault = sourceRaw === "";
    if (sourceIsDefault) {
        source = railway ? "x-real-ip" : "socket";
    } else {
        const lowered = sourceRaw.toLowerCase();
        if (
            lowered === "socket" ||
            lowered === "x-real-ip" ||
            lowered === "x-forwarded-for"
        ) {
            source = lowered;
        } else {
            throw new Error(
                "Invalid CLIENT_IP_SOURCE (expected socket, x-real-ip, or x-forwarded-for)",
            );
        }
    }

    let trustedHops = 1;
    const hopsRaw = (env.TRUSTED_PROXY_HOPS ?? "").trim();
    if (hopsRaw !== "") {
        if (!/^[1-9][0-9]*$/.test(hopsRaw)) {
            throw new Error(
                "Invalid TRUSTED_PROXY_HOPS (expected a positive integer without leading zeros)",
            );
        }
        const n = Number(hopsRaw);
        if (n > MAX_TRUSTED_HOPS) {
            throw new Error(
                `Invalid TRUSTED_PROXY_HOPS (maximum is ${MAX_TRUSTED_HOPS})`,
            );
        }
        trustedHops = n;
    }

    let cloudflareOriginSecret: string | null = null;
    const secretEnv = env.CLOUDFLARE_ORIGIN_SECRET;
    if (secretEnv != null && secretEnv !== "") {
        const trimmed = secretEnv.trim();
        if (trimmed.length < 32) {
            throw new Error(
                "CLOUDFLARE_ORIGIN_SECRET must be at least 32 characters when set",
            );
        }
        cloudflareOriginSecret = trimmed;
    }

    return { source, sourceIsDefault, trustedHops, cloudflareOriginSecret };
}

function xffEntries(combined: string | undefined): string[] {
    if (!combined) return [];
    return combined
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}

function pickFromXff(
    header: (name: string) => string | undefined,
    trustedHops: number,
): string | null {
    const raw = header("x-forwarded-for");
    const entries = xffEntries(raw);
    if (entries.length < trustedHops) return null;
    const idx = entries.length - trustedHops;
    return normalizeIp(entries[idx]!);
}

/** Resolved client address for rate limits and access logs. */
export function resolveClientIp(
    input: {
        header: (name: string) => string | undefined;
        socketIp?: string | null;
    },
    config: ClientIpConfig,
): string {
    const socketNorm = normalizeIp(input.socketIp ?? undefined);

    let resolved: string | null = null;
    switch (config.source) {
        case "socket":
            resolved = socketNorm;
            break;
        case "x-real-ip":
            resolved = normalizeIp(input.header("x-real-ip"));
            break;
        case "x-forwarded-for":
            resolved = pickFromXff(input.header, config.trustedHops);
            break;
    }

    if (!resolved) {
        if (socketNorm) resolved = socketNorm;
        else return "unknown";
    }

    if (
        config.cloudflareOriginSecret &&
        isCloudflareIp(resolved) &&
        originSecretMatches(
            config.cloudflareOriginSecret,
            input.header(ORIGIN_SECRET_HEADER),
        )
    ) {
        const cf = normalizeIp(input.header("cf-connecting-ip"));
        if (cf) return cf;
    }

    return resolved;
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const o = Number(p);
        if (!Number.isInteger(o) || o < 0 || o > 255) return null;
        n = (n << 8) + o;
    }
    return n >>> 0;
}

function parseIpv4Cidr(cidr: string): { network: number; mask: number } | null {
    const [addr, bitsStr] = cidr.split("/");
    if (!addr || !bitsStr) return null;
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    const network = ipv4ToInt(addr);
    if (network == null) return null;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return { network: network & mask, mask };
}

function ipv6BytesToBigInt(bytes: Uint8Array): bigint {
    let n = 0n;
    for (const b of bytes) {
        n = (n << 8n) + BigInt(b);
    }
    return n;
}

function parseIpv6Cidr(cidr: string): { prefix: bigint; bits: number } | null {
    const [addr, bitsStr] = cidr.split("/");
    if (!addr || !bitsStr) return null;
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null;
    const norm = normalizeIp(addr);
    if (!norm || isIP(norm) !== 6) return null;
    const bytes = parseIpv6ToBytes(norm);
    if (!bytes) return null;
    const n = ipv6BytesToBigInt(bytes);
    const shift = 128n - BigInt(bits);
    const prefix = bits === 0 ? 0n : (n >> shift) << shift;
    return { prefix, bits };
}

function ipv6InCidr(ip: string, cidr: string): boolean {
    const parsed = parseIpv6Cidr(cidr);
    if (!parsed) return false;
    const norm = normalizeIp(ip);
    if (!norm || isIP(norm) !== 6) return false;
    const bytes = parseIpv6ToBytes(norm);
    if (!bytes) return false;
    const n = ipv6BytesToBigInt(bytes);
    const shift = 128n - BigInt(parsed.bits);
    const prefix = parsed.bits === 0 ? 0n : (n >> shift) << shift;
    return prefix === parsed.prefix;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
    const parsed = parseIpv4Cidr(cidr);
    if (!parsed) return false;
    const host = ipv4ToInt(ip);
    if (host == null) return false;
    return (host & parsed.mask) === parsed.network;
}

export function isCloudflareIp(ip: string): boolean {
    const norm = normalizeIp(ip);
    if (!norm) return false;
    const kind = isIP(norm);
    if (kind === 4) {
        return CLOUDFLARE_IPV4_CIDRS.some((c) => ipv4InCidr(norm, c));
    }
    if (kind === 6) {
        return CLOUDFLARE_IPV6_CIDRS.some((c) => ipv6InCidr(norm, c));
    }
    return false;
}

/** Key auth rate limits and bans on — IPv6 /64 for shared-egress fairness. */
export function rateLimitKeyForIp(ip: string): string {
    if (ip === "unknown") return "unknown";
    const norm = normalizeIp(ip);
    if (!norm) return "unknown";
    if (isIP(norm) === 4) return norm;
    const bytes = parseIpv6ToBytes(norm);
    if (!bytes) return "unknown";
    const groups: number[] = [];
    for (let i = 0; i < 4; i++) {
        groups.push((bytes[i * 2]! << 8) | bytes[i * 2 + 1]!);
    }
    const prefix = groups.map((g) => g.toString(16)).join(":");
    return `${prefix}::/64`;
}

// Per instance by design: parsed CLIENT_IP_* env snapshot; stable for the life of the process.
let cachedConfig: ClientIpConfig | null = null;
// Per instance by design: test hook only.
let testConfigOverride: ClientIpConfig | null = null;

export function getClientIpConfig(): ClientIpConfig {
    if (testConfigOverride) return testConfigOverride;
    if (!cachedConfig) {
        // Read only the variables this module uses, by name.
        cachedConfig = parseClientIpConfig({
            CLIENT_IP_SOURCE: process.env.CLIENT_IP_SOURCE,
            TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
            CLOUDFLARE_ORIGIN_SECRET: process.env.CLOUDFLARE_ORIGIN_SECRET,
            TRUST_CLOUDFLARE: process.env.TRUST_CLOUDFLARE,
            RAILWAY_ENVIRONMENT_ID: process.env.RAILWAY_ENVIRONMENT_ID,
        });
    }
    return cachedConfig;
}

export function setClientIpConfigForTests(config: ClientIpConfig | null): void {
    testConfigOverride = config;
}

export function clientIpConfigBootLine(config: ClientIpConfig): string {
    // Built from literals and the hop count only, so no configured value
    // (least of all the origin secret) can reach the log.
    let source: string;
    switch (config.source) {
        case "socket":
            source = "socket";
            break;
        case "x-real-ip":
            source = config.sourceIsDefault
                ? "x-real-ip (Railway default)"
                : "x-real-ip";
            break;
        case "x-forwarded-for":
            source = `x-forwarded-for, hops=${Number(config.trustedHops)}`;
            break;
    }
    const cf = config.cloudflareOriginSecret === null ? "off" : "on";
    return `[net] client address from ${source}, cloudflare=${cf}`;
}
