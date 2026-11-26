import { afterAll, describe, expect, test } from "bun:test";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    baseStampProblem,
    CACHE_FORMAT,
    cacheDisabledReason,
    cacheKey,
    cacheRoot,
    classifyShots,
    clearWorkSides,
    differs,
    formatStamp,
    headCacheable,
    headStillCacheable,
    parseArgs,
    placeCached,
    pngSize,
    readStamp,
    renderEnvFingerprint,
    resolveCommit,
    resolveSources,
    STAMP_FILE,
    storeSet,
    USAGE,
    workingTreePorcelain,
    writeStamp,
} from "./preview-diff";

const SHOTS = ["today.png", "kitchen.png", "dev-gallery.png"];

const same = {
    base1: SHOTS,
    base2: SHOTS,
    head: SHOTS,
    baseNoise: [],
    headDiff: [],
};

describe("classifyShots", () => {
    test("identical renders are ok", () => {
        const r = classifyShots(same);
        expect(r.ok).toBe(true);
        expect(r.problems).toEqual([]);
        expect(r.changed).toEqual([]);
        expect(r.compared).toBe(2);
    });

    test("a changed shot fails", () => {
        const r = classifyShots({ ...same, headDiff: ["today.png"] });
        expect(r.ok).toBe(false);
        expect(r.changed).toEqual(["today.png"]);
        expect(r.failing).toEqual(["today.png"]);
    });

    test("a gallery-only change is listed but does not fail", () => {
        const r = classifyShots({ ...same, headDiff: ["dev-gallery.png"] });
        expect(r.ok).toBe(true);
        expect(r.galleryChanged).toEqual(["dev-gallery.png"]);
        expect(r.failing).toEqual([]);
    });

    test("a shot that differs between the two base renders is left out", () => {
        const r = classifyShots({
            ...same,
            baseNoise: ["today.png"],
            headDiff: ["today.png"],
        });
        expect(r.ok).toBe(true);
        expect(r.unstable).toEqual(["today.png"]);
        expect(r.changed).toEqual([]);
        expect(r.compared).toBe(1);
    });

    test("a shot missing from head fails", () => {
        const r = classifyShots({
            ...same,
            head: ["today.png", "dev-gallery.png"],
        });
        expect(r.ok).toBe(false);
        expect(r.missingInHead).toEqual(["kitchen.png"]);
    });

    test("a shot missing from base fails", () => {
        const r = classifyShots({
            ...same,
            head: [...SHOTS, "recipes.png"],
        });
        expect(r.ok).toBe(false);
        expect(r.missingInBase).toEqual(["recipes.png"]);
    });

    test("a gallery shot on one side only does not fail", () => {
        const r = classifyShots({
            ...same,
            head: ["today.png", "kitchen.png"],
        });
        expect(r.ok).toBe(true);
        expect(r.galleryMissing).toEqual(["dev-gallery.png"]);
    });

    test("an empty base-2 is a problem, not a pass", () => {
        const r = classifyShots({ ...same, base2: [] });
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("base-2");
    });

    test("a partial base-2 is a problem, not a pass", () => {
        const r = classifyShots({ ...same, base2: ["today.png"] });
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("kitchen.png");
    });

    test("an extra shot in base-2 is a problem", () => {
        const r = classifyShots({ ...same, base2: [...SHOTS, "extra.png"] });
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("extra.png");
    });

    test("an empty base-1 is a problem", () => {
        const r = classifyShots({ ...same, base1: [], base2: [] });
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("base-1");
    });

    test("nothing compared is a problem, not a pass", () => {
        const names = ["a.png", "b.png"];
        const r = classifyShots({
            base1: names,
            base2: names,
            head: names,
            baseNoise: names,
            headDiff: names,
        });
        expect(r.compared).toBe(0);
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("no shot was compared");
    });

    test("only gallery shots compared is a problem", () => {
        const r = classifyShots({
            base1: ["dev-gallery.png"],
            base2: ["dev-gallery.png"],
            head: ["dev-gallery.png"],
            baseNoise: [],
            headDiff: [],
        });
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("no shot was compared");
    });

    test("a base-unstable shot missing from head still fails", () => {
        const r = classifyShots({
            base1: ["x.png", "y.png"],
            base2: ["x.png", "y.png"],
            head: ["y.png"],
            baseNoise: ["x.png"],
            headDiff: [],
        });
        expect(r.ok).toBe(false);
        expect(r.missingInHead).toEqual(["x.png"]);
        expect(r.failing).toContain("x.png");
    });

    test("an empty head is a problem", () => {
        const r = classifyShots({ ...same, head: [] });
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toContain("head");
    });
});

