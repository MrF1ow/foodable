import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { setSqlForTests } from "../../db/sql.js";
import { liveScoreSettingsStore } from "../../db/score-settings.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { SCORE_PRESETS } from "../../domain/product-score.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", settingsRoutes);

const PATH = "http://test/settings/product-score";
const HOUSEHOLD_PATH = `${PATH}/household`;

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function get(userId: string, path = PATH) {
    return app.request(path, { headers: { cookie: cookie(userId) } });
}

function post(userId: string, fields: Record<string, string>, path = PATH) {
    return app.request(path, {
        method: "POST",
        headers: {
            cookie: cookie(userId),
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields).toString(),
    });
}

const CUSTOM = {
    intent: "choice",
    preset: "custom",
    weight_nutrition: "10",
    weight_processing: "70",
    weight_additives: "20",
    weight_environment: "0",
};

/** The checked preset radio in a rendered page. */
function checkedPreset(html: string): string | null {
    const match = html.match(
        /<input class="fd-chip__input" type="radio" name="preset" value="([a-z_]+)" checked/,
    );
    return match?.[1] ?? null;
}

/** The slider values in a rendered page, in order. */
function sliderValues(html: string): number[] {
    return [
        ...html.matchAll(
            /<input class="fd-scoreset__range"[^>]* value="(\d+)"/g,
        ),
    ].map((m) => Number(m[1]));
}

function switchState(html: string, title: string): string | null {
    const match = html.match(
        new RegExp(
            `role="switch" aria-checked="(true|false)" aria-label="${title}"`,
        ),
    );
    return match?.[1] ?? null;
}

