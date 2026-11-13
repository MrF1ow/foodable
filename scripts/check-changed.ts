// Run the checks CI would run for the files you changed.
//
//   bun run check:changed [--base <ref>] [--list] [--all] [--json] [--paths a,b]
//
//   --base <ref>  compare against <ref> (default origin/main)
//   --list        print the checks and exit without running them
//   --all         every check, ignoring what changed (CI's push to main lists
//                 the same commands in ci.yml instead of running this script)
//   --json        print the checks as a JSON array and exit (implies --list);
//                 for CI, which feeds each `cmd` to a step
//   --paths a,b   pretend exactly these paths changed (debugging the mapping)
//
// Changed paths = `git diff <base>...HEAD` (committed on this branch) ∪
// uncommitted changes ∪ untracked files. Every check runs even when an earlier
// one fails; the summary lists pass/fail per check and the exit code is
// non-zero if any failed.
//
// `changedChecks` is the pure seam: paths in, checks out. It never touches the
// disk or git; the CLI at the bottom supplies the file list and the import
// graph (`buildImportGraph`). Test selection is reverse-dependency: a changed
// file selects every test that imports it, directly or transitively. What
// imports cannot see (files read from disk, generated output, docs) is the rule
// table below, so extending it means editing data, not control flow.
//
// What this mirrors from .github/workflows/ci.yml: format, typecheck, tests and
// the migrations job. It does not mirror the docker build, CodeQL, dependency
// review, workflow lint or the policy checks (skill drift, agent
// context budget, conventions): those run only in CI.

export type Check = {
    /** Stable machine name: `format`, `typecheck`, `test`, … */
    id: string;
    /** One line for humans. */
    label: string;
    /** argv, run from the repo root. */
    cmd: string[];
};

export type ChangedChecksOptions = {
    /** Ref the migration-safety check compares against. Default `origin/main`. */
    base?: string;
    /** Return every check regardless of `paths`. */
    all?: boolean;
    /**
     * Every file that exists in the working tree (tracked or untracked). It
     * answers "does this changed file still exist" (a deleted file cannot be
     * formatted or run) and "which tests exist". Default: just `paths`, i.e.
     * the changed files exist and no other test is known.
     */
    files?: readonly string[];
    /**
     * The import graph: repo-relative file → the repo files it imports (static,
     * dynamic and re-exports; type-only imports are not runtime edges). Build it
     * with `buildImportGraph`. Default: empty, so only siblings and TEST_RULES
     * select tests.
     */
    imports?: Readonly<Record<string, readonly string[]>>;
};

export const DEFAULT_BASE = "origin/main";

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------
//
// path → checks (an absent row means that check is not triggered):
//
//   format      every changed file that still exists (`bun fmt` skips ignored and
//               unknown files itself). The whole tree (`format:check`) when the
//               `[fmt]` config (bunfig.toml), package.json or bun.lock changes:
//               the rules or the Bun version moved, so untouched files can start
//               failing.
//   typecheck   any .ts/.tsx/.js/.mjs/.cjs/.json (dot-dirs excluded), tsconfig,
//               package.json, bun.lock.
//   test        one `bun test <files>` for the union of:
//                 - each changed *.test.ts;
//                 - every test that imports a changed file, directly or
//                   transitively (the `imports` graph), plus its sibling
//                   (foo.ts → foo.test.ts) for files the graph does not know;
//                 - the tests TEST_RULES name for it (things imports cannot
//                   see: assets read from disk, docs, generated files).
//               The whole suite (`bun test`) instead when FULL_SUITE matches a
//               path; when a changed non-test file under src/ or public/ has no
//               test mapped to it (we cannot say what it affects); or when the
//               selection is more than FULL_SUITE_RATIO of all tests.
//               scripts/conventions/conventions.test.ts rides along on every
//               non-docs change: it fails on any tracked file that
//               conventions.ts does not map, and it takes milliseconds.
//               Docs-only changes run only the tests that read those docs.
//   migrations  db/migrations/ → migration-safety (vs the base) and
//               db:dryrun, plus the full suite (describeDb tests migrate
//               from db/). Other db/ files and the dry-run script → db:dryrun.
//   lint        see lintCheck(): oxlint on the changed .ts/.tsx/.js/.mjs files,
//               or the whole tree when .oxlintrc.json, scripts/lint-rules/,
//               package.json or bun.lock (the oxlint pin) change.

