/**
 * Event notifications: what a write path calls after its write has
 * committed, so the household's other members get a stored notification.
 *
 * `notifyHousehold` is the fan-out over a store seam (the memory store in
 * domain tests, Postgres live). `notifierFor` binds it to a household and the
 * person who acted and never throws. A write inside a transaction (an agent's
 * guarded delete, a bulk action) sends through a `createNotifyQueue` made for
 * that one call, flushed only once the transaction has committed.
 */
import type { Notify } from "../domain/foods.js";
import {
    fanOutEvent,
    type NotificationEvent,
    type NotificationMember,
    type NotificationRow,
    type NotificationsStore,
} from "../domain/notifications.js";
import { listHouseholdMembers } from "./household.js";
import { liveNotificationsStore } from "./notifications.js";
import { run } from "./sql.js";

export type NotifyDeps = {
    store: Pick<NotificationsStore, "insertMany" | "listHouseholdPrefs">;
    listMembers(householdId: string): Promise<NotificationMember[]>;
    /** Runs the reads and the insert as one step; direct when absent. */
    atomically?: <T>(fn: () => Promise<T>) => Promise<T>;
    now?: () => Date;
    newId?: () => string;
    log?: (message: string) => void;
};

function defaultLog(message: string): void {
    console.error(message);
}

/**
 * Writes the rows an event makes: one per member except the person who acted
 * and every member with the kind off, all under one `event:<uuid>` key. Throws
 * when a read or the insert fails; `notifierFor` is the caller that must not.
 */
export async function notifyHousehold(
    deps: NotifyDeps,
    input: {
        householdId: string;
        event: NotificationEvent;
        actorUserId: string | null;
    },
): Promise<NotificationRow[]> {
    const atomically = deps.atomically ?? ((fn) => fn());
    return atomically(async () => {
        const members = await deps.listMembers(input.householdId);
        const prefs = await deps.store.listHouseholdPrefs(input.householdId);
        const rows = fanOutEvent({
            householdId: input.householdId,
            event: input.event,
            actorUserId: input.actorUserId,
            members,
            prefs,
            now: (deps.now ?? (() => new Date()))(),
            newId: deps.newId,
        });
        if (rows.length === 0) return [];
        return deps.store.insertMany(rows);
    });
}

/**
 * A `Notify` for one household and the person who acted. A failure is logged
 * and swallowed: the write it follows has already committed, and a missed
 * notification must not turn it into an error.
 */
export function notifierFor(
    deps: NotifyDeps,
    householdId: string,
    actorUserId: string | null,
): Notify {
    const log = deps.log ?? defaultLog;
    return async (event) => {
        try {
            await notifyHousehold(deps, { householdId, event, actorUserId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(
                `[notifications] household=${householdId.slice(0, 8)} ${event.kind} event failed: ${message}`,
            );
        }
    };
}

export type NotifyQueue = {
    /** Holds the event; nothing is sent yet. */
    notify: Notify;
    /** Sends what is held, in order, and empties the queue. */
    flush(): Promise<void>;
    /** Drops what is held (the transaction rolled back). */
    discard(): void;
};

/**
 * A queue for one call, one transaction. Events are held until `flush`, which
 * the caller runs only after the transaction has committed; a rolled-back
 * transaction never flushes, so it sends nothing. Make one per call, never
 * share one: a batch of tool calls runs concurrently against one tool
 * context, and each call's events are its own.
 */
export function createNotifyQueue(
    deliver: Notify,
    log: (message: string) => void = defaultLog,
): NotifyQueue {
    let held: NotificationEvent[] = [];
    return {
        notify: async (event) => {
            held.push(event);
        },
        async flush() {
            const events = held;
            held = [];
            for (const event of events) {
                try {
                    await deliver(event);
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    log(
                        `[notifications] ${event.kind} event failed: ${message}`,
                    );
                }
            }
        },
        discard() {
            held = [];
        },
    };
}

// Per instance by design: test harness override of the live fan-out deps; never set in production.
let testDeps: NotifyDeps | null = null;

/** Test only: send every live notification through `deps`, or back to Postgres with null. */
export function setNotifyDepsForTests(deps: NotifyDeps | null): void {
    testDeps = deps;
}

/** The household's members and the notification tables, live. */
export function liveNotifyDeps(): NotifyDeps {
    return (
        testDeps ?? {
            store: liveNotificationsStore(),
            listMembers: async (householdId) =>
                (await listHouseholdMembers(householdId)).map((member) => ({
                    userId: member.userId,
                    role: member.role,
                })),
            // One transaction for the reads and the insert: the event pays
            // for one round trip to open it, and its rows land together.
            atomically: (fn) => run(async () => fn()),
        }
    );
}

/** A `Notify` that writes to Postgres for one household and the person who acted. */
export function liveNotifier(
    householdId: string,
    actorUserId: string | null,
): Notify {
    // Deps are read per event, so a test override set after this was made
    // still applies.
    return (event) =>
        notifierFor(liveNotifyDeps(), householdId, actorUserId)(event);
}
