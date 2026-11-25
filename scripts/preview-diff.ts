/**
 * Proves a change left the household app looking the same: renders every
 * `bun run preview:app --shots` PNG for a base ref and for this checkout, then
 * compares them pixel by pixel.
 *
 *   bun scripts/preview-diff.ts [--base <ref>] [--work <dir>]
 *                               [--reuse-base] [--reuse-head] [--keep]
 *                               [--no-cache]
 *
 *   --base <ref>    the ref to compare against (default origin/main)
 *   --work <dir>    where the renders live (default tmp/preview-diff, which
 *                   git ignores): wt/ (the base worktree), base-1/, base-2/
 *                   and head/
 *   --reuse-base    skip rendering the base: use the base-1/ and base-2/ a
 *                   previous run left in --work
 *   --reuse-head    skip rendering this checkout: use the head/ a previous
 *                   run left in --work (after a change that does not move
 *                   pixels, or to re-run the comparison)
 *   --keep          leave the base worktree in place
 *   --no-cache      always render, and store nothing in the render cache
 *   -h, --help      print this usage and exit 0
 *
 * Rendered shot sets are kept in ~/.cache/foodable/preview-diff/<key>/
 * (base-1/, base-2/, head/), where <key> is the full commit SHA, the Chromium
 * version and, when any is set, a fingerprint of the environment variables that
 * move pixels (FOODABLE_FLAGS, NODE_ENV, RAILWAY_*, PUBLIC_ORIGIN: see
 * RENDER_ENV_VARS), so a flags-on run never reads a flags-off set.
 * FOODABLE_PREVIEW_CACHE moves the folder. CACHE_FORMAT is part of the key too:
 * bump it whenever the render invocation changes (the --shots flags, the page
 * clock, anything that moves pixels without moving a commit). The key cannot
 * see fonts or installed dependencies, so after changing either, run once with
 * --no-cache. A run with RAILWAY_TOKEN or RAILWAY_API_TOKEN set (the render then
 * reads flag values from Railway, which no key can hash) neither reads nor
 * writes the cache. The base is always cacheable, since
 * it is a commit; this checkout only when `git status --porcelain` is empty,
 * keyed by HEAD. A hit prints `cached` and renders nothing; a miss renders, then
 * stores the set whole (a temp folder renamed into place once the render
 * succeeded; the first writer wins and a stored set is never replaced).
 * base-1 and base-2 are stored independently, so a half-stored base renders
 * only the missing side.
 *
 * Whatever its source, every run leaves the sets it compared in --work
 * (base-1/, base-2/, head/), as copies when they came from the cache. So
 * --reuse-base and --reuse-head read exactly what the last run compared and
 * never touch the cache. A run first removes every side it is not reusing, so a
 * run that fails half way never leaves a mix of commits behind, and each side
 * carries a .stamp file naming its commit: --reuse-* prints it, and refuses
 * when base-1 and base-2 name different commits.
 *
 * Any other argument prints the usage on stderr and exits 2, before any git,
 * worktree or render.
 *
 * The base is rendered in a temporary `git worktree` (it needs `bun install`
 * there) and then rendered a second time: a shot that differs between those two
 * renders is unstable on the base itself, so it is listed and left out of the
 * comparison rather than failing it. Gallery shots (dev-gallery*) are listed
 * but never fail the run. A shot whose size differs counts as changed. The exit
 * code is 1 when any other shot changed or exists on one side only, and also
 * when base-1, base-2 and head are not all non-empty or base-1 and base-2 do
 * not hold the same shots (an interrupted render); 0 otherwise.
 *
 * Needs Chromium (see scripts/app-preview.ts) and ImageMagick's `magick`
 * (`magick a b -compose difference -composite`, not `compare`).
 * Rendering is slow, so use a long timeout.
 */
import { createHash } from "node:crypto";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { findChromium } from "./app-preview-shots.js";

