import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import {
    seedFood,
    seedHousehold,
    seedMember,
} from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { householdRoutes } from "./household.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", settingsRoutes);
app.route("/", householdRoutes);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function get(userId: string, path = "/settings/saved") {
    return app.request(`http://test${path}`, {
        headers: { cookie: cookie(userId) },
    });
}

function post(userId: string, path: string, fields: [string, string][]) {
    return app.request(`http://test${path}`, {
        method: "POST",
        headers: {
            cookie: cookie(userId),
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields).toString(),
    });
}

/** What the Edit sheet posts for a food it was opened on, with a few changes. */
function editFields(over: Record<string, string> = {}): [string, string][] {
    const base: Record<string, string> = {
        name: "Eggs",
        brand: "",
        alias_lines: "",
        default_unit: "each",
        grams_per_each: "50",
        grams_per_ml: "",
        calories: "155",
        protein_g: "13",
        carbs_g: "1",
        fat_g: "11",
        fiber_g: "",
        sugar_g: "",
        alcohol_g: "",
        caffeine_mg: "",
        archived: "0",
        ...over,
    };
    return [...Object.entries(base), ["allergens", "egg"]];
}

describeDb(pgAvailable !== null, "settings saved foods & recipes", (getCtx) => {
    let householdId: string;
    const users: Record<"owner" | "admin" | "member", string> = {
        owner: "",
        admin: "",
        member: "",
    };

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        users.owner = seeded.userId;
        users.admin = await seedMember(sql, householdId, { role: "admin" });
        users.member = await seedMember(sql, householdId, { role: "member" });
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    for (const role of ["owner", "admin", "member"] as const) {
        test(`${role}: the page offers Edit, Merge and Delete on a food, and the Edit sheet saves it`, async () => {
            const { sql } = getCtx();
            const eggs = await seedFood(sql, householdId, { name: "Eggs" });
            await seedFood(sql, householdId, { name: "Milk" });
            const page = await get(users[role]);
            expect(page.status).toBe(200);
            const html = await page.text();
            expect(html).toContain('aria-label="Actions for Eggs"');
            expect(html).toContain('commandfor="fd-saved-edit"');
            expect(html).toContain('commandfor="foods-merge"');
            expect(html).toContain(
                `action="/settings/household/items/${eggs}/archive"`,
            );

            const saved = await post(
                users[role],
                `/settings/household/items/${eggs}`,
                editFields({ name: "Large eggs", calories: "160" }),
            );
            expect(saved.status).toBe(303);
            expect(saved.headers.get("location")).toBe("/settings/saved");
            expect(saved.headers.get("set-cookie") ?? "").not.toContain(
                "foodable_toast",
            );
            const [row] = await sql`
                select name, calories, grams_per_each, allergens
                from public.foods where id = ${eggs}
            `;
            expect(row.name).toBe("Large eggs");
            expect(Number(row.calories)).toBe(160);
            expect(Number(row.grams_per_each)).toBe(50);
            expect(row.allergens).toEqual(["egg"]);
        });
    }

    test("a refused edit answers 400 and reopens the one sheet with that food and the refusal", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        const refused = await post(
            users.owner,
            `/settings/household/items/${eggs}`,
            editFields({ name: "" }),
        );
        expect(refused.status).toBe(400);
        const html = await refused.text();
        const sheet = html.match(
            /<dialog[^>]*id="fd-saved-edit"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain(`action="/settings/household/items/${eggs}"`);
        // The refusal sits under the Name field, which is empty as typed.
        expect(sheet).toMatch(
            /fd-field--invalid[\s\S]*?id="fd-saved-edit-name-error">Enter a food name\./,
        );
        const [row] = await sql`
            select name from public.foods where id = ${eggs}
        `;
        expect(row.name).toBe("Eggs");
    });

    test("a refused edit reopens with what was typed, not the stored values", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        await seedFood(sql, householdId, { name: "Milk" });
        const refused = await post(
            users.owner,
            `/settings/household/items/${eggs}`,
            editFields({
                name: "Milk",
                calories: "999",
                alias_lines: "barn eggs\nsalt, kosher",
            }),
        );
        expect(refused.status).toBe(400);
        const sheet = (await refused.text()).match(
            /<dialog[^>]*id="fd-saved-edit"[\s\S]*?<\/dialog>/,
        )![0];
        const value = (name: string) =>
            sheet.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1];
        expect(value("name")).toBe("Milk");
        expect(value("calories")).toBe("999");
        expect(sheet).toContain(">barn eggs\nsalt, kosher</textarea>");
        expect(sheet).toContain('name="allergens" value="egg" checked');
        expect(sheet).toContain("That food already exists.");
    });

    test("saving the Edit sheet as opened changes nothing, an alias with a comma included", async () => {
        const { sql } = getCtx();
        const salt = await seedFood(sql, householdId, { name: "Salt" });
        await sql`insert into public.food_aliases (household_id, alias, food_id)
            values (${householdId}, 'salt, kosher', ${salt}),
                   (${householdId}, 'table salt', ${salt})`;
        const aliases = async () =>
            (
                await sql`select alias from public.food_aliases
                    where food_id = ${salt} order by alias`
            ).map((r: { alias: string }) => r.alias);
        const before = await aliases();
        const html = await (await get(users.owner)).text();
        const filled = html.match(
            /commandfor="fd-saved-edit" data-fd-menu-set="([^"]*)"/,
        )![1]!;
        const set = JSON.parse(
            filled
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&"),
        ) as Record<string, string | string[]>;
        expect(set.alias_lines).toBe("salt, kosher\ntable salt");
        const fields: [string, string][] = [];
        for (const [key, value] of Object.entries(set)) {
            if (key === "@action") continue;
            for (const v of Array.isArray(value) ? value : [value]) {
                fields.push([key, v]);
            }
        }
        fields.push(["archived", "0"]);
        const saved = await post(users.owner, String(set["@action"]), fields);
        expect(saved.status).toBe(303);
        expect(await aliases()).toEqual(before);
    });

    test("aliases are the person's to edit: lines replace them, a form with no alias field leaves them", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        await sql`insert into public.food_aliases (household_id, alias, food_id)
            values (${householdId}, 'hen fruit', ${eggs})`;
        const aliases = async () =>
            (
                await sql`select alias from public.food_aliases
                    where food_id = ${eggs} order by alias`
            ).map((r: { alias: string }) => r.alias);
        const withoutAliasField = editFields().filter(
            ([key]) => key !== "alias_lines",
        );
        expect(
            (
                await post(
                    users.owner,
                    `/settings/household/items/${eggs}`,
                    withoutAliasField,
                )
            ).status,
        ).toBe(303);
        expect(await aliases()).toEqual(["hen fruit"]);
        expect(
            (
                await post(
                    users.owner,
                    `/settings/household/items/${eggs}`,
                    editFields({ alias_lines: "barn eggs\r\nfarm, fresh" }),
                )
            ).status,
        ).toBe(303);
        expect(await aliases()).toEqual(["barn eggs", "farm, fresh"]);
        // The older comma-separated field still works for other callers.
        const legacy = editFields().filter(([key]) => key !== "alias_lines");
        legacy.push(["aliases", "one, two"]);
        expect(
            (
                await post(
                    users.owner,
                    `/settings/household/items/${eggs}`,
                    legacy,
                )
            ).status,
        ).toBe(303);
        expect(await aliases()).toEqual(["one", "two"]);
    });

    test("Merge from a row posts the kept and merged food to the household's merge route", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        const milk = await seedFood(sql, householdId, { name: "Milk" });
        const html = await (await get(users.owner)).text();
        // One sheet for every row: Keep as radio rows, the merged food a hidden
        // field the row's item fills, and the item sets the merged food and
        // leaves Keep for the person to choose.
        expect(html).toContain(`name="keep_id"`);
        expect(html).toContain(`name="drop_id"`);
        const fills = [
            ...html.matchAll(
                /commandfor="foods-merge" data-fd-menu-set="([^"]*)"/g,
            ),
        ].map((m) => m[1]!);
        expect(fills).toHaveLength(2);
        for (const fill of fills) {
            const set = JSON.parse(fill.replace(/&quot;/g, '"')) as Record<
                string,
                string
            >;
            expect(set.keep_id).toBe("");
            expect(set.drop_id).toBeTruthy();
        }
        const merged = await post(
            users.member,
            "/settings/household/items/merge",
            [
                ["keep_id", eggs],
                ["drop_id", milk],
            ],
        );
        expect(merged.status).toBe(303);
        expect(merged.headers.get("location")).toBe("/settings/saved");
        const rows = await sql`
            select id, archived_at from public.foods
            where household_id = ${householdId} and id in (${eggs}, ${milk})
        `;
        const archived = rows.filter(
            (r: { archived_at: unknown }) => r.archived_at != null,
        );
        expect(rows.length - archived.length).toBe(1);
    });

    test("a refused merge reopens the merge sheet with the refusal in it", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        await seedFood(sql, householdId, { name: "Milk" });
        const refused = await post(
            users.owner,
            "/settings/household/items/merge",
            [
                ["keep_id", eggs],
                ["drop_id", eggs],
            ],
        );
        expect(refused.status).toBe(400);
        const html = await refused.text();
        const sheet = html.match(
            /<dialog[^>]*id="foods-merge"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain('role="alert"');
    });

    test("a merge sent with no Keep is refused in place and changes nothing", async () => {
        const { sql } = getCtx();
        await seedFood(sql, householdId, { name: "Eggs" });
        const milk = await seedFood(sql, householdId, { name: "Milk" });
        const refused = await post(
            users.owner,
            "/settings/household/items/merge",
            [
                ["keep_id", ""],
                ["drop_id", milk],
            ],
        );
        expect(refused.status).toBe(400);
        const html = await refused.text();
        expect(html).toContain("Choose the food to keep.");
        const [row] = await sql`
            select archived_at from public.foods where id = ${milk}
        `;
        expect(row.archived_at).toBeNull();
    });

    test("Delete archives the food and goes back to Saved with no toast", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        const res = await post(
            users.member,
            `/settings/household/items/${eggs}/archive`,
            [],
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/saved");
        expect(res.headers.get("set-cookie") ?? "").not.toContain(
            "foodable_toast",
        );
        const [row] = await sql`
            select archived_at from public.foods where id = ${eggs}
        `;
        expect(row.archived_at).not.toBeNull();
    });
});
