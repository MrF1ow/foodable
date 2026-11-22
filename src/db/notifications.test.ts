import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { SQL } from "bun";
import { runRestockCheck } from "../domain/restock.js";
import {
    createMemoryNotificationsStore,
    sweepNotifications,
    type NotificationPref,
    type NotificationRow,
    type NotificationsStore,
} from "../domain/notifications.js";
import { dismissalKey } from "../domain/notice-dismissals.js";
import { noticesFor } from "../domain/notices-for.js";
import { shiftLocalDate } from "../domain/tz.js";
import { liveRestockCheckDeps } from "../restock-runner.js";
import { setFallbackActorForTests, withActor } from "./actor.js";
import { getHouseholdConfig, updateHouseholdConfig } from "./household.js";
import { liveNoticeDismissalsStore } from "./notice-dismissals.js";
import {
    liveNoticesForDeps,
    liveNotificationSyncDeps,
    liveNotificationsStore,
    startNotificationSweep,
    syncHouseholdNotifications,
    trySyncHouseholdNotifications,
    type NotificationSyncDeps,
} from "./notifications.js";
import { householdClock, householdToday } from "./restock.js";
import { setSqlForTests } from "./sql.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedHousehold,
    seedMember,
} from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

const NOW = new Date("2026-11-21T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) =>
    new Date(NOW.getTime() - days * DAY_MS).toISOString();

type SuiteCtx = {
    householdId: string;
    ownerId: string;
    memberId: string;
};

function sampleRow(
    c: SuiteCtx,
    over: Partial<NotificationRow> = {},
): NotificationRow {
    return {
        id: crypto.randomUUID(),
        householdId: c.householdId,
        recipientUserId: c.ownerId,
        kind: "food_expiring",
        bucket: "household",
        source: "condition",
        noticeKey: `fridge.expiring|fridge_item|${crypto.randomUUID()}|`,
        subjectKind: "fridge_item",
        subjectId: crypto.randomUUID(),
        actorUserId: null,
        payload: {
            code: "fridge.expiring",
            params: { name: "Milk", daysLeft: 2, amounts: [1, 2.5] },
            related: [],
        },
        createdAt: "2026-11-20T10:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        ...over,
    };
}

function eventRow(
    c: SuiteCtx,
    over: Partial<NotificationRow> = {},
): NotificationRow {
    return sampleRow(c, {
        kind: "recipe_changes",
        source: "event",
        noticeKey: `event:${crypto.randomUUID()}`,
        subjectKind: "recipe",
        actorUserId: c.memberId,
        payload: { recipeName: "Beef chili", actorName: "Member" },
        ...over,
    });
}

const byId = <T extends { id: string }>(list: readonly T[]) =>
    [...list].sort((a, b) => a.id.localeCompare(b.id));

/**
 * The behaviours of a `NotificationsStore`, run against the memory store and
 * the Postgres one: the db store has to read the same as the reference.
 */
function runStoreSuite(
    label: string,
    getStore: () => NotificationsStore,
    reset: () => Promise<void>,
    ctx: () => SuiteCtx,
): void {
    describe(`${label} notifications store`, () => {
        test("insertMany returns the rows it wrote and every read gives them back whole", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const a = sampleRow(c);
            const b = eventRow(c, {
                recipientUserId: c.memberId,
                readAt: "2026-11-20T11:00:00.000Z",
                snoozedUntil: "2026-11-22T09:00:00.000Z",
                snoozedBy: c.memberId,
                dismissedAt: "2026-11-20T12:00:00.000Z",
                dismissedBy: c.ownerId,
            });
            const inserted = await store.insertMany([a, b]);
            expect(byId(inserted)).toEqual(byId([a, b]));
            expect(await store.get(c.householdId, a.id)).toEqual(a);
            expect(await store.get(c.householdId, b.id)).toEqual(b);
            expect(byId(await store.listForHousehold(c.householdId))).toEqual(
                byId([a, b]),
            );
        });

        test("get is null for an unknown id", async () => {
            await reset();
            const c = ctx();
            expect(
                await getStore().get(c.householdId, crypto.randomUUID()),
            ).toBeNull();
        });

        test("an id that is not a uuid names no row, and leaves the others alone", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const row = sampleRow(c);
            await store.insertMany([row]);
            expect(await store.get(c.householdId, "not-a-uuid")).toBeNull();
            expect(
                await store.update(c.householdId, ["not-a-uuid"], {
                    readAt: "2026-11-21T10:00:00.000Z",
                }),
            ).toEqual([]);
            expect(
                await store.updatePayloads(c.householdId, [
                    { id: "not-a-uuid", payload: { changed: true } },
                ]),
            ).toEqual([]);
            expect(await store.deleteMany(["not-a-uuid"])).toBe(0);
            // Mixed with a real id, the real one still applies.
            const read = await store.update(
                c.householdId,
                ["not-a-uuid", row.id],
                { readAt: "2026-11-21T10:00:00.000Z" },
            );
            expect(read.map((r) => r.id)).toEqual([row.id]);
            expect(await store.get(c.householdId, row.id)).toEqual({
                ...row,
                readAt: "2026-11-21T10:00:00.000Z",
            });
        });

        test("insertMany with nothing to write writes nothing", async () => {
            await reset();
            const c = ctx();
            expect(await getStore().insertMany([])).toEqual([]);
            expect(await getStore().listForHousehold(c.householdId)).toEqual(
                [],
            );
        });

        test("insertMany skips a row whose recipient already has an open row with the key", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const first = sampleRow(c);
            await store.insertMany([first]);
            const again = sampleRow(c, { noticeKey: first.noticeKey });
            const forOther = sampleRow(c, {
                noticeKey: first.noticeKey,
                recipientUserId: c.memberId,
            });
            const inserted = await store.insertMany([again, forOther]);
            // The other person has no open row with that key yet.
            expect(inserted.map((r) => r.id)).toEqual([forOther.id]);
            expect(await store.get(c.householdId, again.id)).toBeNull();
            expect(
                (await store.listForRecipient(c.householdId, c.ownerId)).map(
                    (r) => r.id,
                ),
            ).toEqual([first.id]);
        });

        test("insertMany skips a duplicate inside one batch", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const a = sampleRow(c);
            const b = sampleRow(c, { noticeKey: a.noticeKey });
            const inserted = await store.insertMany([a, b]);
            expect(inserted.map((r) => r.id)).toEqual([a.id]);
            expect(await store.listForHousehold(c.householdId)).toHaveLength(1);
        });

        test("a resolved row no longer blocks the same key: the condition comes back as a fresh row", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const first = sampleRow(c);
            await store.insertMany([first]);
            await store.update(c.householdId, [first.id], {
                resolvedAt: "2026-11-20T13:00:00.000Z",
            });
            const fresh = sampleRow(c, { noticeKey: first.noticeKey });
            expect((await store.insertMany([fresh])).map((r) => r.id)).toEqual([
                fresh.id,
            ]);
            // One open row, one resolved, for the same person and key.
            const mine = await store.listForRecipient(c.householdId, c.ownerId);
            expect(byId(mine).map((r) => r.id)).toEqual(
                byId([first, fresh]).map((r) => r.id),
            );
        });

        test("listOpenConditions is the household's unresolved condition rows, nothing else", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const open = sampleRow(c);
            const openOther = sampleRow(c, { recipientUserId: c.memberId });
            const cleared = sampleRow(c, {
                resolvedAt: "2026-11-20T13:00:00.000Z",
            });
            const event = eventRow(c);
            await store.insertMany([open, openOther, cleared, event]);
            expect(
                byId(await store.listOpenConditions(c.householdId)).map(
                    (r) => r.id,
                ),
            ).toEqual(byId([open, openOther]).map((r) => r.id));
        });

        test("listForRecipient is one person's rows", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const mine = sampleRow(c);
            const theirs = sampleRow(c, { recipientUserId: c.memberId });
            await store.insertMany([mine, theirs]);
            expect(
                (await store.listForRecipient(c.householdId, c.ownerId)).map(
                    (r) => r.id,
                ),
            ).toEqual([mine.id]);
            expect(
                (await store.listForRecipient(c.householdId, c.memberId)).map(
                    (r) => r.id,
                ),
            ).toEqual([theirs.id]);
        });

        test("update changes the named rows only, clears with null and leaves undefined alone", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const a = sampleRow(c, {
                snoozedUntil: "2026-11-25T09:00:00.000Z",
                snoozedBy: c.ownerId,
            });
            const b = sampleRow(c);
            await store.insertMany([a, b]);
            const changed = await store.update(c.householdId, [a.id], {
                readAt: "2026-11-21T08:00:00.000Z",
                snoozedUntil: null,
                snoozedBy: null,
                dismissedBy: undefined,
            });
            expect(changed).toEqual([
                {
                    ...a,
                    readAt: "2026-11-21T08:00:00.000Z",
                    snoozedUntil: null,
                    snoozedBy: null,
                },
            ]);
            expect(await store.get(c.householdId, b.id)).toEqual(b);
            expect(
                await store.update(c.householdId, [], {
                    readAt: NOW.toISOString(),
                }),
            ).toEqual([]);
        });

        test("update with an empty patch returns the rows unchanged", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const a = sampleRow(c);
            await store.insertMany([a]);
            expect(await store.update(c.householdId, [a.id], {})).toEqual([a]);
        });

        test("updatePayloads replaces the payload of the named rows", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const a = sampleRow(c);
            const b = sampleRow(c);
            await store.insertMany([a, b]);
            const payload = {
                code: "fridge.expiring",
                params: { name: "Milk", daysLeft: 1 },
                related: [{ kind: "food", id: "x", name: "Milk" }],
            };
            const out = await store.updatePayloads(c.householdId, [
                { id: a.id, payload },
                { id: crypto.randomUUID(), payload: { gone: true } },
            ]);
            expect(out).toEqual([{ ...a, payload }]);
            expect((await store.get(c.householdId, a.id))?.payload).toEqual(
                payload,
            );
            expect(await store.get(c.householdId, b.id)).toEqual(b);
            expect(await store.updatePayloads(c.householdId, [])).toEqual([]);
        });

        test("updateOpenByKey updates every unresolved row with the key and no other", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const key = "fridge.expiring|fridge_item|shared|";
            const mine = sampleRow(c, { noticeKey: key });
            const theirs = sampleRow(c, {
                noticeKey: key,
                recipientUserId: c.memberId,
            });
            const cleared = sampleRow(c, {
                noticeKey: key,
                resolvedAt: "2026-11-19T13:00:00.000Z",
            });
            const otherKey = sampleRow(c);
            await store.insertMany([mine, theirs, cleared, otherKey]);
            const at = "2026-11-21T09:00:00.000Z";
            const out = await store.updateOpenByKey(c.householdId, key, {
                dismissedAt: at,
                dismissedBy: c.ownerId,
            });
            expect(byId(out).map((r) => r.id)).toEqual(
                byId([mine, theirs]).map((r) => r.id),
            );
            expect((await store.get(c.householdId, mine.id))?.dismissedAt).toBe(
                at,
            );
            expect(
                (await store.get(c.householdId, theirs.id))?.dismissedBy,
            ).toBe(c.ownerId);
            expect(await store.get(c.householdId, cleared.id)).toEqual(cleared);
            expect(await store.get(c.householdId, otherKey.id)).toEqual(
                otherKey,
            );
        });

        test("updateOpenByKey with skipDismissed leaves an already dismissed row as it is", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const key = "fridge.expiring|fridge_item|skip|";
            const first = "2026-11-18T09:00:00.000Z";
            const done = sampleRow(c, {
                noticeKey: key,
                dismissedAt: first,
                dismissedBy: c.memberId,
            });
            const fresh = sampleRow(c, {
                noticeKey: key,
                recipientUserId: c.memberId,
            });
            await store.insertMany([done, fresh]);
            const out = await store.updateOpenByKey(
                c.householdId,
                key,
                { dismissedAt: NOW.toISOString(), dismissedBy: c.ownerId },
                { skipDismissed: true },
            );
            expect(out.map((r) => r.id)).toEqual([fresh.id]);
            const kept = await store.get(c.householdId, done.id);
            expect(kept?.dismissedAt).toBe(first);
            expect(kept?.dismissedBy).toBe(c.memberId);
        });

        test("updateOpenByKey with keepOwnSnoozeFrom keeps a person's own later snooze and replaces the rest", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const key = "fridge.expiring|fridge_item|snooze|";
            const from = "2026-11-23T09:00:00.000Z";
            // Their own snooze, to the cut-off or later: kept.
            const ownLater = sampleRow(c, {
                noticeKey: key,
                snoozedUntil: "2026-11-30T09:00:00.000Z",
                snoozedBy: c.ownerId,
            });
            const ownExact = sampleRow(c, {
                noticeKey: key,
                recipientUserId: c.memberId,
                snoozedUntil: from,
                snoozedBy: c.memberId,
            });
            const admin = await seedExtraRecipient(c);
            // Their own snooze that ends sooner: replaced.
            const ownSooner = sampleRow(c, {
                noticeKey: key,
                recipientUserId: admin,
                snoozedUntil: "2026-11-22T09:00:00.000Z",
                snoozedBy: admin,
            });
            await store.insertMany([ownLater, ownExact, ownSooner]);
            const out = await store.updateOpenByKey(
                c.householdId,
                key,
                { snoozedUntil: from, snoozedBy: c.ownerId },
                { keepOwnSnoozeFrom: from },
            );
            expect(out.map((r) => r.id)).toEqual([ownSooner.id]);
            expect(
                (await store.get(c.householdId, ownLater.id))?.snoozedUntil,
            ).toBe("2026-11-30T09:00:00.000Z");
            expect(
                (await store.get(c.householdId, ownExact.id))?.snoozedBy,
            ).toBe(c.memberId);
            expect(
                (await store.get(c.householdId, ownSooner.id))?.snoozedBy,
            ).toBe(c.ownerId);
        });

        test("updateOpenByKey with keepOwnSnoozeFrom replaces a snooze someone else set, and a row that was never snoozed", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const key = "fridge.expiring|fridge_item|other|";
            const from = "2026-11-23T09:00:00.000Z";
            const setByAdmin = sampleRow(c, {
                noticeKey: key,
                snoozedUntil: "2026-12-30T09:00:00.000Z",
                snoozedBy: c.memberId,
            });
            const never = sampleRow(c, {
                noticeKey: key,
                recipientUserId: c.memberId,
            });
            await store.insertMany([setByAdmin, never]);
            const out = await store.updateOpenByKey(
                c.householdId,
                key,
                { snoozedUntil: from, snoozedBy: c.ownerId },
                { keepOwnSnoozeFrom: from },
            );
            expect(byId(out).map((r) => r.id)).toEqual(
                byId([setByAdmin, never]).map((r) => r.id),
            );
        });

        test("listForSweep is what was dismissed or resolved before the cut-off, and deleteMany removes by id", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const before = "2026-10-22T12:00:00.000Z";
            const dismissedOld = eventRow(c, {
                dismissedAt: "2026-10-01T00:00:00.000Z",
            });
            const resolvedOld = sampleRow(c, {
                resolvedAt: "2026-10-01T00:00:00.000Z",
            });
            const dismissedAtCutoff = eventRow(c, { dismissedAt: before });
            const resolvedRecent = sampleRow(c, {
                resolvedAt: "2026-11-15T00:00:00.000Z",
            });
            const plain = sampleRow(c);
            await store.insertMany([
                dismissedOld,
                resolvedOld,
                dismissedAtCutoff,
                resolvedRecent,
                plain,
            ]);
            expect(
                byId(await store.listForSweep(before)).map((r) => r.id),
            ).toEqual(byId([dismissedOld, resolvedOld]).map((r) => r.id));
            expect(
                await store.deleteMany([
                    dismissedOld.id,
                    resolvedOld.id,
                    crypto.randomUUID(),
                ]),
            ).toBe(2);
            expect(await store.deleteMany([])).toBe(0);
            expect(
                byId(await store.listForHousehold(c.householdId)).map(
                    (r) => r.id,
                ),
            ).toEqual(
                byId([dismissedAtCutoff, resolvedRecent, plain]).map(
                    (r) => r.id,
                ),
            );
        });

        test("the sweep deletes what sweepable selects and keeps a dismissed condition that is still open", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const dismissedEventOld = eventRow(c, {
                dismissedAt: isoDaysAgo(31),
            });
            const clearedConditionOld = sampleRow(c, {
                resolvedAt: isoDaysAgo(31),
            });
            const dismissedEventRecent = eventRow(c, {
                dismissedAt: isoDaysAgo(29),
            });
            const clearedConditionRecent = sampleRow(c, {
                resolvedAt: isoDaysAgo(29),
            });
            // Still true, dismissed long ago: deleting it would let the next
            // sync bring it back.
            const dismissedOpenCondition = sampleRow(c, {
                dismissedAt: isoDaysAgo(90),
                dismissedBy: c.ownerId,
            });
            const untouched = sampleRow(c);
            await store.insertMany([
                dismissedEventOld,
                clearedConditionOld,
                dismissedEventRecent,
                clearedConditionRecent,
                dismissedOpenCondition,
                untouched,
            ]);
            expect(await sweepNotifications({ store }, NOW)).toBe(2);
            expect(
                byId(await store.listForHousehold(c.householdId)).map(
                    (r) => r.id,
                ),
            ).toEqual(
                byId([
                    dismissedEventRecent,
                    clearedConditionRecent,
                    dismissedOpenCondition,
                    untouched,
                ]).map((r) => r.id),
            );
            expect(await sweepNotifications({ store }, NOW)).toBe(0);
        });

        test("preferences upsert, list and delete", async () => {
            await reset();
            const c = ctx();
            const store = getStore();
            const pref = (
                userId: string,
                kind: NotificationPref["kind"],
                enabled: boolean,
                updatedAt = "2026-11-20T10:00:00.000Z",
            ): NotificationPref => ({
                householdId: c.householdId,
                userId,
                kind,
                enabled,
                updatedAt,
            });
            const off = pref(c.ownerId, "week_plan_changes", false);
            expect(await store.upsertPref(off)).toEqual(off);
            // The same person and kind again replaces it.
            const on = pref(
                c.ownerId,
                "week_plan_changes",
                true,
                "2026-11-21T10:00:00.000Z",
            );
            expect(await store.upsertPref(on)).toEqual(on);
            const other = pref(c.ownerId, "new_usuals", true);
            const theirs = pref(c.memberId, "week_plan_changes", false);
            await store.upsertPref(other);
            await store.upsertPref(theirs);
            const mine = await store.listPrefs(c.householdId, c.ownerId);
            expect(
                [...mine].sort((a, b) => a.kind.localeCompare(b.kind)),
            ).toEqual([other, on].sort((a, b) => a.kind.localeCompare(b.kind)));
            expect((await store.listHouseholdPrefs(c.householdId)).length).toBe(
                3,
            );
            expect(
                await store.deletePref(c.householdId, c.ownerId, "new_usuals"),
            ).toBe(true);
            expect(
                await store.deletePref(c.householdId, c.ownerId, "new_usuals"),
            ).toBe(false);
            expect(await store.listPrefs(c.householdId, c.ownerId)).toEqual([
                on,
            ]);
            expect(await store.listPrefs(c.householdId, c.memberId)).toEqual([
                theirs,
            ]);
        });
    });
}