const ROOT = resolve(import.meta.dir, "..");
// Each compare decodes two shots into ImageMagick's float pixel cache (about
// 800 MB for the 1440x23248 gallery shot uncapped). Four at once, each capped
// (MAGICK_LIMITS) and spilling to disk, kept a full compare under 0.8 GB.
const COMPARE_CONCURRENCY = 4;

/** One thread and a small pixel cache per compare; past it, the disk. */
const MAGICK_LIMITS = [
    "-limit",
    "thread",
    "1",
    "-limit",
    "memory",
    "128MiB",
    "-limit",
    "map",
    "256MiB",
];

/**
 * Where a capped compare spills. ImageMagick's default is /tmp, which is RAM
 * on a tmpfs host, so the cap would save nothing there. MAGICK_TEMPORARY_PATH,
 * when set, wins.
 */
function magickTempDir(): string {
    const dir =
        process.env.MAGICK_TEMPORARY_PATH ??
        join(homedir(), ".cache/foodable/magick-tmp");
    mkdirSync(dir, { recursive: true });
    return dir;
}

/** The usage text: printed by --help and after a refused argument. */
export const USAGE = `usage: bun scripts/preview-diff.ts [--base <ref>] [--work <dir>]
                                  [--reuse-base] [--reuse-head] [--keep]
                                  [--no-cache]

  --base <ref>    the ref to compare against (default origin/main)
  --work <dir>    where the renders live (default tmp/preview-diff)
  --reuse-base    skip rendering the base: use the base-1/ and base-2/ the
                  last run left in --work (a cached run leaves copies there)
  --reuse-head    skip rendering this checkout: use the head/ the last run
                  left in --work
  --keep          leave the base worktree in place
  --no-cache      always render, and neither read nor store the render cache
                  (~/.cache/foodable/preview-diff/<commit>-<chromium>[-<env>]/)
  -h, --help      print this usage and exit 0
`;

export type Options = {
    base: string;
    work: string;
    reuseBase: boolean;
    reuseHead: boolean;
    keep: boolean;
    noCache: boolean;
};

export type ParsedArgs =
    | { kind: "run"; options: Options }
    | { kind: "help" }
    | { kind: "error"; message: string };

/** Reads the command line without touching git, the disk or a render. */
export function parseArgs(argv: string[]): ParsedArgs {
    const options: Options = {
        base: "origin/main",
        work: "tmp/preview-diff",
        reuseBase: false,
        reuseHead: false,
        keep: false,
        noCache: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        switch (a) {
            case "-h":
            case "--help":
                return { kind: "help" };
            case "--reuse-base":
                options.reuseBase = true;
                break;
            case "--reuse-head":
                options.reuseHead = true;
                break;
            case "--keep":
                options.keep = true;
                break;
            case "--no-cache":
                options.noCache = true;
                break;
            case "--base":
            case "--work": {
                const value = argv[i + 1];
                if (value === undefined || value.startsWith("-")) {
                    return { kind: "error", message: `${a} needs a value` };
                }
                if (a === "--base") options.base = value;
                else options.work = value;
                i++;
                break;
            }
            default:
                return {
                    kind: "error",
                    message: a.startsWith("-")
                        ? `unknown flag ${a}`
                        : `unexpected argument ${a}`,
                };
        }
    }
    return { kind: "run", options };
}

/** Where cached shot sets live: FOODABLE_PREVIEW_CACHE, else ~/.cache/foodable/preview-diff. */
export function cacheRoot(
    env: Record<string, string | undefined>,
    home: string,
): string {
    const override = env.FOODABLE_PREVIEW_CACHE;
    return override ? override : join(home, ".cache/foodable/preview-diff");
}

/**
 * The environment variables the render (app-preview, and the src/ code it
 * imports) reads and that can change pixels: the feature flags (FOODABLE_FLAGS,
 * or Railway's when a token is set), the dev-only routes (NODE_ENV,
 * RAILWAY_ENVIRONMENT_NAME) and the public origin. The render child inherits
 * them, so they belong in the cache key.
 */
export const RENDER_ENV_VARS = [
    "FOODABLE_FLAGS",
    "NODE_ENV",
    "PUBLIC_ORIGIN",
    "RAILWAY_API_TOKEN",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_ENVIRONMENT_NAME",
    "RAILWAY_TOKEN",
] as const;