/** A change under any of these can break any test: run the whole suite. */
const FULL_SUITE: RegExp[] = [
    /^src\/db\//,
    /^scripts\/conventions\//,
    /^package\.json$/,
    /^bun\.lock$/,
    /^tsconfig[^/]*\.json$/,
    /^bunfig\.toml$/,
    /^public\/widgets\/src\/shared\//,
    /^src\/mcp\/tools-list\.snapshot\.json$/,
    // Every describeDb test migrates its temp database from db/ (through
    // src/db/testing/pg.ts), and nothing imports a .sql file, so the import
    // graph cannot see these edges.
    /^db\/(migrations\/|bootstrap\.sql$)/,
];

/** `bun fmt`'s own inputs: a change re-judges every file, not only this one. */
const FORMAT_ALL_TRIGGERS: RegExp[] = [
    /^bunfig\.toml$/,
    /^\.editorconfig$/,
    /^package\.json$/,
    /^bun\.lock$/,
];

/** Selecting more than this share of the tests is just the full suite. */
const FULL_SUITE_RATIO = 0.6;
/** Below this many tests the ratio means nothing (tiny trees, unit tests). */
const FULL_SUITE_RATIO_MIN_TESTS = 20;

/**
 * Changed path → the existing tests (matched against `files`) that cover it
 * beyond what the import graph finds. A path may match several rows; they add
 * up. Rows apply to docs too, so a doc a test reads is never "docs only".
 * An `incidental` row names tests that merely scan the tree (they ride along
 * like conventions.test.ts): they run, but do not count as covering the file,
 * so a source file only they reach still falls back to the full suite.
 */
