import { afterEach, expect, test } from "bun:test";
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
import { pgTestRoot, sweepPgTestRoot } from "./pg-temp.js";

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

function runDir(name: string, owner?: number, opts?: { ageMs?: number }) {
    const dir = join(root!, name);
    mkdirSync(join(dir, "data"), { recursive: true });
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

    const removed = sweepPgTestRoot(root, "/nonexistent/");

    expect(removed.sort()).toEqual([dead, stale].sort());
    for (const dir of [alive, mine, fresh, kept, other]) {
        expect(existsSync(dir)).toBe(true);
    }
});

test("sweep of a missing root is a no-op", () => {
    expect(sweepPgTestRoot("/nonexistent/foodable-pg-test", "/x/")).toEqual([]);
});