/** The 24 bytes a PNG starts with: signature, IHDR length and type, width, height. */
function pngHeader(width: number, height: number): Uint8Array {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    const v = new DataView(b.buffer);
    v.setUint32(16, width);
    v.setUint32(20, height);
    return b;
}

describe("pngSize", () => {
    test("reads width and height", () => {
        expect(pngSize(pngHeader(390, 844))).toEqual({
            width: 390,
            height: 844,
        });
    });

    test("is null for something that is not a PNG", () => {
        expect(pngSize(new Uint8Array(24))).toBeNull();
        expect(pngSize(new Uint8Array(3))).toBeNull();
    });
});

describe("differs", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-diff-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("a file that is not a PNG counts as changed", async () => {
        const a = join(dir, "junk.png");
        const b = join(dir, "other.png");
        writeFileSync(a, "nope");
        writeFileSync(b, pngHeader(390, 844));
        expect(await differs(a, b)).toBe(true);
    });

    test("byte-identical files are the same without decoding them", async () => {
        // A bare header: magick cannot decode it, so only the byte check can
        // call the pair the same.
        const a = join(dir, "bytes-a.png");
        const b = join(dir, "bytes-b.png");
        writeFileSync(a, pngHeader(390, 844));
        writeFileSync(b, pngHeader(390, 844));
        expect(await differs(a, b)).toBe(false);
    });

    const hasMagick = Bun.which("magick") !== null;
    const pixelTest = hasMagick ? test : test.skip;
    if (!hasMagick) {
        console.warn(
            "magick is not installed: pixel-level differs tests skipped",
        );
    }

    /** A grey PNG32, big enough that compare -metric AE rounds a lone pixel to exit 0, with `edit` args applied. */
    function shot(name: string, ...edit: string[]): string {
        const path = join(dir, name);
        const r = spawnSync("magick", [
            "-size",
            "1170x2532",
            "xc:#808080",
            "-alpha",
            "set",
            ...edit,
            `PNG32:${path}`,
        ]);
        if (r.status !== 0) throw new Error(String(r.stderr));
        return path;
    }

    pixelTest("a size mismatch counts as changed", async () => {
        const a = join(dir, "short.png");
        const b = join(dir, "tall.png");
        for (const [path, size] of [
            [a, "390x844"],
            [b, "390x900"],
        ] as const) {
            const r = spawnSync("magick", [
                "-size",
                size,
                "xc:#808080",
                `PNG32:${path}`,
            ]);
            expect(r.status).toBe(0);
        }
        const sizeOf = (path: string) =>
            spawnSync("magick", ["identify", "-format", "%wx%h", path], {
                encoding: "utf8",
            }).stdout;
        expect([sizeOf(a), sizeOf(b)]).toEqual(["390x844", "390x900"]);
        expect(await differs(a, b)).toBe(true);
    });

    pixelTest(
        "one red pixel on a same-size image counts as changed",
        async () => {
            const a = shot("red-a.png");
            const b = shot(
                "red-b.png",
                "-fill",
                "#ff0000",
                "-draw",
                "point 5,7",
            );
            expect(await differs(a, b)).toBe(true);
        },
    );

    pixelTest("a pixel one level apart counts as changed", async () => {
        const a = shot("lvl-a.png");
        const b = shot("lvl-b.png", "-fill", "#818181", "-draw", "point 5,7");
        expect(await differs(a, b)).toBe(true);
    });

    pixelTest("an alpha-only change counts as changed", async () => {
        const a = shot("alpha-a.png");
        const b = shot(
            "alpha-b.png",
            "-channel",
            "A",
            "-fx",
            "i==5&&j==7?0.98:1",
            "+channel",
        );
        expect(await differs(a, b)).toBe(true);
    });

    pixelTest("identical pixels are the same", async () => {
        const a = shot("same-a.png");
        const b = shot("same-b.png");
        expect(await differs(a, b)).toBe(false);
    });

    pixelTest(
        "identical pixels in a different encoding are the same",
        async () => {
            const a = shot("enc-a.png");
            const b = join(dir, "enc-b.png");
            const r = spawnSync("magick", [a, "-alpha", "off", `PNG24:${b}`]);
            expect(r.status).toBe(0);
            expect(await differs(a, b)).toBe(false);
        },
    );
});

