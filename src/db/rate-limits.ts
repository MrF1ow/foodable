import { maybeOne, rows, run } from "./sql.js";

/** Mirrors in-memory auth failure tracking for the Postgres store. */
export interface BanEntry {
    strikes: number;
    lastFailureAt: number;
    /** Epoch ms; 0 when not banned. */
    bannedUntil: number;
    escalation: number;
}

export interface HitResult {
    count: number;
    windowStartMs: number;
    windowEndMs: number;
}

export interface SweepStaleResult {
    buckets: number;
    bans: number;
}

const ESCALATION_DECAY_MS = 6 * 60 * 60 * 1000;

function banFromRow(row: Record<string, unknown>): BanEntry {
    const bannedUntil = row.banned_until;
    return {
        strikes: Number(row.strikes),
        escalation: Number(row.escalation),
        lastFailureAt: Date.parse(String(row.last_failure_at)),
        bannedUntil: bannedUntil == null ? 0 : Date.parse(String(bannedUntil)),
    };
}

function rowToMs(ts: unknown): number {
    return Date.parse(String(ts));
}

export async function dbNow(): Promise<number> {
    const data = await run(async (tx) => {
        const got = await rows<{ ms: string }>(
            tx,
            tx`
                select (extract(epoch from now()) * 1000)::bigint::text as ms
            `,
        );
        return got;
    });
    return Number(data[0]!.ms);
}

export async function hit(key: string, windowMs: number): Promise<HitResult> {
    const windowSec = windowMs / 1000;
    return run(async (tx) => {
        const got = await maybeOne<{
            count: number;
            window_start: string;
        }>(
            tx,
            tx`
                insert into public.rate_limit_buckets (key, window_start, count)
                values (
                    ${key},
                    to_timestamp(
                        floor(extract(epoch from now()) / ${windowSec})
                            * ${windowSec}
                    ),
                    1
                )
                on conflict (key, window_start) do update
                set count = rate_limit_buckets.count + 1
                returning count, window_start
            `,
            "rate limit hit",
        );
        const windowStartMs = rowToMs(got!.window_start);
        const windowEndMs = windowStartMs + windowMs;
        return {
            count: Number(got!.count),
            windowStartMs,
            windowEndMs,
        };
    });
}

export async function loadBan(ipKey: string): Promise<BanEntry | null> {
    return run(async (tx) => {
        const row = await maybeOne<Record<string, unknown>>(
            tx,
            tx`
                select strikes, escalation, last_failure_at, banned_until
                from public.auth_bans
                where ip_key = ${ipKey}
            `,
            "load auth ban",
        );
        return row ? banFromRow(row) : null;
    });
}

export async function saveBan(ipKey: string, entry: BanEntry): Promise<void> {
    const lastFailureAt = new Date(entry.lastFailureAt).toISOString();
    const bannedUntil =
        entry.bannedUntil > 0
            ? new Date(entry.bannedUntil).toISOString()
            : null;
    await run(async (tx) => {
        await tx`
            insert into public.auth_bans (
                ip_key,
                strikes,
                escalation,
                last_failure_at,
                banned_until,
                updated_at
            )
            values (
                ${ipKey},
                ${entry.strikes},
                ${entry.escalation},
                ${lastFailureAt}::timestamptz,
                ${bannedUntil}::timestamptz,
                now()
            )
            on conflict (ip_key) do update
            set
                strikes = excluded.strikes,
                escalation = excluded.escalation,
                last_failure_at = excluded.last_failure_at,
                banned_until = excluded.banned_until,
                updated_at = now()
        `;
    });
}

export async function clearBan(ipKey: string): Promise<void> {
    await run(async (tx) => {
        await tx`
            delete from public.auth_bans
            where ip_key = ${ipKey}
        `;
    });
}

export async function withBanLock<T>(
    ipKey: string,
    fn: (existing: BanEntry | null) => Promise<T>,
): Promise<T> {
    return run(async (tx) => {
        await tx`
            insert into public.auth_bans (
                ip_key, strikes, escalation, last_failure_at, banned_until
            )
            values (${ipKey}, 0, 0, now(), null)
            on conflict (ip_key) do nothing
        `;
        const locked = await maybeOne<Record<string, unknown>>(
            tx,
            tx`
                select strikes, escalation, last_failure_at, banned_until
                from public.auth_bans
                where ip_key = ${ipKey}
                for update
            `,
            "lock auth ban",
        );
        const existing = locked ? banFromRow(locked) : null;
        return fn(existing);
    });
}

export async function sweepStale(windowMs: number): Promise<SweepStaleResult> {
    const windowSec = windowMs / 1000;
    const escalationSec = ESCALATION_DECAY_MS / 1000;
    return run(async (tx) => {
        const bucketDeleted = await rows<{ _: number }>(
            tx,
            tx`
                delete from public.rate_limit_buckets
                where window_start < to_timestamp(
                    extract(epoch from now()) - ${windowSec}
                )
                returning 1 as _
            `,
        );
        const banDeleted = await rows<{ _: number }>(
            tx,
            tx`
                delete from public.auth_bans
                where
                    (banned_until is null or banned_until <= now())
                    and last_failure_at <= now()
                        - (${escalationSec}::double precision * interval '1 second')
                returning 1 as _
            `,
        );
        return {
            buckets: bucketDeleted.length,
            bans: banDeleted.length,
        };
    });
}
