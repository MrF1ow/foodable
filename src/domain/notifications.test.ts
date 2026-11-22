import { describe, expect, test } from "bun:test";
import {
    NOTIFICATION_KINDS,
    NOTIFICATION_KIND_IDS,
    kindForNoticeCode,
    type NotificationKind,
} from "./notification-kinds.js";
import {
    NotificationActionError,
    createMemoryNotificationsStore,
    dismiss,
    fanOutEvent,
    inboxFor,
    inboxKindForNotice,
    kindEnabled,
    markRead,
    notificationFromDb,
    notificationPrefFromDb,
    notificationPrefToDb,
    notificationToDb,
    resolveSnoozeUntil,
    setPref,
    snooze,
    sweepable,
    syncConditions,
    syncHouseholdConditions,
    type NotificationMember,
    type NotificationRow,
} from "./notifications.js";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKey,
    dismissalKeyString,
    type NoticeDismissal,
} from "./notice-dismissals.js";
import { noticeCodeDismissible } from "../copy/notices.js";
import { NOTICE_CODES, type Notice, type NoticeCode } from "./notices.js";

const HOUSEHOLD = "h1";
const OLIVE = "00000000-0000-4000-8000-000000000001";
const ADAM = "00000000-0000-4000-8000-000000000002";
const MIA = "00000000-0000-4000-8000-000000000003";
const MEMBERS: NotificationMember[] = [
    { userId: OLIVE, role: "owner" },
    { userId: ADAM, role: "admin" },
    { userId: MIA, role: "member" },
];
const NOW = new Date("2026-11-21T12:00:00.000Z");

let nextId = 0;
const newId = () => `n${++nextId}`;

function notice(
    code: NoticeCode,
    subjectId: string,
    subjectKind: Notice["subject"]["kind"] = "fridge_item",
    params: Notice["params"] = {},
): Notice {
    return {
        code,
        severity: "info",
        subject: { kind: subjectKind, id: subjectId } as Notice["subject"],
        related: [],
        params,
    };
}

const expiring = (id: string) => notice("fridge.expiring", id);
const allergen = (id: string) => notice("grocery.allergen", id, "grocery_line");
const weighIn = (userId: string, lastOn = "2026-11-10") =>
    notice("nutrition.weigh_in_due", userId, "member", {
        dismissScope: lastOn,
    });

function openRow(
    over: Partial<NotificationRow> & Pick<NotificationRow, "noticeKey">,
): NotificationRow {
    return {
        id: newId(),
        householdId: HOUSEHOLD,
        recipientUserId: MIA,
        kind: "food_expiring",
        bucket: "household",
        source: "condition",
        subjectKind: null,
        subjectId: null,
        actorUserId: null,
        payload: {},
        createdAt: "2026-11-20T08:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        ...over,
    };
}

describe("kinds registry", () => {
    test("every kind has a spec, Allergens cannot be turned off, and only it", () => {
        expect(NOTIFICATION_KIND_IDS).toHaveLength(7);
        for (const id of NOTIFICATION_KIND_IDS) {
            expect(NOTIFICATION_KINDS[id].id).toBe(id);
        }
        const locked = NOTIFICATION_KIND_IDS.filter(
            (id) => !NOTIFICATION_KINDS[id].canDisable,
        );
        expect(locked).toEqual(["allergens"]);
        expect(NOTIFICATION_KINDS.allergens.defaultOn).toBe(true);
    });

    test("buckets, sources and defaults follow the approved table", () => {
        const table = NOTIFICATION_KIND_IDS.map((id) => {
            const k = NOTIFICATION_KINDS[id];
            return [id, k.source, k.bucket, k.defaultOn];
        });
        expect(table).toEqual([
            ["allergens", "condition", "household", true],
            ["food_expiring", "condition", "household", true],
            ["running_low", "condition", "household", true],
            ["weigh_in_due", "condition", "personal", true],
            ["recipe_changes", "event", "household", false],
            ["week_plan_changes", "event", "household", false],
            ["new_usuals", "event", "household", false],
        ]);
    });

    test("notice codes map to their kind; data-quality codes map to none", () => {
        const mapped: Partial<Record<NoticeCode, NotificationKind>> = {
            "grocery.allergen": "allergens",
            "recipe.allergen": "allergens",
            "food.product_allergen": "allergens",
            "fridge.expiring": "food_expiring",
            "fridge.expired": "food_expiring",
            "grocery.running_low": "running_low",
            "nutrition.weigh_in_due": "weigh_in_due",
        };
        for (const code of NOTICE_CODES) {
            expect(kindForNoticeCode(code)).toBe(mapped[code] ?? null);
            expect(inboxKindForNotice(notice(code, "x"))).toBe(
                mapped[code] ?? null,
            );
        }
    });
});

