import { describe, expect, spyOn, test } from "bun:test";
import { Hono, type MiddlewareHandler } from "hono";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKeyString,
} from "../../domain/notice-dismissals.js";
import {
    createMemoryNotificationsStore,
    type NotificationRow,
} from "../../domain/notifications.js";
import type { HouseholdMember } from "../../household.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../test-support/chrome-flags.js";
import {
    loadInbox,
    loadNotificationsUnread,
    viewerChromeWithAttention,
} from "../attention.js";
import { createNotificationsRoutes } from "./notifications.js";

const HH = "hh-1";
const NOW = new Date("2026-11-22T12:00:00.000Z");

const MEMBERS: Record<string, HouseholdMember> = {
    owner: {
        householdId: HH,
        userId: "u-owner",
        role: "owner",
        displayName: "Owen",
    },
    admin: {
        householdId: HH,
        userId: "u-admin",
        role: "admin",
        displayName: "Ada",
    },
    member: {
        householdId: HH,
        userId: "u-member",
        role: "member",
        displayName: "Mia",
    },
};

const auth: MiddlewareHandler = async (c, next) => {
    const member = MEMBERS[c.req.header("x-user") ?? ""];
    if (!member) return c.text("sign in", 401);
    c.set("member", member);
    c.set("userId", member.userId);
    await next();
};

const EXPIRING_KEY = dismissalKeyString({
    code: "fridge.expiring",
    subjectKind: "fridge_item",
    subjectId: "item-1",
    relatedKey: "",
});

function row(over: Partial<NotificationRow> = {}): NotificationRow {
    return {
        id: crypto.randomUUID(),
        householdId: HH,
        recipientUserId: MEMBERS.member!.userId,
        kind: "food_expiring",
        bucket: "household",
        source: "condition",
        noticeKey: EXPIRING_KEY,
        subjectKind: "fridge_item",
        subjectId: "item-1",
        actorUserId: null,
        payload: {
            code: "fridge.expiring",
            params: {
                name: "Greek yogurt",
                amount: 1,
                unit: "each",
                expiresOn: "2026-11-23",
                daysLeft: 1,
                onGroceryList: "no",
            },
            related: [],
        },
        createdAt: "2026-11-22T08:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        ...over,
    };
}

function setup(opts: { failGet?: boolean; failNames?: boolean } = {}) {
    const store = createMemoryNotificationsStore();
    const dismissals = createMemoryNoticeDismissalsStore();
    // `failGet` makes the per-row read behind mark-read throw, as a store error
    // or a row deleted since the list would.
    const notifications = {
        store: opts.failGet
            ? {
                  ...store,
                  get: async () => {
                      throw new Error("store unavailable");
                  },
              }
            : store,
        dismissals,
    };
    const app = new Hono().route(
        "/",
        createNotificationsRoutes({
            auth,
            notifications,
            now: () => NOW,
            timezone: async () => "UTC",
            memberNames: async () =>
                opts.failNames
                    ? Promise.reject(new Error("members unavailable"))
                    : new Map(
                          Object.values(MEMBERS).map((m) => [
                              m.userId,
                              m.displayName,
                          ]),
                      ),
            prepare: async () => ({
                timezone: "UTC",
                profile: null,
                notices: { notices: [] },
            }),
            // The dot is read after the page marked its rows read, as in the
            // live shell.
            chrome: async (viewer) => ({
                theme: "light",
                attention: { count: 0, tabs: {} },
                flags: FIXTURE_APP_CHROME_FLAGS,
                identity: {
                    viewerName: viewer.displayName,
                    viewerRole: viewer.role,
                    householdName: "The Flow household",
                    memberCount: 3,
                },
                notificationsUnread: await loadNotificationsUnread(
                    viewer,
                    notifications,
                    NOW,
                ),
            }),
        }),
    );
    const get = (path: string, user = "member") =>
        app.request(path, { headers: { "x-user": user } });
    const post = (
        path: string,
        fields: Record<string, string>,
        user = "member",
    ) =>
        app.request(path, {
            method: "POST",
            headers: { "x-user": user },
            body: new URLSearchParams(fields),
        });
    const seed = async (...rows: NotificationRow[]) => {
        await store.insertMany(rows);
    };
    const inboxOf = (
        user: string,
        bucket: "all" | "personal" | "household" = "all",
    ) =>
        loadInbox(notifications, MEMBERS[user]!, {
            now: NOW,
            timezone: "UTC",
            bucket,
        });
    return { app, store, dismissals, notifications, get, post, seed, inboxOf };
}