/**
 * A short hash of the render-relevant variables that are set: "" when none is,
 * so the common key stays plain. Hashed, so a token never lands in a folder name.
 */
export function renderEnvFingerprint(
    env: Record<string, string | undefined>,
): string {
    const parts = [...RENDER_ENV_VARS]
        .sort()
        .filter((name) => (env[name] ?? "") !== "")
        .map((name) => `${name}=${env[name]}`);
    if (parts.length === 0) return "";
    return createHash("sha256")
        .update(parts.join("\n"))
        .digest("hex")
        .slice(0, 12);
}

/**
 * Part of every cache key. Bump it when the render invocation changes (the
 * shot flags, the pinned clock, the window sizes): the commit and the browser
 * version cannot see that, and a stored set would pass for a current one.
 */
export const CACHE_FORMAT = "v2";

/**
 * The folder name of a cached shot set: the full commit SHA, CACHE_FORMAT, the
 * Chromium version and the render environment fingerprint, since each one
 * moves the pixels. A ref that is not a full SHA is refused: `origin/main` names a
 * different commit tomorrow.
 */
export function cacheKey(
    sha: string,
    chromiumVersion: string,
    envFingerprint = "",
): string {
    if (!/^[0-9a-f]{40}$/.test(sha)) {
        throw new Error(
            `cache key: ${JSON.stringify(sha)} is not a full commit sha`,
        );
    }
    const version = chromiumVersion
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/\.{2,}/g, ".");
    if (version === "") throw new Error("cache key: no chromium version");
    const env = envFingerprint.replace(/[^0-9a-f]/g, "");
    const head = `${sha}-${CACHE_FORMAT}-${version}`;
    return env === "" ? head : `${head}-env${env}`;
}

/**
 * The full SHA of the commit `ref` names, peeling a tag to its commit.
 * Built as one string so Bun's shell does not brace-expand `^{commit}`.
 */
export async function resolveCommit(cwd: string, ref: string): Promise<string> {
    const spec = `${ref}^{commit}`;
    return (await Bun.$`git rev-parse --verify ${spec}`.cwd(cwd).text()).trim();
}

/**
 * `git status --porcelain` with untracked files listed, whatever the user's
 * status.showUntrackedFiles says: a new file changes the render too.
 */
export async function workingTreePorcelain(cwd: string): Promise<string> {
    return await Bun.$`git status --porcelain --untracked-files=normal`
        .cwd(cwd)
        .text();
}

/**
 * Why the cache must not be used at all, or null. With a Railway token the
 * render reads its flag values from Railway: they can change with no change to
 * the commit or to the environment, so no key could tell a stale set.
 */
export function cacheDisabledReason(
    env: Record<string, string | undefined>,
): string | null {
    for (const name of ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"]) {
        if ((env[name] ?? "") !== "") {
            return `${name} is set, so the render reads live flag values from Railway`;
        }
    }
    return null;
}

/**
 * Whether this checkout can still be stored under the key chosen when the run
 * started: the same HEAD, and still nothing changed. The render takes minutes;
 * an edit, a commit or a branch switch in that time would otherwise be stored
 * as the earlier commit.
 */
export async function headStillCacheable(
    cwd: string,
    sha: string,
    work?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const now = (await Bun.$`git rev-parse HEAD`.cwd(cwd).text()).trim();
    if (now !== sha) {
        return {
            ok: false,
            reason: `HEAD moved from ${sha.slice(0, 9)} to ${now.slice(0, 9)} during the render`,
        };
    }
    const porcelain = await workingTreePorcelain(cwd);
    if (!headCacheable(porcelain)) {
        return {
            ok: false,
            reason: onlyUnderWork(porcelain, cwd, work)
                ? workInsideRepoReason(work!)
                : "the working tree changed during the render",
        };
    }
    return { ok: true };
}

