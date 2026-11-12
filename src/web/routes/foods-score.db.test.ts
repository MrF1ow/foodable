import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { upsertNutritionGoals } from "../../db/nutrition.js";
import { liveRulesStore } from "../../db/rules.js";
import { liveScoreSettingsStore } from "../../db/score-settings.js";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { newFood } from "../../domain/foods.js";
import { addAllergen } from "../../domain/rules.js";
import {
    updateHouseholdScoreDefault,
    updateMemberScoreSettings,
} from "../../domain/score-settings.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { foodsRoutes } from "./foods.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", foodsRoutes);

const PROCESSING_ONLY = {
    nutrition: 0,
    processing: 100,
    additives: 0,
    environment: 0,
};

describeDb(pgAvailable !== null, "product screen score", (getCtx) => {
    let userId: string;
    let householdId: string;
    let peerId: string;
    let foodId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        ({ userId, householdId } = await seedHousehold(sql));
        peerId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${peerId}, ${`peer-${peerId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${peerId}, ${"member"}, ${"Peer"})
        `;
        // Nutri-Score A but NOVA 4: a nutrition-only view loves it, a
        // processing-only view does not. It may contain peanut traces, and
        // 40 g of it holds 20 g of sugar against a 30 g goal.
        const food = newFood({
            householdId,
            kind: "food",
            name: "Crunch Bar",
            sugarG: 50,
            gramsPerEach: 40,
            offQuality: {
                nutriscoreGrade: "a",
                novaGroup: 4,
                ecoscoreGrade: "b",
                additives: [],
                allergensTags: null,
                tracesTags: ["en:peanuts"],
                ingredientsAnalysisTags: null,
                labelsTags: null,
                fetchedAt: "2026-11-09T12:00:00.000Z",
            },
        });
        await liveFoodsStore().insertFood(food);
        foodId = food.id;
        await addAllergen(liveRulesStore(), {
            householdId,
            userId,
            allergen: "peanut",
        });
        await upsertNutritionGoals(userId, { daily_sugar_g: 30 });
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    async function screen(user = userId): Promise<string> {
        const res = await app.request(`http://test/foods/${foodId}`, {
            headers: { cookie: `${SITE_COOKIE}=${mintSiteSession(user)}` },
        });
        expect(res.status).toBe(200);
        return res.text();
    }

    function score(html: string): number {
        const match = html.match(/fd-score-big[^>]*>\s*(?:<[^>]+>\s*)*(\d+)/);
        expect(match).not.toBeNull();
        return Number(match![1]);
    }

    test("a viewer with custom weights sees a different score than one on the default", async () => {
        const byDefault = await screen();
        expect(byDefault).toContain("Your weights: Balanced");
        await updateMemberScoreSettings(
            liveScoreSettingsStore(),
            householdId,
            userId,
            { choice: { preset: "custom", weights: PROCESSING_ONLY } },
        );
        const custom = await screen();
        expect(custom).toContain("Your weights: Custom");
        expect(score(custom)).not.toBe(score(byDefault));
        // The peer has no choice of their own: their view is unchanged.
        expect(score(await screen(peerId))).toBe(score(byDefault));
    });

    test("a member without a choice sees the household default's weights", async () => {
        const byDefault = score(await screen());
        await updateHouseholdScoreDefault(
            liveScoreSettingsStore(),
            householdId,
            {
                preset: "custom",
                weights: PROCESSING_ONLY,
            },
        );
        const html = await screen();
        expect(html).toContain("Your weights: Custom");
        expect(score(html)).not.toBe(byDefault);
    });

    test("turning off may-contain removes the trace line and only that", async () => {
        expect(await screen()).toContain("May contain traces of peanut");
        await updateMemberScoreSettings(
            liveScoreSettingsStore(),
            householdId,
            userId,
            { warnTraces: false },
        );
        const html = await screen();
        expect(html).not.toContain("May contain traces");
        // Own weights unchanged by a switch.
        expect(html).toContain("Your weights: Balanced");
    });

    test("turning off the goals comparison removes the goals line", async () => {
        // Traces off so the goals notice is the member's first line.
        await updateMemberScoreSettings(
            liveScoreSettingsStore(),
            householdId,
            userId,
            { warnTraces: false },
        );
        expect(await screen()).toContain("Fits today");
        await updateMemberScoreSettings(
            liveScoreSettingsStore(),
            householdId,
            userId,
            { compareGoals: false },
        );
        const html = await screen();
        expect(html).not.toContain("Fits today");
        expect(html).toContain("No issues found for this product.");
    });
});
