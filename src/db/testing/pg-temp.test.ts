import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    test,
} from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binPrefix, findPgBin, pickPort } from "./pg-shared.js";
import {
    createTestDatabase,
    ensureTemplate,
    pgTestRoot,
    startTempPostgres,
    sweepPgTestRoot,
} from "./pg-temp.js";
import { DB_SETUP_TIMEOUT_MS } from "./pg.js";

const pgAvailable = !!(await findPgBin());

// Starts the shared server outside the per-test timeout.
if (pgAvailable) {
    beforeAll(async () => {
        await (await createTestDatabase()).stop();
    }, DB_SETUP_TIMEOUT_MS);
}

let root: string | undefined;

afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
});

// A pid that certainly belonged to a process and is now gone.
function deadPid(): number {
    const proc = Bun.spawnSync(["true"]);
    return proc.pid;
}

function runDir(
    name: string,
    owner?: number,
    opts?: { ageMs?: number; cluster?: boolean },
) {
    const dir = join(root!, name);
    mkdirSync(join(dir, "data"), { recursive: true });
    if (opts?.cluster !== false)
        writeFileSync(join(dir, "data/PG_VERSION"), "18\n");
    if (owner !== undefined)
        writeFileSync(join(dir, "owner.pid"), `${owner}\n`);
    if (opts?.ageMs) {
        const t = new Date(Date.now() - opts.ageMs);
        utimesSync(dir, t, t);
    }
    return dir;
}

test("pgTestRoot honours the override, then XDG_CACHE_HOME, then ~/.cache", () => {
    expect(pgTestRoot({ FOODABLE_PG_TEST_DIR: "/x/pg" })).toBe("/x/pg");
    expect(pgTestRoot({ XDG_CACHE_HOME: "/c" })).toBe("/c/foodable/pg-test");
    expect(pgTestRoot({})).toMatch(/\/\.cache\/foodable\/pg-test$/);
});

test("pgTestRoot makes a relative path absolute", () => {
    expect(pgTestRoot({ FOODABLE_PG_TEST_DIR: "rel/pg" })).toBe(
        join(process.cwd(), "rel/pg"),
    );
    expect(pgTestRoot({ XDG_CACHE_HOME: "c" })).toBe(
        join(process.cwd(), "c/foodable/pg-test"),
    );
});

test.skipIf(!pgAvailable)(
    "a failed template build is retried and reports its own error",
    async () => {
        const name = `tpl_${crypto.randomUUID().replace(/-/g, "")}`;
        const fail = () => Promise.reject(new Error("real build failure"));
        await expect(ensureTemplate(name, fail)).rejects.toThrow(
            "real build failure",
        );
        await expect(ensureTemplate(name, fail)).rejects.toThrow(
            "real build failure",
        );
        await ensureTemplate(name, async () => {});
        const db = await createTestDatabase({ template: name });
        try {
            expect(await db.scalar("select 1")).toBe("1");
        } finally {
            await db.stop();
        }
    },
);

test("sweep removes only abandoned run folders", () => {
    root = mkdtempSync(join(tmpdir(), "foodable-sweep-"));
    const hour = 60 * 60 * 1000;
    const dead = runDir("run-dead", deadPid());
    const alive = runDir("run-alive", process.ppid, { ageMs: 5 * hour });
    const mine = runDir("run-mine", process.pid);
    const fresh = runDir("run-fresh");
    const stale = runDir("run-stale", undefined, { ageMs: 2 * hour });
    const kept = runDir("run-kept", deadPid());
    writeFileSync(join(kept, "KEEP"), "");
    const other = runDir("not-ours", deadPid(), { ageMs: 2 * hour });
    // Someone else's run-* folder in a shared root: no owner, no cluster.
    const foreign = runDir("run-photos", undefined, {
        ageMs: 2 * hour,
        cluster: false,
    });

    const removed = sweepPgTestRoot(root, "/nonexistent/");

    expect(removed.sort()).toEqual([dead, stale].sort());
    for (const dir of [alive, mine, fresh, kept, other, foreign]) {
        expect(existsSync(dir)).toBe(true);
    }
});

test.skipIf(!pgAvailable)(
    "sweep never signals a process a stale postmaster.pid names",
    async () => {
        root = mkdtempSync(join(tmpdir(), "foodable-sweep-"));
        const bystander = Bun.spawn(["sleep", "60"]);
        try {
            const dir = runDir("run-rebooted", deadPid());
            writeFileSync(
                join(dir, "data/postmaster.pid"),
                `${bystander.pid}\n${join(dir, "data")}\n`,
            );
            const bin = binPrefix((await findPgBin())!);
            expect(sweepPgTestRoot(root, bin)).toEqual([dir]);
            expect(bystander.killed).toBe(false);
            expect(bystander.exitCode).toBeNull();
        } finally {
            bystander.kill("SIGKILL");
        }
    },
);

// One fresh cluster under a root whose path has a space and a quote, stopped
// with keep: it must start at all, and the kept data must hold the last
// commit even though durability is off.
describe.skipIf(!pgAvailable)("a kept cluster", () => {
    let base: string;
    let kept: { dir: string; row: string; started: boolean } | undefined;

    beforeAll(async () => {
        base = mkdtempSync(join(tmpdir(), "foodable-keep-"));
        const before = process.env.FOODABLE_PG_TEST_DIR;
        process.env.FOODABLE_PG_TEST_DIR = join(base, "pg root's");
        try {
            const pg = await startTempPostgres();
            await pg.scalar(
                "create table kept_row (v int); insert into kept_row values (42)",
            );
            await pg.stop({ keep: true });
            const bin = binPrefix((await findPgBin())!);
            const port = await pickPort();
            const data = join(pg.dir, "data");
            const start = Bun.spawnSync([
                `${bin}pg_ctl`,
                "-D",
                data,
                "-l",
                join(pg.dir, "restart.log"),
                "-w",
                "-o",
                `-p ${port} -k '${base}' -h 127.0.0.1`,
                "start",
            ]);
            const q = Bun.spawnSync([
                `${bin}psql`,
                "-h",
                "127.0.0.1",
                "-p",
                String(port),
                "-U",
                "postgres",
                "-tAXc",
                "select v from kept_row",
            ]);
            Bun.spawnSync([`${bin}pg_ctl`, "-D", data, "-m", "fast", "stop"]);
            kept = {
                dir: pg.dir,
                row: (q.stdout.toString() + q.stderr.toString()).trim(),
                started: start.exitCode === 0,
            };
        } finally {
            if (before === undefined) delete process.env.FOODABLE_PG_TEST_DIR;
            else process.env.FOODABLE_PG_TEST_DIR = before;
        }
    }, DB_SETUP_TIMEOUT_MS);

    afterAll(() => {
        if (base) rmSync(base, { recursive: true, force: true });
    });

    test("starts under a root with a space and a quote", () => {
        expect(kept?.dir).toContain("pg root's");
    });

    test("keeps the last commit", () => {
        expect(kept?.started).toBe(true);
        expect(kept?.row).toBe("42");
    });
});

test("sweep of a missing root is a no-op", () => {
    expect(sweepPgTestRoot("/nonexistent/foodable-pg-test", "/x/")).toEqual([]);
});
