import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildZip } from "../zip.js";
import {
    createMemoryExportArchiveStore,
    liveExportArchiveStore,
} from "./exports.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "export archives db", (getCtx) => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        await sql`
            insert into public.users (id, email)
            values (${userId}, ${"export@test.local"})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("upsert overwrites and round-trips ZIP bytes", async () => {
        const store = liveExportArchiveStore();
        const zip = buildZip(
            [{ name: "meals.csv", data: "id\n1\n" }],
            new Date("2026-01-01T00:00:00.000Z"),
        );
        await store.put(userId, zip, 3600);
        const first = await store.read(userId);
        expect(first).toEqual(zip);

        const zip2 = buildZip(
            [{ name: "meals.csv", data: "id\n2\n" }],
            new Date("2026-01-02T00:00:00.000Z"),
        );
        await store.put(userId, zip2, 3600);
        expect(await store.read(userId)).toEqual(zip2);
    });

    test("expired row is not returned", async () => {
        const store = liveExportArchiveStore();
        await store.put(userId, new Uint8Array([0x50, 0x4b]), -1);
        expect(await store.read(userId)).toBeNull();
    });

    test("sweep removes only expired rows", async () => {
        const { sql } = getCtx();
        const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        await sql`
            insert into public.users (id, email)
            values (${otherId}, ${"other@test.local"})
        `;
        const store = liveExportArchiveStore();
        await store.put(userId, new Uint8Array([1]), -1);
        await store.put(otherId, new Uint8Array([2]), 3600);
        await store.sweepExpired();
        const [{ n: expired }] = await sql`
            select count(*)::int as n from export_archives where user_id = ${userId}
        `;
        const [{ n: kept }] = await sql`
            select count(*)::int as n from export_archives where user_id = ${otherId}
        `;
        expect(expired).toBe(0);
        expect(kept).toBe(1);
    });

    test("remove deletes the row", async () => {
        const { sql } = getCtx();
        const store = liveExportArchiveStore();
        await store.put(userId, new Uint8Array([1]), 3600);
        await store.remove(userId);
        const [{ n }] = await sql`
            select count(*)::int as n from export_archives where user_id = ${userId}
        `;
        expect(n).toBe(0);
    });

    test("cascade from public.users", async () => {
        const { sql } = getCtx();
        const store = liveExportArchiveStore();
        await store.put(userId, new Uint8Array([1]), 3600);
        await sql`delete from public.users where id = ${userId}`;
        const [{ n }] = await sql`
            select count(*)::int as n from export_archives
        `;
        expect(n).toBe(0);
    });
});
