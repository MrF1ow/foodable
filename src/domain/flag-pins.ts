// Sticky flag pins and kill-switch last-known values (STG-5). Pure: a store
// interface, an in-memory store, row mappers and the two decision functions.
// The runtime wiring (per-subject cache, fire-and-forget writes, the sweep)
// is src/flag-pins.ts; the Postgres adapter is src/db/flag-pins.ts.
//
// Temporary flags are pinned per subject when they are read from a fresh
// registry, so a member keeps one answer everywhere for 12 hours, or until the
// `flags-epoch` number changes. Kill switches are never pinned: they remember
// the last reliable value instead.
//
// Pins and snapshots only ever apply to the Railway source. Env, fallback and
// memory readers are configuration, not registry state: a self-hoster who
// changes FOODABLE_FLAGS expects it to apply on restart, not 12 hours later.
import { isReliable, type FlagContext, type FlagEvaluation } from "../flags.js";

/** How long a pin holds before its flag is evaluated again. */
export const PIN_TTL_MS = 12 * 60 * 60 * 1000;

/** `flag_assignments.reason` is capped at 64 characters by a check. */
const MAX_REASON_LENGTH = 64;

/** Reason on an evaluation a pin served. Reliable: not in UNRELIABLE_REASONS. */
export const PINNED_REASON = "PINNED";
/** Reason on a kill-switch evaluation served from memory or the snapshot. */
export const LAST_KNOWN_REASON = "LAST_KNOWN";

export type FlagSubject =
    { kind: "user"; id: string } | { kind: "household"; id: string };

export type Pin = {
    flag: string;
    value: boolean;
    reason: string;
    epoch: number;
    assignedAt: number;
    expiresAt: number;
};

export interface FlagPinStore {
    /** Every pin of one subject, one query. */
    loadPins(subject: FlagSubject): Promise<Pin[]>;
    upsertPin(subject: FlagSubject, pin: Pin): Promise<void>;
    clearPins(subject: FlagSubject): Promise<void>;
    /** Deletes pins expired at `now` (ms) and returns how many. */
    sweepExpired(now: number): Promise<number>;
    loadSnapshot(): Promise<Map<string, boolean>>;
    saveSnapshot(flag: string, value: boolean): Promise<void>;
}

/** The registry fields the pin layer reads (`FLAGS` entries satisfy it). */
export type PinFlagDef = {
    kind: "temporary" | "kill-switch";
    unit: "user" | "household";
    fallback: boolean;
};

export function subjectKey(subject: FlagSubject): string {
    return `${subject.kind}:${subject.id}`;
}

/**
 * The subject a flag is pinned under, from its unit. A household-token caller
 * (`key` starting `hh:`) has no user, so a user-unit flag has no subject for
 * it and is never pinned.
 */
export function flagSubject(
    unit: PinFlagDef["unit"],
    ctx: Pick<FlagContext, "key" | "household_id">,
): FlagSubject | null {
    if (unit === "household") {
        return ctx.household_id
            ? { kind: "household", id: ctx.household_id }
            : null;
    }
    if (!ctx.key || ctx.key.startsWith("hh:")) return null;
    return { kind: "user", id: ctx.key };
}

export function truncateReason(reason: string): string {
    const cut = reason.slice(0, MAX_REASON_LENGTH);
    return cut === "" ? "UNKNOWN" : cut;
}

/** A pin row as `select flag_name, value, reason, epoch, assigned_at, expires_at`. */
export function pinFromRow(row: Record<string, unknown>): Pin | null {
    // Only a JSON boolean is a flag value; anything else is ignored.
    if (typeof row.value !== "boolean") return null;
    const assignedAt = Date.parse(String(row.assigned_at));
    const expiresAt = Date.parse(String(row.expires_at));
    if (Number.isNaN(assignedAt) || Number.isNaN(expiresAt)) return null;
    return {
        flag: String(row.flag_name),
        value: row.value,
        reason: String(row.reason),
        epoch: Number(row.epoch),
        assignedAt,
        expiresAt,
    };
}

export function snapshotFromRows(
    rows: Record<string, unknown>[],
): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const row of rows) {
        if (typeof row.value === "boolean") {
            out.set(String(row.flag_name), row.value);
        }
    }
    return out;
}

export type EpochState = { value: number; reliable: boolean };

export type TemporaryDecision = {
    evaluation: FlagEvaluation;
    /** A pin the caller must persist, set only from a reliable read. */
    write?: Pin;
};

/**
 * What a temporary flag serves.
 *
 * - Not pinnable (env, fallback, memory source): the live answer, untouched.
 * - No subject, or the subject's pins could not be loaded (`pins: "unknown"`):
 *   never pinned. The live answer when reliable, the registry fallback when
 *   not.
 * - Live read reliable and epoch known: a live pin of the same epoch is served
 *   even when the live value has moved on (the stickiness); otherwise the live
 *   value is served and pinned for PIN_TTL_MS.
 * - Live read unreliable or epoch unknown: a live pin is served (its epoch
 *   cannot be checked), else the registry fallback. Nothing is ever written.
 *
 * Parent flags: the live answer for a child is already resolved against its
 * parent (`evaluateWithParent`), so a PARENT_OFF result pins off and the child
 * follows the parent at the next pin cycle.
 */
