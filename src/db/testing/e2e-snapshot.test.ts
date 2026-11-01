import { expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "../migrate.js";
import { SQL } from "bun";
import { findPgBin } from "./pg-shared.js";
import { startTempPostgres } from "./pg-temp.js";
import {
    e2eRestore,
    e2eSnapshot,
    publicRowFingerprint,
} from "./e2e-snapshot.js";
import { seedSource } from "./import-supabase-data.test.js";

const pgAvailable = !!(await findPgBin());

test.skipIf(!pgAvailable)(
    "e2e snapshot and restore preserve public data",
    async () => {
        const pg = await startTempPostgres();
        const snap = join(pg.dir, "e2e-snap.sql");
        try {
            const sql = new SQL(pg.url, { prepare: false, max: 1 });
            await migrate(sql);
            await sql.close();
            await seedSource(pg.url);

            const before = await publicRowFingerprint(pg.url);
            await e2eSnapshot(pg.url, snap);

            const sql2 = new SQL(pg.url, { prepare: false, max: 1 });
            await sql2`delete from public.meal_items`;
            await sql2`delete from public.meals`;
            await sql2.close();

            const mid = await publicRowFingerprint(pg.url);
            expect(mid).not.toBe(before);

            await e2eRestore(pg.url, snap);
            const after = await publicRowFingerprint(pg.url);
            expect(after).toBe(before);
        } finally {
            await pg.stop();
        }
    },
);