describe("syncConditions", () => {
    test("inserts one row per member for a household condition and keys it by dismissalKeyString", () => {
        const n = expiring("f1");
        const { insert, resolve } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [n],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(resolve).toEqual([]);
        expect(insert.map((r) => r.recipientUserId).sort()).toEqual(
            [OLIVE, ADAM, MIA].sort(),
        );
        for (const row of insert) {
            expect(row).toMatchObject({
                householdId: HOUSEHOLD,
                kind: "food_expiring",
                bucket: "household",
                source: "condition",
                noticeKey: dismissalKeyString(dismissalKey(n)),
                subjectKind: "fridge_item",
                subjectId: "f1",
                createdAt: NOW.toISOString(),
                readAt: null,
                dismissedAt: null,
                resolvedAt: null,
            });
            expect(row.payload).toMatchObject({ code: "fridge.expiring" });
        }
    });

    test("two notices with the same key give each member one row", () => {
        const { insert } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [expiring("f1"), expiring("f1")],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert).toHaveLength(MEMBERS.length);
        expect(new Set(insert.map((r) => r.recipientUserId)).size).toBe(
            MEMBERS.length,
        );
    });

    test("a personal condition goes only to the member it names", () => {
        const { insert } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [weighIn(MIA)],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert.map((r) => r.recipientUserId)).toEqual([MIA]);
        expect(insert[0]).toMatchObject({
            kind: "weigh_in_due",
            bucket: "personal",
        });
    });

    test("a personal condition naming someone outside the household inserts nothing", () => {
        const { insert } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [weighIn("00000000-0000-4000-8000-0000000000ff")],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert).toEqual([]);
    });

    test("notices that are not notifications insert nothing", () => {
        const { insert } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [
                notice("recipe.no_food", "r1", "recipe"),
                notice("grocery.restocked", "g1", "grocery_line"),
                notice("plan.missing_ingredient", "r1", "recipe"),
            ],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert).toEqual([]);
    });

    test("a second sync with the same notices inserts and resolves nothing", () => {
        const input = {
            householdId: HOUSEHOLD,
            notices: [expiring("f1"), weighIn(MIA)],
            members: MEMBERS,
            now: NOW,
            newId,
        };
        const first = syncConditions({ ...input, rows: [] });
        const second = syncConditions({ ...input, rows: first.insert });
        expect(second).toEqual({ insert: [], resolve: [], update: [] });
    });

    test("a condition that is gone resolves its open rows for everyone, and leaves event rows alone", () => {
        const key = dismissalKeyString(dismissalKey(expiring("f1")));
        const keep = openRow({
            noticeKey: "event:abc",
            source: "event",
            kind: "recipe_changes",
        });
        const rows = [
            openRow({ noticeKey: key, recipientUserId: OLIVE }),
            openRow({ noticeKey: key, recipientUserId: MIA }),
            keep,
        ];
        const { insert, resolve } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [],
            rows,
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert).toEqual([]);
        expect(resolve.sort()).toEqual([rows[0]!.id, rows[1]!.id].sort());
    });

    test("a resolved row is not reopened: a condition that comes back starts a fresh row", () => {
        const n = expiring("f1");
        const key = dismissalKeyString(dismissalKey(n));
        const resolved = openRow({
            noticeKey: key,
            recipientUserId: MIA,
            resolvedAt: "2026-11-19T00:00:00.000Z",
        });
        const { insert, resolve } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [n],
            rows: [resolved],
            members: [{ userId: MIA, role: "member" }],
            now: NOW,
            newId,
        });
        expect(resolve).toEqual([]);
        expect(insert).toHaveLength(1);
        expect(insert[0]!.id).not.toBe(resolved.id);
    });

    test("a member who joins later gets rows for the conditions already open", () => {
        const n = expiring("f1");
        const key = dismissalKeyString(dismissalKey(n));
        const rows = [
            openRow({ noticeKey: key, recipientUserId: OLIVE }),
            openRow({ noticeKey: key, recipientUserId: ADAM }),
        ];
        const { insert } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [n],
            rows,
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert.map((r) => r.recipientUserId)).toEqual([MIA]);
    });

    test("a new row under a notice_dismissals row starts undismissed, and the inbox hides it for everyone", async () => {
        const n = expiring("f1");
        const k = dismissalKey(n);
        const old: NoticeDismissal = {
            id: "d1",
            householdId: HOUSEHOLD,
            code: k.code,
            subjectKind: k.subjectKind,
            subjectId: k.subjectId,
            relatedKey: k.relatedKey,
            dismissedBy: ADAM,
            createdAt: "2026-11-01T10:00:00.000Z",
        };
        const { insert } = syncConditions({
            householdId: HOUSEHOLD,
            notices: [n, expiring("f2")],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect(insert).toHaveLength(6);
        for (const row of insert) {
            expect(row.dismissedAt).toBeNull();
            expect(row.dismissedBy).toBeNull();
        }
        for (const m of MEMBERS) {
            const out = inboxFor({
                rows: insert.filter((r) => r.recipientUserId === m.userId),
                prefs: [],
                now: NOW,
                timezone: "UTC",
                householdDismissals: [old],
            });
            expect(
                [...out.today, ...out.earlier].map((r) => r.subjectId),
            ).toEqual(["f2"]);
        }
    });

    test("a household dismissal with a non-ISO createdAt changes no stored timestamp", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const n = expiring("f1");
        const k = dismissalKey(n);
        const odd: NoticeDismissal = {
            id: "d1",
            householdId: HOUSEHOLD,
            ...k,
            dismissedBy: ADAM,
            createdAt: String(new Date("2026-11-01T10:00:00Z")),
        };
        await dismissals.insert({
            householdId: HOUSEHOLD,
            ...k,
            dismissedBy: ADAM,
        });
        const dismissalsWithOdd = {
            ...dismissals,
            listForHousehold: async () => [odd],
        };
        const deps = { store, dismissals: dismissalsWithOdd };
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [n],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.createdAt).toBe(NOW.toISOString());
            expect(row.dismissedAt).toBeNull();
            expect(row.readAt).toBeNull();
            expect(row.snoozedUntil).toBeNull();
            expect(row.resolvedAt).toBeNull();
        }
    });

    test("a household-dismissed condition stays open across syncs while it stays true", () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const n = expiring("f1");
        const k = dismissalKey(n);
        return (async () => {
            await dismissals.insert({
                householdId: HOUSEHOLD,
                code: k.code,
                subjectKind: k.subjectKind,
                subjectId: k.subjectId,
                relatedKey: k.relatedKey,
                dismissedBy: ADAM,
            });
            // The caller passes the household-dismissed notice too
            // (includeDismissed), so the condition is still seen as true.
            for (let i = 0; i < 4; i++) {
                await syncHouseholdConditions(
                    { store, dismissals },
                    {
                        householdId: HOUSEHOLD,
                        notices: [n],
                        members: MEMBERS,
                        now: new Date(NOW.getTime() + i * 60_000),
                        newId,
                    },
                );
            }
            const rows = await store.listForHousehold(HOUSEHOLD);
            expect(rows).toHaveLength(3);
            const household = await dismissals.listForHousehold(HOUSEHOLD);
            for (const row of rows) {
                expect(row.resolvedAt).toBeNull();
                expect(row.dismissedAt).toBeNull();
                const out = inboxFor({
                    rows: [row],
                    prefs: [],
                    now: NOW,
                    timezone: "UTC",
                    householdDismissals: household,
                });
                expect([...out.today, ...out.earlier]).toEqual([]);
            }
        })();
    });

    test("an open condition's payload follows the live notice's params, and only when they differ", () => {
        const first = syncConditions({
            householdId: HOUSEHOLD,
            notices: [
                notice("fridge.expiring", "f1", "fridge_item", {
                    daysLeft: 3,
                    names: ["a", "b"],
                }),
            ],
            rows: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        const same = syncConditions({
            householdId: HOUSEHOLD,
            // The same params with the keys in another order (what jsonb
            // hands back) are not a change.
            notices: [
                notice("fridge.expiring", "f1", "fridge_item", {
                    names: ["a", "b"],
                    daysLeft: 3,
                }),
            ],
            rows: first.insert,
            members: MEMBERS,
            now: NOW,
        });
        expect(same.update).toEqual([]);

        const changed = syncConditions({
            householdId: HOUSEHOLD,
            notices: [
                notice("fridge.expiring", "f1", "fridge_item", {
                    daysLeft: 1,
                    names: ["a", "b"],
                }),
            ],
            rows: first.insert,
            members: MEMBERS,
            now: NOW,
        });
        expect(changed.insert).toEqual([]);
        expect(changed.resolve).toEqual([]);
        expect(changed.update.map((u) => u.id).sort()).toEqual(
            first.insert.map((r) => r.id).sort(),
        );
        for (const u of changed.update) {
            expect(u.payload).toEqual({
                code: "fridge.expiring",
                params: { daysLeft: 1, names: ["a", "b"] },
                related: [],
            });
        }
    });

    test("an event row keeps its frozen payload through a sync", () => {
        const event = openRow({
            noticeKey: "event:e1",
            source: "event",
            kind: "recipe_changes",
            payload: { name: "Chili" },
        });
        const plan = syncConditions({
            householdId: HOUSEHOLD,
            notices: [],
            rows: [event],
            members: MEMBERS,
            now: NOW,
        });
        expect(plan).toEqual({ insert: [], resolve: [], update: [] });
    });

    test("syncHouseholdConditions writes a changed payload once and nothing on the next identical sync", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const base = { householdId: HOUSEHOLD, members: MEMBERS, newId };
        const at = (daysLeft: number) => [
            notice("fridge.expiring", "f1", "fridge_item", { daysLeft }),
        ];
        await syncHouseholdConditions(
            { store, dismissals },
            { ...base, notices: at(3), now: NOW },
        );
        const calls: string[] = [];
        const spy = new Proxy(store, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (
                    typeof value === "function" &&
                    ["insertMany", "update", "updatePayloads"].includes(
                        String(prop),
                    )
                ) {
                    return (...args: unknown[]) => {
                        calls.push(String(prop));
                        return value.apply(target, args);
                    };
                }
                return value;
            },
        });
        const deps = { store: spy, dismissals };
        await syncHouseholdConditions(deps, {
            ...base,
            notices: at(1),
            now: NOW,
        });
        expect(calls).toEqual(["updatePayloads"]);
        for (const row of await store.listForHousehold(HOUSEHOLD)) {
            expect(row.payload.params).toEqual({ daysLeft: 1 });
        }
        calls.length = 0;
        await syncHouseholdConditions(deps, {
            ...base,
            notices: at(1),
            now: NOW,
        });
        expect(calls).toEqual([]);
    });

    test("syncHouseholdConditions inserts then resolves through the store", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const base = { householdId: HOUSEHOLD, members: MEMBERS, newId };
        await syncHouseholdConditions(
            { store, dismissals },
            { ...base, notices: [expiring("f1")], now: NOW },
        );
        expect(await store.listForHousehold(HOUSEHOLD)).toHaveLength(3);
        const later = new Date(NOW.getTime() + 3_600_000);
        await syncHouseholdConditions(
            { store, dismissals },
            { ...base, notices: [], now: later },
        );
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.resolvedAt).toBe(later.toISOString());
        }
    });
});

