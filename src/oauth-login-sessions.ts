import { runAsSystem } from "./db/actor.js";
import * as loginSessionsDb from "./db/login-sessions.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Postgres holds many instances; cap is table-growth protection only (rows also
 * expire after ten minutes and are swept). The in-memory store keeps 32.
 */
export const MAX_SITE_LOGIN_SESSIONS_POSTGRES = 1000;

export interface OAuthSessionPayload {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
    clientId: string;
    purpose: "mcp" | "site";
}

export interface LoginSessionStore {
    put(id: string, session: OAuthSessionPayload, ttlMs: number): Promise<void>;
    putSiteSession(
        id: string,
        session: OAuthSessionPayload,
        ttlMs: number,
        cap: number,
    ): Promise<void>;
    get(id: string): Promise<OAuthSessionPayload | null>;
    take(id: string): Promise<OAuthSessionPayload | null>;
    del(id: string): Promise<void>;
    countSite(): Promise<number>;
    evictOneSite(): Promise<void>;
    sweep(): Promise<number>;
    readonly kind: "memory" | "postgres";
}

export function createMemoryLoginSessionStore(): LoginSessionStore & {
    countSiteSync(): number;
} {
    // Per instance by design: in-process store for tests; production uses createPostgresLoginSessionStore at boot.
    const rows = new Map<
        string,
        { session: OAuthSessionPayload; expiresAt: number }
    >();

    function pruneExpired(): void {
        const now = Date.now();
        for (const [key, value] of rows) {
            if (value.expiresAt < now) rows.delete(key);
        }
    }

    return {
        kind: "memory",

        async put(id, session, ttlMs) {
            pruneExpired();
            rows.set(id, {
                session,
                expiresAt: Date.now() + ttlMs,
            });
        },

        async putSiteSession(id, session, ttlMs, cap) {
            pruneExpired();
            let siteCount = 0;
            for (const value of rows.values()) {
                if (value.session.purpose === "site") siteCount += 1;
            }
            while (siteCount >= cap) {
                for (const [key, value] of rows) {
                    if (value.session.purpose === "site") {
                        rows.delete(key);
                        siteCount -= 1;
                        break;
                    }
                }
            }
            rows.set(id, {
                session,
                expiresAt: Date.now() + ttlMs,
            });
        },

        async get(id) {
            const entry = rows.get(id);
            if (!entry || entry.expiresAt < Date.now()) {
                if (entry) rows.delete(id);
                return null;
            }
            return entry.session;
        },

        async take(id) {
            const entry = rows.get(id);
            if (!entry || entry.expiresAt < Date.now()) {
                if (entry) rows.delete(id);
                return null;
            }
            rows.delete(id);
            return entry.session;
        },

        async del(id) {
            rows.delete(id);
        },

        async countSite() {
            pruneExpired();
            let n = 0;
            for (const value of rows.values()) {
                if (value.session.purpose === "site") n += 1;
            }
            return n;
        },

        countSiteSync() {
            pruneExpired();
            let n = 0;
            for (const value of rows.values()) {
                if (value.session.purpose === "site") n += 1;
            }
            return n;
        },

        async evictOneSite() {
            for (const [key, value] of rows) {
                if (value.session.purpose === "site") {
                    rows.delete(key);
                    return;
                }
            }
        },

        async sweep() {
            const before = rows.size;
            pruneExpired();
            return before - rows.size;
        },
    };
}

export function createPostgresLoginSessionStore(): LoginSessionStore {
    return {
        kind: "postgres",

        async put(id, session, ttlMs) {
            await runAsSystem("oauth login session", () =>
                loginSessionsDb.put(id, session, ttlMs),
            );
        },

        async putSiteSession(id, session, ttlMs, cap) {
            await runAsSystem("oauth login session", () =>
                loginSessionsDb.putSiteSessionWithCap(id, session, ttlMs, cap),
            );
        },

        async get(id) {
            return runAsSystem("oauth login session", () =>
                loginSessionsDb.get<OAuthSessionPayload>(id),
            );
        },

        async take(id) {
            return runAsSystem("oauth login session", () =>
                loginSessionsDb.take<OAuthSessionPayload>(id),
            );
        },

        async del(id) {
            await runAsSystem("oauth login session", () =>
                loginSessionsDb.del(id),
            );
        },

        async countSite() {
            return runAsSystem("oauth login session", () =>
                loginSessionsDb.countSiteSessions(),
            );
        },

        async evictOneSite() {
            await runAsSystem("oauth login session", () =>
                loginSessionsDb.evictOldestSiteSession(),
            );
        },

        async sweep() {
            return runAsSystem("oauth login session", () =>
                loginSessionsDb.sweepExpired(),
            );
        },
    };
}

// Per instance by design: pointer to the session store; production calls useLiveLoginSessionStore() at boot so OAuth state lives in Postgres.
let activeStore: LoginSessionStore = createMemoryLoginSessionStore();

export function getLoginSessionStore(): LoginSessionStore {
    return activeStore;
}

export function useLiveLoginSessionStore(): void {
    activeStore = createPostgresLoginSessionStore();
}

export function resetLoginSessionStoreForTests(): void {
    activeStore = createMemoryLoginSessionStore();
}

export function siteLoginSessionCountSync(): number {
    const store = activeStore;
    if (store.kind !== "memory") {
        throw new Error(
            "siteLoginSessionCount() counts only the in-memory login session store",
        );
    }
    return (
        store as ReturnType<typeof createMemoryLoginSessionStore>
    ).countSiteSync();
}

// Per instance by design: overlap guard for the periodic Postgres expiry sweep.
let sweepRunning = false;

export function startLoginSessionCleanup(
    store: LoginSessionStore = getLoginSessionStore(),
): void {
    setInterval(() => {
        if (sweepRunning) return;
        sweepRunning = true;
        void runAsSystem("login session sweep", () => store.sweep()).finally(
            () => {
                sweepRunning = false;
            },
        );
    }, SWEEP_INTERVAL_MS);
}
