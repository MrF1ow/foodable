import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    test,
} from "bun:test";
import {
    chmodSync,
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

// One fresh cluster under a root whose path has a space, stopped with keep:
// it must start at all, and the kept data must hold the last commit even
// though durability is off.
describe.skipIf(!pgAvailable)("a kept cluster", () => {
    let base: string;
    let kept:
        | {
              dir: string;
              row: string;
              started: boolean;
          }
        | undefined;

    beforeAll(async () => {
        base = mkdtempSync(join(tmpdir(), "foodable-keep-"));
        const before = process.env.FOODABLE_PG_TEST_DIR;
        process.env.FOODABLE_PG_TEST_DIR = join(base, "pg root");
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

    test("starts under a root with a space", () => {
        expect(kept?.dir).toContain("pg root/");
    });

    test("keeps the last commit", () => {
        expect(kept?.started).toBe(true);
        expect(kept?.row).toBe("42");
    });
});

test.skipIf(!pgAvailable)(
    "sweep leaves a folder whose server answers but cannot be seen",
    async () => {
        // A live run in another pid namespace: its owner and postmaster pids
        // look dead from here, but its server answers on its port.
        root = mkdtempSync(join(tmpdir(), "foodable-sweep-"));
        const live = await createTestDatabase();
        try {
            const port = new URL(live.url).port;
            const dir = runDir("run-other-namespace", deadPid());
            writeFileSync(
                join(dir, "data/postmaster.pid"),
                `${deadPid()}\n${join(dir, "data")}\n0\n${port}\n`,
            );
            const bin = binPrefix((await findPgBin())!);
            expect(sweepPgTestRoot(root, bin)).toEqual([]);
            expect(existsSync(dir)).toBe(true);
        } finally {
            await live.stop();
        }
    },
);

// ps cuts its output at $COLUMNS, which once hid the data path from the
// "is this our postgres" check and orphaned a live server. Bun does not pass
// a runtime process.env change to children, so this runs in its own process.
describe.skipIf(!pgAvailable)("with a narrow COLUMNS", () => {
    let base: string;
    let result: { stoppedAlive: boolean; dirLeft: boolean } | undefined;

    beforeAll(async () => {
        base = mkdtempSync(join(tmpdir(), "foodable-columns-"));
        const script = `
            import { readFileSync, existsSync } from "node:fs";
            import { startTempPostgres } from ${JSON.stringify(join(import.meta.dir, "pg-temp.ts"))};
            const pg = await startTempPostgres();
            const pid = Number(readFileSync(pg.dir + "/data/postmaster.pid", "utf8").split("\\n")[0]);
            await pg.stop();
            let alive = true;
            try { process.kill(pid, 0); } catch { alive = false; }
            console.log(JSON.stringify({ stoppedAlive: alive, dirLeft: existsSync(pg.dir) }));
        `;
        const proc = Bun.spawnSync(
            [process.execPath, "--no-env-file", "-e", script],
            {
                env: {
                    ...process.env,
                    COLUMNS: "20",
                    FOODABLE_PG_TEST_DIR: join(base, "pg"),
                },
            },
        );
        const line = proc.stdout.toString().trim().split("\n").at(-1) ?? "";
        result = JSON.parse(line);
    }, DB_SETUP_TIMEOUT_MS);

    afterAll(() => {
        if (base) rmSync(base, { recursive: true, force: true });
    });

    test("stop() still stops the server", () => {
        expect(result).toEqual({ stoppedAlive: false, dirLeft: false });
    });
});

async function startError(root: string): Promise<string> {
    const before = process.env.FOODABLE_PG_TEST_DIR;
    process.env.FOODABLE_PG_TEST_DIR = root;
    try {
        const pg = await startTempPostgres();
        await pg.stop();
        return "started";
    } catch (err) {
        return (err as Error).message;
    } finally {
        if (before === undefined) delete process.env.FOODABLE_PG_TEST_DIR;
        else process.env.FOODABLE_PG_TEST_DIR = before;
    }
}

test.skipIf(!pgAvailable)(
    "a root pg_ctl's shell would expand is refused, not run",
    async () => {
        root = mkdtempSync(join(tmpdir(), "foodable-root-"));
        const marker = join(root, "MARKER");
        const message = await startError(join(root, `pg $(touch ${marker})`));
        expect(message).toContain("FOODABLE_PG_TEST_DIR");
        expect(existsSync(marker)).toBe(false);
    },
);

test.skipIf(!pgAvailable)(
    "an unwritable root names FOODABLE_PG_TEST_DIR",
    async () => {
        root = mkdtempSync(join(tmpdir(), "foodable-root-"));
        chmodSync(root, 0o500);
        try {
            const message = await startError(join(root, "pg"));
            expect(message).toContain("Set FOODABLE_PG_TEST_DIR");
        } finally {
            chmodSync(root, 0o700);
        }
    },
);

test("sweep of a missing root is a no-op", () => {
    expect(sweepPgTestRoot("/nonexistent/foodable-pg-test", "/x/")).toEqual([]);
});