/** Said when the only changes git sees are the copied shots in --work. */
export function workInsideRepoReason(work: string): string {
    return `--work ${work} is inside the repo and not ignored, so the tree reads as changed; use a --work outside the repo or a git-ignored one`;
}

/**
 * Whether every change in `porcelain` is a path under the `work` folder (an
 * absolute path inside `cwd`): the shots this run copied there, not an edit.
 */
export function onlyUnderWork(
    porcelain: string,
    cwd: string,
    work: string | undefined,
): boolean {
    if (!work) return false;
    const rel = relative(cwd, work).split(sep).join("/");
    if (rel === "" || rel === ".." || rel.startsWith("../")) return false;
    const lines = porcelain.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return false;
    return lines.every((line) => {
        const path = line.slice(3).replace(/^"|"$/g, "");
        return path === rel || path.startsWith(`${rel}/`);
    });
}

/** This checkout can be cached by its HEAD only when nothing differs from it. */
export function headCacheable(porcelain: string): boolean {
    return porcelain.trim() === "";
}

const isGallery = (file: string) => file.startsWith("dev-gallery");

async function freePort(): Promise<number> {
    const s = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { open() {}, data() {} },
    });
    const port = s.port;
    s.stop(true);
    return port;
}

/** Runs preview:app --shots in `cwd` and moves the PNGs into `dest`. */
async function render(cwd: string, dest: string, label: string) {
    const shots = join(cwd, "tmp/app-preview");
    rmSync(shots, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const port = await freePort();
    console.log(`rendering ${label} on :${port} ...`);
    const started = Date.now();
    const proc = Bun.spawn(
        ["bun", "--no-env-file", "scripts/app-preview.ts", "--shots"],
        {
            cwd,
            env: { ...process.env, PREVIEW_PORT: String(port) },
            stdout: "ignore",
            stderr: "inherit",
        },
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`${label}: preview:app exited ${code}`);
    const pngs = readdirSync(shots).filter((f) => f.endsWith(".png"));
    for (const f of pngs) cpSync(join(shots, f), join(dest, f));
    rmSync(shots, { recursive: true, force: true });
    console.log(
        `  ${pngs.length} shots in ${Math.round((Date.now() - started) / 1000)}s`,
    );
}

function listPngs(dir: string): string[] {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        throw new Error(`${dir}: no shots; run without the --reuse flag first`);
    }
    return readdirSync(dir)
        .filter((f) => f.endsWith(".png"))
        .sort();
}

/** Width and height from a PNG's IHDR chunk, or null when it is not a PNG. */
export function pngSize(
    bytes: Uint8Array,
): { width: number; height: number } | null {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
}

async function sizeOf(path: string) {
    const head = await Bun.file(path).slice(0, 24).bytes();
    return pngSize(head);
}

/** True when the two PNGs differ in any pixel or in size. */
export async function differs(a: string, b: string): Promise<boolean> {
    // A composite of two sizes blends only the overlap, so a taller page whose
    // extra strip is background-coloured would read as equal: check the size first.
    const [sa, sb] = await Promise.all([sizeOf(a), sizeOf(b)]);
    if (!sa || !sb) return true;
    if (sa.width !== sb.width || sa.height !== sb.height) return true;
    // Identical bytes are identical pixels. One Chromium renders a page to
    // the same bytes every time, so most pairs stop here, undecoded.
    const [ba, bb] = await Promise.all([
        Bun.file(a).bytes(),
        Bun.file(b).bytes(),
    ]);
    if (Buffer.from(ba).equals(Buffer.from(bb))) return false;
    // The largest per-channel difference over every pixel, alpha included. It
    // is 0 only for identical pixels: `compare -metric AE` prints a summed
    // figure that stays below 1 (and exits 0) for a handful of near-equal
    // pixels, so it cannot be the test.
    const proc = Bun.spawn(
        [
            "magick",
            ...MAGICK_LIMITS,
            a,
            b,
            "-compose",
            "difference",
            "-composite",
            "-format",
            "%[fx:maxima]",
            "info:",
        ],
        {
            stdout: "pipe",
            stderr: "ignore",
            env: { ...process.env, MAGICK_TEMPORARY_PATH: magickTempDir() },
        },
    );
    const [out, code] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
    ]);
    const maxima = Number(out.trim());
    if (code !== 0 || out.trim() === "" || !Number.isFinite(maxima)) {
        return true;
    }
    return maxima > 0;
}

