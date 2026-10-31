// Dry-run the pending Supabase migrations on a throwaway local Postgres.
//
//   bun run db:dryrun                         fixture mode (seed.sql + check.sql)
//   bun run db:dryrun --data prod-data.sql    real data from a data-only dump
//
// It stubs the bits of Supabase the migrations touch (roles, auth.users,
// auth.uid(), storage), applies every migration older than --pending-from as
// the baseline production already has, loads data, then applies the pending
// ones one transaction per file in order and stops at the first failure — the
// way `supabase db push` would. Nothing here connects to a remote database.
//
// Real data: take a data-only dump of the public schema with plain pg_dump,
//   pg_dump "$DATABASE_URL" --data-only --schema=public -f prod-data.sql
// It loads with session_replication_role = replica, so foreign keys into
// auth.users (not in the dump) are not checked. Pass --pending-from with the
// first migration that database has not applied.
//
// Needs initdb, pg_ctl and psql. Set PG_BIN to their directory when they are
// not on PATH (pg_config --bindir is tried first).

import { $ } from "bun";

// The fixture (seed.sql) is written against the schema before this version,
// and everything from here on, including future migrations, runs on top of it.
// Leave it alone; with --data, pass --pending-from to match the real database.
const DEFAULT_PENDING_FROM = "20261004230000";

// Pending migrations that claim to be safe to run twice; each is re-applied
// and the row counts compared.
const RERUNNABLE = [
    "20261005010100_food_catalog_backfill.sql",
    "20261005010200_fridge_locations_from_household.sql",
];

// The backfills above read columns the Phase 8 contract drops, so the re-run
// happens just before that migration, on the schema they were written for.
const RERUN_BEFORE = "20261031180000_phase8_contract.sql";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = `${ROOT}supabase/migrations`;
const FIXTURES = `${ROOT}scripts/migration-dryrun`;
const PORT = process.env.PG_DRYRUN_PORT ?? "54329";

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

const dataFile = flag("--data");
const pendingFrom = flag("--pending-from") ?? DEFAULT_PENDING_FROM;
const keep = process.argv.includes("--keep");

async function pgBin(): Promise<string> {
    if (process.env.PG_BIN) return `${process.env.PG_BIN.replace(/\/$/, "")}/`;
    const res = await $`pg_config --bindir`.quiet().nothrow();
    if (res.exitCode === 0) return `${res.stdout.toString().trim()}/`;
    return "";
}

const bin = await pgBin();
const tmp = (await $`mktemp -d`.text()).trim();
const data = `${tmp}/data`;

const psqlBase = [
    `${bin}psql`,
    "-h",
    tmp,
    "-p",
    PORT,
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-q",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
];

async function psql(args: string[]): Promise<{ ok: boolean; out: string }> {
    const res = await $`${[...psqlBase, ...args]}`.quiet().nothrow();
    return {
        ok: res.exitCode === 0,
        out: (res.stdout.toString() + res.stderr.toString()).trim(),
    };
}

async function applyFile(path: string): Promise<{ ok: boolean; out: string }> {
    return psql(["-1", "-f", path]);
}

async function scalar(sql: string): Promise<string> {
    const res = await psql(["-tA", "-c", sql]);
    if (!res.ok) throw new Error(res.out);
    return res.out;
}

function fail(message: string): never {
    console.error(`\n${message}`);
    process.exitCode = 1;
    throw new Error("dry run failed");
}

const COUNTS_SQL = `
    select json_build_object(
        'foods', (select count(*) from public.foods),
        'foods_with_calories', (select count(*) from public.foods where calories is not null),
        'food_barcodes', (select count(*) from public.food_barcodes),
        'fridge_locations', (select count(*) from public.fridge_locations),
        'null_food_id', (
            (select count(*) from public.fridge_items where food_id is null)
            + (select count(*) from public.grocery_lines where food_id is null)
            + (select count(*) from public.recipe_ingredients where food_id is null)
        )
    )`;

try {
    const init = await $`${bin}initdb -D ${data} -U postgres -A trust`
        .quiet()
        .nothrow();
    if (init.exitCode !== 0) {
        fail(
            `initdb failed. Set PG_BIN to the Postgres bin directory.\n${init.stderr}`,
        );
    }
    await $`${bin}pg_ctl -D ${data} -l ${tmp}/log -w -o ${`-p ${PORT} -k ${tmp} -c listen_addresses=''`} start`.quiet();
    console.log(`postgres: ${await scalar("show server_version")}`);

    const stub = await applyFile(`${FIXTURES}/stub.sql`);
    if (!stub.ok) fail(`stub.sql failed:\n${stub.out}`);

    const files = [...new Bun.Glob("*.sql").scanSync(MIGRATIONS)].sort();
    const baseline = files.filter((f) => f < pendingFrom);
    const pending = files.filter((f) => f >= pendingFrom);
    if (pending.length === 0) fail(`no migrations at or after ${pendingFrom}`);

    for (const file of baseline) {
        const res = await applyFile(`${MIGRATIONS}/${file}`);
        if (!res.ok) fail(`baseline ${file} failed:\n${res.out}`);
    }
    console.log(`baseline: ${baseline.length} migrations`);

    if (dataFile) {
        const res = await psql([
            "-1",
            "-c",
            "set session_replication_role = replica",
            "-f",
            dataFile,
        ]);
        if (!res.ok) fail(`loading ${dataFile} failed:\n${res.out}`);
        console.log(`data: ${dataFile}`);
    } else {
        const res = await applyFile(`${FIXTURES}/seed.sql`);
        if (!res.ok) fail(`seed.sql failed:\n${res.out}`);
        console.log("data: fixture seed.sql");
    }

    let rerunDone = false;
    async function rerunCheck(applied: string[]): Promise<void> {
        rerunDone = true;
        const before = await scalar(COUNTS_SQL);
        for (const file of RERUNNABLE.filter((f) => applied.includes(f))) {
            const res = await applyFile(`${MIGRATIONS}/${file}`);
            if (!res.ok) fail(`re-running ${file} failed:\n${res.out}`);
        }
        const after = await scalar(COUNTS_SQL);
        if (
            JSON.stringify(JSON.parse(after)) !==
            JSON.stringify(JSON.parse(before))
        ) {
            fail(
                `re-running changed counts:\n  before ${before}\n  after  ${after}`,
            );
        }
        console.log("re-run: no-op");
    }

    console.log(`pending: ${pending.length} migrations`);
    const applied: string[] = [];
    for (const file of pending) {
        if (file === RERUN_BEFORE) await rerunCheck(applied);
        const res = await applyFile(`${MIGRATIONS}/${file}`);
        if (!res.ok) fail(`  FAIL ${file}\n${res.out}`);
        console.log(`  ok   ${file}`);
        applied.push(file);
    }

    const counts = JSON.parse(await scalar(COUNTS_SQL));
    console.log("result:", counts);
    if (counts.null_food_id !== 0) {
        fail(`${counts.null_food_id} item rows have no food_id`);
    }

    if (!dataFile) {
        const check = await applyFile(`${FIXTURES}/check.sql`);
        if (!check.ok) fail(`check.sql failed:\n${check.out}`);
        console.log("fixture expectations: ok");
    }

    if (!rerunDone) await rerunCheck(applied);
    console.log("\ndry run passed");
} catch (err) {
    if (process.exitCode !== 1) {
        console.error(err);
        process.exitCode = 1;
    }
} finally {
    await $`${bin}pg_ctl -D ${data} -m fast stop`.quiet().nothrow();
    if (keep) console.log(`kept ${tmp}`);
    else await $`rm -rf ${tmp}`.quiet().nothrow();
}