describe("fanOutEvent", () => {
    const event = {
        kind: "recipe_changes" as const,
        subjectKind: "recipe",
        subjectId: "r1",
        payload: { name: "Beef chili", actorName: "Sarah" },
    };
    const on = (userId: string) => ({
        householdId: HOUSEHOLD,
        userId,
        kind: "recipe_changes" as const,
        enabled: true,
        updatedAt: NOW.toISOString(),
    });

    test("writes one household row per member, sharing an event:<uuid> key and the actor id", () => {
        const rows = fanOutEvent({
            householdId: HOUSEHOLD,
            event,
            actorUserId: OLIVE,
            members: MEMBERS,
            prefs: [on(ADAM), on(MIA)],
            now: NOW,
            newId,
        });
        expect(rows.map((r) => r.recipientUserId).sort()).toEqual(
            [ADAM, MIA].sort(),
        );
        const keys = new Set(rows.map((r) => r.noticeKey));
        expect(keys.size).toBe(1);
        expect([...keys][0]).toMatch(/^event:/);
        for (const row of rows) {
            expect(row).toMatchObject({
                kind: "recipe_changes",
                bucket: "household",
                source: "event",
                actorUserId: OLIVE,
                subjectKind: "recipe",
                subjectId: "r1",
                payload: { name: "Beef chili", actorName: "Sarah" },
                createdAt: NOW.toISOString(),
                readAt: null,
                dismissedAt: null,
                resolvedAt: null,
            });
        }
    });

    test("the actor is excluded, even with the kind on", () => {
        const rows = fanOutEvent({
            householdId: HOUSEHOLD,
            event,
            actorUserId: MIA,
            members: MEMBERS,
            prefs: [on(MIA), on(ADAM), on(OLIVE)],
            now: NOW,
            newId,
        });
        expect(rows.map((r) => r.recipientUserId)).not.toContain(MIA);
        expect(rows).toHaveLength(2);
    });

    test("a member with the kind off is excluded, and an event kind defaults to off", () => {
        const rows = fanOutEvent({
            householdId: HOUSEHOLD,
            event,
            actorUserId: OLIVE,
            members: MEMBERS,
            prefs: [on(ADAM), { ...on(MIA), enabled: false }],
            now: NOW,
            newId,
        });
        expect(rows.map((r) => r.recipientUserId)).toEqual([ADAM]);
        const none = fanOutEvent({
            householdId: HOUSEHOLD,
            event,
            actorUserId: OLIVE,
            members: MEMBERS,
            prefs: [],
            now: NOW,
            newId,
        });
        expect(none).toEqual([]);
    });

    test("a condition kind is not an event", () => {
        expect(() =>
            fanOutEvent({
                householdId: HOUSEHOLD,
                event: { ...event, kind: "food_expiring" },
                actorUserId: null,
                members: MEMBERS,
                prefs: [],
                now: NOW,
                newId,
            }),
        ).toThrow();
    });
});

describe("kindEnabled and setPref", () => {
    const pref = (
        kind: "food_expiring" | "recipe_changes",
        enabled: boolean,
    ) => ({
        householdId: HOUSEHOLD,
        userId: MIA,
        kind,
        enabled,
        updatedAt: NOW.toISOString(),
    });

    test("kindEnabled is the registry default unless the person has a row", () => {
        expect(kindEnabled([], "food_expiring")).toBe(true);
        expect(kindEnabled([], "recipe_changes")).toBe(false);
        expect(
            kindEnabled([pref("food_expiring", false)], "food_expiring"),
        ).toBe(false);
        expect(
            kindEnabled([pref("recipe_changes", true)], "recipe_changes"),
        ).toBe(true);
    });

    test("Allergens is always on, whatever a stored row says", () => {
        expect(
            kindEnabled(
                [{ ...pref("food_expiring", false), kind: "allergens" }],
                "allergens",
            ),
        ).toBe(true);
    });

    test("setPref refuses to turn Allergens off", async () => {
        const store = createMemoryNotificationsStore();
        await expect(
            setPref(
                { store },
                {
                    householdId: HOUSEHOLD,
                    actor: { userId: MIA, role: "member" },
                    userId: MIA,
                    kind: "allergens",
                    enabled: false,
                    now: NOW,
                },
            ),
        ).rejects.toBeInstanceOf(NotificationActionError);
        expect(await store.listPrefs(HOUSEHOLD, MIA)).toEqual([]);
    });

    test("setPref writes a row only when the choice differs from the default, and removes it on return", async () => {
        const store = createMemoryNotificationsStore();
        const base = {
            householdId: HOUSEHOLD,
            actor: { userId: MIA, role: "member" as const },
            userId: MIA,
            now: NOW,
        };
        await setPref(
            { store },
            { ...base, kind: "food_expiring", enabled: true },
        );
        expect(await store.listPrefs(HOUSEHOLD, MIA)).toEqual([]);
        await setPref(
            { store },
            { ...base, kind: "food_expiring", enabled: false },
        );
        expect(await store.listPrefs(HOUSEHOLD, MIA)).toHaveLength(1);
        await setPref(
            { store },
            { ...base, kind: "food_expiring", enabled: true },
        );
        expect(await store.listPrefs(HOUSEHOLD, MIA)).toEqual([]);
    });

    test("setPref refuses a kind that is not in the registry, including inherited names", async () => {
        const store = createMemoryNotificationsStore();
        for (const kind of ["__proto__", "toString", "nope", "constructor"]) {
            await expect(
                setPref(
                    { store },
                    {
                        householdId: HOUSEHOLD,
                        actor: { userId: MIA, role: "member" },
                        userId: MIA,
                        kind: kind as NotificationKind,
                        enabled: false,
                        now: NOW,
                    },
                ),
            ).rejects.toMatchObject({ code: "invalid" });
        }
        expect(await store.listPrefs(HOUSEHOLD, MIA)).toEqual([]);
    });

    test("setPref refuses an enabled value that is not a boolean", async () => {
        const store = createMemoryNotificationsStore();
        for (const enabled of ["false", "no", 0, null]) {
            await expect(
                setPref(
                    { store },
                    {
                        householdId: HOUSEHOLD,
                        actor: { userId: MIA, role: "member" },
                        userId: MIA,
                        kind: "food_expiring",
                        enabled: enabled as unknown as boolean,
                        now: NOW,
                    },
                ),
            ).rejects.toMatchObject({ code: "invalid" });
        }
        expect(await store.listPrefs(HOUSEHOLD, MIA)).toEqual([]);
    });

    test("setPref refuses to change someone else's preference", async () => {
        const store = createMemoryNotificationsStore();
        await expect(
            setPref(
                { store },
                {
                    householdId: HOUSEHOLD,
                    actor: { userId: OLIVE, role: "owner" },
                    userId: MIA,
                    kind: "food_expiring",
                    enabled: false,
                    now: NOW,
                },
            ),
        ).rejects.toMatchObject({ code: "forbidden" });
    });
});