async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++;
                out[i] = await fn(items[i]!);
            }
        }),
    );
    return out;
}

/** The files both dirs hold whose pixels (or size) differ. */
async function changedBetween(a: string, b: string, files: string[]) {
    const both = files.filter(
        (f) => existsSync(join(a, f)) && existsSync(join(b, f)),
    );
    const flags = await mapLimit(both, COMPARE_CONCURRENCY, (f) =>
        differs(join(a, f), join(b, f)),
    );
    return both.filter((_, i) => flags[i]);
}

export type ShotComparison = {
    /** PNG names in base-1, base-2 and head. */
    base1: string[];
    base2: string[];
    head: string[];
    /** Names in both base-1 and base-2 whose pixels differ. */
    baseNoise: string[];
    /** Names in both base-1 and head whose pixels (or size) differ. */
    headDiff: string[];
};

export function classifyShots(c: ShotComparison) {
    const problems: string[] = [];
    for (const [name, list] of [
        ["base-1", c.base1],
        ["base-2", c.base2],
        ["head", c.head],
    ] as const) {
        if (list.length === 0) {
            problems.push(`${name} holds no shots, so nothing was compared`);
        }
    }
    const in1 = new Set(c.base1);
    const in2 = new Set(c.base2);
    const onlyIn1 = c.base1.filter((f) => !in2.has(f));
    const onlyIn2 = c.base2.filter((f) => !in1.has(f));
    if (c.base1.length > 0 && c.base2.length > 0) {
        if (onlyIn1.length > 0) {
            problems.push(
                `base-2 lacks ${onlyIn1.length} shot(s) base-1 has: ${onlyIn1.join(", ")}`,
            );
        }
        if (onlyIn2.length > 0) {
            problems.push(
                `base-1 lacks ${onlyIn2.length} shot(s) base-2 has: ${onlyIn2.join(", ")}`,
            );
        }
        if (onlyIn1.length > 0 || onlyIn2.length > 0) {
            problems.push(
                "base-1 and base-2 must hold the same shots; render the base again",
            );
        }
    }

    // What the base itself cannot reproduce is no evidence either way.
    const unstable = [...new Set(c.baseNoise)].sort();
    const skip = new Set(unstable);
    const inHead = new Set(c.head);
    const inBase = in1;
    const changed = c.headDiff.filter((f) => !skip.has(f));
    // Base noise explains differing pixels, not a page shot that is gone.
    const missingInHead = c.base1.filter((f) => !inHead.has(f));
    const missingInBase = c.head.filter((f) => !inBase.has(f));

    const gallery = (list: string[]) => list.filter(isGallery);
    const real = (list: string[]) => list.filter((f) => !isGallery(f));
    const failing = [
        ...real(changed),
        ...real(missingInHead),
        ...real(missingInBase),
    ];
    const compared = c.base1.filter(
        (f) => inHead.has(f) && !skip.has(f) && !isGallery(f),
    ).length;
    if (compared === 0) {
        problems.push(
            "no shot was compared: every non-gallery shot is unstable, missing or absent",
        );
    }

    return {
        ok: problems.length === 0 && failing.length === 0,
        problems,
        changed: real(changed),
        missingInHead: real(missingInHead),
        missingInBase: real(missingInBase),
        galleryChanged: gallery(changed),
        galleryMissing: gallery([...missingInHead, ...missingInBase]),
        unstable,
        failing,
        compared,
    };
}

/** True when `dir` is a stored shot set: a folder holding at least one PNG. */
function hasShots(dir: string): boolean {
    try {
        return (
            statSync(dir).isDirectory() &&
            readdirSync(dir).some((f) => f.endsWith(".png"))
        );
    } catch {
        return false;
    }
}

