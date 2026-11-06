export const REFUSAL_DAYS = 7;
export const DEAD_404_DAYS = 30;

export type RefusalStatus = 401 | 403 | 429;
export type DeadLinkStatus = 404 | 410;

export type HostRefusalRow = {
    host: string;
    status: RefusalStatus;
    refusedAt: string;
    expiresAt: string;
};

export type DeadLinkRow = {
    urlHash: string;
    url: string;
    status: DeadLinkStatus;
    seenAt: string;
    expiresAt: string | null;
};

export function normalizeMemoryHost(host: string): string {
    let h = host.trim().toLowerCase();
    h = h.replace(/\.$/, "");
    if (h.startsWith("www.")) {
        h = h.slice(4);
    }
    return h;
}

export function deadLinkHash(cleanedUrl: string): string {
    return new Bun.CryptoHasher("sha256")
        .update(cleanedUrl, "utf8")
        .digest("hex");
}

export function refusalExpiry(now: Date): Date {
    const d = new Date(now);
    d.setDate(d.getDate() + REFUSAL_DAYS);
    return d;
}

export function deadLinkExpiry(status: DeadLinkStatus, now: Date): Date | null {
    if (status === 410) return null;
    const d = new Date(now);
    d.setDate(d.getDate() + DEAD_404_DAYS);
    return d;
}

/** Normalized hostname label for cursoring (lowercase ASCII, dotted segments). */
const REFUSAL_CURSOR_HOST_PATTERN = /^[a-z0-9.-]{1,253}$/;

/**
 * Parse `refusals_after` cursor: `…|host` where `|` splits on the **last** pipe.
 * Invalid raw values return `null` (first page).
 */
export function parseRefusalCursor(
    raw: string | null | undefined,
): { refusedAt: string; host: string } | null {
    const s = raw?.trim() ?? "";
    if (!s) return null;
    const pipe = s.lastIndexOf("|");
    if (pipe <= 0) return null;
    const refusedPart = s.slice(0, pipe).trim();
    const hostPart = s.slice(pipe + 1);
    if (!REFUSAL_CURSOR_HOST_PATTERN.test(hostPart)) return null;
    const t = Date.parse(refusedPart);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    const iso = d.toISOString();
    if (Date.parse(iso) !== t) return null;
    return { refusedAt: iso, host: hostPart };
}

function iso(d: Date): string {
    return d.toISOString();
}

/** Row is strictly after `cur` in `order by refused_at desc, host desc` (PostgreSQL `(row) < (cur)` tuple compare). */
function refusalRowBeforeCursor(
    row: HostRefusalRow,
    cur: { refusedAt: string; host: string },
): boolean {
    const tr = new Date(row.refusedAt).getTime();
    const tc = new Date(cur.refusedAt).getTime();
    if (tr < tc) return true;
    if (tr > tc) return false;
    return row.host < cur.host;
}

function refusalActive(row: HostRefusalRow, now: Date): boolean {
    return new Date(row.expiresAt) > now;
}

function deadLinkActive(row: DeadLinkRow, now: Date): boolean {
    if (row.expiresAt == null) return true;
    return new Date(row.expiresAt) > now;
}

export type FetchMemoryStore = {
    getRefusal(
        householdId: string,
        host: string,
        now: Date,
    ): Promise<HostRefusalRow | null>;
    recordRefusal(
        householdId: string,
        host: string,
        status: RefusalStatus,
        now: Date,
    ): Promise<void>;
    clearRefusal(householdId: string, host: string): Promise<void>;
    listRefusals(
        householdId: string,
        opts: {
            limit: number;
            after?: { refusedAt: string; host: string };
            now: Date;
        },
    ): Promise<HostRefusalRow[]>;
    getDeadLink(
        householdId: string,
        urlHash: string,
        now: Date,
    ): Promise<DeadLinkRow | null>;
    recordDeadLink(
        householdId: string,
        urlHash: string,
        url: string,
        status: DeadLinkStatus,
        now: Date,
    ): Promise<void>;
    clearDeadLink(householdId: string, urlHash: string): Promise<void>;
    sweepExpired(now: Date, batchSize: number): Promise<number>;
};

