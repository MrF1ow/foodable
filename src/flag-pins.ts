// Runtime wiring for sticky flag pins and kill-switch last-known values
// (STG-5). The decisions are pure and live in src/domain/flag-pins.ts; this
// module holds what they need at runtime: the per-subject pin cache, the
// kill-switch memory, the snapshot cache, fire-and-forget persistence and the
// sweep.
//
// `evaluateAll` wraps a FlagReader from outside and only does anything for the
// Railway reader (the one that can read the epoch). Every other reader is
// answered straight from its own evaluations with no query, so self-hosters
// and tests stay query-free.
import { liveFlagPinStore } from "./db/flag-pins.js";
import {
    decideKillSwitch,
    decideTemporary,
    flagSubject,
    killSwitchSnapshotSubject,
    snapshotSubjectKey,
    subjectKey,
    type FlagPinStore,
    type FlagSubject,
    type Pin,
    type PinFlagDef,
    type SnapshotSubject,
} from "./domain/flag-pins.js";
import {
    FLAGS,
    hasEpoch,
    type FlagContext,
    type FlagEvaluation,
    type FlagName,
    type FlagReader,
} from "./flags.js";
import { createTtlCache, type TtlCacheResult } from "./ttl-cache.js";

const SUBJECT_TTL_MS = 5 * 60 * 1000;
// A failed pin or snapshot load is retried this many times, after these
// delays, inside one (coalesced) load. When every attempt fails, that subject
// (or the snapshot) is not queried again until the cooldown has passed, so a
// database outage costs at most 1 + LOAD_RETRIES queries per subject per
// cooldown, not one per request.
const LOAD_RETRY_DELAYS_MS = [50, 200] as const;
const LOAD_FAILURE_COOLDOWN_MS = 10_000;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_SUBJECTS = 10_000;
// Same cadence as the export cleanup tick (startExportCleanup).
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

type SubjectEntry = {
    get: () => Promise<TtlCacheResult<Map<string, Pin>>>;
    lastUsed: number;
    /** No load is attempted before this time (ms) after a failed one. */
    failedUntil: number;
};

type SnapshotEntry = {
    get: () => Promise<TtlCacheResult<Map<string, boolean>>>;
    failedUntil: number;
};

function lastKnownKey(flag: string, subject: SnapshotSubject): string {
    return `${flag}:${snapshotSubjectKey(subject)}`;
}

export type FlagPinRuntimeOptions = {
    store: FlagPinStore;
    registry?: Record<string, PinFlagDef>;
    now?: () => number;
    subjectTtlMs?: number;
    maxSubjects?: number;
    /** Delay before each retry of a failed load; its length is the retry cap. */
    retryDelaysMs?: readonly number[];
    failureCooldownMs?: number;
    sleep?: (ms: number) => Promise<void>;
};

export type FlagPinRuntime = {
    /** One evaluation per name, in order, with pins and last-known applied. */
    evaluateAll(
        ctx: FlagContext,
        reader: FlagReader,
        names?: readonly string[],
    ): Promise<FlagEvaluation[]>;
    /** Drops a subject's pins (rows and cache). Joining the beta calls this. */
    clearPins(subject: FlagSubject): Promise<void>;
    /** Deletes expired pin rows and prunes idle cache entries. */
    sweepExpiredPins(): Promise<number>;
    /** Subjects currently cached, for tests and metrics. */
    cachedSubjects(): number;
};

