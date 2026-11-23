import { describe, expect, test } from "bun:test";
import type { Inbox, NotificationRow } from "../../../domain/notifications.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AppChromeBase } from "../../attention.js";
import {
    agoText,
    backAtText,
    inboxHref,
    notificationMenuItems,
    notificationOpenHref,
    notificationTitle,
    parseInboxBucket,
    renderNotificationsBody,
    renderNotificationsPage,
    type NotificationsPageView,
} from "./notifications.js";

const NOW = new Date("2026-11-22T12:00:00.000Z");

const CHROME: AppChromeBase = {
    theme: "light",
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner",
        householdName: "The Flow household",
        memberCount: 3,
    },
};

function row(over: Partial<NotificationRow> = {}): NotificationRow {
    return {
        id: "11111111-1111-4111-8111-111111111111",
        householdId: "hh",
        recipientUserId: "u1",
        kind: "food_expiring",
        bucket: "household",
        source: "condition",
        noticeKey: "k",
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

function view(
    inbox: Partial<Inbox> = {},
    over: Partial<NotificationsPageView> = {},
): NotificationsPageView {
    return {
        chrome: CHROME,
        inbox: { unread: 0, today: [], earlier: [], snoozed: [], ...inbox },
        bucket: "all",
        canDismissEveryone: false,
        timezone: "UTC",
        now: NOW,
        ...over,
    };
}

const labels = (items: ReturnType<typeof notificationMenuItems>) =>
    items.flatMap((i) => ("label" in i ? [i.label] : []));

describe("the ⋯ menu", () => {
    test("a member: Open, both Snoozes, Dismiss and Turn off the kind", () => {
        expect(
            labels(
                notificationMenuItems(row(), {
                    canDismissEveryone: false,
                    bucket: "all",
                }),
            ),
        ).toEqual([
            "Open",
            "Snooze until tomorrow",
            "Snooze 1 week",
            "Dismiss",
            "Turn off “Food expiring”",
        ]);
    });

    test("an admin or owner on a household row: Dismiss splits in two", () => {
        expect(
            labels(
                notificationMenuItems(row(), {
                    canDismissEveryone: true,
                    bucket: "all",
                }),
            ),
        ).toEqual([
            "Open",
            "Snooze until tomorrow",
            "Snooze 1 week",
            "Dismiss for me",
            "Dismiss for everyone",
            "Turn off “Food expiring”",
        ]);
    });

    test("an admin on a personal row still has one Dismiss", () => {
        const personal = row({ kind: "weigh_in_due", bucket: "personal" });
        expect(
            labels(
                notificationMenuItems(personal, {
                    canDismissEveryone: true,
                    bucket: "all",
                }),
            ),
        ).toEqual([
            "Open",
            "Snooze until tomorrow",
            "Snooze 1 week",
            "Dismiss",
            "Turn off “Weigh-in due”",
        ]);
    });

    test("an Allergens row offers only Open", () => {
        const allergen = row({
            kind: "allergens",
            payload: { code: "grocery.allergen", params: {}, related: [] },
        });
        for (const canDismissEveryone of [false, true]) {
            const items = notificationMenuItems(allergen, {
                canDismissEveryone,
                bucket: "all",
            });
            expect(labels(items)).toEqual(["Open"]);
            expect(items.every((i) => i.kind === "link")).toBe(true);
        }
    });

    test("the actions post to the row's own routes, with the filter", () => {
        const items = notificationMenuItems(row(), {
            canDismissEveryone: true,
            bucket: "household",
        });
        const posts = items.flatMap((i) => (i.kind === "post" ? [i] : []));
        const id = "11111111-1111-4111-8111-111111111111";
        expect(posts.map((p) => [p.action, p.fields])).toEqual([
            [
                `/notifications/${id}/snooze`,
                { until: "tomorrow", bucket: "household" },
            ],
            [
                `/notifications/${id}/snooze`,
                { until: "week", bucket: "household" },
            ],
            [
                `/notifications/${id}/dismiss`,
                { scope: "me", bucket: "household" },
            ],
            [
                `/notifications/${id}/dismiss`,
                { scope: "everyone", bucket: "household" },
            ],
            [
                "/settings/notifications",
                {
                    kind: "food_expiring",
                    enabled: "false",
                    bucket: "household",
                },
            ],
        ]);
    });

    test("Turn off posts the row's own kind, for every kind but Allergens, and comes back to the inbox", () => {
        for (const canDismissEveryone of [false, true]) {
            for (const kind of [
                "food_expiring",
                "running_low",
                "weigh_in_due",
                "recipe_changes",
                "week_plan_changes",
                "new_usuals",
            ] as const) {
                const turnOff = notificationMenuItems(row({ kind }), {
                    canDismissEveryone,
                    bucket: "all",
                }).find((i) => i.kind === "post" && i.fields?.kind === kind);
                expect(turnOff).toMatchObject({
                    kind: "post",
                    action: "/settings/notifications",
                    fields: { kind, enabled: "false" },
                });
                // No `return` field: the post answers 303 to the inbox.
                expect(
                    (turnOff as { fields: Record<string, string> }).fields,
                ).not.toHaveProperty("return");
            }
        }
        const allergen = notificationMenuItems(row({ kind: "allergens" }), {
            canDismissEveryone: true,
            bucket: "all",
        });
        expect(JSON.stringify(allergen)).not.toContain(
            "/settings/notifications",
        );
        const html = renderNotificationsBody(
            view({ today: [row()], unread: 1 }, { canDismissEveryone: true }),
        );
        expect(html).toContain("Turn off “Food expiring”");
        expect(html).toContain(
            '<input type="hidden" name="enabled" value="false">',
        );
    });

    test("Open goes to the part of the app the row is about", () => {
        expect(notificationOpenHref(row())).toBe("/kitchen/fridge");
        expect(notificationOpenHref(row({ kind: "running_low" }))).toBe(
            "/kitchen/groceries",
        );
        expect(notificationOpenHref(row({ kind: "weigh_in_due" }))).toBe("/");
        expect(
            notificationOpenHref(
                row({
                    kind: "allergens",
                    subjectKind: "recipe",
                    subjectId: "r1",
                    payload: { code: "recipe.allergen" },
                }),
            ),
        ).toBe("/recipes/r1");
    });
});

describe("the page", () => {
    test("sections TODAY, EARLIER and SNOOZED, one row each with its menu", () => {
        const html = renderNotificationsBody(
            view({
                today: [row({ id: "a-today" })],
                earlier: [
                    row({
                        id: "a-earlier",
                        createdAt: "2026-11-20T08:00:00.000Z",
                    }),
                ],
                snoozed: [
                    row({
                        id: "a-snoozed",
                        snoozedUntil: "2026-11-23T09:00:00.000Z",
                    }),
                ],
            }),
        );
        const sections = [
            ...html.matchAll(/fd-section-header__label">([^<]+)</g),
        ].map((m) => m[1]);
        expect(sections).toEqual(["Today", "Earlier", "Snoozed"]);
        expect(html.match(/<li class="fd-item-row/g)).toHaveLength(3);
        expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(3);
        expect(html).toContain("Back tomorrow 9:00 · Household");
        expect(html).toContain("Fridge · Household");
    });

    test("a section with nothing in it is left out", () => {
        const html = renderNotificationsBody(view({ today: [row()] }));
        expect(html).toContain(">Today<");
        expect(html).not.toContain(">Earlier<");
        expect(html).not.toContain(">Snoozed<");
    });

    test("nothing open: an empty state, no list", () => {
        const html = renderNotificationsBody(view());
        expect(html).toContain("Nothing to look at");
        expect(html).not.toContain("fd-item-row");
    });

    test("a Detail bar titled Notifications with a back link, then the filter", () => {
        const html = renderNotificationsBody(view());
        expect(html).toContain(
            'class="fd-detail-bar__title">Notifications</h1>',
        );
        expect(html).toContain('aria-label="Back"');
        const filter = html.slice(html.indexOf('<nav class="fd-segmented'));
        expect(filter).toContain(">All</a>");
        expect(filter).toContain(">Just me</a>");
        expect(filter).toContain(">Household</a>");
    });

    test("the filter marks the current choice and links to the others", () => {
        const html = renderNotificationsBody(view({}, { bucket: "personal" }));
        expect(html).toContain(
            'class="fd-segmented__segment fd-segmented__segment--selected" href="/notifications?bucket=personal" aria-current="page">Just me',
        );
        expect(html).toContain('href="/notifications">All');
        expect(html).toContain(
            'href="/notifications?bucket=household">Household',
        );
    });

    test("a refusal is said in place", () => {
        const html = renderNotificationsBody(
            view({}, { error: "Only an admin can do that." }),
        );
        expect(html).toContain('role="alert">Only an admin can do that.');
    });

    test("names are escaped", () => {
        const html = renderNotificationsBody(
            view({
                today: [
                    row({
                        payload: {
                            code: "fridge.expiring",
                            params: {
                                name: "<img src=x onerror=alert(1)>",
                                amount: 1,
                                unit: "each",
                                expiresOn: "2026-11-23",
                                daysLeft: 1,
                                onGroceryList: "no",
                            },
                            related: [],
                        },
                    }),
                ],
            }),
        );
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x");
    });

    test("in the shell: phone nav marks nothing, no cluster over the Detail bar, the bell stays in the top bar", () => {
        const html = renderNotificationsPage(view({ today: [row()] }));
        const tabs = html.slice(html.indexOf('<nav class="fd-tabs"'));
        expect(tabs.split("</nav>")[0]).not.toContain("aria-current");
        expect(html).not.toContain('class="fd-cluster"');
        expect(html).toContain('<header class="fd-topbar">');
        expect(html).toContain('class="fd-bell"');
        expect(html).toContain("<title>Notifications</title>");
    });
});

describe("row text", () => {
    const CTX = { now: NOW, timezone: "UTC" };
    const cond = (
        code: string,
        params: Record<string, unknown>,
        kind = "food_expiring",
    ) =>
        row({
            kind: kind as NotificationRow["kind"],
            payload: { code, params, related: [] },
        });
    const expiring = (name: string, expiresOn: string) =>
        cond("fridge.expiring", {
            name,
            amount: 1,
            unit: "each",
            expiresOn,
            daysLeft: 1,
            onGroceryList: "no",
        });

    test("a fridge item reads as its name and when, relative to today", () => {
        expect(notificationTitle(row(), CTX)).toBe(
            "Greek yogurt expires tomorrow",
        );
        expect(notificationTitle(expiring("Milk", "2026-11-22"), CTX)).toBe(
            "Milk expires today",
        );
        expect(notificationTitle(expiring("Spinach", "2026-11-24"), CTX)).toBe(
            "Spinach expires in 2 days",
        );
        expect(notificationTitle(expiring("Spinach", "2026-11-21"), CTX)).toBe(
            "Spinach expired",
        );
        expect(
            notificationTitle(
                cond("fridge.expired", {
                    name: "Spinach",
                    amount: 1,
                    unit: "each",
                    expiresOn: "2026-11-20",
                    onGroceryList: "no",
                }),
                CTX,
            ),
        ).toBe("Spinach expired");
    });

    test("tomorrow is counted in the household's zone, across midnight", () => {
        // 23:30 on the 22nd in UTC is already the 23rd in Kyiv (UTC+2).
        const late = { now: new Date("2026-11-22T23:30:00.000Z") };
        expect(
            notificationTitle(expiring("Milk", "2026-11-23"), {
                ...late,
                timezone: "UTC",
            }),
        ).toBe("Milk expires tomorrow");
        expect(
            notificationTitle(expiring("Milk", "2026-11-23"), {
                ...late,
                timezone: "Europe/Kyiv",
            }),
        ).toBe("Milk expires today");
        // 03:00 UTC on the 23rd is still the 22nd in New York.
        expect(
            notificationTitle(expiring("Milk", "2026-11-23"), {
                now: new Date("2026-11-23T03:00:00.000Z"),
                timezone: "America/New_York",
            }),
        ).toBe("Milk expires tomorrow");
    });

    test("running low and weigh-in read as the design words them", () => {
        expect(
            notificationTitle(
                cond(
                    "grocery.running_low",
                    { name: "Milk", reason: "usually bought weekly" },
                    "running_low",
                ),
                CTX,
            ),
        ).toBe("Milk is running low");
        expect(
            notificationTitle(
                cond(
                    "nutrition.weigh_in_due",
                    { name: "Ethan", days: 8, lastWeighedOn: "2026-11-14" },
                    "weigh_in_due",
                ),
                CTX,
            ),
        ).toBe("Weigh-in due");
    });

    test("a condition the design does not word keeps its notice sentence", () => {
        expect(
            notificationTitle(
                cond("food.product_gluten", {}, "allergens"),
                CTX,
            ),
        ).toBe("Possible wheat (contains gluten)");
        // Missing name or date: the full sentence, not a half-worded title.
        expect(
            notificationTitle(
                cond("fridge.expiring", {
                    name: "Milk",
                    amount: 1,
                    unit: "each",
                    expiresOn: "soon",
                }),
                CTX,
            ),
        ).toBe("Milk 1 each expires soon");
    });

    test("a payload that does not read is the kind's name", () => {
        expect(notificationTitle(row({ payload: { code: "nope" } }), CTX)).toBe(
            "Food expiring",
        );
    });
});

describe("event rows", () => {
    // NOW is Sunday 22 Nov 2026 at noon.
    const CTX = {
        now: NOW,
        timezone: "UTC",
        memberNames: new Map([["u-sarah", "Sarah"]]),
    };
    const event = (
        kind: NotificationRow["kind"],
        payload: Record<string, unknown>,
        over: Partial<NotificationRow> = {},
    ) =>
        row({
            kind,
            source: "event",
            actorUserId: "u-sarah",
            subjectKind: "recipe",
            subjectId: "r-chili",
            payload,
            ...over,
        });
    const plan = (change: string, extra: Record<string, unknown> = {}) =>
        event("week_plan_changes", {
            recipeName: "Beef chili",
            date: "2026-11-23",
            slot: "dinner",
            change,
            ...extra,
        });

    test("a deleted recipe: who removed what", () => {
        expect(
            notificationTitle(
                event("recipe_changes", { recipeName: "Beef chili" }),
                CTX,
            ),
        ).toBe("Sarah removed Beef chili");
    });

    test("planned, unplanned and moved on the week plan", () => {
        expect(notificationTitle(plan("planned"), CTX)).toBe(
            "Sarah planned Beef chili for tomorrow",
        );
        expect(notificationTitle(plan("unplanned"), CTX)).toBe(
            "Sarah took Beef chili off the plan",
        );
        expect(
            notificationTitle(
                plan("moved", { fromDate: "2026-11-22", fromSlot: "lunch" }),
                CTX,
            ),
        ).toBe("Sarah moved Beef chili to tomorrow");
    });

    test("the day reads as today, tomorrow, a weekday, then a short date", () => {
        const on = (date: string) =>
            notificationTitle(plan("planned", { date }), CTX);
        expect(on("2026-11-22")).toBe("Sarah planned Beef chili for today");
        expect(on("2026-11-23")).toBe("Sarah planned Beef chili for tomorrow");
        expect(on("2026-11-25")).toBe("Sarah planned Beef chili for Wed");
        expect(on("2026-11-28")).toBe("Sarah planned Beef chili for Sat");
        expect(on("2026-11-30")).toBe(
            "Sarah planned Beef chili for Mon 30 Nov",
        );
        expect(on("2026-11-20")).toBe(
            "Sarah planned Beef chili for Fri 20 Nov",
        );
    });

    test("the day is counted in the household's zone", () => {
        // 23:30 UTC on the 22nd is already the 23rd in Kyiv.
        const late = {
            ...CTX,
            now: new Date("2026-11-22T23:30:00.000Z"),
            timezone: "Europe/Kyiv",
        };
        expect(
            notificationTitle(plan("planned", { date: "2026-11-23" }), late),
        ).toBe("Sarah planned Beef chili for today");
    });

    test("a new usual: who added which food", () => {
        expect(
            notificationTitle(
                event(
                    "new_usuals",
                    { foodName: "Eggs", productName: "Large Eggs" },
                    { subjectKind: "food", subjectId: "f-eggs" },
                ),
                CTX,
            ),
        ).toBe("Sarah added Eggs to the usuals");
    });

    test("a missing, unknown or removed actor reads Someone", () => {
        const payload = { recipeName: "Beef chili" };
        expect(
            notificationTitle(
                event("recipe_changes", payload, { actorUserId: null }),
                CTX,
            ),
        ).toBe("Someone removed Beef chili");
        expect(
            notificationTitle(
                event("recipe_changes", payload, { actorUserId: "u-gone" }),
                CTX,
            ),
        ).toBe("Someone removed Beef chili");
        expect(
            notificationTitle(event("recipe_changes", payload), {
                now: NOW,
                timezone: "UTC",
            }),
        ).toBe("Someone removed Beef chili");
    });

    test("a payload missing a field falls back to the kind's name, never undefined or null", () => {
        const titles = [
            notificationTitle(event("recipe_changes", {}), CTX),
            notificationTitle(
                event("recipe_changes", { recipeName: null }),
                CTX,
            ),
            notificationTitle(event("new_usuals", { productName: "x" }), CTX),
            notificationTitle(plan("planned", { recipeName: null }), CTX),
            notificationTitle(plan("planned", { date: undefined }), CTX),
            notificationTitle(plan("planned", { date: "not a date" }), CTX),
            notificationTitle(plan("moved", { date: null }), CTX),
            notificationTitle(plan("sideways"), CTX),
            notificationTitle(plan(""), CTX),
        ];
        expect(titles).toEqual([
            "Recipe changes by others",
            "Recipe changes by others",
            "New usual products",
            "Week plan changes",
            "Week plan changes",
            "Week plan changes",
            "Week plan changes",
            "Week plan changes",
            "Week plan changes",
        ]);
        for (const title of titles) {
            expect(title).not.toMatch(/undefined|null/);
        }
    });

    test("unplanned needs no date", () => {
        expect(
            notificationTitle(plan("unplanned", { date: undefined }), CTX),
        ).toBe("Sarah took Beef chili off the plan");
    });

    test("names are escaped in the page, the actor's too", () => {
        const html = renderNotificationsBody(
            view(
                {
                    today: [
                        event("recipe_changes", {
                            recipeName: "<img src=x onerror=alert(1)>",
                        }),
                    ],
                },
                { memberNames: new Map([["u-sarah", "<b>Sarah</b>"]]) },
            ),
        );
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain("<b>Sarah</b>");
        expect(html).toContain(
            "&lt;b&gt;Sarah&lt;/b&gt; removed &lt;img src=x onerror=alert(1)&gt;",
        );
    });

    test("the row says who in its title and how long ago in its subtitle", () => {
        const html = renderNotificationsBody(
            view(
                {
                    today: [
                        event(
                            "recipe_changes",
                            { recipeName: "Beef chili" },
                            { createdAt: "2026-11-22T10:00:00.000Z" },
                        ),
                    ],
                },
                { memberNames: CTX.memberNames },
            ),
        );
        expect(html).toContain("Sarah removed Beef chili");
        expect(html).toContain("2 h ago · Recipes · Household");
    });

    test("how long ago", () => {
        const ago = (iso: string) => agoText(iso, NOW, "UTC");
        expect(ago("2026-11-22T11:59:40.000Z")).toBe("just now");
        expect(ago("2026-11-22T11:48:00.000Z")).toBe("12 min ago");
        expect(ago("2026-11-22T10:00:00.000Z")).toBe("2 h ago");
        expect(ago("2026-11-21T08:00:00.000Z")).toBe("yesterday");
        expect(ago("2026-11-19T08:00:00.000Z")).toBe("3 days ago");
        expect(ago("2026-11-10T08:00:00.000Z")).toBe("10 Nov");
    });

    test("Open goes to what the event is about", () => {
        expect(
            notificationOpenHref(event("recipe_changes", { recipeName: "x" })),
        ).toBe("/recipes");
        expect(notificationOpenHref(plan("planned"))).toBe("/recipes");
        expect(
            notificationOpenHref(
                event(
                    "new_usuals",
                    { foodName: "Eggs" },
                    { subjectKind: "food", subjectId: "f-eggs" },
                ),
            ),
        ).toBe("/kitchen/usuals");
    });
});

describe("snooze text", () => {
    test("when a snooze ends is told in the household's zone", () => {
        expect(backAtText("2026-11-22T17:30:00.000Z", NOW, "UTC")).toBe(
            "today 17:30",
        );
        expect(backAtText("2026-11-23T09:00:00.000Z", NOW, "UTC")).toBe(
            "tomorrow 9:00",
        );
        expect(backAtText("2026-11-29T12:00:00.000Z", NOW, "UTC")).toBe(
            "Sun 29 Nov 12:00",
        );
        // 09:00 UTC is 04:00 in New York, still the next local day.
        expect(
            backAtText("2026-11-23T09:00:00.000Z", NOW, "America/New_York"),
        ).toBe("tomorrow 4:00");
    });
});

describe("the filter's address", () => {
    test("All has none; an unknown value is All", () => {
        expect(inboxHref("all")).toBe("/notifications");
        expect(inboxHref("personal")).toBe("/notifications?bucket=personal");
        expect(parseInboxBucket("household")).toBe("household");
        expect(parseInboxBucket("x")).toBe("all");
        expect(parseInboxBucket(undefined)).toBe("all");
    });
    test("the filter is never prefetched, so a click marks what it shows read", () => {
        const html = renderNotificationsBody(view());
        expect(html).toMatch(
            /<nav class="fd-segmented[^"]*fd-notifications__filter"[^>]*data-turbo-prefetch="false"/,
        );
    });
});

describe("spacing", () => {
    test("desktop sets 32 px under the filter and 24 px between sections; the phone keeps 12", async () => {
        const css = await Bun.file("public/app/v2/layout.css").text();
        const base = css.match(
            /\.fd-notifications \.fd-page-layout__content,[^{]*\{\s*gap: var\(--space-md\);/,
        );
        expect(base).not.toBeNull();
        const desktop = css.match(
            /@media \(min-width: 1024px\) \{\s*\.fd-notifications \.fd-page-layout__content \{\s*gap: var\(--space-2xl\);\s*\}\s*[^}]*\.fd-notifications__filter \{\s*margin-bottom: var\(--space-sm\);/,
        );
        expect(desktop).not.toBeNull();
    });
});
