import { describe, expect, test } from "bun:test";
import { createMemoryExportArchiveStore } from "./exports.js";

describe("createMemoryExportArchiveStore", () => {
    test("put overwrites the same user", async () => {
        const store = createMemoryExportArchiveStore();
        await store.put("u1", new Uint8Array([1]), 3600);
        await store.put("u1", new Uint8Array([2, 3]), 3600);
        expect(await store.read("u1")).toEqual(new Uint8Array([2, 3]));
    });

    test("expired row is not returned", async () => {
        const store = createMemoryExportArchiveStore();
        await store.put("u1", new Uint8Array([1]), -1);
        expect(await store.read("u1")).toBeNull();
    });

    test("sweep removes only expired rows", async () => {
        const store = createMemoryExportArchiveStore();
        const now = Date.now();
        store.rows.set("old", {
            archive: new Uint8Array([1]),
            expiresAt: now - 1000,
        });
        store.rows.set("new", {
            archive: new Uint8Array([2]),
            expiresAt: now + 60_000,
        });
        await store.sweepExpired();
        expect(store.rows.has("old")).toBe(false);
        expect(store.rows.has("new")).toBe(true);
    });

    test("remove deletes the user row", async () => {
        const store = createMemoryExportArchiveStore();
        await store.put("u1", new Uint8Array([1]), 3600);
        await store.remove("u1");
        expect(await store.read("u1")).toBeNull();
    });
});
