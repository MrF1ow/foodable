/**
 * Copy public data from one Postgres into another plain Postgres that already
 * ran db:dev init / db:migrate.
 *
 *   bun run db:import-postgres --from <url> [--to <url>]
 *
 * Default --to is the db:dev DATABASE_URL (127.0.0.1:54330/foodable).
 */

import {
    assertDistinctDatabaseUrls,
    assertMigrationParity,
    assertTargetPublicEmpty,
    defaultImportTargetUrl,
    importPublicData,
    printImportReport,
} from "../src/db/testing/import-postgres-data.js";

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

const fromUrl = flag("--from");
const toUrl = flag("--to") ?? defaultImportTargetUrl();

if (!fromUrl) {
    console.error(
        "Usage: bun run db:import-postgres --from <postgres-url> [--to <url>]",
    );
    process.exit(1);
}

try {
    assertDistinctDatabaseUrls(fromUrl, toUrl);
} catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}

if (process.argv.includes("--check-only")) {
    try {
        await assertMigrationParity(fromUrl, toUrl);
        await assertTargetPublicEmpty(toUrl);
        console.log("Preconditions OK");
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    process.exit(0);
}

const result = await importPublicData(fromUrl, toUrl);
printImportReport(result);
process.exit(result.ok ? 0 : 1);