export function decideTemporary(input: {
    live: FlagEvaluation;
    fallback: boolean;
    pin: Pin | undefined;
    pinsLoaded: boolean;
    hasSubject: boolean;
    epoch: EpochState;
    now: number;
}): TemporaryDecision {
    const { live, fallback, epoch, now } = input;
    if (live.source !== "railway") return { evaluation: live };

    const reliable = isReliable(live);
    const fallbackEval: FlagEvaluation = {
        flag: live.flag,
        value: fallback,
        reason: live.reason,
        source: live.source,
    };

    if (!input.hasSubject || !input.pinsLoaded) {
        return { evaluation: reliable ? live : fallbackEval };
    }

    const pin = input.pin && input.pin.expiresAt > now ? input.pin : undefined;

    if (reliable && epoch.reliable) {
        if (pin && pin.epoch === epoch.value) {
            return { evaluation: pinned(live, pin) };
        }
        const write: Pin = {
            flag: live.flag,
            value: live.value,
            reason: truncateReason(live.reason),
            epoch: epoch.value,
            assignedAt: now,
            expiresAt: now + PIN_TTL_MS,
        };
        return { evaluation: live, write };
    }

    if (pin) return { evaluation: pinned(live, pin) };
    return { evaluation: fallbackEval };
}

function pinned(live: FlagEvaluation, pin: Pin): FlagEvaluation {
    return {
        flag: live.flag,
        value: pin.value,
        reason: PINNED_REASON,
        source: live.source,
    };
}

export type KillSwitchDecision = {
    evaluation: FlagEvaluation;
    /** The reliable value to remember in memory. */
    remember?: boolean;
    /** The value to persist to `flag_snapshot` because it changed. */
    saveSnapshot?: boolean;
};

/**
 * What a kill switch serves. Never pinned.
 *
 * - Reliable read: served and remembered; persisted to the snapshot when it
 *   differs from the last known value (memory, else snapshot) and the source
 *   is Railway.
 * - Unreliable read: the last value in memory, else the snapshot, else the
 *   registry fallback (on). Reason LAST_KNOWN when memory or the snapshot
 *   served it.
 */
export function decideKillSwitch(input: {
    live: FlagEvaluation;
    fallback: boolean;
    memory: boolean | undefined;
    snapshot: boolean | undefined;
}): KillSwitchDecision {
    const { live, fallback, memory, snapshot } = input;
    if (live.source !== "railway") {
        // Config, not Railway state: served as read, remembered nowhere.
        if (isReliable(live)) return { evaluation: live, remember: live.value };
        return { evaluation: live };
    }
    if (isReliable(live)) {
        const lastKnown = memory ?? snapshot;
        return {
            evaluation: live,
            remember: live.value,
            ...(lastKnown !== live.value ? { saveSnapshot: live.value } : {}),
        };
    }
    const known = memory ?? snapshot;
    if (known !== undefined) {
        return {
            evaluation: {
                flag: live.flag,
                value: known,
                reason: LAST_KNOWN_REASON,
                source: live.source,
            },
        };
    }
    return {
        evaluation: {
            flag: live.flag,
            value: fallback,
            reason: live.reason,
            source: live.source,
        },
    };
}

export type MemoryFlagPinStore = FlagPinStore & {
    pins: Map<string, Map<string, Pin>>;
    snapshot: Map<string, boolean>;
    calls: {
        loadPins: number;
        upsertPin: number;
        clearPins: number;
        sweepExpired: number;
        loadSnapshot: number;
        saveSnapshot: number;
    };
};

export function createMemoryFlagPinStore(
    opts: { now?: () => number } = {},
): MemoryFlagPinStore {
    const now = opts.now ?? Date.now;
    const pins = new Map<string, Map<string, Pin>>();
    const snapshot = new Map<string, boolean>();
    const calls = {
        loadPins: 0,
        upsertPin: 0,
        clearPins: 0,
        sweepExpired: 0,
        loadSnapshot: 0,
        saveSnapshot: 0,
    };
    return {
        pins,
        snapshot,
        calls,
        async loadPins(subject) {
            calls.loadPins++;
            const mine = pins.get(subjectKey(subject));
            if (!mine) return [];
            return [...mine.values()].filter((p) => p.expiresAt > now());
        },
        async upsertPin(subject, pin) {
            calls.upsertPin++;
            const key = subjectKey(subject);
            const mine = pins.get(key) ?? new Map<string, Pin>();
            mine.set(pin.flag, { ...pin });
            pins.set(key, mine);
        },
        async clearPins(subject) {
            calls.clearPins++;
            pins.delete(subjectKey(subject));
        },
        async sweepExpired(at) {
            calls.sweepExpired++;
            let removed = 0;
            for (const [key, mine] of pins) {
                for (const [flag, pin] of mine) {
                    if (pin.expiresAt <= at) {
                        mine.delete(flag);
                        removed++;
                    }
                }
                if (mine.size === 0) pins.delete(key);
            }
            return removed;
        },
        async loadSnapshot() {
            calls.loadSnapshot++;
            return new Map(snapshot);
        },
        async saveSnapshot(flag, value) {
            calls.saveSnapshot++;
            snapshot.set(flag, value);
        },
    };
}
