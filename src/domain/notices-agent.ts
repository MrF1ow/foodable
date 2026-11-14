/**
 * The "your agent changed something" notice: derived on read from the
 * household's recent agent actions that can still be undone. It is not a
 * `Notice` of the registry: it has no subject row to dismiss (the dismissal
 * table keys on food, recipe, fridge and grocery rows), and it stays out of
 * `list_notices` and the Needs attention count on purpose. It goes away when
 * the change is undone or its 24 hours pass.
 */
import type { AgentActionEntry } from "./agent-actions.js";

/** Most rows the strip shows; the rest are in Settings › AI connections. */
export const AGENT_NOTICE_LIMIT = 3;

/** How many recent actions to read for the strip. */
export const AGENT_NOTICE_SCAN = 10;

export type AgentActionNotice = {
    actionId: string;
    /** "Cleared 20 grocery lines (by Claude)". */
    sentence: string;
};

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

export function agentActionNotices(
    entries: readonly AgentActionEntry[],
    opts: { now: Date; viewerUserId: string; isOwner: boolean },
): AgentActionNotice[] {
    const viewer = { userId: opts.viewerUserId, isOwner: opts.isOwner };
    return entries
        .filter(
            (entry) =>
                entry.canUndo &&
                entry.undoneAt === null &&
                opts.now.getTime() < Date.parse(entry.undoExpiresAt) &&
                mayUndoAgentAction(entry, viewer),
        )
        .slice(0, AGENT_NOTICE_LIMIT)
        .map((entry) => ({
            actionId: entry.id,
            sentence: `${entry.summary} (by ${entry.connection})`,
        }));
}
