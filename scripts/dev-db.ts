/**
 * Persistent local Postgres for development (no Docker).
 *
 *   bun run db:dev init | start | stop | status | url | migrate
 *
 * Data: FOODABLE_PG_DIR (default ~/.local/share/foodable/pg)
 * Port: FOODABLE_PG_PORT (default 54330; avoids Supabase 54321–54324 and dry-run 54329)
 */

import { SQL } from "bun";
import { migrate } from "../src/db/migrate.js";
import { parseDevDbCommand } from "../src/db/testing/dev-db-config.js";
import { openPersistentPostgres } from "../src/db/testing/pg-persistent.js";

const cmd = parseDevDbCommand(process.argv);
const pg = await openPersistentPostgres();

async function runMigrate(): Promise<void> {
    const sql = new SQL(pg.url, { prepare: false, max: 1 });
    try {
        await migrate(sql, { log: (line) => console.log(line) });
    } finally {
        await sql.close();
    }
}

switch (cmd) {
    case "init": {
        const initialized = await pg.isInitialized();
        if (!initialized) {
            await pg.initCluster();
            console.log(`Initialized Postgres in ${pg.dataDir}`);
        } else {
            console.log(`Already initialized: ${pg.dataDir}`);
        }
        await pg.start();
        await pg.ensureDatabase();
        await runMigrate();
        console.log(pg.url);
        break;
    }
    case "start":
        await pg.start();
        console.log(`Postgres running on 127.0.0.1:${pg.port}`);
        break;
    case "stop":
        await pg.stop();
        console.log("Postgres stopped");
        break;
    case "status": {
        const initialized = await pg.isInitialized();
        if (!initialized) {
            console.log("not initialized");
            process.exitCode = 1;
            break;
        }
        const running = await pg.isRunning();
        console.log(running ? "running" : "stopped");
        if (!running) process.exitCode = 1;
        break;
    }
    case "url":
        console.log(pg.url);
        break;
    case "migrate":
        if (!(await pg.isRunning())) {
            console.error("Postgres is not running. Run: bun run db:dev start");
            process.exit(1);
        }
        await runMigrate();
        break;
}