describe("inboxFor", () => {
    const TZ = "UTC";
    const mine = (over: Partial<NotificationRow> & { noticeKey: string }) =>
        openRow({ recipientUserId: MIA, ...over });
    const view = (
        rows: NotificationRow[],
        extra: Partial<Parameters<typeof inboxFor>[0]> = {},
    ) =>
        inboxFor({
            rows,
            prefs: [],
            now: NOW,
            timezone: TZ,
            householdDismissals: [],
            ...extra,
        });

    test("splits today from earlier, newest first, and counts unread", () => {
        const a = mine({
            noticeKey: "a",
            createdAt: "2026-11-21T09:00:00.000Z",
        });
        const b = mine({
            noticeKey: "b",
            createdAt: "2026-11-21T10:00:00.000Z",
        });
        const c = mine({
            noticeKey: "c",
            createdAt: "2026-11-20T10:00:00.000Z",
            readAt: "2026-11-20T11:00:00.000Z",
        });
        const out = view([a, c, b]);
        expect(out.today.map((r) => r.noticeKey)).toEqual(["b", "a"]);
        expect(out.earlier.map((r) => r.noticeKey)).toEqual(["c"]);
        expect(out.snoozed).toEqual([]);
        expect(out.unread).toBe(2);
    });

    test("today is the local day in the given timezone", () => {
        const row = mine({
            noticeKey: "a",
            createdAt: "2026-11-21T03:00:00.000Z",
        });
        expect(view([row], { timezone: "UTC" }).today).toHaveLength(1);
        // 03:00Z is still the 20th in Los Angeles; now (12:00Z) is the 21st.
        const la = view([row], { timezone: "America/Los_Angeles" });
        expect(la.today).toEqual([]);
        expect(la.earlier).toHaveLength(1);
    });

    test("a snoozed row waits in snoozed and is not unread; once its time passes it is back", () => {
        const row = mine({
            noticeKey: "a",
            snoozedUntil: "2026-11-21T18:00:00.000Z",
        });
        const during = view([row]);
        expect(during.snoozed.map((r) => r.id)).toEqual([row.id]);
        expect(during.today).toEqual([]);
        expect(during.earlier).toEqual([]);
        expect(during.unread).toBe(0);

        const after = view([row], {
            now: new Date("2026-11-21T18:00:00.000Z"),
        });
        expect(after.snoozed).toEqual([]);
        expect(after.earlier).toHaveLength(1);
        expect(after.unread).toBe(1);
    });

    test("dismissed, resolved and kind-off rows are not shown", () => {
        const rows = [
            mine({ noticeKey: "dismissed", dismissedAt: NOW.toISOString() }),
            mine({ noticeKey: "resolved", resolvedAt: NOW.toISOString() }),
            mine({ noticeKey: "off", kind: "running_low" }),
            mine({ noticeKey: "shown" }),
        ];
        const out = view(rows, {
            prefs: [
                {
                    householdId: HOUSEHOLD,
                    userId: MIA,
                    kind: "running_low",
                    enabled: false,
                    updatedAt: NOW.toISOString(),
                },
            ],
        });
        expect([...out.today, ...out.earlier].map((r) => r.noticeKey)).toEqual([
            "shown",
        ]);
        expect(out.unread).toBe(1);
    });

    test("an Allergens row is shown even if a preference row says off", () => {
        const row = mine({ noticeKey: "a", kind: "allergens" });
        const out = view([row], {
            prefs: [
                {
                    householdId: HOUSEHOLD,
                    userId: MIA,
                    kind: "allergens",
                    enabled: false,
                    updatedAt: NOW.toISOString(),
                },
            ],
        });
        expect(out.earlier).toHaveLength(1);
    });

    test("bucket filters personal from household", () => {
        const rows = [
            mine({ noticeKey: "h" }),
            mine({ noticeKey: "p", kind: "weigh_in_due", bucket: "personal" }),
        ];
        expect(
            view(rows, { bucket: "personal" }).earlier.map((r) => r.noticeKey),
        ).toEqual(["p"]);
        expect(
            view(rows, { bucket: "household" }).earlier.map((r) => r.noticeKey),
        ).toEqual(["h"]);
        expect(view(rows, { bucket: "all" }).earlier).toHaveLength(2);
        expect(view(rows).earlier).toHaveLength(2);
    });

    test("a condition dismissed household-wide is hidden even before its row says so", () => {
        const n = expiring("f1");
        const k = dismissalKey(n);
        const row = mine({ noticeKey: dismissalKeyString(k) });
        const other = mine({
            noticeKey: dismissalKeyString(dismissalKey(expiring("f2"))),
        });
        const out = view([row, other], {
            householdDismissals: [
                {
                    id: "d1",
                    householdId: HOUSEHOLD,
                    code: k.code,
                    subjectKind: k.subjectKind,
                    subjectId: k.subjectId,
                    relatedKey: k.relatedKey,
                    dismissedBy: ADAM,
                    createdAt: NOW.toISOString(),
                },
            ],
        });
        expect(out.earlier.map((r) => r.id)).toEqual([other.id]);
    });

    test("a personal row honours a household dismissal only when its own person made it", () => {
        const n = weighIn(MIA);
        const k = dismissalKey(n);
        const row = mine({
            noticeKey: dismissalKeyString(k),
            kind: "weigh_in_due",
            bucket: "personal",
        });
        const dismissal = (by: string): NoticeDismissal => ({
            id: "d1",
            householdId: HOUSEHOLD,
            ...k,
            dismissedBy: by,
            createdAt: NOW.toISOString(),
        });
        expect(
            view([row], { householdDismissals: [dismissal(ADAM)] }).earlier,
        ).toHaveLength(1);
        expect(
            view([row], { householdDismissals: [dismissal(MIA)] }).earlier,
        ).toHaveLength(0);
    });

    test("an Allergens row ignores a household dismissal", () => {
        const n = allergen("g1");
        const k = dismissalKey(n);
        const row = mine({
            noticeKey: dismissalKeyString(k),
            kind: "allergens",
        });
        const out = view([row], {
            householdDismissals: [
                {
                    id: "d1",
                    householdId: HOUSEHOLD,
                    code: k.code,
                    subjectKind: k.subjectKind,
                    subjectId: k.subjectId,
                    relatedKey: k.relatedKey,
                    dismissedBy: ADAM,
                    createdAt: NOW.toISOString(),
                },
            ],
        });
        expect(out.earlier).toHaveLength(1);
    });
});

