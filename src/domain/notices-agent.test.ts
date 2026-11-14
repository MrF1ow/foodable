import { describe, expect, test } from "bun:test";
import type { AgentActionEntry } from "./agent-actions.js";
import {
    AGENT_NOTICE_LIMIT,
    agentActionNotices,
    mayUndoAgentAction,
} from "./notices-agent.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const OWNER = "owner-1";
const SAM = "member-sam";
const ALEX = "member-alex";

function entry(over: Partial<AgentActionEntry> = {}): AgentActionEntry {
    return {
        id: crypto.randomUUID(),
        householdId: "hh-1",
        memberId: SAM,
        connection: "Claude",
        tool: "clear_checked_grocery_lines",
        summary: "Cleared 20 grocery lines",
        createdAt: "2026-11-13T10:00:00.000Z",
        undoExpiresAt: "2026-11-14T10:00:00.000Z",
        undoneAt: null,
        canUndo: true,
        ...over,
    };
}

const opts = (viewerUserId: string, isOwner = false) => ({
    now: NOW,
    viewerUserId,
    isOwner,
});

describe("agentActionNotices", () => {
    test("says what the agent did and who it was, for a change still undoable", () => {
        const [notice] = agentActionNotices([entry()], opts(OWNER, true));
        expect(notice?.sentence).toBe("Cleared 20 grocery lines (by Claude)");
    });

    test("leaves out changes that were undone, expired, or never undoable", () => {
        const entries = [
            entry({ undoneAt: "2026-11-13T11:00:00.000Z" }),
            entry({ undoExpiresAt: "2026-11-13T11:59:00.000Z" }),
            entry({ undoExpiresAt: "2026-11-13T12:00:00.000Z" }),
            entry({ canUndo: false }),
        ];
        expect(agentActionNotices(entries, opts(OWNER, true))).toEqual([]);
    });

    test("only for a viewer who may undo: the owner, or the member the agent acted as", () => {
        const sams = entry({ memberId: SAM });
        const tokens = entry({ memberId: null });
        expect(
            agentActionNotices([sams, tokens], opts(OWNER, true)),
        ).toHaveLength(2);
        expect(agentActionNotices([sams, tokens], opts(SAM))).toHaveLength(1);
        expect(agentActionNotices([sams, tokens], opts(ALEX))).toEqual([]);
    });

    test("shows the newest few and keeps their order", () => {
        const many = Array.from({ length: 6 }, (_, n) =>
            entry({ summary: `Change ${n}` }),
        );
        const out = agentActionNotices(many, opts(OWNER, true));
        expect(out).toHaveLength(AGENT_NOTICE_LIMIT);
        expect(out.map((n) => n.sentence.split(" (")[0])).toEqual([
            "Change 0",
            "Change 1",
            "Change 2",
        ]);
    });

    test("is empty when there is nothing to say", () => {
        expect(agentActionNotices([], opts(OWNER, true))).toEqual([]);
    });
});

describe("mayUndoAgentAction", () => {
    test("a household-token change is undone by the owner alone", () => {
        const e = { memberId: null };
        expect(mayUndoAgentAction(e, { userId: SAM, isOwner: false })).toBe(
            false,
        );
        expect(mayUndoAgentAction(e, { userId: OWNER, isOwner: true })).toBe(
            true,
        );
    });
});
