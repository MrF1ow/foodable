// The blast-radius floor of the working tree, for filling in a PR body.
//
//   bun run scripts/conventions/blast.ts [--base origin/main] [--verbose]
//
// Prints exactly one of `low`, `medium`, `high` on stdout: the floor CI will
// hold the PR's declared level to. Changed paths are `git diff <base>...HEAD`
// ∪ uncommitted ∪ untracked, like check:changed. `--verbose` prints the areas
// and the paths that forced `high` on stderr. `--paths a,b` uses exactly those
// paths instead of asking git.

import { blastFloor } from "./conventions.ts";
import { baseFromArgs, gatherChangedPaths } from "./local-changes.ts";

export function parseBlastArgs(argv: readonly string[]): {
    base: string;
    verbose: boolean;
    paths: string[] | null;
} {
    let paths: string[] | null = null;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        const raw =
            arg === "--paths"
                ? argv[++i]
                : arg.startsWith("--paths=")
                  ? arg.slice("--paths=".length)
                  : undefined;
        if (raw !== undefined) {
            paths = raw
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
        }
    }
    return {
        base: baseFromArgs(argv),
        verbose: argv.includes("--verbose"),
        paths,
    };
}

if (import.meta.main) {
    try {
        const cli = parseBlastArgs(process.argv.slice(2));
        const paths = cli.paths ?? gatherChangedPaths(cli.base);
        const floor = blastFloor(paths);
        if (cli.verbose) {
            console.error(`${paths.length} changed paths vs ${cli.base}`);
            console.error(
                `areas: ${floor.areas.length > 0 ? floor.areas.join(",") : "none"}`,
            );
            for (const p of floor.highPaths) console.error(`high: ${p}`);
        }
        console.log(floor.level);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
