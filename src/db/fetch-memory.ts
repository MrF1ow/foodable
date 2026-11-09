import type {
    DeadLinkRow,
    DeadLinkStatus,
    FetchMemoryStore,
    HostRefusalRow,
    RefusalStatus,
} from "../domain/fetch-memory.js";
import {
    createCachedFetchMemory,
    createMemoryFetchMemoryStore,
    deadLinkExpiry,
    refusalExpiry,
} from "../domain/fetch-memory.js";
import { rows, run } from "./sql.js";

// Per instance by design: lazy singleton wrapping Postgres with an in-process LRU (default 5 min TTL per entry).
let liveStore: FetchMemoryStore | null = null;

/** Returns the process-wide fetch-memory store (Postgres plus per-instance LRU). */
export function recipeFetchMemory(): FetchMemoryStore {
    if (!liveStore) {
        liveStore = createCachedFetchMemory(createPostgresFetchMemoryStore());
    }
    return liveStore;
}

export function setFetchMemoryStoreForTests(
    store: FetchMemoryStore | null,
): void {
    liveStore = store;
}

function refusalFromRow(row: Record<string, unknown>): HostRefusalRow {
    return {
        host: String(row.host),
        status: Number(row.status) as RefusalStatus,
        refusedAt: String(row.refused_at),
        expiresAt: String(row.expires_at),
    };
}

function deadFromRow(row: Record<string, unknown>): DeadLinkRow {
    return {
        urlHash: String(row.url_hash),
        url: String(row.url),
        status: Number(row.status) as DeadLinkStatus,
        seenAt: String(row.seen_at),
        expiresAt: row.expires_at == null ? null : String(row.expires_at),
    };
}

export function createPostgresFetchMemoryStore(): FetchMemoryStore {
    return {
        async getRefusal(householdId, host, now) {
            return run(async (tx) => {
                const data = await rows(
                    tx,
                    tx`
                        select host, status, refused_at, expires_at
                        from public.fetch_host_refusals
                        where
                            household_id = ${householdId}
                            and host = ${host}
                            and expires_at > ${now.toISOString()}
                    `,
                );
                const row = data[0] as Record<string, unknown> | undefined;
                return row ? refusalFromRow(row) : null;
            });
        },
        async recordRefusal(householdId, host, status, now) {
            const expiresAt = refusalExpiry(now).toISOString();
            await run(async (tx) => {
                await tx`
                    insert into public.fetch_host_refusals (
                        household_id,
                        host,
                        status,
                        refused_at,
                        expires_at
                    )
                    values (
                        ${householdId},
                        ${host},
                        ${status},
                        ${now.toISOString()},
                        ${expiresAt}
                    )
                    on conflict (household_id, host) do update
                    set
                        status = excluded.status,
                        refused_at = excluded.refused_at,
                        expires_at = excluded.expires_at
                `;
            });
        },
        async clearRefusal(householdId, host) {
            await run(async (tx) => {
                await tx`
                    delete from public.fetch_host_refusals
                    where
                        household_id = ${householdId}
                        and host = ${host}
                `;
            });
        },
        async listRefusals(householdId, opts) {
            return run(async (tx) => {
                const after = opts.after;
                const data = await rows(
                    tx,
                    after
                        ? tx`
                              select host, status, refused_at, expires_at
                              from public.fetch_host_refusals
                              where
                                  household_id = ${householdId}
                                  and expires_at > ${opts.now.toISOString()}
                                  and (refused_at, host) < (${after.refusedAt}::timestamptz, ${after.host})
                              order by refused_at desc, host desc
                              limit ${opts.limit}
                          `
                        : tx`
                              select host, status, refused_at, expires_at
                              from public.fetch_host_refusals
                              where
                                  household_id = ${householdId}
                                  and expires_at > ${opts.now.toISOString()}
                              order by refused_at desc, host desc
                              limit ${opts.limit}
                          `,
                );
                return (data as Record<string, unknown>[]).map(refusalFromRow);
            });
        },
        async getDeadLink(householdId, urlHash, now) {
            return run(async (tx) => {
                const data = await rows(
                    tx,
                    tx`
                        select url_hash, url, status, seen_at, expires_at
                        from public.dead_links
                        where
                            household_id = ${householdId}
                            and url_hash = ${urlHash}
                            and (
                                expires_at is null
                                or expires_at > ${now.toISOString()}
                            )
                    `,
                );
                const row = data[0] as Record<string, unknown> | undefined;
                return row ? deadFromRow(row) : null;
            });
        },
        async recordDeadLink(householdId, urlHash, url, status, now) {
            const excludedExpiry =
                status === 410 ? null : deadLinkExpiry(404, now)!.toISOString();
            await run(async (tx) => {
                await tx`
                    insert into public.dead_links (
                        household_id,
                        url_hash,
                        url,
                        status,
                        seen_at,
                        expires_at
                    )
                    values (
                        ${householdId},
                        ${urlHash},
                        ${url},
                        ${status},
                        ${now.toISOString()},
                        ${excludedExpiry}
                    )
                    on conflict (household_id, url_hash) do update
                    set
                        url = excluded.url,
                        seen_at = excluded.seen_at,
                        status = case
                            when dead_links.status = 410 then dead_links.status
                            when excluded.status = 410 then excluded.status
                            else excluded.status
                        end,
                        expires_at = case
                            when dead_links.status = 410 then null
                            when excluded.status = 410 then null
                            else excluded.expires_at
                        end
                `;
            });
        },
        async clearDeadLink(householdId, urlHash) {
            await run(async (tx) => {
                await tx`
                    delete from public.dead_links
                    where
                        household_id = ${householdId}
                        and url_hash = ${urlHash}
                `;
            });
        },
        async sweepExpired(now, batchSize) {
            return run(async (tx) => {
                let total = 0;
                const cap = 10_000;
                const nowIso = now.toISOString();
                for (let i = 0; i < cap; i++) {
                    const deleted = await rows<{ _: number }>(
                        tx,
                        tx`
                            delete from public.fetch_host_refusals
                            where ctid in (
                                select ctid
                                from public.fetch_host_refusals
                                where expires_at <= ${nowIso}
                                limit ${batchSize}
                            )
                            returning 1 as _
                        `,
                    );
                    const n1 = deleted.length;
                    total += n1;
                    if (n1 < batchSize) break;
                }
                for (let i = 0; i < cap; i++) {
                    const deleted = await rows<{ _: number }>(
                        tx,
                        tx`
                            delete from public.dead_links
                            where ctid in (
                                select ctid
                                from public.dead_links
                                where
                                    expires_at is not null
                                    and expires_at <= ${nowIso}
                                limit ${batchSize}
                            )
                            returning 1 as _
                        `,
                    );
                    const n2 = deleted.length;
                    total += n2;
                    if (n2 < batchSize) break;
                }
                return total;
            });
        },
    };
}

export { createMemoryFetchMemoryStore, createCachedFetchMemory };