describe("dismiss and snooze", () => {
    const ACTORS = {
        member: { userId: MIA, role: "member" as const },
        admin: { userId: ADAM, role: "admin" as const },
        owner: { userId: OLIVE, role: "owner" as const },
    };

    async function seeded(n: Notice) {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        await syncHouseholdConditions(
            { store, dismissals },
            {
                householdId: HOUSEHOLD,
                notices: [n],
                members: MEMBERS,
                now: NOW,
                newId,
            },
        );
        const rows = await store.listForHousehold(HOUSEHOLD);
        const rowOf = (userId: string) =>
            rows.find((r) => r.recipientUserId === userId)!;
        return { store, dismissals, deps: { store, dismissals }, rowOf };
    }

    async function eventRows() {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const rows = fanOutEvent({
            householdId: HOUSEHOLD,
            event: { kind: "recipe_changes", payload: { name: "Chili" } },
            actorUserId: null,
            members: MEMBERS,
            prefs: MEMBERS.map((m) => ({
                householdId: HOUSEHOLD,
                userId: m.userId,
                kind: "recipe_changes" as const,
                enabled: true,
                updatedAt: NOW.toISOString(),
            })),
            now: NOW,
            newId,
        });
        await store.insertMany(rows);
        return { store, dismissals, deps: { store, dismissals }, rows };
    }

    for (const role of ["member", "admin", "owner"] as const) {
        test(`${role}: dismiss for me works on a household and a personal row, touching only their row`, async () => {
            const actor = ACTORS[role];
            const house = await seeded(expiring("f1"));
            const hit = await dismiss(house.deps, {
                householdId: HOUSEHOLD,
                actor,
                id: house.rowOf(actor.userId).id,
                scope: "me",
                now: NOW,
            });
            expect(hit.map((r) => r.recipientUserId)).toEqual([actor.userId]);
            const after = await house.store.listForHousehold(HOUSEHOLD);
            expect(after.filter((r) => r.dismissedAt !== null)).toHaveLength(1);
            expect(await house.dismissals.listForHousehold(HOUSEHOLD)).toEqual(
                [],
            );

            const personal = await seeded(weighIn(actor.userId));
            const own = await dismiss(personal.deps, {
                householdId: HOUSEHOLD,
                actor,
                id: personal.rowOf(actor.userId).id,
                scope: "me",
                now: NOW,
            });
            expect(own[0]!.dismissedBy).toBe(actor.userId);
        });
    }

    test("a personal row can be dismissed or snoozed only by its person, whatever the role", async () => {
        const { deps, rowOf } = await seeded(weighIn(MIA));
        for (const actor of [ACTORS.owner, ACTORS.admin]) {
            for (const scope of ["me", "everyone"] as const) {
                await expect(
                    dismiss(deps, {
                        householdId: HOUSEHOLD,
                        actor,
                        id: rowOf(MIA).id,
                        scope,
                        now: NOW,
                    }),
                ).rejects.toMatchObject({ code: "forbidden" });
            }
            await expect(
                snooze(deps, {
                    householdId: HOUSEHOLD,
                    actor,
                    id: rowOf(MIA).id,
                    until: new Date("2026-11-22T09:00:00Z"),
                    now: NOW,
                }),
            ).rejects.toMatchObject({ code: "forbidden" });
        }
        expect(
            (await deps.store.get(HOUSEHOLD, rowOf(MIA).id))!.dismissedAt,
        ).toBeNull();
    });

    test("a member's dismiss for everyone is refused with can()'s reason, and nothing changes", async () => {
        const { deps, store, dismissals, rowOf } = await seeded(expiring("f1"));
        const error = await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            scope: "everyone",
            now: NOW,
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotificationActionError);
        expect((error as NotificationActionError).reason).toBe(
            "Only the household owner or an admin can do that.",
        );
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows.every((r) => r.dismissedAt === null)).toBe(true);
        expect(await dismissals.listForHousehold(HOUSEHOLD)).toEqual([]);
    });

    for (const role of ["admin", "owner"] as const) {
        test(`${role}: dismiss for everyone of a condition writes notice_dismissals only and every inbox hides it`, async () => {
            const actor = ACTORS[role];
            const { deps, store, dismissals, rowOf } = await seeded(
                expiring("f1"),
            );
            const hit = await dismiss(deps, {
                householdId: HOUSEHOLD,
                actor,
                id: rowOf(actor.userId).id,
                scope: "everyone",
                now: NOW,
            });
            expect(hit).toEqual([]);
            const rows = await store.listForHousehold(HOUSEHOLD);
            for (const row of rows) {
                expect(row.dismissedAt).toBeNull();
                expect(row.dismissedBy).toBeNull();
                // Still open: the condition is true, so the sync keeps it.
                expect(row.resolvedAt).toBeNull();
            }
            const stored = await dismissals.listForHousehold(HOUSEHOLD);
            expect(stored).toHaveLength(1);
            expect(stored[0]).toMatchObject({
                code: "fridge.expiring",
                subjectKind: "fridge_item",
                subjectId: "f1",
                relatedKey: "",
                dismissedBy: actor.userId,
            });
            const shown = (all: NotificationRow[], d: NoticeDismissal[]) => {
                const out = inboxFor({
                    rows: all,
                    prefs: [],
                    now: NOW,
                    timezone: "UTC",
                    householdDismissals: d,
                });
                return [...out.today, ...out.earlier];
            };
            for (const m of MEMBERS) {
                expect(
                    shown(
                        rows.filter((r) => r.recipientUserId === m.userId),
                        stored,
                    ),
                ).toEqual([]);
            }
            // A member who joins later gets an undismissed row the inbox hides.
            const late = "00000000-0000-4000-8000-0000000000aa";
            await syncHouseholdConditions(deps, {
                householdId: HOUSEHOLD,
                notices: [expiring("f1")],
                members: [...MEMBERS, { userId: late, role: "member" }],
                now: NOW,
                newId,
            });
            const lateRow = (await store.listForRecipient(HOUSEHOLD, late))[0]!;
            expect(lateRow.dismissedAt).toBeNull();
            expect(shown([lateRow], stored)).toEqual([]);
        });
    }

    test("Undo: deleting the notice_dismissals row after a dismiss for everyone shows the condition in every inbox again", async () => {
        const { deps, store, dismissals, rowOf } = await seeded(expiring("f1"));
        await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            scope: "everyone",
            now: NOW,
        });
        const [saved] = await dismissals.listForHousehold(HOUSEHOLD);
        await dismissals.delete(HOUSEHOLD, {
            code: saved!.code,
            subjectKind: saved!.subjectKind,
            subjectId: saved!.subjectId,
            relatedKey: saved!.relatedKey,
        });
        const left = await dismissals.listForHousehold(HOUSEHOLD);
        expect(left).toEqual([]);
        for (const m of MEMBERS) {
            const out = inboxFor({
                rows: await store.listForRecipient(HOUSEHOLD, m.userId),
                prefs: [],
                now: NOW,
                timezone: "UTC",
                householdDismissals: left,
            });
            expect(
                [...out.today, ...out.earlier].map((r) => r.subjectId),
            ).toEqual(["f1"]);
        }
    });

    test("dismiss for everyone on an event row dismisses every open row of that event and writes no notice_dismissals", async () => {
        const { deps, store, dismissals, rows } = await eventRows();
        const mine = rows.find((r) => r.recipientUserId === ADAM)!;
        await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: mine.id,
            scope: "everyone",
            now: NOW,
        });
        const after = await store.listForHousehold(HOUSEHOLD);
        expect(after.every((r) => r.dismissedAt !== null)).toBe(true);
        expect(await dismissals.listForHousehold(HOUSEHOLD)).toEqual([]);
    });

    test("an admin's dismiss for me leaves everyone else's row open", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            scope: "me",
            now: NOW,
        });
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows.filter((r) => r.dismissedAt === null)).toHaveLength(2);
    });

    test("dismiss and snooze refuse an Allergens row, whoever asks", async () => {
        const { deps, store, rowOf } = await seeded(allergen("g1"));
        for (const actor of [ACTORS.member, ACTORS.owner]) {
            for (const scope of ["me", "everyone"] as const) {
                await expect(
                    dismiss(deps, {
                        householdId: HOUSEHOLD,
                        actor,
                        id: rowOf(actor.userId).id,
                        scope,
                        now: NOW,
                    }),
                ).rejects.toMatchObject({ code: "locked" });
            }
            await expect(
                snooze(deps, {
                    householdId: HOUSEHOLD,
                    actor,
                    id: rowOf(actor.userId).id,
                    until: new Date("2026-11-22T09:00:00Z"),
                    now: NOW,
                }),
            ).rejects.toMatchObject({ code: "locked" });
        }
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows).toHaveLength(3);
        expect(
            rows.every(
                (r) => r.dismissedAt === null && r.snoozedUntil === null,
            ),
        ).toBe(true);
    });

    test("dismiss for everyone on a code that is not dismissible hides every inbox row but writes no notice_dismissals", async () => {
        const { deps, store, dismissals, rowOf } = await seeded(
            notice("fridge.expired", "f1"),
        );
        expect(noticeCodeDismissible("fridge.expired")).toBe(false);
        const hit = await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            scope: "everyone",
            now: NOW,
        });
        expect(hit).toHaveLength(3);
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows.every((r) => r.dismissedAt !== null)).toBe(true);
        expect(await dismissals.listForHousehold(HOUSEHOLD)).toEqual([]);
    });

    test("dismissing an already-dismissed own row changes nothing and keeps the first time", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const first = new Date("2026-11-21T10:00:00.000Z");
        await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            scope: "me",
            now: first,
        });
        const again = await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            scope: "me",
            now: NOW,
        });
        expect(again).toEqual([]);
        const row = (await store.get(HOUSEHOLD, rowOf(MIA).id))!;
        expect(row.dismissedAt).toBe(first.toISOString());
        expect(row.dismissedBy).toBe(MIA);
    });

    test("dismiss for everyone does not overwrite a member's earlier dismissal", async () => {
        const { deps, store, rowOf } = await seeded(
            notice("fridge.expired", "f1"),
        );
        const first = new Date("2026-11-21T10:00:00.000Z");
        await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            scope: "me",
            now: first,
        });
        const hit = await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.owner,
            id: rowOf(OLIVE).id,
            scope: "everyone",
            now: NOW,
        });
        expect(hit.map((r) => r.recipientUserId).sort()).toEqual(
            [OLIVE, ADAM].sort(),
        );
        const mia = (await store.get(HOUSEHOLD, rowOf(MIA).id))!;
        expect(mia.dismissedAt).toBe(first.toISOString());
        expect(mia.dismissedBy).toBe(MIA);
        const adam = (await store.get(HOUSEHOLD, rowOf(ADAM).id))!;
        expect(adam.dismissedAt).toBe(NOW.toISOString());
        expect(adam.dismissedBy).toBe(OLIVE);
    });

    test("a dismissed row that is already resolved is not found", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        await store.update(HOUSEHOLD, [rowOf(MIA).id], {
            resolvedAt: NOW.toISOString(),
        });
        await expect(
            dismiss(deps, {
                householdId: HOUSEHOLD,
                actor: ACTORS.member,
                id: rowOf(MIA).id,
                scope: "me",
                now: NOW,
            }),
        ).rejects.toMatchObject({ code: "not_found" });
        await expect(
            dismiss(deps, {
                householdId: HOUSEHOLD,
                actor: ACTORS.member,
                id: "missing",
                scope: "me",
                now: NOW,
            }),
        ).rejects.toMatchObject({ code: "not_found" });
    });

    test("a member's snooze is theirs alone, even on a household row", async () => {
        const until = new Date("2026-11-22T14:00:00.000Z");
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const mine = await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            until,
            now: NOW,
        });
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({
            recipientUserId: MIA,
            snoozedUntil: until.toISOString(),
            snoozedBy: MIA,
        });
        const rows = await store.listForHousehold(HOUSEHOLD);
        expect(rows.filter((r) => r.snoozedUntil !== null)).toHaveLength(1);
    });

    for (const role of ["admin", "owner"] as const) {
        test(`${role}: a snooze on a household row reaches everyone's row`, async () => {
            const actor = ACTORS[role];
            const until = new Date("2026-11-22T14:00:00.000Z");
            const { deps, store, rowOf } = await seeded(expiring("f1"));
            const hit = await snooze(deps, {
                householdId: HOUSEHOLD,
                actor,
                id: rowOf(actor.userId).id,
                until,
                now: NOW,
            });
            expect(hit).toHaveLength(3);
            const rows = await store.listForHousehold(HOUSEHOLD);
            for (const row of rows) {
                expect(row.snoozedUntil).toBe(until.toISOString());
                expect(row.snoozedBy).toBe(actor.userId);
            }
        });

        test(`${role}: a snooze on their own personal row stays theirs`, async () => {
            const actor = ACTORS[role];
            const until = new Date("2026-11-22T14:00:00.000Z");
            const { deps, store, rowOf } = await seeded(weighIn(actor.userId));
            const hit = await snooze(deps, {
                householdId: HOUSEHOLD,
                actor,
                id: rowOf(actor.userId).id,
                until,
                now: NOW,
            });
            expect(hit.map((r) => r.recipientUserId)).toEqual([actor.userId]);
            expect(
                (await store.listForHousehold(HOUSEHOLD)).filter(
                    (r) => r.snoozedUntil !== null,
                ),
            ).toHaveLength(1);
        });
    }

    test("a snooze for everyone cannot shorten the recipient's own later snooze; the others take the new time", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const later = new Date("2026-12-05T09:00:00.000Z");
        const sooner = new Date("2026-11-22T14:00:00.000Z");
        // The owner snoozes for everyone to a late date: all three rows.
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.owner,
            id: rowOf(OLIVE).id,
            until: later,
            now: NOW,
        });
        const hit = await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            until: sooner,
            now: NOW,
        });
        const rows = await store.listForHousehold(HOUSEHOLD);
        const at = (userId: string) =>
            rows.find((r) => r.recipientUserId === userId)!;
        // Olive set her own row's snooze, so it is hers to keep.
        expect(at(OLIVE)).toMatchObject({
            snoozedUntil: later.toISOString(),
            snoozedBy: OLIVE,
        });
        expect(at(MIA).snoozedUntil).toBe(sooner.toISOString());
        expect(at(ADAM)).toMatchObject({
            snoozedUntil: sooner.toISOString(),
            snoozedBy: ADAM,
        });
        expect(hit.map((r) => r.recipientUserId).sort()).toEqual(
            [ADAM, MIA].sort(),
        );
    });

    test("an admin can shorten their own earlier snooze for everyone", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const week = new Date("2026-11-28T12:00:00.000Z");
        const tomorrow = new Date("2026-11-22T09:00:00.000Z");
        const own = new Date("2026-12-10T09:00:00.000Z");
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            until: own,
            now: NOW,
        });
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            until: week,
            now: NOW,
        });
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            until: tomorrow,
            now: NOW,
        });
        const rows = await store.listForHousehold(HOUSEHOLD);
        const at = (userId: string) =>
            rows.find((r) => r.recipientUserId === userId)!;
        // Mia's own later snooze was never replaced by the week-long one.
        expect(at(MIA).snoozedUntil).toBe(own.toISOString());
        expect(at(ADAM).snoozedUntil).toBe(tomorrow.toISOString());
        expect(at(OLIVE).snoozedUntil).toBe(tomorrow.toISOString());
    });

    test("an admin's week-long snooze for everyone, then tomorrow, leaves every row on tomorrow", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const week = new Date("2026-11-28T12:00:00.000Z");
        const tomorrow = new Date("2026-11-22T09:00:00.000Z");
        for (const until of [week, tomorrow]) {
            await snooze(deps, {
                householdId: HOUSEHOLD,
                actor: ACTORS.admin,
                id: rowOf(ADAM).id,
                until,
                now: NOW,
            });
        }
        for (const row of await store.listForHousehold(HOUSEHOLD)) {
            expect(row.snoozedUntil).toBe(tomorrow.toISOString());
        }
    });

    test("snooze refuses an invalid Date with an action error, not a RangeError", async () => {
        const { deps, rowOf } = await seeded(expiring("f1"));
        const error = await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            until: new Date("nope"),
            now: NOW,
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotificationActionError);
        expect(error).toMatchObject({ code: "invalid" });
    });

    test("snooze refuses an end more than a year away, however it is given", async () => {
        const { deps, rowOf } = await seeded(expiring("f1"));
        const yearAndADay = new Date(NOW.getTime() + 367 * 86_400_000);
        for (const until of [yearAndADay, new Date(8.64e15)]) {
            await expect(
                snooze(deps, {
                    householdId: HOUSEHOLD,
                    actor: ACTORS.member,
                    id: rowOf(MIA).id,
                    until,
                    now: NOW,
                }),
            ).rejects.toMatchObject({ code: "invalid" });
        }
        expect(rowOf(MIA).snoozedUntil).toBeNull();
    });

    test("a snooze for everyone leaves a member's own later snooze alone", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const later = new Date("2026-11-30T09:00:00.000Z");
        const sooner = new Date("2026-11-22T14:00:00.000Z");
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            until: later,
            now: NOW,
        });
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.admin,
            id: rowOf(ADAM).id,
            until: sooner,
            now: NOW,
        });
        const rows = await store.listForHousehold(HOUSEHOLD);
        const at = (userId: string) =>
            rows.find((r) => r.recipientUserId === userId)!;
        expect(at(MIA)).toMatchObject({
            snoozedUntil: later.toISOString(),
            snoozedBy: MIA,
        });
        expect(at(ADAM).snoozedUntil).toBe(sooner.toISOString());
        expect(at(OLIVE).snoozedUntil).toBe(sooner.toISOString());
    });

    test("a snooze for everyone does replace an earlier, shorter snooze", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            until: new Date("2026-11-22T10:00:00.000Z"),
            now: NOW,
        });
        const until = new Date("2026-11-25T10:00:00.000Z");
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.owner,
            id: rowOf(OLIVE).id,
            until,
            now: NOW,
        });
        for (const row of await store.listForHousehold(HOUSEHOLD)) {
            expect(row.snoozedUntil).toBe(until.toISOString());
        }
    });

    test("dismiss refuses a scope that is neither me nor everyone", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        for (const scope of ["all", "", undefined, "ME"]) {
            await expect(
                dismiss(deps, {
                    householdId: HOUSEHOLD,
                    actor: ACTORS.owner,
                    id: rowOf(OLIVE).id,
                    scope: scope as unknown as "me",
                    now: NOW,
                }),
            ).rejects.toMatchObject({ code: "invalid" });
        }
        expect(
            (await store.listForHousehold(HOUSEHOLD)).every(
                (r) => r.dismissedAt === null,
            ),
        ).toBe(true);
    });

    test("snooze return: the row is out of the inbox until its time, then back", async () => {
        const { deps, store, rowOf } = await seeded(expiring("f1"));
        const until = new Date("2026-11-22T14:00:00.000Z");
        await snooze(deps, {
            householdId: HOUSEHOLD,
            actor: ACTORS.member,
            id: rowOf(MIA).id,
            until,
            now: NOW,
        });
        const rows = await store.listForRecipient(HOUSEHOLD, MIA);
        const during = inboxFor({
            rows,
            prefs: [],
            now: NOW,
            timezone: "UTC",
            householdDismissals: [],
        });
        expect(during.snoozed).toHaveLength(1);
        expect(during.unread).toBe(0);
        const after = inboxFor({
            rows,
            prefs: [],
            now: new Date(until.getTime() + 1000),
            timezone: "UTC",
            householdDismissals: [],
        });
        expect(after.snoozed).toEqual([]);
        expect(after.today.length + after.earlier.length).toBe(1);
        expect(after.unread).toBe(1);
    });

    test("a snooze must end in the future", async () => {
        const { deps, rowOf } = await seeded(expiring("f1"));
        await expect(
            snooze(deps, {
                householdId: HOUSEHOLD,
                actor: ACTORS.member,
                id: rowOf(MIA).id,
                until: new Date(NOW.getTime() - 1),
                now: NOW,
            }),
        ).rejects.toMatchObject({ code: "invalid" });
    });
});