export function createMemoryFetchMemoryStore(): FetchMemoryStore {
    const refusals = new Map<string, HostRefusalRow>();
    const dead = new Map<string, DeadLinkRow>();

    function refusalKey(householdId: string, host: string): string {
        return `${householdId}\0${host}`;
    }
    function deadKey(householdId: string, urlHash: string): string {
        return `${householdId}\0${urlHash}`;
    }

    return {
        async getRefusal(householdId, host, now) {
            const row = refusals.get(refusalKey(householdId, host));
            if (!row || !refusalActive(row, now)) return null;
            return row;
        },
        async recordRefusal(householdId, host, status, now) {
            const expiresAt = iso(refusalExpiry(now));
            refusals.set(refusalKey(householdId, host), {
                host,
                status,
                refusedAt: iso(now),
                expiresAt,
            });
        },
        async clearRefusal(householdId, host) {
            refusals.delete(refusalKey(householdId, host));
        },
        async listRefusals(householdId, opts) {
            const rows = [...refusals.entries()]
                .filter(([k]) => k.startsWith(`${householdId}\0`))
                .map(([, v]) => v)
                .filter((r) => refusalActive(r, opts.now))
                .sort((a, b) => {
                    const ta = new Date(a.refusedAt).getTime();
                    const tb = new Date(b.refusedAt).getTime();
                    if (tb !== ta) return tb - ta;
                    return b.host.localeCompare(a.host);
                });
            let start = 0;
            if (opts.after) {
                const cur = opts.after;
                const idx = rows.findIndex((r) =>
                    refusalRowBeforeCursor(r, cur),
                );
                start = idx >= 0 ? idx : rows.length;
            }
            return rows.slice(start, start + opts.limit);
        },
        async getDeadLink(householdId, urlHash, now) {
            const row = dead.get(deadKey(householdId, urlHash));
            if (!row || !deadLinkActive(row, now)) return null;
            return row;
        },
        async recordDeadLink(householdId, urlHash, url, status, now) {
            const existing = dead.get(deadKey(householdId, urlHash));
            if (existing?.status === 410) {
                dead.set(deadKey(householdId, urlHash), {
                    ...existing,
                    url,
                    seenAt: iso(now),
                });
                return;
            }
            if (status === 410) {
                dead.set(deadKey(householdId, urlHash), {
                    urlHash,
                    url,
                    status: 410,
                    seenAt: iso(now),
                    expiresAt: null,
                });
                return;
            }
            dead.set(deadKey(householdId, urlHash), {
                urlHash,
                url,
                status: 404,
                seenAt: iso(now),
                expiresAt: iso(deadLinkExpiry(404, now)!),
            });
        },
        async clearDeadLink(householdId, urlHash) {
            dead.delete(deadKey(householdId, urlHash));
        },
        async sweepExpired(now, batchSize) {
            void batchSize;
            let total = 0;
            for (const [k, row] of [...refusals]) {
                if (!refusalActive(row, now)) {
                    refusals.delete(k);
                    total += 1;
                }
            }
            for (const [k, row] of [...dead]) {
                if (!deadLinkActive(row, now)) {
                    dead.delete(k);
                    total += 1;
                }
            }
            return total;
        },
    };
}

type CacheEntry<T> = {
    value: T | null;
    cacheExpiresAt: number;
};

function refusalCacheUntil(
    row: HostRefusalRow | null,
    ttlMs: number,
    now: number,
): number {
    if (row == null) return now + ttlMs;
    const rowEnd = new Date(row.expiresAt).getTime();
    return Math.min(now + ttlMs, rowEnd);
}

function deadLinkCacheUntil(
    row: DeadLinkRow | null,
    ttlMs: number,
    now: number,
): number {
    if (row == null) return now + ttlMs;
    if (row.expiresAt == null) return now + ttlMs;
    const rowEnd = new Date(row.expiresAt).getTime();
    return Math.min(now + ttlMs, rowEnd);
}

/**
 * Read-through LRU cache over a `FetchMemoryStore`.
 * — Per-map cap defaults to 1000 entries (2000 total across refusal + dead host/url maps).
 * — Generation counters drop in-flight stale writes after `clear*` / `record*` / `sweepExpired`.
 */
