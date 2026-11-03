import { expect, test } from "bun:test";
import {
    DEFAULT_DEV_PG_PORT,
    DEV_DATABASE_NAME,
    defaultPgDataDir,
    devDatabaseUrl,
    devPgPort,
    parseDevDbCommand,
} from "./dev-db-config.js";

test("default port avoids Supabase and dry-run ports", () => {
    expect(DEFAULT_DEV_PG_PORT).not.toBe(54329);
    expect(DEFAULT_DEV_PG_PORT).toBeGreaterThan(54324);
});

test("devDatabaseUrl", () => {
    expect(devDatabaseUrl(54330)).toBe(
        "postgres://postgres@127.0.0.1:54330/foodable",
    );
    expect(devDatabaseUrl(1, "postgres")).toBe(
        "postgres://postgres@127.0.0.1:1/postgres",
    );
});

test("defaultPgDataDir ends under foodable/pg", () => {
    expect(defaultPgDataDir()).toMatch(/foodable[/\\]pg$/);
});

test("devPgPort reads FOODABLE_PG_PORT", () => {
    const prev = process.env.FOODABLE_PG_PORT;
    process.env.FOODABLE_PG_PORT = "5555";
    try {
        expect(devPgPort()).toBe(5555);
    } finally {
        if (prev === undefined) delete process.env.FOODABLE_PG_PORT;
        else process.env.FOODABLE_PG_PORT = prev;
    }
});

test("parseDevDbCommand", () => {
    expect(parseDevDbCommand(["bun", "dev-db.ts", "url"])).toBe("url");
    expect(() => parseDevDbCommand(["bun", "dev-db.ts", "nope"])).toThrow(
        /Usage/,
    );
});

test("DEV_DATABASE_NAME", () => {
    expect(DEV_DATABASE_NAME).toBe("foodable");
});
