import { test, expect } from "bun:test";
import {
    assembleSource,
    getWidgetHtml,
    minifyCss,
    minifyWidgetHtml,
    WIDGET_BUDGETS,
    WIDGET_TEMPLATES,
} from "./widgets.js";

const KEYS = Object.keys(WIDGET_TEMPLATES);
const SRC = "./public/widgets/src";
const INCLUDE_RE = /\/\*@include\s+([^\s@]+)\s*@\*\//g;
const INLINE_TS_RE = /\/\*@inlinets\s+([^\s@]+)\s*@\*\//g;

async function transpileForWidget(tsPath: string): Promise<string> {
    const ts = await Bun.file(`./${tsPath}`).text();
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(ts);
    return js
        .replace(/^export\s+default\s+/gm, "")
        .replace(/^export\s+/gm, "")
        .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "");
}

/** Partial source as it appears after assembly (@inlinets markers expanded). */
async function partialAsInlined(rel: string): Promise<string> {
    let partial = (await Bun.file(`${SRC}/${rel}`).text()).trim();
    const compiled = new Map<string, string>();
    for (const m of partial.matchAll(INLINE_TS_RE)) {
        const path = m[1]!;
        if (!compiled.has(path)) {
            compiled.set(path, await transpileForWidget(path));
        }
    }
    return partial.replace(
        INLINE_TS_RE,
        (_full, path) => compiled.get(path) ?? "",
    );
}

function widgetScriptBodies(html: string): string[] {
    const bodies: string[] = [];
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        bodies.push(m[1]!);
    }
    return bodies;
}

function gzipByteLength(text: string): number {
    return Bun.gzipSync(new TextEncoder().encode(text)).byteLength;
}

test("minifyCss keeps comment inside a string", () => {
    const css = `.x{background:url("a/*not-comment*/b");}`;
    expect(minifyCss(css)).toContain("/*not-comment*/");
});

test("minifyCss keeps calc() and descendant :hover spacing", () => {
    const css = `
        .box { width: calc(1px - 2px); }
        .a :hover { color: red; }
    `;
    const out = minifyCss(css);
    expect(out).toContain("calc(1px - 2px)");
    expect(out).toContain(".a :hover");
});

test("minifyWidgetHtml keeps JS regex and template literal", () => {
    const html = `<!doctype html><style></style><script>
        const re = /foo\\/bar/g;
        const t = \`x \${1} y\`;
    </script>`;
    const min = minifyWidgetHtml(html);
    expect(min).toContain("foo");
    expect(min).toContain("/g");
    expect(min).toContain("`x ${1} y`");
});

// Every widget must assemble from its source partials into a self-contained
// document — no unresolved @include markers, valid inline JS, single style/script.
test.each(KEYS)("%s assembles into a self-contained widget", async (key) => {
    const html = await getWidgetHtml(key);
    // Markers are checked before minifying, which strips comments and would
    // hide one that was never resolved.
    const source = await assembleSource(key);

    // No include marker left behind (the real marker, not the word in prose).
    expect(source.match(/\/\*@include/g)).toBeNull();
    // Same for the TS-inlining marker: an unresolved one would ship a widget
    // whose script silently lacks whole functions.
    expect(source.match(/\/\*@inlinets/g)).toBeNull();
    // Module syntax must not survive into the inline <script>.
    expect(html).not.toMatch(/^export\s/m);

    // Structure: one inlined stylesheet + one inlined script, no external refs.
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true);

    // Shared bridge got inlined and the widget wires itself to it exactly once.
    expect(html).toContain("function initWidget(config)");
    expect((html.match(/initWidget\(\{/g) ?? []).length).toBe(1);

    // Shared design tokens got inlined.
    expect(html).toContain("--accent: #28cf8b");

    // Every inlined <script> body parses as JS after minification.
    for (const script of widgetScriptBodies(html)) {
        expect(() => {
            new Function(script);
        }).not.toThrow();
    }
});

// Guard against a partial being inlined incompletely (e.g. an extraction that
// truncates a component's CSS mid-block): every @include'd partial's full text
// must appear verbatim in the unminified assembly.
test.each(KEYS)("%s inlines each @include'd partial in full", async (key) => {
    const template = await Bun.file(
        `${SRC}/templates/${WIDGET_TEMPLATES[key]}`,
    ).text();
    const includes = [...template.matchAll(INCLUDE_RE)].map((m) => m[1]!);
    expect(includes.length).toBeGreaterThan(0);

    const html = await assembleSource(key);
    for (const rel of includes) {
        const partial = await partialAsInlined(rel);
        expect(html).toContain(partial);
    }
});

test("minified widgets fit size budgets", async () => {
    const rows: string[] = [];
    rows.push("widget".padEnd(22) + "raw".padStart(10) + "gzip".padStart(10));
    for (const key of KEYS) {
        const budget = WIDGET_BUDGETS[key];
        expect(budget).toBeDefined();
        const html = await getWidgetHtml(key);
        const raw = new TextEncoder().encode(html).byteLength;
        const gzip = gzipByteLength(html);
        rows.push(
            key.padEnd(22) + `${raw}`.padStart(10) + `${gzip}`.padStart(10),
        );
        expect(raw).toBeLessThanOrEqual(budget!.raw);
        expect(gzip).toBeLessThanOrEqual(budget!.gzip);
    }
    console.log(rows.join("\n"));
});

test("unknown widget key throws", async () => {
    expect(getWidgetHtml("nope")).rejects.toThrow(/unknown widget/);
});

test("minifying keeps a script's use strict directive", () => {
    const min = minifyWidgetHtml(
        '<script>\n    "use strict";\n    function f() { return 1; }\n</script>',
    );
    expect(min).toBe('<script>"use strict";function f(){return 1}</script>');
});
