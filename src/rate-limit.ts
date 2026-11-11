// Request rate limits and auth bans. The rules are pure functions; the state
// lives behind a store: in memory for tests, in Postgres in production, so
// every instance counts against the same windows and sees the same bans.

import { runAsSystem } from "./db/actor.js";
import {
    readBan as dbReadBan,
    resetAll as dbResetAll,
    sweepStale,
    takeSlot,
    withBanLock as dbWithBanLock,
    type SlotCheck,
} from "./db/rate-limits.js";

export const WINDOW_MS = 60_000;
// Per-user limit for authenticated MCP traffic, keyed by user id.
export const LIMIT_PER_WINDOW = 60;
// Per-user limit for the household app's log search, which may call Open Food
// Facts; its own bucket so typing in the search never eats the MCP budget.
export const WEB_SEARCH_LIMIT_PER_WINDOW = 120;
// Tighter per-IP limit for the unauthenticated OAuth endpoints. Users have no
// user id yet at this stage, so we key on client IP. A full login flow is only
// a handful of requests (authorize → approve → token), so this leaves ample
// headroom for legitimate use — even shared NAT'd IPs — while blocking bulk
// signup/credential-stuffing abuse.
export const AUTH_LIMIT_PER_WINDOW = 30;

// Strike-based banning for IPs that keep failing authentication. A sliding
// window alone can't distinguish "client with a stale token retrying" from
// "attacker enumerating credentials", so we count *consecutive* failures: any
// successful auth from the IP wipes the slate. That's what keeps a corporate
// NAT — one broken client sharing an egress IP with real users — off the ban
// list, since its successes keep interrupting the run of failures.
export const BAN_STRIKE_THRESHOLD = 20;
// Escalating ban lengths for repeat offenders, capped at the last entry so a
// persistent attacker plateaus rather than being locked out permanently.
export const BAN_DURATIONS_MS = [5, 10, 20, 40, 60].map((m) => m * 60_000);
// Strikes are only "consecutive" if they're close together — an IP that
// trickles a stray 401 every so often should never accumulate its way to a ban.
export const STRIKE_DECAY_MS = 10 * 60_000;
// Forgive the escalation level too, eventually, so a one-off bad afternoon
// doesn't make an IP a permanent repeat offender.
export const ESCALATION_DECAY_MS = 6 * 60 * 60_000;

const SWEEP_INTERVAL_MS = 10 * 60_000;

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds?: number;
    remaining: number;
    limit: number;
}

export interface BanState {
    banned: boolean;
    retryAfterSeconds?: number;
}

export interface AuthFailureEntry {
    // Consecutive failures since the last success, ban, or decay.
    strikes: number;
    lastFailureAt: number;
    // Epoch ms the current ban ends; 0 when not banned.
    bannedUntil: number;
    // Index into BAN_DURATIONS_MS for the *next* ban this IP earns.
    escalation: number;
}

/** Where windows and ban entries live. Every method reads its own clock. */
export interface RateLimitStore {
    /** Count one request against `key` if its window has room. */
    checkBucket(
        key: string,
        limit: number,
        windowMs: number,
    ): Promise<RateLimitResult>;
    readBan(
        ip: string,
    ): Promise<{ entry: AuthFailureEntry | null; now: number }>;
    /**
     * Read-modify-write one ban entry atomically. With `create: false`, a
     * missing entry is passed as null and nothing is stored for it unless `fn`
     * returns one.
     */
    updateBan<T>(
        ip: string,
        fn: (
            existing: AuthFailureEntry | null,
            now: number,
        ) => { entry: AuthFailureEntry | null; result: T },
        opts: { create: boolean },
    ): Promise<T>;
    reset(): Promise<void>;
}

