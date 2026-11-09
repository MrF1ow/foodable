import { describe, expect, test } from "bun:test";
import { parseBlastArgs } from "./blast.ts";

const script = `${import.meta.dir}/blast.ts`;

function run(...args: string[]) {
    const proc = Bun.spawnSync(["bun", "run", script, ...args]);
    return {
        out: proc.stdout.toString(),
        err: proc.stderr.toString(),
        code: proc.exitCode,
    };
}

describe("blast CLI", () => {
    test("prints exactly the floor on stdout", () => {
        expect(run("--paths", "README.md").out).toBe("low\n");
        expect(run("--paths", "src/domain/fridge.ts").out).toBe("medium\n");
        expect(run("--paths", "package.json").out).toBe("high\n");
        expect(
            run("--paths", "src/domain/fridge.ts,src/domain/grocery.ts").out,
        ).toBe("high\n");
    });

    test("--verbose explains on stderr and keeps stdout clean", () => {
        const r = run("--paths", "package.json,README.md", "--verbose");
        expect(r.out).toBe("high\n");
        expect(r.err).toContain("high: package.json");
        expect(r.err).not.toContain("high: README.md");
    });

    test("parseBlastArgs", () => {
        expect(parseBlastArgs(["--base", "origin/dev", "--verbose"])).toEqual({
            base: "origin/dev",
            verbose: true,
            paths: null,
        });
        expect(parseBlastArgs(["--paths=a,b"]).paths).toEqual(["a", "b"]);
        expect(parseBlastArgs([]).base).toBe("origin/main");
    });
});
