import { rows, run, type Tx } from "./sql.js";

/** Mirrors in-memory auth failure tracking for the Postgres store. */
export interface BanEntry {
    strikes: number;
    lastFailureAt: number;
    /** Epoch ms; 0 when not banned. */
    bannedUntil: number;
    escalation: number;
}

export interface SweepStaleResult {
    buckets: number;
    bans: number;
}

/**
 * What one bucket check saw. `taken` is the current slot's count after this
 * request was counted, or null when the request was refused and not counted.
 */
export interface SlotCheck {
    nowMs: number;
    /** Requests in the window's earlier slots (the current slot excluded). */
    others: number;
    taken: number | null;
    /** Start of the oldest slot still inside the window (epoch ms). */
    oldestMs: number;
}

const ESCALATION_DECAY_MS = 6 * 60 * 60 * 1000;

// Every statement reads the time from Postgres so instances with skewed clocks
// still agree. Tests pass an explicit instant instead, so window rollover and
// ban expiry run deterministically against real Postgres.
function clockSql(tx: Tx, nowMs: number | undefined) {
    if (nowMs == null) return tx`now()`;
    return tx`${new Date(nowMs).toISOString()}::timestamptz`;
}

function msOrZero(value: unknown): number {
    return value == null ? 0 : Number(value);
}

function banFromRow(row: Record<string, unknown>): BanEntry {
    return {
        strikes: Number(row.strikes),
        escalation: Number(row.escalation),
        lastFailureAt: Number(row.last_failure_ms),
        bannedUntil: msOrZero(row.banned_until_ms),
    };
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

/**
 * Count one request against `key` if the sliding window has room, in one
 * statement. The window is kept as one row per second (`window_start` is the
 * second), so the check sums the seconds inside the window and counts the
 * request in the current second only when that sum stays under `limit`; a
 * refused request is not counted.
 *
 * Requests for one key are serialised by a transaction-level advisory lock
 * taken before the counting statement. Under Read Committed that statement
 * then reads every earlier commit for the key, so two instances racing on
 * one key (in the same second or across a second boundary) cannot both take
 * the last slot. Different keys never wait on each other.
 *
 * A second's row counts while its start is still inside the window, so a
 * request made part-way through a second leaves the window up to one second
 * early.
 */
export async function takeSlot(
    key: string,
    limit: number,
    windowMs: number,
    nowMs?: number,
): Promise<SlotCheck> {
    const windowSec = windowMs / 1000;
    return run(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${"rate_limit:" + key}, 0))`;
        const clock = clockSql(tx, nowMs);
        const [row] = await tx`
            with slot as (
                select
                    t,
                    date_trunc('second', t) as cur,
                    t - make_interval(secs => ${windowSec}::float8) as cutoff
                from (select ${clock} as t) clock
            ),
            others as (
                select
                    coalesce(sum(b.count), 0)::int as n,
                    min(b.window_start) as oldest
                from public.rate_limit_buckets b, slot
                where b.key = ${key}
                    and b.window_start > slot.cutoff
                    -- not "<": a request that started earlier but waited
                    -- on the lock must still count a later second's row
                    and b.window_start <> slot.cur
            ),
            taken as (
                insert into public.rate_limit_buckets as b (
                    key, window_start, count
                )
                select ${key}, slot.cur, 1
                from slot, others
                where others.n < ${limit}::int
                on conflict (key, window_start) do update
                set count = b.count + 1
                where b.count + (select n from others) < ${limit}::int
                returning b.count
            )
            select
                (select count from taken) as taken,
                others.n as others,
                (extract(epoch from slot.t) * 1000)::float8 as now_ms,
                (extract(epoch from least(others.oldest, slot.cur)) * 1000)
                    ::float8 as oldest_ms
            from slot, others
        `;
        return {
            nowMs: Number(row.now_ms),
            others: Number(row.others),
            taken: row.taken == null ? null : Number(row.taken),
            oldestMs: Number(row.oldest_ms),
        };
    });
}

/** The ban row for `ipKey` (null when none) and the time it was read at. */
export async function readBan(
    ipKey: string,
    nowMs?: number,
): Promise<{ entry: BanEntry | null; nowMs: number }> {
    return run(async (tx) => {
        const clock = clockSql(tx, nowMs);
        const [row] = await tx`
            select
                (extract(epoch from clock.t) * 1000)::float8 as now_ms,
                a.ip_key,
                a.strikes,
                a.escalation,
                (extract(epoch from a.last_failure_at) * 1000)::float8
                    as last_failure_ms,
                (extract(epoch from a.banned_until) * 1000)::float8
                    as banned_until_ms
            from (select ${clock} as t) clock
            left join public.auth_bans a on a.ip_key = ${ipKey}
        `;
        return {
            entry: row.ip_key == null ? null : banFromRow(row),
            nowMs: Number(row.now_ms),
        };
    });
}

/**
 * Read-modify-write one ban row under a row lock, in one transaction.
 *
 * With `create`, a missing row is first inserted as an empty entry
 * (no strikes, last failure now), which is what a first failure starts from,
 * so concurrent first failures still serialise on the row. Without it, a
 * missing row is passed as null and nothing is locked; clearing a row that
 * does not exist has nothing to race with.
 *
 * `fn` returns the entry to store, or null to delete the row.
 */
export async function withBanLock<T>(
    ipKey: string,
    fn: (
        existing: BanEntry | null,
        nowMs: number,
    ) => Promise<{ entry: BanEntry | null; result: T }>,
    opts: { create: boolean; nowMs?: number },
): Promise<T> {
    return run(async (tx) => {
        const clock = clockSql(tx, opts.nowMs);
        const [row] = opts.create
            ? await tx`
                with clock as (select ${clock} as t)
                insert into public.auth_bans as a (
                    ip_key, strikes, escalation, last_failure_at, banned_until
                )
                select ${ipKey}, 0, 0, clock.t, null from clock
                on conflict (ip_key) do update set ip_key = a.ip_key
                returning
                    (select (extract(epoch from t) * 1000)::float8 from clock)
                        as now_ms,
                    a.ip_key,
                    a.strikes,
                    a.escalation,
                    (extract(epoch from a.last_failure_at) * 1000)::float8
                        as last_failure_ms,
                    (extract(epoch from a.banned_until) * 1000)::float8
                        as banned_until_ms
            `
            : await tx`
                select
                    (extract(epoch from clock.t) * 1000)::float8 as now_ms,
                    a.ip_key,
                    a.strikes,
                    a.escalation,
                    (extract(epoch from a.last_failure_at) * 1000)::float8
                        as last_failure_ms,
                    (extract(epoch from a.banned_until) * 1000)::float8
                        as banned_until_ms
                from (select ${clock} as t) clock
                left join lateral (
                    select *
                    from public.auth_bans
                    where ip_key = ${ipKey}
                    for update
                ) a on true
            `;
        const existing = row.ip_key == null ? null : banFromRow(row);
        const { entry, result } = await fn(existing, Number(row.now_ms));
        if (entry !== null) {
            await saveBan(ipKey, entry);
        } else if (existing !== null) {
            await clearBan(ipKey);
        }
        return result;
    });
}

export async function loadBan(ipKey: string): Promise<BanEntry | null> {
    return (await readBan(ipKey)).entry;
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

/** Test helper: empty both tables. */
export async function resetAll(): Promise<void> {
    await run(async (tx) => {
        await tx`truncate public.rate_limit_buckets, public.auth_bans`;
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
