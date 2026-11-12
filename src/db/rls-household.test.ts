// Row level security for the foodable_app role on household data and on the
// shared tables. Everything here connects as foodable_app through psql, with
// the same two settings run() applies per transaction: request.jwt.claim.sub
// (the user, or '') and app.household_id (the household, or '').
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
const USER_A = "aaaaaaaa-1111-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-1111-4000-8000-00000000000b";
// A plain member of household A, for the checks a member must not pass.
const MEMBER_A = "aaaaaaaa-1111-4000-8000-0000000000a2";
const FOOD_B = "bbbbbbbb-2222-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-2222-4000-8000-000000000002";
const STORE_B = "bbbbbbbb-2222-4000-8000-000000000003";
const SECTION_B = "bbbbbbbb-2222-4000-8000-000000000004";
const RECIPE_B = "bbbbbbbb-2222-4000-8000-000000000005";
const MEAL_B = "bbbbbbbb-2222-4000-8000-000000000006";

// Tables with a household_id that deliberately have no household policy.
// Reached only by the system (owner connection): the household bot token is
// read and rotated through security definer functions, and flag assignments
// through the process-wide flag pin cache.
const SYSTEM_ONLY_HOUSEHOLD_TABLES = [
    "flag_assignments",
    "household_mcp_tokens",
];
// A person's own rows that also carry a household_id. Their policies key on
// the person (rls-personal.test.ts), so the household checks below stop at
// "household A cannot reach them".
const PERSONAL_HOUSEHOLD_TABLES = ["meal_items", "nutrition_goal_days"];
// Tables the app reads in its own household but never writes: every change
// to a membership goes through the system after the app's own owner check.
const APP_READ_ONLY_HOUSEHOLD_TABLES = ["household_members"];

// Tables without a household_id that foodable_app never reaches: sign-in,
// OAuth, rate limiting, flag bookkeeping. Keep in step with the migrations.
const SYSTEM_ONLY_TABLES = [
    "auth_bans",
    "flag_beta_events",
    "flag_beta_members",
    "flag_eval_daily",
    "flag_snapshot",
    "oauth_login_sessions",
    "rate_limit_buckets",
    "registered_clients",
];

