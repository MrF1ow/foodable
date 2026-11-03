import { SQL } from "bun";
import { migrate } from "../src/db/migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
}

const sql = new SQL(url, { prepare: false, max: 1 });

if (process.argv.includes("--list")) {
    const { applied, pending } = await migrate(sql, { dryRun: true });
    for (const line of applied) console.log(`applied  ${line}`);
    for (const line of pending) console.log(`pending  ${line}`);
    await sql.close();
    process.exit(0);
}

const log = (line: string) => console.log(line);
await migrate(sql, { log });
await sql.close();