export const TEST_RULES: { when: RegExp; tests: RegExp; incidental?: true }[] =
    [
        // ---- docs and config that tests read from disk
        {
            when: /^CONTRIBUTING\.md$/,
            tests: /^scripts\/conventions\/conventions\.test\.ts$/,
        },
        {
            when: /^(CLAUDE\.md|AGENTS\.md|\.claude\/skills\/|\.agents\/skills)/,
            tests: /^scripts\/conventions\/skills\.test\.ts$/,
        },
        // docs-drift.test.ts reads CLAUDE.md, the shipped app CSS, .env.example
        // and the flag table.
        {
            when: /^(CLAUDE\.md|AGENTS\.md|\.env\.example|public\/app\/.+\.css|src\/flags\.ts)$/,
            tests: /^src\/docs-drift\.test\.ts$/,
        },
        {
            when: /^flags\/rollout\.yml$/,
            tests: /^src\/flags-rollout\.test\.ts$/,
        },
        {
            when: /^docs\/fetcher\.md$/,
            tests: /^src\/fetch-safe\.test\.ts$/,
        },
        // ---- scanners that read every source file
        {
            when: /^(src|scripts)\/.+\.(ts|js)$/,
            tests: /^src\/(flags|web\/route-map)\.test\.ts$/,
            incidental: true,
        },
        {
            when: /^src\/web\/.+\.ts$/,
            tests: /^src\/copy\/notices-inline-guard\.test\.ts$/,
            incidental: true,
        },
        // field.test.ts globs src/web/**/*.ts for hand-written labels;
        // turbo-forms.test.ts reads pages/v2/settings-household-modals.ts,
        // components/ui.ts and shell.ts.
        {
            when: /^src\/web\/.+\.ts$/,
            tests: /^src\/web\/(components\/field|turbo-forms)\.test\.ts$/,
            incidental: true,
        },
        // actor-allowlist.test.ts scans src/**/*.ts for runAsSystem callers.
        {
            when: /^src\/.+\.ts$/,
            tests: /^src\/db\/actor-allowlist\.test\.ts$/,
            incidental: true,
        },
        // notices.test.ts globs src/**/*.ts for hand-built allergen and expiry markup.
        {
            when: /^src\/.+\.ts$/,
            tests: /^src\/web\/components\/notices\.test\.ts$/,
            incidental: true,
        },
        // toast.test.ts reads every route module, toast-flash.ts and client/toast.js.
        {
            when: /^src\/web\/(routes\/.+\.ts|components\/toast-flash\.ts|client\/toast\.js)$/,
            tests: /^src\/web\/components\/toast\.test\.ts$/,
            incidental: true,
        },
        // ui.test.ts asserts every page module (and loaders.ts) goes through pageHeader.
        {
            when: /^src\/web\/(pages\/.+|loaders)\.ts$/,
            tests: /^src\/web\/components\/ui\.test\.ts$/,
            incidental: true,
        },
        // shared-import.test.ts reads these page and component sources as text.
        {
            when: /^src\/web\/(pages\/(fridge|grocery|recipes|nutrition)|components\/(ui|page-markup))\.ts$|^src\/web\/client\/food-picker\.js$/,
            tests: /^src\/web\/components\/shared-import\.test\.ts$/,
        },
        // shell.test.ts evaluates client/shell.js, which sits outside its import graph.
        {
            when: /^src\/web\/client\/shell\.js$/,
            tests: /^src\/web\/shell\.test\.ts$/,
        },
        {
            when: /^src\/domain\/csv\.ts$/,
            tests: /^src\/domain\/geometry\.test\.ts$/,
        },
        // ---- fixtures read from disk
        {
            when: /^src\/domain\/fixtures\//,
            tests: /^src\/(domain\/(recipe-text|recipe-import|recipe-jsonld|recipe-mentions|social-readers)|db\/recipes|mcp)\.test\.ts$/,
        },
        {
            when: /^src\/domain\/__fixtures__\/off\//,
            tests: /^src\/domain\/product-score\.test\.ts$/,
        },
        {
            when: /^src\/web\/fixtures\//,
            tests: /^src\/web\/shell(-v2)?\.test\.ts$/,
        },
        // ---- assets
        // Widget templates are assembled by src/widgets.ts and driven by the
        // browser-side tests next to them.
        {
            when: /^public\/widgets\/src\/templates\//,
            tests: /^(src\/(widgets|widget-frames)|public\/widgets\/[^/]+)\.test\.ts$/,
        },
        // The app stylesheet layer is asserted by the app-* tests and framed by the
        // widget tests; the token tests read its generated sheets.
        {
            when: /^public\/app\//,
            tests: /^src\/(app-[^/]+|widgets|widget-frames|tokens|tokens-v2)\.test\.ts$/,
        },
        // Tests that read the app stylesheets from disk: field.test.ts reads
        // app.css, the v2 tests read public/app/v2/*.css, recipes.test.ts reads
        // app.css for one rule, settings-home.test.ts reads settings.css,
        // select-mode.test.ts reads select.css and the v2 token sheets.
        {
            when: /^public\/app\//,
            tests: /^src\/web\/(components\/field|components\/v2\/[^/]+|pages\/recipes|pages\/v2\/(settings-home|select-mode))\.test\.ts$/,
        },
        // turbo-forms.test.ts reads the generated login page.
        {
            when: /^public\/login\.html$/,
            tests: /^src\/web\/turbo-forms\.test\.ts$/,
            incidental: true,
        },
        {
            when: /^src\/web\/client\//,
            tests: /^src\/app-(js|assets)\.test\.ts$|^src\/web\/client\/.+\.test\.ts$/,
        },
        // Tokens generate the CSS the app and widgets ship.
        {
            when: /^(src\/tokens\.ts|scripts\/gen-tokens\.ts)$/,
            tests: /^src\/(tokens|tokens-v2|app-brand|app-css|widgets|public-site)\.test\.ts$/,
        },
        // Brand geometry and the generated icons / static assets.
        {
            when: /^(src\/brand\.ts|scripts\/gen-icons\.ts|public\/(brand\/|fonts\/|favicon|apple-touch-icon|icon-))/,
            tests: /^src\/(brand|app-assets|web\/manifest)\.test\.ts$/,
        },
        // The generated login page and its inputs.
        {
            when: /^(public\/login\.html|public\/robots\.txt|scripts\/gen-login\.ts|scripts\/site-partials\.ts)$/,
            tests: /^src\/(public-site|oauth)\.test\.ts$/,
        },
        // Tool copy and the agent surface are pinned by the MCP tests.
        {
            when: /^src\/copy\//,
            tests: /^src\/(mcp|mcp\.format)\.test\.ts$|^src\/copy\/[^/]+\.test\.ts$/,
        },
        {
            when: /^src\/mcp(\/|\.ts$)/,
            tests: /^src\/(mcp|mcp\.format)\.test\.ts$|^src\/mcp\/[^/]+\.test\.ts$/,
        },
        // The rule test runs oxlint over the fixtures (nothing imports them) and
        // must also run when a rule file is deleted; check-suppressions.test.ts
        // reads its own fixtures the same way.
        {
            when: /^(scripts\/lint-rules\/|\.oxlintrc\.json$)/,
            tests: /^scripts\/lint-rules\/[^/]+\.test\.ts$/,
        },
        // food-merge-job.test.ts spawns the script instead of importing it.
        {
            when: /^scripts\/merge-duplicate-foods\.ts$/,
            tests: /^src\/domain\/food-merge-job\.test\.ts$/,
        },
        {
            when: /^scripts\/migration-safety(\/|\.ts$)/,
            tests: /^scripts\/migration-safety\/[^/]+\.test\.ts$/,
        },
    ];

