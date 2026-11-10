import { beforeAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { findPgBin } from "./pg-shared.js";
import {
    createMigratedDatabase,
    DB_SETUP_TIMEOUT_MS,
    prepareMigratedTemplate,
} from "./pg.js";
import {
    assertDistinctDatabaseUrls,
    assertMigrationParity,
    importPublicData,
    migrationDiff,
    passwordHashParity,
    pgDatabaseIdentity,
} from "./import-postgres-data.js";

const pgAvailable = !!(await findPgBin());

// Source and target are two databases on the shared test server: separate
// databases are all importPublicData needs, and copying the migrated template
// is far cheaper than two clusters per test.
if (pgAvailable) beforeAll(prepareMigratedTemplate, DB_SETUP_TIMEOUT_MS);

export async function seedSource(
    url: string,
): Promise<{ userId: string; mealId: string }> {
    const sql = new SQL(url, { prepare: false, max: 1 });
    const userId = crypto.randomUUID();
    const householdId = crypto.randomUUID();
    const foodId = crypto.randomUUID();
    const mealId = crypto.randomUUID();
    try {
        await sql`
            insert into public.users (id, email, password_hash, created_at)
            values (${userId}, ${"import-test@example.com"}, ${"$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012"}, now())
        `;
        await sql`
            insert into public.households (id, name, created_at)
            values (${householdId}, ${"Import Test"}, now())
        `;
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values (${householdId}, ${userId}, ${"owner"}, ${"Import"})
        `;
        await sql`
            insert into public.foods (
                id,
                household_id,
                name,
                normalized_name,
                kind
            )
            values (${foodId}, ${householdId}, ${"Seed Food"}, ${"seed food"}, ${"food"})
        `;
        await sql`
            insert into public.meals (
                id,
                user_id,
                logged_at,
                meal_type,
                description,
                calories
            )
            values (
                ${mealId},
                ${userId},
                now(),
                ${"lunch"},
                ${"Import test meal"},
                ${500}
            )
        `;
        await sql`
            insert into public.meal_items (
                id,
                meal_id,
                user_id,
                food_id,
                label,
                amount,
                unit
            )
            values (
                ${crypto.randomUUID()},
                ${mealId},
                ${userId},
                ${foodId},
                ${"Seed Food"},
                ${100},
                ${"g"}
            )
        `;
        await sql`
            insert into public.export_archives (user_id, archive, expires_at)
            values (${userId}, ${Buffer.from("zip")}, now() + interval '1 hour')
        `;
        return { userId, mealId };
    } finally {
        await sql.close();
    }
}

test.skipIf(!pgAvailable)(
    "importPublicData copies seeded public data",
    async () => {
        const sourcePg = await createMigratedDatabase();
        const targetPg = await createMigratedDatabase();
        try {
            const fromUrl = sourcePg.url;
            const toUrl = targetPg.url;
            const { userId, mealId } = await seedSource(fromUrl);

            const result = await importPublicData(fromUrl, toUrl);
            expect(result.ok).toBe(true);
            expect(result.passwordHashOk).toBe(true);

            const sql = new SQL(toUrl, { prepare: false, max: 1 });
            const [meal] =
                await sql`select id from public.meals where id = ${mealId}`;
            const [user] =
                await sql`select email from public.users where id = ${userId}`;
            await sql.close();
            expect(meal?.id).toBe(mealId);
            expect(user?.email).toBe("import-test@example.com");
        } finally {
            await sourcePg.stop();
            await targetPg.stop();
        }
    },
);

test.skipIf(!pgAvailable)(
    "reads a source history still under supabase_migrations",
    async () => {
        const sourcePg = await createMigratedDatabase();
        const targetPg = await createMigratedDatabase();
        try {
            const fromUrl = sourcePg.url;
            const toUrl = targetPg.url;
            const sql = new SQL(fromUrl, { prepare: false, max: 1 });
            await sql`
                alter schema foodable_migrations rename to supabase_migrations
            `.simple();
            await sql.close();
            await expect(
                assertMigrationParity(fromUrl, toUrl),
            ).resolves.toBeUndefined();
        } finally {
            await sourcePg.stop();
            await targetPg.stop();
        }
    },
);

test.skipIf(!pgAvailable)("refuses non-empty target", async () => {
    const sourcePg = await createMigratedDatabase();
    const targetPg = await createMigratedDatabase();
    try {
        const fromUrl = sourcePg.url;
        const toUrl = targetPg.url;
        await seedSource(fromUrl);
        await seedSource(toUrl);
        await expect(importPublicData(fromUrl, toUrl)).rejects.toThrow(
            /not empty/,
        );
    } finally {
        await sourcePg.stop();
        await targetPg.stop();
    }
});

test("migrationDiff", () => {
    const diff = migrationDiff(new Set(["a", "b"]), new Set(["b", "c"]));
    expect(diff.onlySource).toEqual(["a"]);
    expect(diff.onlyTarget).toEqual(["c"]);
});

test("pgDatabaseIdentity treats loopback hosts as equal", () => {
    const a = pgDatabaseIdentity("postgres://u@127.0.0.1:5432/foodable");
    const b = pgDatabaseIdentity("postgres://u@localhost:5432/foodable");
    const c = pgDatabaseIdentity("postgres://u@[::1]:5432/foodable");
    expect(a).toEqual(b);
    expect(a).toEqual(c);
});

test("pgDatabaseIdentity folds every loopback spelling together", () => {
    const base = pgDatabaseIdentity("postgres://u@127.0.0.1:5432/foodable");
    for (const host of [
        "127.1",
        "127.000.000.001",
        "127.5.6.7",
        "0177.0.0.1",
        "[::ffff:127.0.0.1]",
        "LOCALHOST",
        "[0:0:0:0:0:0:0:1]",
    ]) {
        expect(
            pgDatabaseIdentity(`postgres://u@${host}:5432/foodable`),
        ).toEqual(base);
    }
    expect(
        pgDatabaseIdentity("postgres://u@128.0.0.1:5432/foodable"),
    ).not.toEqual(base);
});

