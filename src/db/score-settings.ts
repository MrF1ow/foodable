import { parseScoreChoice } from "../domain/product-score.js";
import {
    memberScoreSettingsFromRow,
    memberScoreSettingsToRow,
    SCORE_DEFAULT_KEY,
    type MemberScoreSettingsRow,
    type ScoreSettingsStore,
} from "../domain/score-settings.js";
import { maybeOne, pgError, run } from "./sql.js";

const HOUSEHOLDS = "households";
const MEMBER_SCORE_SETTINGS = "member_score_settings";
const COLS =
    "user_id, household_id, preset, weights, warn_traces, compare_goals, updated_at";

export function liveScoreSettingsStore(): ScoreSettingsStore {
    return {
        async getMember(householdId, userId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<MemberScoreSettingsRow>(
                        tx,
                        tx`
                            select ${tx.unsafe(COLS)}
                            from ${tx.unsafe(MEMBER_SCORE_SETTINGS)}
                            where household_id = ${householdId}
                              and user_id = ${userId}
                        `,
                        "load score settings",
                    );
                    return data ? memberScoreSettingsFromRow(data) : null;
                } catch (err) {
                    throw pgError("load score settings", err);
                }
            });
        },
        async putMember(settings) {
            const row = memberScoreSettingsToRow(settings);
            const weightsJson =
                row.weights === null ? null : JSON.stringify(row.weights);
            return run(async (tx) => {
                try {
                    const data = await maybeOne<MemberScoreSettingsRow>(
                        tx,
                        tx`
                            insert into ${tx.unsafe(MEMBER_SCORE_SETTINGS)} (
                                user_id, household_id, preset, weights,
                                warn_traces, compare_goals
                            )
                            values (
                                ${row.user_id}, ${row.household_id},
                                ${row.preset}, ${weightsJson}::jsonb,
                                ${row.warn_traces}, ${row.compare_goals}
                            )
                            on conflict (user_id) do update
                            set preset = excluded.preset,
                                weights = excluded.weights,
                                warn_traces = excluded.warn_traces,
                                compare_goals = excluded.compare_goals,
                                updated_at = now()
                            returning ${tx.unsafe(COLS)}
                        `,
                        "save score settings",
                    );
                    if (!data) throw new Error("no row returned");
                    return memberScoreSettingsFromRow(data);
                } catch (err) {
                    throw pgError("save score settings", err);
                }
            });
        },
        async getHouseholdDefault(householdId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ choice: unknown }>(
                        tx,
                        tx`
                            select household_preferences -> ${SCORE_DEFAULT_KEY}::text
                                as choice
                            from ${tx.unsafe(HOUSEHOLDS)}
                            where id = ${householdId}
                        `,
                        "load household score default",
                    );
                    return parseScoreChoice(data?.choice);
                } catch (err) {
                    throw pgError("load household score default", err);
                }
            });
        },
        async setHouseholdDefault(householdId, choice) {
            return run(async (tx) => {
                try {
                    const json =
                        choice === null ? null : JSON.stringify(choice);
                    const data = await maybeOne<{ id: unknown }>(
                        tx,
                        tx`
                            update ${tx.unsafe(HOUSEHOLDS)}
                            set household_preferences =
                                (coalesce(household_preferences, '{}'::jsonb)
                                    - ${SCORE_DEFAULT_KEY}::text)
                                || jsonb_strip_nulls(jsonb_build_object(
                                    ${SCORE_DEFAULT_KEY}::text,
                                    ${json}::jsonb
                                ))
                            where id = ${householdId}
                            returning id
                        `,
                        "save household score default",
                    );
                    if (!data) throw new Error("Unknown household.");
                } catch (err) {
                    throw pgError("save household score default", err);
                }
            });
        },
    };
}