describe("parseArgs", () => {
    test("no arguments gives the defaults", () => {
        expect(parseArgs([])).toEqual({
            kind: "run",
            options: {
                base: "origin/main",
                work: "tmp/preview-diff",
                reuseBase: false,
                reuseHead: false,
                keep: false,
                noCache: false,
            },
        });
    });

    test("every flag is read", () => {
        expect(
            parseArgs([
                "--base",
                "v1.2.0",
                "--work",
                "/tmp/w",
                "--reuse-base",
                "--reuse-head",
                "--keep",
                "--no-cache",
            ]),
        ).toEqual({
            kind: "run",
            options: {
                base: "v1.2.0",
                work: "/tmp/w",
                reuseBase: true,
                reuseHead: true,
                keep: true,
                noCache: true,
            },
        });
    });

    test("--help and -h ask for the usage", () => {
        expect(parseArgs(["--help"])).toEqual({ kind: "help" });
        expect(parseArgs(["-h"])).toEqual({ kind: "help" });
        expect(parseArgs(["--keep", "--help"])).toEqual({ kind: "help" });
    });

    test.each([
        [["--bogus"], "--bogus"],
        [["--base"], "--base"],
        [["--work"], "--work"],
        [["--work", "-h"], "--work needs a value"],
        [["--base", "-h"], "--base needs a value"],
        [["--base", "-x"], "--base needs a value"],
        [["--base", "--keep"], "--base"],
        [["stray"], "stray"],
        [["--keep", "--no-caches"], "--no-caches"],
    ])("%p is refused, naming %p", (argv, bad) => {
        const r = parseArgs(argv);
        expect(r.kind).toBe("error");
        if (r.kind === "error") expect(r.message).toContain(bad);
    });
});

describe("the command line", () => {
    const run = (...args: string[]) =>
        spawnSync(
            "bun",
            ["--no-env-file", "scripts/preview-diff.ts", ...args],
            {
                cwd: join(import.meta.dir, ".."),
                encoding: "utf8",
                timeout: 10_000,
            },
        );

    test("--help prints the usage on stdout and exits 0", () => {
        const r = run("--help");
        expect(r.status).toBe(0);
        expect(r.stdout).toBe(USAGE);
    });

    test("an unknown flag prints the usage on stderr and exits 2, before any render", () => {
        const r = run("--bogus");
        expect(r.status).toBe(2);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain("--bogus");
        expect(r.stderr).toContain(USAGE);
    });
});