/** `chromium --version`, which keys the cache: another browser, other pixels. */
async function chromiumVersion(): Promise<string> {
    const chromium = findChromium();
    if (!chromium) throw new Error("no chromium on PATH");
    const out = await Bun.$`${chromium} --version`.text();
    return out.trim();
}

export type SideMode =
    /** use what the last run left in --work; never touch the cache */
    | "reuse"
    /** copy the stored set into --work; render nothing */
    | "cached"
    /** render into --work, then store a copy in the cache */
    | "renderStored"
    /** render into --work only */
    | "render";

export type SideSource = {
    mode: SideMode;
    /** The set this run compares: always inside --work. */
    dir: string;
    /** The stored set to read or write; null when the cache is not used. */
    cacheDir: string | null;
};

export type Sources = { base1: string; base2: string; head: string };
/** The stored folder of each side; null when that side has none. */
export type CacheDirs = {
    base1: string | null;
    base2: string | null;
    head: string | null;
};

/**
 * Where each side's shots come from. Pure: the caller supplies which stored
 * sets exist (`hit`) and whether this checkout has no changes (`headClean`).
 * A dirty head and --no-cache never read or write the cache, --reuse-* never
 * does either, and base-1 and base-2 are decided independently.
 */
export function resolveSources(a: {
    options: Pick<Options, "reuseBase" | "reuseHead" | "noCache">;
    headClean: boolean;
    work: Sources;
    /** The stored folder of each side; null when there is no cache to use. */
    cache: CacheDirs | null;
    hit: { base1: boolean; base2: boolean; head: boolean };
}): { base1: SideSource; base2: SideSource; head: SideSource } {
    const side = (
        key: keyof Sources,
        reuse: boolean,
        cacheable: boolean,
    ): SideSource => {
        const dir = a.work[key];
        if (reuse) return { mode: "reuse", dir, cacheDir: null };
        const cacheDir = a.cache?.[key] ?? null;
        if (a.options.noCache || !cacheDir || !cacheable) {
            return { mode: "render", dir, cacheDir: null };
        }
        return { mode: a.hit[key] ? "cached" : "renderStored", dir, cacheDir };
    };
    return {
        base1: side("base1", a.options.reuseBase, true),
        base2: side("base2", a.options.reuseBase, true),
        head: side("head", a.options.reuseHead, a.headClean),
    };
}

export const STAMP_FILE = ".stamp";

/** What a side of --work was made from: the commit, and a mark for a dirty tree. */
export function formatStamp(a: { sha: string; dirty?: boolean }): string {
    return a.dirty ? `${a.sha} (working tree had changes)` : a.sha;
}

/** The stamp a side of --work carries, or null when it has none. */
export function readStamp(dir: string): string | null {
    try {
        return readFileSync(join(dir, STAMP_FILE), "utf8").trim() || null;
    } catch {
        return null;
    }
}

/** Writes the stamp into `dir`, beside its shots. */
export function writeStamp(dir: string, stamp: string): void {
    writeFileSync(join(dir, STAMP_FILE), `${stamp}\n`);
}

/**
 * The problem with reusing these two base sides, or null. Two different
 * stamps, or one stamp and one side with none, mean the sides come from
 * different runs; a missing stamp on both is an older run and is allowed.
 */
export function baseStampProblem(
    base1: string | null,
    base2: string | null,
): string | null {
    if (base1 === base2) return null;
    return `base-1 (${base1 ?? "no stamp"}) and base-2 (${base2 ?? "no stamp"}) were not rendered from the same commit; render the base again`;
}

/** Removes the sides of --work this run will not reuse, before anything else. */
export function clearWorkSides(
    work: Sources,
    o: { reuseBase: boolean; reuseHead: boolean },
): void {
    if (!o.reuseBase) {
        rmSync(work.base1, { recursive: true, force: true });
        rmSync(work.base2, { recursive: true, force: true });
    }
    if (!o.reuseHead) rmSync(work.head, { recursive: true, force: true });
}

/** Replaces `workDir` with a copy of the stored set. */
export function placeCached(cachedDir: string, workDir: string): void {
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(join(workDir, ".."), { recursive: true });
    cpSync(cachedDir, workDir, { recursive: true });
}

