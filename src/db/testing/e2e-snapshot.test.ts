import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { SQL } from "bun";
import { findPgBin } from "./pg-shared.js";
import {
    createMigratedDatabase,
    DB_SETUP_TIMEOUT_MS,
    prepareMigratedTemplate,
} from "./pg.js";
import {
    e2eRehearseRestore,
    e2eRestore,
    e2eSnapshot,
    publicRowFingerprint,
} from "./e2e-snapshot.js";
import { seedSource } from "./import-postgres-data.test.js";

const pgAvailable = !!(await findPgBin());

if (pgAvailable) beforeAll(prepareMigratedTemplate, DB_SETUP_TIMEOUT_MS);

test.skipIf(!pgAvailable)(
    "e2e snapshot and restore preserve public data",
    async () => {
        const pg = await createMigratedDatabase();
        const snap = join(pg.dir, "e2e-snap.sql");
        try {
            await seedSource(pg.url);

            const before = await publicRowFingerprint(pg.url);
            await e2eSnapshot(pg.url, snap);

            const sql2 = new SQL(pg.url, { prepare: false, max: 1 });
            await sql2`delete from public.meal_items`;
            await sql2`delete from public.meals`;
            await sql2.close();

            const mid = await publicRowFingerprint(pg.url);
            expect(mid).not.toBe(before);

            // The rehearsal runs the same restore and rolls it back.
            await e2eRehearseRestore(pg.url, snap);
            expect(await publicRowFingerprint(pg.url)).toBe(mid);

            await e2eRestore(pg.url, snap);
            const after = await publicRowFingerprint(pg.url);
            expect(after).toBe(before);
        } finally {
            await pg.stop();
        }
    },
);