describeDb(pgAvailable !== null, "settings product score", (getCtx) => {
    let ownerId: string;
    let householdId: string;
    let memberId: string;
    let adminId: string;

    async function addMember(role: "member" | "admin", name: string) {
        const { sql } = getCtx();
        const id = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${id}, ${`${name}-${id}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${id}, ${role}, ${name})
        `;
        return id;
    }

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        ({ userId: ownerId, householdId } = await seedHousehold(sql));
        memberId = await addMember("member", "Member");
        adminId = await addMember("admin", "Admin");
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    const store = () => liveScoreSettingsStore();

    test("the page shows the preset, the four sliders and both switches", async () => {
        const res = await get(memberId);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('data-fd-settings-page="score"');
        expect(checkedPreset(html)).toBe("balanced");
        const b = SCORE_PRESETS.balanced;
        expect(sliderValues(html)).toEqual([
            b.nutrition,
            b.processing,
            b.additives,
            b.environment,
        ]);
        expect(switchState(html, "Warn on “may contain”")).toBe("true");
        expect(switchState(html, "Compare with today's goals")).toBe("true");
        expect(html).toContain("Household default");
        expect(html).toContain("You are using the household default");
    });

    test("the settings menu lists Product score", async () => {
        const html = await (await get(memberId)).text();
        expect(html).toContain(">Product score<");
        expect(html).toContain('href="/settings/product-score"');
    });

    test("saving a preset round-trips", async () => {
        const res = await post(memberId, {
            intent: "choice",
            preset: "planet",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/product-score");
        const row = await store().getMember(householdId, memberId);
        expect(row?.preset).toBe("planet");
        expect(row?.weights).toBeNull();
        const html = await (await get(memberId)).text();
        expect(checkedPreset(html)).toBe("planet");
        const p = SCORE_PRESETS.planet;
        expect(sliderValues(html)).toEqual([
            p.nutrition,
            p.processing,
            p.additives,
            p.environment,
        ]);
        expect(html).not.toContain("You are using the household default");
    });

    test("custom weights round-trip and show on the sliders", async () => {
        expect((await post(memberId, CUSTOM)).status).toBe(303);
        const row = await store().getMember(householdId, memberId);
        expect(row?.preset).toBe("custom");
        expect(row?.weights).toEqual({
            nutrition: 10,
            processing: 70,
            additives: 20,
            environment: 0,
        });
        const html = await (await get(memberId)).text();
        expect(checkedPreset(html)).toBe("custom");
        expect(sliderValues(html)).toEqual([10, 70, 20, 0]);
        // Shares of the total: 10 / 70 / 20 / 0 of 100.
        expect(html).toContain("data-fd-score-share>70%</output>");
    });

    test("a switch keeps the choice and the other switch; a choice keeps the switches", async () => {
        await post(memberId, CUSTOM);
        const off = await post(memberId, {
            intent: "warn_traces",
            value: "0",
        });
        expect(off.status).toBe(303);
        let row = await store().getMember(householdId, memberId);
        expect(row).toMatchObject({
            preset: "custom",
            warnTraces: false,
            compareGoals: true,
        });
        expect(row?.weights?.processing).toBe(70);

        await post(memberId, { intent: "compare_goals", value: "0" });
        await post(memberId, { intent: "choice", preset: "health_first" });
        row = await store().getMember(householdId, memberId);
        expect(row).toMatchObject({
            preset: "health_first",
            warnTraces: false,
            compareGoals: false,
        });
        const html = await (await get(memberId)).text();
        expect(switchState(html, "Warn on “may contain”")).toBe("false");
        expect(switchState(html, "Compare with today's goals")).toBe("false");

        // A switch can come back on.
        await post(memberId, { intent: "warn_traces", value: "1" });
        row = await store().getMember(householdId, memberId);
        expect(row?.warnTraces).toBe(true);
        expect(row?.preset).toBe("health_first");
    });

    test("a switch on a member who follows the household does not give them a choice", async () => {
        await post(memberId, { intent: "warn_traces", value: "0" });
        const row = await store().getMember(householdId, memberId);
        expect(row?.preset).toBe("household");
        const html = await (await get(memberId)).text();
        expect(html).toContain("You are using the household default");
    });

    for (const [name, fields, error] of [
        [
            "all-zero weights",
            {
                ...CUSTOM,
                weight_nutrition: "0",
                weight_processing: "0",
                weight_additives: "0",
                weight_environment: "0",
            },
            "Give at least one part a weight above 0.",
        ],
        [
            "a weight above 100",
            { ...CUSTOM, weight_nutrition: "101" },
            "Each weight is a whole number from 0 to 100.",
        ],
        [
            "a negative weight",
            { ...CUSTOM, weight_processing: "-5" },
            "Each weight is a whole number from 0 to 100.",
        ],
        [
            "a fractional weight",
            { ...CUSTOM, weight_additives: "12.5" },
            "Each weight is a whole number from 0 to 100.",
        ],
        [
            "an empty weight",
            { ...CUSTOM, weight_environment: "" },
            "Each weight is a whole number from 0 to 100.",
        ],
        [
            "a missing weight",
            {
                intent: "choice",
                preset: "custom",
                weight_nutrition: "10",
            },
            "Each weight is a whole number from 0 to 100.",
        ],
    ] as const) {
        test(`${name} is refused in place with the error, and nothing is saved`, async () => {
            await post(memberId, { intent: "choice", preset: "planet" });
            const res = await post(memberId, { ...fields });
            expect(res.status).toBe(400);
            const html = await res.text();
            expect(html).toContain('role="alert"');
            expect(html).toContain(error);
            // Custom stays selected with what was typed, to fix and resend.
            expect(checkedPreset(html)).toBe("custom");
            const row = await store().getMember(householdId, memberId);
            expect(row?.preset).toBe("planet");
        });
    }

    test("an unknown preset is refused", async () => {
        const res = await post(memberId, { intent: "choice", preset: "nope" });
        expect(res.status).toBe(400);
        expect(await store().getMember(householdId, memberId)).toBeNull();
    });

    test("an unknown intent is refused", async () => {
        const res = await post(memberId, { intent: "wipe" });
        expect(res.status).toBe(400);
    });

    test("Use household default clears the member's own choice and keeps the switches", async () => {
        await post(memberId, CUSTOM);
        await post(memberId, { intent: "warn_traces", value: "0" });
        const res = await post(memberId, { intent: "household" });
        expect(res.status).toBe(303);
        const row = await store().getMember(householdId, memberId);
        expect(row).toMatchObject({
            preset: "household",
            weights: null,
            warnTraces: false,
            compareGoals: true,
        });
    });

    test("a member's post to the household default is refused with 403 and writes nothing", async () => {
        const res = await post(
            memberId,
            { intent: "choice", preset: "planet" },
            HOUSEHOLD_PATH,
        );
        expect(res.status).toBe(403);
        expect(await store().getHouseholdDefault(householdId)).toBeNull();
        expect((await get(memberId, HOUSEHOLD_PATH)).status).toBe(403);
    });

    test("an owner and an admin set the household default", async () => {
        const res = await post(
            ownerId,
            { intent: "choice", preset: "less_processed" },
            HOUSEHOLD_PATH,
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/product-score");
        expect(await store().getHouseholdDefault(householdId)).toEqual({
            preset: "less_processed",
            weights: null,
        });
        const viaAdmin = await post(adminId, { ...CUSTOM }, HOUSEHOLD_PATH);
        expect(viaAdmin.status).toBe(303);
        expect(
            (await store().getHouseholdDefault(householdId))?.weights,
        ).toEqual({
            nutrition: 10,
            processing: 70,
            additives: 20,
            environment: 0,
        });
    });

    test("the household default editor refuses bad weights in place", async () => {
        const res = await post(
            ownerId,
            {
                ...CUSTOM,
                weight_nutrition: "0",
                weight_processing: "0",
                weight_additives: "0",
            },
            HOUSEHOLD_PATH,
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Give at least one part a weight above 0.");
        expect(await store().getHouseholdDefault(householdId)).toBeNull();
    });

    test("a member sees the household default and follows it; an admin gets a link to edit it", async () => {
        await post(
            ownerId,
            { intent: "choice", preset: "planet" },
            HOUSEHOLD_PATH,
        );
        const memberHtml = await (await get(memberId)).text();
        expect(memberHtml).toContain('fd-scoreset__household-value">Planet<');
        expect(checkedPreset(memberHtml)).toBe("planet");
        expect(memberHtml).not.toContain(
            'href="/settings/product-score/household"',
        );
        const adminHtml = await (await get(adminId)).text();
        expect(adminHtml).toContain('href="/settings/product-score/household"');
        const editor = await (await get(adminId, HOUSEHOLD_PATH)).text();
        expect(checkedPreset(editor)).toBe("planet");
    });

    test("the household editor shows the default, not the admin's own choice", async () => {
        await post(adminId, { intent: "choice", preset: "health_first" });
        const editor = await (await get(adminId, HOUSEHOLD_PATH)).text();
        expect(checkedPreset(editor)).toBe("balanced");
    });

    test("clearing the household default goes back to Balanced", async () => {
        await post(
            ownerId,
            { intent: "choice", preset: "planet" },
            HOUSEHOLD_PATH,
        );
        const res = await post(ownerId, { intent: "clear" }, HOUSEHOLD_PATH);
        expect(res.status).toBe(303);
        expect(await store().getHouseholdDefault(householdId)).toBeNull();
        const html = await (await get(memberId)).text();
        expect(checkedPreset(html)).toBe("balanced");
    });

    test("the page is not there without the v2 shell", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        expect((await get(memberId)).status).toBe(404);
        expect(
            (await post(memberId, { intent: "choice", preset: "planet" }))
                .status,
        ).toBe(404);
    });

    test("a posted user id is ignored: the write is always the session member's", async () => {
        await post(memberId, {
            intent: "choice",
            preset: "planet",
            user_id: ownerId,
        });
        expect(await store().getMember(householdId, ownerId)).toBeNull();
        expect((await store().getMember(householdId, memberId))?.preset).toBe(
            "planet",
        );
    });
});