/** The ban state could not be read or written; callers must not treat it as "not banned". */
export class BanStoreUnavailableError extends Error {
    constructor(cause: unknown) {
        super(
            `ban store unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
        );
        this.name = "BanStoreUnavailableError";
    }
}

const NOT_BANNED: BanState = { banned: false };

function bannedState(bannedUntil: number, now: number): BanState {
    // Round up and floor at 1: a Retry-After of 0 invites an instant retry.
    return {
        banned: true,
        retryAfterSeconds: Math.max(1, Math.ceil((bannedUntil - now) / 1000)),
    };
}

function emptyEntry(now: number): AuthFailureEntry {
    return { strikes: 0, lastFailureAt: now, bannedUntil: 0, escalation: 0 };
}

/** One failed (401) unauthenticated attempt applied to an IP's entry. */
export function applyAuthFailure(
    current: AuthFailureEntry | null,
    now: number,
): { entry: AuthFailureEntry; state: BanState } {
    const entry = current ? { ...current } : emptyEntry(now);
    const idle = now - entry.lastFailureAt;
    if (idle >= ESCALATION_DECAY_MS) {
        entry.escalation = 0;
        entry.strikes = 0;
    } else if (idle >= STRIKE_DECAY_MS) {
        entry.strikes = 0;
    }
    entry.lastFailureAt = now;

    if (entry.bannedUntil > now) {
        // Deliberately no strike, no extension: a client hammering through its
        // ban would otherwise renew it forever and never get a chance to come
        // back with a fixed token. Escalation is earned by tripping a *new*
        // ban after this one expires, not by keeping this one alive.
        return { entry, state: bannedState(entry.bannedUntil, now) };
    }

    entry.strikes++;
    if (entry.strikes >= BAN_STRIKE_THRESHOLD) {
        const duration =
            BAN_DURATIONS_MS[
                Math.min(entry.escalation, BAN_DURATIONS_MS.length - 1)
            ]!;
        entry.bannedUntil = now + duration;
        entry.escalation++;
        // Start the next run from scratch; the ban itself is the punishment
        // for the strikes just spent.
        entry.strikes = 0;
        return { entry, state: bannedState(entry.bannedUntil, now) };
    }

    return { entry, state: NOT_BANNED };
}

/**
 * Clear strikes and any active ban, after a successful auth. The escalation
 * level survives, so an attacker can't launder a repeat-offender record with a
 * single valid request between rounds. Null means nothing is left worth
 * remembering.
 */
export function applyClearAuthFailures(
    current: AuthFailureEntry,
): AuthFailureEntry | null {
    if (current.escalation === 0) return null;
    return { ...current, strikes: 0, bannedUntil: 0 };
}

export function banStateFromEntry(
    entry: AuthFailureEntry | null,
    now: number,
): BanState {
    if (!entry || entry.bannedUntil <= now) return NOT_BANNED;
    return bannedState(entry.bannedUntil, now);
}

/**
 * Exact sliding window over the timestamps of counted requests (the memory
 * store). A refused request is not counted.
 */
export function slidingLogCheck(
    timestamps: number[],
    limit: number,
    windowMs: number,
    now: number,
): { result: RateLimitResult; timestamps: number[] } {
    const cutoff = now - windowMs;
    let keepFrom = 0;
    while (keepFrom < timestamps.length && timestamps[keepFrom]! <= cutoff) {
        keepFrom++;
    }
    const kept = keepFrom === 0 ? timestamps : timestamps.slice(keepFrom);

    if (kept.length >= limit) {
        const oldest = kept[0]!;
        return {
            result: {
                allowed: false,
                retryAfterSeconds: Math.max(
                    1,
                    Math.ceil((oldest + windowMs - now) / 1000),
                ),
                remaining: 0,
                limit,
            },
            timestamps: kept,
        };
    }

    kept.push(now);
    return {
        result: { allowed: true, remaining: limit - kept.length, limit },
        timestamps: kept,
    };
}

/**
 * The answer for one Postgres bucket check. The window there is counted per
 * second rather than per request, so Retry-After names the moment the oldest
 * counted second leaves the window, the same rule the memory store applies to
 * its oldest request.
 */
export function slotCheckResult(
    check: SlotCheck,
    limit: number,
    windowMs: number,
): RateLimitResult {
    if (check.taken !== null) {
        return {
            allowed: true,
            remaining: Math.max(0, limit - check.others - check.taken),
            limit,
        };
    }
    return {
        allowed: false,
        retryAfterSeconds: Math.max(
            1,
            Math.ceil((check.oldestMs + windowMs - check.nowMs) / 1000),
        ),
        remaining: 0,
        limit,
    };
}

export function createMemoryRateLimitStore(options?: {
    now?: () => number;
}): RateLimitStore {
    // Per instance by design: in-process store for tests; production uses createPostgresRateLimitStore at boot.
    const buckets = new Map<string, number[]>();
    const bans = new Map<string, AuthFailureEntry>();
    const clock = options?.now ?? (() => Date.now());

    return {
        async checkBucket(key, limit, windowMs) {
            const { result, timestamps } = slidingLogCheck(
                buckets.get(key) ?? [],
                limit,
                windowMs,
                clock(),
            );
            buckets.set(key, timestamps);
            return result;
        },
        async readBan(ip) {
            const entry = bans.get(ip);
            return { entry: entry ? { ...entry } : null, now: clock() };
        },
        async updateBan(ip, fn, opts) {
            const now = clock();
            const found = bans.get(ip);
            const existing = found
                ? { ...found }
                : opts.create
                  ? emptyEntry(now)
                  : null;
            const { entry, result } = fn(existing, now);
            if (entry === null) bans.delete(ip);
            else bans.set(ip, { ...entry });
            return result;
        },
        async reset() {
            buckets.clear();
            bans.clear();
        },
    };
}

/**
 * The production store. Every check is one transaction that reads the time
 * from Postgres; `now` exists for tests, which pin the instant so rollover and
 * expiry are deterministic.
 *
 * Bucket windows are kept per second (see `takeSlot`), so a request made
 * part-way through a second leaves the window up to one second earlier than
 * it would in the memory store's exact log. Requests on whole seconds behave
 * identically.
 */
export function createPostgresRateLimitStore(options?: {
    now?: () => number | undefined;
}): RateLimitStore {
    const pinned = options?.now ?? (() => undefined);

    return {
        async checkBucket(key, limit, windowMs) {
            const check = await runAsSystem("rate limit bucket", () =>
                takeSlot(key, limit, windowMs, pinned()),
            );
            return slotCheckResult(check, limit, windowMs);
        },
        async readBan(ip) {
            const got = await runAsSystem("read auth ban", () =>
                dbReadBan(ip, pinned()),
            );
            return { entry: got.entry, now: got.nowMs };
        },
        async updateBan(ip, fn, opts) {
            return runAsSystem("update auth ban", () =>
                dbWithBanLock(ip, async (existing, now) => fn(existing, now), {
                    create: opts.create,
                    nowMs: pinned(),
                }),
            );
        },
        async reset() {
            await runAsSystem("rate limit reset", () => dbResetAll());
        },
    };
}

// Per instance by design: pointer to the store implementation; production sets Postgres at boot so every instance shares windows and bans in the database.
let activeStore: RateLimitStore = createMemoryRateLimitStore();

export function setRateLimitStore(store: RateLimitStore): void {
    activeStore = store;
}

export function getRateLimitStore(): RateLimitStore {
    return activeStore;
}

// Request buckets fail open: a database blip must not take /mcp or sign-in
// down, and an unmetered minute is cheap. Bans do not (see getBanState).
async function bucketFailOpen(
    label: string,
    limit: number,
    fn: () => Promise<RateLimitResult>,
): Promise<RateLimitResult> {
    try {
        return await fn();
    } catch (err) {
        console.error(
            `[rate-limit] ${label} failed open:`,
            err instanceof Error ? err.message : String(err),
        );
        return { allowed: true, remaining: limit, limit };
    }
}

export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
    return bucketFailOpen("checkRateLimit", LIMIT_PER_WINDOW, () =>
        activeStore.checkBucket(`user:${userId}`, LIMIT_PER_WINDOW, WINDOW_MS),
    );
}

export async function checkWebSearchRateLimit(
    userId: string,
): Promise<RateLimitResult> {
    return bucketFailOpen(
        "checkWebSearchRateLimit",
        WEB_SEARCH_LIMIT_PER_WINDOW,
        () =>
            activeStore.checkBucket(
                `web-search:${userId}`,
                WEB_SEARCH_LIMIT_PER_WINDOW,
                WINDOW_MS,
            ),
    );
}

// Per-IP limiter for the unauthenticated OAuth endpoints.
export async function checkAuthRateLimit(ip: string): Promise<RateLimitResult> {
    return bucketFailOpen("checkAuthRateLimit", AUTH_LIMIT_PER_WINDOW, () =>
        activeStore.checkBucket(`auth:${ip}`, AUTH_LIMIT_PER_WINDOW, WINDOW_MS),
    );
}

/**
 * Record one failed (401) unauthenticated attempt from this IP and report the
 * resulting ban state. Throws BanStoreUnavailableError when the store fails,
 * so a broken store never reads as "not banned".
 */
export async function noteAuthFailure(ip: string): Promise<BanState> {
    try {
        return await activeStore.updateBan(
            ip,
            (existing, now) => {
                const applied = applyAuthFailure(existing, now);
                return { entry: applied.entry, result: applied.state };
            },
            { create: true },
        );
    } catch (err) {
        throw new BanStoreUnavailableError(err);
    }
}

/**
 * Clear strikes and any active ban for this IP, called whenever auth succeeds.
 * A store failure is logged and swallowed: the request is already
 * authenticated, and the strikes it could not clear only matter if the next
 * twenty attempts all fail.
 */
export async function clearAuthFailures(ip: string): Promise<void> {
    try {
        await activeStore.updateBan(
            ip,
            (existing) => ({
                entry: existing ? applyClearAuthFailures(existing) : null,
                result: undefined,
            }),
            { create: false },
        );
    } catch (err) {
        console.error(
            "[rate-limit] clearAuthFailures failed:",
            err instanceof Error ? err.message : String(err),
        );
    }
}

/**
 * Read-only view of the ban state; does not count as an attempt. Throws
 * BanStoreUnavailableError when the store fails: bans fail closed.
 */
export async function getBanState(ip: string): Promise<BanState> {
    try {
        const { entry, now } = await activeStore.readBan(ip);
        return banStateFromEntry(entry, now);
    } catch (err) {
        throw new BanStoreUnavailableError(err);
    }
}

// Exposed for tests.
export async function _resetBuckets(): Promise<void> {
    await activeStore.reset();
}

// Per instance by design: one timer and overlap guard per process; sweeps delete stale Postgres rows and are safe to run concurrently.
let sweepStarted = false;
let sweepRunning = false;

/** Periodic stale bucket and ban cleanup. Call once at server startup. */
export function startRateLimitSweep(): void {
    if (sweepStarted) return;
    sweepStarted = true;
    setInterval(() => {
        if (sweepRunning) return;
        sweepRunning = true;
        void runAsSystem("rate limit sweep", () => sweepStale(WINDOW_MS))
            .catch((err: unknown) => {
                console.error(
                    "[rate-limit] sweep failed:",
                    err instanceof Error ? err.message : String(err),
                );
            })
            .finally(() => {
                sweepRunning = false;
            });
    }, SWEEP_INTERVAL_MS);
}