describe("cacheKey", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";

    test("joins the commit and the browser, safe as a directory name", () => {
        expect(cacheKey(sha, "Chromium 155.0.8059.84 Arch Linux")).toBe(
            `${sha}-${CACHE_FORMAT}-Chromium_155.0.8059.84_Arch_Linux`,
        );
    });

    test("the cache format is part of the key, so bumping it misses every stored set", () => {
        expect(CACHE_FORMAT).toMatch(/^v[0-9]+$/);
        expect(cacheKey(sha, "Chromium 155")).toContain(`-${CACHE_FORMAT}-`);
    });

    test("another browser version is another key", () => {
        expect(cacheKey(sha, "Chromium 155.0.1")).not.toBe(
            cacheKey(sha, "Chromium 156.0.1"),
        );
    });

    test("another commit is another key", () => {
        const other = "f".repeat(40);
        expect(cacheKey(sha, "Chromium 155")).not.toBe(
            cacheKey(other, "Chromium 155"),
        );
    });

    test("never holds a path separator or a dot-dot", () => {
        const key = cacheKey(sha, "../../etc/x y\n");
        expect(key).not.toContain("/");
        expect(key).not.toContain("\\");
        expect(key).not.toContain("..");
    });

    test.each(["origin/main", "abc123", "", `${sha}0`, sha.toUpperCase()])(
        "a ref that is not a full commit sha (%p) is refused",
        (bad) => {
            expect(() => cacheKey(bad, "Chromium 155")).toThrow();
        },
    );

    test("an empty browser version is refused", () => {
        expect(() => cacheKey(sha, "  ")).toThrow();
    });
});

describe("headCacheable", () => {
    test("a clean tree is cacheable", () => {
        expect(headCacheable("")).toBe(true);
        expect(headCacheable("\n")).toBe(true);
    });

    test.each([
        " M scripts/app-preview.ts\n",
        "?? scripts/new.ts\n",
        "A  src/a.ts\n M src/b.ts\n",
    ])("a dirty tree (%p) is not", (porcelain) => {
        expect(headCacheable(porcelain)).toBe(false);
    });
});

describe("cacheDisabledReason", () => {
    test("a plain environment may use the cache", () => {
        expect(cacheDisabledReason({})).toBeNull();
        expect(cacheDisabledReason({ FOODABLE_FLAGS: "a:all" })).toBeNull();
        expect(cacheDisabledReason({ RAILWAY_TOKEN: "" })).toBeNull();
    });

    test.each(["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"])(
        "%s set means the render reads live flags, so no cache",
        (name) => {
            const reason = cacheDisabledReason({ [name]: "s3cret" });
            expect(reason).toContain(name);
            expect(reason).not.toContain("s3cret");
        },
    );
});

describe("cacheRoot", () => {
    test("defaults to the user's cache folder", () => {
        expect(cacheRoot({}, "/home/me")).toBe(
            "/home/me/.cache/foodable/preview-diff",
        );
    });

    test("FOODABLE_PREVIEW_CACHE overrides it", () => {
        expect(
            cacheRoot({ FOODABLE_PREVIEW_CACHE: "/tmp/c" }, "/home/me"),
        ).toBe("/tmp/c");
    });

    test("an empty override is ignored", () => {
        expect(cacheRoot({ FOODABLE_PREVIEW_CACHE: "" }, "/home/me")).toBe(
            "/home/me/.cache/foodable/preview-diff",
        );
    });
});

describe("renderEnvFingerprint", () => {
    test("no render-relevant variable is no fingerprint", () => {
        expect(renderEnvFingerprint({})).toBe("");
        expect(renderEnvFingerprint({ PATH: "/bin", HOME: "/home/me" })).toBe(
            "",
        );
        expect(renderEnvFingerprint({ FOODABLE_FLAGS: "" })).toBe("");
    });

    test.each([
        "FOODABLE_FLAGS",
        "NODE_ENV",
        "RAILWAY_ENVIRONMENT_NAME",
        "RAILWAY_TOKEN",
        "PUBLIC_ORIGIN",
    ])("%s moves the fingerprint", (name) => {
        const plain = renderEnvFingerprint({});
        const set = renderEnvFingerprint({ [name]: "x" });
        expect(set).not.toBe(plain);
        expect(set).toMatch(/^[0-9a-f]{12}$/);
        expect(renderEnvFingerprint({ [name]: "y" })).not.toBe(set);
    });

    test("flags on and flags off do not share a fingerprint", () => {
        expect(
            renderEnvFingerprint({ FOODABLE_FLAGS: "mcp-share-links:all" }),
        ).not.toBe(renderEnvFingerprint({}));
    });

    test("the same values give the same fingerprint, in any order", () => {
        expect(
            renderEnvFingerprint({ NODE_ENV: "production", PATH: "/a" }),
        ).toBe(renderEnvFingerprint({ PATH: "/b", NODE_ENV: "production" }));
    });

    test("a secret never appears in the fingerprint", () => {
        expect(
            renderEnvFingerprint({ RAILWAY_TOKEN: "s3cret-token" }),
        ).not.toContain("s3cret");
    });
});

