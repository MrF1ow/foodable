// Preloaded by `bun test` (bunfig.toml), before any test file loads.
//
// public/login.html is generated and gitignored, so a fresh checkout has none
// until `bun run gen:all`. CI runs that before its tests, but a cold local
// `bun test` did not: every test that serves the login page failed until
// src/public-site.test.ts ran gen:all itself partway through, and the next
// run passed. Writing the template here when it is missing makes the first
// run match the rest. An existing file is left alone; regenerating after a
// copy change is still `bun run gen:all`.
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

if (!existsSync(join(root, "public", "login.html"))) {
    // --no-env-file: the generator needs no secrets, and the child bun would
    // otherwise load .env even when this run was started without it.
    const gen = Bun.spawnSync(
        [process.execPath, "--no-env-file", "scripts/gen-login.ts"],
        { cwd: root, stdout: "ignore", stderr: "pipe" },
    );
    if (gen.exitCode !== 0) {
        throw new Error(
            `test preload: scripts/gen-login.ts failed (exit ${gen.exitCode})\n${gen.stderr.toString()}`,
        );
    }
}