// A deploy holds one household, but the policies must hold for two, so this
// throwaway database lifts the one-household index before seeding.
const SEED = `
drop index if exists public.households_singleton;
insert into public.users (id, email) values
    ('${USER_A}', 'a@example.invalid'),
    ('${USER_B}', 'b@example.invalid'),
    ('${MEMBER_A}', 'a2@example.invalid');
insert into public.households (id, name) values
    ('${HH_A}', 'Household A'),
    ('${HH_B}', 'Household B');
insert into public.household_members (household_id, user_id, role, display_name) values
    ('${HH_A}', '${USER_A}', 'owner', 'Al'),
    ('${HH_B}', '${USER_B}', 'owner', 'Bea'),
    ('${HH_A}', '${MEMBER_A}', 'member', 'Ann');
insert into public.fridge_locations (id, household_id, name)
    values ('${LOCATION_B}', '${HH_B}', 'Fridge');
insert into public.grocery_stores (id, household_id, name)
    values ('${STORE_B}', '${HH_B}', 'Shop');
insert into public.grocery_sections (id, household_id, store_id, name)
    values ('${SECTION_B}', '${HH_B}', '${STORE_B}', 'Produce');
insert into public.foods (id, household_id, kind, name, normalized_name)
    values ('${FOOD_B}', '${HH_B}', 'food', 'Eggs', 'eggs');
insert into public.food_aliases (household_id, alias, food_id)
    values ('${HH_B}', 'egg', '${FOOD_B}');
insert into public.food_barcodes (household_id, barcode, food_id)
    values ('${HH_B}', '0000000000001', '${FOOD_B}');
insert into public.fridge_items (household_id, location_id, kind, display_name, amount, unit, food_id)
    values ('${HH_B}', '${LOCATION_B}', 'food', 'Eggs', 6, 'each', '${FOOD_B}');
insert into public.grocery_lines (household_id, store_id, section_id, kind, display_name, amount, unit, food_id)
    values ('${HH_B}', '${STORE_B}', '${SECTION_B}', 'food', 'Eggs', 12, 'each', '${FOOD_B}');
insert into public.store_rules (household_id, store_id, body)
    values ('${HH_B}', '${STORE_B}', 'Buy the big box');
insert into public.recipes (id, household_id, creator_id, name, yield_portions)
    values ('${RECIPE_B}', '${HH_B}', '${USER_B}', 'Omelette', 1);
insert into public.recipe_ingredients (household_id, recipe_id, kind, display_name, food_id)
    values ('${HH_B}', '${RECIPE_B}', 'food', 'Eggs', '${FOOD_B}');
insert into public.recipe_imports (recipe_id, household_id, source_kind)
    values ('${RECIPE_B}', '${HH_B}', 'text');
insert into public.recipe_portions (recipe_id, household_id, user_id, portion_count)
    values ('${RECIPE_B}', '${HH_B}', '${USER_B}', 1);
insert into public.recipe_favourites (household_id, user_id, recipe_id)
    values ('${HH_B}', '${USER_B}', '${RECIPE_B}');
insert into public.member_score_settings (user_id, household_id, preset)
    values ('${USER_B}', '${HH_B}', 'planet');
insert into public.recipe_plans (household_id, recipe_id, date, slot, created_by)
    values ('${HH_B}', '${RECIPE_B}', '2026-11-12', 'dinner', '${USER_B}');
insert into public.stock_movements (household_id, food_id, delta, unit, reason)
    values ('${HH_B}', '${FOOD_B}', 6, 'each', 'purchase');
insert into public.member_allergens (household_id, user_id, allergen)
    values ('${HH_B}', '${USER_B}', 'peanut');
insert into public.member_dislikes (household_id, user_id, display_name)
    values ('${HH_B}', '${USER_B}', 'Cilantro');
insert into public.person_rules (household_id, user_id, body)
    values ('${HH_B}', '${USER_B}', 'No pork');
insert into public.notice_dismissals (household_id, code, subject_kind, subject_id)
    values ('${HH_B}', 'fridge.expiring', 'food', '${FOOD_B}');
insert into public.household_invites (household_id, code_hash, expires_at)
    values ('${HH_B}', repeat('c', 64), now() + interval '7 days');
insert into public.social_reader_status (household_id, reader)
    values ('${HH_B}', 'tiktok');
insert into public.fetch_host_refusals (household_id, host, status, expires_at)
    values ('${HH_B}', 'example.com', 403, now() + interval '1 day');
insert into public.dead_links (household_id, url_hash, url, status, expires_at)
    values ('${HH_B}', repeat('a', 64), 'https://example.com/gone', 404, now() + interval '1 day');
insert into public.household_mcp_tokens (household_id, token_hash)
    values ('${HH_B}', decode(repeat('ab', 32), 'hex'));
insert into public.flag_assignments (subject_kind, household_id, flag_name, value, reason, expires_at)
    values ('household', '${HH_B}', 'probe', 'true', 'test', now() + interval '1 day');
insert into public.nutrition_goal_days (household_id, user_id, date)
    values ('${HH_B}', '${USER_B}', current_date);
insert into public.meals (id, user_id, description)
    values ('${MEAL_B}', '${USER_B}', 'Omelette');
insert into public.meal_items (meal_id, user_id, household_id, label)
    values ('${MEAL_B}', '${USER_B}', '${HH_B}', 'Omelette');
insert into public.oauth_tokens (token, user_id, expires_at) values
    ('token-a', '${USER_A}', now() + interval '1 day'),
    ('token-b', '${USER_B}', now() + interval '1 day');
insert into public.refresh_tokens (token, user_id, expires_at) values
    ('refresh-a', '${USER_A}', now() + interval '1 day'),
    ('refresh-b', '${USER_B}', now() + interval '1 day');
insert into public.auth_codes (code, redirect_uri, user_id, expires_at) values
    ('code-a', 'https://example.invalid/cb', '${USER_A}', now() + interval '1 day'),
    ('code-b', 'https://example.invalid/cb', '${USER_B}', now() + interval '1 day');
insert into public.export_archives (user_id, archive, expires_at) values
    ('${USER_A}', '\\x00', now() + interval '1 day'),
    ('${USER_B}', '\\x00', now() + interval '1 day');
insert into public.tool_analytics (user_id, tool_name, success, duration_ms) values
    ('${USER_A}', 'probe', true, 1),
    ('${USER_B}', 'probe', true, 1);
insert into public.food_cache (source, source_id, payload)
    values ('off', '0000000000001', '{}'::jsonb);
`;

