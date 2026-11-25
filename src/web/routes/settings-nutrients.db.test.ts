import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { getProfile, upsertProfile } from "../../db/profiles.js";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold, seedMember } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { nutritionRoutes } from "./nutrition.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

// The settings routes and Today over one real database, so a switch posted on
// Settings is what the next Today render reads.
const app = new Hono();
app.route("/", settingsRoutes);
app.route("/", nutritionRoutes);

function post(
    userId: string,
    path: string,
    form: Record<string, string | undefined>,
) {
    return app.request(`http://test${path}`, {
        method: "POST",
        headers: {
            cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(
            Object.entries(form).filter(
                (e): e is [string, string] => e[1] !== undefined,
            ),
        ).toString(),
    });
}

function get(userId: string, path: string) {
    return app.request(`http://test${path}`, {
        headers: { cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}` },
    });
}

describeDb(
    pgAvailable !== null,
    "settings units, nutrients, cards",
    (getCtx) => {
        let userId: string;

        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            ({ userId } = await seedHousehold(sql));
        });

        afterEach(() => {
            setSqlForTests(null);
            resetFlagsForTests();
        });

        test("switching sugar off drops its limit row from Today, and on brings it back", async () => {
            const before = await (await get(userId, "/")).text();
            expect(before).toMatch(/Sugar \d/);

            const res = await post(userId, "/settings/nutrients", {
                nutrient: "sugar",
                shown: "0",
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/settings/nutrients");
            expect((await getProfile(userId))?.hidden_nutrients).toEqual([
                "sugar",
            ]);

            const today = await (await get(userId, "/")).text();
            expect(today).not.toMatch(/Sugar \d/);
            expect(today).toMatch(/Fiber \d/);
            expect(today).toMatch(/Caffeine \d/);

            // The page shows the switch Off, the others On.
            const page = await (
                await get(userId, "/settings/nutrients")
            ).text();
            expect(page).toContain('data-fd-settings-page="nutrients"');
            expect(page).toMatch(/aria-label="Sugar"[^>]*aria-checked="false"/);
            expect(page).toMatch(/aria-label="Fiber"[^>]*aria-checked="true"/);

            const back = await post(userId, "/settings/nutrients", {
                nutrient: "sugar",
                shown: "1",
            });
            expect(back.status).toBe(303);
            expect((await getProfile(userId))?.hidden_nutrients).toEqual([]);
            expect(await (await get(userId, "/")).text()).toMatch(/Sugar \d/);
        });

        test("each switch is merged into the stored list, never replacing it", async () => {
            for (const nutrient of ["caffeine", "sugar", "fiber"]) {
                await post(userId, "/settings/nutrients", {
                    nutrient,
                    shown: "0",
                });
            }
            // Repeating a request changes nothing.
            await post(userId, "/settings/nutrients", {
                nutrient: "sugar",
                shown: "0",
            });
            expect((await getProfile(userId))?.hidden_nutrients).toEqual([
                "caffeine",
                "fiber",
                "sugar",
            ]);
            await post(userId, "/settings/nutrients", {
                nutrient: "sugar",
                shown: "1",
            });
            expect((await getProfile(userId))?.hidden_nutrients).toEqual([
                "caffeine",
                "fiber",
            ]);
            // Two switches posted together both land.
            await Promise.all([
                post(userId, "/settings/nutrients", {
                    nutrient: "sugar",
                    shown: "0",
                }),
                post(userId, "/settings/nutrients", {
                    nutrient: "caffeine",
                    shown: "1",
                }),
            ]);
            expect((await getProfile(userId))?.hidden_nutrients).toEqual([
                "fiber",
                "sugar",
            ]);
        });

        test("alcohol writes its own opt-in and leaves the hidden list alone", async () => {
            await post(userId, "/settings/nutrients", {
                nutrient: "sugar",
                shown: "0",
            });
            const on = await post(userId, "/settings/nutrients", {
                nutrient: "alcohol",
                shown: "1",
            });
            expect(on.status).toBe(303);
            let profile = await getProfile(userId);
            expect(profile?.alcohol_tracking_enabled).toBe(true);
            expect(profile?.hidden_nutrients).toEqual(["sugar"]);
            await post(userId, "/settings/nutrients", {
                nutrient: "alcohol",
                shown: "0",
            });
            profile = await getProfile(userId);
            expect(profile?.alcohol_tracking_enabled).toBe(false);
            expect(profile?.hidden_nutrients).toEqual(["sugar"]);
        });

        test("an unknown nutrient or value is refused and nothing changes", async () => {
            for (const form of [
                { nutrient: "protein", shown: "0" },
                { nutrient: "sugar", shown: "2" },
                { nutrient: "sugar" },
                { shown: "0" },
            ]) {
                const res = await post(userId, "/settings/nutrients", form);
                expect(res.status).toBe(400);
            }
            expect((await getProfile(userId))?.hidden_nutrients ?? []).toEqual(
                [],
            );
        });

        test("units: each field is written only when posted, and empty clears it", async () => {
            const first = await post(userId, "/settings/units", {
                preferred_weight_unit: "lb",
                preferred_drink_unit: "uk",
            });
            expect(first.status).toBe(303);
            expect(first.headers.get("location")).toBe("/settings/units");
            let profile = await getProfile(userId);
            expect(profile?.preferred_weight_unit).toBe("lb");
            expect(profile?.preferred_drink_unit).toBe("uk");

            await post(userId, "/settings/units", {
                preferred_weight_unit: "kg",
            });
            profile = await getProfile(userId);
            expect(profile?.preferred_weight_unit).toBe("kg");
            expect(profile?.preferred_drink_unit).toBe("uk");

            await post(userId, "/settings/units", { preferred_drink_unit: "" });
            profile = await getProfile(userId);
            expect(profile?.preferred_weight_unit).toBe("kg");
            expect(profile?.preferred_drink_unit).toBeNull();

            const page = await (await get(userId, "/settings/units")).text();
            expect(page).toContain('data-fd-settings-page="units"');
            expect(page).toContain("data-fd-units");
            expect(page).toContain("Weight");
            expect(page).toContain("Drinks");
        });

        test("units: an unknown unit is a 400 that shows its error on the page", async () => {
            const res = await post(userId, "/settings/units", {
                preferred_weight_unit: "stone",
            });
            expect(res.status).toBe(400);
            const html = await res.text();
            expect(html).toContain("Choose kg or lb.");
            expect(html).toContain("data-fd-units");
            expect(html).not.toContain("data-sheet-open-on-load");
            expect(
                (await getProfile(userId))?.preferred_weight_unit ?? null,
            ).toBe(null);
            const drink = await post(userId, "/settings/units", {
                preferred_drink_unit: "pint",
            });
            expect(drink.status).toBe(400);
            expect(await drink.text()).toContain(
                "Choose US drinks or UK units.",
            );
        });

        test("POST /settings/ai-connections/widgets flips widgets_enabled", async () => {
            await upsertProfile(userId, { widgets_enabled: true });
            const off = await post(userId, "/settings/ai-connections/widgets", {
                enabled: "0",
            });
            expect(off.status).toBe(303);
            expect(off.headers.get("location")).toBe(
                "/settings/ai-connections",
            );
            expect((await getProfile(userId))?.widgets_enabled).toBe(false);
            const page = await (
                await get(userId, "/settings/ai-connections")
            ).text();
            expect(page).toContain("Show cards in chat");
            expect(page).toMatch(
                /aria-label="Show cards in chat"[^>]*aria-checked="false"/,
            );

            const on = await post(userId, "/settings/ai-connections/widgets", {
                enabled: "1",
            });
            expect(on.status).toBe(303);
            expect((await getProfile(userId))?.widgets_enabled).toBe(true);

            const bad = await post(userId, "/settings/ai-connections/widgets", {
                enabled: "yes",
            });
            expect(bad.status).toBe(400);
            expect((await getProfile(userId))?.widgets_enabled).toBe(true);
        });

        test("an owner, an admin and a member each change only their own units, nutrients and cards", async () => {
            const { sql } = getCtx();
            const [row] = (await sql`
                select household_id from public.household_members
                where user_id = ${userId}
            `) as { household_id: string }[];
            const admin = await seedMember(sql, row!.household_id, {
                role: "admin",
            });
            const member = await seedMember(sql, row!.household_id);
            const people = [
                { id: userId, weight: "kg", drink: "uk", nutrient: "sugar" },
                { id: admin, weight: "lb", drink: "us", nutrient: "fiber" },
                { id: member, weight: "kg", drink: "us", nutrient: "caffeine" },
            ] as const;
            for (const p of people) {
                for (const res of [
                    await post(p.id, "/settings/units", {
                        preferred_weight_unit: p.weight,
                        preferred_drink_unit: p.drink,
                    }),
                    await post(p.id, "/settings/nutrients", {
                        nutrient: p.nutrient,
                        shown: "0",
                    }),
                    await post(p.id, "/settings/ai-connections/widgets", {
                        enabled: "0",
                    }),
                ]) {
                    expect(res.status).toBe(303);
                }
            }
            // Each person's own profile moved, and nobody else's.
            for (const p of people) {
                const profile = await getProfile(p.id);
                expect(profile?.preferred_weight_unit).toBe(p.weight);
                expect(profile?.preferred_drink_unit).toBe(p.drink);
                expect(profile?.hidden_nutrients).toEqual([p.nutrient]);
                expect(profile?.widgets_enabled).toBe(false);
            }
            // The form names no person: a posted user id is ignored.
            await post(member, "/settings/units", {
                preferred_weight_unit: "lb",
                user_id: userId,
            });
            expect((await getProfile(userId))?.preferred_weight_unit).toBe(
                "kg",
            );
            expect((await getProfile(member))?.preferred_weight_unit).toBe(
                "lb",
            );
        });

        test("signed out, units, nutrients and cards change nothing", async () => {
            for (const [path, form] of [
                ["/settings/units", { preferred_weight_unit: "kg" }],
                ["/settings/nutrients", { nutrient: "sugar", shown: "0" }],
                ["/settings/ai-connections/widgets", { enabled: "0" }],
            ] as const) {
                const res = await app.request(`http://test${path}`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams(form).toString(),
                });
                expect(res.status).not.toBe(303);
            }
            const profile = await getProfile(userId);
            expect(profile?.preferred_weight_unit ?? null).toBeNull();
            expect(profile?.hidden_nutrients ?? []).toEqual([]);
        });

        test("a partial Account save leaves the checkboxes it does not carry alone", async () => {
            await upsertProfile(userId, {
                widgets_enabled: false,
                alcohol_tracking_enabled: true,
                preferred_weight_unit: "lb",
            });
            const tzOnly = await post(userId, "/settings", {
                group: "nutrition",
                timezone: "Europe/Kyiv",
            });
            expect(tzOnly.status).toBe(303);
            let profile = await getProfile(userId);
            expect(profile?.timezone).toBe("Europe/Kyiv");
            expect(profile?.widgets_enabled).toBe(false);
            expect(profile?.alcohol_tracking_enabled).toBe(true);
            expect(profile?.preferred_weight_unit).toBe("lb");

            // The full form marks the checkboxes it carries: unchecked is Off.
            await post(userId, "/settings", {
                group: "nutrition",
                timezone: "Europe/Kyiv",
                has_widgets_enabled: "1",
                has_alcohol_tracking_enabled: "1",
                alcohol_tracking_enabled: "true",
            });
            profile = await getProfile(userId);
            expect(profile?.widgets_enabled).toBe(false);
            expect(profile?.alcohol_tracking_enabled).toBe(true);
            await post(userId, "/settings", {
                group: "nutrition",
                has_widgets_enabled: "1",
                has_alcohol_tracking_enabled: "1",
                widgets_enabled: "true",
            });
            profile = await getProfile(userId);
            expect(profile?.widgets_enabled).toBe(true);
            expect(profile?.alcohol_tracking_enabled).toBe(false);
        });

        test("the account page shows the viewer's email and no unit, alcohol or widget fields", async () => {
            await upsertProfile(userId, { timezone: "US/Pacific" });
            const res = await get(userId, "/settings/account");
            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain(`test-${userId}@foodable.test`);
            // The stored zone, even an alias the runtime does not list, is
            // what the Time zone row shows.
            expect(html).toContain('fd-item-row__value">US/Pacific<');
            expect(html).not.toContain("preferred_weight_unit");
            expect(html).not.toContain("widgets_enabled");
            expect(html).not.toContain("alcohol_tracking_enabled");
        });

        test("a time-zone-only post leaves widgets_enabled, alcohol_tracking_enabled and both units unchanged", async () => {
            await upsertProfile(userId, {
                widgets_enabled: false,
                alcohol_tracking_enabled: true,
                preferred_weight_unit: "lb",
                preferred_drink_unit: "uk",
            });
            const res = await post(userId, "/settings", {
                group: "nutrition",
                timezone: "Europe/Kyiv",
            });
            expect(res.status).toBe(303);
            const profile = await getProfile(userId);
            expect(profile?.timezone).toBe("Europe/Kyiv");
            expect(profile?.widgets_enabled).toBe(false);
            expect(profile?.alcohol_tracking_enabled).toBe(true);
            expect(profile?.preferred_weight_unit).toBe("lb");
            expect(profile?.preferred_drink_unit).toBe("uk");
        });

        test("the zone the page lists is accepted, an alias survives a re-save, and a bad one is a 400", async () => {
            const alias = await post(userId, "/settings", {
                group: "nutrition",
                timezone: "US/Pacific",
            });
            expect(alias.status).toBe(303);
            expect((await getProfile(userId))?.timezone).toBe("US/Pacific");
            const bad = await post(userId, "/settings", {
                group: "nutrition",
                timezone: "Mars/Olympus",
            });
            expect(bad.status).toBe(400);
            const html = await bad.text();
            expect(html).toContain("Choose a time zone from the list.");
            expect(html).not.toContain("IANA");
            // The refusal is on the time zone page, where the list is.
            expect(html).toContain('data-fd-settings-page="timezone"');
            expect(html).not.toContain("data-sheet-open-on-load");
            expect((await getProfile(userId))?.timezone).toBe("US/Pacific");
        });

        test("saving the time zone saves it and sets no toast", async () => {
            const res = await post(userId, "/settings", {
                group: "nutrition",
                timezone: "Europe/Kyiv",
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("set-cookie")).toBeNull();
            expect((await getProfile(userId))?.timezone).toBe("Europe/Kyiv");
        });

        test("every field the old account form posted is still writable through its new route", async () => {
            const tz = await post(userId, "/settings", {
                group: "nutrition",
                timezone: "Asia/Tokyo",
            });
            const units = await post(userId, "/settings/units", {
                preferred_weight_unit: "lb",
                preferred_drink_unit: "uk",
            });
            const alcohol = await post(userId, "/settings/nutrients", {
                nutrient: "alcohol",
                shown: "1",
            });
            const widgets = await post(
                userId,
                "/settings/ai-connections/widgets",
                {
                    enabled: "0",
                },
            );
            for (const res of [tz, units, alcohol, widgets]) {
                expect(res.status).toBe(303);
            }
            const profile = await getProfile(userId);
            expect(profile?.timezone).toBe("Asia/Tokyo");
            expect(profile?.preferred_weight_unit).toBe("lb");
            expect(profile?.preferred_drink_unit).toBe("uk");
            expect(profile?.alcohol_tracking_enabled).toBe(true);
            expect(profile?.widgets_enabled).toBe(false);
        });
    },
);
