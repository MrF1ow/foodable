import {
    DEFAULT_SCORE_PRESET,
    parseScoreChoice,
    resolveWeights,
    validateScoreChoice,
    type ScoreChoice,
    type ScoreChoicePreset,
    type ScoreWeights,
} from "./product-score.js";

/** Key in `households.household_preferences` holding the household's default choice. */
export const SCORE_DEFAULT_KEY = "score.default";

/**
 * `household` means the member has no choice of their own: the household
 * default applies. A row exists for such a member as soon as they flip a switch.
 */
export type MemberScorePreset = ScoreChoicePreset | "household";

export type MemberScoreSettings = {
    userId: string;
    householdId: string;
    preset: MemberScorePreset;
    weights: ScoreWeights | null;
    warnTraces: boolean;
    compareGoals: boolean;
    updatedAt: string;
};

export type MemberScoreSettingsRow = {
    user_id: string;
    household_id: string;
    preset: string;
    weights: unknown;
    warn_traces: boolean;
    compare_goals: boolean;
    updated_at: string | Date;
};

/** What a member without a row gets: no own choice, both switches on. */
export const DEFAULT_MEMBER_SCORE_SETTINGS = {
    warnTraces: true,
    compareGoals: true,
} as const;

export class ScoreSettingsInputError extends Error {}

export type ScoreSettingsStore = {
    getMember(
        householdId: string,
        userId: string,
    ): Promise<MemberScoreSettings | null>;
    /** Upserts the whole record; nothing is merged here. */
    putMember(row: MemberScoreSettings): Promise<MemberScoreSettings>;
    /** The household's default, or null when none is set (or it is unreadable). */
    getHouseholdDefault(householdId: string): Promise<ScoreChoice | null>;
    /** Writes the default (null clears it). Other household preferences stay. */
    setHouseholdDefault(
        householdId: string,
        choice: ScoreChoice | null,
    ): Promise<void>;
};

/**
 * Maps a stored row. The weights jsonb is validated on read: a preset keeps
 * the preset and drops the weights, invalid custom weights become null, and
 * a preset this build does not know is `household` (no own choice).
 */
export function memberScoreSettingsFromRow(
    row: MemberScoreSettingsRow,
): MemberScoreSettings {
    const choice = parseScoreChoice({
        preset: row.preset,
        weights: row.weights,
    });
    return {
        userId: String(row.user_id),
        householdId: String(row.household_id),
        preset: choice ? choice.preset : "household",
        weights: choice ? choice.weights : null,
        warnTraces: row.warn_traces !== false,
        compareGoals: row.compare_goals !== false,
        updatedAt:
            row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : String(row.updated_at),
    };
}

export function memberScoreSettingsToRow(row: MemberScoreSettings) {
    return {
        user_id: row.userId,
        household_id: row.householdId,
        preset: row.preset,
        weights: row.preset === "custom" ? row.weights : null,
        warn_traces: row.warnTraces,
        compare_goals: row.compareGoals,
    };
}

/** The member's own choice, or null when they follow the household. */
export function choiceOfMember(
    settings: MemberScoreSettings | null,
): ScoreChoice | null {
    if (!settings || settings.preset === "household") return null;
    return { preset: settings.preset, weights: settings.weights };
}

export type ViewerScoreSettings = {
    /** The member's own choice; null when they follow the household. */
    member: ScoreChoice | null;
    householdDefault: ScoreChoice | null;
    weights: ScoreWeights;
    /** Which preset the weights come from: the one a viewer would call theirs. */
    preset: ScoreChoicePreset;
    warnTraces: boolean;
    compareGoals: boolean;
};

/** A choice that yields weights: a preset, or custom with usable weights. */
export function isUsableChoice(
    choice: ScoreChoice | null,
): choice is ScoreChoice {
    return (
        choice != null && (choice.preset !== "custom" || choice.weights != null)
    );
}

