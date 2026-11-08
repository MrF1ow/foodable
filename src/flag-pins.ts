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
    subjectKey,
    type FlagPinStore,
    type FlagSubject,
    type Pin,
    type PinFlagDef,
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
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_SUBJECTS = 10_000;
// Same cadence as the export cleanup tick (startExportCleanup).
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

type SubjectEntry = {
    get: () => Promise<TtlCacheResult<Map<string, Pin>>>;
    lastUsed: number;
};

export type FlagPinRuntimeOptions = {
    store: FlagPinStore;
    registry?: Record<string, PinFlagDef>;
    now?: () => number;
    subjectTtlMs?: number;
    maxSubjects?: number;
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

    // Insertion order is recency order: an entry is re-inserted on every use.
    const subjects = new Map<string, SubjectEntry>();
    // Process-wide, per flag: the last reliable kill-switch value read.
    const lastKnown = new Map<string, boolean>();
    const snapshotCache = createTtlCache(SNAPSHOT_TTL_MS, () =>
        store.loadSnapshot(),
    );

    function subjectEntry(subject: FlagSubject): SubjectEntry {
        const key = subjectKey(subject);
        let entry = subjects.get(key);
        if (entry) {
            subjects.delete(key);
        } else {
            entry = {
                get: createTtlCache(subjectTtlMs, async () => {
                    const pins = await store.loadPins(subject);
                    return new Map(pins.map((p) => [p.flag, p]));
                }),
                lastUsed: 0,
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

    /** null when the load failed: the caller then neither reads nor writes pins. */
    async function loadSubjectPins(
        subject: FlagSubject,
    ): Promise<Map<string, Pin> | null> {
        try {
            return (await subjectEntry(subject).get()).data;
        } catch (err) {
            logError(`loading pins for ${subject.kind} failed`, err);
            return null;
        }
    }

    async function loadSnapshot(): Promise<Map<string, boolean>> {
        try {
            return (await snapshotCache()).data;
        } catch (err) {
            logError("loading the flag snapshot failed", err);
            return new Map();
        }
    }

    function persistPin(subject: FlagSubject, pin: Pin): void {
        store.upsertPin(subject, pin).catch((err: unknown) => {
            logError(`saving pin ${pin.flag} failed`, err);
        });
    }

    function persistSnapshot(
        snapshot: Map<string, boolean>,
        flag: string,
        value: boolean,
    ): void {
        // Updated in place so the next read does not write it again.
        snapshot.set(flag, value);
        store.saveSnapshot(flag, value).catch((err: unknown) => {
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
        const needsSnapshot = defs.some((d) => d?.kind === "kill-switch");

        const [userPins, householdPins, snapshot] = await Promise.all([
            wants("user", userSubject) && userSubject
                ? loadSubjectPins(userSubject)
                : null,
            wants("household", householdSubject) && householdSubject
                ? loadSubjectPins(householdSubject)
                : null,
            needsSnapshot
                ? loadSnapshot()
                : Promise.resolve(new Map<string, boolean>()),
        ]);

        return names.map((name) => {
            const live = read(name);
            const def = registry[name];
            if (!def) return live;

            if (def.kind === "kill-switch") {
                const decision = decideKillSwitch({
                    live,
                    fallback: def.fallback,
                    memory: lastKnown.get(name),
                    snapshot: snapshot.get(name),
                });
                if (decision.remember !== undefined) {
                    lastKnown.set(name, decision.remember);
                }
                if (decision.saveSnapshot !== undefined) {
                    persistSnapshot(snapshot, name, decision.saveSnapshot);
                }
                return decision.evaluation;
            }

            const subject =
                def.unit === "user" ? userSubject : householdSubject;
            const pins = def.unit === "user" ? userPins : householdPins;
            const decision = decideTemporary({
                live,
                fallback: def.fallback,
                pin: pins?.get(name),
                pinsLoaded: pins !== null,
                hasSubject: subject !== null,
                epoch,
                now,
            });
            if (decision.write && subject && pins) {
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
