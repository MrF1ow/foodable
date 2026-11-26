/**
 * Who may undo an agent's change: the owner, or the member the agent acted as.
 * Settings › AI connections reads it to decide which rows offer Undo.
 */
import type { AgentActionEntry } from "./agent-actions.js";

/** Whether this person may undo the action: the owner, or the member the agent acted as. */
export function mayUndoAgentAction(
    entry: Pick<AgentActionEntry, "memberId">,
    viewer: { userId: string; isOwner: boolean },
): boolean {
    return (
        viewer.isOwner ||
        (entry.memberId !== null && entry.memberId === viewer.userId)
    );
}