describe("cacheKey with the render environment", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";

    test("a flags-on render has its own key", () => {
        const on = renderEnvFingerprint({ FOODABLE_FLAGS: "a:all" });
        expect(cacheKey(sha, "Chromium 155", on)).not.toBe(
            cacheKey(sha, "Chromium 155", renderEnvFingerprint({})),
        );
    });

    test("no fingerprint keeps the plain key", () => {
        expect(cacheKey(sha, "Chromium 155", "")).toBe(
            `${sha}-${CACHE_FORMAT}-Chromium_155`,
        );
    });
});

describe("resolveSources", () => {
    const work = { base1: "/w/base-1", base2: "/w/base-2", head: "/w/head" };
    const cache = {
        base1: "/c/k/base-1",
        base2: "/c/k/base-2",
        head: "/c/k/head",
    };
    const none = { base1: false, base2: false, head: false };
    const all = { base1: true, base2: true, head: true };
    const opts = {
        reuseBase: false,
        reuseHead: false,
        noCache: false,
    };

    test("a clean head and a base with nothing stored render and store", () => {
        const r = resolveSources({
            options: opts,
            headClean: true,
            work,
            cache,
            hit: none,
        });
        expect(r.base1).toEqual({
            mode: "renderStored",
            dir: work.base1,
            cacheDir: cache.base1,
        });
        expect(r.base2.mode).toBe("renderStored");
        expect(r.head).toEqual({
            mode: "renderStored",
            dir: work.head,
            cacheDir: cache.head,
        });
    });

    test("every side stored is cached, and renders nothing", () => {
        const r = resolveSources({
            options: opts,
            headClean: true,
            work,
            cache,
            hit: all,
        });
        expect([r.base1.mode, r.base2.mode, r.head.mode]).toEqual([
            "cached",
            "cached",
            "cached",
        ]);
        expect(r.base1.cacheDir).toBe(cache.base1);
        expect(r.base1.dir).toBe(work.base1);
    });

    test("a dirty head never reads or writes the cache", () => {
        const r = resolveSources({
            options: opts,
            headClean: false,
            work,
            cache,
            hit: all,
        });
        expect(r.head).toEqual({
            mode: "render",
            dir: work.head,
            cacheDir: null,
        });
        expect(r.base1.mode).toBe("cached");
    });

    test("--no-cache never reads or writes it, on any side", () => {
        const r = resolveSources({
            options: { ...opts, noCache: true },
            headClean: true,
            work,
            cache,
            hit: all,
        });
        for (const side of [r.base1, r.base2, r.head]) {
            expect(side.mode).toBe("render");
            expect(side.cacheDir).toBeNull();
        }
    });

    test("a partially cached base renders only the missing side", () => {
        const r = resolveSources({
            options: opts,
            headClean: true,
            work,
            cache,
            hit: { base1: true, base2: false, head: true },
        });
        expect(r.base1.mode).toBe("cached");
        expect(r.base2.mode).toBe("renderStored");
        expect(r.head.mode).toBe("cached");
    });

    test("--reuse-base and --reuse-head read --work, never the cache", () => {
        const r = resolveSources({
            options: { ...opts, reuseBase: true, reuseHead: true },
            headClean: true,
            work,
            cache,
            hit: all,
        });
        for (const [side, dir] of [
            [r.base1, work.base1],
            [r.base2, work.base2],
            [r.head, work.head],
        ] as const) {
            expect(side).toEqual({ mode: "reuse", dir, cacheDir: null });
        }
    });

    test("a side with no stored folder renders into --work only", () => {
        const r = resolveSources({
            options: { ...opts, reuseBase: true },
            headClean: true,
            work,
            cache: { base1: null, base2: null, head: cache.head },
            hit: all,
        });
        expect(r.base1).toEqual({
            mode: "reuse",
            dir: work.base1,
            cacheDir: null,
        });
        const dirty = resolveSources({
            options: opts,
            headClean: true,
            work,
            cache: { base1: cache.base1, base2: null, head: null },
            hit: all,
        });
        expect(dirty.base1.mode).toBe("cached");
        expect(dirty.base2).toEqual({
            mode: "render",
            dir: work.base2,
            cacheDir: null,
        });
        expect(dirty.head).toEqual({
            mode: "render",
            dir: work.head,
            cacheDir: null,
        });
    });

    test("--reuse-base alone leaves the head to the cache rules", () => {
        const r = resolveSources({
            options: { ...opts, reuseBase: true },
            headClean: false,
            work,
            cache,
            hit: all,
        });
        expect(r.base1.mode).toBe("reuse");
        expect(r.head.mode).toBe("render");
    });
});

