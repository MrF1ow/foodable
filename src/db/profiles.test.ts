import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    alcoholTrackingEnabledFromProfile,
    getAlcoholTrackingEnabled,
    getPreferredDrinkUnit,
    getPreferredWeightUnit,
    getProfile,
    getUserTimezone,
    getWidgetsEnabled,
    preferredDrinkUnitFromProfile,
    preferredWeightUnitFromProfile,
    setNutritionLayout,
    timezoneFromProfile,
    upsertProfile,
    widgetsEnabledFromProfile,
} from "./profiles.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "profiles db", (getCtx) => {
    let userId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("getProfile null for missing user", async () => {
        expect(await getProfile(crypto.randomUUID())).toBeNull();
    });

    test("upsertProfile insert then partial update", async () => {
        const inserted = await upsertProfile(userId, {
            timezone: "America/New_York",
            widgets_enabled: false,
            preferred_weight_unit: "lb",
        });
        expect(inserted.user_id).toBe(userId);
        expect(inserted.timezone).toBe("America/New_York");
        expect(inserted.widgets_enabled).toBe(false);
        expect(inserted.preferred_weight_unit).toBe("lb");
        expect(inserted.alcohol_tracking_enabled).toBe(false);
        expect(inserted.preferred_drink_unit).toBeNull();
        expect(inserted.locale).toBeNull();
        expect(inserted.theme).toBeNull();
        expect(inserted.nutrition_layout).toBeNull();
        expect(inserted.created_at).toMatch(/\+00:00$/);
        expect(inserted.updated_at).toMatch(/\+00:00$/);

        const updated = await upsertProfile(userId, {
            timezone: "Europe/Kyiv",
        });
        expect(updated.timezone).toBe("Europe/Kyiv");
        expect(updated.widgets_enabled).toBe(false);
        expect(updated.preferred_weight_unit).toBe("lb");
    });

    test("setNutritionLayout stores text[]", async () => {
        const layout = ["calories", "protein", "water"];
        const saved = await setNutritionLayout(userId, layout);
        expect(saved.nutrition_layout).toEqual(layout);
        const loaded = await getProfile(userId);
        expect(loaded?.nutrition_layout).toEqual(layout);
    });

    test("preference wrappers without a row", async () => {
        const other = crypto.randomUUID();
        await getCtx().sql`
            insert into auth.users (id, email)
            values (${other}, ${`orphan-${other}@foodable.test`})
        `;
        expect(await getUserTimezone(other)).toBe("UTC");
        expect(await getPreferredWeightUnit(other)).toBeNull();
        expect(await getWidgetsEnabled(other)).toBe(true);
        expect(await getAlcoholTrackingEnabled(other)).toBe(false);
        expect(await getPreferredDrinkUnit(other)).toBeNull();
    });

    test("preference wrappers with a row", async () => {
        await upsertProfile(userId, {
            timezone: "Pacific/Honolulu",
            preferred_weight_unit: "kg",
            widgets_enabled: false,
            alcohol_tracking_enabled: true,
            preferred_drink_unit: "uk",
        });
        const profile = await getProfile(userId);
        expect(timezoneFromProfile(profile)).toBe("Pacific/Honolulu");
        expect(preferredWeightUnitFromProfile(profile)).toBe("kg");
        expect(widgetsEnabledFromProfile(profile)).toBe(false);
        expect(alcoholTrackingEnabledFromProfile(profile)).toBe(true);
        expect(preferredDrinkUnitFromProfile(profile)).toBe("uk");
        expect(await getUserTimezone(userId)).toBe("Pacific/Honolulu");
        expect(await getPreferredWeightUnit(userId)).toBe("kg");
        expect(await getWidgetsEnabled(userId)).toBe(false);
        expect(await getAlcoholTrackingEnabled(userId)).toBe(true);
        expect(await getPreferredDrinkUnit(userId)).toBe("uk");
    });

    test("getProfile full row shape for present user", async () => {
        await upsertProfile(userId, {
            preferred_drink_unit: null,
            preferred_weight_unit: null,
            theme: "dark",
        });
        await getCtx().sql`
            update profiles set timezone = null where user_id = ${userId}
        `;
        const row = await getProfile(userId);
        expect(row).toEqual({
            user_id: userId,
            timezone: null,
            preferred_weight_unit: null,
            widgets_enabled: true,
            alcohol_tracking_enabled: false,
            preferred_drink_unit: null,
            locale: null,
            theme: "dark",
            nutrition_layout: null,
            created_at: expect.any(String),
            updated_at: expect.any(String),
        });
    });
});
