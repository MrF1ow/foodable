// member_score_settings and the household's score default against real
// Postgres, as foodable_app: the jsonb round trip, whole-record writes, the
// per-member row level security and the cascades. The in-memory twin is
// covered in src/domain/score-settings.test.ts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { getHouseholdConfig, updateHouseholdConfig } from "./household.js";
import { liveScoreSettingsStore } from "./score-settings.js";
import { liveSettingsStore } from "./settings.js";
import { setSqlForTests } from "./sql.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { SCORE_PRESETS } from "../domain/product-score.js";
import {
    scoreSettingsForViewer,
    updateHouseholdScoreDefault,
    updateMemberScoreSettings,
} from "../domain/score-settings.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

const CUSTOM = { nutrition: 5, processing: 10, additives: 15, environment: 70 };

describeDb(pgAvailable !== null, "score settings db", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let memberId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        ownerId = seeded.userId;
        memberId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${memberId}, ${`member-${memberId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    async function rowCount(userId: string): Promise<number> {
        const { sql } = getCtx();
        const [row] = (await sql`
            select count(*)::int as n
            from public.member_score_settings
            where user_id = ${userId}
        `) as { n: number }[];
        return row!.n;
    }

    test("custom weights round trip through jsonb", async () => {
        const { sql } = getCtx();
        const store = liveScoreSettingsStore();
        await asUser(
            ownerId,
            () =>
                updateMemberScoreSettings(store, householdId, ownerId, {
                    choice: { preset: "custom", weights: CUSTOM },
                }),
            householdId,
        );
        const [raw] = (await sql`
            select jsonb_typeof(weights) as kind, weights
            from public.member_score_settings
            where user_id = ${ownerId}
        `) as { kind: string; weights: unknown }[];
        expect(raw!.kind).toBe("object");
        expect(raw!.weights).toEqual(CUSTOM);

        const view = await asUser(
            ownerId,
            () => scoreSettingsForViewer(store, householdId, ownerId),
            householdId,
        );
        expect(view.weights).toEqual(CUSTOM);
        expect(view.member).toEqual({ preset: "custom", weights: CUSTOM });
    });

    test("a preset row stores no weights and a switch write keeps the whole record", async () => {
        const { sql } = getCtx();
        const store = liveScoreSettingsStore();
        await asUser(
            ownerId,
            async () => {
                await updateMemberScoreSettings(store, householdId, ownerId, {
                    choice: { preset: "planet", weights: null },
                    compareGoals: false,
                });
                await updateMemberScoreSettings(store, householdId, ownerId, {
                    warnTraces: false,
                });
            },
            householdId,
        );
        const [row] = (await sql`
            select preset, weights, warn_traces, compare_goals
            from public.member_score_settings
            where user_id = ${ownerId}
        `) as {
            preset: string;
            weights: unknown;
            warn_traces: boolean;
            compare_goals: boolean;
        }[];
        expect(row).toEqual({
            preset: "planet",
            weights: null,
            warn_traces: false,
            compare_goals: false,
        });
        expect(await rowCount(ownerId)).toBe(1);
    });

    test("a row with invalid weights jsonb falls back to its preset", async () => {
        const { sql } = getCtx();
        await sql`
            insert into public.member_score_settings (
                user_id, household_id, preset, weights
            )
            values (
                ${ownerId}, ${householdId}, ${"planet"},
                ${JSON.stringify({ nutrition: "lots" })}::jsonb
            )
        `;
        const view = await asUser(
            ownerId,
            () =>
                scoreSettingsForViewer(
                    liveScoreSettingsStore(),
                    householdId,
                    ownerId,
                ),
            householdId,
        );
        expect(view.weights).toEqual(SCORE_PRESETS.planet);
    });

    test("a custom row with all-zero weights is no choice: the household default applies", async () => {
        const { sql } = getCtx();
        await sql`
            insert into public.member_score_settings (
                user_id, household_id, preset, weights
            )
            values (
                ${ownerId}, ${householdId}, ${"custom"},
                ${JSON.stringify({ nutrition: 0, processing: 0, additives: 0, environment: 0 })}::jsonb
            )
        `;
        const store = liveScoreSettingsStore();
        await asUser(
            ownerId,
            () =>
                updateHouseholdScoreDefault(store, householdId, {
                    preset: "less_processed",
                    weights: null,
                }),
            householdId,
        );
        const view = await asUser(
            ownerId,
            () => scoreSettingsForViewer(store, householdId, ownerId),
            householdId,
        );
        expect(view.weights).toEqual(SCORE_PRESETS.less_processed);
    });

    test("the household default round trips and survives a config update and the grocery preferences", async () => {
        const { sql } = getCtx();
        const store = liveScoreSettingsStore();
        await asUser(
            ownerId,
            async () => {
                await updateHouseholdScoreDefault(store, householdId, {
                    preset: "custom",
                    weights: CUSTOM,
                });
                await liveSettingsStore().setGroceryPreferences(householdId, {
                    defaultStoreId: null,
                    useUsualStore: true,
                });
                const config = await getHouseholdConfig(householdId);
                await updateHouseholdConfig(householdId, {
                    ...config,
                    name: "Renamed",
                });
            },
            householdId,
        );
        const view = await asUser(
            memberId,
            () => scoreSettingsForViewer(store, householdId, memberId),
            householdId,
        );
        expect(view.householdDefault).toEqual({
            preset: "custom",
            weights: CUSTOM,
        });
        expect(view.weights).toEqual(CUSTOM);
        const [prefs] = (await sql`
            select household_preferences ->> 'grocery.use_usual_store' as usual
            from public.households where id = ${householdId}
        `) as { usual: string }[];
        expect(prefs!.usual).toBe("true");

        await asUser(
            ownerId,
            () => updateHouseholdScoreDefault(store, householdId, null),
            householdId,
        );
        const cleared = await asUser(
            memberId,
            () => scoreSettingsForViewer(store, householdId, memberId),
            householdId,
        );
        expect(cleared.householdDefault).toBeNull();
        expect(cleared.weights).toEqual(SCORE_PRESETS.balanced);
    });

    test("a member reads a housemate's settings but cannot write them", async () => {
        const store = liveScoreSettingsStore();
        await asUser(
            ownerId,
            () =>
                updateMemberScoreSettings(store, householdId, ownerId, {
                    choice: { preset: "planet", weights: null },
                }),
            householdId,
        );
        await asUser(
            memberId,
            async () => {
                expect(
                    (await store.getMember(householdId, ownerId))?.preset,
                ).toBe("planet");
                await expect(
                    updateMemberScoreSettings(store, householdId, ownerId, {
                        warnTraces: false,
                    }),
                ).rejects.toThrow();
            },
            householdId,
        );
        expect((await store.getMember(householdId, ownerId))?.warnTraces).toBe(
            true,
        );
    });

    test("a member of another household cannot read or write these rows", async () => {
        const { sql } = getCtx();
        await sql`drop index if exists public.households_singleton`;
        const other = await seedHousehold(sql);
        const store = liveScoreSettingsStore();
        await asUser(
            ownerId,
            () =>
                updateMemberScoreSettings(store, householdId, ownerId, {
                    choice: { preset: "planet", weights: null },
                }),
            householdId,
        );
        await asUser(
            other.userId,
            async () => {
                // Reads under their own household find nothing of ours …
                expect(await store.getMember(householdId, ownerId)).toBeNull();
                expect(await store.getHouseholdDefault(householdId)).toBeNull();
                // … writing as us, or into our household, is refused.
                await expect(
                    store.putMember({
                        userId: ownerId,
                        householdId,
                        preset: "health_first",
                        weights: null,
                        warnTraces: true,
                        compareGoals: true,
                        updatedAt: "",
                    }),
                ).rejects.toThrow();
                await expect(
                    store.putMember({
                        userId: other.userId,
                        householdId,
                        preset: "health_first",
                        weights: null,
                        warnTraces: true,
                        compareGoals: true,
                        updatedAt: "",
                    }),
                ).rejects.toThrow();
            },
            other.householdId,
        );
        const [row] = (await sql`
            select preset from public.member_score_settings
            where user_id = ${ownerId}
        `) as { preset: string }[];
        expect(row!.preset).toBe("planet");
        expect(await rowCount(other.userId)).toBe(0);
    });

    test("removing a member from the household takes their settings, not the owner's", async () => {
        const { sql } = getCtx();
        const store = liveScoreSettingsStore();
        await updateMemberScoreSettings(store, householdId, ownerId, {
            warnTraces: false,
        });
        await asUser(
            memberId,
            () =>
                updateMemberScoreSettings(store, householdId, memberId, {
                    warnTraces: false,
                }),
            householdId,
        );
        await sql`
            delete from public.household_members
            where household_id = ${householdId} and user_id = ${memberId}
        `;
        expect(await rowCount(memberId)).toBe(0);
        expect(await rowCount(ownerId)).toBe(1);
    });
});
