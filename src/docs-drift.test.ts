import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { FLAGS } from "./flags.js";

const ROOT = new URL("../", import.meta.url);

function read(path: string): string {
    return readFileSync(new URL(path, ROOT), "utf8");
}

function shippedCss(): string {
    return ["public/app/", "public/app/v2/"]
        .flatMap((dir) =>
            readdirSync(new URL(dir, ROOT))
                .filter((name) => name.endsWith(".css"))
                .map((name) => read(`${dir}${name}`)),
        )
        .join("\n");
}

test("the CLAUDE.md vocabulary names only classes the shipped CSS still styles", () => {
    const paragraph = read("CLAUDE.md")
        .split("\n")
        .find((line) => line.startsWith("- **The vocabulary.**"));
    expect(paragraph).toBeDefined();
    const classes = [...paragraph!.matchAll(/`(\.[A-Za-z][\w-]*)`/g)].map(
        (m) => m[1]!,
    );
    expect(classes.length).toBeGreaterThan(10);
    const css = shippedCss();
    for (const cls of new Set(classes)) {
        const selector = new RegExp(`${cls.replace(".", "\\.")}(?![\\w-])`);
        expect(css, cls).toMatch(selector);
    }
});

test(".env.example's FOODABLE_FLAGS example names real flags", () => {
    const line = read(".env.example").match(/^#\s*FOODABLE_FLAGS=(\S+)$/m);
    expect(line).not.toBeNull();
    for (const entry of line![1]!.split(",")) {
        expect(Object.keys(FLAGS), entry).toContain(entry.split(":")[0]!);
    }
});