describe("a run leaves its sets in --work", () => {
    const made: string[] = [];
    afterAll(() => {
        for (const d of made) rmSync(d, { recursive: true, force: true });
    });
    const scratch = () => {
        const d = mkdtempSync(join(tmpdir(), "pd-sets-"));
        made.push(d);
        return d;
    };
    const png = (dir: string, name: string, body: string) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, name), body);
    };

    test("a cached set is copied into --work, so --reuse-* reads exactly it", () => {
        const root = scratch();
        const cached = join(root, "cache/base-1");
        const workDir = join(root, "work/base-1");
        png(cached, "today.png", "cached-bytes");
        // A set an older run (maybe another commit) left behind.
        png(workDir, "today.png", "stale-bytes");
        png(workDir, "gone.png", "stale-only");
        placeCached(cached, workDir);
        expect(readdirSync(workDir).sort()).toEqual(["today.png"]);
        expect(readFileSync(join(workDir, "today.png"), "utf8")).toBe(
            "cached-bytes",
        );
    });

    test("a rendered set is stored as a copy, and --work keeps its own", () => {
        const root = scratch();
        const workDir = join(root, "work/head");
        const final = join(root, "cache/head");
        png(workDir, "a.png", "A");
        expect(storeSet(workDir, final)).toBe("stored");
        expect(readFileSync(join(final, "a.png"), "utf8")).toBe("A");
        expect(readdirSync(workDir)).toEqual(["a.png"]);
    });

    test("the first writer wins: a set already stored is never replaced", () => {
        const root = scratch();
        const final = join(root, "cache/base-1");
        png(final, "a.png", "FIRST");
        const workDir = join(root, "work/base-1");
        png(workDir, "a.png", "SECOND");
        expect(storeSet(workDir, final)).toBe("kept");
        expect(readFileSync(join(final, "a.png"), "utf8")).toBe("FIRST");
    });

    test("losing the rename race keeps the winner and leaves no temp folder", () => {
        const root = scratch();
        const final = join(root, "cache/base-1");
        const workDir = join(root, "work/base-1");
        png(workDir, "a.png", "SECOND");
        // The other run lands between our check and our rename.
        const result = storeSet(workDir, final, () =>
            png(final, "a.png", "FIRST"),
        );
        expect(result).toBe("kept");
        expect(readFileSync(join(final, "a.png"), "utf8")).toBe("FIRST");
        expect(readdirSync(join(root, "cache"))).toEqual(["base-1"]);
    });

    test("base-1 and base-2 are stored independently", () => {
        const root = scratch();
        const b1 = join(root, "cache/k/base-1");
        const b2 = join(root, "cache/k/base-2");
        png(b1, "a.png", "ONE");
        const w2 = join(root, "work/base-2");
        png(w2, "a.png", "TWO");
        expect(storeSet(w2, b2)).toBe("stored");
        expect(readFileSync(join(b1, "a.png"), "utf8")).toBe("ONE");
        expect(readFileSync(join(b2, "a.png"), "utf8")).toBe("TWO");
    });
});

