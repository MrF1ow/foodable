// Row level security for the foodable_app role on a person's own data: meals
// and their items, water, weight, nutrition goals, per-day goal overrides and
// the profile. A person reaches their own rows; a signed-in member reads (and,
// for nutrition, writes) another member of their household; the household bot
// token reaches its members; nobody reaches a person outside their household.
// Everything here connects as foodable_app through psql, with the same two
// settings run() applies per transaction.
import { beforeAll, expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { findPgBin, type TempPostgres } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

const HH_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const HH_B = "bbbbbbbb-0000-4000-8000-00000000000b";
// Household A has two members; household B one; C belongs to none.
const USER_A = "aaaaaaaa-1111-4000-8000-00000000000a";
const USER_A2 = "aaaaaaaa-1111-4000-8000-0000000000a2";
const USER_B = "bbbbbbbb-1111-4000-8000-00000000000b";
const USER_C = "cccccccc-1111-4000-8000-00000000000c";
const ALL_USERS = [USER_A, USER_A2, USER_B, USER_C];

const MEAL: Record<string, string> = {
    [USER_A]: "aaaaaaaa-3333-4000-8000-00000000000a",
    [USER_A2]: "aaaaaaaa-3333-4000-8000-0000000000a2",
    [USER_B]: "bbbbbbbb-3333-4000-8000-00000000000b",
    [USER_C]: "cccccccc-3333-4000-8000-00000000000c",
};
const HOUSEHOLD_OF: Record<string, string | null> = {
    [USER_A]: HH_A,
    [USER_A2]: HH_A,
    [USER_B]: HH_B,
    [USER_C]: null,
};

// Read and written for oneself and for any member of the acting household.
const MEMBER_WRITE_TABLES = [
    "meal_items",
    "meals",
    "nutrition_goal_days",
    "nutrition_goals",
    "water_log",
    "weight_log",
];
// Read the same way; written only by the person (plus the household bot token).
const READ_ONLY_FOR_PEERS = ["profiles"];
const PERSONAL_TABLES = [...MEMBER_WRITE_TABLES, ...READ_ONLY_FOR_PEERS].sort();

function personRows(user: string): string {
    const hh = HOUSEHOLD_OF[user];
    const meal = MEAL[user];
    const hhSql = hh ? `'${hh}'` : "null";
    return `
insert into public.profiles (user_id, timezone) values ('${user}', 'UTC');
insert into public.nutrition_goals (user_id, daily_calories) values ('${user}', 2000);
insert into public.water_log (user_id, amount_ml) values ('${user}', 250);
insert into public.weight_log (user_id, weight_g) values ('${user}', 70000);
insert into public.meals (id, user_id, description) values ('${meal}', '${user}', 'Toast');
insert into public.meal_items (meal_id, user_id, household_id, label)
    values ('${meal}', '${user}', ${hhSql}, 'Toast');
${
    hh
        ? `insert into public.nutrition_goal_days (household_id, user_id, date)
    values ('${hh}', '${user}', current_date);`
        : ""
}`;
}

// A deploy holds one household, but the policies must hold for two, so this
// throwaway database lifts the one-household index before seeding.
const SEED = `
drop index if exists public.households_singleton;
insert into public.users (id, email) values
    ('${USER_A}', 'a@example.invalid'),
    ('${USER_A2}', 'a2@example.invalid'),
    ('${USER_B}', 'b@example.invalid'),
    ('${USER_C}', 'c@example.invalid');
insert into public.households (id, name) values
    ('${HH_A}', 'Household A'),
    ('${HH_B}', 'Household B');
insert into public.household_members (household_id, user_id, role, display_name) values
    ('${HH_A}', '${USER_A}', 'owner', 'Al'),
    ('${HH_A}', '${USER_A2}', 'member', 'Ann'),
    ('${HH_B}', '${USER_B}', 'owner', 'Bea');
${ALL_USERS.map(personRows).join("\n")}
`;

type Actor = { user?: string; household?: string };

const memberA: Actor = { user: USER_A, household: HH_A };
const memberB: Actor = { user: USER_B, household: HH_B };
const loneC: Actor = { user: USER_C };
const tokenA: Actor = { household: HH_A };

function quote(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

async function owner(pg: TempPostgres, sql: string): Promise<string> {
    const res = await pg.psql(["-tA", "-c", sql]);
    if (!res.ok) throw new Error(`${sql}\n${res.out}`);
    return res.out;
}

// One psql session as foodable_app with the actor's settings applied, the
// way run() applies them. Returns ok and the output of the last statement.
function asApp(
    pg: TempPostgres,
    actor: Actor,
    sql: string,
): Promise<{ ok: boolean; out: string }> {
    return pg.psqlAs("foodable_app", [
        "-tA",
        "-c",
        `set "request.jwt.claim.sub" = ${quote(actor.user ?? "")};
         set app.household_id = ${quote(actor.household ?? "")};
         ${sql}`,
    ]);
}

// Count of rows a data-modifying statement touched, rolled back afterwards.
function touched(statement: string): string {
    return `begin;
        with t as (${statement} returning 1) select count(*) from t;
        rollback;`;
}

// The users whose rows the actor sees in a table, sorted.
async function visibleUsers(
    pg: TempPostgres,
    actor: Actor,
    table: string,
): Promise<string[]> {
    const res = await asApp(
        pg,
        actor,
        `select distinct user_id from public.${table} order by 1`,
    );
    if (!res.ok) throw new Error(`${table}: ${res.out}`);
    return res.out.split("\n").filter(Boolean);
}

function updateOf(table: string, user: string): string {
    return touched(
        `update public.${table} set user_id = user_id where user_id = '${user}'`,
    );
}

function deleteOf(table: string, user: string): string {
    return touched(`delete from public.${table} where user_id = '${user}'`);
}

// An insert that copies the person's own row with every writable column, so
// only row level security can refuse it before the constraints run.
async function copyRowInsert(
    pg: TempPostgres,
    table: string,
    user: string,
): Promise<string> {
    const cols = (
        await owner(
            pg,
            `select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
             from information_schema.columns
             where table_schema = 'public' and table_name = ${quote(table)}
               and is_generated = 'NEVER'
               and coalesce(identity_generation, '') <> 'ALWAYS'`,
        )
    ).trim();
    const json = await owner(
        pg,
        `select row_to_json(r) from public.${table} r
         where user_id = '${user}' limit 1`,
    );
    return `insert into public.${table} (${cols})
        select ${cols} from json_populate_record(null::public.${table}, ${quote(json)})`;
}

function refusedByRls(res: { ok: boolean; out: string }): boolean {
    return !res.ok && /row-level security/.test(res.out);
}

describeDb(
    pgAvailable !== null,
    "foodable_app row level security on personal data",
    (ctx) => {
        beforeAll(async () => {
            await owner(ctx().pg, SEED);
        });

        test("every personal table is seeded for every person it can hold", async () => {
            const { pg } = ctx();
            for (const table of PERSONAL_TABLES) {
                const users = (
                    await owner(
                        pg,
                        `select distinct user_id from public.${table} order by 1`,
                    )
                )
                    .split("\n")
                    .filter(Boolean);
                expect({ table, users }).toEqual({
                    table,
                    users:
                        table === "nutrition_goal_days"
                            ? [USER_A, USER_A2, USER_B].sort()
                            : [...ALL_USERS].sort(),
                });
            }
        });

        test("a member sees their own rows and their household's, nobody else's", async () => {
            const { pg } = ctx();
            for (const table of PERSONAL_TABLES) {
                expect({
                    table,
                    seen: await visibleUsers(pg, memberA, table),
                }).toEqual({ table, seen: [USER_A, USER_A2].sort() });
                expect({
                    table,
                    seen: await visibleUsers(pg, memberB, table),
                }).toEqual({ table, seen: [USER_B] });
            }
        });

        test("with no household set, a user sees only their own rows", async () => {
            const { pg } = ctx();
            for (const table of PERSONAL_TABLES) {
                expect({
                    table,
                    seen: await visibleUsers(pg, { user: USER_A }, table),
                }).toEqual({ table, seen: [USER_A] });
                const own = table === "nutrition_goal_days" ? [] : [USER_C];
                expect({
                    table,
                    seen: await visibleUsers(pg, loneC, table),
                }).toEqual({ table, seen: own });
            }
        });

        test("the household bot token sees its members' rows only", async () => {
            const { pg } = ctx();
            for (const table of PERSONAL_TABLES) {
                expect({
                    table,
                    seen: await visibleUsers(pg, tokenA, table),
                }).toEqual({ table, seen: [USER_A, USER_A2].sort() });
            }
        });

        test("no actor reaches a person outside its household: no update, delete or insert", async () => {
            const { pg } = ctx();
            const failures: string[] = [];
            const outsiders: [string, Actor, string][] = [
                ["member of B on A", memberB, USER_A],
                ["member of A on B", memberA, USER_B],
                ["member of A on C", memberA, USER_C],
                ["C on A", loneC, USER_A],
                ["A without household on A2", { user: USER_A }, USER_A2],
                ["token of A on B", tokenA, USER_B],
                ["token of A on C", tokenA, USER_C],
            ];
            for (const table of PERSONAL_TABLES) {
                for (const [label, actor, victim] of outsiders) {
                    if (table === "nutrition_goal_days" && victim === USER_C) {
                        continue;
                    }
                    for (const [verb, sql] of [
                        ["updated", updateOf(table, victim)],
                        ["deleted", deleteOf(table, victim)],
                    ] as const) {
                        const res = await asApp(pg, actor, sql);
                        if (res.out !== "0") {
                            failures.push(
                                `${table}: ${label} ${verb} rows: ${res.out}`,
                            );
                        }
                    }
                    const inserted = await asApp(
                        pg,
                        actor,
                        await copyRowInsert(pg, table, victim),
                    );
                    if (!refusedByRls(inserted)) {
                        failures.push(
                            `${table}: ${label} insert not refused by RLS: ${inserted.out}`,
                        );
                    }
                }
            }
            expect(failures).toEqual([]);
        });

        test("nobody hands their own row to a person outside the household", async () => {
            const { pg } = ctx();
            for (const table of MEMBER_WRITE_TABLES) {
                const res = await asApp(
                    pg,
                    memberA,
                    `update public.${table} set user_id = '${USER_B}' where user_id = '${USER_A}'`,
                );
                expect({ table, refused: refusedByRls(res) }).toEqual({
                    table,
                    refused: true,
                });
            }
        });

        test("a member writes their own rows in every personal table they own", async () => {
            const { pg } = ctx();
            for (const table of [...MEMBER_WRITE_TABLES, "profiles"]) {
                for (const sql of [
                    updateOf(table, USER_A),
                    deleteOf(table, USER_A),
                ]) {
                    expect({
                        table,
                        res: await asApp(pg, memberA, sql),
                    }).toEqual({ table, res: { ok: true, out: "1" } });
                }
            }
            // A user with no household still owns their data.
            expect(await asApp(pg, loneC, updateOf("meals", USER_C))).toEqual({
                ok: true,
                out: "1",
            });
            expect(
                await asApp(pg, loneC, updateOf("profiles", USER_C)),
            ).toEqual({ ok: true, out: "1" });
        });

        test("a member logs nutrition for another member of their household", async () => {
            const { pg } = ctx();
            for (const table of MEMBER_WRITE_TABLES) {
                for (const sql of [
                    updateOf(table, USER_A2),
                    deleteOf(table, USER_A2),
                ]) {
                    expect({
                        table,
                        res: await asApp(pg, memberA, sql),
                    }).toEqual({ table, res: { ok: true, out: "1" } });
                }
            }
            expect(
                await asApp(
                    pg,
                    memberA,
                    touched(
                        `insert into public.water_log (user_id, amount_ml) values ('${USER_A2}', 300)`,
                    ),
                ),
            ).toEqual({ ok: true, out: "1" });
        });

        test("a member reads but never edits another member's profile", async () => {
            const { pg } = ctx();
            for (const table of READ_ONLY_FOR_PEERS) {
                for (const sql of [
                    updateOf(table, USER_A2),
                    deleteOf(table, USER_A2),
                ]) {
                    expect({
                        table,
                        res: await asApp(pg, memberA, sql),
                    }).toEqual({ table, res: { ok: true, out: "0" } });
                }
            }
            const insert = await asApp(
                pg,
                memberA,
                `begin;
                 delete from public.profiles where user_id = '${USER_A2}';
                 insert into public.profiles (user_id, timezone) values ('${USER_A2}', 'UTC');
                 rollback;`,
            );
            expect(refusedByRls(insert)).toBe(true);
        });

        test("the household bot token writes its members' rows, profiles included", async () => {
            const { pg } = ctx();
            for (const table of [...MEMBER_WRITE_TABLES, "profiles"]) {
                expect({
                    table,
                    res: await asApp(pg, tokenA, updateOf(table, USER_A2)),
                }).toEqual({ table, res: { ok: true, out: "1" } });
            }
            expect(
                await asApp(
                    pg,
                    tokenA,
                    touched(
                        `update public.profiles set timezone = 'Europe/Kyiv' where user_id = '${USER_A}'`,
                    ),
                ),
            ).toEqual({ ok: true, out: "1" });
        });

        test("a person's rows that carry a household cannot be stamped with another household", async () => {
            const { pg } = ctx();
            const goalDay = await asApp(
                pg,
                memberA,
                `insert into public.nutrition_goal_days (household_id, user_id, date, daily_calories)
                 values ('${HH_B}', '${USER_A}', current_date + 1, 111)`,
            );
            expect(refusedByRls(goalDay)).toBe(true);
            const mealItem = await asApp(
                pg,
                memberA,
                `insert into public.meal_items (meal_id, user_id, household_id, label)
                 values ('${MEAL[USER_A]}', '${USER_A}', '${HH_B}', 'Stamped')`,
            );
            expect(refusedByRls(mealItem)).toBe(true);
            const own = await asApp(
                pg,
                memberA,
                touched(
                    `insert into public.nutrition_goal_days (household_id, user_id, date, daily_calories)
                     values ('${HH_A}', '${USER_A}', current_date + 2, 112)`,
                ),
            );
            expect(own).toEqual({ ok: true, out: "1" });
        });

        test("leaving the household ends another member's reach", async () => {
            const { pg } = ctx();
            // Removing a membership is system work (the app only reads
            // household_members), so the owner connection removes it and
            // puts it back.
            const row = await owner(
                pg,
                `select row_to_json(m) from public.household_members m
                 where user_id = '${USER_A2}'`,
            );
            await owner(
                pg,
                `delete from public.household_members where user_id = '${USER_A2}'`,
            );
            try {
                const res = await asApp(
                    pg,
                    memberA,
                    `select count(*) from public.meals where user_id = '${USER_A2}'`,
                );
                expect(res).toEqual({ ok: true, out: "0" });
            } finally {
                await owner(
                    pg,
                    `insert into public.household_members
                     select * from json_populate_record(null::public.household_members, ${quote(row)})`,
                );
            }
        });
    },
);
