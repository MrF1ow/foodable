import { test, expect } from "bun:test";
import {
    assembleSource,
    getWidgetHtml,
    minifyCss,
    minifyWidgetHtml,
    WIDGET_BUDGETS,
    WIDGET_TEMPLATES,
    WIDGET_TEMPLATES_V2,
    widgetAssemblies,
    widgetTemplateName,
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
    for (const { key, v2 } of widgetAssemblies()) {
        const budget = WIDGET_BUDGETS[key];
        expect(budget).toBeDefined();
        const html = await getWidgetHtml(key, { v2 });
        const raw = new TextEncoder().encode(html).byteLength;
        const gzip = gzipByteLength(html);
        const label = v2 ? `${key}:v2` : key;
        rows.push(
            label.padEnd(22) + `${raw}`.padStart(10) + `${gzip}`.padStart(10),
        );
        expect(raw).toBeLessThanOrEqual(budget!.raw);
        expect(gzip).toBeLessThanOrEqual(budget!.gzip);
    }
    console.log(rows.join("\n"));
});

test("v2 assembly falls back to the v1 template when no v2 file exists", async () => {
    const v1 = await getWidgetHtml("trends");
    const v2 = await getWidgetHtml("trends", { v2: true });
    expect(v2).toBe(v1);
});

