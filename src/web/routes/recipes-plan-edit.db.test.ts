// The planned-meal edit sheet's Save (POST /recipes/plan/:planId/move) against
// real Postgres: the recipe and repeat it now takes, one day of a series
// against the series from that day on, and a refusal leaving the series as it was.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { Hono } from "hono";
import { liveRecipePlansStore } from "../../db/plans.js";
import { householdToday } from "../../db/restock.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { ruleEntryId } from "../../domain/plan.js";
import { addPlanDays } from "../../domain/plan-week.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import {
    decodeToastFlash,
    readToastCookie,
    TOAST_COOKIE,
} from "../components/toast.js";
import { recipesRoutes } from "./recipes.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "edit a planned meal in the app", (getCtx) => {
    let sql: SQL;
    let me: { userId: string; householdId: string };
    let soup: string;
    let stew: string;
    let today: string;

    const app = () => new Hono().route("/", recipesRoutes);

    async function recipe(name: string): Promise<string> {
        const id = crypto.randomUUID();
        await sql`
            insert into public.recipes (
                id, household_id, creator_id, name, yield_portions
            )
            values (${id}, ${me.householdId}, ${me.userId}, ${name}, ${2})
        `;
        return id;
    }

    const as = <T>(fn: () => Promise<T>) =>
        asUser(me.userId, fn, me.householdId);

    beforeEach(async () => {
        const ctx = getCtx();
        sql = ctx.sql;
        await ctx.truncateAll();
        setSqlForTests(sql);
        me = await seedHousehold(sql);
        soup = await recipe("Soup");
        stew = await recipe("Stew");
        today = await as(() => householdToday(me.householdId));
    });

    afterEach(() => setSqlForTests(null));

    const day = (n: number) => addPlanDays(today, n);

    function post(planId: string, fields: Record<string, string | string[]>) {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(fields)) {
            for (const one of Array.isArray(value) ? value : [value]) {
                body.append(key, one);
            }
        }
        return app().request(`http://test/recipes/plan/${planId}/move`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(me.userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });
    }

    const week = () =>
        as(() =>
            liveRecipePlansStore().listPlans(me.householdId, today, day(9)),
        );

    /** Every plan row and repeat as stored, without the bookkeeping column. */
    async function stored(): Promise<string> {
        const rows = await sql`
            select kind, j from (
                select 'plan' as kind, to_jsonb(p) - 'updated_at' as j
                from public.recipe_plans p
                union all
                select 'rule', to_jsonb(r) - 'updated_at'
                from public.plan_rules r
            ) t
            order by kind, j::text
        `;
        return JSON.stringify(rows);
    }

    async function dailySoup(): Promise<string> {
        const first = await as(() =>
            liveRecipePlansStore().addRule({
                householdId: me.householdId,
                recipeId: soup,
                slot: "dinner",
                servings: 2,
                startsOn: today,
                repeat: "daily",
            }),
        );
        return first!.id;
    }

    test("a new recipe on a one-off replaces it with the same day, meal and servings", async () => {
        const one = await as(() =>
            liveRecipePlansStore().addPlan({
                householdId: me.householdId,
                recipeId: soup,
                date: day(1),
                slot: "dinner",
                servings: 3,
            }),
        );
        const res = await post(one!.id, {
            recipe_id: stew,
            date: day(1),
            slot: "dinner",
            servings: "3",
            repeat: "once",
            back: "today",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(await week()).toMatchObject([
            { recipeId: stew, date: day(1), slot: "dinner", servings: 3 },
        ]);
    });

    test("a repeat changed on a day of a series ends the old series before it and starts the new one there, leaving the days before", async () => {
        const ruleId = await dailySoup();
        const res = await post(ruleEntryId(ruleId, day(3)), {
            recipe_id: soup,
            date: day(3),
            slot: "dinner",
            servings: "2",
            repeat: "weekly",
            back: "recipes",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        const old = await sql`
            select ends_on::text as ends_on from public.plan_rules where id = ${ruleId}
        `;
        expect(old[0]).toEqual({ ends_on: day(2) });
        const [created] = await sql`
            select id, rule, starts_on::text as starts_on, ends_on::text as ends_on
            from public.plan_rules where id <> ${ruleId}
        `;
        expect(created).toMatchObject({
            rule: "weekly",
            starts_on: day(3),
            ends_on: null,
        });
        const dates = (await week()).map((p) => [p.date, p.ruleId]);
        // day(10) is the new series' next Thursday-alike, past this window.
        expect(dates).toEqual([
            [day(0), ruleId],
            [day(1), ruleId],
            [day(2), ruleId],
            [day(3), created!.id],
        ]);
    });

    test("a repeat changed on the series' first day removes the old series: no repeat is left that can never show a day", async () => {
        const ruleId = await dailySoup();
        const res = await post(ruleEntryId(ruleId, day(0)), {
            recipe_id: soup,
            date: day(0),
            slot: "dinner",
            servings: "2",
            repeat: "weekly",
            back: "today",
        });
        expect(res.status).toBe(303);
        const left = await sql`
            select id, rule, starts_on::text as starts_on, ends_on::text as ends_on
            from public.plan_rules
        `;
        expect(left).toHaveLength(1);
        expect(left[0]).toMatchObject({
            rule: "weekly",
            starts_on: day(0),
            ends_on: null,
        });
        expect(left[0]!.id).not.toBe(ruleId);
        expect((await week()).map((p) => p.date)).toEqual([day(0), day(7)]);
    });

    test("Once with an earlier Day ends the series before the edited day and leaves the days between it and the new day", async () => {
        const ruleId = await dailySoup();
        const res = await post(ruleEntryId(ruleId, day(3)), {
            recipe_id: soup,
            date: day(1),
            slot: "lunch",
            servings: "2",
            repeat: "once",
            back: "today",
        });
        expect(res.status).toBe(303);
        const [rule] = await sql`
            select ends_on::text as ends_on from public.plan_rules where id = ${ruleId}
        `;
        expect(rule).toEqual({ ends_on: day(2) });
        expect(
            (await week()).map((p) => [p.date, p.slot, p.ruleId ?? null]),
        ).toEqual([
            [day(0), "dinner", ruleId],
            [day(1), "lunch", null],
            [day(1), "dinner", ruleId],
            [day(2), "dinner", ruleId],
        ]);
    });

    test("a pick-days repeat posts its weekdays and starts the series on them", async () => {
        const ruleId = await dailySoup();
        const res = await post(ruleEntryId(ruleId, day(2)), {
            recipe_id: soup,
            date: day(2),
            slot: "dinner",
            servings: "2",
            repeat: "days",
            days: ["1", "4"],
            back: "recipes",
        });
        expect(res.status).toBe(303);
        const [created] = await sql`
            select rule, days::int[] as days from public.plan_rules
            where id <> ${ruleId}
        `;
        expect(created).toEqual({ rule: "days", days: [1, 4] });
    });

    test("one day of a series changed with the repeat as it is leaves the series and changes that day only", async () => {
        const ruleId = await dailySoup();
        const res = await post(ruleEntryId(ruleId, day(2)), {
            recipe_id: stew,
            date: day(2),
            slot: "dinner",
            servings: "2",
            repeat: "daily",
            back: "today",
        });
        expect(res.status).toBe(303);
        const entries = await week();
        // The day left the series: a one-off of Stew stands where it was.
        expect(
            entries
                .filter((p) => p.date === day(2))
                .map((p) => [p.recipeId, p.ruleId ?? null]),
        ).toEqual([[stew, null]]);
        expect(
            entries.filter((p) => p.date === day(3)).map((p) => p.ruleId),
        ).toEqual([ruleId]);
    });

    test("a form that is saved as it was writes nothing", async () => {
        const ruleId = await dailySoup();
        await as(() =>
            liveRecipePlansStore().endRuleBefore(
                me.householdId,
                ruleId,
                day(8),
            ),
        );
        const before = await stored();
        const res = await post(ruleEntryId(ruleId, day(2)), {
            recipe_id: soup,
            date: day(2),
            slot: "dinner",
            servings: "2",
            repeat: "daily",
            back: "recipes",
        });
        expect(res.status).toBe(303);
        expect(await stored()).toBe(before);
    });

    test("a one-off given a repeat is deleted and its day is the first day of the new series", async () => {
        const one = await as(() =>
            liveRecipePlansStore().addPlan({
                householdId: me.householdId,
                recipeId: soup,
                date: day(1),
                slot: "dinner",
                servings: 3,
            }),
        );
        const res = await post(one!.id, {
            recipe_id: soup,
            date: day(1),
            slot: "dinner",
            servings: "3",
            repeat: "weekly",
            back: "today",
        });
        expect(res.status).toBe(303);
        const plans = await sql`select id from public.recipe_plans`;
        expect(plans).toEqual([]);
        const [rule] = await sql`
            select id, rule, servings::float as servings from public.plan_rules
        `;
        expect(rule).toMatchObject({ rule: "weekly", servings: 3 });
        expect((await week()).map((p) => p.id)).toEqual([
            ruleEntryId(rule!.id as string, day(1)),
            ruleEntryId(rule!.id as string, day(8)),
        ]);
    });

    test("a clash with another repeat is refused in the sheet and leaves both series as they were", async () => {
        const ruleId = await dailySoup();
        // Stew already repeats every day at dinner: Soup's day cannot become Stew weekly.
        await as(() =>
            liveRecipePlansStore().addRule({
                householdId: me.householdId,
                recipeId: stew,
                slot: "lunch",
                startsOn: today,
                repeat: "daily",
            }),
        );
        const before = await stored();
        const res = await post(ruleEntryId(ruleId, day(2)), {
            recipe_id: stew,
            date: day(2),
            slot: "lunch",
            servings: "2",
            repeat: "weekly",
            back: "recipes",
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Stew is already planned at lunch");
        expect(html).toContain(
            `id="fd-plan-edit-${ruleEntryId(ruleId, day(2))}"`,
        );
        expect(await stored()).toBe(before);
    });

    test("a past day, a recipe that is not the household's and a repeat with no weekdays are refused with the sheet open and nothing written", async () => {
        const one = await as(() =>
            liveRecipePlansStore().addPlan({
                householdId: me.householdId,
                recipeId: soup,
                date: day(1),
                slot: "dinner",
            }),
        );
        const before = await stored();
        for (const [fields, message] of [
            [{ date: day(-1) }, "Pick today or a later day."],
            [
                { recipe_id: crypto.randomUUID() },
                "That recipe is not in the household.",
            ],
            [{ recipe_id: "nope" }, "Pick a recipe from the list."],
            [{ repeat: "days" }, "Pick at least one weekday"],
        ] as const) {
            const form: Record<string, string> = {
                recipe_id: soup,
                date: day(1),
                slot: "dinner",
                servings: "1",
                repeat: "once",
                back: "recipes",
            };
            Object.assign(form, fields);
            const res = await post(one!.id, form);
            expect(res.status, message).toBe(400);
            expect(await res.text(), message).toContain(message);
            expect(await stored()).toBe(before);
        }
    });

    test("a repeat changed, or Once, from a day that has passed is refused in a toast, since that day has no sheet: the series and the days before today stay", async () => {
        const started = await as(() =>
            liveRecipePlansStore().addRule({
                householdId: me.householdId,
                recipeId: soup,
                slot: "dinner",
                servings: 2,
                startsOn: day(-6),
                repeat: "daily",
            }),
        );
        const ruleId = started!.id;
        const pastDays = () =>
            as(() =>
                liveRecipePlansStore().listPlans(
                    me.householdId,
                    day(-6),
                    day(-1),
                ),
            );
        expect(await pastDays()).toHaveLength(6);
        const before = await stored();
        for (const fields of [
            { date: day(2), repeat: "weekly" },
            { date: day(-4), repeat: "weekly" },
            { date: day(2), repeat: "once" },
            { date: today, repeat: "once" },
        ]) {
            const res = await post(ruleEntryId(ruleId, day(-4)), {
                recipe_id: soup,
                slot: "dinner",
                servings: "2",
                back: "recipes",
                ...fields,
            });
            // a day before today has no sheet to re-open: the reason is a toast
            expect(res.status, JSON.stringify(fields)).toBe(303);
            const cookie = res.headers
                .getSetCookie()
                .map((h) => h.split(";")[0] ?? "")
                .find((h) => h.startsWith(`${TOAST_COOKIE}=`));
            expect(
                decodeToastFlash(readToastCookie(cookie ?? "") ?? ""),
                JSON.stringify(fields),
            ).toEqual({
                key: "plan.notice",
                params: {
                    message:
                        "That day has passed. Change the repeat from today or a later day.",
                },
            });
            expect(await pastDays()).toHaveLength(6);
            expect(await stored()).toBe(before);
        }
        // Today's day of the same series still takes a new repeat, and the six
        // days before it stay on the old series.
        const res = await post(ruleEntryId(ruleId, today), {
            recipe_id: soup,
            date: today,
            slot: "dinner",
            servings: "2",
            repeat: "weekly",
            back: "recipes",
        });
        expect(res.status).toBe(303);
        expect(await pastDays()).toHaveLength(6);
        const [old] = await sql`
            select ends_on::text as ends_on from public.plan_rules
            where id = ${ruleId}
        `;
        expect(old).toEqual({ ends_on: day(-1) });
    });

    test("a form from before the Recipe and Repeat rows changes the day, meal and servings as it did", async () => {
        const ruleId = await dailySoup();
        const res = await post(ruleEntryId(ruleId, day(2)), {
            date: day(4),
            slot: "lunch",
            servings: "5",
            back: "recipes",
        });
        expect(res.status).toBe(303);
        const entries = await week();
        expect(
            entries.find((p) => p.date === day(4) && p.slot === "lunch"),
        ).toMatchObject({ servings: 5, recipeId: soup });
        expect(
            entries.some((p) => p.date === day(2) && p.slot === "dinner"),
        ).toBe(false);
        const [rule] = await sql`
            select skipped_on::text[] as skipped_on, ends_on::text as ends_on
            from public.plan_rules where id = ${ruleId}
        `;
        expect(rule).toEqual({ skipped_on: [day(2)], ends_on: null });
    });

    // A weekly series from today whose day(7) was taken off, edited from today's entry.
    async function weeklyWithSkippedDay(): Promise<string> {
        const rule = await as(() =>
            liveRecipePlansStore().addRule({
                householdId: me.householdId,
                recipeId: soup,
                slot: "dinner",
                servings: 2,
                startsOn: today,
                repeat: "weekly",
            }),
        );
        await as(() =>
            liveRecipePlansStore().removePlan(
                me.householdId,
                ruleEntryId(rule!.id, day(7)),
            ),
        );
        // and a later skip, which the new series keeps
        await as(() =>
            liveRecipePlansStore().removePlan(
                me.householdId,
                ruleEntryId(rule!.id, day(14)),
            ),
        );
        return rule!.id;
    }

    test("the Day picked with a repeat change is a skipped day of the old series: the new series starts there and shows it, keeping the later skips", async () => {
        const ruleId = await weeklyWithSkippedDay();
        const res = await post(ruleEntryId(ruleId, today), {
            recipe_id: soup,
            date: day(7),
            slot: "dinner",
            servings: "2",
            repeat: "daily",
            back: "today",
        });
        expect(res.status).toBe(303);
        const entries = await as(() =>
            liveRecipePlansStore().listPlans(me.householdId, today, day(16)),
        );
        const dates = entries.map((p) => p.date);
        expect(dates.filter((d) => d === day(7))).toHaveLength(1);
        expect(dates).not.toContain(day(14));
        expect(dates).toContain(day(8));
        const [created] = await sql`
            select starts_on::text as starts_on, ends_on::text as ends_on,
                   skipped_on::text[] as skipped_on
            from public.plan_rules where id <> ${ruleId}
        `;
        expect(created).toEqual({
            starts_on: day(7),
            ends_on: null,
            skipped_on: [day(14)],
        });
    });

    test("a Day moved earlier onto a skipped day of the series is planned there, and the days before it stay", async () => {
        const ruleId = await weeklyWithSkippedDay();
        const res = await post(ruleEntryId(ruleId, day(21)), {
            recipe_id: soup,
            date: day(7),
            slot: "dinner",
            servings: "2",
            repeat: "daily",
            back: "today",
        });
        expect(res.status).toBe(303);
        const dates = (
            await as(() =>
                liveRecipePlansStore().listPlans(
                    me.householdId,
                    today,
                    day(16),
                ),
            )
        ).map((p) => p.date);
        expect(dates.filter((d) => d === today)).toHaveLength(1);
        expect(dates.filter((d) => d === day(7))).toHaveLength(1);
        expect(dates).not.toContain(day(14));
        const [old] = await sql`
            select ends_on::text as ends_on from public.plan_rules
            where id = ${ruleId}
        `;
        expect(old).toEqual({ ends_on: day(6) });
        const [created] = await sql`
            select starts_on::text as starts_on, skipped_on::text[] as skipped_on
            from public.plan_rules where id <> ${ruleId}
        `;
        expect(created).toEqual({
            starts_on: day(7),
            skipped_on: [day(14)],
        });
    });

    test("an old series that also ends on the skipped Day picked is not refused: that day is planned", async () => {
        const ruleId = await weeklyWithSkippedDay();
        await as(() =>
            liveRecipePlansStore().endRuleBefore(
                me.householdId,
                ruleId,
                day(8),
            ),
        );
        const res = await post(ruleEntryId(ruleId, today), {
            recipe_id: soup,
            date: day(7),
            slot: "dinner",
            servings: "2",
            repeat: "daily",
            back: "today",
        });
        expect(res.status).toBe(303);
        expect(
            (await week())
                .filter((p) => p.date >= day(7))
                .map((p) => [p.date, p.slot]),
        ).toEqual([[day(7), "dinner"]]);
        const [created] = await sql`
            select starts_on::text as starts_on, ends_on::text as ends_on,
                   skipped_on::text[] as skipped_on
            from public.plan_rules where id <> ${ruleId}
        `;
        expect(created).toMatchObject({
            starts_on: day(7),
            ends_on: day(7),
        });
        expect(created!.skipped_on).not.toContain(day(7));
    });

    test("a Day that already holds a one-off of the same recipe and meal (a moved day) is planned once — passes before: the one-off already held the day", async () => {
        const ruleId = await weeklyWithSkippedDay();
        // a one-off of the same recipe and meal stands on the skipped day
        const one = await as(() =>
            liveRecipePlansStore().addPlan({
                householdId: me.householdId,
                recipeId: soup,
                date: day(7),
                slot: "dinner",
                servings: 3,
            }),
        );
        const res = await post(ruleEntryId(ruleId, today), {
            recipe_id: soup,
            date: day(7),
            slot: "dinner",
            servings: "2",
            repeat: "daily",
            back: "today",
        });
        expect(res.status).toBe(303);
        const there = (await week()).filter(
            (p) => p.date === day(7) && p.slot === "dinner",
        );
        expect(there.map((p) => [p.id, p.servings])).toEqual([[one!.id, 3]]);
        expect((await week()).some((p) => p.date === day(8) && p.ruleId)).toBe(
            true,
        );
    });
});