const CONVENTIONS_TEST = "scripts/conventions/conventions.test.ts";
// Fails when a path a skill watches disappears; deleted paths reach no other
// test, and it is as cheap as the conventions test.
const SKILLS_TEST = "scripts/conventions/skills.test.ts";

const isDoc = (p: string) => /\.md$/.test(p) || p.startsWith("docs/");
const isTest = (p: string) => /\.test\.ts$/.test(p);
const isMigration = (p: string) => /^db\/migrations\//.test(p);
const affectsTypecheck = (p: string) =>
    /\.(ts|tsx|js|mjs|cjs)$/.test(p) ||
    (/\.json$/.test(p) && !p.startsWith(".")) ||
    /^bun\.lock$/.test(p);
/**
 * Code and assets whose behaviour tests pin: any non-test file under src/ or
 * public/. If no test maps to one, run them all.
 */
const isAppSource = (p: string) => /^(src|public)\//.test(p) && !isTest(p);

/**
 * The single place the linter (oxlint, `bun run lint`) joins the checks. Runs
 * on `files` (the changed files that still exist), or on the whole tree when
 * `all` is set or the linter's own inputs changed (.oxlintrc.json, the rules
 * in scripts/lint-rules/): a new rule can fail files nobody touched. Null when
 * no lintable file changed. `--no-error-on-unmatched-pattern` keeps a change
 * to nothing but ignored files (the rule fixtures, generated code) from
 * failing with "No files found to lint".
 */
function lintCheck(
    files: readonly string[],
    all: boolean,
    changed: readonly string[] = files,
): Check | null {
    const wholeTree: Check = {
        id: "lint",
        label: "lint: whole tree",
        cmd: ["bun", "run", "lint"],
    };
    if (all) return wholeTree;
    if (
        // `changed`, not `files`: deleting a rule or the config re-judges the
        // whole tree too, and so does a bump of the pinned oxlint (package.json
        // and bun.lock hold the version).
        changed.some((p) =>
            /^(\.oxlintrc\.json|package\.json|bun\.lock|scripts\/lint-rules\/)/.test(
                p,
            ),
        )
    ) {
        return wholeTree;
    }
    const lintable = files.filter((p) => /\.(ts|tsx|js|mjs)$/.test(p));
    if (lintable.length === 0) return null;
    return {
        id: "lint",
        label: `lint: ${lintable.length} file${lintable.length === 1 ? "" : "s"}`,
        cmd: [
            "bun",
            "run",
            "lint",
            "--no-error-on-unmatched-pattern",
            ...lintable,
        ],
    };
}

const FORMAT_ALL: Check = {
    id: "format",
    label: "format: whole tree",
    cmd: ["bun", "run", "format:check"],
};
const TYPECHECK: Check = {
    id: "typecheck",
    label: "typecheck: src, scripts, tests",
    cmd: ["bun", "run", "typecheck"],
};
const TEST_ALL: Check = {
    id: "test",
    label: "test: full suite",
    cmd: ["bun", "test"],
};