// A third recipient in the household. The memory run makes up an id; the db
// run seeds a real member (its ids are filled in by `extraRecipient`).
let extraRecipient: () => Promise<string> = async () => crypto.randomUUID();
const seedExtraRecipient = (_c: SuiteCtx) => extraRecipient();

// ---------------------------------------------------------------- memory ---

{
    let store = createMemoryNotificationsStore();
    const memoryCtx: SuiteCtx = {
        householdId: crypto.randomUUID(),
        ownerId: crypto.randomUUID(),
        memberId: crypto.randomUUID(),
    };
    runStoreSuite(
        "memory",
        () => store,
        async () => {
            store = createMemoryNotificationsStore();
            extraRecipient = async () => crypto.randomUUID();
        },
        () => memoryCtx,
    );
}

// ----------------------------------------------------------------- sweep ---

describe("startNotificationSweep", () => {
    // Run the timer by hand: capture what the sweep hands to setInterval.
    async function withTimer<T>(
        run: (timer: {
            tick: () => Promise<void>;
            firstRun: () => Promise<void>;
            everyMs: () => number;
            firstAfterMs: () => number;
            unreffed: () => boolean;
        }) => Promise<T>,
        start: () => void,
    ): Promise<T> {
        const real = globalThis.setInterval;
        const realTimeout = globalThis.setTimeout;
        let callback: (() => Promise<void>) | undefined;
        let first: (() => Promise<void>) | undefined;
        let ms = 0;
        let firstMs = 0;
        let unref = false;
        let firstUnref = false;
        globalThis.setInterval = ((fn: () => Promise<void>, every: number) => {
            callback = fn;
            ms = every;
            return {
                unref() {
                    unref = true;
                },
            };
        }) as unknown as typeof setInterval;
        globalThis.setTimeout = ((fn: () => Promise<void>, after: number) => {
            first = fn;
            firstMs = after;
            return {
                unref() {
                    firstUnref = true;
                },
            };
        }) as unknown as typeof setTimeout;
        try {
            start();
        } finally {
            globalThis.setInterval = real;
            globalThis.setTimeout = realTimeout;
        }
        return run({
            tick: () => callback!(),
            firstRun: () => first!(),
            everyMs: () => ms,
            firstAfterMs: () => firstMs,
            unreffed: () => unref && firstUnref,
        });
    }

    test("deletes what the sweep selects on each tick, and does not hold the process open", async () => {
        const c: SuiteCtx = {
            householdId: crypto.randomUUID(),
            ownerId: crypto.randomUUID(),
            memberId: crypto.randomUUID(),
        };
        const store = createMemoryNotificationsStore();
        const old = eventRow(c, {
            dismissedAt: new Date(Date.now() - 40 * DAY_MS).toISOString(),
        });
        const recent = eventRow(c, {
            dismissedAt: new Date(Date.now() - DAY_MS).toISOString(),
        });
        await store.insertMany([old, recent]);
        const logged: string[] = [];
        await withTimer(
            async (timer) => {
                expect(timer.unreffed()).toBe(true);
                expect(timer.everyMs()).toBeGreaterThanOrEqual(60_000);
                // The first run comes soon after boot, well before the hour.
                expect(timer.firstAfterMs()).toBeLessThan(timer.everyMs());
                await timer.firstRun();
            },
            () => startNotificationSweep(store, (m) => logged.push(m)),
        );
        expect(
            (await store.listForHousehold(c.householdId)).map((r) => r.id),
        ).toEqual([recent.id]);
        expect(logged).toEqual(["[notifications] swept 1"]);
    });

    test("a failed sweep is logged and the next tick runs", async () => {
        const store = createMemoryNotificationsStore();
        let calls = 0;
        const failing: NotificationsStore = {
            ...store,
            async listForSweep(before) {
                calls++;
                if (calls === 1) throw new Error("database away");
                return store.listForSweep(before);
            },
        };
        const errors = spyOn(console, "error").mockImplementation(() => {});
        try {
            await withTimer(
                async (timer) => {
                    await timer.tick();
                    await timer.tick();
                },
                () => startNotificationSweep(failing, () => {}),
            );
            expect(calls).toBe(2);
            expect(errors).toHaveBeenCalledTimes(1);
            expect(String(errors.mock.calls[0]?.[1])).toContain(
                "database away",
            );
        } finally {
            errors.mockRestore();
        }
    });
});

