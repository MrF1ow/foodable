import { expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

describeDb(pgAvailable !== null, "foodable_app role", (ctx) => {
    test("login role is not superuser and does not bypass RLS", async () => {
        const { pg } = ctx();
        const res = await pg.psqlAs("foodable_app", [
            "-tA",
            "-c",
            "select rolsuper::text || ',' || rolbypassrls::text from pg_roles where rolname = current_user",
        ]);
        expect(res.ok).toBe(true);
        expect(res.out).toBe("false,false");
    });

    test("cannot assume the postgres role", async () => {
        const { pg } = ctx();
        const res = await pg.psqlAs("foodable_app", [
            "-c",
            "set role postgres",
        ]);
        expect(res.ok).toBe(false);
        expect(res.out).toMatch(/permission denied|cannot set/i);
    });

    test("has DML on public tables but RLS blocks insert", async () => {
        const { pg } = ctx();
        const res = await pg.psqlAs("foodable_app", [
            "-c",
            `insert into public.foods (
                id, household_id, kind, name, normalized_name
            ) values (
                'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99',
                '11111111-1111-1111-1111-111111111111',
                'food', 'App role probe', 'app-role-probe'
            )`,
        ]);
        expect(res.ok).toBe(false);
        expect(res.out).toMatch(/row-level security|permission denied/i);
    });

    test("select on a table is allowed at privilege level", async () => {
        const { pg } = ctx();
        const asApp = await pg.psqlAs("foodable_app", [
            "-tA",
            "-c",
            "select count(*) from public.profiles",
        ]);
        expect(asApp.ok).toBe(true);
        expect(asApp.out).toBe("0");
    });

    test("cannot alter or drop tables", async () => {
        const { pg } = ctx();
        const alter = await pg.psqlAs("foodable_app", [
            "-c",
            "alter table public.profiles add column probe text",
        ]);
        expect(alter.ok).toBe(false);
        expect(alter.out).toMatch(/must be owner|permission denied/i);
        const drop = await pg.psqlAs("foodable_app", [
            "-c",
            "drop table public.profiles",
        ]);
        expect(drop.ok).toBe(false);
        expect(drop.out).toMatch(/must be owner|permission denied/i);
    });

    test("cannot read migration history", async () => {
        const { pg } = ctx();
        const res = await pg.psqlAs("foodable_app", [
            "-c",
            "select version from foodable_migrations.schema_migrations limit 1",
        ]);
        expect(res.ok).toBe(false);
        expect(res.out).toMatch(/permission denied/i);
    });
});
