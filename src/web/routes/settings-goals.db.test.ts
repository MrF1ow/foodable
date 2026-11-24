import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { getNutritionGoals, upsertNutritionGoals } from "../../db/nutrition.js";
import { upsertProfile } from "../../db/profiles.js";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold, seedMember } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", settingsRoutes);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function postField(userId: string, field: string, value: string) {
    return app.request("http://test/settings/goals/field", {
        method: "POST",
        headers: {
            cookie: cookie(userId),
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ field, value }).toString(),
    });
}

function getPage(userId: string) {
    return app.request("http://test/settings/goals", {
        headers: { cookie: cookie(userId) },
    });
}

describeDb(pgAvailable !== null, "settings goals fields", (getCtx) => {
    let userId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId } = await seedHousehold(sql));
        await upsertNutritionGoals(userId, {
            goal_name: "Recomp",
            daily_calories: 2200,
            daily_protein_g: 140,
            daily_carbs_g: 200,
            daily_fat_g: 70,
            daily_water_ml: 2500,
            goals_set_on: "2026-10-02",
        });
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("POST /settings/goals/field daily_protein_g 180 answers 303 and keeps the other fields", async () => {
        const res = await postField(userId, "daily_protein_g", "180");
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/goals");
        const goals = await getNutritionGoals(userId);
        expect(goals).toMatchObject({
            goal_name: "Recomp",
            daily_calories: 2200,
            daily_protein_g: 180,
            daily_carbs_g: 200,
            daily_fat_g: 70,
            daily_water_ml: 2500,
        });
    });

    test("a stored limit the form's bounds refuse does not block saving another field", async () => {
        // 9999.99 g is the MCP maximum; in US drinks it shows as 714.29, one
        // over the form's own bound.
        await upsertProfile(userId, {
            alcohol_tracking_enabled: true,
            preferred_drink_unit: "us",
        });
        await upsertNutritionGoals(userId, { daily_alcohol_g: 9999.99 });
        const res = await postField(userId, "daily_protein_g", "180");
        expect(res.status).toBe(303);
        const goals = await getNutritionGoals(userId);
        expect(goals).toMatchObject({
            daily_protein_g: 180,
            daily_alcohol_g: 9999.99,
            // A protein change is a target change; the left-out alcohol is not.
        });
        // A rename alone still does not stamp the day.
        const before = (await getNutritionGoals(userId))?.goals_set_on;
        expect((await postField(userId, "goal_name", "Cut")).status).toBe(303);
        expect((await getNutritionGoals(userId))?.goals_set_on).toBe(before);
    });

    test("two sequential field posts both survive", async () => {
        expect((await postField(userId, "daily_protein_g", "180")).status).toBe(
            303,
        );
        expect(
            (await postField(userId, "goal_note", "until spring")).status,
        ).toBe(303);
        expect((await postField(userId, "daily_fat_g", "")).status).toBe(303);
        const goals = await getNutritionGoals(userId);
        expect(goals).toMatchObject({
            goal_name: "Recomp",
            goal_note: "until spring",
            daily_calories: 2200,
            daily_protein_g: 180,
            daily_carbs_g: 200,
            daily_fat_g: null,
            daily_water_ml: 2500,
        });
    });

    test("two posts in flight at once both survive", async () => {
        const [a, b] = await Promise.all([
            postField(userId, "daily_protein_g", "181"),
            postField(userId, "daily_carbs_g", "201"),
        ]);
        expect([a.status, b.status]).toEqual([303, 303]);
        const goals = await getNutritionGoals(userId);
        expect(goals).toMatchObject({
            daily_protein_g: 181,
            daily_carbs_g: 201,
        });
    });

    test("an out-of-bounds value answers 422 with the error on that field and the stored value unchanged", async () => {
        const before = await getNutritionGoals(userId);
        const res = await postField(userId, "daily_calories", "99999");
        expect(res.status).toBe(422);
        const html = await res.text();
        expect(html).toContain("Calories must be at most 20000.");
        expect(html).toMatch(
            /name="value" type="text" inputmode="decimal" value="99999"[^>]*aria-invalid="true"/,
        );
        const after = await getNutritionGoals(userId);
        expect(after).toEqual(before);
        // The page itself still shows the stored value.
        const page = await (await getPage(userId)).text();
        expect(page).toContain('value="2,200"');
        expect(page).not.toContain("99999");
    });

    test("a changed target stamps the day, a note does not", async () => {
        await postField(userId, "goal_note", "x");
        expect((await getNutritionGoals(userId))?.goals_set_on).toBe(
            "2026-10-02",
        );
        await postField(userId, "daily_fat_g", "75");
        const stamped = (await getNutritionGoals(userId))?.goals_set_on;
        expect(stamped).not.toBe("2026-10-02");
        expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("an unknown field answers 400 and writes nothing", async () => {
        const before = await getNutritionGoals(userId);
        expect((await postField(userId, "target_weight_g", "70")).status).toBe(
            400,
        );
        expect(await getNutritionGoals(userId)).toEqual(before);
    });

    test("the first goal on an account with none creates the row", async () => {
        const { sql } = getCtx();
        await sql`delete from public.nutrition_goals where user_id = ${userId}`;
        expect((await postField(userId, "goal_name", "x")).status).toBe(422);
        expect(await getNutritionGoals(userId)).toBeNull();
        expect((await postField(userId, "daily_calories", "2000")).status).toBe(
            303,
        );
        expect(await getNutritionGoals(userId)).toMatchObject({
            daily_calories: 2000,
            daily_protein_g: null,
        });
    });

    describe("Clear all goals", () => {
        const clearAll = (who: string) =>
            app.request("http://test/settings/goals/clear-all", {
                method: "POST",
                headers: { cookie: cookie(who) },
            });
        const dayCount = async (who: string) =>
            Number(
                (
                    await getCtx().sql`
                        select count(*)::int as n from public.nutrition_goal_days
                        where user_id = ${who}
                    `
                )[0]!.n,
            );
        async function withDays(who: string, householdId: string) {
            for (const date of ["2020-02-01", "2026-12-01", "2099-01-01"]) {
                await getCtx().sql`
                    insert into public.nutrition_goal_days (
                        household_id, user_id, date, daily_calories
                    ) values (${householdId}, ${who}, ${date}::date, ${2400})
                `;
            }
        }

        for (const role of ["owner", "admin", "member"] as const) {
            test(`${role} clears their own targets, name, note and every override, with a 303 and no toast; another person's goals stay`, async () => {
                const { sql } = getCtx();
                const [row] = await sql`
                    select household_id from public.household_members
                    where user_id = ${userId}
                `;
                const householdId = row!.household_id as string;
                const who =
                    role === "owner"
                        ? userId
                        : await seedMember(sql, householdId, { role });
                const other =
                    role === "owner"
                        ? await seedMember(sql, householdId, { role: "member" })
                        : userId;
                if (who !== userId) {
                    await upsertNutritionGoals(who, {
                        daily_calories: 1900,
                        goal_name: "Mine",
                        goal_note: "note",
                    });
                }
                await withDays(who, householdId);
                await withDays(other, householdId);
                const othersBefore = await getNutritionGoals(other);

                const res = await clearAll(who);
                expect(res.status).toBe(303);
                expect(res.headers.get("location")).toBe("/settings/goals");
                expect(res.headers.get("set-cookie") ?? "").not.toContain(
                    "foodable_toast",
                );
                expect(await dayCount(who)).toBe(0);
                expect(await getNutritionGoals(who)).toMatchObject({
                    daily_calories: null,
                    daily_protein_g: null,
                    daily_carbs_g: null,
                    daily_fat_g: null,
                    daily_water_ml: null,
                    target_weight_g: null,
                    goal_name: null,
                    goal_note: null,
                    goals_set_on: null,
                });
                expect(await dayCount(other)).toBe(3);
                expect(await getNutritionGoals(other)).toEqual(othersBefore);
            });
        }

        test("someone with no household gets the membership refusal and nothing changes", async () => {
            const res = await clearAll(crypto.randomUUID());
            expect(res.status).toBe(403);
            expect((await getNutritionGoals(userId))?.daily_calories).toBe(
                2200,
            );
        });

        test("with no goals stored it answers 303 and does not create a row", async () => {
            const { sql } = getCtx();
            await sql`delete from public.nutrition_goals where user_id = ${userId}`;
            expect((await clearAll(userId)).status).toBe(303);
            expect(await getNutritionGoals(userId)).toBeNull();
        });

        test("the page's header ⋯ holds Clear all goals, confirmed in the menu, posting to the route", async () => {
            const html = await (await getPage(userId)).text();
            expect(html).toContain('aria-label="Goals actions"');
            expect(html).toMatch(
                /data-fd-menu-arm[^>]*>[\s\S]*?Clear all goals/,
            );
            expect(html).toContain('action="/settings/goals/clear-all"');
            expect(html).toContain('aria-label="Confirm Clear all goals"');
        });
    });
});
