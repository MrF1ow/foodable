import { afterEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import {
    closeSql,
    definedColumns,
    getSql,
    insertReturning,
    maybeOne,
    one,
    pgCode,
    pgError,
    requireDatabaseUrl,
    rows,
    run,
    setSqlForTests,
} from "./sql.js";
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

test("definedColumns drops undefined and keeps null", () => {
    const { row, keys } = definedColumns({
        a: 1,
        b: undefined,
        c: null,
    });
    expect(keys).toEqual(["a", "c"]);
    expect(row).toEqual({ a: 1, c: null });
});

describe("requireDatabaseUrl", () => {
    const prevUrl = process.env.DATABASE_URL;

    afterEach(() => {
        if (prevUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prevUrl;
    });

    test("throws Missing DATABASE_URL when unset", () => {
        delete process.env.DATABASE_URL;
        expect(() => requireDatabaseUrl()).toThrow("Missing DATABASE_URL");
    });

    test("throws Missing DATABASE_URL when blank", () => {
        process.env.DATABASE_URL = "   ";
        expect(() => requireDatabaseUrl()).toThrow("Missing DATABASE_URL");
    });
});

describe("getSql", () => {
    const prevUrl = process.env.DATABASE_URL;

    afterEach(async () => {
        setSqlForTests(null);
        await closeSql();
        if (prevUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prevUrl;
    });

    test("throws Missing DATABASE_URL when unset and no override", () => {
        delete process.env.DATABASE_URL;
        setSqlForTests(null);
        expect(() => getSql()).toThrow("Missing DATABASE_URL");
    });
});

describeDb(pgAvailable !== null, "sql", (ctx) => {
    afterEach(() => {
        setSqlForTests(null);
    });

    test("rows: empty and PostgREST column shapes", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            await tx`
                create temp table _sql_shape (
                    n numeric(10, 2),
                    i bigint,
                    d date,
                    j jsonb,
                    t text,
                    arr text[]
                ) on commit drop
            `;
            await tx`
                insert into _sql_shape (n, i, d, j, t, arr)
                values (12.34, 12345, '2026-03-01', '{"k":1}', null, array['a','b'])
            `;

            expect(
                await rows(
                    tx,
                    tx`select * from _sql_shape where t is not null`,
                ),
            ).toEqual([]);

            const [row] = await rows(
                tx,
                tx`select * from _sql_shape where t is null`,
            );
            expect(row).toEqual({
                n: 12.34,
                i: 12345,
                d: "2026-03-01",
                j: { k: 1 },
                t: null,
                arr: ["a", "b"],
            });
        });
    });

    test("timestamptz stays +00:00 when database default zone is not UTC", async () => {
        const { sql, pg } = ctx();
        const dbName = new URL(pg.url).pathname.slice(1);
        await sql`alter database ${sql.unsafe(dbName)} set timezone to 'Pacific/Auckland'`;

        const fresh = new SQL(pg.url, { prepare: false, max: 1 });
        setSqlForTests(fresh);
        try {
            await run(async (tx) => {
                const got = await rows<{ t: string }>(
                    tx,
                    tx`select timestamptz '2026-10-31 12:00:00+00' as t`,
                );
                expect(got[0]!.t).toBe("2026-10-31T12:00:00+00:00");
            });
        } finally {
            await fresh.close();
            await sql`alter database ${sql.unsafe(dbName)} set timezone to 'UTC'`;
            setSqlForTests(sql);
        }
    });

    test("one and maybeOne row counts", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            await tx`
                create temp table _sql_one (id int primary key) on commit drop
            `;
            await tx`insert into _sql_one values (1), (2)`;

            await expect(
                one(tx, tx`select * from _sql_one where id = 99`, "widget"),
            ).rejects.toThrow("widget: expected 1 row, got 0");

            await expect(
                one(tx, tx`select * from _sql_one`, "widget"),
            ).rejects.toThrow("widget: expected 1 row, got 2");

            expect(
                await one<{ id: number }>(
                    tx,
                    tx`select * from _sql_one where id = 1`,
                    "widget",
                ),
            ).toEqual({ id: 1 });

            expect(
                await maybeOne(
                    tx,
                    tx`select * from _sql_one where id = 99`,
                    "widget",
                ),
            ).toBeNull();

            expect(
                await maybeOne<{ id: number }>(
                    tx,
                    tx`select * from _sql_one where id = 2`,
                    "widget",
                ),
            ).toEqual({ id: 2 });

            await expect(
                maybeOne(tx, tx`select * from _sql_one`, "widget"),
            ).rejects.toThrow("widget: expected 1 row, got 2");
        });
    });

    test("insert with id undefined gets a generated id", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            await tx`
                create temp table _sql_gen (
                    id uuid primary key default gen_random_uuid(),
                    label text not null
                ) on commit drop
            `;
            const inserted = await insertReturning<{
                id: string;
                label: string;
            }>(tx, "_sql_gen", { label: "auto" }, "id, label", "insert row");
            expect(inserted.label).toBe("auto");
            expect(inserted.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            );
        });
    });

    test("insert returning through one", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            await tx`
                create temp table _sql_ret (
                    id serial primary key,
                    label text not null
                ) on commit drop
            `;
            const inserted = await one(
                tx,
                tx`insert into _sql_ret (label) values (${"eggs"}) returning *`,
                "insert row",
            );
            expect(inserted).toEqual({ id: 1, label: "eggs" });
        });
    });

    test("run rolls back on throw and preserves the error", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            await tx`
                create temp table _sql_rb (id int primary key) on commit preserve rows
            `;
        });

        const err = new Error("boom");
        await expect(
            run(async (tx) => {
                await tx`insert into _sql_rb values (1)`;
                throw err;
            }),
        ).rejects.toBe(err);

        await run(async (tx) => {
            const got = await rows(tx, tx`select * from _sql_rb`);
            expect(got).toEqual([]);
        });
    });

    test("nested run reuses one transaction", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            await tx`
                create temp table _sql_nested (id int primary key) on commit preserve rows
            `;
        });

        await expect(
            run(async (tx) => {
                const [outer] = await rows<{ x: string }>(
                    tx,
                    tx`select txid_current()::text as x`,
                );
                await run(async (innerTx) => {
                    const [inner] = await rows<{ x: string }>(
                        innerTx,
                        innerTx`select txid_current()::text as x`,
                    );
                    expect(inner!.x).toBe(outer!.x);
                    await innerTx`insert into _sql_nested values (1)`;
                });

                try {
                    await run(async (innerTx) => {
                        await innerTx`insert into _sql_nested values (2)`;
                        throw new Error("inner fail");
                    });
                } catch {
                    throw new Error("outer fail");
                }
            }),
        ).rejects.toThrow("outer fail");

        await run(async (tx) => {
            const left = await rows(
                tx,
                tx`select * from _sql_nested order by id`,
            );
            expect(left).toEqual([]);
        });
    });

    test("work that outlives its run opens its own transaction", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);
        await sql`create table public._sql_late (id int primary key)`;
        try {
            let late: Promise<void> | undefined;
            await run(async () => {
                // Fire-and-forget: inherits the async context but only runs
                // its query after the outer transaction has committed.
                late = (async () => {
                    await Bun.sleep(50);
                    await run(async (tx) => {
                        await tx`insert into public._sql_late values (1)`;
                    });
                })();
            });
            await late;
            const [row] =
                await sql`select count(*)::int as n from public._sql_late`;
            expect(row.n).toBe(1);
        } finally {
            await sql`drop table public._sql_late`;
        }
    });

    test("rows keeps the query's order", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);
        await sql`
            create table public._sql_order as
            select g as id, (g * 7919) % 401 as k
            from generate_series(1, 400) g
        `;
        try {
            const expected = (
                (await sql`select id from public._sql_order order by k desc, id`) as {
                    id: number;
                }[]
            ).map((r) => r.id);
            for (const sortOff of [false, true]) {
                const got = await run(async (tx) => {
                    if (sortOff) {
                        await tx`set local enable_sort = off`;
                        // Up to Postgres 17, enable_sort = off adds a ~1e10
                        // cost penalty, which crosses the JIT thresholds; on
                        // a JIT-enabled build (CI's Ubuntu Postgres) the
                        // 400-row query then spent seconds compiling.
                        await tx`set local jit = off`;
                    }
                    return rows<{ id: number }>(
                        tx,
                        tx`select id from public._sql_order order by k desc, id`,
                    );
                });
                expect(got.map((r) => r.id)).toEqual(expected);
            }
        } finally {
            await sql`drop table public._sql_order`;
        }
    });

    test("statement_timeout rejects long work", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await expect(
            run(
                async (tx) => {
                    await tx`select pg_sleep(1)`;
                },
                { timeoutMs: 100 },
            ),
        ).rejects.toThrow();
    });

    test("pgCode reads SQLSTATE from errno", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        const err = await run(async (tx) => {
            await tx`
                create temp table _sql_unique (id int primary key) on commit drop
            `;
            await tx`insert into _sql_unique values (1)`;
            return tx`insert into _sql_unique values (1)`;
        }).then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).not.toBeNull();
        expect(pgCode(err)).toBe("23505");
    });

    test("pgError wraps postgres failures", async () => {
        const { sql } = ctx();
        setSqlForTests(sql);

        await run(async (tx) => {
            try {
                await tx`select 1 / 0`;
            } catch (err) {
                const wrapped = pgError("list things", err);
                expect(wrapped.message).toMatch(/^Failed to list things: /);
                expect(wrapped.cause).toBe(err);
            }
        });

        await run(async (tx) => {
            try {
                await tx`
                    do $$ begin
                      raise exception 'not a household member';
                    end $$
                `;
            } catch (err) {
                const wrapped = pgError("add member", err);
                expect(wrapped.message).toBe(
                    "Failed to add member: not a household member",
                );
            }
        });
    });
});