describe("stamps and a stale --work", () => {
    const made: string[] = [];
    afterAll(() => {
        for (const d of made) rmSync(d, { recursive: true, force: true });
    });
    const scratch = () => {
        const d = mkdtempSync(join(tmpdir(), "pd-stamp-"));
        made.push(d);
        return d;
    };
    const sha = "a".repeat(40);

    test("a stamp names the commit, and marks a dirty tree", () => {
        expect(formatStamp({ sha })).toBe(sha);
        expect(formatStamp({ sha, dirty: true })).toContain(sha);
        expect(formatStamp({ sha, dirty: true })).not.toBe(sha);
    });

    test("a stamp written into a side reads back; a side without one is null", () => {
        const dir = join(scratch(), "base-1");
        mkdirSync(dir);
        expect(readStamp(dir)).toBeNull();
        writeStamp(dir, sha);
        expect(readStamp(dir)).toBe(sha);
        expect(readdirSync(dir)).toEqual([STAMP_FILE]);
    });

    test("equal stamps (or two older runs with none) may be reused together", () => {
        expect(baseStampProblem(sha, sha)).toBeNull();
        expect(baseStampProblem(null, null)).toBeNull();
    });

    test("base-1 and base-2 from different commits are refused", () => {
        const other = "b".repeat(40);
        expect(baseStampProblem(sha, other)).toContain("same commit");
        expect(baseStampProblem(sha, null)).toContain("no stamp");
        expect(baseStampProblem(null, other)).toContain("no stamp");
    });

    test("a run clears every side it will not reuse, and only those", () => {
        const root = scratch();
        const work = {
            base1: join(root, "base-1"),
            base2: join(root, "base-2"),
            head: join(root, "head"),
        };
        const fill = () => {
            for (const d of Object.values(work)) {
                mkdirSync(d, { recursive: true });
                writeFileSync(join(d, "a.png"), "old");
            }
        };
        fill();
        clearWorkSides(work, { reuseBase: false, reuseHead: false });
        expect(readdirSync(root)).toEqual([]);

        fill();
        clearWorkSides(work, { reuseBase: true, reuseHead: false });
        expect(readdirSync(root).sort()).toEqual(["base-1", "base-2"]);

        fill();
        clearWorkSides(work, { reuseBase: false, reuseHead: true });
        expect(readdirSync(root)).toEqual(["head"]);

        fill();
        clearWorkSides(work, { reuseBase: true, reuseHead: true });
        expect(readdirSync(root).sort()).toEqual(["base-1", "base-2", "head"]);
    });

    test("clearing a --work that does not exist yet is fine", () => {
        const root = scratch();
        expect(() =>
            clearWorkSides(
                {
                    base1: join(root, "x/base-1"),
                    base2: join(root, "x/base-2"),
                    head: join(root, "x/head"),
                },
                { reuseBase: false, reuseHead: false },
            ),
        ).not.toThrow();
    });
});

