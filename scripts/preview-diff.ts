/**
 * Proves a change left the household app looking the same: renders every
 * `bun run preview:app --shots` PNG for a base ref and for this checkout, then
 * compares them pixel by pixel.
 *
 *   bun scripts/preview-diff.ts [--base <ref>] [--work <dir>]
 *                               [--reuse-base] [--reuse-head] [--keep]
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
 *   -h, --help      print this usage and exit 0
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
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
    statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const COMPARE_CONCURRENCY = 8;

/** The usage text: printed by --help and after a refused argument. */
export const USAGE = `usage: bun scripts/preview-diff.ts [--base <ref>] [--work <dir>]
                                  [--reuse-base] [--reuse-head] [--keep]

  --base <ref>    the ref to compare against (default origin/main)
  --work <dir>    where the renders live (default tmp/preview-diff)
  --reuse-base    skip rendering the base: use the base-1/ and base-2/ a
                  previous run left in --work
  --reuse-head    skip rendering this checkout: use the head/ a previous run
                  left in --work
  --keep          leave the base worktree in place
  -h, --help      print this usage and exit 0
`;

export type Options = {
    base: string;
    work: string;
    reuseBase: boolean;
    reuseHead: boolean;
    keep: boolean;
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
            case "--base":
            case "--work": {
                const value = argv[i + 1];
                if (value === undefined || value.startsWith("--")) {
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
    // The largest per-channel difference over every pixel, alpha included. It
    // is 0 only for identical pixels: `compare -metric AE` prints a summed
    // figure that stays below 1 (and exits 0) for a handful of near-equal
    // pixels, so it cannot be the test.
    const proc = Bun.spawn(
        [
            "magick",
            a,
            b,
            "-compose",
            "difference",
            "-composite",
            "-format",
            "%[fx:maxima]",
            "info:",
        ],
        { stdout: "pipe", stderr: "ignore" },
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

async function main(options: Options) {
    const baseRef = options.base;
    const work = resolve(ROOT, options.work);
    const { reuseBase, reuseHead, keep } = options;
    const wt = join(work, "wt");
    const dirs = {
        base1: join(work, "base-1"),
        base2: join(work, "base-2"),
        head: join(work, "head"),
    };
    mkdirSync(work, { recursive: true });

    let baseSha = baseRef;
    if (!reuseBase) {
        baseSha = (
            await Bun.$`git rev-parse ${baseRef}`.cwd(ROOT).text()
        ).trim();
        rmSync(wt, { recursive: true, force: true });
        await Bun.$`git worktree prune`.cwd(ROOT).quiet();
        await Bun.$`git worktree add --detach ${wt} ${baseSha}`
            .cwd(ROOT)
            .quiet();
        try {
            console.log(`installing in ${wt} ...`);
            await Bun.$`bun install --frozen-lockfile`.cwd(wt).quiet();
            await render(
                wt,
                dirs.base1,
                `base ${baseSha.slice(0, 9)} (1 of 2)`,
            );
            await render(
                wt,
                dirs.base2,
                `base ${baseSha.slice(0, 9)} (2 of 2)`,
            );
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
    if (!reuseHead) await render(ROOT, dirs.head, "this checkout");

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
