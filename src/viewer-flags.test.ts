import { describe, expect, test, afterEach } from "bun:test";
import {
    allFlagsOff,
    allFlagsOn,
    buildFlagContext,
    createMemoryFlags,
    defaultFlags,
    resetFlagsForTests,
} from "./flags.js";
import {
    evaluateViewerFlags,
    flagKey,
    isViewerFlagOn,
    defaultViewerFlags,
} from "./viewer-flags.js";

afterEach(() => {
    resetFlagsForTests();
});

const ctx = buildFlagContext({
    auth: { kind: "user", userId: "user-1" },
    member: {
        userId: "user-1",
        householdId: "hh-1",
        role: "owner",
        displayName: "Owner",
    },
});

describe("viewer-flags", () => {
    test("flagKey maps registry names to camelCase", () => {
        expect(flagKey("ui-v2")).toBe("uiV2");
        expect(flagKey("off-lookups")).toBe("offLookups");
        expect(flagKey("recipe-link-reader")).toBe("recipeLinkReader");
    });

    test("all flags on via memory reader", () => {
        const flags = evaluateViewerFlags(ctx, createMemoryFlags(allFlagsOn()));
        expect(flags.uiV2).toBe(true);
        expect(flags.offLookups).toBe(true);
        expect(isViewerFlagOn(flags, "ui-v2")).toBe(true);
    });

    test("all flags off via memory reader", () => {
        const flags = evaluateViewerFlags(
            ctx,
            createMemoryFlags(allFlagsOff()),
        );
        expect(flags.uiV2).toBe(false);
        expect(flags.barcodeCamera).toBe(false);
    });

    test("registry defaults match today's app", () => {
        const flags = evaluateViewerFlags(
            ctx,
            createMemoryFlags(defaultFlags()),
        );
        expect(flags.uiV2).toBe(false);
        expect(flags.offLookups).toBe(true);
    });

    test("function-valued memory flag reads context", () => {
        const flags = evaluateViewerFlags(
            ctx,
            createMemoryFlags({
                "ui-v2": (c) => c.role === "owner",
            }),
        );
        expect(flags.uiV2).toBe(true);
        const memberCtx = buildFlagContext({
            auth: { kind: "user", userId: "user-2" },
            member: {
                userId: "user-2",
                householdId: "hh-1",
                role: "member",
                displayName: "Member",
            },
        });
        expect(
            evaluateViewerFlags(
                memberCtx,
                createMemoryFlags({
                    "ui-v2": (c) => c.role === "owner",
                }),
            ).uiV2,
        ).toBe(false);
    });

    test("defaultViewerFlags is stable for fixtures", () => {
        const flags = defaultViewerFlags();
        expect(flags.uiV2).toBe(false);
        expect(flags.restockRunner).toBe(true);
    });
});