describe("git helpers", () => {
    const made: string[] = [];
    afterAll(() => {
        for (const d of made) rmSync(d, { recursive: true, force: true });
    });
    const git = (cwd: string, ...args: string[]) => {
        const r = spawnSync(
            "git",
            [
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "tag.gpgsign=false",
                ...args,
            ],
            { cwd, encoding: "utf8" },
        );
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout.trim();
    };
    const repo = () => {
        const d = mkdtempSync(join(tmpdir(), "pd-git-"));
        made.push(d);
        git(d, "init", "-q");
        writeFileSync(join(d, "a.txt"), "a");
        git(d, "add", "-A");
        git(d, "commit", "-qm", "one");
        return d;
    };

    test("resolveCommit gives the full commit sha of a ref", async () => {
        const d = repo();
        const head = git(d, "rev-parse", "HEAD");
        expect(await resolveCommit(d, "HEAD")).toBe(head);
        expect(await resolveCommit(d, "HEAD")).toMatch(/^[0-9a-f]{40}$/);
    });

    test("resolveCommit peels an annotated tag to its commit, not the tag object", async () => {
        const d = repo();
        git(d, "tag", "-a", "v1", "-m", "release");
        const tagObject = git(d, "rev-parse", "v1");
        const commit = git(d, "rev-parse", "HEAD");
        expect(tagObject).not.toBe(commit);
        expect(await resolveCommit(d, "v1")).toBe(commit);
    });

    test("resolveCommit refuses a ref that is not a commit", async () => {
        const d = repo();
        await expect(resolveCommit(d, "no-such-ref")).rejects.toThrow();
    });

    test("a clean tree has an empty porcelain, so its head is cacheable", async () => {
        const d = repo();
        expect(headCacheable(await workingTreePorcelain(d))).toBe(true);
    });

    test("headStillCacheable holds while HEAD and the tree are as they were", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        expect(await headStillCacheable(d, sha)).toEqual({ ok: true });
    });

    test("an edit during the render means the head is not stored", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        writeFileSync(join(d, "a.txt"), "edited");
        const r = await headStillCacheable(d, sha);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("working tree changed");
    });

    test("shots copied into an unignored --work inside the repo are named, not blamed on the user", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        mkdirSync(join(d, "shots/head"), { recursive: true });
        writeFileSync(join(d, "shots/head/a.png"), "p");
        const r = await headStillCacheable(d, sha, join(d, "shots"));
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toContain("--work");
            expect(r.reason).toContain("inside the repo and not ignored");
            expect(r.reason).not.toContain("working tree changed");
        }
    });

    test("an edit outside --work is still reported as a changed tree", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        mkdirSync(join(d, "shots"), { recursive: true });
        writeFileSync(join(d, "shots/a.png"), "p");
        writeFileSync(join(d, "a.txt"), "edited");
        const r = await headStillCacheable(d, sha, join(d, "shots"));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("working tree changed");
    });

    test("a new file during the render means the head is not stored", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        writeFileSync(join(d, "new.txt"), "n");
        expect((await headStillCacheable(d, sha)).ok).toBe(false);
    });

    test("a commit during the render means the head is not stored under the old key", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        writeFileSync(join(d, "a.txt"), "two");
        git(d, "commit", "-qam", "two");
        // The tree is clean again, but it is another commit.
        const r = await headStillCacheable(d, sha);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("HEAD moved");
    });

    test("a branch switch during the render means the head is not stored", async () => {
        const d = repo();
        const sha = git(d, "rev-parse", "HEAD");
        git(d, "switch", "-qc", "other");
        writeFileSync(join(d, "b.txt"), "b");
        git(d, "add", "-A");
        git(d, "commit", "-qm", "other");
        expect((await headStillCacheable(d, sha)).ok).toBe(false);
    });

    test("an untracked file in a new folder makes the tree dirty even when status hides untracked files", async () => {
        const d = repo();
        git(d, "config", "status.showUntrackedFiles", "no");
        mkdirSync(join(d, "newdir"));
        writeFileSync(join(d, "newdir/b.txt"), "b");
        expect(git(d, "status", "--porcelain")).toBe("");
        const porcelain = await workingTreePorcelain(d);
        expect(porcelain).toContain("newdir/");
        expect(headCacheable(porcelain)).toBe(false);
    });
});