function viewerSettingsFrom(
    row: MemberScoreSettings | null,
    householdDefault: ScoreChoice | null,
): ViewerScoreSettings {
    const member = choiceOfMember(row);
    return {
        member,
        householdDefault,
        weights: resolveWeights(member, householdDefault),
        preset: isUsableChoice(member)
            ? member.preset
            : isUsableChoice(householdDefault)
              ? householdDefault.preset
              : DEFAULT_SCORE_PRESET,
        warnTraces: row?.warnTraces ?? DEFAULT_MEMBER_SCORE_SETTINGS.warnTraces,
        compareGoals:
            row?.compareGoals ?? DEFAULT_MEMBER_SCORE_SETTINGS.compareGoals,
    };
}

/** Everything a score or check for this viewer needs, in one read. */
export async function scoreSettingsForViewer(
    store: ScoreSettingsStore,
    householdId: string,
    userId: string,
): Promise<ViewerScoreSettings> {
    const [row, householdDefault] = await Promise.all([
        store.getMember(householdId, userId),
        store.getHouseholdDefault(householdId),
    ]);
    return viewerSettingsFrom(row, householdDefault);
}

/** For a caller with no member of their own (a household token): the household's default. */
export async function scoreSettingsForHousehold(
    store: ScoreSettingsStore,
    householdId: string,
): Promise<ViewerScoreSettings> {
    return viewerSettingsFrom(
        null,
        await store.getHouseholdDefault(householdId),
    );
}

export type MemberScoreSettingsPatch = {
    /** A choice to save; null means follow the household default. */
    choice?: ScoreChoice | null;
    warnTraces?: boolean;
    compareGoals?: boolean;
};

/**
 * Saves a member's settings. The record is read, the patch applied and the
 * whole record written back, so changing one field keeps the rest.
 */
export async function updateMemberScoreSettings(
    store: ScoreSettingsStore,
    householdId: string,
    userId: string,
    patch: MemberScoreSettingsPatch,
): Promise<MemberScoreSettings> {
    let choice: ScoreChoice | null | undefined;
    if (patch.choice !== undefined) {
        choice = patch.choice === null ? null : checkedChoice(patch.choice);
    }
    const existing = await store.getMember(householdId, userId);
    const base: MemberScoreSettings = existing ?? {
        userId,
        householdId,
        preset: "household",
        weights: null,
        ...DEFAULT_MEMBER_SCORE_SETTINGS,
        updatedAt: "",
    };
    const next: MemberScoreSettings = {
        ...base,
        warnTraces: patch.warnTraces ?? base.warnTraces,
        compareGoals: patch.compareGoals ?? base.compareGoals,
    };
    if (choice !== undefined) {
        next.preset = choice ? choice.preset : "household";
        next.weights = choice ? choice.weights : null;
    }
    return store.putMember(next);
}

/** Owners and admins set this; the caller checks the role. */
export async function updateHouseholdScoreDefault(
    store: ScoreSettingsStore,
    householdId: string,
    choice: ScoreChoice | null,
): Promise<void> {
    await store.setHouseholdDefault(
        householdId,
        choice === null ? null : checkedChoice(choice),
    );
}

function checkedChoice(choice: ScoreChoice): ScoreChoice {
    const checked = validateScoreChoice(choice);
    if (!checked.ok) throw new ScoreSettingsInputError(checked.error);
    return checked.value;
}

export type MemoryScoreSettingsStore = ScoreSettingsStore;

export function createMemoryScoreSettingsStore(): MemoryScoreSettingsStore {
    const members = new Map<string, MemberScoreSettings>();
    const defaults = new Map<string, ScoreChoice>();
    const key = (householdId: string, userId: string) =>
        `${householdId}:${userId}`;
    return {
        async getMember(householdId, userId) {
            const row = members.get(key(householdId, userId));
            return row ? { ...row } : null;
        },
        async putMember(row) {
            const saved = { ...row, updatedAt: new Date().toISOString() };
            members.set(key(row.householdId, row.userId), saved);
            return { ...saved };
        },
        async getHouseholdDefault(householdId) {
            const choice = defaults.get(householdId);
            return choice ? { ...choice } : null;
        },
        async setHouseholdDefault(householdId, choice) {
            if (choice === null) defaults.delete(householdId);
            else defaults.set(householdId, { ...choice });
        },
    };
}
