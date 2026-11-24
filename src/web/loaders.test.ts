import { afterEach, expect, spyOn, test } from "bun:test";
import { liveFoodsStore } from "../db/foods.js";
import { liveGroceryStore } from "../db/grocery.js";
import { liveNoticeDismissalsStore } from "../db/notice-dismissals.js";
import {
    liveNoticesForDeps,
    liveNotificationsStore,
} from "../db/notifications.js";
import { householdClock } from "../db/restock.js";
import { liveRulesStore } from "../db/rules.js";
import { liveSettingsStore } from "../db/settings.js";
import { setSqlForTests } from "../db/sql.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedGroceryStore,
    seedGrocerySection,
    seedHousehold,
    seedMember,
} from "../db/testing/fixtures.js";
import { describeDb } from "../db/testing/pg.js";
import { findPgBin } from "../db/testing/pg-temp.js";
import { addGroceryFoodById } from "../domain/grocery.js";
import { dismissalKey } from "../domain/notice-dismissals.js";
import { noticesFor } from "../domain/notices-for.js";
import { addAllergen } from "../domain/rules.js";
import { shiftLocalDate } from "../domain/tz.js";
import type { HouseholdMember } from "../household.js";
import { loadViewerNotices } from "./attention.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    ownerFirst,
} from "./loaders.js";

const pgAvailable = await findPgBin();

test("create-household form posts name fields and has no widgets", () => {
    const html = createHouseholdFormHtml();
    expect(html).toContain('action="/create-household"');
    expect(html).toContain('name="household_name"');
    expect(html).toContain('name="display_name"');
    expect(html).toContain("<h1>Create household</h1>");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="/logout"');
    expect(html).toContain('data-turbo="false"');
});

test("bare pages use the app stylesheet, not the deleted marketing one", () => {
    const html = createHouseholdFormHtml("Enter a household name.");
    expect(html).toMatch(
        /<link rel="stylesheet" href="\/app\.css\?v=[a-f0-9]{12}" data-turbo-track="reload" \/>/,
    );
    expect(html).toMatch(
        /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
    );
    expect(html).not.toContain("/styles.css");
    expect(html).not.toContain("<style>");
    expect(html).toContain('<main class="app-main native">');
    expect(html).toContain(
        '<form method="POST" action="/create-household" class="create-household panel">',
    );
    expect(html).toContain(
        '<button type="submit" class="btn-primary">Create household</button>',
    );
    expect(html).toContain('class="app-bar-logo"');
    expect(html).toContain('aria-label="Log out"');
    expect(html).toContain('class="error-banner"');
    expect(html).not.toContain('class="logout"');
    expect(html).not.toContain("bottom-nav");
});

test("bare pages stamp data-theme when preview asks, and always show the top bar", () => {
    const light = createHouseholdFormHtml(undefined, "light");
    const dark = createHouseholdFormHtml(undefined, "dark");
    expect(light).toContain('data-theme="light"');
    expect(dark).toContain('data-theme="dark"');
    expect(light).not.toBe(dark);
    const forbidden = forbiddenDashboardHtml("light");
    expect(forbidden).toContain('<header class="app-bar">');
    expect(forbidden).toContain('data-theme="light"');
    expect(forbidden).toContain('class="empty"');
    expect(forbidden).not.toContain("bottom-nav");
});

