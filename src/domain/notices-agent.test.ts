import { describe, expect, test } from "bun:test";
import { mayUndoAgentAction } from "./notices-agent.js";

const OWNER = "owner-1";
const SAM = "member-sam";

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
