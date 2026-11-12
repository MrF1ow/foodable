/** Longest goal name a member can give their goals ("Recomp"). */
export const GOAL_NAME_MAX = 40;
/** Longest note kept beside the name. */
export const GOAL_NOTE_MAX = 280;

export type GoalLabelField = "goal_name" | "goal_note";

const LIMITS: Record<GoalLabelField, number> = {
    goal_name: GOAL_NAME_MAX,
    goal_note: GOAL_NOTE_MAX,
};

/**
 * Normalise a goal name or note for storage: trimmed, and blank means "none"
 * (null), never an empty string. Throws a message fit for the caller when the
 * text is longer than the column allows. Length counts characters the way
 * Postgres `char_length` does, so a name that passes here passes the check.
 */
export function cleanGoalLabel(
    field: GoalLabelField,
    value: string | null,
): string | null {
    if (value === null) return null;
    const text = value.trim();
    if (text === "") return null;
    const max = LIMITS[field];
    if ([...text].length > max) {
        const label = field === "goal_name" ? "Goal name" : "Goal note";
        throw new Error(`${label} must be at most ${max} characters.`);
    }
    return text;
}