/**
 * Stores a copy of the rendered `workDir` as `final`, whole: copied to a temp
 * folder and renamed into place. First writer wins: a set already stored is
 * never replaced or removed, and a run that loses the rename race keeps the
 * winner's set. `beforeRename` is a test seam for that race.
 */
export function storeSet(
    workDir: string,
    final: string,
    beforeRename?: () => void,
): "stored" | "kept" {
    if (hasShots(final)) return "kept";
    mkdirSync(join(final, ".."), { recursive: true });
    const tmp = `${final}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    try {
        cpSync(workDir, tmp, { recursive: true });
        beforeRename?.();
        renameSync(tmp, final);
        return "stored";
    } catch (error) {
        if (hasShots(final)) return "kept";
        throw error;
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

async function main(options: Options) {
    const baseRef = options.base;
    const work = resolve(ROOT, options.work);
    const { reuseBase, reuseHead, keep } = options;
    const wt = join(work, "wt");
    const workDirs: Sources = {
        base1: join(work, "base-1"),
        base2: join(work, "base-2"),
        head: join(work, "head"),
    };
    mkdirSync(work, { recursive: true });
    // Before anything can fail: a run that dies half way must not leave one
    // side from this commit beside one from an older run for --reuse-* to read.
    clearWorkSides(workDirs, { reuseBase, reuseHead });

    const disabled = cacheDisabledReason(process.env);
    if (disabled && !options.noCache) {
        console.log(`render cache: not used (${disabled})`);
    }
    const noCache = options.noCache || disabled !== null;

    let baseSha = baseRef;
    let headSha = "";
    let headClean = false;
    let headDirtyReason = "the working tree has changes";
    if (!reuseBase) {
        baseSha = await resolveCommit(ROOT, baseRef);
    }
    if (!reuseHead) {
        headSha = (await Bun.$`git rev-parse HEAD`.cwd(ROOT).text()).trim();
        const porcelain = await workingTreePorcelain(ROOT);
        headClean = headCacheable(porcelain);
        if (!headClean && onlyUnderWork(porcelain, ROOT, work)) {
            headDirtyReason = workInsideRepoReason(options.work);
        }
    }
    let cache: CacheDirs | null = null;
    if (!noCache && (!reuseBase || !reuseHead)) {
        const root = cacheRoot(process.env, homedir());
        const version = await chromiumVersion();
        const fingerprint = renderEnvFingerprint(process.env);
        const baseKey = reuseBase
            ? null
            : join(root, cacheKey(baseSha, version, fingerprint));
        const headKey =
            !reuseHead && headClean
                ? join(root, cacheKey(headSha, version, fingerprint))
                : null;
        cache = {
            base1: baseKey && join(baseKey, "base-1"),
            base2: baseKey && join(baseKey, "base-2"),
            head: headKey && join(headKey, "head"),
        };
    }
    if (!reuseHead && !headClean && !noCache) {
        console.log(`this checkout: not cached (${headDirtyReason})`);
    }
    const exists = (dir: string | null | undefined) => !!dir && hasShots(dir);
    const src = resolveSources({
        options: { reuseBase, reuseHead, noCache },
        headClean,
        work: workDirs,
        cache,
        hit: {
            base1: exists(cache?.base1),
            base2: exists(cache?.base2),
            head: exists(cache?.head),
        },
    });

    const baseLabel = `base ${baseSha.slice(0, 9)}`;
    const baseStamp = formatStamp({ sha: baseSha });
    const headStamp = formatStamp({ sha: headSha, dirty: !headClean });
    const place = (name: string, s: SideSource, stamp: string) => {
        if (s.mode === "reuse") {
            console.log(
                `${name}: reusing ${s.dir} (${readStamp(s.dir) ?? "no stamp"})`,
            );
        } else if (s.mode === "cached") {
            console.log(`${name}: cached`);
            placeCached(s.cacheDir!, s.dir);
            writeStamp(s.dir, stamp);
        }
    };
    if (reuseBase) {
        const problem = baseStampProblem(
            readStamp(workDirs.base1),
            readStamp(workDirs.base2),
        );
        if (problem) throw new Error(problem);
    }
    place(`${baseLabel} (1 of 2)`, src.base1, baseStamp);
    place(`${baseLabel} (2 of 2)`, src.base2, baseStamp);
    const store = (s: SideSource) => {
        if (s.mode === "renderStored") storeSet(s.dir, s.cacheDir!);
    };
    const isRender = (s: SideSource) =>
        s.mode === "render" || s.mode === "renderStored";

    if (isRender(src.base1) || isRender(src.base2)) {
        rmSync(wt, { recursive: true, force: true });
        await Bun.$`git worktree prune`.cwd(ROOT).quiet();
        await Bun.$`git worktree add --detach ${wt} ${baseSha}`
            .cwd(ROOT)
            .quiet();
        try {
            console.log(`installing in ${wt} ...`);
            await Bun.$`bun install --frozen-lockfile`.cwd(wt).quiet();
            for (const [n, s] of [
                ["1 of 2", src.base1],
                ["2 of 2", src.base2],
            ] as const) {
                if (!isRender(s)) continue;
                await render(wt, s.dir, `${baseLabel} (${n})`);
                store(s);
                writeStamp(s.dir, baseStamp);
            }
        } finally {
            if (!keep) {
                await Bun.$`git worktree remove --force ${wt}`
                    .cwd(ROOT)
                    .quiet()
                    .nothrow();
                rmSync(wt, { recursive: true, force: true });
                await Bun.$`git worktree prune`.cwd(ROOT).quiet().nothrow();
            }
        }
    }
    place("this checkout", src.head, headStamp);
    if (isRender(src.head)) {
        await render(ROOT, src.head.dir, "this checkout");
        if (src.head.mode === "renderStored") {
            // The render took minutes: store only what is still the commit
            // the key names, with nothing changed since.
            const still = await headStillCacheable(ROOT, headSha, work);
            if (still.ok) store(src.head);
            else console.log(`this checkout: not stored (${still.reason})`);
        }
        writeStamp(src.head.dir, headStamp);
    }
    const dirs = workDirs;

    const base1 = listPngs(dirs.base1);
    const base2 = listPngs(dirs.base2);
    const head = listPngs(dirs.head);

    const baseNoise = await changedBetween(dirs.base1, dirs.base2, base1);
    const headDiff = await changedBetween(dirs.base1, dirs.head, base1);
    const r = classifyShots({ base1, base2, head, baseNoise, headDiff });

    const section = (title: string, list: string[]) => {
        if (list.length === 0) return;
        console.log(`\n${title} (${list.length}):`);
        for (const f of list) console.log(`  ${f}`);
    };

    console.log(`\npreview-diff: base ${baseSha} vs this checkout`);
    section("PROBLEMS", r.problems);
    section("CHANGED", r.changed);
    section("MISSING in this checkout", r.missingInHead);
    section("MISSING in base", r.missingInBase);
    section("gallery shots that changed (not counted)", r.galleryChanged);
    section("gallery shots on one side only (not counted)", r.galleryMissing);
    section("unstable on the base (left out)", r.unstable);
    console.log(
        `\n${r.compared} non-gallery shots compared: ${r.changed.length} changed, ` +
            `${r.missingInHead.length + r.missingInBase.length} missing, ` +
            `${r.unstable.length} unstable (skipped), ${r.galleryChanged.length} gallery changed (not counted).`,
    );
    if (r.problems.length > 0) {
        console.log(
            "FAIL: the renders are incomplete, so no comparison was made.",
        );
    } else {
        console.log(r.ok ? "OK: no visual change." : "FAIL.");
    }
    process.exit(r.ok ? 0 : 1);
}

if (import.meta.main) {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.kind === "help") {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    if (parsed.kind === "error") {
        process.stderr.write(`preview-diff: ${parsed.message}\n${USAGE}`);
        process.exit(2);
    }
    await main(parsed.options);
}