export function createCachedFetchMemory(
    store: FetchMemoryStore,
    opts: {
        ttlMs?: number;
        maxEntries?: number;
        now?: () => number;
    } = {},
): FetchMemoryStore {
    const ttlMs = opts.ttlMs ?? 5 * 60_000;
    const maxEntries = opts.maxEntries ?? 1000;
    const clock = opts.now ?? (() => Date.now());

    const refusalCache = new Map<string, CacheEntry<HostRefusalRow>>();
    const deadCache = new Map<string, CacheEntry<DeadLinkRow>>();
    let refusalGen = 0;
    let deadGen = 0;

    function touch<K, V>(map: Map<K, V>, key: K) {
        const v = map.get(key);
        if (v === undefined) return;
        map.delete(key);
        map.set(key, v);
        while (map.size > maxEntries) {
            const first = map.keys().next().value;
            if (first !== undefined) map.delete(first);
        }
    }

    function setRefusalCache(
        householdId: string,
        host: string,
        row: HostRefusalRow | null,
    ) {
        const now = clock();
        const key = `${householdId}|${host}`;
        refusalCache.set(key, {
            value: row,
            cacheExpiresAt: refusalCacheUntil(row, ttlMs, now),
        });
        touch(refusalCache, key);
    }

    function setDeadCache(
        householdId: string,
        urlHash: string,
        row: DeadLinkRow | null,
    ) {
        const now = clock();
        const key = `${householdId}|${urlHash}`;
        deadCache.set(key, {
            value: row,
            cacheExpiresAt: deadLinkCacheUntil(row, ttlMs, now),
        });
        touch(deadCache, key);
    }

    function getRefusalCached(
        householdId: string,
        host: string,
        queryNow: Date,
    ): HostRefusalRow | null | undefined {
        const key = `${householdId}|${host}`;
        const ent = refusalCache.get(key);
        if (!ent) return undefined;
        if (clock() >= ent.cacheExpiresAt) {
            refusalCache.delete(key);
            return undefined;
        }
        if (ent.value && !refusalActive(ent.value, queryNow)) {
            refusalCache.delete(key);
            return undefined;
        }
        touch(refusalCache, key);
        return ent.value;
    }

    function getDeadCached(
        householdId: string,
        urlHash: string,
        queryNow: Date,
    ): DeadLinkRow | null | undefined {
        const key = `${householdId}|${urlHash}`;
        const ent = deadCache.get(key);
        if (!ent) return undefined;
        if (clock() >= ent.cacheExpiresAt) {
            deadCache.delete(key);
            return undefined;
        }
        if (ent.value && !deadLinkActive(ent.value, queryNow)) {
            deadCache.delete(key);
            return undefined;
        }
        touch(deadCache, key);
        return ent.value;
    }

    function pruneExpiredEntries(queryNow: Date) {
        const t = clock();
        for (const [key, ent] of refusalCache) {
            if (t >= ent.cacheExpiresAt) {
                refusalCache.delete(key);
                continue;
            }
            if (ent.value && !refusalActive(ent.value, queryNow)) {
                refusalCache.delete(key);
            }
        }
        for (const [key, ent] of deadCache) {
            if (t >= ent.cacheExpiresAt) {
                deadCache.delete(key);
                continue;
            }
            if (ent.value && !deadLinkActive(ent.value, queryNow)) {
                deadCache.delete(key);
            }
        }
    }

    return {
        async getRefusal(householdId, host, now) {
            const gen0 = refusalGen;
            const hit = getRefusalCached(householdId, host, now);
            if (hit !== undefined) return hit;
            let row = await store.getRefusal(householdId, host, now);
            if (gen0 !== refusalGen) {
                row = await store.getRefusal(householdId, host, now);
            }
            if (gen0 !== refusalGen) {
                return row;
            }
            setRefusalCache(householdId, host, row);
            return row;
        },
        async recordRefusal(householdId, host, status, now) {
            await store.recordRefusal(householdId, host, status, now);
            refusalGen += 1;
            const gen1 = refusalGen;
            const row = await store.getRefusal(householdId, host, now);
            // A clear or record that landed during the read wins: drop the
            // entry so the next lookup reads the database.
            if (gen1 !== refusalGen) {
                refusalCache.delete(`${householdId}|${host}`);
                return;
            }
            setRefusalCache(householdId, host, row);
        },
        async clearRefusal(householdId, host) {
            await store.clearRefusal(householdId, host);
            refusalGen += 1;
            setRefusalCache(householdId, host, null);
        },
        async listRefusals(householdId, opts) {
            return store.listRefusals(householdId, opts);
        },
        async getDeadLink(householdId, urlHash, now) {
            const gen0 = deadGen;
            const hit = getDeadCached(householdId, urlHash, now);
            if (hit !== undefined) return hit;
            let row = await store.getDeadLink(householdId, urlHash, now);
            if (gen0 !== deadGen) {
                row = await store.getDeadLink(householdId, urlHash, now);
            }
            if (gen0 !== deadGen) {
                return row;
            }
            setDeadCache(householdId, urlHash, row);
            return row;
        },
        async recordDeadLink(householdId, urlHash, url, status, now) {
            await store.recordDeadLink(householdId, urlHash, url, status, now);
            deadGen += 1;
            const gen1 = deadGen;
            const row = await store.getDeadLink(householdId, urlHash, now);
            if (gen1 !== deadGen) {
                deadCache.delete(`${householdId}|${urlHash}`);
                return;
            }
            setDeadCache(householdId, urlHash, row);
        },
        async clearDeadLink(householdId, urlHash) {
            await store.clearDeadLink(householdId, urlHash);
            deadGen += 1;
            setDeadCache(householdId, urlHash, null);
        },
        async sweepExpired(now, batchSize) {
            const deleted = await store.sweepExpired(now, batchSize);
            refusalGen += 1;
            deadGen += 1;
            refusalCache.clear();
            deadCache.clear();
            return deleted;
        },
    };
}
