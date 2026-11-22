import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    classifyShots,
    differs,
    parseArgs,
    pngSize,
    USAGE,
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
            ]),
        ).toEqual({
            kind: "run",
            options: {
                base: "v1.2.0",
                work: "/tmp/w",
                reuseBase: true,
                reuseHead: true,
                keep: true,
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
        [["--base", "--keep"], "--base"],
        [["stray"], "stray"],
        [["--keep", "--no-cache"], "--no-cache"],
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