describe("resolveSnoozeUntil", () => {
    test("tomorrow is 9:00 local in the household zone", () => {
        // 07:00 on the 21st in New York (UTC-5): tomorrow 09:00 EST = 14:00Z.
        expect(
            resolveSnoozeUntil(
                "tomorrow",
                NOW,
                "America/New_York",
            ).toISOString(),
        ).toBe("2026-11-22T14:00:00.000Z");
        expect(resolveSnoozeUntil("tomorrow", NOW, "UTC").toISOString()).toBe(
            "2026-11-22T09:00:00.000Z",
        );
    });

    test("a choice that is not tomorrow, week or { at: string } is invalid", () => {
        for (const choice of [
            "next-month",
            "",
            undefined,
            null,
            42,
            {},
            { at: 5 },
            ["tomorrow"],
        ]) {
            expect(() =>
                resolveSnoozeUntil(choice as unknown as "tomorrow", NOW, "UTC"),
            ).toThrow(NotificationActionError);
        }
    });

    test("an exact time more than a year away is invalid, one inside the year is fine", () => {
        expect(() =>
            resolveSnoozeUntil({ at: "2027-11-21T12:00:01Z" }, NOW, "UTC"),
        ).toThrow(NotificationActionError);
        expect(
            resolveSnoozeUntil(
                { at: "2027-11-21T12:00:00Z" },
                NOW,
                "UTC",
            ).toISOString(),
        ).toBe("2027-11-21T12:00:00.000Z");
    });

    test("week is seven days on, and an exact time must be a future instant", () => {
        expect(resolveSnoozeUntil("week", NOW, "UTC").toISOString()).toBe(
            "2026-11-28T12:00:00.000Z",
        );
        expect(
            resolveSnoozeUntil(
                { at: "2026-12-01T08:30:00.000Z" },
                NOW,
                "UTC",
            ).toISOString(),
        ).toBe("2026-12-01T08:30:00.000Z");
        expect(() =>
            resolveSnoozeUntil({ at: "2026-11-20T00:00:00.000Z" }, NOW, "UTC"),
        ).toThrow(NotificationActionError);
        expect(() => resolveSnoozeUntil({ at: "soon" }, NOW, "UTC")).toThrow(
            NotificationActionError,
        );
    });
});