describe("GET /notifications", () => {
    test("answers 200 for a member and lists what the inbox holds", async () => {
        const { get, seed } = setup();
        await seed(row());
        const res = await get("/notifications");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Greek yogurt");
        expect(html).toContain("Fridge · Household");
    });

    // Event kinds are off until a person turns them on.
    const turnOn = (
        store: ReturnType<typeof setup>["store"],
        kind: NotificationRow["kind"],
    ) =>
        store.upsertPref({
            householdId: HH,
            userId: MEMBERS.member!.userId,
            kind,
            enabled: true,
            updatedAt: NOW.toISOString(),
        });

    test("an event row says who did it, by the member's name", async () => {
        const { get, seed, store } = setup();
        await turnOn(store, "recipe_changes");
        await seed(
            row({
                kind: "recipe_changes",
                source: "event",
                noticeKey: "event:1",
                subjectKind: "recipe",
                subjectId: "r-chili",
                actorUserId: MEMBERS.admin!.userId,
                payload: { recipeName: "Beef chili" },
            }),
        );
        const html = await (await get("/notifications")).text();
        expect(html).toContain("Ada removed Beef chili");
        expect(html).toContain("Recipes · Household");
    });

    test("an event whose actor is no longer a member reads Someone, and a failed name read does not take the inbox down", async () => {
        const { get, seed, store } = setup({ failNames: true });
        await turnOn(store, "new_usuals");
        const errors = spyOn(console, "error").mockImplementation(() => {});
        try {
            await seed(
                row({
                    kind: "new_usuals",
                    source: "event",
                    noticeKey: "event:2",
                    subjectKind: "food",
                    subjectId: "f-eggs",
                    actorUserId: MEMBERS.admin!.userId,
                    payload: { foodName: "Eggs", productName: null },
                }),
            );
            const res = await get("/notifications");
            expect(res.status).toBe(200);
            expect(await res.text()).toContain(
                "Someone added Eggs to the usuals",
            );
        } finally {
            errors.mockRestore();
        }
    });

    test("opening it marks the shown rows read, and the dot is already off", async () => {
        const { get, seed, store } = setup();
        const shown = row();
        await seed(shown);
        const res = await get("/notifications");
        expect(res.status).toBe(200);
        expect((await store.get(HH, shown.id))!.readAt).toBe(NOW.toISOString());
        const html = await res.text();
        // The bell is there (desktop top bar and phone cluster) with no dot.
        expect(html).toContain('class="fd-bell"');
        expect(html).not.toContain("fd-bell--unread");
    });

    test.each(["Purpose", "Sec-Purpose", "X-Sec-Purpose"])(
        "a speculative load (%s: prefetch) renders the inbox but marks nothing read",
        async (header) => {
            const { app, seed, store } = setup();
            const shown = row();
            await seed(shown);
            const res = await app.request("/notifications", {
                headers: { "x-user": "member", [header]: "prefetch" },
            });
            expect(res.status).toBe(200);
            expect(await res.text()).toContain("Greek yogurt");
            expect((await store.get(HH, shown.id))!.readAt).toBeNull();
            // The real visit afterwards still clears it.
            await app.request("/notifications", {
                headers: { "x-user": "member" },
            });
            expect((await store.get(HH, shown.id))!.readAt).toBe(
                NOW.toISOString(),
            );
        },
    );

    test("a HEAD request marks nothing read", async () => {
        const { app, seed, store } = setup();
        const shown = row();
        await seed(shown);
        const res = await app.request("/notifications", {
            method: "HEAD",
            headers: { "x-user": "member" },
        });
        expect(res.status).toBe(200);
        expect((await store.get(HH, shown.id))!.readAt).toBeNull();
    });

    test("a snooze that has ended lights the dot again, and opening the inbox clears it", async () => {
        const { get, seed, store, notifications } = setup();
        // Read at 08:30, snoozed until 10:00, now 12:00: back, and new.
        const back = row({
            readAt: "2026-11-22T08:30:00.000Z",
            snoozedUntil: "2026-11-22T10:00:00.000Z",
            snoozedBy: MEMBERS.member!.userId,
        });
        await seed(back);
        expect(
            await loadNotificationsUnread(MEMBERS.member!, notifications, NOW),
        ).toBe(true);
        const res = await get("/notifications");
        expect(res.status).toBe(200);
        // Opened: read again, after the snooze ended, so no dot.
        expect((await store.get(HH, back.id))!.readAt).toBe(NOW.toISOString());
        expect(await res.text()).not.toContain("fd-bell--unread");
        expect(
            await loadNotificationsUnread(MEMBERS.member!, notifications, NOW),
        ).toBe(false);
    });

    test("a row that is still snoozed shows no dot", async () => {
        const { seed, notifications } = setup();
        await seed(
            row({
                readAt: "2026-11-22T08:30:00.000Z",
                snoozedUntil: "2026-11-23T09:00:00.000Z",
            }),
        );
        expect(
            await loadNotificationsUnread(MEMBERS.member!, notifications, NOW),
        ).toBe(false);
    });

    test("a row read after its snooze ended is not new", async () => {
        const { seed, notifications } = setup();
        await seed(
            row({
                snoozedUntil: "2026-11-22T10:00:00.000Z",
                readAt: "2026-11-22T11:00:00.000Z",
            }),
        );
        expect(
            await loadNotificationsUnread(MEMBERS.member!, notifications, NOW),
        ).toBe(false);
    });

    test("a snooze that ended with a prefetch leaves the dot on", async () => {
        const { app, seed, store } = setup();
        const readAt = "2026-11-22T08:30:00.000Z";
        const back = row({
            readAt,
            snoozedUntil: "2026-11-22T10:00:00.000Z",
        });
        await seed(back);
        await app.request("/notifications", {
            headers: { "x-user": "member", "sec-purpose": "prefetch" },
        });
        expect((await store.get(HH, back.id))!.readAt).toBe(readAt);
    });

    test("a row that is snoozed is not marked read", async () => {
        const { get, seed, store } = setup();
        const waiting = row({ snoozedUntil: "2026-11-23T09:00:00.000Z" });
        await seed(waiting);
        await get("/notifications");
        expect((await store.get(HH, waiting.id))!.readAt).toBeNull();
    });

    test("another member's rows are not shown", async () => {
        const { get, seed } = setup();
        await seed(
            row({
                recipientUserId: MEMBERS.admin!.userId,
                kind: "weigh_in_due",
                bucket: "personal",
                noticeKey: "weigh",
                payload: {
                    code: "nutrition.weigh_in_due",
                    params: { name: "Ada", days: 8 },
                    related: [],
                },
            }),
        );
        const html = await (await get("/notifications")).text();
        expect(html).not.toContain("Weigh-in due");
    });

    test("the bucket query filters the list", async () => {
        const { get, seed } = setup();
        await seed(
            row(),
            row({
                kind: "weigh_in_due",
                bucket: "personal",
                noticeKey: "weigh",
                subjectKind: "member",
                subjectId: MEMBERS.member!.userId,
                payload: {
                    code: "nutrition.weigh_in_due",
                    params: { name: "Mia", days: 8 },
                    related: [],
                },
            }),
        );
        const mine = await (await get("/notifications?bucket=personal")).text();
        expect(mine).toContain("Weigh-in due");
        expect(mine).not.toContain("Greek yogurt");
        const house = await (
            await get("/notifications?bucket=household")
        ).text();
        expect(house).toContain("Greek yogurt");
        expect(house).not.toContain("Weigh-in due");
    });

    test("the household filter marks only household rows read, and the dot stays for the rest", async () => {
        const { get, seed, store } = setup();
        const house = row();
        const mine = row({
            kind: "weigh_in_due",
            bucket: "personal",
            noticeKey: "weigh",
            subjectKind: "member",
            subjectId: MEMBERS.member!.userId,
            payload: {
                code: "nutrition.weigh_in_due",
                params: { name: "Mia", days: 8 },
                related: [],
            },
        });
        await seed(house, mine);
        const res = await get("/notifications?bucket=household");
        expect(res.status).toBe(200);
        expect((await store.get(HH, house.id))!.readAt).toBe(NOW.toISOString());
        expect((await store.get(HH, mine.id))!.readAt).toBeNull();
        expect(await res.text()).toContain("fd-bell--unread");
    });

    test("a row that vanished before it was marked read still shows the inbox", async () => {
        const { get, seed } = setup({ failGet: true });
        await seed(row());
        const log = spyOn(console, "error").mockImplementation(() => {});
        try {
            const res = await get("/notifications");
            expect(res.status).toBe(200);
            expect(await res.text()).toContain("Greek yogurt");
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    test("an empty inbox says so", async () => {
        const { get } = setup();
        const html = await (await get("/notifications")).text();
        expect(html).toContain("Nothing to look at");
    });
});

describe("POST /notifications/:id/dismiss", () => {
    test("a member dismisses their own row for themselves: 303 back to the inbox", async () => {
        const { post, seed, inboxOf } = setup();
        const mine = row();
        await seed(mine);
        const res = await post(`/notifications/${mine.id}/dismiss`, {
            scope: "me",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/notifications");
        expect((await inboxOf("member")).today).toHaveLength(0);
    });

    test("a member cannot dismiss for everyone", async () => {
        const { post, seed, inboxOf, dismissals } = setup();
        const mine = row();
        await seed(mine);
        const res = await post(`/notifications/${mine.id}/dismiss`, {
            scope: "everyone",
        });
        expect(res.status).toBe(403);
        // Rendered in place, with the reason.
        expect(await res.text()).toContain('role="alert"');
        expect((await inboxOf("member")).today).toHaveLength(1);
        expect(await dismissals.listForHousehold(HH)).toHaveLength(0);
    });

    test("another member's personal row refuses dismiss and snooze", async () => {
        const { post, seed, inboxOf } = setup();
        const theirs = row({
            recipientUserId: MEMBERS.admin!.userId,
            kind: "weigh_in_due",
            bucket: "personal",
            noticeKey: "weigh",
        });
        await seed(theirs);
        const dismissed = await post(`/notifications/${theirs.id}/dismiss`, {
            scope: "me",
        });
        const snoozed = await post(`/notifications/${theirs.id}/snooze`, {
            until: "tomorrow",
        });
        expect(dismissed.status).toBe(403);
        expect(snoozed.status).toBe(403);
        const inbox = await inboxOf("admin");
        expect(inbox.today).toHaveLength(1);
        expect(inbox.snoozed).toHaveLength(0);
    });

    test("not even an admin dismisses a personal row of someone else", async () => {
        const { post, seed } = setup();
        const theirs = row({
            kind: "weigh_in_due",
            bucket: "personal",
            noticeKey: "weigh",
        });
        await seed(theirs);
        const res = await post(
            `/notifications/${theirs.id}/dismiss`,
            { scope: "everyone" },
            "admin",
        );
        expect(res.status).toBe(403);
    });

    test("an admin's Dismiss for everyone clears it for another member", async () => {
        const { post, seed, inboxOf } = setup();
        const adminRow = row({ recipientUserId: MEMBERS.admin!.userId });
        const memberRow = row();
        await seed(adminRow, memberRow);
        expect((await inboxOf("member")).today).toHaveLength(1);
        const res = await post(
            `/notifications/${adminRow.id}/dismiss`,
            { scope: "everyone" },
            "admin",
        );
        expect(res.status).toBe(303);
        expect((await inboxOf("member")).today).toHaveLength(0);
        expect((await inboxOf("admin")).today).toHaveLength(0);
    });

    test("an unknown row is a 404, a bad scope a 400", async () => {
        const { post, seed } = setup();
        const mine = row();
        await seed(mine);
        const missing = await post(
            `/notifications/${crypto.randomUUID()}/dismiss`,
            {
                scope: "me",
            },
        );
        const bad = await post(`/notifications/${mine.id}/dismiss`, {
            scope: "all",
        });
        expect(missing.status).toBe(404);
        expect(bad.status).toBe(400);
    });

    test("an Allergens row cannot be dismissed", async () => {
        const { post, seed, inboxOf } = setup();
        const allergen = row({
            kind: "allergens",
            noticeKey: "allergen",
            payload: { code: "grocery.allergen", params: {}, related: [] },
        });
        await seed(allergen);
        const res = await post(`/notifications/${allergen.id}/dismiss`, {
            scope: "me",
        });
        expect(res.status).toBe(422);
        expect((await inboxOf("member")).today).toHaveLength(1);
    });

    test("the filter the person was on is kept", async () => {
        const { post, seed } = setup();
        const mine = row();
        await seed(mine);
        const res = await post(`/notifications/${mine.id}/dismiss`, {
            scope: "me",
            bucket: "household",
        });
        expect(res.headers.get("location")).toBe(
            "/notifications?bucket=household",
        );
    });
});

describe("POST /notifications/:id/snooze", () => {
    test("until tomorrow moves the row to Snoozed", async () => {
        const { post, seed, inboxOf, get } = setup();
        const mine = row();
        await seed(mine);
        const res = await post(`/notifications/${mine.id}/snooze`, {
            until: "tomorrow",
        });
        expect(res.status).toBe(303);
        const inbox = await inboxOf("member");
        expect(inbox.today).toHaveLength(0);
        expect(inbox.snoozed.map((r) => r.id)).toEqual([mine.id]);
        expect(inbox.snoozed[0]!.snoozedUntil).toBe("2026-11-23T09:00:00.000Z");
        const html = await (await get("/notifications")).text();
        expect(html).toContain("Back tomorrow 9:00 · Household");
    });

    test("an admin's snooze on a household row snoozes it for the member too", async () => {
        const { post, seed, inboxOf } = setup();
        const adminRow = row({ recipientUserId: MEMBERS.admin!.userId });
        const memberRow = row();
        await seed(adminRow, memberRow);
        const res = await post(
            `/notifications/${adminRow.id}/snooze`,
            { until: "tomorrow" },
            "admin",
        );
        expect(res.status).toBe(303);
        expect((await inboxOf("member")).today).toHaveLength(0);
        expect((await inboxOf("member")).snoozed.map((r) => r.id)).toEqual([
            memberRow.id,
        ]);
        expect((await inboxOf("admin")).snoozed.map((r) => r.id)).toEqual([
            adminRow.id,
        ]);
    });

    test("a member's snooze stays on their own row", async () => {
        const { post, seed, inboxOf } = setup();
        const adminRow = row({ recipientUserId: MEMBERS.admin!.userId });
        const memberRow = row();
        await seed(adminRow, memberRow);
        await post(`/notifications/${memberRow.id}/snooze`, {
            until: "tomorrow",
        });
        expect((await inboxOf("member")).snoozed).toHaveLength(1);
        expect((await inboxOf("admin")).today).toHaveLength(1);
    });

    test("1 week moves it a week out", async () => {
        const { post, seed, inboxOf } = setup();
        const mine = row();
        await seed(mine);
        await post(`/notifications/${mine.id}/snooze`, { until: "week" });
        const inbox = await inboxOf("member");
        expect(inbox.snoozed[0]!.snoozedUntil).toBe("2026-11-29T12:00:00.000Z");
    });

    test("anything else is a 400", async () => {
        const { post, seed } = setup();
        const mine = row();
        await seed(mine);
        const res = await post(`/notifications/${mine.id}/snooze`, {
            until: "never",
        });
        expect(res.status).toBe(400);
    });
});

describe("POST /settings/notifications", () => {
    test("turning a kind off answers 303 back to the inbox and drops its rows", async () => {
        const { post, seed, inboxOf, store } = setup();
        await seed(
            row({
                kind: "running_low",
                noticeKey: "low",
                payload: {
                    code: "grocery.running_low",
                    params: { name: "Milk", reason: "usually bought weekly" },
                    related: [],
                },
            }),
        );
        const res = await post("/settings/notifications", {
            kind: "running_low",
            enabled: "false",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/notifications");
        expect(
            (await store.listPrefs(HH, MEMBERS.member!.userId)).map((p) => [
                p.kind,
                p.enabled,
            ]),
        ).toEqual([["running_low", false]]);
        expect((await inboxOf("member")).today).toHaveLength(0);
    });

    test("kind=allergens is refused", async () => {
        const { post, store } = setup();
        const off = await post("/settings/notifications", {
            kind: "allergens",
            enabled: "false",
        });
        const on = await post("/settings/notifications", {
            kind: "allergens",
            enabled: "true",
        });
        expect(off.status).toBe(422);
        expect(on.status).toBe(422);
        expect(await store.listPrefs(HH, MEMBERS.member!.userId)).toHaveLength(
            0,
        );
    });

    test("an unknown kind or a missing switch is a 400", async () => {
        const { post } = setup();
        const unknown = await post("/settings/notifications", {
            kind: "nope",
            enabled: "false",
        });
        const bare = await post("/settings/notifications", {
            kind: "running_low",
        });
        expect(unknown.status).toBe(400);
        expect(bare.status).toBe(400);
    });
});

describe("GET /settings/notifications", () => {
    const switchOf = (html: string, kind: string) => {
        const row = html.slice(html.indexOf(`id="notification-kind-${kind}"`));
        return row.slice(0, row.indexOf("</li>"));
    };

    test("answers 200 for a member: the base kinds on, the extras off, no Allergens row", async () => {
        const { get } = setup();
        const res = await get("/settings/notifications");
        expect(res.status).toBe(200);
        const html = await res.text();
        for (const kind of ["food_expiring", "running_low", "weigh_in_due"]) {
            expect(switchOf(html, kind)).toContain('aria-checked="true"');
        }
        for (const kind of [
            "recipe_changes",
            "week_plan_changes",
            "new_usuals",
        ]) {
            expect(switchOf(html, kind)).toContain('aria-checked="false"');
        }
        expect(html).not.toContain('id="notification-kind-allergens"');
        expect(html).not.toContain(">Allergens<");
    });

    test("shows the viewer's own choices, not another member's", async () => {
        const { get, post } = setup();
        await post("/settings/notifications", {
            kind: "running_low",
            enabled: "false",
        });
        await post("/settings/notifications", {
            kind: "recipe_changes",
            enabled: "true",
        });
        const mine = await (await get("/settings/notifications")).text();
        expect(switchOf(mine, "running_low")).toContain('aria-checked="false"');
        expect(switchOf(mine, "recipe_changes")).toContain(
            'aria-checked="true"',
        );
        const theirs = await (
            await get("/settings/notifications", "admin")
        ).text();
        expect(switchOf(theirs, "running_low")).toContain(
            'aria-checked="true"',
        );
        expect(switchOf(theirs, "recipe_changes")).toContain(
            'aria-checked="false"',
        );
    });

    test("a request without a session is refused", async () => {
        const { app } = setup();
        expect((await app.request("/settings/notifications")).status).toBe(401);
    });
});

describe("POST /settings/notifications from the Settings page", () => {
    test("a toggle saves and goes back to Settings › Notifications, with no toast", async () => {
        const { post, store, get } = setup();
        const res = await post("/settings/notifications", {
            kind: "recipe_changes",
            enabled: "true",
            return: "/settings/notifications",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/notifications");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(
            (await store.listPrefs(HH, MEMBERS.member!.userId)).map((p) => [
                p.kind,
                p.enabled,
            ]),
        ).toEqual([["recipe_changes", true]]);
        const html = await (await get("/settings/notifications")).text();
        expect(html).toContain('id="notification-kind-recipe_changes"');
    });

    test("a kind turned on again brings its rows back to the inbox", async () => {
        const { post, seed, inboxOf } = setup();
        await seed(
            row({
                kind: "running_low",
                noticeKey: "low",
                payload: {
                    code: "grocery.running_low",
                    params: { name: "Milk", reason: "usually bought weekly" },
                    related: [],
                },
            }),
        );
        await post("/settings/notifications", {
            kind: "running_low",
            enabled: "false",
            return: "/settings/notifications",
        });
        expect((await inboxOf("member")).today).toHaveLength(0);
        await post("/settings/notifications", {
            kind: "running_low",
            enabled: "true",
            return: "/settings/notifications",
        });
        expect((await inboxOf("member")).today).toHaveLength(1);
    });

    test("turning Allergens off is refused in place, on the Settings page", async () => {
        const { post, store } = setup();
        const res = await post("/settings/notifications", {
            kind: "allergens",
            enabled: "false",
            return: "/settings/notifications",
        });
        expect(res.status).toBe(422);
        const html = await res.text();
        expect(html).toMatch(
            /role="alert">Allergen notifications can(&#39;|&#x27;|&#039;|')t be turned off\./,
        );
        expect(html).toContain('id="notification-kind-food_expiring"');
        expect(html).not.toContain("fd-notifications__filter");
        expect(await store.listPrefs(HH, MEMBERS.member!.userId)).toHaveLength(
            0,
        );
    });

    test("the return field cannot send anyone off-site or to another page", async () => {
        const { post } = setup();
        for (const bad of [
            "https://evil.example/",
            "//evil.example",
            "/settings/notifications/../x",
            "/settings/notifications?x=1",
            "/settings",
            "javascript:alert(1)",
            "",
        ]) {
            const res = await post("/settings/notifications", {
                kind: "running_low",
                enabled: "false",
                return: bad,
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/notifications");
        }
    });

    test("an Allergens refusal from the inbox's menu still renders the inbox", async () => {
        const { post } = setup();
        const res = await post("/settings/notifications", {
            kind: "allergens",
            enabled: "false",
        });
        expect(res.status).toBe(422);
        expect(await res.text()).toContain("fd-notifications");
    });
});

describe("who may call", () => {
    test("a request without a session never reaches the handlers", async () => {
        const { app } = setup();
        expect((await app.request("/notifications")).status).toBe(401);
        const res = await app.request("/settings/notifications", {
            method: "POST",
            body: new URLSearchParams({
                kind: "running_low",
                enabled: "false",
            }),
        });
        expect(res.status).toBe(401);
    });
});

describe("viewerChromeWithAttention's bell", () => {
    const identity = async () => ({
        viewerUserId: MEMBERS.member!.userId,
        viewerName: "Mia",
        viewerRole: MEMBERS.member!.role,
        householdName: "The Flow household",
        memberCount: 2,
    });
    const avatars = async () => new Map<string, Date>();
    const chromeWith = (
        loadUnread: (viewer: HouseholdMember) => Promise<boolean>,
    ) =>
        viewerChromeWithAttention(
            null,
            MEMBERS.member!,
            { notices: [] },
            identity,
            avatars,
            loadUnread,
        );

    test("carries what the unread read says", async () => {
        expect((await chromeWith(async () => true)).notificationsUnread).toBe(
            true,
        );
        expect((await chromeWith(async () => false)).notificationsUnread).toBe(
            false,
        );
    });

    test("asks for the viewer's own unread", async () => {
        const seen: string[] = [];
        await chromeWith(async (viewer) => {
            seen.push(viewer.userId);
            return false;
        });
        expect(seen).toEqual([MEMBERS.member!.userId]);
    });

    test("a read that throws still renders the chrome, with no dot", async () => {
        const log = spyOn(console, "error").mockImplementation(() => {});
        try {
            const chrome = await chromeWith(async () => {
                throw new Error("db down");
            });
            expect(chrome.notificationsUnread).toBe(false);
            expect(chrome.identity?.viewerName).toBe("Mia");
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    test("a read that throws synchronously does too", async () => {
        const log = spyOn(console, "error").mockImplementation(() => {});
        try {
            const chrome = await chromeWith(() => {
                throw new Error("boom");
            });
            expect(chrome.notificationsUnread).toBe(false);
        } finally {
            log.mockRestore();
        }
    });
});