export function changedChecks(
    paths: readonly string[],
    opts: ChangedChecksOptions = {},
): Check[] {
    const base = opts.base ?? DEFAULT_BASE;
    const changed = [...new Set(paths)].sort();
    const exists = new Set(opts.files ?? changed);
    const live = changed.filter((p) => exists.has(p));
    const checks: Check[] = [];

    if (opts.all) {
        checks.push(FORMAT_ALL);
        const lint = lintCheck([], true);
        if (lint) checks.push(lint);
        checks.push(TYPECHECK, TEST_ALL, ...migrationChecks(base));
        return checks;
    }
    if (changed.length === 0) return checks;

    // format
    if (changed.some((p) => FORMAT_ALL_TRIGGERS.some((re) => re.test(p)))) {
        checks.push(FORMAT_ALL);
    } else if (live.length > 0) {
        checks.push({
            id: "format",
            label: `format: ${live.length} file${live.length === 1 ? "" : "s"}`,
            cmd: ["bun", "fmt", "--check", "--ignore-unknown", ...live],
        });
    }

    // lint
    const lint = lintCheck(live, false, changed);
    if (lint) checks.push(lint);

    // typecheck
    if (changed.some(affectsTypecheck)) checks.push(TYPECHECK);

    // tests
    const test = testCheck(changed, exists, opts.imports ?? {});
    if (test) checks.push(test);

    // migrations
    if (changed.some(isMigration)) {
        checks.push(...migrationChecks(base));
    } else if (
        changed.some(
            (p) => /^db\//.test(p) || /^scripts\/migration-dryrun/.test(p),
        )
    ) {
        checks.push(DB_DRYRUN);
    }

    return checks;
}

const DB_DRYRUN: Check = {
    id: "db-dryrun",
    label: "migrations: dry run on a throwaway Postgres",
    cmd: ["bun", "run", "db:dryrun"],
};

function migrationChecks(base: string): Check[] {
    return [
        {
            id: "migration-safety",
            label: `migrations: safety rules vs ${base}`,
            cmd: ["bun", "run", "scripts/migration-safety.ts", "--base", base],
        },
        DB_DRYRUN,
    ];
}

/** file → the files that import it (the inverse of `imports`). */
function invert(
    imports: Readonly<Record<string, readonly string[]>>,
): Map<string, string[]> {
    const importers = new Map<string, string[]>();
    for (const [file, deps] of Object.entries(imports)) {
        for (const dep of deps) {
            const list = importers.get(dep);
            if (list) list.push(file);
            else importers.set(dep, [file]);
        }
    }
    return importers;
}

/** Every file that reaches `start` through imports, `start` excluded. */
function reverseClosure(
    start: string,
    importers: ReadonlyMap<string, readonly string[]>,
): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
        for (const from of importers.get(next) ?? []) {
            if (from === start || seen.has(from)) continue;
            seen.add(from);
            queue.push(from);
        }
    }
    return seen;
}