describe("resolveSnoozeUntil at", () => {
    const iso = (at: string, tz: string, now: Date = NOW) =>
        resolveSnoozeUntil({ at }, now, tz).toISOString();

    test("an offset-less local time is read in the household zone, not the server's", () => {
        expect(iso("2026-12-01T08:30", "America/New_York")).toBe(
            "2026-12-01T13:30:00.000Z",
        );
        expect(iso("2026-12-01T08:30:15", "Europe/Kyiv")).toBe(
            "2026-12-01T06:30:15.000Z",
        );
    });

    test("a daylight-saving day resolves with the offset in force at that wall time", () => {
        const before = new Date("2026-10-20T12:00:00.000Z");
        // New York leaves daylight time on 2026-11-01: 09:00 the day before
        // is UTC-4, 09:00 that day is UTC-5.
        expect(iso("2026-10-31T09:00", "America/New_York", before)).toBe(
            "2026-10-31T13:00:00.000Z",
        );
        expect(iso("2026-11-01T09:00", "America/New_York", before)).toBe(
            "2026-11-01T14:00:00.000Z",
        );
        // Kyiv leaves daylight time on 2026-10-25: UTC+3 before, UTC+2 on.
        expect(iso("2026-10-24T12:00", "Europe/Kyiv", before)).toBe(
            "2026-10-24T09:00:00.000Z",
        );
        expect(iso("2026-10-25T12:00", "Europe/Kyiv", before)).toBe(
            "2026-10-25T10:00:00.000Z",
        );
    });

    test("a full ISO timestamp with an offset is the instant it names, whatever the zone", () => {
        expect(iso("2026-12-01T08:30:00+02:00", "America/New_York")).toBe(
            "2026-12-01T06:30:00.000Z",
        );
        expect(iso("2026-12-01T08:30:00.000Z", "Europe/Kyiv")).toBe(
            "2026-12-01T08:30:00.000Z",
        );
    });

    test("a date alone, a bare year, a non-date and a date that does not exist are all invalid", () => {
        for (const at of [
            "2026-12-01",
            "2027",
            "soon",
            "",
            "2026-12-01 08:30",
            "2026-02-30T08:30",
            "2026-12-01T25:00",
        ]) {
            expect(() =>
                resolveSnoozeUntil({ at }, NOW, "America/New_York"),
            ).toThrow(NotificationActionError);
            try {
                resolveSnoozeUntil({ at }, NOW, "America/New_York");
            } catch (e) {
                expect((e as NotificationActionError).code).toBe("invalid");
            }
        }
    });

    test("a local time already past in the household zone is refused", () => {
        // 2026-11-21T12:00Z is 07:00 in New York.
        expect(() =>
            resolveSnoozeUntil(
                { at: "2026-11-21T06:00" },
                NOW,
                "America/New_York",
            ),
        ).toThrow(NotificationActionError);
        expect(iso("2026-11-21T08:00", "America/New_York")).toBe(
            "2026-11-21T13:00:00.000Z",
        );
    });
});

describe("markRead", () => {
    test("marks the person's own unread rows read, by id or all, and refuses someone else's", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const deps = { store, dismissals };
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [expiring("f1"), expiring("f2")],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        const miaRows = await store.listForRecipient(HOUSEHOLD, MIA);
        const member = { userId: MIA, role: "member" as const };
        const one = await markRead(deps, {
            householdId: HOUSEHOLD,
            actor: member,
            ids: [miaRows[0]!.id],
            now: NOW,
        });
        expect(one).toHaveLength(1);
        expect(one[0]!.readAt).toBe(NOW.toISOString());

        const olive = (await store.listForRecipient(HOUSEHOLD, OLIVE))[0]!;
        await expect(
            markRead(deps, {
                householdId: HOUSEHOLD,
                actor: member,
                ids: [olive.id],
                now: NOW,
            }),
        ).rejects.toMatchObject({ code: "forbidden" });
        expect((await store.get(HOUSEHOLD, olive.id))!.readAt).toBeNull();

        const later = new Date(NOW.getTime() + 60_000);
        const rest = await markRead(deps, {
            householdId: HOUSEHOLD,
            actor: member,
            ids: "all",
            now: later,
        });
        expect(rest).toHaveLength(1);
        expect(rest[0]!.readAt).toBe(later.toISOString());
        // Olive's rows are untouched, and the first read time is kept.
        const oliveRows = await store.listForRecipient(HOUSEHOLD, OLIVE);
        expect(oliveRows.every((r) => r.readAt === null)).toBe(true);
        expect((await store.get(HOUSEHOLD, miaRows[0]!.id))!.readAt).toBe(
            NOW.toISOString(),
        );
    });
});

describe("markRead of a resolved row", () => {
    test("a row whose condition cleared is not marked read by id", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const deps = { store, dismissals };
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [expiring("f1")],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        const row = (await store.listForRecipient(HOUSEHOLD, MIA))[0]!;
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        expect((await store.get(HOUSEHOLD, row.id))!.resolvedAt).not.toBeNull();
        await markRead(deps, {
            householdId: HOUSEHOLD,
            actor: { userId: MIA, role: "member" },
            ids: [row.id],
            now: NOW,
        }).catch(() => []);
        expect((await store.get(HOUSEHOLD, row.id))!.readAt).toBeNull();
    });
});

