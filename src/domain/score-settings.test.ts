import { expect, test } from "bun:test";
import { SCORE_PRESETS } from "./product-score.js";
import {
    createMemoryScoreSettingsStore,
    DEFAULT_MEMBER_SCORE_SETTINGS,
    memberScoreSettingsFromRow,
    memberScoreSettingsToRow,
    ScoreSettingsInputError,
    scoreSettingsForViewer,
    updateHouseholdScoreDefault,
    updateMemberScoreSettings,
} from "./score-settings.js";

const HH = "hh-1";
const ME = "user-1";

test("a member with no row gets the defaults: no choice, both switches on", async () => {
    const store = createMemoryScoreSettingsStore();
    const view = await scoreSettingsForViewer(store, HH, ME);
    expect(view.member).toBeNull();
    expect(view.warnTraces).toBe(true);
    expect(view.compareGoals).toBe(true);
    expect(view.weights).toEqual(SCORE_PRESETS.balanced);
    expect(DEFAULT_MEMBER_SCORE_SETTINGS.warnTraces).toBe(true);
});

test("the household default applies to a member without a row", async () => {
    const store = createMemoryScoreSettingsStore();
    await updateHouseholdScoreDefault(store, HH, {
        preset: "planet",
        weights: null,
    });
    const view = await scoreSettingsForViewer(store, HH, ME);
    expect(view.weights).toEqual(SCORE_PRESETS.planet);
    // another household is untouched
    const other = await scoreSettingsForViewer(store, "hh-2", ME);
    expect(other.weights).toEqual(SCORE_PRESETS.balanced);
});

test("a member's own choice beats the household default", async () => {
    const store = createMemoryScoreSettingsStore();
    await updateHouseholdScoreDefault(store, HH, {
        preset: "planet",
        weights: null,
    });
    await updateMemberScoreSettings(store, HH, ME, {
        choice: { preset: "health_first", weights: null },
    });
    const view = await scoreSettingsForViewer(store, HH, ME);
    expect(view.weights).toEqual(SCORE_PRESETS.health_first);
});

test("updating one switch keeps the choice and the other switch", async () => {
    const store = createMemoryScoreSettingsStore();
    await updateMemberScoreSettings(store, HH, ME, {
        choice: { preset: "less_processed", weights: null },
        compareGoals: false,
    });
    await updateMemberScoreSettings(store, HH, ME, { warnTraces: false });
    const row = await store.getMember(HH, ME);
    expect(row).toMatchObject({
        userId: ME,
        householdId: HH,
        preset: "less_processed",
        weights: null,
        warnTraces: false,
        compareGoals: false,
    });
    await updateMemberScoreSettings(store, HH, ME, { compareGoals: true });
    expect((await store.getMember(HH, ME))?.warnTraces).toBe(false);
});

test("switching only a switch on a member with no row starts from the defaults and stores no choice resolving to a preset", async () => {
    const store = createMemoryScoreSettingsStore();
    await updateHouseholdScoreDefault(store, HH, {
        preset: "planet",
        weights: null,
    });
    await updateMemberScoreSettings(store, HH, ME, { warnTraces: false });
    const view = await scoreSettingsForViewer(store, HH, ME);
    expect(view.warnTraces).toBe(false);
    // the switch write did not pin the member to Balanced: the default still applies
    expect(view.weights).toEqual(SCORE_PRESETS.planet);
    expect((await store.getMember(HH, ME))?.preset).toBe("household");
    expect(view.member).toBeNull();
});

test("custom weights are stored and resolve; zero-sum custom is rejected without writing", async () => {
    const store = createMemoryScoreSettingsStore();
    const weights = {
        nutrition: 5,
        processing: 5,
        additives: 5,
        environment: 85,
    };
    await updateMemberScoreSettings(store, HH, ME, {
        choice: { preset: "custom", weights },
    });
    expect((await scoreSettingsForViewer(store, HH, ME)).weights).toEqual(
        weights,
    );

    await expect(
        updateMemberScoreSettings(store, HH, ME, {
            choice: {
                preset: "custom",
                weights: {
                    nutrition: 0,
                    processing: 0,
                    additives: 0,
                    environment: 0,
                },
            },
        }),
    ).rejects.toBeInstanceOf(ScoreSettingsInputError);
    await expect(
        updateHouseholdScoreDefault(store, HH, {
            preset: "custom",
            weights: null,
        }),
    ).rejects.toBeInstanceOf(ScoreSettingsInputError);
    expect((await scoreSettingsForViewer(store, HH, ME)).weights).toEqual(
        weights,
    );
});

test("row mappers round-trip and an invalid jsonb row falls back to its preset", () => {
    const row = {
        ...memberScoreSettingsToRow({
            userId: ME,
            householdId: HH,
            preset: "custom",
            weights: {
                nutrition: 1,
                processing: 2,
                additives: 3,
                environment: 4,
            },
            warnTraces: false,
            compareGoals: true,
            updatedAt: "2026-11-12T10:00:00.000Z",
        }),
        updated_at: "2026-11-12T10:00:00.000Z",
    };
    expect(row.weights).toEqual({
        nutrition: 1,
        processing: 2,
        additives: 3,
        environment: 4,
    });
    expect(memberScoreSettingsFromRow(row)).toMatchObject({
        preset: "custom",
        weights: { nutrition: 1, processing: 2, additives: 3, environment: 4 },
        warnTraces: false,
    });
    const broken = memberScoreSettingsFromRow({
        ...row,
        preset: "planet",
        weights: { nutrition: "lots" },
    });
    expect(broken).toMatchObject({ preset: "planet", weights: null });
    // an unknown preset in the row is no own choice: the household default applies
    expect(
        memberScoreSettingsFromRow({ ...row, preset: "keto", weights: null }),
    ).toMatchObject({ preset: "household", weights: null });
});
