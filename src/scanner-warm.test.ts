import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    resetScannerAssetsForTest,
    warmScannerAssets,
    warmWidgets,
} from "./widgets.js";

function withScannerBuildFailure<T>(fn: () => Promise<T>): Promise<T> {
    const original = Bun.build;
    Bun.build = (async (opts) => {
        const entry = opts?.entrypoints?.[0] ?? "";
        if (String(entry).includes("scanner-zxing-entry")) {
            return {
                success: false,
                logs: [{ message: "forced test failure" }],
            } as Awaited<ReturnType<typeof Bun.build>>;
        }
        return original(opts as Parameters<typeof Bun.build>[0]);
    }) as typeof Bun.build;
    return fn().finally(() => {
        Bun.build = original;
    });
}

beforeEach(() => {
    resetScannerAssetsForTest();
});

afterEach(() => {
    resetScannerAssetsForTest();
});

describe("scanner asset warm", () => {
    test("warmScannerAssets resolves false when the bundle build fails", async () => {
        const ok = await withScannerBuildFailure(() => warmScannerAssets());
        expect(ok).toBe(false);
    });

    test("warmWidgets still resolves when scanner assets fail", async () => {
        await expect(
            withScannerBuildFailure(() => warmWidgets()),
        ).resolves.toBeUndefined();
    });
});