describe("markRead all", () => {
    test("marks only what the inbox shows: not snoozed, not kind-off, not dismissed", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const deps = { store, dismissals };
        const member = { userId: MIA, role: "member" as const };
        const low = notice("grocery.running_low", "g1", "grocery_line");
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [expiring("f1"), expiring("f2"), expiring("f3"), low],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        const mine = await store.listForRecipient(HOUSEHOLD, MIA);
        const byKey = (n: Notice) =>
            mine.find(
                (r) => r.noticeKey === dismissalKeyString(dismissalKey(n)),
            )!;
        const snoozed = byKey(expiring("f1"));
        const dismissedRow = byKey(expiring("f2"));
        const shown = byKey(expiring("f3"));
        const kindOff = byKey(low);
        await store.update(HOUSEHOLD, [snoozed.id], {
            snoozedUntil: new Date(NOW.getTime() + 86_400_000).toISOString(),
        });
        await store.update(HOUSEHOLD, [dismissedRow.id], {
            dismissedAt: NOW.toISOString(),
        });
        await store.upsertPref({
            householdId: HOUSEHOLD,
            userId: MIA,
            kind: "running_low",
            enabled: false,
            updatedAt: NOW.toISOString(),
        });
        const changed = await markRead(deps, {
            householdId: HOUSEHOLD,
            actor: member,
            ids: "all",
            now: NOW,
        });
        expect(changed.map((r) => r.id)).toEqual([shown.id]);
        // The snooze ends and the preference comes back: both are still unread.
        expect((await store.get(HOUSEHOLD, snoozed.id))!.readAt).toBeNull();
        expect((await store.get(HOUSEHOLD, kindOff.id))!.readAt).toBeNull();
    });

    test("a condition under a household dismissal is not marked, and named ids still mark exactly those", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const deps = { store, dismissals };
        const member = { userId: MIA, role: "member" as const };
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [expiring("f1"), expiring("f2")],
            members: MEMBERS,
            now: NOW,
            newId,
        });
        const key1 = dismissalKey(expiring("f1"));
        await dismissals.insert({
            householdId: HOUSEHOLD,
            ...key1,
            dismissedBy: OLIVE,
        });
        const mine = await store.listForRecipient(HOUSEHOLD, MIA);
        const hidden = mine.find(
            (r) => r.noticeKey === dismissalKeyString(key1),
        )!;
        const visible = mine.find((r) => r.id !== hidden.id)!;
        const all = await markRead(deps, {
            householdId: HOUSEHOLD,
            actor: member,
            ids: "all",
            now: NOW,
        });
        expect(all.map((r) => r.id)).toEqual([visible.id]);
        const named = await markRead(deps, {
            householdId: HOUSEHOLD,
            actor: member,
            ids: [hidden.id],
            now: NOW,
        });
        expect(named.map((r) => r.id)).toEqual([hidden.id]);
    });
});

describe("sweepable", () => {
    const DAY = 86_400_000;
    const ago = (days: number) =>
        new Date(NOW.getTime() - days * DAY).toISOString();

    test("selects event rows dismissed over 30 days ago and condition rows resolved over 30 days ago", () => {
        const oldEvent = openRow({
            noticeKey: "event:1",
            source: "event",
            kind: "recipe_changes",
            dismissedAt: ago(31),
        });
        const freshEvent = openRow({
            noticeKey: "event:2",
            source: "event",
            kind: "recipe_changes",
            dismissedAt: ago(29),
        });
        const unseenEvent = openRow({
            noticeKey: "event:3",
            source: "event",
            kind: "recipe_changes",
        });
        const oldResolved = openRow({ noticeKey: "k1", resolvedAt: ago(31) });
        const freshResolved = openRow({ noticeKey: "k2", resolvedAt: ago(29) });
        const rows = [
            oldEvent,
            freshEvent,
            unseenEvent,
            oldResolved,
            freshResolved,
        ];
        expect(
            sweepable(rows, NOW)
                .map((r) => r.id)
                .sort(),
        ).toEqual([oldEvent.id, oldResolved.id].sort());
    });

    test("a dismissed condition that is still open is never selected, however old the dismissal", () => {
        const stillTrue = openRow({ noticeKey: "k1", dismissedAt: ago(400) });
        expect(sweepable([stillTrue], NOW)).toEqual([]);
    });

    test("a dismissed condition is selected once it has cleared and 30 days have passed", () => {
        const cleared = openRow({
            noticeKey: "k1",
            dismissedAt: ago(400),
            resolvedAt: ago(40),
        });
        const justCleared = openRow({
            noticeKey: "k2",
            dismissedAt: ago(400),
            resolvedAt: ago(2),
        });
        expect(sweepable([cleared, justCleared], NOW)).toEqual([cleared]);
    });

    test("a dismissed open condition survives the store sweep and the next sync", async () => {
        const store = createMemoryNotificationsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const deps = { store, dismissals };
        const n = expiring("f1");
        await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [n],
            members: [{ userId: MIA, role: "member" }],
            now: new Date(NOW.getTime() - 90 * DAY),
            newId,
        });
        const row = (await store.listForRecipient(HOUSEHOLD, MIA))[0]!;
        await dismiss(deps, {
            householdId: HOUSEHOLD,
            actor: { userId: MIA, role: "member" },
            id: row.id,
            scope: "me",
            now: new Date(NOW.getTime() - 60 * DAY),
        });
        const candidates = await store.listForSweep(ago(30));
        expect(sweepable(candidates, NOW)).toEqual([]);
        const plan = await syncHouseholdConditions(deps, {
            householdId: HOUSEHOLD,
            notices: [n],
            members: [{ userId: MIA, role: "member" }],
            now: NOW,
            newId,
        });
        expect(plan).toEqual({ insert: [], resolve: [], update: [] });
        const after = await store.listForRecipient(HOUSEHOLD, MIA);
        expect(after).toHaveLength(1);
        expect(after[0]!.dismissedAt).not.toBeNull();
        expect(after[0]!.resolvedAt).toBeNull();
    });
});

describe("listOpenConditions", () => {
    test("returns only unresolved condition rows of the household", async () => {
        const store = createMemoryNotificationsStore();
        const open = openRow({ noticeKey: "k1" });
        const resolved = openRow({
            noticeKey: "k2",
            resolvedAt: "2026-11-20T10:00:00.000Z",
        });
        const event = openRow({ noticeKey: "event:1", source: "event" });
        const other = openRow({ noticeKey: "k3", householdId: "h2" });
        await store.insertMany([open, resolved, event, other]);
        const rows = await store.listOpenConditions(HOUSEHOLD);
        expect(rows.map((r) => r.id)).toEqual([open.id]);
    });
});

describe("row mappers", () => {
    test("a preference round-trips through the database shape", () => {
        const pref = {
            householdId: HOUSEHOLD,
            userId: MIA,
            kind: "food_expiring" as const,
            enabled: false,
            updatedAt: "2026-11-21T12:00:00.000Z",
        };
        const db = notificationPrefToDb(pref);
        expect(db).toEqual({
            household_id: HOUSEHOLD,
            user_id: MIA,
            kind: "food_expiring",
            enabled: false,
            updated_at: "2026-11-21T12:00:00.000Z",
        });
        expect(notificationPrefFromDb(db)).toEqual(pref);
        expect(
            notificationPrefFromDb({
                ...db,
                updated_at: new Date(pref.updatedAt),
            }),
        ).toEqual(pref);
    });

    test("a stored row round-trips through the database shape", () => {
        const row = openRow({
            noticeKey: "event:1",
            source: "event",
            kind: "recipe_changes",
            payload: { name: "Chili", n: 2 },
            actorUserId: OLIVE,
            subjectKind: "recipe",
            subjectId: "r1",
            readAt: "2026-11-20T09:00:00.000Z",
            snoozedUntil: "2026-11-22T09:00:00.000Z",
            snoozedBy: MIA,
        });
        const db = notificationToDb(row);
        expect(db.notice_key).toBe("event:1");
        expect(db.recipient_user_id).toBe(MIA);
        expect(notificationFromDb(db)).toEqual(row);
        // Postgres hands back Date objects for timestamptz.
        expect(
            notificationFromDb({ ...db, created_at: new Date(row.createdAt) }),
        ).toEqual(row);
    });
});