function testCheck(
    changed: string[],
    exists: ReadonlySet<string>,
    imports: Readonly<Record<string, readonly string[]>>,
): Check | null {
    if (changed.some((p) => FULL_SUITE.some((re) => re.test(p)))) {
        return TEST_ALL;
    }

    const existingTests = [...exists].filter(isTest);
    const importers = invert(imports);
    const tests = new Set<string>();
    let unmapped = false;

    for (const p of changed) {
        const mapped = new Set<string>();
        const incidental = new Set<string>();
        // A deleted file maps to nothing and needs nothing.
        if (exists.has(p)) {
            if (isTest(p)) {
                mapped.add(p);
            } else {
                const sibling = p.replace(/\.[^./]+$/, ".test.ts");
                if (sibling !== p && exists.has(sibling)) mapped.add(sibling);
            }
            for (const from of reverseClosure(p, importers)) {
                if (isTest(from) && exists.has(from)) mapped.add(from);
            }
        }
        for (const rule of TEST_RULES) {
            if (!rule.when.test(p)) continue;
            const into = rule.incidental ? incidental : mapped;
            for (const t of existingTests) if (rule.tests.test(t)) into.add(t);
        }
        for (const t of mapped) tests.add(t);
        for (const t of incidental) tests.add(t);
        if (mapped.size === 0 && isAppSource(p) && exists.has(p)) {
            unmapped = true;
        }
    }

    if (unmapped) return TEST_ALL;
    if (
        existingTests.length >= FULL_SUITE_RATIO_MIN_TESTS &&
        tests.size > FULL_SUITE_RATIO * existingTests.length
    ) {
        return TEST_ALL;
    }
    if (!changed.every(isDoc)) {
        for (const t of [CONVENTIONS_TEST, SKILLS_TEST]) {
            if (exists.has(t)) tests.add(t);
        }
    }
    if (tests.size === 0) return null;

    const list = [...tests].sort();
    return {
        id: "test",
        label: `test: ${list.length} file${list.length === 1 ? "" : "s"}`,
        cmd: ["bun", "test", ...list],
    };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Cli = {
    base: string;
    list: boolean;
    all: boolean;
    json: boolean;
    /** Use exactly these changed paths instead of asking git. */
    paths: string[] | null;
};

export function parseArgs(argv: readonly string[]): Cli {
    const cli: Cli = {
        base: DEFAULT_BASE,
        list: false,
        all: false,
        json: false,
        paths: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--list") cli.list = true;
        else if (arg === "--all") cli.all = true;
        else if (arg === "--json") cli.json = true;
        else if (arg === "--base") {
            const value = argv[++i];
            if (!value) throw new Error("--base needs a ref");
            cli.base = value;
        } else if (arg.startsWith("--base=")) {
            cli.base = arg.slice("--base=".length);
        } else if (arg === "--paths") {
            const value = argv[++i];
            if (!value) throw new Error("--paths needs a comma-separated list");
            cli.paths = splitPaths(value);
        } else if (arg.startsWith("--paths=")) {
            cli.paths = splitPaths(arg.slice("--paths=".length));
        } else {
            throw new Error(
                `unknown argument ${arg}\nusage: bun run check:changed [--base <ref>] [--list] [--all] [--json] [--paths a,b]`,
            );
        }
    }
    return cli;
}

function splitPaths(value: string): string[] {
    return value
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== "");
}