type Actor = { user?: string; household?: string };

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

async function householdTables(pg: TempPostgres): Promise<string[]> {
    const out = await owner(
        pg,
        `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public'
           and c.column_name = 'household_id'
           and t.table_type = 'BASE TABLE'
         order by 1`,
    );
    return out.split("\n").filter(Boolean);
}

// An insert that copies household B's row with every writable column, so
// only row level security can refuse it before the constraints run.
async function copyRowInsert(pg: TempPostgres, table: string): Promise<string> {
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
         where household_id = '${HH_B}' limit 1`,
    );
    return `insert into public.${table} (${cols})
        select ${cols} from json_populate_record(null::public.${table}, ${quote(json)})`;
}

describeDb(pgAvailable !== null, "foodable_app row level security", (ctx) => {
    beforeAll(async () => {
        await owner(ctx().pg, SEED);
    });

    test("every table is classified: a foodable_app policy, or listed as system-only", async () => {
        const { pg } = ctx();
        const out = await owner(
            pg,
            `select c.relname
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p')
               and not exists (
                   select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = c.relname
                     and 'foodable_app' = any (p.roles)
               )
             order by 1`,
        );
        const withoutPolicy = out.split("\n").filter(Boolean);
        expect(withoutPolicy).toEqual(
            [...SYSTEM_ONLY_HOUSEHOLD_TABLES, ...SYSTEM_ONLY_TABLES].sort(),
        );
    });

    test("no household can reach another household's rows, in any table with a household_id", async () => {
        const { pg } = ctx();
        const tables = await householdTables(pg);
        expect(tables.length).toBeGreaterThan(20);
        const failures: string[] = [];
        const actorA = { user: USER_A, household: HH_A };
        const actorB = { user: USER_B, household: HH_B };
        const where = `where household_id = '${HH_B}'`;

        for (const table of tables) {
            const seeded = await owner(
                pg,
                `select count(*) from public.${table} ${where}`,
            );
            if (seeded === "0") {
                failures.push(
                    `${table}: seed a household B row in this test so it is covered`,
                );
                continue;
            }

            const seen = await asApp(
                pg,
                actorA,
                `select count(*) from public.${table} ${where}`,
            );
            if (seen.out !== "0") {
                failures.push(
                    `${table}: household A sees B's rows (${seen.out})`,
                );
            }
            const updated = await asApp(
                pg,
                actorA,
                touched(
                    `update public.${table} set household_id = household_id ${where}`,
                ),
            );
            if (updated.out !== "0") {
                failures.push(
                    `${table}: household A updated B's rows (${updated.out})`,
                );
            }
            const deleted = await asApp(
                pg,
                actorA,
                touched(`delete from public.${table} ${where}`),
            );
            if (deleted.out !== "0") {
                failures.push(
                    `${table}: household A deleted B's rows (${deleted.out})`,
                );
            }
            const inserted = await asApp(
                pg,
                actorA,
                await copyRowInsert(pg, table),
            );
            if (inserted.ok || !/row-level security/.test(inserted.out)) {
                failures.push(
                    `${table}: insert of a B row under A was not refused by RLS: ${inserted.out}`,
                );
            }

            if (PERSONAL_HOUSEHOLD_TABLES.includes(table)) continue;
            const own = await asApp(
                pg,
                actorB,
                `select count(*) from public.${table} ${where}`,
            );
            if (SYSTEM_ONLY_HOUSEHOLD_TABLES.includes(table)) {
                if (own.out !== "0") {
                    failures.push(
                        `${table}: system-only table visible to the app`,
                    );
                }
                continue;
            }
            if (!own.ok || own.out === "0") {
                failures.push(
                    `${table}: household B cannot see its own rows: ${own.out}`,
                );
            }
            const ownUpdate = await asApp(
                pg,
                actorB,
                touched(
                    `update public.${table} set household_id = household_id ${where}`,
                ),
            );
            if (APP_READ_ONLY_HOUSEHOLD_TABLES.includes(table)) {
                if (!ownUpdate.ok || ownUpdate.out !== "0") {
                    failures.push(
                        `${table}: household B updated its own read-only rows: ${ownUpdate.out}`,
                    );
                }
                continue;
            }
            if (!ownUpdate.ok || ownUpdate.out === "0") {
                failures.push(
                    `${table}: household B cannot update its own rows: ${ownUpdate.out}`,
                );
            }
            const moved = await asApp(
                pg,
                actorB,
                `update public.${table} set household_id = '${HH_A}' ${where}`,
            );
            if (moved.ok || !/row-level security/.test(moved.out)) {
                failures.push(
                    `${table}: household B moved a row into household A: ${moved.out}`,
                );
            }
        }
        expect(failures).toEqual([]);
    });

    test("with no household set, household tables are empty", async () => {
        const { pg } = ctx();
        const res = await asApp(
            pg,
            { user: USER_B },
            "select count(*) from public.foods",
        );
        expect(res).toEqual({ ok: true, out: "0" });
    });

    test("households: the actor's own household only, read and update", async () => {
        const { pg } = ctx();
        const actorA = { user: USER_A, household: HH_A };
        expect(
            await asApp(pg, actorA, "select id from public.households"),
        ).toEqual({ ok: true, out: HH_A });
        expect(
            await asApp(
                pg,
                actorA,
                touched(`update public.households set name = 'Renamed'`),
            ),
        ).toEqual({ ok: true, out: "1" });
        expect(
            await asApp(
                pg,
                actorA,
                touched(
                    `update public.households set name = 'x' where id = '${HH_B}'`,
                ),
            ),
        ).toEqual({ ok: true, out: "0" });
        // Creating and deleting households is the security definer functions' job.
        expect(
            await asApp(
                pg,
                actorA,
                touched(`delete from public.households where id = '${HH_A}'`),
            ),
        ).toEqual({ ok: true, out: "0" });
        const insert = await asApp(
            pg,
            actorA,
            `insert into public.households (name) values ('New')`,
        );
        expect(insert.ok).toBe(false);
        expect(insert.out).toMatch(/row-level security/);
    });

    test("household_members: a user with no household set still sees their own membership", async () => {
        const { pg } = ctx();
        expect(
            await asApp(
                pg,
                { user: USER_A },
                "select household_id from public.household_members",
            ),
        ).toEqual({ ok: true, out: HH_A });
        expect(
            await asApp(
                pg,
                { household: HH_B },
                "select user_id from public.household_members",
            ),
        ).toEqual({ ok: true, out: USER_B });
    });

    test("users: a signed-in user reaches only their own row", async () => {
        const { pg } = ctx();
        const actorA = { user: USER_A, household: HH_A };
        expect(await asApp(pg, actorA, "select id from public.users")).toEqual({
            ok: true,
            out: USER_A,
        });
        expect(
            await asApp(
                pg,
                actorA,
                touched(`update public.users set password_hash = 'x'`),
            ),
        ).toEqual({ ok: true, out: "1" });
        expect(
            await asApp(
                pg,
                actorA,
                touched(`delete from public.users where id = '${USER_B}'`),
            ),
        ).toEqual({ ok: true, out: "0" });
        expect(
            await asApp(
                pg,
                actorA,
                // Account deletion clears the credentials first, as it does
                // in the app; their foreign keys have no cascade.
                `begin;
                 delete from public.auth_codes where user_id = '${USER_A}';
                 delete from public.oauth_tokens where user_id = '${USER_A}';
                 delete from public.refresh_tokens where user_id = '${USER_A}';
                 with t as (
                     delete from public.users where id = '${USER_A}' returning 1
                 ) select count(*) from t;
                 rollback;`,
            ),
        ).toEqual({ ok: true, out: "1" });
        // A household token has no user, so no users row.
        expect(
            await asApp(
                pg,
                { household: HH_A },
                "select count(*) from public.users",
            ),
        ).toEqual({ ok: true, out: "0" });
        // Signing up is system work.
        const insert = await asApp(
            pg,
            actorA,
            `insert into public.users (email) values ('c@example.invalid')`,
        );
        expect(insert.ok).toBe(false);
        expect(insert.out).toMatch(/row-level security/);
    });

    test("oauth_tokens, refresh_tokens, auth_codes: a user may read and delete only their own", async () => {
        const { pg } = ctx();
        const actorA = { user: USER_A, household: HH_A };
        for (const [table, key, own] of [
            ["oauth_tokens", "token", "token-a"],
            ["refresh_tokens", "token", "refresh-a"],
            ["auth_codes", "code", "code-a"],
        ] as const) {
            expect(
                await asApp(pg, actorA, `select ${key} from public.${table}`),
            ).toEqual({ ok: true, out: own });
            expect(
                await asApp(
                    pg,
                    actorA,
                    touched(
                        `delete from public.${table} where user_id = '${USER_B}'`,
                    ),
                ),
            ).toEqual({ ok: true, out: "0" });
            expect(
                await asApp(
                    pg,
                    actorA,
                    touched(
                        `delete from public.${table} where user_id = '${USER_A}'`,
                    ),
                ),
            ).toEqual({ ok: true, out: "1" });
            expect(
                await asApp(
                    pg,
                    actorA,
                    touched(`update public.${table} set user_id = user_id`),
                ),
            ).toEqual({ ok: true, out: "0" });
        }
        // Issuing tokens is the OAuth flow's job, which runs as the system.
        const insert = await asApp(
            pg,
            actorA,
            `insert into public.oauth_tokens (token, user_id, expires_at)
             values ('token-new', '${USER_A}', now() + interval '1 day')`,
        );
        expect(insert.ok).toBe(false);
        expect(insert.out).toMatch(/row-level security/);
    });

    test("export_archives: a user reaches only their own archive", async () => {
        const { pg } = ctx();
        const actorA = { user: USER_A, household: HH_A };
        expect(
            await asApp(
                pg,
                actorA,
                "select user_id from public.export_archives",
            ),
        ).toEqual({ ok: true, out: USER_A });
        expect(
            await asApp(
                pg,
                actorA,
                `insert into public.export_archives (user_id, archive, expires_at)
                 values ('${USER_A}', '\\x01', now() + interval '1 hour')
                 on conflict (user_id) do update set archive = excluded.archive`,
            ),
        ).toEqual({ ok: true, out: "" });
        const other = await asApp(
            pg,
            actorA,
            `insert into public.export_archives (user_id, archive, expires_at)
             values ('${USER_B}', '\\x01', now() + interval '1 hour')
             on conflict (user_id) do update set archive = excluded.archive`,
        );
        expect(other.ok).toBe(false);
        expect(other.out).toMatch(/row-level security/);
    });

    test("tool_analytics: rows are written under the caller's own id and read back only by that user", async () => {
        const { pg } = ctx();
        const actorA = { user: USER_A, household: HH_A };
        const row = (userId: string) =>
            `insert into public.tool_analytics (user_id, tool_name, success, duration_ms)
             values ('${userId}', 'probe', true, 1)`;
        expect(await asApp(pg, actorA, row(USER_A))).toEqual({
            ok: true,
            out: "",
        });
        expect(await asApp(pg, actorA, row("[deleted]"))).toEqual({
            ok: true,
            out: "",
        });
        expect(await asApp(pg, { household: HH_A }, row(`hh:${HH_A}`))).toEqual(
            { ok: true, out: "" },
        );
        for (const [actor, userId] of [
            [actorA, USER_B],
            [{ household: HH_A }, `hh:${HH_B}`],
            [{ household: HH_A }, USER_A],
        ] as const) {
            const refused = await asApp(pg, actor, row(userId));
            expect(refused.ok).toBe(false);
            expect(refused.out).toMatch(/row-level security/);
        }
        expect(
            await asApp(
                pg,
                actorA,
                `select count(*) from public.tool_analytics where user_id = '${USER_B}'`,
            ),
        ).toEqual({ ok: true, out: "0" });
        expect(
            await asApp(
                pg,
                actorA,
                touched(
                    `delete from public.tool_analytics where user_id in ('${USER_A}', '${USER_B}')`,
                ),
            ),
        ).toEqual({ ok: true, out: "2" });
    });

    test("food_cache: shared product cache, read and written under any actor", async () => {
        const { pg } = ctx();
        const actor = { household: HH_A };
        expect(
            await asApp(pg, actor, "select source_id from public.food_cache"),
        ).toEqual({ ok: true, out: "0000000000001" });
        expect(
            await asApp(
                pg,
                actor,
                `insert into public.food_cache (source, source_id, payload)
                 values ('off', '0000000000002', '{}'::jsonb)
                 on conflict (source, source_id) do update set payload = excluded.payload`,
            ),
        ).toEqual({ ok: true, out: "" });
    });

    test("system-only tables stay empty for foodable_app", async () => {
        const { pg } = ctx();
        await owner(
            pg,
            `insert into public.registered_clients (client_name, redirect_uris)
             values ('probe-client', array['https://example.invalid/cb'])`,
        );
        expect(
            await asApp(
                pg,
                { user: USER_A, household: HH_A },
                "select count(*) from public.registered_clients",
            ),
        ).toEqual({ ok: true, out: "0" });
    });

    test("foodable_app can execute no security definer function in public", async () => {
        const { pg } = ctx();
        const out = await owner(
            pg,
            `select p.proname
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.prosecdef
               and has_function_privilege('foodable_app', p.oid, 'execute')
             order by 1`,
        );
        expect(out.split("\n").filter(Boolean)).toEqual([]);
    });

    // Each one acted across households when foodable_app could call it.
    const DEFINER_CALLS: [string, string][] = [
        [
            "add_household_member",
            `select public.add_household_member('${HH_B}', '${MEMBER_A}', 'Intruder')`,
        ],
        [
            "create_household",
            `select public.create_household('${MEMBER_A}', 'Extra', 'Ann', true)`,
        ],
        [
            "rotate_household_mcp_token",
            `select public.rotate_household_mcp_token('${HH_B}', repeat('cd', 32), '${USER_A}')`,
        ],
        [
            "transfer_household_ownership",
            `select public.transfer_household_ownership('${HH_B}', '${USER_B}', '${USER_A}')`,
        ],
        [
            "resolve_household_mcp_token",
            `select public.resolve_household_mcp_token(repeat('ab', 32))`,
        ],
        [
            "household_mcp_token_hash",
            `select public.household_mcp_token_hash(repeat('ab', 32))`,
        ],
        [
            "promote_household_owner_on_leave",
            `select public.promote_household_owner_on_leave()`,
        ],
    ];
    for (const [name, call] of DEFINER_CALLS) {
        test(`foodable_app is refused ${name}`, async () => {
            const res = await asApp(
                ctx().pg,
                { user: USER_A, household: HH_A },
                call,
            );
            expect(res.ok).toBe(false);
            expect(res.out).toMatch(/permission denied for function/);
        });
    }

    test("household_members: a member cannot insert, update or delete memberships, even in their own household", async () => {
        const { pg } = ctx();
        const member = { user: MEMBER_A, household: HH_A };
        expect(
            await asApp(
                pg,
                member,
                "select count(*) from public.household_members",
            ),
        ).toEqual({ ok: true, out: "2" });
        expect(
            await asApp(
                pg,
                member,
                touched(
                    `update public.household_members
                     set role = case when user_id = '${MEMBER_A}' then 'owner' else 'member' end`,
                ),
            ),
        ).toEqual({ ok: true, out: "0" });
        expect(
            await asApp(
                pg,
                member,
                touched(
                    `update public.household_members set display_name = 'x'
                     where user_id = '${MEMBER_A}'`,
                ),
            ),
        ).toEqual({ ok: true, out: "0" });
        expect(
            await asApp(
                pg,
                member,
                touched(
                    `delete from public.household_members where user_id = '${USER_A}'`,
                ),
            ),
        ).toEqual({ ok: true, out: "0" });
        const insert = await asApp(
            pg,
            member,
            `insert into public.household_members (household_id, user_id, role, display_name)
             values ('${HH_A}', '${USER_B}', 'owner', 'Bea')`,
        );
        expect(insert.ok).toBe(false);
        expect(insert.out).toMatch(/row-level security/);
        expect(
            await owner(
                pg,
                `select role from public.household_members where user_id = '${USER_A}'`,
            ),
        ).toBe("owner");
    });

    test("the owner-leave trigger still runs when foodable_app deletes an owner's login", async () => {
        const { pg } = ctx();
        const res = await asApp(
            pg,
            { user: USER_A, household: HH_A },
            `begin;
             delete from public.auth_codes where user_id = '${USER_A}';
             delete from public.oauth_tokens where user_id = '${USER_A}';
             delete from public.refresh_tokens where user_id = '${USER_A}';
             delete from public.users where id = '${USER_A}';
             set local app.household_id = '${HH_A}';
             set local "request.jwt.claim.sub" = '${MEMBER_A}';
             select role from public.household_members where user_id = '${MEMBER_A}';
             rollback;`,
        );
        expect(res).toEqual({ ok: true, out: "owner" });
    });
});
