import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
    join(import.meta.dir, "../../../../public/app/v2/components.css"),
    "utf8",
);
// Comments may quote hex values or class names; the rules are what ships.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("components.css has no colour literal: every colour is a token", () => {
    expect(rules.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(
        rules.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g),
    ).toBeNull();
    // Named colours would slip past the checks above.
    expect(
        rules.match(
            /:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/g,
        ),
    ).toBeNull();
});

test("components.css only defines fd- classes and --fd- locals", () => {
    const selectors = rules.replace(/\{[^{}]*\}/g, "{}");
    const classes = [...selectors.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(
        (m) => m[1]!,
    );
    expect(classes.length).toBeGreaterThan(40);
    expect(classes.filter((c) => !c.startsWith("fd-"))).toEqual([]);
    const declared = [...rules.matchAll(/[{;]\s*(--[\w-]+)\s*:/g)].map(
        (m) => m[1]!,
    );
    expect(declared.filter((v) => !v.startsWith("--fd-"))).toEqual([]);
});

test("every var(--x) it reads is a tokens.css name or an --fd- local", () => {
    const tokens = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/tokens.css"),
        "utf8",
    );
    const defined = new Set(
        [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!),
    );
    const used = [...rules.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
    const unknown = used.filter(
        (v) => !defined.has(v) && !v.startsWith("--fd-"),
    );
    expect(unknown).toEqual([]);
});

test("transitions are switched off under prefers-reduced-motion", () => {
    expect(rules).toContain("prefers-reduced-motion: reduce");
    expect(rules.match(/transition:/g)?.length).toBeGreaterThan(0);
});