function logError(what: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[flags] ${what}: ${msg}`);
}

export function createFlagPinRuntime(
    opts: FlagPinRuntimeOptions,
): FlagPinRuntime {
    const { store } = opts;
    const registry = opts.registry ?? (FLAGS as Record<string, PinFlagDef>);
    const clock = opts.now ?? Date.now;
    const subjectTtlMs = opts.subjectTtlMs ?? SUBJECT_TTL_MS;
    const maxSubjects = opts.maxSubjects ?? MAX_SUBJECTS;
    const retryDelaysMs = opts.retryDelaysMs ?? LOAD_RETRY_DELAYS_MS;
    const failureCooldownMs =
        opts.failureCooldownMs ?? LOAD_FAILURE_COOLDOWN_MS;
    const sleep =
        opts.sleep ??
        ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    /** Runs `load`, retrying a failure after each of retryDelaysMs. */
    async function withRetries<T>(load: () => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await load();
            } catch (err) {
                const delay = retryDelaysMs[attempt];
                if (delay === undefined) throw err;
                await sleep(delay);
            }
        }
    }

    // Insertion order is recency order: an entry is re-inserted on every use.
    const subjects = new Map<string, SubjectEntry>();
    // Per flag and snapshot subject: the last reliable kill-switch value read.
    const lastKnown = new Map<string, boolean>();
    const snapshotCaches = new Map<string, SnapshotEntry>();

    function subjectEntry(subject: FlagSubject): SubjectEntry {
        const key = subjectKey(subject);
        let entry = subjects.get(key);
        if (entry) {
            subjects.delete(key);
        } else {
            entry = {
                get: createTtlCache(subjectTtlMs, async () => {
                    const pins = await withRetries(() =>
                        store.loadPins(subject),
                    );
                    return new Map(pins.map((p) => [p.flag, p]));
                }),
                lastUsed: 0,
                failedUntil: 0,
            };
            if (subjects.size >= maxSubjects) {
                const oldest = subjects.keys().next();
                if (!oldest.done) subjects.delete(oldest.value);
            }
        }
        entry.lastUsed = clock();
        subjects.set(key, entry);
        return entry;
    }

    /**
     * The subject's pins and the cache entry they came from; null when the load
     * failed, and the caller then neither reads nor writes pins.
     */
    async function loadSubjectPins(
        subject: FlagSubject,
    ): Promise<LoadedPins | null> {
        const entry = subjectEntry(subject);
        if (entry.failedUntil > clock()) return null;
        try {
            return { entry, pins: (await entry.get()).data };
        } catch (err) {
            entry.failedUntil = clock() + failureCooldownMs;
            logError(
                `loading pins for ${subject.kind} failed after ${retryDelaysMs.length + 1} attempts`,
                err,
            );
            return null;
        }
    }

    function snapshotCacheEntry(subject: SnapshotSubject): SnapshotEntry {
        const key = snapshotSubjectKey(subject);
        let entry = snapshotCaches.get(key);
        if (!entry) {
            entry = {
                get: createTtlCache(SNAPSHOT_TTL_MS, () =>
                    withRetries(() => store.loadSnapshot(subject)),
                ),
                failedUntil: 0,
            };
            snapshotCaches.set(key, entry);
        }
        return entry;
    }

    async function loadSnapshot(
        subject: SnapshotSubject,
    ): Promise<Map<string, boolean>> {
        const entry = snapshotCacheEntry(subject);
        if (entry.failedUntil > clock()) return new Map();
        try {
            return (await entry.get()).data;
        } catch (err) {
            entry.failedUntil = clock() + failureCooldownMs;
            logError(
                `loading the flag snapshot for ${subject.kind} failed after ${retryDelaysMs.length + 1} attempts`,
                err,
            );
            return new Map();
        }
    }

    // A pin whose save fails lives only in the cached map; the next TTL refresh
    // replaces that map with the database rows, so the flag is evaluated again
    // (possibly to a new value if the rollout moved). Acceptable: it is what a
    // database outage costs, and the request never fails for it.
    function persistPin(subject: FlagSubject, pin: Pin): void {
        store.upsertPin(subject, pin).catch((err: unknown) => {
            logError(`saving pin ${pin.flag} failed`, err);
        });
    }

    function persistSnapshot(
        subject: SnapshotSubject,
        snapshot: Map<string, boolean>,
        flag: string,
        value: boolean,
    ): void {
        // Updated in place so the next read does not write it again.
        snapshot.set(flag, value);
        store.saveSnapshot(flag, value, subject).catch((err: unknown) => {
            logError(`saving snapshot ${flag} failed`, err);
        });
    }

    async function evaluateAll(
        ctx: FlagContext,
        reader: FlagReader,
        names: readonly string[] = Object.keys(registry),
    ): Promise<FlagEvaluation[]> {
        const read = (name: string) => reader.evaluate(name as FlagName, ctx);
        if (!hasEpoch(reader)) return names.map(read);

        const now = clock();
        const epoch = reader.epoch(ctx);

        const userSubject = flagSubject("user", ctx);
        const householdSubject = flagSubject("household", ctx);
        const defs = names.map((n) => registry[n]);
        const wants = (kind: FlagPinDefKind, subject: FlagSubject | null) =>
            subject !== null &&
            defs.some((d) => d?.kind === "temporary" && d.unit === kind);
        const killSnapshotSubjects = new Map<string, SnapshotSubject>();
        const snapshotSubjects = new Map<string, SnapshotSubject>();
        for (const name of names) {
            const def = registry[name];
            if (def?.kind !== "kill-switch") continue;
            const snapSubj = killSwitchSnapshotSubject(def.unit, ctx);
            killSnapshotSubjects.set(name, snapSubj);
            snapshotSubjects.set(snapshotSubjectKey(snapSubj), snapSubj);
        }

        const [userPins, householdPins, ...loadedSnapshots] = await Promise.all(
            [
                wants("user", userSubject) && userSubject
                    ? loadSubjectPins(userSubject)
                    : null,
                wants("household", householdSubject) && householdSubject
                    ? loadSubjectPins(householdSubject)
                    : null,
                ...[...snapshotSubjects.values()].map((subj) =>
                    loadSnapshot(subj),
                ),
            ],
        );
        const snapshotByKey = new Map<string, Map<string, boolean>>();
        for (const [i, subj] of [...snapshotSubjects.values()].entries()) {
            snapshotByKey.set(
                snapshotSubjectKey(subj),
                loadedSnapshots[i] as Map<string, boolean>,
            );
        }

        return names.map((name) => {
            const live = read(name);
            const def = registry[name];
            if (!def) return live;

            if (def.kind === "kill-switch") {
                const snapSubj = killSnapshotSubjects.get(name)!;
                const snapKey = snapshotSubjectKey(snapSubj);
                const snapshot =
                    snapshotByKey.get(snapKey) ?? new Map<string, boolean>();
                const memoryKey = lastKnownKey(name, snapSubj);
                const decision = decideKillSwitch({
                    live,
                    fallback: def.fallback,
                    memory: lastKnown.get(memoryKey),
                    snapshot: snapshot.get(name),
                });
                if (decision.remember !== undefined) {
                    lastKnown.set(memoryKey, decision.remember);
                }
                if (decision.saveSnapshot !== undefined) {
                    persistSnapshot(
                        snapSubj,
                        snapshot,
                        name,
                        decision.saveSnapshot,
                    );
                }
                return decision.evaluation;
            }

            const subject =
                def.unit === "user" ? userSubject : householdSubject;
            const loaded = def.unit === "user" ? userPins : householdPins;
            const pins = loaded?.pins ?? null;
            const decision = decideTemporary({
                live,
                fallback: def.fallback,
                pin: pins?.get(name),
                pinsLoaded: pins !== null,
                hasSubject: subject !== null,
                epoch,
                now,
            });
            // clearPins (or LRU eviction) drops the subject's cache entry. A
            // request that loaded the old entry must not write a pin back
            // after a clear, or joining the beta would be undone for 12 hours.
            const current =
                subject !== null &&
                loaded !== null &&
                subjects.get(subjectKey(subject)) === loaded.entry;
            if (decision.write && subject && pins && current) {
                pins.set(name, decision.write);
                persistPin(subject, decision.write);
            }
            return decision.evaluation;
        });
    }

    async function clearPins(subject: FlagSubject): Promise<void> {
        const key = subjectKey(subject);
        subjects.delete(key);
        try {
            await store.clearPins(subject);
        } finally {
            // A request in flight may have re-cached the old pins meanwhile.
            subjects.delete(key);
        }
    }

    async function sweepExpiredPins(): Promise<number> {
        const now = clock();
        for (const [key, entry] of subjects) {
            if (now - entry.lastUsed > subjectTtlMs) subjects.delete(key);
        }
        return store.sweepExpired(now);
    }

    return {
        evaluateAll,
        clearPins,
        sweepExpiredPins,
        cachedSubjects: () => subjects.size,
    };
}

type FlagPinDefKind = PinFlagDef["unit"];

type LoadedPins = { entry: SubjectEntry; pins: Map<string, Pin> };

let runtime: FlagPinRuntime | null = null;

export function getFlagPins(): FlagPinRuntime {
    runtime ??= createFlagPinRuntime({ store: liveFlagPinStore() });
    return runtime;
}

export function setFlagPinsForTests(next: FlagPinRuntime | null): void {
    runtime = next;
}

export function clearPins(subject: FlagSubject): Promise<void> {
    return getFlagPins().clearPins(subject);
}

export function sweepExpiredPins(): Promise<number> {
    return getFlagPins().sweepExpiredPins();
}

let sweepRunning = false;

/** Start the periodic pin sweep. Call once at server startup, not on import. */
export function startFlagPinSweep(): void {
    setInterval(() => {
        if (sweepRunning) return;
        sweepRunning = true;
        sweepExpiredPins()
            .catch((err: unknown) => logError("pin sweep failed", err))
            .finally(() => {
                sweepRunning = false;
            });
    }, SWEEP_INTERVAL_MS);
}