// -------------------------------------------------------------------- db ---

describeDb(
    pgAvailable !== null,
    "notifications (live)",
    (getCtx) => {
        let c: SuiteCtx;
        let otherHouseholdId: string;
        let otherOwnerId: string;
        const store = liveNotificationsStore();

        async function resetDb(): Promise<void> {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            // A deploy holds one household, but the boundary has to hold for
            // two, so this throwaway database lifts the one-household index.
            await sql`drop index if exists public.households_singleton`;
            const a = await seedHousehold(sql);
            const memberId = await seedMember(sql, a.householdId);
            const b = await seedHousehold(sql);
            c = { householdId: a.householdId, ownerId: a.userId, memberId };
            otherHouseholdId = b.householdId;
            otherOwnerId = b.userId;
            extraRecipient = () =>
                seedMember(sql, a.householdId, { role: "admin" });
            setFallbackActorForTests({
                kind: "user",
                userId: a.userId,
                householdId: a.householdId,
            });
        }

        afterEach(() => {
            setSqlForTests(null);
        });

        runStoreSuite(
            "postgres",
            () => store,
            resetDb,
            () => c,
        );

        describe("row level security and scoping", () => {
            test("another household reads, updates and deletes nothing", async () => {
                await resetDb();
                const { sql } = getCtx();
                const row = sampleRow(c, {
                    dismissedAt: "2026-10-01T00:00:00.000Z",
                });
                await store.insertMany([row]);
                const pref: NotificationPref = {
                    householdId: c.householdId,
                    userId: c.ownerId,
                    kind: "new_usuals",
                    enabled: true,
                    updatedAt: "2026-11-20T10:00:00.000Z",
                };
                await store.upsertPref(pref);
                await withActor(
                    { kind: "household", householdId: otherHouseholdId },
                    async () => {
                        // Asking for the first household by its id.
                        expect(
                            await store.listForHousehold(c.householdId),
                        ).toEqual([]);
                        expect(
                            await store.listOpenConditions(c.householdId),
                        ).toEqual([]);
                        expect(
                            await store.listForRecipient(
                                c.householdId,
                                c.ownerId,
                            ),
                        ).toEqual([]);
                        expect(
                            await store.get(c.householdId, row.id),
                        ).toBeNull();
                        expect(
                            await store.update(c.householdId, [row.id], {
                                readAt: NOW.toISOString(),
                            }),
                        ).toEqual([]);
                        expect(
                            await store.updatePayloads(c.householdId, [
                                { id: row.id, payload: { taken: true } },
                            ]),
                        ).toEqual([]);
                        expect(
                            await store.updateOpenByKey(
                                c.householdId,
                                row.noticeKey,
                                {
                                    dismissedAt: NOW.toISOString(),
                                },
                            ),
                        ).toEqual([]);
                        expect(
                            await store.listPrefs(c.householdId, c.ownerId),
                        ).toEqual([]);
                        expect(
                            await store.listHouseholdPrefs(c.householdId),
                        ).toEqual([]);
                        expect(
                            await store.deletePref(
                                c.householdId,
                                c.ownerId,
                                "new_usuals",
                            ),
                        ).toBe(false);
                        // The sweep sees only the household it acts for.
                        expect(
                            await store.listForSweep(NOW.toISOString()),
                        ).toEqual([]);
                        expect(await store.deleteMany([row.id])).toBe(0);
                        // And cannot write into the first household.
                        await expect(
                            store.insertMany([sampleRow(c)]),
                        ).rejects.toThrow();
                        await expect(
                            store.upsertPref({
                                ...pref,
                                kind: "week_plan_changes",
                            }),
                        ).rejects.toThrow();
                    },
                );
                const [stored] = await sql`
                    select read_at, dismissed_at, payload
                    from public.notifications
                    where id = ${row.id}::uuid
                `;
                expect(stored!.read_at).toBeNull();
                expect(stored!.payload).toEqual(row.payload);
                expect(
                    await sql`select 1 from public.notification_prefs where user_id = ${c.ownerId}::uuid`,
                ).toHaveLength(1);
                // The owner of the other household is not a way in either.
                await withActor(
                    {
                        kind: "user",
                        userId: otherOwnerId,
                        householdId: otherHouseholdId,
                    },
                    async () => {
                        expect(
                            await store.listForHousehold(c.householdId),
                        ).toEqual([]);
                        expect(
                            await store.get(c.householdId, row.id),
                        ).toBeNull();
                    },
                );
            });

            test("a household id that is not the row's is not a match, even with no row level security", async () => {
                await resetDb();
                const row = sampleRow(c);
                await store.insertMany([row]);
                await store.upsertPref({
                    householdId: c.householdId,
                    userId: c.ownerId,
                    kind: "week_plan_changes",
                    enabled: false,
                    updatedAt: "2026-11-20T10:00:00.000Z",
                });
                await withActor(
                    { kind: "system", reason: "database test" },
                    async () => {
                        expect(
                            await store.get(otherHouseholdId, row.id),
                        ).toBeNull();
                        expect(
                            await store.listOpenConditions(otherHouseholdId),
                        ).toEqual([]);
                        expect(
                            await store.listForRecipient(
                                otherHouseholdId,
                                row.recipientUserId,
                            ),
                        ).toEqual([]);
                        expect(
                            await store.updatePayloads(otherHouseholdId, [
                                { id: row.id, payload: { changed: true } },
                            ]),
                        ).toEqual([]);
                        expect(
                            await store.listPrefs(otherHouseholdId, c.ownerId),
                        ).toEqual([]);
                        expect(
                            await store.listHouseholdPrefs(otherHouseholdId),
                        ).toEqual([]);
                        expect(
                            await store.deletePref(
                                otherHouseholdId,
                                c.ownerId,
                                "week_plan_changes",
                            ),
                        ).toBe(false);
                        expect(
                            await store.update(otherHouseholdId, [row.id], {
                                readAt: NOW.toISOString(),
                            }),
                        ).toEqual([]);
                        expect(
                            await store.updateOpenByKey(
                                otherHouseholdId,
                                row.noticeKey,
                                {
                                    readAt: NOW.toISOString(),
                                },
                            ),
                        ).toEqual([]);
                        expect(
                            await store.listForHousehold(otherHouseholdId),
                        ).toEqual([]);
                        // An empty patch only reads; it must not read across
                        // households either.
                        expect(
                            await store.update(otherHouseholdId, [row.id], {}),
                        ).toEqual([]);
                        expect(
                            await store.updateOpenByKey(
                                otherHouseholdId,
                                row.noticeKey,
                                {},
                            ),
                        ).toEqual([]);
                    },
                );
                const kept = await store.get(c.householdId, row.id);
                expect(kept?.readAt).toBeNull();
                expect(kept?.payload).toEqual(row.payload);
                expect(
                    await store.listPrefs(c.householdId, c.ownerId),
                ).toHaveLength(1);
            });

            test("the sweep, run as the system, reaches every household", async () => {
                await resetDb();
                const { sql } = getCtx();
                const old = "2026-10-01T00:00:00.000Z";
                const mine = eventRow(c, { dismissedAt: old });
                const theirs = eventRow(
                    {
                        householdId: otherHouseholdId,
                        ownerId: otherOwnerId,
                        memberId: otherOwnerId,
                    },
                    { dismissedAt: old, recipientUserId: otherOwnerId },
                );
                await sql`
                    insert into public.notifications (
                        id, household_id, recipient_user_id, kind, bucket, source,
                        notice_key, dismissed_at
                    )
                    values (
                        ${theirs.id}::uuid, ${otherHouseholdId}::uuid, ${otherOwnerId}::uuid,
                        'recipe_changes', 'household', 'event', ${theirs.noticeKey},
                        ${old}::timestamptz
                    )
                `;
                await store.insertMany([mine]);
                await withActor(
                    { kind: "system", reason: "notification sweep" },
                    async () => {
                        expect(await sweepNotifications({ store }, NOW)).toBe(
                            2,
                        );
                    },
                );
                expect(
                    await sql`select 1 from public.notifications`,
                ).toHaveLength(0);
            });
        });

        describe("the open-key unique index", () => {
            test("two inserts racing for the same condition leave one open row", async () => {
                await resetDb();
                const { sql } = getCtx();
                const key = "fridge.expiring|fridge_item|race|";
                const [x, y] = await Promise.all([
                    store.insertMany([sampleRow(c, { noticeKey: key })]),
                    store.insertMany([sampleRow(c, { noticeKey: key })]),
                ]);
                expect(x.length + y.length).toBe(1);
                expect(
                    await sql`
                        select 1 from public.notifications
                        where recipient_user_id = ${c.ownerId}::uuid
                          and notice_key = ${key}
                          and resolved_at is null
                    `,
                ).toHaveLength(1);
            });
        });

        describe("syncHouseholdNotifications", () => {
            const syncDeps = (): NotificationSyncDeps =>
                liveNotificationSyncDeps();

            async function addWeightLog(
                sql: SQL,
                userId: string,
                daysAgo: number,
            ): Promise<void> {
                await sql`
                    insert into public.weight_log (user_id, weight_g, logged_at)
                    values (
                        ${userId}::uuid,
                        ${80_000},
                        now() - ${`${daysAgo} days`}::interval
                    )
                `;
            }

            async function seedExpiring(
                sql: SQL,
                householdId: string,
                inDays: number,
                name = "Milk",
            ): Promise<string> {
                const foodId = await seedFood(sql, householdId, { name });
                const locationId = await seedFridgeLocation(sql, householdId);
                const itemId = await seedFridgeItem(
                    sql,
                    householdId,
                    locationId,
                    foodId,
                    { displayName: name, amount: 1, unit: "l" },
                );
                await setExpiry(sql, itemId, inDays);
                return itemId;
            }

            async function setExpiry(
                sql: SQL,
                itemId: string,
                inDays: number,
            ): Promise<void> {
                const today = await householdToday(c.householdId);
                await sql`
                    update public.fridge_items
                    set expires_on = ${shiftLocalDate(today, inDays)}
                    where id = ${itemId}::uuid
                `;
            }

            const openRows = async (kind?: string) =>
                (await store.listOpenConditions(c.householdId)).filter(
                    (r) => kind === undefined || r.kind === kind,
                );

            test("a Weigh-in due condition becomes a row for the member it names", async () => {
                await resetDb();
                const { sql } = getCtx();
                // Ten days since the member's last weigh-in; the owner weighed
                // in today.
                await addWeightLog(sql, c.memberId, 10);
                await addWeightLog(sql, c.ownerId, 0);
                const plan = await syncHouseholdNotifications(
                    syncDeps(),
                    c.householdId,
                );
                expect(plan.insert).toHaveLength(1);
                const rows = await openRows("weigh_in_due");
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    householdId: c.householdId,
                    recipientUserId: c.memberId,
                    kind: "weigh_in_due",
                    bucket: "personal",
                    source: "condition",
                    subjectKind: "member",
                    subjectId: c.memberId,
                    resolvedAt: null,
                    dismissedAt: null,
                });
                expect(rows[0]!.payload).toMatchObject({
                    code: "nutrition.weigh_in_due",
                });
            });

            test("a household kind reaches every member, and a second sync changes nothing", async () => {
                await resetDb();
                const { sql } = getCtx();
                const itemId = await seedExpiring(sql, c.householdId, 2);
                const first = await syncHouseholdNotifications(
                    syncDeps(),
                    c.householdId,
                );
                expect(first.insert).toHaveLength(2);
                const rows = await openRows("food_expiring");
                expect(rows.map((r) => r.recipientUserId).sort()).toEqual(
                    [c.ownerId, c.memberId].sort(),
                );
                expect(rows.every((r) => r.subjectId === itemId)).toBe(true);
                const again = await syncHouseholdNotifications(
                    syncDeps(),
                    c.householdId,
                );
                expect(again).toEqual({ insert: [], resolve: [], update: [] });
                expect(byId(await openRows("food_expiring"))).toEqual(
                    byId(rows),
                );
            });

            test("a condition the household dismissed for everyone stays one open row across syncs and resolves when it clears", async () => {
                await resetDb();
                const { sql } = getCtx();
                const itemId = await seedExpiring(sql, c.householdId, 2);
                const { today, timezone } = await householdClock(c.householdId);
                const { notices } = await noticesFor(
                    liveNoticesForDeps(),
                    c.householdId,
                    { today, timezone, actionable: true },
                );
                const notice = notices.find(
                    (n) => n.code === "fridge.expiring",
                )!;
                expect(notice.subject.id).toBe(itemId);
                await liveNoticeDismissalsStore().insert({
                    householdId: c.householdId,
                    ...dismissalKey(notice),
                    dismissedBy: c.ownerId,
                });
                // The household dismissal hides the notice from a plain read...
                const hidden = await noticesFor(
                    liveNoticesForDeps(),
                    c.householdId,
                    { today, timezone, actionable: true },
                );
                expect(
                    hidden.notices.some((n) => n.code === "fridge.expiring"),
                ).toBe(false);
                // ...but the sync still sees it as true.
                for (let i = 0; i < 3; i++) {
                    await syncHouseholdNotifications(syncDeps(), c.householdId);
                }
                const rows = await openRows("food_expiring");
                expect(rows).toHaveLength(2);
                expect(rows.every((r) => r.dismissedAt === null)).toBe(true);
                const ids = byId(rows).map((r) => r.id);
                // The item goes: the condition clears for everyone.
                await sql`delete from public.fridge_items where id = ${itemId}::uuid`;
                const cleared = await syncHouseholdNotifications(
                    syncDeps(),
                    c.householdId,
                );
                expect([...cleared.resolve].sort()).toEqual(ids);
                expect(await openRows("food_expiring")).toEqual([]);
                const all = await store.listForHousehold(c.householdId);
                expect(all.every((r) => r.resolvedAt !== null)).toBe(true);
            });

            test("a condition that comes back after it cleared starts a fresh row", async () => {
                await resetDb();
                const { sql } = getCtx();
                const itemId = await seedExpiring(sql, c.householdId, 2);
                await syncHouseholdNotifications(syncDeps(), c.householdId);
                const [first] = await openRows("food_expiring");
                await setExpiry(sql, itemId, 30);
                await syncHouseholdNotifications(syncDeps(), c.householdId);
                expect(await openRows("food_expiring")).toEqual([]);
                await setExpiry(sql, itemId, 2);
                await syncHouseholdNotifications(syncDeps(), c.householdId);
                const back = await openRows("food_expiring");
                expect(back).toHaveLength(2);
                expect(back.some((r) => r.id === first!.id)).toBe(false);
                expect(
                    (await store.listForHousehold(c.householdId)).length,
                ).toBe(4);
            });

            test("the payload follows the condition when its sentence parameters change", async () => {
                await resetDb();
                const { sql } = getCtx();
                const itemId = await seedExpiring(sql, c.householdId, 3);
                await syncHouseholdNotifications(syncDeps(), c.householdId);
                const before = await openRows("food_expiring");
                expect(before).toHaveLength(2);
                const params = (r: NotificationRow) =>
                    (r.payload as { params: { daysLeft?: number } }).params;
                expect(before.every((r) => params(r).daysLeft === 3)).toBe(
                    true,
                );
                await setExpiry(sql, itemId, 1);
                const plan = await syncHouseholdNotifications(
                    syncDeps(),
                    c.householdId,
                );
                expect(plan.insert).toEqual([]);
                expect(plan.update).toHaveLength(2);
                const after = await openRows("food_expiring");
                expect(after.every((r) => params(r).daysLeft === 1)).toBe(true);
                // Same rows, same moment they appeared.
                expect(byId(after).map((r) => [r.id, r.createdAt])).toEqual(
                    byId(before).map((r) => [r.id, r.createdAt]),
                );
            });

            test("notices the caller already has are used as they are", async () => {
                await resetDb();
                const { sql } = getCtx();
                await seedExpiring(sql, c.householdId, 2);
                const { today, timezone } = await householdClock(c.householdId);
                const { notices } = await noticesFor(
                    liveNoticesForDeps(),
                    c.householdId,
                    {
                        today,
                        timezone,
                        actionable: true,
                        includeDismissed: true,
                    },
                );
                const deps: NotificationSyncDeps = {
                    ...syncDeps(),
                    loadNotices: async () => {
                        throw new Error("the sync computed notices again");
                    },
                };
                const plan = await syncHouseholdNotifications(
                    deps,
                    c.householdId,
                    { notices },
                );
                expect(plan.insert).toHaveLength(2);
                // An empty list is a real answer: nothing is true any more.
                const empty = await syncHouseholdNotifications(
                    deps,
                    c.householdId,
                    { notices: [] },
                );
                expect(empty.resolve).toHaveLength(2);
                expect(await openRows()).toEqual([]);
            });

            test("trySync logs a failure and returns null instead of throwing", async () => {
                await resetDb();
                const logged: string[] = [];
                const deps: NotificationSyncDeps = {
                    ...syncDeps(),
                    listMembers: async () => {
                        throw new Error("members unavailable");
                    },
                };
                const result = await trySyncHouseholdNotifications(
                    deps,
                    c.householdId,
                    { notices: [] },
                    (msg) => logged.push(msg),
                );
                expect(result).toBeNull();
                expect(logged).toHaveLength(1);
                expect(logged[0]).toContain("members unavailable");
            });
        });

        describe("the restock tick", () => {
            test("syncs the restock-enabled households it ticks, Weigh-in due included", async () => {
                await resetDb();
                const { sql } = getCtx();
                await sql`
                    insert into public.weight_log (user_id, weight_g, logged_at)
                    values (${c.memberId}::uuid, ${80_000}, now() - interval '12 days')
                `;
                const base = await getHouseholdConfig(c.householdId);
                await updateHouseholdConfig(c.householdId, {
                    ...base,
                    preferences: {
                        ...base.preferences,
                        timezone: "UTC",
                        restock: {
                            enabled: true,
                            weekday: 6,
                            time: "00:00",
                            lastRunOn: null,
                        },
                    },
                });
                // A second household that never turned restock on is not ticked.
                await sql`
                    insert into public.weight_log (user_id, weight_g, logged_at)
                    values (${otherOwnerId}::uuid, ${80_000}, now() - interval '12 days')
                `;
                // The runner names its own actors: with no test fallback, a
                // query it left without one would throw.
                setFallbackActorForTests(null);
                try {
                    await runRestockCheck(
                        liveRestockCheckDeps(),
                        new Date("2026-06-06T12:00:00.000Z"),
                    );
                } finally {
                    setFallbackActorForTests({
                        kind: "user",
                        userId: c.ownerId,
                        householdId: c.householdId,
                    });
                }
                const rows = await sql`
                    select household_id, recipient_user_id, kind, resolved_at
                    from public.notifications
                `;
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    household_id: c.householdId,
                    recipient_user_id: c.memberId,
                    kind: "weigh_in_due",
                    resolved_at: null,
                });
            });
        });
    },
    { actor: null },
);