test("v2-only keys resolve only through the v2 variant", () => {
    const v2Only = "__v2_only_fixture__";
    (WIDGET_TEMPLATES_V2 as Record<string, string>)[v2Only] =
        "fixture-only.html";
    try {
        expect(widgetTemplateName(v2Only)).toBe("");
        expect(widgetTemplateName(v2Only, { v2: true })).toBe(
            "fixture-only.html",
        );
        // A v2-only key is assembled only as v2: warming and the budget
        // test must never ask for its v1 twin.
        expect(widgetAssemblies().filter((a) => a.key === v2Only)).toEqual([
            { key: v2Only, v2: true },
        ]);
    } finally {
        delete (WIDGET_TEMPLATES_V2 as Record<string, string>)[v2Only];
    }
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

// ---- v2 shared partials ----------------------------------------------------

const V2_TEMPLATES = [
    ...new Bun.Glob("*.html").scanSync(`${SRC}/templates/v2`),
].sort();

test("v2 templates exist for the gallery", () => {
    expect(V2_TEMPLATES).toContain("component-gallery.html");
});

test.each(V2_TEMPLATES)(
    "v2 %s assembles self-contained on v2 partials only",
    async (file) => {
        const key = file.replace(/\.html$/, "");
        const source = await assembleSource(key, { v2: true });
        const html = await getWidgetHtml(key, { v2: true });

        expect(source.match(/\/\*@include/g)).toBeNull();
        expect(source.match(/\/\*@inlinets/g)).toBeNull();
        expect((html.match(/<style>/g) ?? []).length).toBe(1);
        expect((html.match(/<script>/g) ?? []).length).toBe(1);
        expect(html).not.toContain("<link");
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect((html.match(/initWidget\(\{/g) ?? []).length).toBe(1);

        // The Theme palette, never the v1 NEUTRAL tokens or a web font.
        expect(source).toContain("MCP chat widgets v2");
        expect(html).not.toContain("--accent: #28cf8b");
        for (const marker of ["Geist", "Bricolage", "/fonts/"]) {
            expect(source).not.toContain(marker);
        }
        for (const script of widgetScriptBodies(html)) {
            expect(() => new Function(script)).not.toThrow();
        }

        // Every included partial appears verbatim (v1 partials included).
        const template = await Bun.file(`${SRC}/templates/v2/${file}`).text();
        const includes = [...template.matchAll(INCLUDE_RE)].map((m) => m[1]!);
        expect(includes.length).toBeGreaterThan(0);
        for (const rel of includes) {
            expect(source).toContain(await partialAsInlined(rel));
        }
    },
);

// The v2 builders are plain browser functions. Load them the way a template
// does (util.js, v1 macros.js with the geometry inlined, then the v2 files)
// and drive them directly.
type V2Api = {
    macroStripV2(v: object, g: object | null, o?: object): string;
    gaugeV2(
        v: object,
        g: object | null,
        attrs?: object,
    ): { html: string; status: string };
    goalListV2(v: object, g: object | null): string;
    ringsV2(days: object[], g: object | null, active?: number): string;
    averagesV2(v: object, g: object | null): string;
    pcfV2(v: object): string;
    v2Row(r: object): string;
    v2Header(t: string, m?: string | null, end?: string): string;
    v2Seg(o: object[], active: unknown, label?: string): string;
    v2Chips(items: object[]): string;
    v2Bar(f: number, c: string, o?: object): string;
    v2Dot(c?: string | null, tone?: string, large?: boolean): string;
    v2Buttons(items: object[]): string;
    v2Tiles(items: object[]): string;
    v2Attrs(a: object | undefined): string;
    mealBlockV2(name: string, v: object): string;
    v2ClaimStrip(target: unknown): unknown;
    macroCtx(): unknown;
};

async function loadV2(): Promise<V2Api> {
    const parts = await Promise.all(
        [
            "shared/util.js",
            "shared/macros.js",
            "shared/v2/ui.js",
            "shared/v2/macros.js",
        ].map(partialAsInlined),
    );
    const names = [
        "macroStripV2",
        "gaugeV2",
        "goalListV2",
        "ringsV2",
        "averagesV2",
        "pcfV2",
        "v2Row",
        "v2Header",
        "v2Seg",
        "v2Chips",
        "v2Bar",
        "v2Dot",
        "v2Buttons",
        "v2Tiles",
        "v2Attrs",
        "mealBlockV2",
        "v2ClaimStrip",
    ];
    return new Function(
        `${parts.join("\n")}\nreturn { ${names.join(", ")}, macroCtx: () => __macroCtx };`,
    )() as V2Api;
}

// fmt() groups thousands with toLocaleString, so expected figures are
// written through the same locale rather than with a hard-coded comma.
const n = (x: number) => x.toLocaleString();

const V2_GOAL = {
    calories: 2421,
    protein_g: 210,
    carbs_g: 213,
    fat_g: 81,
    fiber_g: 38,
    sugar_g: 50,
    caffeine_mg: 400,
    water_ml: 3000,
};
const V2_DAY = {
    calories: 1284,
    protein_g: 96,
    carbs_g: 118,
    fat_g: 42,
    fiber_g: 18,
    sugar_g: 31,
    alcohol_g: 0,
    caffeine_mg: 180,
    water_ml: 1600,
};

test("v2 gauge reads kcal left, over, at goal and eaten", async () => {
    const v2 = await loadV2();
    const under = v2.gaugeV2(V2_DAY, V2_GOAL);
    expect(under.status).toBe("under");
    expect(under.html).toContain(`>${n(1137)}<`);
    expect(under.html).toContain("kcal left");
    // Three macro segments over the track, each in its macro colour.
    expect(under.html.match(/<path /g)?.length).toBe(4);
    expect(under.html).toContain("stroke:var(--protein)");

    const over = v2.gaugeV2({ ...V2_DAY, calories: 2690 }, V2_GOAL);
    expect(over.status).toBe("over");
    expect(over.html).toContain('gauge-v is-over">269<');
    expect(over.html).toContain("kcal over");

    expect(v2.gaugeV2({ ...V2_DAY, calories: 2421 }, V2_GOAL).html).toContain(
        "at goal",
    );

    const none = v2.gaugeV2(V2_DAY, null);
    expect(none.status).toBe("no-goal");
    expect(none.html).toContain(`>${n(1284)}<`);
    expect(none.html).toContain("kcal eaten");
    expect(none.html.match(/<path /g)?.length).toBe(1);
});

test("v2 strip lays limits out in the design's order and keeps v1's gates", async () => {
    const v2 = await loadV2();
    const html = v2.macroStripV2(V2_DAY, V2_GOAL);
    const labels = [...html.matchAll(/class="lim-l">([^<]+)</g)].map(
        (m) => m[1],
    );
    expect(labels).toEqual(["Sugar", "Fiber", "Caffeine", "Alcohol"]);
    // Alcohol reads in drinks; with no limit set there is no "/ …".
    expect(html).toContain('<span class="v">0</span><span class="vs">drinks');
    expect(html).toContain("1.6 / 3 L");

    // Never-recorded alcohol and caffeine render no cell (null is the gate),
    // and an untouched water line is left out.
    const empty = v2.macroStripV2(
        { ...V2_DAY, alcohol_g: null, caffeine_mg: null, water_ml: 0 },
        V2_GOAL,
    );
    expect(empty).not.toContain(">Alcohol<");
    expect(empty).not.toContain(">Caffeine<");
    expect(empty).not.toContain('class="water"');
    expect(empty).toContain('style="--n:2"');

    // A ceiling past its limit flags the figure; a floor past it does not.
    const over = v2.macroStripV2(
        { ...V2_DAY, sugar_g: 61.3, protein_g: 250, alcohol_g: 31.6 },
        { ...V2_GOAL, alcohol_g: 28 },
        { drinkUnit: "uk" },
    );
    expect(over).toContain('<span class="v is-over">61.3</span>');
    expect(over).toContain('<span class="v is-over">4.0</span>');
    expect(over).toContain("/ 3.5 drinks");
    expect(over).toContain('<span class="v">250</span>');
});

test("v2 strip opens v1's breakdown only when meals are behind it", async () => {
    const v2 = await loadV2();
    const meals = [
        { description: "Bowl", calories: 852, protein_g: 69, carbs_g: 76 },
    ];
    const live = v2.macroStripV2(V2_DAY, V2_GOAL, { meals });
    expect(live).toContain("data-macro-panel");
    expect(live).toContain('data-macro="carbs_g"');
    expect(live).not.toContain('data-macro="fat_g"');
    expect(live).toContain('class="macro-detail" hidden');
    const ctx = v2.macroCtx();

    // A static strip drawn afterwards leaves the slot to the live one.
    const still = v2.macroStripV2(V2_DAY, V2_GOAL);
    expect(still).not.toContain("data-macro");
    expect(v2.macroCtx()).toBe(ctx);
});

test("v2 goal list, rings and averages", async () => {
    const v2 = await loadV2();
    const goals = v2.goalListV2(V2_DAY, V2_GOAL);
    expect(goals).toContain(`${n(1284)} / ${n(2421)} kcal`);
    expect(goals).toContain(">53%<");
    expect(v2.goalListV2(V2_DAY, null)).toContain("no goal");

    const rings = v2.ringsV2(
        [
            { label: "S", protein_g: 96, carbs_g: 118, fat_g: 42 },
            { label: "M" },
        ],
        V2_GOAL,
        0,
    );
    expect(rings.match(/class="rday/g)?.length).toBe(2);
    expect(rings).toContain('class="rday on"');
    // A day with data draws three tracks and three fills; an empty day only
    // its tracks.
    expect(rings.match(/r-track/g)?.length).toBe(6);
    expect(rings.match(/style="stroke:/g)?.length).toBe(3);
    expect(rings).toContain('width="40" height="22"');

    const avg = v2.averagesV2(
        { protein_g: 189, carbs_g: 190, fat_g: 98, calories: 2365 },
        V2_GOAL,
    );
    expect(avg).toContain('row-end is-over">98 / 81<');
    expect(avg).toContain('row-end">189 / 210<');
    expect(avg).toContain('<b style="left:92.0%">');
});

test("v2 generic builders escape text and mark state", async () => {
    const v2 = await loadV2();
    expect(v2.v2Header("<b>", "a & b")).toContain("&lt;b&gt;");
    expect(v2.v2Header("T", "a & b")).toContain("a &amp; b");
    const row = v2.v2Row({
        dot: { tone: "over" },
        title: "Salmon",
        sub: "tomorrow",
        subTone: "over",
        action: "Cook it",
    });
    expect(row).toContain('class="dot lg s-over"');
    expect(row).toContain('row-s is-over">tomorrow<');
    expect(row).toContain('<button type="button" class="act">Cook it</button>');
    const done = v2.v2Row({ check: true, done: true, title: "Oil" });
    expect(done).toContain('class="row done"');
    expect(done).toContain('aria-pressed="true"');
    expect(
        v2.v2Seg(
            [
                { value: 7, label: "7d" },
                { value: 14, label: "14d" },
            ],
            14,
        ),
    ).toContain('data-range="14" aria-pressed="true"');
    expect(v2.v2Chips([{ label: "Costco", count: 5, on: true }])).toContain(
        'aria-pressed="true">Costco<span class="chip-n">5</span>',
    );
    expect(v2.v2Bar(0, "var(--water)")).toBe('<div class="bar"></div>');
    expect(v2.v2Bar(2, "var(--water)", { size: "thin" })).toContain(
        "width:100.0%",
    );
    expect(v2.pcfV2({ protein_g: 69, carbs_g: 76, fat_g: 25 })).toContain(
        '<span class="p">P 69</span>',
    );
});

// ---- v2 hardening ----------------------------------------------------------

const EVIL = '"><img src=x onerror=alert(1)>';

test("v2 attributes: unsafe names dropped, values escaped", async () => {
    const v2 = await loadV2();
    expect(
        v2.v2Attrs({
            "data-id": EVIL,
            "aria-label": "a & b",
            role: "button",
            tabindex: 0,
            onclick: "alert(1)",
            "data-x onmouseover": "1",
            style: "color:red",
            hidden: true,
            title: null,
        }),
    ).toBe(
        ' data-id="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" aria-label="a &amp; b" role="button" tabindex="0"',
    );
    // A string is not an attribute map: nothing reaches the markup.
    expect(v2.v2Attrs("><img src=x onerror=alert(1)>" as never)).toBe("");
});

test("v2 builders never splice caller attributes or classes raw", async () => {
    const v2 = await loadV2();
    const hostile = [
        v2.v2Row({ title: "Eggs", attrs: "><img src=x onerror=alert(1)>" }),
        v2.v2Row({ title: "Eggs", attrs: { onclick: "alert(1)" } }),
        v2.v2Row({ title: "Eggs", attrs: { "data-id": EVIL } }),
        v2.v2Row({
            title: "Eggs",
            action: "Add",
            actionAttrs: ' onclick="alert(1)"',
        }),
        v2.v2Row({ title: "Eggs", kind: 'x" onmouseover="alert(1)' }),
        v2.v2Row({
            title: "Eggs",
            end: "Nov 1",
            endKind: 'x" onmouseover="alert(1)',
        }),
        v2.v2Chips([{ label: "A", attrs: ' onclick="alert(1)"' }]),
        v2.v2Buttons([{ label: "A", attrs: ' onclick="alert(1)"' }]),
        v2.v2Bar(0.5, 'red" onmouseover="alert(1)'),
        v2.v2Bar(0.5, "var(--water)", { size: 'x" onmouseover="alert(1)' }),
        v2.v2Dot('red" onmouseover="alert(1)'),
        v2.v2Dot(null, 'x" onmouseover="alert(1)'),
        v2.v2Tiles([{ when: "1", name: "A", tone: '" onclick="x' }]),
        v2.gaugeV2(V2_DAY, V2_GOAL, { onclick: "alert(1)" } as never).html,
        v2.gaugeV2(V2_DAY, V2_GOAL, ' onclick="alert(1)"' as never).html,
    ];
    for (const html of hostile) {
        expect(html).not.toContain("<img");
        // No event handler outside a quoted (escaped) attribute value.
        expect(html.replace(/"[^"]*"/g, '""')).not.toMatch(/\son[a-z]+=/);
    }
    // Known values still get through.
    expect(v2.v2Row({ title: "Eggs", attrs: { "data-id": "7" } })).toContain(
        '<div class="row" data-id="7">',
    );
    expect(
        v2.v2Row({
            title: "Eggs",
            action: "Add",
            actionAttrs: { "data-act": "add" },
        }),
    ).toContain('class="act" data-act="add">Add<');
    expect(v2.v2Row({ title: "A", kind: "avg" })).toContain('class="row avg"');
    expect(v2.v2Row({ title: "A", end: "Nov 1", endKind: "date" })).toContain(
        'class="row-end date"',
    );
    expect(v2.v2Row({ title: "A", kind: "nope" })).toContain('class="row"');
    expect(v2.v2Bar(0.5, "var(--water)", { size: "thin" })).toContain(
        'class="bar thin"',
    );
    expect(v2.v2Bar(0.5, "var(--water)", { size: "huge" })).toContain(
        'class="bar"',
    );
    // Colours: a MACROS colour or a known token, nothing else.
    expect(v2.v2Bar(0.5, "var(--water)")).toContain("--c:var(--water)");
    expect(v2.v2Dot("accent-fill")).toContain("--c:var(--accent-fill)");
    expect(v2.v2Dot("var(--status-warn)")).toContain("--c:var(--status-warn)");
    expect(v2.v2Dot("red")).toBe('<span class="dot"></span>');
    expect(v2.v2Dot("var(--evil)")).toBe('<span class="dot"></span>');
    expect(v2.v2Dot(null, "warn", true)).toBe(
        '<span class="dot lg s-warn"></span>',
    );
    expect(v2.v2Dot(null, "bogus")).toBe('<span class="dot"></span>');
    expect(
        v2.v2Chips([{ label: "A", attrs: { "data-store": "costco" } }]),
    ).toContain('aria-pressed="false" data-store="costco">A');
    expect(
        v2.v2Buttons([{ label: "Go", attrs: { "data-act": "cook" } }]),
    ).toContain('class="btn" data-act="cook">Go<');
});

test("v2 escapes food names in rows and the meal block", async () => {
    const v2 = await loadV2();
    const row = v2.v2Row({ title: "<b>Eggs</b>", sub: "<i>" });
    expect(row).toContain("&lt;b&gt;Eggs&lt;/b&gt;");
    expect(row).not.toContain("<b>");
    expect(row).not.toContain("<i>");
    const meal = v2.mealBlockV2("<img src=x onerror=alert(1)>", {
        calories: 10,
    });
    expect(meal).not.toContain("<img");
    expect(meal).toContain("&lt;img src=x onerror=alert(1)&gt;");
});

test("v2 dim text tone renders tertiary", async () => {
    const v2 = await loadV2();
    const row = v2.v2Row({
        title: "Yogurt",
        sub: "12 oz",
        subTone: "dim",
        end: "5 days",
        endTone: "dim",
    });
    expect(row).toContain('row-s is-dim">12 oz<');
    expect(row).toContain('row-end is-dim">5 days<');
    expect(v2.v2Tiles([{ when: "5 days", tone: "dim", name: "A" }])).toContain(
        'tile-w is-dim"',
    );
    const css = await Bun.file(`${SRC}/shared/v2/components.css`).text();
    expect(css).toMatch(/\.is-dim \{\s*color: var\(--text-tertiary\);/);
});

test("v2 tones beat the date column; v2 controls show focus", async () => {
    const css = await Bun.file(`${SRC}/shared/v2/components.css`).text();
    // `.row-end.date` (0,2,0) used to outrank `.is-over` (0,1,0), so an
    // overdue date stayed tertiary. The date rule must stay at (0,1,0).
    expect(css).not.toMatch(/\.row-end\.date\s*\{/);
    expect(css).toMatch(/\.row-end:where\(\.date\)\s*\{/);
    expect(css.indexOf(".row-end:where(.date)")).toBeLessThan(
        css.indexOf(".is-over {"),
    );
    for (const sel of [
        ".check:focus-visible",
        ".chip:focus-visible",
        ".md-close:focus-visible",
        ".strip [data-macro]:focus-visible",
    ]) {
        expect(css).toContain(sel);
    }
    const focus = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];
    for (const sel of [".check", ".chip", ".md-close"]) {
        const rule = focus.find((m) => m[1]!.includes(`${sel}:focus-visible`));
        expect(rule?.[2]).toContain("var(--accent-fill)");
    }
});

test("v2 rings survive empty days and fit a 30-day range", async () => {
    const v2 = await loadV2();
    const one = v2.ringsV2([null as never, undefined as never], V2_GOAL, 0);
    expect(one.match(/class="rday/g)?.length).toBe(2);
    expect(one.match(/r-track/g)?.length).toBe(6);
    expect(one).not.toContain('style="stroke:');

    const days = (k: number) =>
        Array.from({ length: k }, (_, i) => ({
            label: String(i + 1),
            protein_g: 100,
        }));
    // Seven across as the design draws them, fourteen in one row, thirty
    // wrapped into two rows of fifteen; the cell shrinks its ring to fit.
    expect(v2.ringsV2(days(7), V2_GOAL, 6)).toContain('style="--cols:7"');
    expect(v2.ringsV2(days(14), V2_GOAL, 13)).toContain('style="--cols:14"');
    expect(v2.ringsV2(days(30), V2_GOAL, 29)).toContain('style="--cols:15"');
    expect(v2.ringsV2(days(30), V2_GOAL, 30)).not.toContain("rday on");
    expect(v2.ringsV2(days(7), V2_GOAL, -1)).not.toContain("rday on");
    const css = await Bun.file(`${SRC}/shared/v2/components.css`).text();
    expect(css).toMatch(
        /\.rings \{[^}]*grid-template-columns: repeat\(var\(--cols\), minmax\(0, 1fr\)\)/,
    );
    expect(css).toMatch(
        /\.rday svg \{[^}]*max-width: calc\(100% - 4px\);[^}]*height: auto;/,
    );
});

test("v2 water reads small amounts and figures clamp at zero", async () => {
    const v2 = await loadV2();
    const tiny = v2.macroStripV2({ ...V2_DAY, water_ml: 40 }, V2_GOAL);
    expect(tiny).toContain("&lt;0.1 / 3 L");
    expect(v2.macroStripV2(V2_DAY, V2_GOAL)).toContain("1.6 / 3 L");
    expect(v2.macroStripV2({ ...V2_DAY, water_ml: 3000 }, V2_GOAL)).toContain(
        "3 / 3 L",
    );

    const neg = { ...V2_DAY, calories: -50, protein_g: -3, sugar_g: -1 };
    const strip = v2.macroStripV2(neg, V2_GOAL);
    expect(strip).not.toMatch(/>-\d/);
    expect(strip).toContain(`>${n(2421)}<`);
    const goals = v2.goalListV2(neg, V2_GOAL);
    expect(goals).not.toMatch(/>-\d/);
    expect(goals).toContain(">0%<");
    expect(v2.gaugeV2(neg, null).html).toContain('gauge-v">0<');
    expect(v2.pcfV2({ protein_g: -2 })).toContain("P 0<");
    expect(v2.mealBlockV2("x", { calories: -9 })).toContain("+0<");
    expect(v2.averagesV2({ protein_g: -4 }, V2_GOAL)).not.toMatch(/>-\d/);
});

test("v2 interactive strips each keep their own breakdown", async () => {
    const v2 = await loadV2();
    const first = [{ description: "Oats", protein_g: 27 }];
    const second = [{ description: "Bowl", protein_g: 69 }];
    const a = v2.macroStripV2(V2_DAY, V2_GOAL, { meals: first });
    const b = v2.macroStripV2(V2_DAY, V2_GOAL, { meals: second });
    const idOf = (html: string) =>
        html.match(/data-macro-strip="([^"]+)"/)?.[1];
    expect(idOf(a)).toBeDefined();
    expect(idOf(b)).toBeDefined();
    expect(idOf(a)).not.toBe(idOf(b));

    // A tap on the first strip claims the shared slot for that strip before
    // v1's handler reads it.
    const tapOn = (html: string) => ({
        closest: (sel: string) =>
            sel === "[data-macro-strip]"
                ? { getAttribute: () => idOf(html) }
                : null,
    });
    v2.v2ClaimStrip(tapOn(a));
    expect((v2.macroCtx() as { meals: unknown }).meals).toBe(first);
    v2.v2ClaimStrip(tapOn(b));
    expect((v2.macroCtx() as { meals: unknown }).meals).toBe(second);
    // A tap outside any v2 strip leaves the slot alone.
    v2.v2ClaimStrip({ closest: () => null });
    expect((v2.macroCtx() as { meals: unknown }).meals).toBe(second);
});

test("v2 macro copy carries no unused strings", async () => {
    const src = await Bun.file(`${SRC}/shared/v2/macros.js`).text();
    expect(src).not.toContain("legend:");
});
