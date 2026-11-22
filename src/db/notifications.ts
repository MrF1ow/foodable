import type { Notice } from "../domain/notices.js";
import type { GroceryAllergenMember } from "../domain/grocery.js";
import { noticesFor, type NoticesForDeps } from "../domain/notices-for.js";
import {
    notificationFromDb,
    notificationPrefFromDb,
    notificationToDb,
    sweepNotifications,
    syncHouseholdConditions,
    type NotificationDbRow,
    type NotificationMember,
    type NotificationPatch,
    type NotificationPrefDbRow,
    type NotificationRow,
    type NotificationsDeps,
    type NotificationsStore,
    type SyncPlan,
} from "../domain/notifications.js";
import { memberAllergenFromRow, type MemberAllergen } from "../domain/rules.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { listHouseholdMembers } from "./household.js";
import { liveNoticeDismissalsStore } from "./notice-dismissals.js";
import { liveRecipePlansStore } from "./plans.js";
import { liveRecipesStore } from "./recipes.js";
import { householdClock } from "./restock.js";
import { pgError, rows, run } from "./sql.js";
import { liveWeighInStore } from "./weigh-ins.js";

const NOTIFICATIONS = "public.notifications";
const NOTIFICATION_PREFS = "public.notification_prefs";
/** Ids are uuids; anything else names no row (as in the memory store), rather
 * than failing the query on a cast. */
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTIFICATION_COLS =
    "id, household_id, recipient_user_id, kind, bucket, source, notice_key, subject_kind, subject_id, actor_user_id, payload, created_at, read_at, snoozed_until, snoozed_by, dismissed_at, dismissed_by, resolved_at";
const PREF_COLS = "household_id, user_id, kind, enabled, updated_at";

// The state columns a patch may name, by the field the domain calls them.
const PATCH_COLUMNS: Record<keyof NotificationPatch, string> = {
    readAt: "read_at",
    snoozedUntil: "snoozed_until",
    snoozedBy: "snoozed_by",
    dismissedAt: "dismissed_at",
    dismissedBy: "dismissed_by",
    resolvedAt: "resolved_at",
};

const toRows = (data: unknown[]): NotificationRow[] =>
    data.map((row) => notificationFromDb(row as NotificationDbRow));

/** The patch as column values: a field left out (or `undefined`) is not
 * written, `null` clears it. */
function patchColumns(patch: NotificationPatch): {
    values: Record<string, string | null>;
    columns: string[];
} {
    const values: Record<string, string | null> = {};
    const columns: string[] = [];
    for (const [field, column] of Object.entries(PATCH_COLUMNS)) {
        const value = patch[field as keyof NotificationPatch];
        if (value === undefined) continue;
        values[column] = value;
        columns.push(column);
    }
    return { values, columns };
}

/**
 * `public.notifications` and `public.notification_prefs` on Postgres. A
 * household-scoped call runs as the caller's actor, so row level security
 * draws the household boundary, and every statement names its household
 * besides. `listForSweep` and `deleteMany` take no household: they are the
 * sweep's, and run as the system.
 */