test("pgDatabaseIdentity rejects query keys that pick another target", () => {
    for (const key of ["dbname", "host", "hostaddr", "port", "service"]) {
        expect(() =>
            pgDatabaseIdentity(`postgres://u@127.0.0.1:5432/foodable?${key}=x`),
        ).toThrow(`"${key}"`);
    }
    expect(
        pgDatabaseIdentity(
            "postgres://u@127.0.0.1:5432/foodable?sslmode=disable&application_name=x",
        ).database,
    ).toBe("foodable");
});

test("assertDistinctDatabaseUrls rejects same database", () => {
    const url = "postgres://postgres@127.0.0.1:54399/foodable";
    expect(() =>
        assertDistinctDatabaseUrls(
            url,
            "postgres://postgres@localhost:54399/foodable",
        ),
    ).toThrow(/same database/);
});

test.skipIf(!pgAvailable)(
    "refuses when source and target are the same migrated database",
    async () => {
        const pg = await createMigratedDatabase();
        try {
            const url = pg.url;
            await expect(importPublicData(url, url)).rejects.toThrow(
                /same database/,
            );
        } finally {
            await pg.stop();
        }
    },
);

test.skipIf(!pgAvailable)(
    "passwordHashParity detects altered hash",
    async () => {
        const sourcePg = await createMigratedDatabase();
        const targetPg = await createMigratedDatabase();
        try {
            const fromUrl = sourcePg.url;
            const toUrl = targetPg.url;
            const { userId } = await seedSource(fromUrl);
            const result = await importPublicData(fromUrl, toUrl);
            expect(result.ok).toBe(true);
            expect(await passwordHashParity(fromUrl, toUrl)).toBe(true);

            const sql = new SQL(toUrl, { prepare: false, max: 1 });
            await sql`
            update public.users
            set password_hash = ${"tampered"}
            where id = ${userId}
        `;
            await sql.close();
            expect(await passwordHashParity(fromUrl, toUrl)).toBe(false);
        } finally {
            await sourcePg.stop();
            await targetPg.stop();
        }
    },
);

test.skipIf(!pgAvailable)(
    "assertMigrationParity on matching migrated DBs",
    async () => {
        const a = await createMigratedDatabase();
        const b = await createMigratedDatabase();
        try {
            const fromUrl = a.url;
            const toUrl = b.url;
            await assertMigrationParity(fromUrl, toUrl);
        } finally {
            await a.stop();
            await b.stop();
        }
    },
);
