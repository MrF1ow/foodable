import { describe, expect, test } from "bun:test";
import {
    PIN_TTL_MS,
    decideKillSwitch,
    decideTemporary,
    flagSubject,
    pinFromRow,
    snapshotFromRows,
    truncateReason,
} from "./flag-pins.js";
import type { FlagEvaluation } from "../flags.js";

const live = (over: Partial<FlagEvaluation> = {}): FlagEvaluation => ({
    flag: "mcp-widgets-v2",
    value: true,
    reason: "TARGETING_MATCH",
    source: "railway",
    ...over,
});

describe("flagSubject", () => {
    test("user flags use the user id, household flags the household", () => {
        const ctx = { key: "u1", household_id: "h1" };
        expect(flagSubject("user", ctx)).toEqual({ kind: "user", id: "u1" });
        expect(flagSubject("household", ctx)).toEqual({
            kind: "household",
            id: "h1",
        });
    });

    test("a household-token key has no user subject", () => {
        expect(flagSubject("user", { key: "hh:h1", household_id: "h1" })).toBe(
            null,
        );
        expect(flagSubject("household", { key: "hh:h1" })).toBe(null);
    });
});

describe("row mappers", () => {
    test("pinFromRow reads a boolean pin and ignores other json", () => {
        const row = {
            flag_name: "mcp-widgets-v2",
            value: true,
            reason: "SPLIT",
            epoch: 2,
            assigned_at: "2026-11-08T10:00:00+00:00",
            expires_at: "2026-11-08T22:00:00+00:00",
        };
        expect(pinFromRow(row)).toEqual({
            flag: "mcp-widgets-v2",
            value: true,
            reason: "SPLIT",
            epoch: 2,
            assignedAt: Date.parse("2026-11-08T10:00:00Z"),
            expiresAt: Date.parse("2026-11-08T22:00:00Z"),
        });
        expect(pinFromRow({ ...row, value: "true" })).toBeNull();
        expect(pinFromRow({ ...row, value: null })).toBeNull();
        expect(pinFromRow({ ...row, expires_at: "nope" })).toBeNull();
    });

    test("snapshotFromRows keeps only boolean values", () => {
        const map = snapshotFromRows([
            { flag_name: "a", value: true },
            { flag_name: "b", value: false },
            { flag_name: "c", value: 1 },
        ]);
        expect([...map]).toEqual([
            ["a", true],
            ["b", false],
        ]);
    });

    test("truncateReason caps at 64 and never returns empty", () => {
        expect(truncateReason("x".repeat(70)).length).toBe(64);
        expect(truncateReason("")).toBe("UNKNOWN");
    });
});

describe("decideTemporary", () => {
    const base = {
        fallback: false,
        pin: undefined,
        pinsLoaded: true,
        hasSubject: true,
        epoch: { value: 0, reliable: true },
        now: 1000,
    };

    test("a non-Railway source passes through", () => {
        const e = live({ source: "env", reason: "ENV_ALL" });
        expect(decideTemporary({ ...base, live: e })).toEqual({
            evaluation: e,
        });
    });

    test("an expired pin counts as no pin", () => {
        const pin = {
            flag: "mcp-widgets-v2",
            value: false,
            reason: "NO_MATCH",
            epoch: 0,
            assignedAt: 0,
            expiresAt: 1000,
        };
        const d = decideTemporary({ ...base, live: live(), pin });
        expect(d.evaluation.value).toBe(true);
        expect(d.write?.expiresAt).toBe(1000 + PIN_TTL_MS);
    });

    test("PARENT_OFF is a reliable result and pins off", () => {
        const d = decideTemporary({
            ...base,
            live: live({ value: false, reason: "PARENT_OFF" }),
        });
        expect(d.evaluation.value).toBe(false);
        expect(d.write?.reason).toBe("PARENT_OFF");
    });
});

describe("decideKillSwitch", () => {
    test("env-sourced kill switches are served as read and never snapshotted", () => {
        const d = decideKillSwitch({
            live: live({ source: "env", reason: "ENV_OFF", value: false }),
            fallback: true,
            memory: undefined,
            snapshot: undefined,
        });
        expect(d.evaluation.value).toBe(false);
        expect(d.saveSnapshot).toBeUndefined();
    });
});