export function liveNotificationsStore(): NotificationsStore {
    return {
        async listForHousehold(householdId) {
            return run(async (tx) => {
                try {
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                select ${tx.unsafe(NOTIFICATION_COLS)}
                                from ${tx.unsafe(NOTIFICATIONS)}
                                where household_id = ${householdId}::uuid
                                order by created_at, id
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("list notifications", err);
                }
            });
        },
        async listOpenConditions(householdId) {
            return run(async (tx) => {
                try {
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                select ${tx.unsafe(NOTIFICATION_COLS)}
                                from ${tx.unsafe(NOTIFICATIONS)}
                                where household_id = ${householdId}::uuid
                                  and source = 'condition'
                                  and resolved_at is null
                                order by created_at, id
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("list open notifications", err);
                }
            });
        },
        async listForRecipient(householdId, userId) {
            return run(async (tx) => {
                try {
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                select ${tx.unsafe(NOTIFICATION_COLS)}
                                from ${tx.unsafe(NOTIFICATIONS)}
                                where household_id = ${householdId}::uuid
                                  and recipient_user_id = ${userId}::uuid
                                order by created_at, id
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("list a person's notifications", err);
                }
            });
        },
        async get(householdId, id) {
            if (!UUID_RE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const [row] = toRows(
                        await rows(
                            tx,
                            tx`
                                select ${tx.unsafe(NOTIFICATION_COLS)}
                                from ${tx.unsafe(NOTIFICATIONS)}
                                where household_id = ${householdId}::uuid
                                  and id = ${id}::uuid
                            `,
                        ),
                    );
                    return row ?? null;
                } catch (err) {
                    throw pgError("get notification", err);
                }
            });
        },
        async insertMany(input) {
            if (input.length === 0) return [];
            return run(async (tx) => {
                try {
                    // The partial unique index is the guard: a row whose
                    // recipient already has an open row with its key is
                    // skipped, whether the other row came earlier or in this
                    // same batch.
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                insert into ${tx.unsafe(NOTIFICATIONS)} (${tx.unsafe(NOTIFICATION_COLS)})
                                select ${tx.unsafe(NOTIFICATION_COLS)}
                                from jsonb_populate_recordset(
                                    null::${tx.unsafe(NOTIFICATIONS)},
                                    ${JSON.stringify(input.map(notificationToDb))}::jsonb
                                )
                                where true
                                on conflict (recipient_user_id, notice_key)
                                    where resolved_at is null
                                do nothing
                                returning ${tx.unsafe(NOTIFICATION_COLS)}
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("insert notifications", err);
                }
            });
        },
        async update(householdId, rawIds, patch) {
            const ids = rawIds.filter((id) => UUID_RE.test(id));
            if (ids.length === 0) return [];
            return run(async (tx) => {
                try {
                    const { values, columns } = patchColumns(patch);
                    if (columns.length === 0) {
                        return toRows(
                            await rows(
                                tx,
                                tx`
                                    select ${tx.unsafe(NOTIFICATION_COLS)}
                                    from ${tx.unsafe(NOTIFICATIONS)}
                                    where household_id = ${householdId}::uuid
                                      and id = any(${tx.array([...ids], "uuid")})
                                    order by created_at, id
                                `,
                            ),
                        );
                    }
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                update ${tx.unsafe(NOTIFICATIONS)}
                                set ${tx(values, ...(columns as [string, ...string[]]))}
                                where household_id = ${householdId}::uuid
                                  and id = any(${tx.array([...ids], "uuid")})
                                returning ${tx.unsafe(NOTIFICATION_COLS)}
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("update notifications", err);
                }
            });
        },
        async updatePayloads(householdId, rawUpdates) {
            const updates = rawUpdates.filter((u) => UUID_RE.test(u.id));
            if (updates.length === 0) return [];
            return run(async (tx) => {
                try {
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                update ${tx.unsafe(NOTIFICATIONS)} n
                                set payload = u.payload
                                from jsonb_to_recordset(
                                    ${JSON.stringify(updates)}::jsonb
                                ) as u(id uuid, payload jsonb)
                                where n.household_id = ${householdId}::uuid
                                  and n.id = u.id
                                returning ${tx.unsafe(
                                    NOTIFICATION_COLS.split(", ")
                                        .map((col) => `n.${col}`)
                                        .join(", "),
                                )}
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("update notification payloads", err);
                }
            });
        },
        async updateOpenByKey(householdId, noticeKey, patch, options) {
            return run(async (tx) => {
                try {
                    const { values, columns } = patchColumns(patch);
                    const skipDismissed = options?.skipDismissed === true;
                    const keepFrom = options?.keepOwnSnoozeFrom ?? null;
                    if (columns.length === 0) {
                        return toRows(
                            await rows(
                                tx,
                                tx`
                                    select ${tx.unsafe(NOTIFICATION_COLS)}
                                    from ${tx.unsafe(NOTIFICATIONS)}
                                    where household_id = ${householdId}::uuid
                                      and notice_key = ${noticeKey}
                                      and resolved_at is null
                                      and (not ${skipDismissed}::boolean or dismissed_at is null)
                                      and (${keepFrom}::timestamptz is null or not (
                                          snoozed_until is not null
                                          and snoozed_by is not null
                                          and snoozed_by = recipient_user_id
                                          and snoozed_until >= ${keepFrom}::timestamptz
                                      ))
                                    order by created_at, id
                                `,
                            ),
                        );
                    }
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                update ${tx.unsafe(NOTIFICATIONS)}
                                set ${tx(values, ...(columns as [string, ...string[]]))}
                                where household_id = ${householdId}::uuid
                                  and notice_key = ${noticeKey}
                                  and resolved_at is null
                                  and (not ${skipDismissed}::boolean or dismissed_at is null)
                                  and (${keepFrom}::timestamptz is null or not (
                                      snoozed_until is not null
                                      and snoozed_by is not null
                                      and snoozed_by = recipient_user_id
                                      and snoozed_until >= ${keepFrom}::timestamptz
                                  ))
                                returning ${tx.unsafe(NOTIFICATION_COLS)}
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("update notifications by key", err);
                }
            });
        },
        async listForSweep(before) {
            return run(async (tx) => {
                try {
                    return toRows(
                        await rows(
                            tx,
                            tx`
                                select ${tx.unsafe(NOTIFICATION_COLS)}
                                from ${tx.unsafe(NOTIFICATIONS)}
                                where (dismissed_at is not null and dismissed_at < ${before}::timestamptz)
                                   or (resolved_at is not null and resolved_at < ${before}::timestamptz)
                                order by created_at, id
                            `,
                        ),
                    );
                } catch (err) {
                    throw pgError("list notifications to sweep", err);
                }
            });
        },
        async deleteMany(rawIds) {
            const ids = rawIds.filter((id) => UUID_RE.test(id));
            if (ids.length === 0) return 0;
            return run(async (tx) => {
                try {
                    const gone = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(NOTIFICATIONS)}
                            where id = any(${tx.array([...ids], "uuid")})
                            returning id
                        `,
                    );
                    return gone.length;
                } catch (err) {
                    throw pgError("delete notifications", err);
                }
            });
        },
        async listPrefs(householdId, userId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(PREF_COLS)}
                            from ${tx.unsafe(NOTIFICATION_PREFS)}
                            where household_id = ${householdId}::uuid
                              and user_id = ${userId}::uuid
                            order by kind
                        `,
                    );
                    return data.map((row) =>
                        notificationPrefFromDb(row as NotificationPrefDbRow),
                    );
                } catch (err) {
                    throw pgError("list notification settings", err);
                }
            });
        },
        async listHouseholdPrefs(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(PREF_COLS)}
                            from ${tx.unsafe(NOTIFICATION_PREFS)}
                            where household_id = ${householdId}::uuid
                            order by user_id, kind
                        `,
                    );
                    return data.map((row) =>
                        notificationPrefFromDb(row as NotificationPrefDbRow),
                    );
                } catch (err) {
                    throw pgError("list household notification settings", err);
                }
            });
        },
        async upsertPref(pref) {
            return run(async (tx) => {
                try {
                    const [saved] = await rows(
                        tx,
                        tx`
                            insert into ${tx.unsafe(NOTIFICATION_PREFS)} (${tx.unsafe(PREF_COLS)})
                            values (
                                ${pref.householdId}::uuid,
                                ${pref.userId}::uuid,
                                ${pref.kind},
                                ${pref.enabled},
                                ${pref.updatedAt}::timestamptz
                            )
                            on conflict (user_id, kind) do update
                            set household_id = excluded.household_id,
                                enabled = excluded.enabled,
                                updated_at = excluded.updated_at
                            returning ${tx.unsafe(PREF_COLS)}
                        `,
                    );
                    return notificationPrefFromDb(
                        saved as NotificationPrefDbRow,
                    );
                } catch (err) {
                    throw pgError("save notification setting", err);
                }
            });
        },
        async deletePref(householdId, userId, kind) {
            return run(async (tx) => {
                try {
                    const gone = await rows(
                        tx,
                        tx`
                            delete from ${tx.unsafe(NOTIFICATION_PREFS)}
                            where household_id = ${householdId}::uuid
                              and user_id = ${userId}::uuid
                              and kind = ${kind}
                            returning user_id
                        `,
                    );
                    return gone.length > 0;
                } catch (err) {
                    throw pgError("delete notification setting", err);
                }
            });
        },
    };
}

const ALLERGEN_COLS = "id, household_id, user_id, allergen, other_label";

/** Every member of the household with their allergens, from one household-wide
 * read of `member_allergens`. Most households have none on file, and then the
 * members are not listed either. */
async function liveAllergenMembers(
    householdId: string,
): Promise<GroceryAllergenMember[]> {
    // One transaction for both reads.
    return run(async (tx) => {
        let data: unknown[];
        try {
            data = await rows(
                tx,
                tx`
                    select ${tx.unsafe(ALLERGEN_COLS)}
                    from public.member_allergens
                    where household_id = ${householdId}
                    order by created_at asc
                `,
            );
        } catch (err) {
            throw pgError("list household allergens", err);
        }
        if (data.length === 0) return [];
        const byUser = new Map<string, MemberAllergen[]>();
        for (const row of data) {
            const allergen = memberAllergenFromRow(row as never);
            const list = byUser.get(allergen.userId) ?? [];
            list.push(allergen);
            byUser.set(allergen.userId, list);
        }
        return (await listHouseholdMembers(householdId)).map((member) => ({
            displayName: member.displayName,
            userId: member.userId,
            allergens: byUser.get(member.userId) ?? [],
        }));
    });
}

/** Everything `noticesFor` reads, live: the one set of stores the app's pages
 * and the sync build their notices from. */
export function liveNoticesForDeps(): NoticesForDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
        plans: liveRecipePlansStore(),
        weighIns: liveWeighInStore(),
        allergenMembers: liveAllergenMembers,
    };
}

export type NotificationSyncDeps = NotificationsDeps & {
    listMembers(householdId: string): Promise<NotificationMember[]>;
    /** The household's notices as a sync reads them: the one-tap kinds
     * included (`actionable`), the allergen conditions (`allergens`), and the
     * ones the household dismissed too, so a dismissed condition that is still
     * true reads as true. */
    loadNotices(householdId: string): Promise<readonly Notice[]>;
};

export function liveNotificationSyncDeps(): NotificationSyncDeps {
    return {
        store: liveNotificationsStore(),
        dismissals: liveNoticeDismissalsStore(),
        listMembers: async (householdId) =>
            (await listHouseholdMembers(householdId)).map((member) => ({
                userId: member.userId,
                role: member.role,
            })),
        loadNotices: async (householdId) => {
            const { today, timezone } = await householdClock(householdId);
            const { notices } = await noticesFor(
                liveNoticesForDeps(),
                householdId,
                {
                    today,
                    timezone,
                    actionable: true,
                    includeDismissed: true,
                    allergens: true,
                },
            );
            return notices;
        },
    };
}

/**
 * What a sync may be handed besides the clock: nothing, and it reads its own
 * notices, or notices the caller already read. Those must have been read with
 * `actionable`, `includeDismissed` and `allergens: true`, and say so
 * (`allergens: true`): a read without the allergen conditions would read as
 * "nothing conflicts" and resolve every Allergens row.
 */
export type SyncOpts = { now?: Date } & (
    { notices?: undefined } | { notices: readonly Notice[]; allergens: true }
);

/**
 * Make the household's stored notifications match what is true now: a row
 * for each member a condition reaches, and the rows of conditions that have
 * cleared resolved. Pass `notices` when the caller has already read them (see
 * `SyncOpts`, as `loadNotices` does) so they are not computed twice; without
 * them the sync reads its own. Notices handed over without saying they were
 * read with the allergen option are refused (nothing is read or written)
 * rather than topped up, so no caller pays for a second read of them.
 */
export async function syncHouseholdNotifications(
    deps: NotificationSyncDeps,
    householdId: string,
    opts?: SyncOpts,
): Promise<SyncPlan> {
    if (opts?.notices && opts.allergens !== true) {
        throw new Error(
            "syncHouseholdNotifications: notices must be read with allergens: true",
        );
    }
    const notices = opts?.notices ?? (await deps.loadNotices(householdId));
    // One transaction for the reads and the writes: a page load pays for one
    // round trip to open it, and the writes land together.
    return run(async () => {
        const members = await deps.listMembers(householdId);
        return syncHouseholdConditions(deps, {
            householdId,
            notices,
            members,
            now: opts?.now ?? new Date(),
        });
    });
}

/** `syncHouseholdNotifications` for a caller that must carry on if it fails
 * (a page load, a restock tick): the failure is logged, not thrown. */
export async function trySyncHouseholdNotifications(
    deps: NotificationSyncDeps,
    householdId: string,
    opts?: SyncOpts,
    log: (message: string) => void = (message) => console.error(message),
): Promise<SyncPlan | null> {
    try {
        return await syncHouseholdNotifications(deps, householdId, opts);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(
            `[notifications] household=${householdId.slice(0, 8)} sync failed: ${message}`,
        );
        return null;
    }
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** The first sweep runs soon after boot, so a process restarted more often
 * than hourly still sweeps. */
const SWEEP_FIRST_RUN_MS = 60 * 1000;

// Per instance by design: overlap guard for the notification sweep; deletes are idempotent, so instances may both run it.
let sweepRunning = false;

/**
 * Start the periodic notification sweep: dismissed events and cleared
 * conditions go 30 days after. Call once at server startup, as the system
 * (the sweep reads and deletes across households). The timer does not keep
 * the process alive.
 */
export function startNotificationSweep(
    store: NotificationsStore = liveNotificationsStore(),
    log: (message: string) => void = (message) => console.log(message),
): void {
    // Returns the sweep's promise so a test can await a tick; a timer ignores it.
    const sweep = (): Promise<void> => {
        if (sweepRunning) return Promise.resolve();
        sweepRunning = true;
        return sweepNotifications({ store }, new Date())
            .then((removed) => {
                if (removed > 0) log(`[notifications] swept ${removed}`);
            })
            .catch((err: unknown) => {
                console.error(
                    "[notifications] sweep failed:",
                    err instanceof Error ? err.message : String(err),
                );
            })
            .finally(() => {
                sweepRunning = false;
            });
    };
    setTimeout(sweep, SWEEP_FIRST_RUN_MS).unref?.();
    setInterval(sweep, SWEEP_INTERVAL_MS).unref?.();
}
