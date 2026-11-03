import { describe, expect, test } from "bun:test";
import { createMemoryExportArchiveStore } from "./exports.js";

describe("createMemoryExportArchiveStore", () => {
    test("upload overwrite", async () => {
        const store = createMemoryExportArchiveStore();
        await store.upload("u1/a.zip", new Uint8Array([1]));
        await store.upload("u1/a.zip", new Uint8Array([2, 3]));
        expect(store.files.get("u1/a.zip")?.archive).toEqual(
            new Uint8Array([2, 3]),
        );
    });

    test("signedUrl for missing path throws", async () => {
        const store = createMemoryExportArchiveStore();
        await expect(store.signedUrl("missing.zip", 60)).rejects.toThrow(
            "Failed to create download link",
        );
    });

    test("signedUrl for uploaded path", async () => {
        const store = createMemoryExportArchiveStore();
        await store.upload("u1/a.zip", new Uint8Array([1]));
        expect(await store.signedUrl("u1/a.zip", 3600)).toBe(
            "memory://exports/u1/a.zip?ttl=3600",
        );
    });

    test("sweep cutoff", async () => {
        const store = createMemoryExportArchiveStore();
        const now = Date.now();
        store.files.set("old.zip", {
            archive: new Uint8Array([1]),
            updatedAt: now - 10_000,
        });
        store.files.set("new.zip", {
            archive: new Uint8Array([2]),
            updatedAt: now,
        });
        await store.sweepOlderThan(now - 5_000);
        expect(store.files.has("old.zip")).toBe(false);
        expect(store.files.has("new.zip")).toBe(true);
    });

    test("remove of missing path is not an error", async () => {
        const store = createMemoryExportArchiveStore();
        await expect(
            store.remove(["never-uploaded.zip"]),
        ).resolves.toBeUndefined();
    });
});