function git(args: string[]): string[] {
    const proc = Bun.spawnSync(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`,
        );
    }
    return proc.stdout
        .toString()
        .split("\n")
        .filter((line) => line !== "");
}

/** Committed on this branch ∪ uncommitted ∪ untracked, renames as delete + add. */
function gatherChangedPaths(base: string): string[] {
    return [
        ...new Set([
            ...git(["diff", "--name-only", "--no-renames", `${base}...HEAD`]),
            ...git(["diff", "--name-only", "--no-renames", "HEAD"]),
            ...git(["ls-files", "--others", "--exclude-standard"]),
        ]),
    ];
}

async function existingFiles(): Promise<string[]> {
    const listed = git([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
    ]);
    const present = await Promise.all(
        listed.map(async (p) => ((await Bun.file(p).exists()) ? p : null)),
    );
    return present.filter((p): p is string => p !== null);
}

// ---------------------------------------------------------------------------
// Import graph
// ---------------------------------------------------------------------------

const CODE_FILE = /\.(ts|tsx|js|mjs)$/;

/**
 * Resolve a relative import specifier from `from` to a file in `fileSet`, or
 * null. The repo writes `./x.js` for `x.ts`, so a `.js` specifier also tries
 * the TypeScript sources; extensionless ones try the usual suffixes and an
 * index file. A bare specifier (a package) is not in the graph.
 */
export function resolveImport(
    from: string,
    specifier: string,
    fileSet: ReadonlySet<string>,
): string | null {
    if (!specifier.startsWith(".")) return null;
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    const parts: string[] = dir === "" ? [] : dir.split("/");
    for (const seg of specifier.split("/")) {
        if (seg === "." || seg === "") continue;
        if (seg === "..") {
            if (parts.length === 0) return null;
            parts.pop();
        } else {
            parts.push(seg);
        }
    }
    const target = parts.join("/");
    const stem = target.replace(/\.(js|mjs)$/, "");
    const candidates = [
        target,
        `${stem}.ts`,
        `${stem}.tsx`,
        `${target}.ts`,
        `${target}.tsx`,
        `${target}.js`,
        `${target}/index.ts`,
        `${target}/index.js`,
    ];
    return candidates.find((c) => fileSet.has(c)) ?? null;
}

/**
 * file → repo files it imports, for every code file in `files`. Uses Bun's
 * transpiler to list the specifiers (static, dynamic and re-exports; type-only
 * imports are erased, which is right: they are not a runtime dependency).
 * Unreadable or unparsable files get no edges rather than failing the run.
 */
export async function buildImportGraph(
    files: readonly string[],
): Promise<Record<string, string[]>> {
    const fileSet = new Set(files);
    const transpilers = {
        ts: new Bun.Transpiler({ loader: "ts" }),
        tsx: new Bun.Transpiler({ loader: "tsx" }),
        js: new Bun.Transpiler({ loader: "js" }),
    };
    const graph: Record<string, string[]> = {};
    await Promise.all(
        files
            .filter((p) => CODE_FILE.test(p) && !p.startsWith("node_modules/"))
            .map(async (file) => {
                const loader = file.endsWith(".tsx")
                    ? "tsx"
                    : file.endsWith(".ts")
                      ? "ts"
                      : "js";
                let found: { path: string }[];
                try {
                    found = transpilers[loader].scanImports(
                        await Bun.file(file).text(),
                    );
                } catch {
                    return;
                }
                const deps = new Set<string>();
                for (const { path } of found) {
                    const hit = resolveImport(file, path, fileSet);
                    if (hit && hit !== file) deps.add(hit);
                }
                graph[file] = [...deps].sort();
            }),
    );
    return graph;
}

async function runChecks(checks: Check[]): Promise<boolean> {
    const results: { check: Check; ok: boolean; seconds: number }[] = [];
    for (const check of checks) {
        console.log(`\n▶ ${check.label}\n  $ ${shortCmd(check.cmd)}`);
        const started = performance.now();
        let code: number;
        try {
            const proc = Bun.spawn(check.cmd, {
                stdout: "inherit",
                stderr: "inherit",
                stdin: "inherit",
            });
            code = await proc.exited;
        } catch (err) {
            // A missing binary must not skip the summary of the other checks.
            console.error(
                `could not run ${check.cmd[0]}: ${err instanceof Error ? err.message : String(err)}`,
            );
            code = 127;
        }
        results.push({
            check,
            ok: code === 0,
            seconds: (performance.now() - started) / 1000,
        });
    }
    console.log("\nSummary");
    for (const { check, ok, seconds } of results) {
        console.log(
            `  ${ok ? "PASS" : "FAIL"}  ${check.label}  (${seconds.toFixed(1)}s)`,
        );
    }
    return results.every((r) => r.ok);
}

/** argv for display; long file lists are elided. */
function shortCmd(cmd: string[]): string {
    return cmd.length > 12
        ? `${cmd.slice(0, 8).join(" ")} … (+${cmd.length - 8} more)`
        : cmd.join(" ");
}

async function main() {
    const cli = parseArgs(process.argv.slice(2));
    const paths = cli.all ? [] : (cli.paths ?? gatherChangedPaths(cli.base));
    const files = cli.all ? [] : await existingFiles();
    const checks = changedChecks(paths, {
        base: cli.base,
        all: cli.all,
        files,
        imports:
            cli.all || paths.length === 0 ? {} : await buildImportGraph(files),
    });

    if (cli.json) {
        console.log(JSON.stringify(checks, null, 2));
        return;
    }

    if (!cli.all) {
        console.log(
            `${paths.length} changed path${paths.length === 1 ? "" : "s"} vs ${cli.base} (committed, uncommitted, untracked)`,
        );
    }
    if (checks.length === 0) {
        console.log("No checks needed.");
        return;
    }
    console.log("Checks:");
    for (const check of checks) console.log(`  - ${check.label}`);
    if (cli.list) return;

    const ok = await runChecks(checks);
    process.exit(ok ? 0 : 1);
}

if (import.meta.main) {
    try {
        await main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