describeDb(
    pgAvailable !== null,
    "a page load syncs stored notifications",
    (getCtx) => {
        afterEach(() => setSqlForTests(null));

        type Household = {
            householdId: string;
            owner: HouseholdMember;
            memberId: string;
            itemId: string;
        };

        // An owner and a member; Milk in the fridge expiring in two days; the
        // member's last weigh-in ten days ago.
        async function seedScene(): Promise<Household> {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId, userId } = await seedHousehold(sql);
            const memberId = await seedMember(sql, householdId, {
                displayName: "Mia",
            });
            const foodId = await seedFood(sql, householdId, { name: "Milk" });
            const locationId = await seedFridgeLocation(sql, householdId);
            const itemId = await seedFridgeItem(
                sql,
                householdId,
                locationId,
                foodId,
                { displayName: "Milk", amount: 1, unit: "l" },
            );
            const { today } = await householdClock(householdId);
            await sql`
            update public.fridge_items
            set expires_on = ${shiftLocalDate(today, 2)}
            where id = ${itemId}::uuid
        `;
            await sql`
            insert into public.weight_log (user_id, weight_g, logged_at)
            values (${memberId}::uuid, ${80_000}, now() - interval '10 days')
        `;
            return {
                householdId,
                owner: {
                    householdId,
                    userId,
                    role: "owner",
                    displayName: "Owner",
                },
                memberId,
                itemId,
            };
        }

        // What the pages showed before notifications were stored: the household's
        // notices with its dismissals applied, read on their own.
        async function shownBefore(householdId: string) {
            const { today, timezone } = await householdClock(householdId);
            return noticesFor(liveNoticesForDeps(), householdId, {
                today,
                timezone,
                actionable: true,
            });
        }

        const openRows = async (householdId: string) =>
            (
                await liveNotificationsStore().listOpenConditions(householdId)
            ).sort(
                (a, b) =>
                    a.kind.localeCompare(b.kind) ||
                    a.recipientUserId.localeCompare(b.recipientUserId),
            );

        test("a page load writes a row for each condition and member, Weigh-in due included", async () => {
            const hh = await seedScene();
            expect(await openRows(hh.householdId)).toEqual([]);
            const result = await loadViewerNotices(hh.owner);
            const rows = await openRows(hh.householdId);
            expect(
                rows
                    .map((r) => [r.kind, r.recipientUserId, r.subjectId])
                    .sort(),
            ).toEqual(
                [
                    ["food_expiring", hh.owner.userId, hh.itemId],
                    ["food_expiring", hh.memberId, hh.itemId],
                    ["weigh_in_due", hh.memberId, hh.memberId],
                ].sort(),
            );
            // The page still gets the notices themselves.
            expect(result.notices.map((n) => n.code).sort()).toEqual([
                "fridge.expiring",
                "nutrition.weigh_in_due",
            ]);
        });

        test("the notices a page shows are what it showed before, and one the household dismissed stays hidden", async () => {
            const hh = await seedScene();
            const first = await loadViewerNotices(hh.owner);
            expect(first.notices).toEqual(
                (await shownBefore(hh.householdId)).notices,
            );
            // The household dismisses the expiring item for everyone.
            const expiring = first.notices.find(
                (n) => n.code === "fridge.expiring",
            )!;
            await liveNoticeDismissalsStore().insert({
                householdId: hh.householdId,
                ...dismissalKey(expiring),
                dismissedBy: hh.owner.userId,
            });
            const before = await shownBefore(hh.householdId);
            expect(before.notices.map((n) => n.code)).toEqual([
                "nutrition.weigh_in_due",
            ]);
            for (let i = 0; i < 3; i++) {
                const shown = await loadViewerNotices(hh.owner);
                expect(shown.notices).toEqual(before.notices);
                expect(shown.dismissals).toEqual(before.dismissals);
            }
            // Its rows are still there, one open row each, for the day it clears.
            const expiringRows = (await openRows(hh.householdId)).filter(
                (r) => r.kind === "food_expiring",
            );
            expect(expiringRows).toHaveLength(2);
            expect(expiringRows.every((r) => r.dismissedAt === null)).toBe(
                true,
            );
        });

        // The scene, with Peanut butter on the list and the owner allergic.
        async function seedPeanutConflict() {
            const hh = await seedScene();
            const { sql } = getCtx();
            await addAllergen(liveRulesStore(), {
                householdId: hh.householdId,
                userId: hh.owner.userId,
                allergen: "peanut",
            });
            const foodId = await seedFood(sql, hh.householdId, {
                name: "Peanut butter",
            });
            await sql`
                update public.foods
                set allergens = ${sql.array(["peanut"], "text")}
                where id = ${foodId}::uuid
            `;
            const storeId = await seedGroceryStore(sql, hh.householdId);
            const line = await addGroceryFoodById(
                liveGroceryStore(),
                liveSettingsStore(),
                liveFoodsStore(),
                {
                    householdId: hh.householdId,
                    storeId,
                    sectionId: await seedGrocerySection(
                        sql,
                        hh.householdId,
                        storeId,
                    ),
                    foodId,
                    amount: 1,
                    unit: "g",
                },
            );
            return { hh, lineId: line.id };
        }

        const allergenRows = async (householdId: string) =>
            (await openRows(householdId)).filter((r) => r.kind === "allergens");

        test("a page files the Allergens conditions from its own read and still shows what it showed before", async () => {
            const { hh, lineId } = await seedPeanutConflict();
            const before = await shownBefore(hh.householdId);
            for (let i = 0; i < 2; i++) {
                const shown = await loadViewerNotices(hh.owner);
                // The page shows no allergen notice: the list shows that one.
                expect(
                    shown.notices.some((n) => n.code.endsWith("allergen")),
                ).toBe(false);
                expect(shown.notices).toEqual(before.notices);
                expect(shown.dismissals).toEqual(before.dismissals);
                expect(shown.subjectNames).toEqual(before.subjectNames);
                // The row is filed from that one read, and stays on every load.
                const allergens = await allergenRows(hh.householdId);
                expect(allergens.map((r) => r.noticeKey)).toEqual([
                    `grocery.allergen|grocery_line|${lineId}|`,
                    `grocery.allergen|grocery_line|${lineId}|`,
                ]);
                expect(allergens.map((r) => r.recipientUserId).sort()).toEqual(
                    [hh.owner.userId, hh.memberId].sort(),
                );
            }
        });

        test("an allergen read that fails neither breaks the page nor resolves the stored rows", async () => {
            const { hh } = await seedPeanutConflict();
            const { sql } = getCtx();
            await loadViewerNotices(hh.owner);
            const filed = await allergenRows(hh.householdId);
            expect(filed).toHaveLength(2);
            const logged = spyOn(console, "error").mockImplementation(() => {});
            await sql`alter table public.member_allergens rename to member_allergens_away`;
            try {
                const shown = await loadViewerNotices(hh.owner);
                expect(shown.notices).toEqual(
                    (await shownBefore(hh.householdId)).notices,
                );
                expect(
                    logged.mock.calls.filter((call) =>
                        String(call[0]).includes("allergen read failed"),
                    ),
                ).toHaveLength(1);
            } finally {
                logged.mockRestore();
                await sql`alter table public.member_allergens_away rename to member_allergens`;
            }
            // Not read as "no one is allergic": the rows are as they were.
            expect(await allergenRows(hh.householdId)).toEqual(filed);
        });

        test("a condition that clears resolves its rows on the next load", async () => {
            const hh = await seedScene();
            const { sql } = getCtx();
            await loadViewerNotices(hh.owner);
            await sql`delete from public.fridge_items where id = ${hh.itemId}::uuid`;
            await loadViewerNotices(hh.owner);
            expect((await openRows(hh.householdId)).map((r) => r.kind)).toEqual(
                ["weigh_in_due"],
            );
        });

        test("a failing sync is logged and the page still gets its notices", async () => {
            const hh = await seedScene();
            const { sql } = getCtx();
            const logged = spyOn(console, "error").mockImplementation(() => {});
            // Take the table away: the sync cannot read or write.
            await sql`alter table public.notifications rename to notifications_away`;
            try {
                const shown = await loadViewerNotices(hh.owner);
                expect(shown.notices).toEqual(
                    (await shownBefore(hh.householdId)).notices,
                );
                expect(logged).toHaveBeenCalledTimes(1);
                expect(String(logged.mock.calls[0]?.[0])).toContain(
                    "[notifications]",
                );
            } finally {
                logged.mockRestore();
                await sql`alter table public.notifications_away rename to notifications`;
            }
        });
    },
);

test("ownerFirst puts the owner first and keeps the others in their order", () => {
    const people = [
        { name: "Adele", role: "admin" },
        { name: "Bob", role: "member" },
        { name: "Zed", role: "owner" },
        { name: "Cara", role: "member" },
    ];
    expect(ownerFirst(people).map((p) => p.name)).toEqual([
        "Zed",
        "Adele",
        "Bob",
        "Cara",
    ]);
    // Nothing is dropped or reordered when there is no owner in the list.
    expect(ownerFirst(people.slice(0, 2)).map((p) => p.name)).toEqual([
        "Adele",
        "Bob",
    ]);
    expect(people.map((p) => p.name)).toEqual(["Adele", "Bob", "Zed", "Cara"]);
});
