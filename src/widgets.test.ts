import { test, expect, jest, afterEach, setSystemTime } from "bun:test";
import {
    assembleSource,
    getWidgetHtml,
    minifyCss,
    minifyWidgetHtml,
    WIDGET_BUDGETS,
    WIDGET_TEMPLATES,
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
    for (const m of html.matchAll(
        /<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi,
    )) {
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
    expect((html.match(/<script\b/gi) ?? []).length).toBe(1);
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true);

    // Shared bridge got inlined and the widget wires itself to it exactly once.
    expect(html).toContain("function initWidget(config)");
    expect((html.match(/initWidget\(\{/g) ?? []).length).toBe(1);

    // The v2 Theme tokens got inlined.
    expect(html).toContain("--surface-panel");

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
        `${SRC}/templates/v2/${WIDGET_TEMPLATES[key]}`,
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
        const source = await assembleSource(key);
        const html = await getWidgetHtml(key);

        expect(source.match(/\/\*@include/g)).toBeNull();
        expect(source.match(/\/\*@inlinets/g)).toBeNull();
        expect((html.match(/<style>/g) ?? []).length).toBe(1);
        expect((html.match(/<script\b[^>]*>/gi) ?? []).length).toBe(1);
        expect(html).not.toContain("<link");
        expect(html).not.toMatch(/<script[^>]+src=/i);
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
    goalListV2(v: object, g: object | null, o?: object): string;
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
    expect(over).toContain("/ 3.5 UK units");
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

// ---- v2 macro-strip widgets --------------------------------------------------

const WIDGET_FOOTER =
    "You can enable or disable these widgets anytime — just ask to update your settings.";

// #root stub: records #widget-mount and any footer nodes bridge.js appends.
function widgetRootStub(
    clickSink?: (fn: (e: unknown) => void) => void,
    focusLog?: string[],
) {
    let legacyInner = "";
    let mountEl: { id: string; innerHTML: string } | null = null;
    let active: unknown = null;
    // querySelector for the attribute selectors a widget uses to place focus
    // ([data-act="cook"]): finds the tag in the painted markup and returns a
    // stand-in that records focus().
    const findByAttr = (html: string) => (sel: string) => {
        // A value may carry backslash-escaped characters (a quote), as
        // CSS.escape or the widget's fallback writes them; the markup holds
        // it HTML-escaped.
        const m = /^\[(data-[a-z]+)="((?:[^"\\]|\\.)+)"\]$/.exec(sel);
        if (!m) return null;
        const value = m[2]!.replace(/\\(.)/g, (_, c: string) => c);
        const inMarkup = value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
        const tag = new RegExp(`<[^>]*\\s${m[1]}="${inMarkup}"[^>]*>`).exec(
            html,
        );
        if (!tag) return null;
        const el = {
            disabled: /\sdisabled/.test(tag[0]),
            getAttribute: (n: string) => (n === m[1] ? value : null),
            closest: (s: string) => (s === `[${m[1]}]` ? el : null),
            focus() {
                active = el;
                focusLog?.push(sel);
            },
        };
        return el;
    };
    const footerText: string[] = [];
    const root = {
        get innerHTML() {
            return mountEl ? mountEl.innerHTML : legacyInner;
        },
        set innerHTML(v: string) {
            legacyInner = v;
            mountEl = null;
            footerText.length = 0;
        },
        appendChild(node: {
            id?: string;
            innerHTML?: string;
            textContent?: string;
        }) {
            if (node.id === "widget-mount") {
                mountEl = node as { id: string; innerHTML: string };
            } else if (
                node.textContent &&
                node.textContent.includes("enable or disable these widgets")
            ) {
                footerText.push(node.textContent);
            }
        },
        addEventListener: (type: string, fn: (e: unknown) => void) => {
            if (type === "click") clickSink?.(fn);
        },
        querySelector: () => null,
    };
    return {
        root,
        document: {
            getElementById: (id: string) => {
                if (id === "root") return root;
                if (id === "widget-mount") return mountEl;
                return null;
            },
            documentElement: {
                setAttribute: () => {},
                style: {} as object,
                getBoundingClientRect: () => ({ height: 120 }),
            },
            body: {},
            addEventListener: () => {},
            createElement: () => {
                const el = {
                    id: "",
                    innerHTML: "",
                    textContent: "",
                    style: {} as object,
                    querySelector: (sel: string) =>
                        findByAttr(el.innerHTML)(sel),
                };
                return el;
            },
            get activeElement() {
                return active;
            },
        },
        // A user moving focus into the card, as Tab would.
        focusOn(sel: string) {
            findByAttr(mountEl?.innerHTML ?? "")(sel)?.focus();
        },
        html: () =>
            // A real DOM keeps whatever #root held before the mount was
            // appended (e.g. the bridge's loading text), so the stub does too.
            (mountEl ? legacyInner + mountEl.innerHTML : legacyInner) +
            footerText.join(""),
    };
}

// Run an assembled widget's script against a stub document, the way the
// household app seeds a frame: window.__WIDGET_DATA__ is painted straight
// through render(), with no host and no chat footer. Returns the card markup.
function renderWidget(html: string, data: unknown): string {
    return mountWidget(html, data).html();
}

// renderWidget, plus a click on a range toggle button: the event reaches the
// template's delegated listener on #root, whose target answers closest()
// with a button carrying data-range, as a real tap inside the toggle does.
function mountWidget(
    html: string,
    data: unknown,
): { html: () => string; clickRange: (value: number) => void } {
    type Listener = (e: unknown) => void;
    const clicks: Listener[] = [];
    const dom = widgetRootStub((fn) => clicks.push(fn));
    const { root, document } = dom;
    const noop = () => {};
    const window: Record<string, unknown> = {
        __WIDGET_DATA__: data,
        addEventListener: noop,
        innerWidth: 400,
    };
    window.parent = window;
    for (const script of widgetScriptBodies(html)) {
        new Function("window", "document", script)(window, document);
    }
    const clickRange = (value: number) => {
        const button = {
            getAttribute: (name: string) =>
                name === "data-range" ? String(value) : null,
            dataset: { range: String(value) },
        };
        const target = {
            closest: (sel: string) =>
                sel.includes("data-range") ? button : null,
        };
        for (const fn of clicks) fn({ target });
    };
    return { html: dom.html, clickRange };
}

// Chat host paint path (no __WIDGET_DATA__): bridge appends the settings footer.
async function mountChatWidget(
    html: string,
    data: unknown,
): Promise<{
    html: () => string;
    clickRange: (value: number) => void;
    redeliver: (next: unknown) => Promise<void>;
}> {
    type Listener = (e: unknown) => void;
    const clicks: Listener[] = [];
    const dom = widgetRootStub((fn) => clicks.push(fn));
    const { document } = dom;
    const windowListeners: Listener[] = [];
    const deliver = (payload: object) => {
        for (const fn of windowListeners) fn({ source: host, data: payload });
    };
    const host = {
        postMessage(msg: { id?: number; method: string; params?: object }) {
            if (msg.method === "ui/initialize") {
                deliver({
                    jsonrpc: "2.0",
                    id: msg.id,
                    result: {
                        hostCapabilities: { serverTools: {} },
                        hostContext: { theme: "light" },
                    },
                });
            } else if (msg.method === "ui/notifications/initialized") {
                deliver({
                    jsonrpc: "2.0",
                    method: "ui/notifications/tool-result",
                    params: { structuredContent: data },
                });
            }
        },
    };
    const noop = () => {};
    const window: Record<string, unknown> = {
        parent: host,
        innerWidth: 400,
        postMessage: (msg: unknown) =>
            (host.postMessage as (m: unknown) => void)(msg),
        addEventListener: (type: string, fn: Listener) => {
            if (type === "message") windowListeners.push(fn);
        },
        removeEventListener: noop,
    };
    for (const script of widgetScriptBodies(html)) {
        new Function("window", "document", script)(window, document);
    }
    for (let i = 0; i < 32; i++) await Promise.resolve();
    const clickRange = (value: number) => {
        const button = {
            getAttribute: (name: string) =>
                name === "data-range" ? String(value) : null,
            dataset: { range: String(value) },
        };
        const target = {
            closest: (sel: string) =>
                sel.includes("data-range") ? button : null,
        };
        for (const fn of clicks) fn({ target });
    };
    const redeliver = async (next: unknown) => {
        deliver({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: { structuredContent: next },
        });
        for (let i = 0; i < 32; i++) await Promise.resolve();
    };
    return { html: dom.html, clickRange, redeliver };
}

// A local calendar date, written the way the payloads carry it.
function isoDay(offset = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("v2 goal list opens the breakdown per list, like a strip", async () => {
    const v2 = await loadV2();
    const first = [{ description: "Oats", calories: 432, protein_g: 27 }];
    const second = [{ description: "Bowl", calories: 852, protein_g: 69 }];
    const a = v2.goalListV2(V2_DAY, V2_GOAL, { meals: first });
    const b = v2.goalListV2(V2_DAY, V2_GOAL, { meals: second });
    // Every row a meal contributed to is a tile button; the others are not.
    expect(a).toContain("data-macro-panel");
    expect(a).toContain('<div class="gl" role="button"');
    expect(a).toContain('data-macro="calories"');
    expect(a).toContain('data-macro="protein_g"');
    expect(a).not.toContain('data-macro="fat_g"');
    expect(a.match(/class="gl"/g)?.length).toBe(4);
    expect(a.match(/class="gl" role="button"/g)?.length).toBe(2);
    expect(a).toContain('class="macro-detail" hidden');
    expect(a).toContain("data-macro-hint");

    const idOf = (html: string) =>
        html.match(/data-macro-strip="([^"]+)"/)?.[1];
    expect(idOf(a)).toBeDefined();
    expect(idOf(a)).not.toBe(idOf(b));
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

    // No meals behind it: plain rows, and the shared slot is left alone.
    const still = v2.goalListV2(V2_DAY, V2_GOAL, { withLimits: true });
    expect(still).not.toContain("data-macro");
    expect((v2.macroCtx() as { meals: unknown }).meals).toBe(second);
});

test("v2 goal list carries the strip's limits row and water line on request", async () => {
    const v2 = await loadV2();
    const plain = v2.goalListV2(V2_DAY, V2_GOAL);
    expect(plain).toMatch(/^<div class="goals">/);
    expect(plain).not.toContain('class="limits"');
    expect(plain).not.toContain('class="water"');

    const full = v2.goalListV2(V2_DAY, V2_GOAL, {
        withLimits: true,
        withWater: true,
    });
    expect(full).toMatch(/^<div class="strip"><div class="goals">/);
    // The strip's own limits and water: the design's order, v1's gates
    // (alcohol at 0 never recorded is hidden).
    const strip = v2.macroStripV2(V2_DAY, V2_GOAL);
    const limits = strip.match(
        /<div class="limits"[\s\S]*?(?=<div class="water">)/,
    )?.[0];
    expect(limits).toBeDefined();
    expect(full).toContain(limits as string);
    expect(full).toContain("1.6 / 3 L");
    expect(full.indexOf('class="limits"')).toBeLessThan(
        full.indexOf('class="water"'),
    );
    expect(v2.goalListV2(V2_DAY, V2_GOAL, { withLimits: true })).not.toContain(
        'class="water"',
    );
    expect(v2.goalListV2(V2_DAY, V2_GOAL, { withWater: true })).not.toContain(
        'class="limits"',
    );

    // Alcohol in the caller's drink unit, and a limit tile some meal fed is
    // a button too.
    const uk = v2.goalListV2({ ...V2_DAY, alcohol_g: 16 }, V2_GOAL, {
        withLimits: true,
        drinkUnit: "uk",
        meals: [{ description: "Coffee", caffeine_mg: 95 }],
    });
    expect(uk).toContain(">2.0<");
    expect(uk).toContain('data-macro="caffeine_mg"');
});

test("v2 meal block leaves out unrecorded macros instead of printing 0", async () => {
    const v2 = await loadV2();
    const apple = v2.mealBlockV2("Apple", {
        calories: 95,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
    });
    expect(apple).not.toContain('class="pcf"');
    expect(apple).toContain(">+95<");
    const part = v2.mealBlockV2("Toast", {
        calories: 120,
        protein_g: 0,
        carbs_g: 22,
        fat_g: null,
    });
    // A recorded 0 still shows; a null part is left out.
    expect(part).toContain('<span class="p">P 0</span>');
    expect(part).toContain('<span class="c">C 22</span>');
    expect(part).not.toContain('class="f"');
});

test("v2 meal block shows +kcal only for a recorded figure", async () => {
    const v2 = await loadV2();
    expect(v2.mealBlockV2("Bowl", { calories: 852 })).toContain(
        '<span class="meal-k">+852</span><span class="fig-u">kcal</span>',
    );
    // A real zero is a measurement (v1 prints it too).
    expect(v2.mealBlockV2("Water", { calories: 0 })).toContain(">+0<");
    for (const calories of [null, undefined]) {
        const html = v2.mealBlockV2("Mystery", { calories, protein_g: 4 });
        expect(html).not.toContain('class="meal-k"');
        expect(html).not.toContain("kcal");
        expect(html).toContain("P 4<");
    }
});

const V2_TOTALS = { ...V2_DAY, alcohol_g: null };
const V2_GOALS_PAYLOAD = { ...V2_GOAL, alcohol_g: null };
const V2_ZERO = {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    sugar_g: 0,
    alcohol_g: null,
    caffeine_mg: null,
    water_ml: 0,
};
const V2_OVER = { ...V2_TOTALS, calories: 2690, protein_g: 230 };
const V2_MEALS = [
    {
        description: "Chicken rice bowl",
        meal_type: "lunch",
        date: null,
        calories: 852,
        protein_g: 69,
        carbs_g: 76,
        fat_g: 25,
        fiber_g: 8.6,
        sugar_g: 12.8,
        alcohol_g: null,
        caffeine_mg: 85,
    },
];

function summaryPayload(day: object, goals: object | null, date = isoDay()) {
    return {
        start_date: date,
        end_date: date,
        logged_days: 1,
        days_in_range: 1,
        drink_unit: null,
        goals,
        averages: day,
        days: [{ date, meal_count: 1, ...day }],
        meals: V2_MEALS,
    };
}

function progressPayload(totals: object, goals: object | null, extra = {}) {
    return {
        date: isoDay(),
        meal_count: 1,
        water_entries: 2,
        drink_unit: null,
        goals,
        totals,
        weight: {
            current: 82.7,
            target: 79.4,
            unit: "kg",
            logged_on: isoDay(-1),
        },
        meals: V2_MEALS,
        ...extra,
    };
}

function mealPayload(totals: object, goals: object | null, extra = {}) {
    return {
        action: "logged",
        status: "ok",
        similar_foods: [],
        date: isoDay(),
        drink_unit: null,
        logged_meal: { ...V2_MEALS[0] },
        has_goals: goals != null,
        goals,
        totals,
        meals: V2_MEALS,
        ...extra,
    };
}

async function v2Widget(key: string) {
    const html = await getWidgetHtml(key);
    // The v2 template, not the v1 fallback: only v2 tokens name this.
    expect(html).toContain("--surface-panel");
    return html;
}

test("v2 nutrition-summary: the design's day, its sample, and the edge days", async () => {
    const html = await v2Widget("nutrition-summary");

    const sample = renderWidget(html, undefined);
    expect(sample).toContain(">Today<");
    expect(sample).toContain(`>${n(1137)}<`);
    expect(sample).toContain("kcal left");

    const day = renderWidget(html, summaryPayload(V2_TOTALS, V2_GOALS_PAYLOAD));
    expect(day).toContain(">Today<");
    expect(day).toContain(`>${n(1137)}<`);
    expect(day).toContain("1.6 / 3 L");
    // Tiles a meal contributed to open the breakdown, as in v1.
    expect(day).toContain("data-macro-panel");
    expect(day).toContain('data-macro="protein_g"');

    const noGoal = renderWidget(html, summaryPayload(V2_TOTALS, null));
    expect(noGoal).toContain(`>${n(1284)}<`);
    expect(noGoal).toContain("kcal eaten");

    const over = renderWidget(html, summaryPayload(V2_OVER, V2_GOALS_PAYLOAD));
    expect(over).toContain(`>${n(269)}<`);
    expect(over).toContain("kcal over");

    const zero = renderWidget(html, summaryPayload(V2_ZERO, V2_GOALS_PAYLOAD));
    expect(zero).toContain(`>${n(2421)}<`);

    const empty = renderWidget(html, {
        ...summaryPayload(V2_ZERO, null),
        days: [],
    });
    expect(empty).toContain("No meals or water logged in this range.");

    // A past day is named, not called "Today".
    const past = renderWidget(
        html,
        summaryPayload(V2_TOTALS, V2_GOALS_PAYLOAD, "2026-11-07"),
    );
    expect(past).not.toContain(">Today<");
    expect(past).toContain("Sat 7 Nov");
});

test("v2 nutrition-summary keeps v1's range chart and logged-days count", async () => {
    const html = await v2Widget("nutrition-summary");
    const range = renderWidget(html, {
        ...summaryPayload(V2_TOTALS, V2_GOALS_PAYLOAD, "2026-07-07"),
        start_date: "2026-07-01",
        logged_days: 2,
        days_in_range: 7,
        days: [
            { date: "2026-07-07", meal_count: 2, ...V2_TOTALS },
            { date: "2026-07-05", meal_count: 3, ...V2_OVER },
        ],
    });
    expect(range).toContain("1–7 Jul");
    expect(range).toContain("2 of 7 days logged");
    expect(range).toContain("Calories / day");
    expect(range).toContain("<svg");
    expect(range).toContain("Daily average · logged days");
});

test("v2 goal-progress tip counts only goals above 0", async () => {
    const html = await v2Widget("goal-progress");
    const eaten = { ...V2_TOTALS, calories: 1000, protein_g: 40 };
    const tip = (goals: object) =>
        renderWidget(html, progressPayload(eaten, goals)).match(
            /class="tip">.*?<span>([^<]*)</,
        )?.[1];
    // No protein goal (null or 0): the tip never calls it met.
    for (const protein_g of [null, 0]) {
        const text = tip({ ...V2_GOALS_PAYLOAD, protein_g });
        expect(text).toBe(`${n(1421)} kcal to go.`);
    }
    // A calorie goal of 0 is no goal: no calorie sentence at all.
    const noCal = tip({ ...V2_GOALS_PAYLOAD, calories: 0 });
    expect(noCal).toBe(`${n(170)} g of protein to go.`);
    expect(tip({ ...V2_GOALS_PAYLOAD, calories: 0, protein_g: 0 })).toBe(
        undefined,
    );
});

test("v2 goal-progress: goal list, tip, limits, weight and the edge days", async () => {
    const html = await v2Widget("goal-progress");

    const sample = renderWidget(html, undefined);
    expect(sample).toContain("Goal progress");
    expect(sample).toContain(`${n(1284)} / ${n(2421)} kcal`);
    expect(sample).toContain(">53%<");

    const day = renderWidget(
        html,
        progressPayload(V2_TOTALS, V2_GOALS_PAYLOAD),
    );
    expect(day).toContain(">46%<");
    expect(day).toContain('class="tip"');
    expect(day).toContain(`${n(114)} g of protein`);
    // v1's limits, water and weight stay.
    expect(day).toContain(">Sugar<");
    expect(day).toContain("1.6 / 3 L");
    expect(day).toContain("3.3 kg to lose");
    // The goal list rows open the breakdown like v1's strip tiles.
    expect(day).toContain("data-macro-panel");
    expect(day).toContain('data-macro="calories"');

    const noGoal = renderWidget(html, progressPayload(V2_TOTALS, null));
    expect(noGoal).toContain("no goal");
    expect(noGoal).not.toContain('class="tip"');

    const over = renderWidget(html, progressPayload(V2_OVER, V2_GOALS_PAYLOAD));
    expect(over).toContain(`${n(269)} kcal over`);

    const empty = renderWidget(
        html,
        progressPayload(V2_ZERO, V2_GOALS_PAYLOAD, {
            meal_count: 0,
            water_entries: 0,
            weight: null,
            meals: [],
        }),
    );
    expect(empty).toContain("Nothing logged yet for today.");
});

test("v2 meal-logged: meal block over the strip, and the edge days", async () => {
    const html = await v2Widget("meal-logged");

    const sample = renderWidget(html, undefined);
    expect(sample).toContain("Logged to lunch");
    expect(sample).toContain("Chicken rice bowl");
    expect(sample).toContain(`>${n(1137)}<`);

    const day = renderWidget(html, mealPayload(V2_TOTALS, V2_GOALS_PAYLOAD));
    expect(day).toContain("Logged to lunch");
    expect(day).toContain(">+852<");
    expect(day).toContain('<span class="p">P 69</span>');
    expect(day).toContain("data-macro-panel");

    const updated = renderWidget(
        html,
        mealPayload(V2_TOTALS, V2_GOALS_PAYLOAD, { action: "updated" }),
    );
    expect(updated).toContain("Meal updated");
    // An updated meal keeps its slot on the header line, beside the day.
    expect(updated).toContain('<span class="hd-meta">lunch · today</span>');

    // No goals: nothing to show progress against, so nothing at all (v1).
    expect(renderWidget(html, mealPayload(V2_TOTALS, null))).toBe("");

    const over = renderWidget(html, mealPayload(V2_OVER, V2_GOALS_PAYLOAD));
    expect(over).toContain("kcal over");

    const zero = renderWidget(
        html,
        mealPayload(V2_ZERO, V2_GOALS_PAYLOAD, {
            logged_meal: { ...V2_MEALS[0], calories: null, meal_type: null },
            meals: [],
        }),
    );
    expect(zero).toContain("Meal logged");
    // No calorie figure on the meal: no "+0 kcal" claiming a measured zero.
    expect(zero).not.toContain('class="meal-k"');
    expect(zero).toContain(`>${n(2421)}<`);

    const similar = renderWidget(
        html,
        mealPayload(V2_TOTALS, V2_GOALS_PAYLOAD, {
            status: "similar_foods",
            logged_meal: null,
        }),
    );
    expect(similar).toContain("Not logged yet");
});

// ---- v2 trends and weight-trends ---------------------------------------------

// "2026-07-11" shifted by `delta` calendar days.
function shiftIso(date: string, delta: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
}

const TRENDS_END = "2026-07-11"; // a Saturday
const TRENDS_GOALS = {
    calories: 1600,
    protein_g: 160,
    carbs_g: 200,
    fat_g: 70,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    caffeine_mg: null,
    water_ml: null,
};

// A get_trends day: logged with `protein` grams (calories ten times that),
// or the tool's unlogged bucket (zeros, nulls) when protein is 0.
function trendsDay(date: string, protein: number) {
    const on = protein > 0;
    return {
        date,
        calories: protein * 10,
        protein_g: protein,
        carbs_g: on ? 150 : 0,
        fat_g: on ? 50 : 0,
        fiber_g: on ? 20 : null,
        sugar_g: on ? 30 : null,
        alcohol_g: null,
        caffeine_mg: null,
        water_ml: 0,
    };
}

// Thirty days ending TRENDS_END. Last seven: 140 g protein except three days
// ago (unlogged). The seven before: 70 g. The sixteen before that: nothing.
//   7d:  avg 840/7 = 120,  6/7 = 86% logged
//   14d: avg 1330/14 = 95, 13/14 = 93%
//   30d: avg 1330/30 = 44, 13/30 = 43%
// Current streak: today, yesterday, the day before = 3.
function trendsPayload(extra: Record<string, unknown> = {}) {
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const protein = i === 3 ? 0 : i < 7 ? 140 : i < 14 ? 70 : 0;
        days.push(trendsDay(shiftIso(TRENDS_END, -i), protein));
    }
    return {
        end_date: TRENDS_END,
        default_range: 7,
        drink_unit: "us",
        goals: TRENDS_GOALS,
        days,
        ...extra,
    };
}

const ringCount = (html: string) => (html.match(/class="rday/g) ?? []).length;
const pressed = (html: string) =>
    html.match(/data-range="(\d+)" aria-pressed="true"/)?.[1];

test("v2 trends: sample, and the toggle re-slices rings, averages and the streak line", async () => {
    const html = await v2Widget("trends");

    const sample = renderWidget(html, undefined);
    expect(sample).toContain(">Trends<");
    expect(ringCount(sample)).toBeGreaterThan(0);
    expect(sample).toContain("day streak");

    const w = mountWidget(html, trendsPayload());
    let out = w.html();
    expect(pressed(out)).toBe("7");
    expect(ringCount(out)).toBe(7);
    // The latest day is the one on the inset surface.
    expect(out).toMatch(/class="rday on"[^]*?<span>S<\/span><\/div><\/div>/);
    expect(out).toContain(">120 / 160<");
    expect(out).toContain(`>${n(1200)} / ${n(1600)}<`);
    expect(out).toContain('<span class="fig-v">3</span>');
    expect(out).toContain('<span class="fig-v">86%</span>');
    expect(out).toContain("7-day average · all days");

    w.clickRange(14);
    out = w.html();
    expect(pressed(out)).toBe("14");
    expect(ringCount(out)).toBe(14);
    expect(out).toContain(">95 / 160<");
    expect(out).toContain('<span class="fig-v">93%</span>');
    expect(out).toContain("14-day average · all days");

    w.clickRange(30);
    out = w.html();
    expect(pressed(out)).toBe("30");
    expect(ringCount(out)).toBe(30);
    expect(out).toContain(">44 / 160<");
    expect(out).toContain('<span class="fig-v">43%</span>');
    // The streak is today's, whatever the window.
    expect(out).toContain('<span class="fig-v">3</span>');
});

test("v2 trends: range toggle keeps the chat settings footer", async () => {
    const html = await v2Widget("trends");
    const w = await mountChatWidget(html, trendsPayload());
    expect(w.html()).toContain(WIDGET_FOOTER);
    w.clickRange(14);
    expect(w.html()).toContain(WIDGET_FOOTER);
});

test("v2 first paint replaces the loading text instead of sitting beside it", async () => {
    // A template may paint before the tool result arrives (the importer does
    // from onReady). #root then still holds the bridge's loading markup, and
    // the first mount must not leave it standing above the card.
    const ui = await partialAsInlined("shared/v2/ui.js");
    const dom = widgetRootStub();
    dom.root.innerHTML = '<div class="empty">Preparing import…</div>';
    new Function("document", `${ui}\nv2Paint('<div class="card">Card</div>');`)(
        dom.document,
    );
    expect(dom.html()).toContain("Card");
    expect(dom.html()).not.toContain("Preparing import");
});

test("v2 amount formatter: fractions, rounding, default unit, no value", async () => {
    const ui = await partialAsInlined("shared/v2/ui.js");
    const fmt = new Function(
        `${ui}\nreturn { amount: v2Amount, qty: v2Qty };`,
    )() as {
        amount: (a: unknown) => string;
        qty: (a: unknown, u?: unknown) => string;
    };
    expect(fmt.amount(0.5)).toBe("½");
    expect(fmt.amount(0.25)).toBe("¼");
    expect(fmt.amount(0.75)).toBe("¾");
    expect(fmt.amount(1.5)).toBe("1½");
    expect(fmt.amount(2)).toBe("2");
    expect(fmt.amount(0.333)).toBe("0.33");
    expect(fmt.amount("0.5")).toBe("½");
    expect(fmt.amount(null)).toBe("");
    expect(fmt.amount(undefined)).toBe("");
    expect(fmt.amount("")).toBe("");
    expect(fmt.amount("lots")).toBe("");
    expect(fmt.qty(0.5, "cup")).toBe("½ cup");
    expect(fmt.qty(2, "each")).toBe("2");
    expect(fmt.qty(200, "g")).toBe("200 g");
    expect(fmt.qty(null, "g")).toBe("g");
});

test("v2 re-rendering widgets drop the loading text and keep one footer per tool result", async () => {
    const count = (h: string, needle: string) => h.split(needle).length - 1;
    for (const [key, payload] of [
        ["trends", trendsPayload()],
        ["weight-trends", weightPayload()],
        ["import-meals", { ...IMPORT_CFG }],
    ] as const) {
        const w = await mountChatWidget(await v2Widget(key), payload);
        expect(w.html(), key).not.toContain("Loading");
        expect(count(w.html(), WIDGET_FOOTER), key).toBe(1);
        await w.redeliver(payload);
        expect(count(w.html(), WIDGET_FOOTER), key).toBe(1);
    }
});

test("v2 trends: empty payloads, and a range with missing days", async () => {
    const html = await v2Widget("trends");
    const emptyMsg = "No meals or water logged in this range yet.";
    expect(renderWidget(html, trendsPayload({ days: [] }))).toContain(emptyMsg);
    // Every bucket unlogged is empty too (v1).
    const blank = trendsPayload();
    blank.days = blank.days.map((d) => trendsDay(d.date, 0));
    expect(renderWidget(html, blank)).toContain(emptyMsg);

    // Only three of the last seven days arrive at all: the window is still
    // seven calendar days, a missing day reads as unlogged.
    const gaps = trendsPayload({
        days: [0, 2, 5].map((i) => trendsDay(shiftIso(TRENDS_END, -i), 140)),
    });
    const out = renderWidget(html, gaps);
    expect(ringCount(out)).toBe(7);
    expect(out).toContain(">60 / 160<"); // 420 / 7
    expect(out).toContain('<span class="fig-v">43%</span>'); // 3 / 7
    expect(out).toContain('<span class="fig-v">1</span>'); // today only

    // No goals: averages show the figure alone, never "/ 0".
    const noGoal = renderWidget(html, trendsPayload({ goals: null }));
    expect(noGoal).toContain(">120<");
    expect(noGoal).not.toContain(" / 0<");
});

// One decimal, the way the weight widget prints every weight.
const w1 = (x: number) =>
    x.toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });

// Weigh-ins 28, 20, 12, 5, 2 and 0 days before TRENDS_END (11 Jul).
function weightPayload(extra: Record<string, unknown> = {}) {
    const readings: [number, number][] = [
        [28, 186.0],
        [20, 185.0],
        [12, 184.0],
        [5, 183.6],
        [2, 183.0],
        [0, 182.4],
    ];
    return {
        end_date: TRENDS_END,
        unit: "lb",
        target: 175,
        default_range: 30,
        days: readings.map(([ago, weight]) => ({
            date: shiftIso(TRENDS_END, -ago),
            weight,
        })),
        ...extra,
    };
}

test("v2 weight-trends: sample, and the toggle re-slices figure, change and chart", async () => {
    const html = await v2Widget("weight-trends");

    const sample = renderWidget(html, undefined);
    expect(sample).toContain(">Weight<");
    expect(sample).toContain('class="wchart"');

    const w = mountWidget(html, weightPayload());
    let out = w.html();
    // The tool sends at most 30 days, so the toggle offers what it can fill.
    expect(out).toContain(">7d<");
    expect(out).toContain(">14d<");
    expect(out).toContain(">30d<");
    expect(out).not.toContain(">1y<");
    expect(pressed(out)).toBe("30");
    expect(out).toContain(`<span class="fig-v xl">${w1(182.4)}</span>`);
    expect(out).toContain(`↓ ${w1(3.6)} lb since Jun 13`);
    expect(out).toContain("is-ok"); // closer to the target
    expect(out).toContain(">Jun 13<");
    expect(out).toContain(">Jul 11<");
    expect(out).toContain('class="goalline"');
    expect(out).toContain(`Goal ${w1(175)} lb · ${w1(7.4)} lb to lose`);
    expect(out).toContain("6 weigh-ins");

    w.clickRange(7);
    out = w.html();
    expect(pressed(out)).toBe("7");
    expect(out).toContain(`↓ ${w1(1.2)} lb since Jul 6`);
    expect(out).toContain("3 weigh-ins");

    w.clickRange(14);
    out = w.html();
    expect(pressed(out)).toBe("14");
    expect(out).toContain(`↓ ${w1(1.6)} lb since Jun 29`);
    expect(out).toContain("4 weigh-ins");
});

test("v2 weight-trends: range toggle keeps the chat settings footer", async () => {
    const html = await v2Widget("weight-trends");
    const w = await mountChatWidget(html, weightPayload());
    expect(w.html()).toContain(WIDGET_FOOTER);
    w.clickRange(7);
    expect(w.html()).toContain(WIDGET_FOOTER);
});

test("v2 weight-trends: no target, one reading, an empty range and no data", async () => {
    const html = await v2Widget("weight-trends");

    const noTarget = renderWidget(html, weightPayload({ target: null }));
    expect(noTarget).toContain("No target set");
    expect(noTarget).not.toContain('class="goalline"');
    // No target, no direction to judge the change by: neutral.
    expect(noTarget).toMatch(/is-dim">↓/);

    const one = renderWidget(
        html,
        weightPayload({ days: [{ date: TRENDS_END, weight: 182.4 }] }),
    );
    expect(one).toContain(`<span class="fig-v xl">${w1(182.4)}</span>`);
    expect(one).toContain("need 2+ weigh-ins");
    expect(one).toContain("1 weigh-in");
    expect((one.match(/<circle/g) ?? []).length).toBe(1);

    // Nothing in the last seven days: say so, keep the toggle to widen.
    const w = mountWidget(
        html,
        weightPayload({
            default_range: 7,
            days: [
                { date: shiftIso(TRENDS_END, -20), weight: 185 },
                { date: shiftIso(TRENDS_END, -12), weight: 184 },
            ],
        }),
    );
    expect(w.html()).toContain(
        "No weigh-ins in the last 7 days. Try a wider range.",
    );
    w.clickRange(30);
    expect(w.html()).toContain(`<span class="fig-v xl">${w1(184)}</span>`);

    expect(renderWidget(html, weightPayload({ days: [] }))).toContain(
        "No weight logged in this range yet.",
    );
});

// ---- import-meals: v1 and v2 driven through one fake host ------------------

// What start_meal_import sends (the harness's payload).
const IMPORT_CFG = {
    tz: "America/Denver",
    tz_configured: true,
    today: "2026-11-09",
    max_rows_per_call: 50,
    import_tool_name: "bulk_import_meals",
    known_source_apps: ["myfitnesspal", "cronometer"],
    drink_unit: null as string | null,
    user_id: "u1",
};

type ToolArgs = { meals: Record<string, unknown>[] } & Record<string, unknown>;
type ToolReply = (args: ToolArgs) => object;

// A bulk_import_meals that accepts every row.
const acceptAll: ToolReply = (args) => ({
    structuredContent: {
        dry_run: args.dry_run,
        status: "ok",
        summary: {
            created: args.dry_run ? 0 : args.meals.length,
            deduplicated: 0,
            failed: 0,
        },
        results: [],
        warnings: [],
    },
});

const tick = async (n = 40) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

// Mount an import-meals assembly inside a fake strict host: ui/initialize is
// answered (serverTools on or off), the start_meal_import payload arrives as
// a tool-result notification, and every tools/call is recorded and answered
// by `reply`. The DOM is a stub that serves both templates: v1 wires handlers
// onto elements by id after each render, v2 listens once on #root.
async function mountImport(
    html: string,
    opts: { cfg?: object; canCallTools?: boolean; reply?: ToolReply } = {},
) {
    type Fn = (e: unknown) => unknown;
    const calls: ToolArgs[] = [];
    const contexts: string[] = [];
    const listeners: Record<string, Fn[]> = {};
    const windowListeners: Fn[] = [];
    let legacyInner = "";
    let mountEl: { id: string; innerHTML: string } | null = null;
    const footerText: string[] = [];
    const cardHtml = () =>
        mountEl ? legacyInner + mountEl.innerHTML : legacyInner;
    const root = {
        get innerHTML() {
            return cardHtml();
        },
        set innerHTML(v: string) {
            legacyInner = v;
            mountEl = null;
            footerText.length = 0;
        },
        appendChild(node: {
            id?: string;
            innerHTML?: string;
            textContent?: string;
        }) {
            if (node.id === "widget-mount") {
                mountEl = node as { id: string; innerHTML: string };
            } else if (
                node.textContent &&
                node.textContent.includes("enable or disable these widgets")
            ) {
                footerText.push(node.textContent);
            }
        },
        addEventListener: (type: string, fn: Fn) =>
            (listeners[type] ??= []).push(fn),
    };
    const els = new Map<string, Record<string, unknown>>();
    const el = (key: string) => {
        if (!els.has(key))
            els.set(key, { classList: { add() {}, remove() {} }, dataset: {} });
        return els.get(key)!;
    };
    const noop = () => {};
    const document = {
        getElementById: (id: string) => {
            if (id === "root") return root;
            if (id === "widget-mount") return mountEl;
            return cardHtml().includes(`id="${id}"`) ? el(id) : null;
        },
        querySelectorAll: (sel: string) =>
            sel === ".map-sel"
                ? [...cardHtml().matchAll(/map-sel" data-field="(\w+)"/g)].map(
                      (m) => {
                          const e = el(`map:${m[1]}`);
                          (e.dataset as Record<string, string>).field = m[1]!;
                          return e;
                      },
                  )
                : [],
        documentElement: {
            setAttribute: noop,
            style: {} as object,
            getBoundingClientRect: () => ({ height: 100 }),
        },
        body: {},
        addEventListener: noop,
        createElement: () => ({
            id: "",
            innerHTML: "",
            textContent: "",
            style: {} as object,
        }),
    };
    const deliver = (data: object) =>
        setTimeout(() => {
            for (const fn of windowListeners) fn({ source: host, data });
        }, 0);
    const host = {
        postMessage(msg: {
            id?: string;
            method: string;
            params: {
                name?: string;
                arguments?: ToolArgs;
                content?: { text: string }[];
            };
        }) {
            const { id, method, params } = msg;
            if (method === "ui/initialize")
                deliver({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        hostCapabilities:
                            opts.canCallTools === false
                                ? {}
                                : { serverTools: {} },
                        hostContext: { theme: "dark" },
                    },
                });
            else if (method === "ui/notifications/initialized")
                deliver({
                    jsonrpc: "2.0",
                    method: "ui/notifications/tool-result",
                    params: {
                        structuredContent: { ...IMPORT_CFG, ...opts.cfg },
                    },
                });
            else if (method === "tools/call") {
                const args = structuredClone(params.arguments!);
                calls.push(args);
                deliver({
                    jsonrpc: "2.0",
                    id,
                    result: (opts.reply ?? acceptAll)(structuredClone(args)),
                });
            } else if (method === "ui/update-model-context") {
                contexts.push(params.content![0]!.text);
                deliver({ jsonrpc: "2.0", id, result: {} });
            }
        },
    };
    const window: Record<string, unknown> = {
        addEventListener: (type: string, fn: Fn) => {
            if (type === "message") windowListeners.push(fn);
        },
        innerWidth: 400,
        parent: host,
    };
    for (const script of widgetScriptBodies(html)) {
        new Function("window", "document", script)(window, document);
    }
    await tick();

    const v2 = html.includes("--surface-panel");
    const fire = (type: string, target: object) => {
        for (const fn of listeners[type] ?? []) fn({ target });
    };
    const ctl = (name: string, extra: object) => ({
        dataset: { ctl: name },
        closest: () => null,
        ...extra,
    });
    // v1 ids for each v2 data-act.
    const V1_IDS: Record<string, string> = {
        preview: "toPreview",
        import: "doImport",
        "back-map": "backToMap",
        "back-file": "backToFile",
        restart: "restart",
    };
    const handler = (id: string, name: string) => {
        const e = document.getElementById(id) as Record<string, Fn> | null;
        if (!e || typeof e[name] !== "function")
            throw new Error(`v1 has no ${name} on #${id}`);
        return e[name]!;
    };
    const redeliver = async (cfg: object = {}) => {
        deliver({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: {
                structuredContent: { ...IMPORT_CFG, ...opts.cfg, ...cfg },
            },
        });
        await tick();
    };
    return {
        calls,
        contexts,
        html: () => cardHtml() + footerText.join(""),
        redeliver,
        async chooseFile(name: string, text: string) {
            const file = {
                name,
                arrayBuffer: async () => new TextEncoder().encode(text).buffer,
            };
            if (v2) fire("change", ctl("file", { files: [file] }));
            else handler("file", "onchange")({ target: { files: [file] } });
            await tick();
        },
        async click(act: string) {
            if (v2) {
                const button = { dataset: { act } };
                fire("click", { closest: () => button, dataset: {} });
            } else handler(V1_IDS[act]!, "onclick")({});
            await tick();
        },
        mapField(field: string, index: number) {
            if (v2)
                fire(
                    "change",
                    ctl("map", {
                        dataset: { ctl: "map", field },
                        value: String(index),
                    }),
                );
            else
                (el(`map:${field}`).onchange as Fn)({
                    target: { dataset: { field }, value: String(index) },
                });
        },
        choose(name: "dateFormat" | "energyUnit", value: string) {
            if (v2) fire("change", ctl(name, { value }));
            else handler(name, "onchange")({ target: { value } });
        },
        sourceApp(value: string) {
            if (v2) fire("input", ctl("srcapp", { value }));
            else handler("srcapp", "oninput")({ target: { value } });
        },
    };
}

// Five exports the widget must turn into the same server calls in v1 and v2.
const mfpCsv = [
    "Date,Meal,Calories,Fat (g),Saturated Fat,Carbohydrates (g),Protein (g),Note",
    ...Array.from({ length: 64 }, (_, i) => {
        const day = String(1 + Math.floor(i / 4)).padStart(2, "0");
        const meal = ["Breakfast", "Lunch", "Dinner", "Snacks"][i % 4];
        return `2026-10-${day},${meal},${300 + i},${10 + (i % 7)},2,${40 + (i % 9)},${20 + (i % 5)},${i % 6 === 0 ? '"late, tired"' : ""}`;
    }),
    "TOTAL:,,20000,700,128,2800,1400,",
].join("\r\n");

const cronoKjCsv = [
    "Day,Time,Group,Food Name,Amount,Energy (kJ),Carbs (g),Fat (g),Protein (g),Fiber (g),Sugars (g),Caffeine (mg),Alcohol (g)",
    "2026-11-01,9:15 AM,Breakfast,Oats,80 g,1250,54,6,11,8,1.2,,",
    "2026-11-01,1:05 PM,Lunch,Chicken bowl,1 bowl,3565,76,25,69,8.6,12.8,,",
    "2026-11-01,,Snacks,Espresso,1 cup,8,0,0,0.1,,,64,",
    "2026-11-02,7:40 PM,Dinner,Red wine,150 ml,520,4,0,0.1,,0.9,,14",
];

// Day-first or month-first cannot be told apart; the user picks day-first.
// It also carries an added-sugar column, a caffeine-in-grams column, an
// alcohol column with tracking off, and one unreadable date.
const ambiguousCsv = [
    "Date,Food,Calories,Added Sugar (g),Caffeine (g),Alcohol",
    "05/06/2026 08:30,Toast,210,3,,",
    "06/05/2026 12:00,Soup,340,1,,",
    "07/06/2026,Cola,140,35,0.03,",
    "08/06/2026 21:00,Beer,150,,,13",
    "garbage,Mystery,99,,,",
];

const ownExportCsv = [
    "id,logged_at,timezone,meal_type,description,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,alcohol_g,caffeine_mg,notes",
    "6f1c8f3e-2a4b-4c5d-8e9f-0a1b2c3d4e5f,2026-11-03 08:05:00,Europe/Kyiv,breakfast,Overnight oats,432,27,42,17,9.4,18.2,,95,",
    "7a2d9f4e-3b5c-4d6e-9fa0-1b2c3d4e5f60,2026-11-03 13:10:00,Europe/Kyiv,lunch,Chicken rice bowl,852,69,76,25,8.6,12.8,0,85,with extra rice",
];

const loseItCsv = [
    "Date,Name,Type,Quantity,Units,Calories,Fat (g),Protein (g),Carbohydrates (g),Deleted",
    "11/02/2026,Banana,Breakfast,1,Each,105,0.4,1.3,27,false",
    "11/02/2026,Pizza,Dinner,2,Slice,570,24,24,66,true",
    "11/03/2026,Apple,Snacks,1,Each,95,0.3,0.5,25,false",
];

// "Energy (kJ)" is no calories alias, so the user maps it; the remap re-reads
// the unit from the header.
const mapKj = (w: Awaited<ReturnType<typeof mountImport>>) =>
    w.mapField("calories", 5);

type ImportScenario = {
    name: string;
    file: string;
    text: string;
    cfg?: object;
    steps?: (w: Awaited<ReturnType<typeof mountImport>>) => void;
};
const IMPORT_SCENARIOS: ImportScenario[] = [
    {
        name: "myfitnesspal, 64 rows over 16 days",
        file: "mfp.csv",
        text: mfpCsv,
    },
    {
        name: "cronometer in kJ, alcohol tracked",
        file: "crono.csv",
        text: cronoKjCsv.join("\n"),
        cfg: { drink_unit: "us" },
        steps: mapKj,
    },
    {
        name: "cronometer in kJ, alcohol off",
        file: "crono.csv",
        text: cronoKjCsv.join("\n"),
        steps: mapKj,
    },
    {
        name: "ambiguous dates read day-first, source app typed",
        file: "diary.csv",
        text: ambiguousCsv.join("\n"),
        steps: (w) => {
            w.choose("dateFormat", "dmy");
            w.sourceApp("myapp");
        },
    },
    {
        name: "our own export, by id and timezone",
        file: "meals.csv",
        text: ownExportCsv.join("\n"),
    },
    {
        name: "lose it, deleted rows, calories remapped",
        file: "loseit.csv",
        text: loseItCsv.join("\n"),
        steps: (w) => {
            w.mapField("calories", 5);
            w.mapField("notes", 4);
            w.choose("energyUnit", "kj");
        },
    },
];

async function runImportScenario(html: string, s: ImportScenario) {
    const w = await mountImport(html, { cfg: s.cfg });
    await w.chooseFile(s.file, s.text);
    s.steps?.(w);
    await w.click("preview");
    await w.click("import");
    return w;
}

test.each(IMPORT_SCENARIOS.map((s) => [s.name, s] as const))(
    "import-meals v2 sends v1's bulk_import_meals arguments: %s",
    async (_name, s) => {
        const v1 = await runImportScenario(
            await getWidgetHtml("import-meals"),
            s,
        );
        const v2 = await runImportScenario(await v2Widget("import-meals"), s);
        expect(v1.calls.length).toBeGreaterThan(1);
        expect(JSON.stringify(v2.calls)).toBe(JSON.stringify(v1.calls));
        expect(v2.contexts).toEqual(v1.contexts);
    },
);

test("import-meals v2: step changes keep the chat settings footer", async () => {
    const count = (h: string, needle: string) => h.split(needle).length - 1;
    const w = await mountImport(await v2Widget("import-meals"));
    expect(count(w.html(), WIDGET_FOOTER)).toBe(1);
    await w.chooseFile("meals.csv", "Date,Food,Calories\n2026-07-01,Oats,100");
    expect(count(w.html(), WIDGET_FOOTER)).toBe(1);
    await w.click("back-file");
    expect(count(w.html(), WIDGET_FOOTER)).toBe(1);
    await w.redeliver();
    expect(w.html()).not.toContain("Preparing import");
    expect(count(w.html(), WIDGET_FOOTER)).toBe(1);
});

test("import-meals v2: a MyFitnessPal export auto-maps and previews its counts", async () => {
    const w = await mountImport(await v2Widget("import-meals"));
    expect(w.html()).toContain("Step 1 of 4");
    expect(w.html()).toContain('data-ctl="file"');
    await w.chooseFile("mfp-export.csv", mfpCsv);
    const map = w.html();
    expect(map).toContain("Step 2 of 4");
    expect(map).toContain("64 rows · 8 columns · utf-8, delimiter ,");
    // Recognised columns are pre-selected; the source app is guessed.
    const selected = (field: string) =>
        new RegExp(
            `data-field="${field}"><option[^]*?<option value="(\\d+)" selected`,
        ).exec(map)?.[1];
    expect(selected("logged_at")).toBe("0");
    expect(selected("meal_type")).toBe("1");
    expect(selected("calories")).toBe("2");
    expect(selected("protein_g")).toBe("6");
    expect(map).toContain('value="myfitnesspal"');
    // Alcohol tracking is off, so no alcohol row is offered.
    expect(map).not.toContain('data-field="alcohol_g"');

    await w.click("preview");
    const pv = w.html();
    expect(pv).toContain("Step 3 of 4");
    expect(pv).toContain("64 meals · Oct 2026<");
    expect(pv).toContain("Date → Date / time");
    expect(pv).toContain("1 rows skipped · 2 batches");
    expect(pv).toContain("Times read in <b>America/Denver</b>");
    expect(pv).toContain("Showing 30 of 64 rows");
    expect(pv).toContain(">Import 64 meals<");
    expect(pv).toContain('<span class="row-s">Oct 1</span>');
});

test("import-meals v2: ambiguous dates prompt, and day-first is applied once chosen", async () => {
    const w = await mountImport(await v2Widget("import-meals"));
    await w.chooseFile("diary.csv", ambiguousCsv.join("\n"));
    const map = w.html();
    expect(map).toContain("could not be determined from this file");
    // Added sugar, caffeine in grams and alcohol-while-off all say why.
    expect(map).toContain("added-sugar column (Added Sugar (g))");
    expect(map).toContain("caffeine column (Caffeine (g)) is in grams");
    expect(map).toContain(
        "alcohol column (Alcohol), but alcohol tracking is off",
    );
    w.choose("dateFormat", "dmy");
    expect(w.html()).not.toContain("could not be determined");
    expect(w.html()).toContain("05/06/2026 08:30 → 2026-06-05 08:30");
    await w.click("preview");
    expect(w.html()).toContain(
        "1 row(s) were skipped because their date could not be read as Day/Month/Year (e.g. line 6: garbage)",
    );
    expect(w.html()).toContain("Details for a bug report");
    await w.click("import");
    const sent = w.calls[0]!.meals;
    expect(sent.map((m) => m.logged_at)).toEqual([
        "2026-06-05 08:30",
        "2026-05-06 12:00",
        "2026-06-07",
        "2026-06-08 21:00",
    ]);
    expect(sent.every((m) => m.alcohol_g === undefined)).toBe(true);
    expect(sent.every((m) => m.caffeine_mg === undefined)).toBe(true);
});

test("import-meals v2: a kJ column converts to kcal in the example and the rows", async () => {
    const w = await mountImport(await v2Widget("import-meals"), {
        cfg: { drink_unit: "us" },
    });
    await w.chooseFile("crono.csv", cronoKjCsv.join("\n"));
    mapKj(w);
    expect(w.html()).toContain("1250 kJ → 299 kcal");
    await w.click("preview");
    expect(w.html()).toContain("energy converted from kJ to kcal");
    await w.click("import");
    const sent = w.calls[0]!.meals;
    expect(sent.map((m) => m.calories)).toEqual([299, 852, 2, 124]);
    expect(sent.map((m) => m.logged_at)).toEqual([
        "2026-11-01 09:15",
        "2026-11-01 13:05",
        "2026-11-01",
        "2026-11-02 19:40",
    ]);
    expect(sent[3]!.alcohol_g).toBe(14);
    expect(w.calls[0]!.expected_total_kcal).toBe(1277);
});

test("import-meals v2: imports, reports the counts, and tells the model", async () => {
    const w = await mountImport(await v2Widget("import-meals"));
    await w.chooseFile("mfp-export.csv", mfpCsv);
    await w.click("preview");
    await w.click("import");
    // Dry run of the first chunk, then each chunk for real.
    expect(w.calls.map((c) => c.dry_run)).toEqual([true, false, false]);
    const done = w.html();
    expect(done).toContain(">Done<");
    expect(done).toContain("64 meals imported");
    expect(done).toContain(
        '<span class="row-t">Imported</span><span class="row-end">64</span>',
    );
    expect(done).not.toContain("Details for a bug report");
    expect(w.contexts).toEqual([
        "Bulk meal import finished: 64 meals imported, 0 already logged, 0 failed, 1 rows skipped. Source: mfp-export.csv.",
    ]);
});

test("import-meals v2: a failed result shows the per-row report", async () => {
    const failing: ToolReply = (args) => ({
        structuredContent: {
            dry_run: args.dry_run,
            status: args.dry_run ? "ok" : "partial",
            summary: { created: 1, deduplicated: 1, failed: 1 },
            results: [
                {
                    source_line: 3,
                    error: { message: "calories <out of range>" },
                },
            ],
            warnings: ["Timezone not set; times read as UTC."],
        },
    });
    const w = await mountImport(await v2Widget("import-meals"), {
        reply: failing,
    });
    await w.chooseFile("meals.csv", ownExportCsv.join("\n"));
    await w.click("preview");
    expect(w.html()).toContain("each row&#39;s own timezone column");
    await w.click("import");
    const done = w.html();
    expect(done).toContain('class="disc warn"');
    expect(done).toContain(
        '<span class="row-s">Line 3</span><span class="row-t is-over">calories &lt;out of range&gt;</span>',
    );
    expect(done).toContain("Timezone not set; times read as UTC.");
    expect(done).toContain("Details for a bug report");
    expect(done).toContain(
        "first error, line 3: calories &lt;out of range&gt;",
    );

    // A failed dry run writes nothing and stays on the preview, saying why.
    const pre = await mountImport(await v2Widget("import-meals"), {
        reply: (args) => ({
            structuredContent: {
                dry_run: args.dry_run,
                status: "failed",
                summary: { created: 0, deduplicated: 0, failed: 2 },
                results: [{ source_line: 2, error: { message: "bad date" } }],
                warnings: ["expected_row_count mismatch"],
            },
        }),
    });
    await pre.chooseFile("meals.csv", ownExportCsv.join("\n"));
    await pre.click("preview");
    await pre.click("import");
    expect(pre.calls.map((c) => c.dry_run)).toEqual([true]);
    expect(pre.html()).toContain("Rows 2–3: expected_row_count mismatch");
    expect(pre.html()).toContain("1 row(s) would fail, e.g. line 2: bad date");
    expect(pre.html()).toContain("Step 3 of 4");
});

test("import-meals v2: without host tool calls it asks for Claude instead", async () => {
    const w = await mountImport(await v2Widget("import-meals"), {
        canCallTools: false,
        cfg: { tz_configured: false },
    });
    expect(w.html()).toContain("Ask Claude to import the file instead");
    expect(w.html()).toContain("Your timezone is not set");
    await w.chooseFile("mfp-export.csv", mfpCsv);
    await w.click("preview");
    expect(w.html()).toMatch(/data-act="import" disabled/);
    await w.click("import");
    expect(w.calls).toEqual([]);
});

test("import-meals v2: file names and cells reach the markup escaped", async () => {
    const w = await mountImport(await v2Widget("import-meals"));
    await w.chooseFile(
        '"><img src=x onerror=alert(1)>.csv',
        'Date,Food,Calories\n2026-11-01,"<script>x</script>",100\n',
    );
    await w.click("preview");
    await w.click("restart");
    await w.chooseFile(
        '"><img src=x onerror=alert(1)>.csv',
        'Date,"<b onclick=x>",Calories\n2026-11-01,"<script>x</script>",100\n',
    );
    const map = w.html();
    expect(map).not.toContain("<img");
    expect(map).not.toContain("<b onclick");
    await w.click("preview");
    expect(w.html()).not.toContain("<script>");
    expect(w.html()).not.toContain("<img");
});

// ---- attention v2 -----------------------------------------------------------

type DismissArgs = {
    code: string;
    subject_kind: string;
    subject_id: string;
    related_id?: string | null;
};

async function mountAttention(
    html: string,
    opts: {
        data: { count: number; notices: object[] };
        canCallTools?: boolean;
        /** Test-only: click handler still respects aria-disabled unless set. */
        bypassAriaDisabled?: boolean;
        reply?: (args: DismissArgs) =>
            | {
                  structuredContent: { dismissed: boolean };
                  content?: { type: string; text: string }[];
              }
            | Promise<{
                  structuredContent: { dismissed: boolean };
                  content?: { type: string; text: string }[];
              }>;
    },
) {
    type Fn = (e: unknown) => void;
    const calls: DismissArgs[] = [];
    const listeners: Record<string, Fn[]> = {};
    const windowListeners: Fn[] = [];
    const dom = widgetRootStub((fn) => (listeners.click ??= []).push(fn));
    const { root, document } = dom;
    const noop = () => {};
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const deliver = (data: object) => {
        for (const fn of windowListeners) fn({ source: host, data });
    };
    const host = {
        postMessage(msg: {
            id?: number;
            method: string;
            params: { name?: string; arguments?: DismissArgs };
        }) {
            const { id, method, params } = msg;
            if (method === "ui/initialize") {
                deliver({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        hostCapabilities:
                            opts.canCallTools === false
                                ? {}
                                : { serverTools: {} },
                        hostContext: { theme: "light" },
                    },
                });
            } else if (method === "ui/notifications/initialized") {
                deliver({
                    jsonrpc: "2.0",
                    method: "ui/notifications/tool-result",
                    params: { structuredContent: opts.data },
                });
            } else if (
                method === "tools/call" &&
                params.name === "dismiss_notice"
            ) {
                const args = structuredClone(params.arguments!);
                calls.push(args);
                void (async () => {
                    const out = (await opts.reply?.(args)) ?? {
                        structuredContent: { dismissed: true },
                        content: [{ type: "text", text: "Notice dismissed." }],
                    };
                    deliver({
                        jsonrpc: "2.0",
                        id,
                        result: {
                            content: out.content ?? [
                                { type: "text", text: "ok" },
                            ],
                            structuredContent: out.structuredContent,
                        },
                    });
                })();
            }
        },
    };
    const window: Record<string, unknown> = {
        parent: host,
        innerWidth: 400,
        postMessage: (msg: unknown) =>
            (host.postMessage as (m: unknown) => void)(msg),
        addEventListener: (type: string, fn: Fn) => {
            if (type === "message") windowListeners.push(fn);
        },
        removeEventListener: noop,
    };
    for (const script of widgetScriptBodies(html)) {
        new Function("window", "document", script)(window, document);
    }
    await tick();
    await tick();
    const mount = {
        html: dom.html,
        calls,
        clickDismissKey(key: string) {
            for (const fn of listeners.click ?? []) {
                fn({
                    preventDefault: noop,
                    target: {
                        closest: (sel: string) =>
                            sel === "button.act"
                                ? {
                                      disabled: false,
                                      getAttribute: (n: string) => {
                                          if (n === "data-dismiss-key")
                                              return key;
                                          if (n === "aria-disabled") {
                                              if (opts.bypassAriaDisabled)
                                                  return "false";
                                              const re = new RegExp(
                                                  `data-dismiss-key="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*aria-disabled="([^"]+)"`,
                                              );
                                              const m = dom.html().match(re);
                                              return m ? m[1]! : "false";
                                          }
                                          return null;
                                      },
                                  }
                                : null,
                    },
                });
            }
        },
        async dismissKey(key: string) {
            mount.clickDismissKey(key);
            for (let i = 0; i < 8; i++) await tick();
        },
        async doubleDismissKey(key: string) {
            mount.clickDismissKey(key);
            mount.clickDismissKey(key);
            for (let i = 0; i < 12; i++) await tick();
        },
    };
    return mount;
}

const ATTENTION_DISMISS_A = "fridge.expiring|fridge_item|fi-1|";
const ATTENTION_DISMISS_B = "fridge.expiring|fridge_item|fi-2|";

const ATTENTION_SAMPLE = {
    count: 2,
    notices: [
        {
            code: "fridge.expiring",
            severity: "info",
            subject: {
                kind: "fridge_item",
                id: "fi-1",
                recipe_id: null,
            },
            related: [],
            message: "Test &lt;img&gt;",
            action: null,
            title: "Baby <img> spinach",
            detail: "tomorrow",
            detail_tone: "over",
            group_key: "expiring",
            group_label: "Expiring",
            dot_tone: "over",
            can_dismiss: true,
            dismiss_label: "Dismiss",
            dismiss: {
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: "fi-1",
                related_id: null,
            },
        },
        {
            code: "fridge.expiring",
            severity: "info",
            subject: {
                kind: "fridge_item",
                id: "fi-2",
                recipe_id: null,
            },
            related: [],
            message: "Second item",
            action: null,
            title: "Second row",
            detail: "2 days",
            detail_tone: "warn",
            group_key: "expiring",
            group_label: "Expiring",
            dot_tone: "warn",
            can_dismiss: true,
            dismiss_label: "Dismiss",
            dismiss: {
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: "fi-2",
                related_id: null,
            },
        },
    ],
};

test("attention v2 sample renders grouped rows", async () => {
    const html = await v2Widget("attention");
    const body = renderWidget(html, ATTENTION_SAMPLE);
    expect(body).toContain("Expiring");
    expect(body).not.toContain("Salmon");
    expect(body).toContain("Baby &lt;img&gt; spinach");
});

test("attention v2: Dismiss success keeps the chat settings footer", async () => {
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
    });
    expect(w.html()).toContain(WIDGET_FOOTER);
    await w.dismissKey(ATTENTION_DISMISS_A);
    expect(w.html()).toContain(WIDGET_FOOTER);
});

test("attention v2: Dismiss calls dismiss_notice and removes the row", async () => {
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
    });
    expect(w.html()).toContain('class="act"');
    await w.dismissKey(ATTENTION_DISMISS_A);
    expect(w.calls[0]).toEqual({
        code: "fridge.expiring",
        subject_kind: "fridge_item",
        subject_id: "fi-1",
    });
    expect(w.html()).not.toContain("Baby &lt;img&gt; spinach");
    expect(w.html()).toContain("Second row");
    expect(w.html()).toContain('class="hd-meta">1</span>');
});

test("attention v2: rapid double Dismiss removes only the targeted row", async () => {
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
        bypassAriaDisabled: true,
    });
    await w.doubleDismissKey(ATTENTION_DISMISS_A);
    expect(w.calls.length).toBe(1);
    expect(w.calls[0]?.subject_id).toBe("fi-1");
    expect(w.html()).not.toContain("Baby &lt;img&gt; spinach");
    expect(w.html()).toContain("Second row");
});

test("attention v2: Dismiss is aria-disabled while the call is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
        reply: async () => {
            await gate;
            return {
                structuredContent: { dismissed: true },
                content: [{ type: "text", text: "Notice dismissed." }],
            };
        },
    });
    w.clickDismissKey(ATTENTION_DISMISS_A);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.html()).toMatch(
        new RegExp(
            `data-dismiss-key="${ATTENTION_DISMISS_A.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*aria-disabled="true"`,
        ),
    );
    release();
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
});

afterEach(() => {
    jest.useRealTimers();
    setSystemTime();
});

test("attention v2: after a fast dismiss, settle window blocks the next row", async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
    });
    await w.dismissKey(ATTENTION_DISMISS_A);
    expect(w.calls.length).toBe(1);
    setSystemTime(t0 + 100);
    w.clickDismissKey(ATTENTION_DISMISS_B);
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    expect(w.calls.length).toBe(1);
    setSystemTime(t0 + 500);
    await w.dismissKey(ATTENTION_DISMISS_B);
    expect(w.calls.length).toBe(2);
    expect(w.calls[1]?.subject_id).toBe("fi-2");
});

test("attention v2: a failed dismiss keeps the row and shows the error", async () => {
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
        reply: () => ({
            structuredContent: { dismissed: false },
            content: [{ type: "text", text: "Could not dismiss." }],
        }),
    });
    await w.dismissKey(ATTENTION_DISMISS_A);
    expect(w.html()).toContain("Baby &lt;img&gt; spinach");
    const html = w.html();
    expect(html).toContain('class="err note is-warn"');
    expect(html).toMatch(
        /<div class="row-wrap"[^>]*>[\s\S]*?<div class="row"[\s\S]*?<\/div>\s*<p class="err note is-warn">Could not dismiss\.<\/p>/,
    );
});

test("attention v2: empty filter copy when count is positive", async () => {
    const html = await v2Widget("attention");
    const body = renderWidget(html, { count: 3, notices: [] });
    expect(body).toContain("Nothing matches this filter.");
});

test("attention v2: urgency detail tone without toning stock detail", async () => {
    const html = await v2Widget("attention");
    const body = renderWidget(html, {
        count: 2,
        notices: [
            {
                ...ATTENTION_SAMPLE.notices[0],
                detail: "9 left",
                detail_tone: null,
                dot_tone: "warn",
            },
            ATTENTION_SAMPLE.notices[1],
        ],
    });
    expect(body).toContain("9 left");
    expect(body).not.toContain('row-s is-warn">9 left');
    expect(body).not.toContain('row-s is-over">9 left');
    expect(body).toContain('row-s is-warn">2 days');
});

test("attention v2: canCallTools false hides every Dismiss", async () => {
    const w = await mountAttention(await v2Widget("attention"), {
        data: ATTENTION_SAMPLE,
        canCallTools: false,
    });
    expect(w.html()).not.toContain('class="act"');
});

test("attention v2: notice text is escaped", async () => {
    const html = await v2Widget("attention");
    const body = renderWidget(html, ATTENTION_SAMPLE);
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img&gt;");
});

// ---- grocery-list and fridge v2 ---------------------------------------------

type TickArgs = { id: string; checked: boolean };

async function mountGrocery(
    html: string,
    opts: {
        data: object;
        canCallTools?: boolean;
        reply?: (args: TickArgs) => Promise<void> | void;
    },
) {
    type Fn = (e: unknown) => void;
    const calls: TickArgs[] = [];
    const listeners: Fn[] = [];
    const windowListeners: Fn[] = [];
    const dom = widgetRootStub((fn) => listeners.push(fn));
    const noop = () => {};
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // Focus, as a browser keeps it: set by focus(), and lost to <body> when
    // the mount's markup is replaced.
    let active: { sel: string; id: string } | null = null;
    const fakeEl = (sel: string, id: string) => {
        const row = { getAttribute: () => id };
        const el = {
            closest: (s: string) =>
                s === sel
                    ? el
                    : s === "[data-line-id]" && sel === "button.check"
                      ? row
                      : null,
            getAttribute: (n: string) =>
                sel === "button.chip" && n === "data-store" ? id : null,
            focus: () => {
                active = { sel, id };
            },
        };
        return el;
    };
    let mountHtml = "";
    const mount = {
        id: "",
        textContent: "",
        style: {},
        get innerHTML() {
            return mountHtml;
        },
        set innerHTML(v: string) {
            mountHtml = v;
            active = null;
        },
        querySelectorAll(sel: string) {
            const re =
                sel === "button.chip"
                    ? /class="chip"[^>]*data-store="([^"]+)"/g
                    : /data-line-id="([^"]+)"[^>]*><button type="button" class="check/g;
            return [...mountHtml.matchAll(re)].map((m) => fakeEl(sel, m[1]!));
        },
    };
    dom.document.createElement = () => mount as never;
    Object.defineProperty(dom.document, "activeElement", {
        get: () => (active ? fakeEl(active.sel, active.id) : {}),
    });
    const deliver = (data: object) => {
        for (const fn of windowListeners) fn({ source: host, data });
    };
    const host = {
        postMessage(msg: {
            id?: number;
            method: string;
            params: { name?: string; arguments?: TickArgs };
        }) {
            const { id, method, params } = msg;
            if (method === "ui/initialize") {
                deliver({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        hostCapabilities:
                            opts.canCallTools === false
                                ? {}
                                : { serverTools: {} },
                        hostContext: { theme: "light" },
                    },
                });
            } else if (method === "ui/notifications/initialized") {
                deliver({
                    jsonrpc: "2.0",
                    method: "ui/notifications/tool-result",
                    params: { structuredContent: opts.data },
                });
            } else if (
                method === "tools/call" &&
                params.name === "check_grocery_line"
            ) {
                const args = structuredClone(params.arguments!);
                calls.push(args);
                void (async () => {
                    try {
                        await opts.reply?.(args);
                        deliver({
                            jsonrpc: "2.0",
                            id,
                            result: {
                                content: [{ type: "text", text: "Checked." }],
                            },
                        });
                    } catch (e) {
                        deliver({
                            jsonrpc: "2.0",
                            id,
                            error: { code: -32603, message: String(e) },
                        });
                    }
                })();
            }
        },
    };
    const window: Record<string, unknown> = {
        parent: host,
        innerWidth: 400,
        postMessage: (msg: unknown) =>
            (host.postMessage as (m: unknown) => void)(msg),
        addEventListener: (type: string, fn: Fn) => {
            if (type === "message") windowListeners.push(fn);
        },
        removeEventListener: noop,
    };
    for (const script of widgetScriptBodies(html)) {
        new Function("window", "document", script)(window, dom.document);
    }
    await tick();
    await tick();
    const click = (target: unknown) => {
        for (const fn of listeners) fn({ preventDefault: noop, target });
    };
    return {
        html: dom.html,
        calls,
        /** Tap the tick on the row for `id`, as a real click inside the row does. */
        tapTick(id: string) {
            click({
                closest: (sel: string) =>
                    sel === "button.check"
                        ? {
                              closest: (rowSel: string) =>
                                  rowSel === "[data-line-id]"
                                      ? { getAttribute: () => id }
                                      : null,
                          }
                        : null,
            });
        },
        /** Give keyboard focus to the tick or store chip, as Tab would. */
        focusTick(id: string) {
            fakeEl("button.check", id).focus();
        },
        focusStore(id: string) {
            fakeEl("button.chip", id).focus();
        },
        /** What holds focus now: "check:<line id>", "chip:<store id>" or "body". */
        focused: () => (active ? `${active.sel}:${active.id}` : "body"),
        /** A later tool result reaching the card, as a re-run of the tool does. */
        pushResult(data: object) {
            deliver({
                jsonrpc: "2.0",
                method: "ui/notifications/tool-result",
                params: { structuredContent: data },
            });
        },
        tapStore(storeId: string) {
            click({
                closest: (sel: string) =>
                    sel === "button.chip"
                        ? { getAttribute: () => storeId }
                        : null,
            });
        },
        async settle() {
            for (let i = 0; i < 10; i++) await tick();
        },
    };
}

function groceryLine(over: Record<string, unknown>) {
    return {
        id: "ln-1",
        store_id: "st-1",
        section_id: "sec-1",
        display_name: "Milk",
        amount: 1,
        unit: "gal",
        checked: false,
        source: "manual",
        source_fridge_item_id: null,
        note: null,
        already_have: null,
        store: "Costco",
        product_name: null,
        usual: false,
        product: null,
        notices: [],
        ...over,
    };
}

const GROCERY_DATA = {
    stores: [
        {
            id: "st-1",
            name: "Costco",
            sections: [
                {
                    id: "sec-1",
                    name: "Dairy",
                    lines: [
                        groceryLine({
                            id: "ln-1",
                            product_name: "Kirkland 2% milk",
                            usual: true,
                        }),
                        groceryLine({
                            id: "ln-2",
                            display_name: "Eggs",
                            amount: 24,
                            unit: "each",
                            checked: true,
                        }),
                    ],
                },
            ],
        },
        {
            id: "st-2",
            name: "Trader <Joe's>",
            sections: [
                {
                    id: "sec-2",
                    name: "Fish",
                    lines: [
                        groceryLine({
                            id: "ln-3",
                            store_id: "st-2",
                            section_id: "sec-2",
                            display_name: "Salmon",
                            amount: 1,
                            unit: "lb",
                        }),
                    ],
                },
            ],
        },
    ],
};

test("grocery-list v2: the card groups by store with usual tags, amounts and the count to get", async () => {
    const html = await v2Widget("grocery-list");
    const body = renderWidget(html, GROCERY_DATA);
    expect(body).toContain('class="hd-title">Groceries<');
    expect(body).toContain('class="hd-meta">2 to get<');
    expect(body).toContain('aria-pressed="true" data-store="st-1">Costco');
    // Chips count what is still to get, as the header does: one each.
    expect(body.match(/<span class="chip-n">1<\/span>/g)?.length).toBe(2);
    expect(body).toContain("Trader &lt;Joe&#39;s&gt;");
    expect(body).toContain(">Kirkland 2% milk<");
    expect(body).toContain('<span class="tag">usual</span>');
    expect(body).toContain('class="row-end">1 gal<');
    // "each" is the default unit: the bare count, as the design shows.
    expect(body).toContain('class="row-end">24<');
    expect(body).toContain('class="row done"');
    // The second store's lines stay behind its chip.
    expect(body).not.toContain("Salmon");
    // The sample (no host) renders the design's list.
    const sample = renderWidget(html, undefined);
    expect(sample).toContain("Vital Farms large eggs");
    expect(sample).toContain("California Olive Ranch");
});

test("grocery-list v2: without canCallTools no line can be ticked", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
        canCallTools: false,
    });
    expect(w.html()).toContain(">Kirkland 2% milk<");
    expect(w.html()).not.toContain('class="check');
    expect(w.html()).toContain("Tick items off in the app.");
    w.tapTick("ln-1");
    await w.settle();
    expect(w.calls).toEqual([]);
});

test("grocery-list v2: ticking calls check_grocery_line with the line id and updates the row", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
    });
    expect(w.html()).toContain('class="check"');
    expect(w.html()).toContain('class="hd-meta">2 to get<');
    w.tapTick("ln-1");
    await w.settle();
    expect(w.calls).toEqual([{ id: "ln-1", checked: true }]);
    expect(w.html()).toContain('class="hd-meta">1 to get<');
    expect(w.html()).not.toContain('data-busy="true"');
    // Ticking again unticks: the tool is idempotent and takes the new state.
    w.tapTick("ln-1");
    await w.settle();
    expect(w.calls[1]).toEqual({ id: "ln-1", checked: false });
    expect(w.html()).toContain('class="hd-meta">2 to get<');
});

test("grocery-list v2: a line is disabled while its call is in flight, so a double tap sends one call", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
        reply: () => gate,
    });
    w.tapTick("ln-1");
    w.tapTick("ln-1");
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toMatch(/data-busy="true"/);
    release();
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).not.toContain('data-busy="true"');
});

test("grocery-list v2: a failed tick reverts the row and says so", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
        reply: () => {
            throw new Error("no such line");
        },
    });
    w.tapTick("ln-1");
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toContain('class="hd-meta">2 to get<');
    expect(w.html()).toContain("Could not update Kirkland 2% milk.");
    expect(w.html()).not.toContain('data-busy="true"');
});

test("grocery-list v2: a store chip shows that store's lines", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
    });
    w.tapStore("st-2");
    expect(w.html()).toContain(">Salmon<");
    expect(w.html()).not.toContain("Kirkland 2% milk");
});

test("grocery-list v2: chips count the lines still to get, so they agree with the header", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
    });
    expect(w.html()).toContain('class="hd-meta">2 to get<');
    expect(w.html().match(/<span class="chip-n">1<\/span>/g)?.length).toBe(2);
    w.tapTick("ln-1");
    await w.settle();
    expect(w.html()).toContain('class="hd-meta">1 to get<');
    expect(w.html()).toContain(
        'data-store="st-1">Costco<span class="chip-n">0',
    );
    expect(w.html()).toContain('data-store="st-2">Trader');
});

test("grocery-list v2: a tick keeps keyboard focus on its button through the repaint", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
    });
    w.focusTick("ln-1");
    expect(w.focused()).toBe("button.check:ln-1");
    w.tapTick("ln-1");
    // Busy repaint, then the settled one: focus survives both.
    expect(w.focused()).toBe("button.check:ln-1");
    await w.settle();
    expect(w.calls).toEqual([{ id: "ln-1", checked: true }]);
    expect(w.focused()).toBe("button.check:ln-1");
});

test("grocery-list v2: a store chip keeps keyboard focus through the repaint", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
    });
    w.focusStore("st-2");
    w.tapStore("st-2");
    expect(w.html()).toContain(">Salmon<");
    expect(w.focused()).toBe("button.chip:st-2");
});

test("grocery-list v2: a line the fridge already covers says so in the row", async () => {
    const body = renderWidget(await v2Widget("grocery-list"), {
        stores: [
            {
                id: "st-1",
                name: "Costco",
                sections: [
                    {
                        id: "sec-1",
                        name: "Pantry",
                        lines: [
                            groceryLine({
                                id: "ln-1",
                                display_name: "Rice",
                                already_have: "already have 1 lb of 5 lb <b>",
                            }),
                            groceryLine({ id: "ln-2", display_name: "Salt" }),
                        ],
                    },
                ],
            },
        ],
    });
    expect(body).toContain(
        '<p class="sub note">already have 1 lb of 5 lb &lt;b&gt;</p>',
    );
    // Visible text, not a hover title, and only on the line that has it.
    expect(body).not.toContain("title=");
    expect(body.match(/class="sub note"/g)?.length).toBe(1);
});

test("grocery-list v2: a tick that finishes after a new result lands on the new card", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
        reply: () => gate,
    });
    w.tapTick("ln-1");
    w.pushResult(GROCERY_DATA);
    await w.settle();
    // The new result brought its own copy of the line, still unticked, and
    // the call is still out, so the row stays disabled.
    expect(w.html()).toMatch(/data-line-id="ln-1" data-busy="true"/);
    release();
    await w.settle();
    expect(w.html()).toContain('class="hd-meta">1 to get<');
    expect(w.html()).not.toContain('data-busy="true"');
});

test("grocery-list v2: a new result clears the error of a line it no longer has", async () => {
    const w = await mountGrocery(await v2Widget("grocery-list"), {
        data: GROCERY_DATA,
        reply: () => {
            throw new Error("no such line");
        },
    });
    w.tapTick("ln-1");
    await w.settle();
    expect(w.html()).toContain("Could not update Kirkland 2% milk.");
    // Still on the list: the error stays until the line is ticked again.
    w.pushResult(GROCERY_DATA);
    await w.settle();
    expect(w.html()).toContain("Could not update Kirkland 2% milk.");
    const without = {
        ...GROCERY_DATA,
        stores: [
            {
                ...GROCERY_DATA.stores[0]!,
                sections: [
                    {
                        ...GROCERY_DATA.stores[0]!.sections[0]!,
                        lines: [GROCERY_DATA.stores[0]!.sections[0]!.lines[1]!],
                    },
                ],
            },
        ],
    };
    w.pushResult(without);
    await w.settle();
    expect(w.html()).not.toContain("Could not update");
    // The line coming back later does not revive the old error.
    w.pushResult(GROCERY_DATA);
    await w.settle();
    expect(w.html()).not.toContain("Could not update");
});

test("grocery-list v2: an empty list says so", async () => {
    const body = renderWidget(await v2Widget("grocery-list"), {
        stores: [],
    });
    expect(body).toContain("Nothing on the grocery list.");
});

function fridgeItem(over: Record<string, unknown>) {
    return {
        id: "i1",
        location_id: "loc-1",
        location: "Fridge",
        kind: "food",
        display_name: "Eggs",
        amount: 9,
        unit: "each",
        expires_on: "2026-11-19",
        days_left: 7,
        notices: [],
        ...over,
    };
}

test("fridge v2: use-soon tiles take their days and tone from days_left, the rest list by location with a footer", async () => {
    const html = await v2Widget("fridge");
    const body = renderWidget(html, {
        locations: [
            {
                id: "loc-1",
                name: "Fridge",
                sort_order: 0,
                items: [
                    fridgeItem({ id: "a", display_name: "Eggs" }),
                    fridgeItem({
                        id: "b",
                        display_name: "Salmon",
                        amount: 1,
                        unit: "lb",
                        expires_on: "2026-11-13",
                        days_left: 1,
                    }),
                    fridgeItem({
                        id: "c",
                        display_name: "Spinach",
                        expires_on: "2026-11-14",
                        days_left: 2,
                    }),
                    fridgeItem({
                        id: "d",
                        display_name: "Old milk",
                        expires_on: "2026-11-10",
                        days_left: -2,
                    }),
                    fridgeItem({
                        id: "e",
                        display_name: "Butter",
                        expires_on: null,
                        days_left: null,
                    }),
                    fridgeItem({
                        id: "g",
                        display_name: "Yogurt",
                        expires_on: "2026-11-21",
                        days_left: 9,
                    }),
                    fridgeItem({
                        id: "h",
                        display_name: "Cheese",
                        expires_on: "2026-11-25",
                        days_left: 13,
                    }),
                ],
            },
            {
                id: "loc-2",
                name: "Freezer",
                sort_order: 1,
                items: [fridgeItem({ id: "f", display_name: "Peas" })],
            },
            { id: "loc-3", name: "Pantry", sort_order: 2, items: [] },
        ],
    });
    expect(body).toContain('class="hd-meta">8 items<');
    expect(body).toContain("Use soon");
    expect(body).toContain('class="tile-w is-over">Expired<');
    expect(body).toContain('class="tile-w is-over">Tomorrow<');
    expect(body).toContain('class="tile-w is-warn">2 days<');
    // Eggs (7 days) and the undated butter are not use-soon.
    expect((body.match(/class="tile"/g) ?? []).length).toBe(3);
    // Rows: quantity beside the name, the date on the right.
    expect(body).toContain('class="row-s">9<');
    expect(body).toContain('class="row-end date">Nov 19<');
    // Items on a tile are not listed again; the list is the soonest rest.
    expect(body).not.toContain('data-item-id="b"');
    // The empty pantry has no section; three rows per location, the rest in the footer.
    expect(body).not.toContain("Pantry");
    expect(body).toContain('class="lbl">Fridge<span class="lbl-n">4</span>');
    expect(body).toContain('class="lbl">Freezer<span class="lbl-n">1</span>');
    expect(body).toContain("+ 1 more in the fridge");
    expect(body).not.toContain("Butter");
});

test("fridge v2: a past date reads red in the list when the tiles are full", async () => {
    const expired = (id: string, days: number) =>
        fridgeItem({
            id,
            display_name: `Item ${id}`,
            expires_on: "2026-11-01",
            days_left: days,
        });
    const body = renderWidget(await v2Widget("fridge"), {
        locations: [
            {
                id: "loc-1",
                name: "Fridge",
                sort_order: 0,
                items: [
                    expired("a", -5),
                    expired("b", -4),
                    expired("c", -3),
                    expired("d", -2),
                ],
            },
        ],
    });
    expect((body.match(/class="tile"/g) ?? []).length).toBe(3);
    expect(body).toContain('class="row-end date is-over">Nov 1<');
    expect(body).toContain('data-item-id="d"');
});

test("fridge v2: no use-soon strip when nothing expires within three days; empty fridge says so", async () => {
    const html = await v2Widget("fridge");
    const calm = renderWidget(html, {
        locations: [
            {
                id: "loc-1",
                name: "Pantry",
                sort_order: 0,
                items: [fridgeItem({ days_left: 30 })],
            },
        ],
    });
    expect(calm).not.toContain("Use soon");
    expect(calm).toContain('class="hd-meta">1 item<');
    const empty = renderWidget(html, { locations: [] });
    expect(empty).toContain("Nothing in the fridge.");
    const sample = renderWidget(html, undefined);
    expect(sample).toContain("Use soon");
    expect(sample).toContain("Cooked rice");
});

test("fridge v2: item names reach the markup escaped", async () => {
    const body = renderWidget(await v2Widget("fridge"), {
        locations: [
            {
                id: "loc-1",
                name: EVIL,
                sort_order: 0,
                items: [fridgeItem({ display_name: EVIL, days_left: 0 })],
            },
        ],
    });
    expect(body).not.toContain("<img");
});

// ---- use-soon v2 ------------------------------------------------------------

function useSoonItem(over: Record<string, unknown> = {}) {
    return {
        id: "i1",
        display_name: "Salmon",
        amount: 1,
        unit: "lb",
        expires_on: "2026-11-13",
        location: "Fridge",
        days_left: 1,
        recipe: null,
        ...over,
    };
}

test("use-soon v2 sample renders urgent, soon and later rows and the featured recipe", async () => {
    const body = renderWidget(await v2Widget("use-soon"), undefined);
    expect(body).toContain("Use soon");
    expect(body).toContain('class="hd-meta">4 items<');
    expect(body).toContain("Tomorrow");
    expect(body).toContain("5 days");
    expect(body).toContain("½ bag");
    expect(body).toContain("Use in: ");
    expect(body).toContain("Uses 3 of them");
    expect(body).toContain("25 min");
    expect(body).toContain("640 kcal");
    expect(body).toContain('class="p">P 48<');
    // The design's Cook it / Add to plan buttons are not built here.
    expect(body).not.toContain("Cook it");
    expect(body).not.toContain("<button");
});

test("use-soon v2: rows sort by days left and the label and tone follow days_left", async () => {
    const body = renderWidget(await v2Widget("use-soon"), {
        items: [
            useSoonItem({ id: "later", display_name: "Yogurt", days_left: 5 }),
            useSoonItem({ id: "old", display_name: "Milk", days_left: -2 }),
            useSoonItem({ id: "today", display_name: "Eggs", days_left: 0 }),
            useSoonItem({ id: "soon", display_name: "Rice", days_left: 3 }),
            useSoonItem({ id: "tmrw", display_name: "Salmon", days_left: 1 }),
        ],
        featured: null,
    });
    const order = ["Milk", "Eggs", "Salmon", "Rice", "Yogurt"].map((n) =>
        body.indexOf(`>${n}<`),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain('class="row-end is-over">Expired<');
    expect(body).toContain('class="row-end is-over">Today<');
    expect(body).toContain('class="row-end is-over">Tomorrow<');
    expect(body).toContain('class="row-end is-warn">3 days<');
    expect(body).toContain('class="row-end">5 days<');
    expect(body).toContain('class="dot lg s-dim"');
    expect(body).not.toContain("Uses ");
});

test("use-soon v2: Use in names the recipe only for items that have one; unknown macros are left out", async () => {
    const body = renderWidget(await v2Widget("use-soon"), {
        items: [
            useSoonItem({ recipe: { id: "r1", name: "Fish pie" } }),
            useSoonItem({ id: "i2", display_name: "Yogurt", days_left: 4 }),
        ],
        featured: {
            id: "r1",
            name: "Fish pie",
            uses: 2,
            minutes: null,
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
        },
    });
    expect(body.match(/Use in: /g)).toHaveLength(1);
    expect(body).toContain("<b>Fish pie</b>");
    expect(body).toContain("Uses 2 of them");
    expect(body).not.toContain("feat-meta");
    expect(body).not.toContain(" min");
});

test("use-soon v2: nothing expiring says so; names reach the markup escaped", async () => {
    const html = await v2Widget("use-soon");
    const empty = renderWidget(html, { items: [], featured: null });
    expect(empty).toContain("Nothing is expiring soon.");
    const evil = renderWidget(html, {
        items: [
            useSoonItem({
                display_name: EVIL,
                recipe: { id: "r", name: EVIL },
            }),
        ],
        featured: {
            id: "r",
            name: EVIL,
            uses: 2,
            minutes: 5,
            calories: 1,
            protein_g: 1,
            carbs_g: 1,
            fat_g: 1,
        },
    });
    expect(evil).not.toContain("<img");
});

// ---- product-score v2 -------------------------------------------------------

type ScoreRow = [number, string, string, "good" | "warn" | "over"];

const SCORE_LABELS: Record<string, string> = {
    nutrition: "Nutri-Score",
    processing: "Processing",
    additives: "Additives",
    environment: "Green-Score",
};

// [value, display, status] per part, as rate_product words them.
function scoreBreakdown(
    rows: Record<string, ScoreRow | null>,
): Record<string, unknown>[] {
    return ["nutrition", "processing", "additives", "environment"].map(
        (part) => {
            const row = rows[part] ?? null;
            return {
                part,
                value: row ? row[0] : null,
                weight: row ? 0.25 : 0,
                known: row != null,
                source: row ? row[1] : null,
                label: SCORE_LABELS[part],
                display: row ? row[2] : null,
                status: row ? row[3] : null,
            };
        },
    );
}

function scoreCheck(
    name: string,
    verdict: "good" | "careful" | "avoid",
    reason: string,
    notices: unknown[] = [],
) {
    return { user_id: `u-${name}`, name, notices, verdict, reason };
}

function scorePayload(over: Record<string, unknown> = {}) {
    return {
        found: true,
        product: {
            food_id: "f1",
            barcode: "5201054017463",
            name: "Fage Total 2% Greek yogurt",
            brand: "Fage",
        },
        score: 82,
        label: "good",
        preset: "balanced",
        preset_label: "Balanced",
        breakdown: scoreBreakdown({
            nutrition: [100, "nutriscore a", "A", "good"],
            processing: [100, "nova 1", "NOVA 1 · unprocessed", "good"],
            additives: [100, "no additives listed", "None", "good"],
            environment: [50, "ecoscore c", "C", "warn"],
        }),
        parts_used: 4,
        parts_total: 4,
        missing: [],
        info_rows: [
            { kind: "sugars", per_100g: 4, level: "low", status: "good" },
            {
                kind: "saturated-fat",
                per_100g: 2,
                level: "moderate",
                status: "warn",
            },
        ],
        checks: [],
        ...over,
    };
}

test("product-score v2 sample: the full card, with the score in its label colour, every part, both nutrient rows and a verdict per member", async () => {
    const body = renderWidget(await v2Widget("product-score"), undefined);
    expect(body).toContain("Product score");
    expect(body).toContain('class="hd-meta">Balanced weights<');
    expect(body).toContain("Fage Total 2% Greek yogurt");
    expect(body).toContain("Fage · 5201054017463");
    expect(body).toContain('class="ps-n is-ok">82<');
    expect(body).toContain('aria-label="82 out of 100, good"');
    expect(body).toContain(">Nutri-Score<");
    expect(body).toContain("<span>A</span>");
    expect(body).toContain("<span>NOVA 1 · unprocessed</span>");
    expect(body).toContain("<span>None</span>");
    expect(body).toContain("<span>C</span>");
    expect(body).toContain(">Sat. fat<");
    expect(body).toContain("<span>2 g</span>");
    // Scored on all four: no "scored on" line.
    expect(body).not.toContain("Scored on");
    expect(body).toContain('class="mr-v is-ok">Good<');
    expect(body).toContain('class="mr-v is-over">Avoid<');
    expect(body).toContain('class="mr-v is-warn">Careful<');
    expect(body).toContain("Contains Milk · listed as an allergy");
    expect(body).toContain("No issues found for this product.");
});

test("product-score v2: the card draws the wire's wording and status, never its own", async () => {
    const html = await v2Widget("product-score");
    const body = renderWidget(
        html,
        scorePayload({
            preset_label: "Zorp first",
            breakdown: scoreBreakdown({
                nutrition: [10, "x", "Wording A", "over"],
                processing: [90, "y", "Wording B", "good"],
                additives: [55, "z", "Wording C", "warn"],
                environment: null,
            }),
            checks: [scoreCheck("Ann", "careful", "Reason as the app says it")],
        }),
    );
    // The header, each part's value, and the member line come through verbatim.
    expect(body).toContain('class="hd-meta">Zorp first weights<');
    expect(body).toContain("<span>Wording A</span>");
    expect(body).toContain("<span>Wording B</span>");
    expect(body).toContain("<span>Wording C</span>");
    expect(body).toContain("Reason as the app says it");
    // The dot follows the wire status: 10 would be "over" and 90 "good"
    // whatever the number, 55 "warn". Nothing is re-banded from the value.
    const dots = (label: string) =>
        body.match(new RegExp(label + "</span>(.*?)</span></div>"))?.[1] ?? "";
    expect(dots("Nutri-Score")).toContain("over");
    expect(dots("Processing")).toContain("accent-fill");
    expect(dots("Additives")).toContain("warn");
    // A status that contradicts the number wins: the card never re-derives it.
    const flipped = renderWidget(
        html,
        scorePayload({
            breakdown: scoreBreakdown({
                nutrition: [95, "x", "Wording", "over"],
            }),
        }),
    );
    const flippedDot =
        flipped.match(/Nutri-Score<\/span>(.*?)<\/span><\/div>/)?.[1] ?? "";
    expect(flippedDot).toContain("over");
    expect(flippedDot).not.toContain("accent-fill");
});

test("product-score v2: the number takes its tone from the label the tool returns", async () => {
    const html = await v2Widget("product-score");
    const mid = renderWidget(
        html,
        scorePayload({ score: 55, label: "middling" }),
    );
    expect(mid).toContain('class="ps-n is-warn">55<');
    expect(mid).toContain(">Middling<");
    const poor = renderWidget(html, scorePayload({ score: 12, label: "poor" }));
    expect(poor).toContain('class="ps-n is-over">12<');
    expect(poor).toContain(">Poor<");
});

test("product-score v2: a partial score says it was scored on 2 of 4 and shows the missing parts as no data", async () => {
    const body = renderWidget(
        await v2Widget("product-score"),
        scorePayload({
            score: 48,
            label: "middling",
            breakdown: scoreBreakdown({
                nutrition: [50, "nutriscore c", "C", "warn"],
                processing: [33, "nova 3", "NOVA 3 · processed", "over"],
            }),
            parts_used: 2,
            missing: ["additives", "environment"],
            info_rows: [
                {
                    kind: "saturated-fat",
                    per_100g: 9,
                    level: "high",
                    status: "over",
                },
            ],
        }),
    );
    expect(body).toContain("Scored on 2 of 4.");
    expect(body).toContain("Parts with no data are left out");
    expect(body.match(/>No data</g)).toHaveLength(2);
    expect(body).toContain("<span>NOVA 3 · processed</span>");
    expect(body).toContain('class="ps-n is-warn">48<');
    // One nutrient row only: sugar is not made up.
    expect(body).not.toContain(">Sugar<");
    expect(body).toContain("<span>9 g</span>");
});

test("product-score v2: not enough data is a message and never a number", async () => {
    const body = renderWidget(
        await v2Widget("product-score"),
        scorePayload({
            score: null,
            label: "not_enough_data",
            breakdown: scoreBreakdown({}),
            parts_used: 0,
            missing: ["nutrition", "processing", "additives", "environment"],
            info_rows: [],
        }),
    );
    expect(body).toContain("Not enough data to score");
    expect(body).toContain("Scored on 0 of 4.");
    expect(body).not.toContain('class="ps-n ');
    expect(body).not.toContain("/100");
    expect(body).not.toMatch(/>0</);
});

test("product-score v2: a product that was not found says so, with no score or parts", async () => {
    const body = renderWidget(
        await v2Widget("product-score"),
        scorePayload({
            found: false,
            product: { food_id: null, barcode: null, name: "", brand: null },
            score: null,
            label: "not_enough_data",
        }),
    );
    expect(body).toContain("No product found.");
    expect(body).not.toContain("ps-grid");
});

test("product-score v2: a member's verdict word and reason are the wire's, whatever the notices say", async () => {
    const body = renderWidget(
        await v2Widget("product-score"),
        scorePayload({
            checks: [
                scoreCheck("Ann", "careful", "Over sugar today."),
                scoreCheck(
                    "Bo",
                    "avoid",
                    "Contains Peanuts · listed as an allergy",
                ),
                scoreCheck("Cy", "good", "No issues found for this product."),
                // Notices do not decide the verdict: the wire field does.
                scoreCheck("Di", "good", "Fits today", [
                    { severity: "block", message: "Contains peanuts." },
                ]),
            ],
        }),
    );
    expect(body).toMatch(/>Ann<\/span><span class="mr-why">Over sugar today\./);
    expect(body).toMatch(
        />Bo<\/span><span class="mr-why">Contains Peanuts · listed/,
    );
    expect(body).toMatch(/>Di<\/span><span class="mr-why">Fits today</);
    expect(body).toContain('class="mr-v is-warn">Careful<');
    expect(body).toContain('class="mr-v is-over">Avoid<');
    expect(body.match(/class="mr-v is-ok">Good</g)).toHaveLength(2);
});

test("product-score v2: names, brand, barcode and reasons reach the markup escaped", async () => {
    const evil = renderWidget(
        await v2Widget("product-score"),
        scorePayload({
            product: { food_id: "f", barcode: EVIL, name: EVIL, brand: EVIL },
            preset_label: EVIL,
            breakdown: [
                {
                    part: "nutrition",
                    value: 50,
                    weight: 1,
                    known: true,
                    source: null,
                    label: EVIL,
                    display: EVIL,
                    status: "warn",
                },
            ],
            checks: [
                {
                    user_id: EVIL,
                    name: EVIL,
                    notices: [],
                    verdict: "careful",
                    reason: EVIL,
                },
            ],
        }),
    );
    expect(evil).not.toContain("<img");
    expect(evil).toContain("&lt;img");
});

// ---- recipe-card v2 ---------------------------------------------------------

function recipeIngredient(over: Record<string, unknown>) {
    return {
        id: "ri-1",
        display_name: "Salmon fillet",
        amount: 1,
        unit: "lb",
        note: null,
        food_id: "food-1",
        per_portion_amount: null,
        person_amount: null,
        product: null,
        missing: false,
        ...over,
    };
}

function recipePreview(shortfalls: Record<string, unknown>[] = []) {
    return {
        total_portions: 1,
        lines: [],
        shortfalls,
        unmeasured: [],
        cookable: shortfalls.length === 0,
    };
}

function recipeData(over: Record<string, unknown> = {}) {
    return {
        id: "rec-1",
        name: "Salmon, rice & spinach",
        yield_portions: 2,
        suggested_meal_type: "dinner",
        creator_id: "u-1",
        instructions: null,
        source_url: "https://www.seriouseats.com/salmon-rice",
        tags: [],
        notes: null,
        prep_minutes: 10,
        cook_minutes: 15,
        verification: "verified",
        steps: [],
        portion_count: 1,
        macros_per_portion: {
            calories: 640,
            protein_g: 48,
            carbs_g: 62,
            fat_g: 22,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: false,
        },
        notices: [],
        ingredients: [
            recipeIngredient({}),
            recipeIngredient({
                id: "ri-2",
                display_name: "Lemon",
                amount: 1,
                unit: "each",
                food_id: "food-2",
                missing: true,
            }),
        ],
        problems: [],
        import: null,
        cook_preview: recipePreview([
            {
                food_id: "food-2",
                display_name: "Lemon",
                amount: 1,
                unit: "each",
                unknown_factor: false,
            },
        ]),
        ...over,
    };
}

type RecipeCall = { name: string; args: Record<string, unknown> };

class ToolRefusal extends Error {}

// The recipe card against a stub host: records every tools/call, answers each
// by `reply` (which may throw or wait), and clicks by data-act the way a tap
// inside the card reaches the delegated listener on #root.
async function mountRecipe(
    html: string,
    opts: {
        data: object;
        canCallTools?: boolean;
        reply?: (call: RecipeCall) => Promise<object | void> | object | void;
    },
) {
    const focus: string[] = [];
    type Fn = (e: unknown) => void;
    const calls: RecipeCall[] = [];
    const contexts: string[] = [];
    const listeners: Fn[] = [];
    const windowListeners: Fn[] = [];
    const dom = widgetRootStub((fn) => listeners.push(fn), focus);
    const noop = () => {};
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const deliver = (data: object) => {
        for (const fn of windowListeners) fn({ source: host, data });
    };
    const host = {
        postMessage(msg: {
            id?: string;
            method: string;
            params: {
                name?: string;
                arguments?: Record<string, unknown>;
                content?: { text: string }[];
            };
        }) {
            const { id, method, params } = msg;
            if (method === "ui/initialize") {
                deliver({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        hostCapabilities:
                            opts.canCallTools === false
                                ? {}
                                : { serverTools: {} },
                        hostContext: { theme: "light" },
                    },
                });
            } else if (method === "ui/notifications/initialized") {
                deliver({
                    jsonrpc: "2.0",
                    method: "ui/notifications/tool-result",
                    params: { structuredContent: opts.data },
                });
            } else if (method === "ui/update-model-context") {
                contexts.push(params.content?.[0]?.text ?? "");
                deliver({ jsonrpc: "2.0", id, result: {} });
            } else if (method === "tools/call") {
                const call = {
                    name: params.name!,
                    args: structuredClone(params.arguments!),
                };
                calls.push(call);
                void (async () => {
                    try {
                        const structuredContent =
                            (await opts.reply?.(call)) ?? {};
                        deliver({
                            jsonrpc: "2.0",
                            id,
                            result: {
                                content: [{ type: "text", text: "ok" }],
                                structuredContent,
                            },
                        });
                    } catch (e) {
                        // A tool that answers with isError, as against a
                        // transport failure (a JSON-RPC error).
                        if (e instanceof ToolRefusal) {
                            deliver({
                                jsonrpc: "2.0",
                                id,
                                result: {
                                    isError: true,
                                    content: [
                                        { type: "text", text: e.message },
                                    ],
                                },
                            });
                            return;
                        }
                        deliver({
                            jsonrpc: "2.0",
                            id,
                            error: { code: -32603, message: String(e) },
                        });
                    }
                })();
            }
        },
    };
    const window: Record<string, unknown> = {
        parent: host,
        innerWidth: 400,
        postMessage: (msg: unknown) =>
            (host.postMessage as (m: unknown) => void)(msg),
        addEventListener: (type: string, fn: Fn) => {
            if (type === "message") windowListeners.push(fn);
        },
        removeEventListener: noop,
    };
    for (const script of widgetScriptBodies(html)) {
        new Function("window", "document", script)(window, dom.document);
    }
    await tick();
    await tick();
    const tap = (act: string) => {
        const el = { getAttribute: () => act };
        for (const fn of listeners) {
            fn({
                preventDefault: noop,
                target: {
                    closest: (sel: string) =>
                        sel === "[data-act]" ? el : null,
                },
            });
        }
    };
    return {
        html: dom.html,
        calls,
        contexts,
        focus,
        focusOn: dom.focusOn,
        tap,
        // The host re-sending a tool result (or the same one again).
        resend(data: object) {
            deliver({
                jsonrpc: "2.0",
                method: "ui/notifications/tool-result",
                params: { structuredContent: data },
            });
        },
        async settle() {
            for (let i = 0; i < 10; i++) await tick();
        },
    };
}

const COOKED = {
    total_portions: 3,
    shortfalls: [
        { food_id: "food-2", display_name: "Lemon", amount: 3, unit: "each" },
    ],
    meal_ids: [],
    unmeasured: [],
};

const cookReply = (call: RecipeCall) =>
    call.name === "cook_recipe" ? COOKED : {};

test("recipe-card v2: the sample is the design's card, with no Cook when no host can run tools", async () => {
    const html = await v2Widget("recipe-card");
    const body = renderWidget(html, undefined);
    expect(body).toContain('class="hd-title">Recipe<');
    expect(body).toContain('class="hd-meta">2 servings · 25 min<');
    expect(body).toContain("Salmon, rice &amp; spinach");
    expect(body).toContain(">seriouseats.com<");
    expect(body).toContain('class="rc-tile-v">640<');
    expect(body).toContain('class="rc-tile-v">48 g<');
    expect(body).toContain('class="rc-tile-v">62 g<');
    expect(body).toContain('class="rc-tile-v">22 g<');
    expect(body).toContain(">Lemon<");
    expect(body).toContain('class="row-s is-warn">missing<');
    expect(body).toContain("½ bag");
    expect(body).toContain("Missing 1");
    expect(body).not.toContain('data-act="cook"');
});

test("recipe-card v2: pressing Cook opens the confirm step and calls nothing", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    expect(w.html()).toContain('data-act="cook"');
    expect(w.html()).not.toContain('data-step="confirm"');
    w.tap("cook");
    await w.settle();
    expect(w.calls).toEqual([]);
    expect(w.html()).toContain('data-step="confirm"');
    expect(w.html()).toContain("Cook Salmon, rice &amp; spinach?");
    // Default servings is the recipe's yield; the switch starts off.
    expect(w.html()).toContain('class="rc-n" aria-live="polite">2<');
    expect(w.html()).toContain('aria-checked="false"');
    expect(w.html()).toContain('data-act="confirm"');
    expect(w.calls).toEqual([]);
});

test("recipe-card v2: Confirm cooks the chosen number of servings, once", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("inc");
    expect(w.html()).toContain('class="rc-n" aria-live="polite">3<');
    expect(w.calls).toEqual([]);
    w.tap("confirm");
    await w.settle();
    expect(w.calls).toEqual([
        {
            name: "cook_recipe",
            args: { recipe_id: "rec-1", total_portions: 3 },
        },
    ]);
    // The result comes from cook_recipe's structuredContent.
    expect(w.html()).toContain("Cooked 3 servings.");
    expect(w.html()).toContain("Not enough: Lemon.");
    expect(w.html()).not.toContain("Logged 1 serving");
    // Cooked: no second Cook, and the model is told.
    expect(w.html()).not.toContain('data-act="cook"');
    expect(w.html()).not.toContain('data-act="confirm"');
    expect(w.contexts).toEqual([
        "Cooked 3 servings of Salmon, rice & spinach.",
    ]);
});

test("recipe-card v2: servings never go below 1", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({ yield_portions: 1 }),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("dec");
    w.tap("dec");
    expect(w.html()).toContain('class="rc-n" aria-live="polite">1<');
    w.tap("confirm");
    await w.settle();
    expect(w.calls[0]!.args.total_portions).toBe(1);
});

test("recipe-card v2: with the switch on, log_recipe_portion follows cook_recipe with one portion", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("log");
    expect(w.html()).toContain('aria-checked="true"');
    w.tap("confirm");
    await w.settle();
    expect(w.calls).toEqual([
        {
            name: "cook_recipe",
            args: { recipe_id: "rec-1", total_portions: 2 },
        },
        {
            name: "log_recipe_portion",
            args: { recipe_id: "rec-1", portions: 1, meal_type: "dinner" },
        },
    ]);
    expect(w.html()).toContain("Logged 1 serving.");
    expect(w.contexts[0]).toContain("One serving logged.");
});

test("recipe-card v2: Cancel leaves the card as it was and calls nothing", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("inc");
    w.tap("cancel");
    await w.settle();
    expect(w.calls).toEqual([]);
    expect(w.html()).not.toContain('data-step="confirm"');
    expect(w.html()).toContain('data-act="cook"');
    // Opening it again starts from the defaults.
    w.tap("cook");
    expect(w.html()).toContain('class="rc-n" aria-live="polite">2<');
});

test("recipe-card v2: without canCallTools there is no Cook and a tap does nothing", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        canCallTools: false,
    });
    expect(w.html()).toContain(">Lemon<");
    expect(w.html()).not.toContain('data-act="cook"');
    w.tap("cook");
    w.tap("confirm");
    await w.settle();
    expect(w.calls).toEqual([]);
    expect(w.html()).not.toContain('data-step="confirm"');
});

test("recipe-card v2: Confirm is disabled while the cook is out, so a second tap sends nothing", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: async (call) => {
            await gate;
            return cookReply(call);
        },
    });
    w.tap("cook");
    w.tap("confirm");
    w.tap("confirm");
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toMatch(/data-act="confirm" disabled/);
    expect(w.html()).toMatch(/data-act="cancel" disabled/);
    // The controls are frozen too: cancel and the stepper do nothing.
    w.tap("cancel");
    w.tap("inc");
    expect(w.html()).toContain('data-step="confirm"');
    expect(w.html()).toContain('class="rc-n" aria-live="polite">2<');
    release();
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toContain("Cooked 3 servings.");
});

test("recipe-card v2: a failed cook says so, returns to the confirm step and is not retried", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: () => {
            throw new ToolRefusal("recipe is unverified");
        },
    });
    w.tap("cook");
    w.tap("confirm");
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toContain("Could not cook this recipe.");
    expect(w.html()).toContain('data-step="confirm"');
    expect(w.html()).not.toMatch(/data-act="confirm" disabled/);
    expect(w.html()).not.toContain("Cooked ");
    expect(w.contexts).toEqual([]);
    await w.settle();
    expect(w.calls.length).toBe(1);
});

test("recipe-card v2: a log that fails after a good cook stays cooked and offers no second cook", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: (call) => {
            if (call.name === "log_recipe_portion") throw new Error("nope");
            return cookReply(call);
        },
    });
    w.tap("cook");
    w.tap("log");
    w.tap("confirm");
    await w.settle();
    expect(w.calls.map((c) => c.name)).toEqual([
        "cook_recipe",
        "log_recipe_portion",
    ]);
    expect(w.html()).toContain("Cooked 3 servings.");
    expect(w.html()).toContain("could not be logged");
    expect(w.html()).not.toContain('data-act="cook"');
    expect(w.html()).not.toContain('data-act="confirm"');
    expect(w.contexts[0]).not.toContain("logged");
});

test("recipe-card v2: focus follows the step: into the stepper, back to Cook, onto the result", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.tap("cook");
    expect(w.focus.at(-1)).toBe('[data-act="dec"]');
    w.tap("cancel");
    expect(w.focus.at(-1)).toBe('[data-act="cook"]');
    // At one serving the minus is dead, so the plus takes focus.
    const one = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({ yield_portions: 1 }),
        reply: cookReply,
    });
    one.tap("cook");
    expect(one.focus.at(-1)).toBe('[data-act="inc"]');
    w.tap("cook");
    w.tap("confirm");
    // In flight Confirm is disabled, so the block around it holds focus.
    expect(w.focus.at(-1)).toBe('[data-focus="confirm"]');
    await w.settle();
    expect(w.focus.at(-1)).toBe('[data-focus="result"]');
    expect(w.html()).toContain('data-focus="result" tabindex="-1"');
});

test("recipe-card v2: a repaint keeps focus on the control that had it", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({ yield_portions: 3 }),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("inc");
    expect(w.focus.at(-1)).toBe('[data-act="dec"]');
    w.focus.length = 0;
    // The tap on the plus left focus there, and the repaint restores it.
    w.focusOn('[data-act="inc"]');
    w.tap("inc");
    expect(w.focus).toEqual(['[data-act="inc"]', '[data-act="inc"]']);
});

test("recipe-card v2: a result re-sent while confirming keeps the confirm step and its choices", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("inc");
    w.tap("log");
    w.resend(recipeData());
    await w.settle();
    expect(w.html()).toContain('data-step="confirm"');
    expect(w.html()).toContain('class="rc-n" aria-live="polite">3<');
    expect(w.html()).toContain('aria-checked="true"');
    expect(w.calls).toEqual([]);
});

test("recipe-card v2: a result re-sent after the cook keeps the result and offers no second Cook", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("confirm");
    await w.settle();
    w.resend(recipeData());
    await w.settle();
    expect(w.html()).toContain("Cooked 3 servings.");
    expect(w.html()).not.toContain('data-act="cook"');
    expect(w.html()).not.toContain('data-act="confirm"');
    expect(w.calls.length).toBe(1);
});

test("recipe-card v2: a result for another recipe re-renders an idle card", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    w.resend(recipeData({ id: "rec-2", name: "Pasta bake" }));
    await w.settle();
    expect(w.html()).toContain("Pasta bake");
    expect(w.html()).not.toContain("Salmon, rice");
    expect(w.html()).toContain('data-act="cook"');
});

test("recipe-card v2: a result for another recipe during a cook changes neither the card nor what is reported", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: async (call) => {
            await gate;
            return cookReply(call);
        },
    });
    w.tap("cook");
    w.tap("confirm");
    w.resend(recipeData({ id: "rec-2", name: "Pasta bake" }));
    await w.settle();
    expect(w.html()).toContain("Salmon, rice");
    expect(w.html()).not.toContain("Pasta bake");
    release();
    await w.settle();
    expect(w.calls[0]!.args.recipe_id).toBe("rec-1");
    expect(w.html()).toContain("Cooked 3 servings.");
    expect(w.html()).not.toContain("Pasta bake");
    expect(w.contexts).toEqual([
        "Cooked 3 servings of Salmon, rice & spinach.",
    ]);
});

test("recipe-card v2: a cook with no answer may have happened, so it says so and offers no second Confirm", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: () => {
            throw new Error("transport closed");
        },
    });
    w.tap("cook");
    w.tap("confirm");
    await w.settle();
    expect(w.html()).toContain(
        "This may have cooked — check the fridge before trying again.",
    );
    expect(w.html()).not.toContain('data-act="confirm"');
    expect(w.html()).not.toContain('data-act="cook"');
    expect(w.html()).not.toContain("Could not cook this recipe.");
    expect(w.focus.at(-1)).toBe('[data-focus="result"]');
    expect(w.contexts[0]).toContain("may have cooked");
    // Nothing on the card now describes the fridge, and no tap cooks.
    expect(w.html()).not.toContain("Missing 1");
    w.tap("confirm");
    w.tap("cook");
    w.resend(recipeData());
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toContain("may have cooked");
});

test("recipe-card v2: after a cook the card stops describing the fridge", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData(),
        reply: cookReply,
    });
    expect(w.html()).toContain("Missing 1");
    expect(w.html()).toContain('class="row-s is-warn">missing<');
    w.tap("cook");
    w.tap("confirm");
    await w.settle();
    expect(w.html()).not.toContain("Missing 1");
    expect(w.html()).not.toContain("You have everything");
    expect(w.html()).not.toContain('class="row-s is-warn">missing<');
    expect(w.html()).toContain(">Lemon<");
});

test("recipe-card v2: the serving is logged under the suggested meal slot, which the switch names", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({ suggested_meal_type: "breakfast" }),
        reply: cookReply,
    });
    w.tap("cook");
    expect(w.html()).toContain("Log a serving as breakfast");
    w.tap("log");
    w.tap("confirm");
    await w.settle();
    expect(w.calls[1]).toEqual({
        name: "log_recipe_portion",
        args: { recipe_id: "rec-1", portions: 1, meal_type: "breakfast" },
    });
});

test("recipe-card v2: with no suggested slot the switch is plain and no meal_type is sent", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({ suggested_meal_type: undefined }),
        reply: cookReply,
    });
    w.tap("cook");
    expect(w.html()).toContain("Log a serving<");
    expect(w.html()).not.toContain("Log a serving as");
    w.tap("log");
    w.tap("confirm");
    await w.settle();
    expect(w.calls[1]!.args).toEqual({ recipe_id: "rec-1", portions: 1 });
});

test("recipe-card v2: the stepper tops out at the web cook sheet's 999", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({ yield_portions: 998 }),
        reply: cookReply,
    });
    w.tap("cook");
    w.tap("inc");
    w.tap("inc");
    expect(w.html()).toContain('class="rc-n" aria-live="polite">999<');
    expect(w.html()).toMatch(/data-act="inc"[^>]* disabled/);
    w.tap("confirm");
    await w.settle();
    expect(w.calls[0]!.args.total_portions).toBe(999);
});

test("recipe-card v2: Missing counts distinct shortfalls, and an unknown factor reads softer", async () => {
    const html = await v2Widget("recipe-card");
    const short = (id: string, name: string, unknown: boolean) => ({
        food_id: id,
        display_name: name,
        amount: 1,
        unit: "each",
        unknown_factor: unknown,
    });
    // Two ingredient rows on one food are both flagged, but it is one shortfall.
    const twoRows = renderWidget(
        html,
        recipeData({
            ingredients: [
                recipeIngredient({ id: "a", food_id: "f1", missing: true }),
                recipeIngredient({ id: "b", food_id: "f1", missing: true }),
                recipeIngredient({
                    id: "c",
                    food_id: "f2",
                    display_name: "Egg",
                }),
            ],
            cook_preview: recipePreview([short("f1", "Salmon", false)]),
        }),
    );
    expect(twoRows).toContain("Missing 1");
    expect(twoRows.match(/>missing</g)?.length).toBe(2);
    const soft = renderWidget(
        html,
        recipeData({
            ingredients: [
                recipeIngredient({ id: "a", food_id: "f1", missing: true }),
            ],
            cook_preview: recipePreview([short("f1", "Salmon", true)]),
        }),
    );
    expect(soft).toContain("May be short 1");
    expect(soft).not.toContain("Missing 1");
    expect(soft).toContain(">may be short<");
    const mixed = renderWidget(
        html,
        recipeData({
            cook_preview: recipePreview([
                short("f1", "Salmon", false),
                short("f2", "Lemon", true),
            ]),
        }),
    );
    expect(mixed).toContain("Missing 1 · May be short 1");
    const all = renderWidget(
        html,
        recipeData({
            ingredients: [recipeIngredient({})],
            cook_preview: recipePreview([]),
        }),
    );
    expect(all).toContain("You have everything");
    expect(all).not.toContain("missing");
});

test("recipe-card v2: unknown macros show a dash, a recipe the fridge cannot be checked for has no Cook", async () => {
    const w = await mountRecipe(await v2Widget("recipe-card"), {
        data: recipeData({
            macros_per_portion: {
                calories: 300,
                protein_g: 20,
                carbs_g: null,
                fat_g: 9,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                incomplete: true,
            },
            cook_preview: null,
            source_url: "not a url",
            prep_minutes: 10,
            cook_minutes: null,
            yield_portions: 1,
        }),
    });
    const body = w.html();
    // An incomplete total undercounts, so no tile claims a figure.
    expect(body.match(/class="rc-tile-v">—</g)?.length).toBe(4);
    expect(body).toContain('class="hd-meta">1 serving · Prep 10 min<');
    expect(body).toContain("The fridge can&#39;t be checked for this recipe.");
    expect(body).not.toContain('data-act="cook"');
    expect(body).not.toContain("rc-src");
    expect(body).not.toContain("You have everything");
});

test("recipe-card v2: names and the source reach the markup escaped", async () => {
    const body = renderWidget(
        await v2Widget("recipe-card"),
        recipeData({
            name: EVIL,
            source_url: "https://evil.example/<img src=x>",
            ingredients: [recipeIngredient({ display_name: EVIL })],
            cook_preview: recipePreview([
                {
                    food_id: "food-1",
                    display_name: EVIL,
                    amount: 1,
                    unit: "each",
                    unknown_factor: false,
                },
            ]),
        }),
    );
    expect(body).not.toContain("<img");
});

// ---- widget harness ---------------------------------------------------------

test("harness index and widget route serve every widget", async () => {
    const port = 18840;
    const proc = Bun.spawn(["bun", "run", "scripts/widget-harness.ts"], {
        cwd: import.meta.dir + "/..",
        env: { ...process.env, HARNESS_PORT: String(port) },
        stdout: "pipe",
        stderr: "pipe",
    });
    try {
        let ready = false;
        for (let i = 0; i < 2000 && !ready; i++) {
            try {
                const r = await fetch(`http://127.0.0.1:${port}/`);
                if (r.ok) ready = true;
            } catch {
                /* server still starting */
            }
            await Promise.resolve();
        }
        expect(ready).toBe(true);
        const index = await (await fetch(`http://127.0.0.1:${port}/`)).text();
        expect(index).toContain('href="/host?widget=attention"');
        const widget = await fetch(`http://127.0.0.1:${port}/widget/attention`);
        expect(widget.status).toBe(200);
    } finally {
        proc.kill();
        await proc.exited;
    }
});

test("widget harness: the host frame counts its border inside its width so a screenshot is not clipped on the right", async () => {
    const src = await Bun.file(
        `${import.meta.dir}/../scripts/widget-harness.ts`,
    ).text();
    expect(src).toMatch(/#frame\{box-sizing:border-box;width:100%/);
});

test("widget harness: the host frame adds its own border to the height a widget reports, so the content gets exactly that height", async () => {
    const src = await Bun.file(
        `${import.meta.dir}/../scripts/widget-harness.ts`,
    ).text();
    expect(src).toContain("frame.offsetHeight - frame.clientHeight");
    expect(src).toContain("(capped + border)");
    expect(src).not.toContain("frame.style.height = capped");
});

// ---- restock-nudge v2 -------------------------------------------------------

function usual(over: Record<string, unknown> = {}) {
    return {
        food_id: "food-eggs",
        name: "Eggs",
        kind: "food",
        product_name: "Vital Farms large",
        store_id: "st-costco",
        store_name: "Costco",
        amount: 24,
        unit: "each",
        schedule: null,
        every_weeks: null,
        last_restocked_on: null,
        restock_when_low: true,
        low_level: 6,
        paused: false,
        on_list: false,
        dismissed: false,
        due: { reason: "2 left, below 6", trigger: "low" },
        ...over,
    };
}

function usualsData(
    usuals: Record<string, unknown>[],
    over: Record<string, unknown> = {},
) {
    return {
        restock_weekday: 0,
        restock_weekday_name: "Sunday",
        today: "2026-11-15",
        is_restock_day: true,
        restock_enabled: true,
        usuals,
        ...over,
    };
}

const COSTCO_THREE = () =>
    usualsData([
        usual(),
        usual({
            food_id: "food-milk",
            name: "Milk",
            product_name: "Kirkland 2%",
            amount: 1,
            unit: "gal",
            schedule: "weekly",
            restock_when_low: false,
            low_level: null,
            due: {
                reason: "weekly, last bought 7 days ago",
                trigger: "schedule",
            },
        }),
        usual({
            food_id: "food-chicken",
            name: "Chicken thighs",
            product_name: null,
            amount: 4,
            unit: "lb",
            schedule: "every_n_weeks",
            every_weeks: 2,
            restock_when_low: false,
            low_level: null,
            due: {
                reason: "every 2 weeks, last bought 14 days ago",
                trigger: "schedule",
            },
        }),
    ]);

const addReply = (call: RecipeCall) =>
    call.name === "add_grocery_line" ? { status: "ok", id: "ln-1" } : {};

test("restock-nudge v2 sample is the design's card: header, three rows by trigger, one Add button", async () => {
    const html = await v2Widget("restock-nudge");
    const body = renderWidget(html, undefined);
    expect(body).toContain('class="hd-title">Restock<');
    expect(body).toContain('class="hd-meta">Sunday · Costco<');
    expect(body).toContain(">Eggs<");
    expect(body).toContain(">Milk<");
    expect(body).toContain(">Chicken thighs<");
    expect(body).toContain('class="dot lg s-warn"');
    expect(body).toContain('class="dot lg s-dim"');
    // No host here, so no Add.
    expect(body).not.toContain('data-act="add:');
});

test("restock-nudge v2: only due usuals are rows, each with product and reason, the low one amber", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual(),
            usual({
                food_id: "food-rice",
                name: "Rice",
                schedule: "weekly",
                due: null,
            }),
            usual({
                food_id: "food-milk",
                name: "Milk",
                product_name: null,
                amount: null,
                unit: "gal",
                restock_when_low: false,
                due: {
                    reason: "weekly, last bought 7 days ago",
                    trigger: "schedule",
                },
            }),
        ]),
    });
    const body = w.html();
    expect(body).toContain(">Eggs<");
    expect(body).toContain(">Milk<");
    expect(body).not.toContain("Rice");
    expect(body).toContain("Vital Farms large · 2 left, below 6");
    expect(body).toContain('class="ur-s is-warn"');
    // No usual amount means one of the unit; "each" is not spelled out.
    expect(body).toContain(">24<");
    expect(body).toContain(">1 gal<");
    expect(body).toContain("weekly, last bought 7 days ago");
    expect(body).toContain('class="hd-meta">Sunday · Costco<');
    expect(body).toContain("Add 2 to the Costco list");
});

test("restock-nudge v2: Add sends add_grocery_line for each shown usual in turn, with its food, store and amount", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        reply: addReply,
    });
    expect(w.html()).toContain("Add 3 to the Costco list");
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls).toEqual([
        {
            name: "add_grocery_line",
            args: {
                kind: "food",
                food_id: "food-eggs",
                store_id: "st-costco",
                amount: 24,
                unit: "each",
            },
        },
        {
            name: "add_grocery_line",
            args: {
                kind: "food",
                food_id: "food-milk",
                store_id: "st-costco",
                amount: 1,
                unit: "gal",
            },
        },
        {
            name: "add_grocery_line",
            args: {
                kind: "food",
                food_id: "food-chicken",
                store_id: "st-costco",
                amount: 4,
                unit: "lb",
            },
        },
    ]);
    const body = w.html();
    expect((body.match(/>Added</g) ?? []).length).toBe(3);
    expect(body).not.toContain('data-act="add:');
});

test("restock-nudge v2: a usual with no amount or store sends neither, a supply is added as a supply and its unit always goes", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({
                food_id: "food-towels",
                name: "Paper towels",
                kind: "supply",
                store_id: null,
                store_name: null,
                amount: null,
                unit: "roll",
            }),
        ]),
        reply: addReply,
    });
    expect(w.html()).toContain("Add 1 to the list");
    w.tap("add:");
    await w.settle();
    expect(w.calls).toEqual([
        {
            name: "add_grocery_line",
            args: { kind: "supply", food_id: "food-towels", unit: "roll" },
        },
    ]);
});

test("restock-nudge v2: a usual already on the list is shown On the list, left out of Add and its count, and never sent", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({ on_list: true }),
            usual({
                food_id: "food-milk",
                name: "Milk",
                product_name: null,
                amount: 1,
                unit: "gal",
                due: { reason: "weekly", trigger: "schedule" },
            }),
        ]),
        reply: addReply,
    });
    const body = w.html();
    expect(body).toContain(">Eggs<");
    expect(body).toContain(">On the list<");
    expect(body).toContain("Add 1 to the Costco list");
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls.map((c) => c.args.food_id)).toEqual(["food-milk"]);
    const after = w.html();
    expect(after).toContain(">On the list<");
    expect(after).toContain(">Added<");
    expect(after).not.toContain('data-act="add:');
});

test("restock-nudge v2: a usual whose notice was dismissed is shown Dismissed, left out of Add and its count, and never sent", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({ dismissed: true }),
            usual({
                food_id: "food-milk",
                name: "Milk",
                product_name: null,
                amount: 1,
                unit: "gal",
                due: { reason: "weekly", trigger: "schedule" },
            }),
        ]),
        reply: addReply,
    });
    const body = w.html();
    expect(body).toContain(">Eggs<");
    expect(body).toContain(">Dismissed<");
    expect(body).not.toContain(">On the list<");
    expect(body).toContain("Add 1 to the Costco list");
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls.map((c) => c.args.food_id)).toEqual(["food-milk"]);
    expect(w.html()).toContain(">Dismissed<");
});

test("restock-nudge v2: when every due usual is dismissed or listed there is no Add", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({ dismissed: true }),
            usual({ food_id: "f2", name: "Milk", on_list: true }),
        ]),
        reply: addReply,
    });
    expect(w.html()).not.toContain("data-act=");
});

test("restock-nudge v2: when every due usual is already on the list there is no Add", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({ on_list: true }),
            usual({ food_id: "f2", name: "Milk", on_list: true }),
        ]),
        reply: addReply,
    });
    const body = w.html();
    expect(body).toContain(">Eggs<");
    expect((body.match(/>On the list</g) ?? []).length).toBe(2);
    expect(body).not.toContain("data-act=");
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls).toEqual([]);
});

test("restock-nudge v2: due usuals at several stores are grouped, each group with its own Add that adds only its own", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual(),
            usual({
                food_id: "food-salmon",
                name: "Salmon",
                product_name: null,
                store_id: "st-tj",
                store_name: "Trader Joe's",
                amount: 1,
                unit: "lb",
            }),
        ]),
        reply: addReply,
    });
    const body = w.html();
    expect(body).toContain('class="hd-meta">Sunday<');
    expect(body).toContain(">Costco<");
    expect(body).toContain(">Trader Joe&#39;s<");
    expect(body).toContain("Add 1 to the Costco list");
    expect(body).toContain("Add 1 to the Trader Joe&#39;s list");
    // Several stores: every Add is neutral. One store keeps the primary.
    expect(body).not.toContain("btn primary");
    w.tap("add:st-tj");
    await w.settle();
    expect(w.calls.map((c) => c.args.food_id)).toEqual(["food-salmon"]);
    expect(w.html()).toContain("Add 1 to the Costco list");
    expect(w.html()).not.toContain("Trader Joe&#39;s list");
});

test("restock-nudge v2: a single store's Add is the primary button", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([usual()]),
        reply: addReply,
    });
    expect(w.html()).toContain('class="btn primary"');
});

test("restock-nudge v2: while an Add is out its button is disabled and a second tap sends nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        reply: async (call) => {
            await gate;
            return addReply(call);
        },
    });
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toMatch(
        /<button[^>]*data-act="add:st-costco"[^>]*disabled/,
    );
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls.length).toBe(1);
    release();
    await w.settle();
    expect(w.calls.length).toBe(3);
});

test("restock-nudge v2: the first failure stops the run, says which usual, keeps the rest unadded and Add retries them", async () => {
    let fail = true;
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        reply: (call) => {
            if (call.args.food_id === "food-milk" && fail) {
                throw new ToolRefusal("That catalog item is a supply.");
            }
            return addReply(call);
        },
    });
    w.tap("add:st-costco");
    await w.settle();
    // Eggs went through, Milk failed, Chicken was never tried.
    expect(w.calls.map((c) => c.args.food_id)).toEqual([
        "food-eggs",
        "food-milk",
    ]);
    const body = w.html();
    expect(body).toContain("Could not add Milk. Nothing after it was added.");
    expect((body.match(/>Added</g) ?? []).length).toBe(1);
    expect(body).toContain("Add 2 to the Costco list");
    // Retrying skips what is already added.
    fail = false;
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls.map((c) => c.args.food_id)).toEqual([
        "food-eggs",
        "food-milk",
        "food-milk",
        "food-chicken",
    ]);
    expect(w.html()).not.toContain("Could not add");
    expect((w.html().match(/>Added</g) ?? []).length).toBe(3);
});

test("restock-nudge v2: an Add whose answer is lost is marked unsure, stops the run, tells the model and is sent again by the next Add", async () => {
    let milkTries = 0;
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        reply: (call) => {
            if (call.name === "add_grocery_line") {
                // The server took the line, the answer never came back (a
                // transport error, not a refusal); the second try finds it.
                if (call.args.food_id === "food-milk" && milkTries++ === 0) {
                    throw new Error("timeout");
                }
                if (call.args.food_id === "food-milk") {
                    return { status: "ok", id: "ln-1", already_on_list: true };
                }
            }
            return addReply(call);
        },
    });
    w.tap("add:st-costco");
    await w.settle();
    // Eggs went through, Milk's answer was lost, Chicken was never tried.
    expect(w.calls.map((c) => c.args.food_id)).toEqual([
        "food-eggs",
        "food-milk",
    ]);
    const body = w.html();
    expect(body).toContain("May have been added");
    expect(body).not.toContain("Could not add");
    expect(w.contexts.join("\n")).toContain("Milk");
    expect(w.contexts.join("\n")).toContain("may or may not be on the list");
    // The next tap sends Milk again and goes on to Chicken.
    expect(body).toContain("Add 2 to the Costco list");
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls.map((c) => c.args.food_id)).toEqual([
        "food-eggs",
        "food-milk",
        "food-milk",
        "food-chicken",
    ]);
    // The server had Milk already: it reads as on the list, not as added.
    const after = w.html();
    expect(after).not.toContain("May have been added");
    expect((after.match(/>On the list</g) ?? []).length).toBe(1);
    expect((after.match(/>Added</g) ?? []).length).toBe(2);
    expect(after).not.toContain('data-act="add:');
});

test("restock-nudge v2: an answer that says already_on_list shows the row as on the list", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        reply: (call) =>
            call.args.food_id === "food-eggs"
                ? { status: "ok", id: "ln-1", already_on_list: true }
                : addReply(call),
    });
    w.tap("add:st-costco");
    await w.settle();
    const body = w.html();
    expect((body.match(/>On the list</g) ?? []).length).toBe(1);
    expect((body.match(/>Added</g) ?? []).length).toBe(2);
});

test("restock-nudge v2: without canCallTools there is no Add and a tap does nothing", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        canCallTools: false,
    });
    expect(w.html()).toContain(">Eggs<");
    expect(w.html()).not.toContain("data-act=");
    w.tap("add:st-costco");
    await w.settle();
    expect(w.calls).toEqual([]);
});

test("restock-nudge v2: nothing due says so and shows no rows or Add", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({ due: null }),
            usual({ food_id: "f2", due: null }),
        ]),
    });
    const body = w.html();
    expect(body).toContain('class="hd-title">Restock<');
    expect(body).toContain("Nothing to restock today.");
    expect(body).not.toContain(">Eggs<");
    expect(body).not.toContain("data-act=");
    const none = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([]),
    });
    expect(none.html()).toContain("Nothing to restock today.");
});

test("restock-nudge v2: names, products, reasons and stores reach the markup escaped", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([
            usual({
                name: "<img src=x onerror=alert(1)>",
                product_name: '"Q" & <b>Co</b>',
                store_name: "<script>alert(2)</script>",
                due: { reason: "<i>low</i>", trigger: "low" },
            }),
        ]),
    });
    const body = w.html();
    expect(body).not.toContain("<img");
    expect(body).not.toContain("<script>alert");
    expect(body).not.toContain("<b>Co");
    expect(body).not.toContain("<i>low");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
});

test("restock-nudge v2: a result re-sent after an Add keeps what was added", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: COSTCO_THREE(),
        reply: addReply,
    });
    w.tap("add:st-costco");
    await w.settle();
    w.resend(COSTCO_THREE());
    await w.settle();
    expect((w.html().match(/>Added</g) ?? []).length).toBe(3);
});

test("restock-nudge v2: focus stays on the Add button through its repaints", async () => {
    const w = await mountRecipe(await v2Widget("restock-nudge"), {
        data: usualsData([usual(), usual({ food_id: "f2", name: "Milk" })]),
        reply: addReply,
    });
    w.focusOn('[data-act="add:st-costco"]');
    w.tap("add:st-costco");
    await w.settle();
    // Every repaint of the busy and failed/retry states put focus back.
    expect(w.focus.every((s) => s === '[data-act="add:st-costco"]')).toBe(true);
    expect(w.focus.length).toBeGreaterThan(0);
});

// ---- week-plan v2 -----------------------------------------------------------

function planEntry(over: Record<string, unknown> = {}) {
    return {
        plan_id: "plan-1",
        recipe_id: "rec-1",
        recipe_name: "Salmon, rice & spinach",
        slot: "dinner",
        servings: 2,
        kcal_per_portion: 640,
        ...over,
    };
}

const WEEK_DATES: [string, string][] = [
    ["2026-11-14", "Saturday"],
    ["2026-11-15", "Sunday"],
    ["2026-11-16", "Monday"],
    ["2026-11-17", "Tuesday"],
    ["2026-11-18", "Wednesday"],
    ["2026-11-19", "Thursday"],
    ["2026-11-20", "Friday"],
];

function missingLine(over: Record<string, unknown> = {}) {
    return {
        food_id: "food-spinach",
        display_name: "Spinach",
        amount: 200,
        unit: "g",
        unknown: false,
        unmeasured: false,
        needed_by: [
            {
                plan_id: "plan-1",
                recipe_id: "rec-1",
                recipe_name: "Salmon, rice & spinach",
                date: "2026-11-14",
                slot: "dinner",
            },
        ],
        ...over,
    };
}

// The design's week: three planned days, Lemon needed by two of the plans.
function weekData(
    byDate: Record<string, Record<string, unknown>[]> = {
        "2026-11-14": [planEntry()],
        "2026-11-15": [
            planEntry({
                plan_id: "plan-2",
                recipe_name: "Beef chili",
                kcal_per_portion: 520,
            }),
        ],
        "2026-11-16": [
            planEntry({
                plan_id: "plan-3",
                recipe_name: "Chicken rice bowls",
                kcal_per_portion: 852,
            }),
        ],
    },
    over: Record<string, unknown> = {},
) {
    const days = WEEK_DATES.map(([date, weekday]) => ({
        date,
        weekday,
        plans: byDate[date] ?? [],
    }));
    return {
        today: "2026-11-14",
        from: "2026-11-14",
        planned_count: days.reduce((n, d) => n + d.plans.length, 0),
        days,
        missing: [
            missingLine(),
            missingLine({
                food_id: "food-lemon",
                display_name: "Lemon",
                amount: 2,
                unit: "each",
                needed_by: [
                    {
                        plan_id: "plan-1",
                        recipe_id: "rec-1",
                        recipe_name: "Salmon, rice & spinach",
                        date: "2026-11-14",
                        slot: "dinner",
                    },
                    {
                        plan_id: "plan-3",
                        recipe_id: "rec-3",
                        recipe_name: "Chicken rice bowls",
                        date: "2026-11-16",
                        slot: "dinner",
                    },
                ],
            }),
        ],
        ...over,
    };
}

const planReply = (call: RecipeCall) =>
    call.name === "unplan_recipe"
        ? { removed: true, plan_id: call.args.plan_id }
        : call.name === "add_plan_missing_to_groceries"
          ? {
                added: [
                    {
                        line_id: "ln-1",
                        food_id: "food-spinach",
                        display_name: "Spinach",
                        amount: 200,
                        unit: "g",
                        store_id: "st-1",
                        note: null,
                    },
                ],
                on_list: [
                    {
                        food_id: "food-lemon",
                        display_name: "Lemon",
                        existing_line_id: "ln-0",
                    },
                ],
                unknown: [],
                skipped: [],
            }
          : {};

// A server for the card: unplan_recipe forgets the plan, get_week_plan answers
// the same week without the plans removed so far and, unless told otherwise,
// with the missing lines only those plans needed dropped.
function weekReply(
    over: {
        week?: () => Record<string, unknown>;
        missing?: (gone: Set<string>) => unknown[];
        refuse?: string;
    } = {},
) {
    const gone = new Set<string>();
    return (call: RecipeCall) => {
        if (call.name === "unplan_recipe") {
            if (over.refuse) throw new ToolRefusal(over.refuse);
            gone.add(call.args.plan_id as string);
            return planReply(call);
        }
        if (call.name === "get_week_plan") {
            const week = (over.week?.() ?? weekData()) as ReturnType<
                typeof weekData
            >;
            return {
                ...week,
                days: week.days.map((d) => ({
                    ...d,
                    plans: d.plans.filter((p) => !gone.has(String(p.plan_id))),
                })),
                missing:
                    over.missing?.(gone) ??
                    week.missing.filter((m) =>
                        m.needed_by.some((n) => !gone.has(n.plan_id)),
                    ),
            };
        }
        return planReply(call);
    };
}

test("week-plan v2 sample is the design's card: This week, 3 planned, seven days, missing footer, and no writes without a host", async () => {
    const html = await v2Widget("week-plan");
    const body = renderWidget(html, undefined);
    expect(body).toContain('class="hd-title">This week<');
    expect(body).toContain('class="hd-meta">3 planned<');
    for (const d of ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"]) {
        expect(body).toContain(`>${d}<`);
    }
    expect(body).toContain("Salmon, rice &amp; spinach");
    expect(body).toContain("Beef chili");
    expect(body).toContain("Chicken rice bowls");
    expect(body).toContain(">640 kcal<");
    expect(body).toContain(">520 kcal<");
    expect(body).toContain(">852 kcal<");
    expect((body.match(/>Nothing planned</g) ?? []).length).toBe(4);
    expect(body).toContain("2 ingredients missing");
    expect(body).not.toContain("data-act=");
});

test("week-plan v2: every day is a row, a planned recipe shows its kcal per portion, an unknown kcal shows none", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData({
            "2026-11-14": [planEntry({ kcal_per_portion: null })],
        }),
    });
    const body = w.html();
    expect((body.match(/class="pd"/g) ?? []).length).toBe(7);
    expect(body).toContain('class="hd-meta">1 planned<');
    expect(body).toContain("Salmon, rice &amp; spinach");
    expect(body).not.toContain("kcal");
    expect((body.match(/>Nothing planned</g) ?? []).length).toBe(6);
});

test("week-plan v2: a day with two recipes names each one's meal, a day with one does not", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData({
            "2026-11-14": [
                planEntry({
                    plan_id: "p-a",
                    recipe_name: "Oats",
                    slot: "breakfast",
                }),
                planEntry({
                    plan_id: "p-b",
                    recipe_name: "Stew",
                    slot: "dinner",
                }),
            ],
            "2026-11-15": [
                planEntry({
                    plan_id: "p-c",
                    recipe_name: "Soup",
                    slot: "lunch",
                }),
            ],
        }),
    });
    const body = w.html();
    expect(body).toContain(">Breakfast<");
    expect(body).toContain(">Dinner<");
    expect(body).not.toContain(">Lunch<");
    expect(body).toContain('class="hd-meta">3 planned<');
});

test("week-plan v2: Remove sends unplan_recipe with the plan id, then reads the week again for the same window; the entry is gone, the count drops and its day says Nothing planned", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: weekReply(),
    });
    expect(w.html()).toContain('data-act="remove:plan-2"');
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.calls).toEqual([
        { name: "unplan_recipe", args: { plan_id: "plan-2" } },
        { name: "get_week_plan", args: { from: "2026-11-14" } },
    ]);
    const body = w.html();
    expect(body).not.toContain("Beef chili");
    expect(body).not.toContain('data-act="remove:plan-2"');
    expect(body).toContain("Salmon, rice &amp; spinach");
    expect(body).toContain('class="hd-meta">2 planned<');
    expect((body.match(/>Nothing planned</g) ?? []).length).toBe(5);
});

test("week-plan v2: after a Remove the missing count is the server's: a food only that plan needed goes, one another plan also needs stays", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: weekReply(),
    });
    expect(w.html()).toContain("2 ingredients missing");
    w.tap("remove:plan-1");
    await w.settle();
    // Spinach was only for plan-1; Lemon is also for plan-3.
    expect(w.html()).toContain("1 ingredient missing");
    w.tap("remove:plan-3");
    await w.settle();
    expect(w.html()).toContain("Nothing missing");
    expect(w.html()).not.toContain('data-act="add-missing"');
});

test("week-plan v2: the missing count after a Remove is whatever the server answers, not a recount of the lines the card held", async () => {
    // The server finds a third line once plan-2 is gone (an unmeasured need
    // that a measured one had hidden) and keeps Spinach although only
    // plan-1 named it; a recount on the card would say 2 and 1.
    const extra = missingLine({
        food_id: "food-salt",
        display_name: "Salt",
        amount: null,
        unit: null,
        unmeasured: true,
        needed_by: [],
    });
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: weekReply({
            missing: () => [
                missingLine(),
                missingLine({ food_id: "f2" }),
                extra,
            ],
        }),
    });
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.html()).toContain("3 ingredients missing");
    expect(w.html()).toContain('class="hd-meta">2 planned<');
});

test("week-plan v2: when the week cannot be read after a Remove the entry stays gone and the footer is left out", async () => {
    let fail = false;
    const serve = weekReply();
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: (call) => {
            if (fail && call.name === "get_week_plan") {
                throw new ToolRefusal("The week plan is not available.");
            }
            return serve(call);
        },
    });
    fail = true;
    w.tap("remove:plan-2");
    await w.settle();
    const body = w.html();
    expect(body).not.toContain("Beef chili");
    expect(body).toContain('class="hd-meta">2 planned<');
    expect(body).not.toContain("ingredient");
    expect(body).not.toContain("Nothing missing");
    expect(body).not.toContain('data-act="add-missing"');
    // The next Remove that gets its read through brings the footer back.
    fail = false;
    w.tap("remove:plan-3");
    await w.settle();
    expect(w.html()).toContain("ingredient");
    expect(w.html()).toContain('data-act="add-missing"');
});

test("week-plan v2: a Remove the server answers with Plan not found is treated as already removed and reads the week again", async () => {
    const serve = weekReply();
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: (call) => {
            if (call.name === "unplan_recipe") {
                throw new ToolRefusal("Plan not found.");
            }
            return serve(call);
        },
    });
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.calls.map((c) => c.name)).toEqual([
        "unplan_recipe",
        "get_week_plan",
    ]);
    const body = w.html();
    expect(body).not.toContain("Beef chili");
    expect(body).not.toContain("Could not remove");
});

test("week-plan v2: while a Remove is out its button is disabled and a second tap sends nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const serve = weekReply();
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: async (call) => {
            await gate;
            return serve(call);
        },
    });
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.calls.length).toBe(1);
    expect(w.html()).toMatch(
        /<button[^>]*data-act="remove:plan-2"[^>]*disabled/,
    );
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.calls.length).toBe(1);
    // Another entry's Remove is not blocked.
    w.tap("remove:plan-3");
    await w.settle();
    expect(w.calls.map((c) => c.args.plan_id)).toEqual(["plan-2", "plan-3"]);
    release();
    await w.settle();
    expect(w.calls.map((c) => c.name)).toEqual([
        "unplan_recipe",
        "unplan_recipe",
        "get_week_plan",
        "get_week_plan",
    ]);
    expect(w.html()).not.toContain("Beef chili");
    expect(w.html()).not.toContain("Chicken rice bowls");
});

test("week-plan v2: a Remove that fails keeps the entry, says which, and can be tried again", async () => {
    let fail = true;
    const serve = weekReply();
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: (call) => {
            if (fail) throw new ToolRefusal("No such plan.");
            return serve(call);
        },
    });
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.calls.map((c) => c.name)).toEqual(["unplan_recipe"]);
    let body = w.html();
    expect(body).toContain("Beef chili");
    expect(body).toContain("Could not remove Beef chili.");
    expect(body).toContain('class="hd-meta">3 planned<');
    expect(body).not.toMatch(
        /<button[^>]*data-act="remove:plan-2"[^>]*disabled/,
    );
    fail = false;
    w.tap("remove:plan-2");
    await w.settle();
    body = w.html();
    expect(body).not.toContain("Beef chili");
    expect(body).not.toContain("Could not remove");
});

test("week-plan v2: without canCallTools there is no Remove and no add to groceries, and a tap does nothing", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        canCallTools: false,
    });
    const body = w.html();
    expect(body).toContain("Beef chili");
    expect(body).toContain("2 ingredients missing");
    expect(body).not.toContain("data-act=");
    expect(body).not.toContain("Remove");
    expect(body).not.toContain("add to groceries");
    w.tap("remove:plan-2");
    w.tap("add-missing");
    await w.settle();
    expect(w.calls).toEqual([]);
});

test("week-plan v2: add to groceries calls add_plan_missing_to_groceries once with the card's from and shows what was added and what was already listed", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: planReply,
    });
    expect(w.html()).toContain("add to groceries");
    w.tap("add-missing");
    await w.settle();
    expect(w.calls).toEqual([
        {
            name: "add_plan_missing_to_groceries",
            args: { from: "2026-11-14" },
        },
    ]);
    const body = w.html();
    expect(body).toContain("Added 1 to groceries");
    expect(body).toContain("1 already on the list");
    expect(body).not.toContain('data-act="add-missing"');
    // Done: another tap sends nothing.
    w.tap("add-missing");
    await w.settle();
    expect(w.calls.length).toBe(1);
});

test("week-plan v2: add to groceries names the foods whose stock could not be counted and the ones it skipped, escaped", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: () => ({
            added: [],
            on_list: [],
            unknown: [
                {
                    food_id: "f1",
                    display_name: "Rice <b>",
                    notice: "Stock in another unit.",
                },
            ],
            skipped: [
                {
                    food_id: null,
                    display_name: "Salt",
                    reason: "no catalog food <i>",
                },
            ],
        }),
    });
    w.tap("add-missing");
    await w.settle();
    const body = w.html();
    expect(body).toContain("Nothing new to add");
    expect(body).toContain("Check what you have: Rice &lt;b&gt;");
    expect(body).toContain("Skipped: Salt (no catalog food &lt;i&gt;)");
    expect(body).not.toContain("<b>");
    expect(body).not.toContain("<i>");
});

test("week-plan v2: while add to groceries is out its button is disabled and a second tap sends nothing; a failure shows the reason and keeps the button", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let fail = true;
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: async (call) => {
            await gate;
            if (fail) throw new ToolRefusal("Add a store first.");
            return planReply(call);
        },
    });
    w.tap("add-missing");
    await w.settle();
    expect(w.html()).toMatch(/<button[^>]*data-act="add-missing"[^>]*disabled/);
    w.tap("add-missing");
    await w.settle();
    expect(w.calls.length).toBe(1);
    release();
    await w.settle();
    let body = w.html();
    expect(body).toContain("Could not add to groceries. Add a store first.");
    expect(body).toMatch(/<button[^>]*data-act="add-missing"[^>]*>/);
    expect(body).not.toMatch(/<button[^>]*data-act="add-missing"[^>]*disabled/);
    fail = false;
    w.tap("add-missing");
    await w.settle();
    body = w.html();
    expect(w.calls.length).toBe(2);
    expect(body).not.toContain("Could not add");
    expect(body).toContain("Added 1 to groceries");
});

test("week-plan v2: an empty week says Nothing planned seven times and has no footer", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData({}, { missing: [] }),
    });
    const body = w.html();
    expect((body.match(/>Nothing planned</g) ?? []).length).toBe(7);
    expect(body).toContain('class="hd-meta">0 planned<');
    expect(body).not.toContain("ingredient");
    expect(body).not.toContain("Nothing missing");
    expect(body).not.toContain("data-act=");
});

test("week-plan v2: a week with everything in the kitchen says Nothing missing", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(undefined, { missing: [] }),
    });
    expect(w.html()).toContain("Nothing missing");
    expect(w.html()).not.toContain('data-act="add-missing"');
});

test("week-plan v2: recipe names, weekdays and reasons reach the markup escaped", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData({
            "2026-11-14": [
                planEntry({
                    plan_id: 'p"><img src=x>',
                    recipe_name: "<script>alert(1)</script>",
                }),
            ],
        }),
    });
    const body = w.html();
    expect(body).not.toContain("<script>alert");
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("week-plan v2: a result re-sent after a Remove keeps the entry gone", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: weekReply(),
    });
    w.tap("remove:plan-2");
    await w.settle();
    w.resend(weekData());
    await w.settle();
    expect(w.html()).not.toContain("Beef chili");
    expect(w.html()).toContain('class="hd-meta">2 planned<');
});

test("week-plan v2: focus moves to the next Remove when the focused entry is removed, and back to the same one when the Remove fails", async () => {
    let fail = false;
    const serve = weekReply();
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
        reply: (call) => {
            if (fail) throw new ToolRefusal("No such plan.");
            return serve(call);
        },
    });
    fail = true;
    w.focusOn('[data-act="remove:plan-3"]');
    w.tap("remove:plan-3");
    await w.settle();
    expect(w.focus.at(-1)).toBe('[data-act="remove:plan-3"]');
    fail = false;
    w.focus.length = 0;
    w.focusOn('[data-act="remove:plan-2"]');
    w.tap("remove:plan-2");
    await w.settle();
    expect(w.focus.at(-1)).toBe('[data-act="remove:plan-3"]');
});

test("week-plan v2: a plan id with a quote in it still gets its focus back after a failed Remove", async () => {
    let fail = true;
    const serve = weekReply();
    const id = 'p"1\\x';
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData({
            "2026-11-14": [planEntry({ plan_id: id })],
        }),
        reply: (call) => {
            if (fail) throw new ToolRefusal("No such plan.");
            return serve(call);
        },
    });
    const sel = `[data-act="remove:${id.replace(/["\\]/g, (c) => "\\" + c)}"]`;
    w.focusOn(sel);
    w.tap(`remove:${id}`);
    await w.settle();
    expect(w.focus.at(-1)).toBe(sel);
    expect(w.html()).toContain("Could not remove");
});

test("week-plan v2: a card for a later window is titled by its first day, sends that day to add to groceries, and one for the household's today says This week", async () => {
    const later = weekData(
        {},
        {
            from: "2026-11-17",
            today: "2026-11-14",
            days: [
                ["2026-11-17", "Tuesday"],
                ["2026-11-18", "Wednesday"],
                ["2026-11-19", "Thursday"],
                ["2026-11-20", "Friday"],
                ["2026-11-21", "Saturday"],
                ["2026-11-22", "Sunday"],
                ["2026-11-23", "Monday"],
            ].map(([date, weekday], i) => ({
                date,
                weekday,
                plans:
                    i === 0
                        ? [
                              planEntry({
                                  plan_id: "plan-9",
                                  recipe_name: "Stew",
                              }),
                          ]
                        : [],
            })),
        },
    );
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: later,
        reply: planReply,
    });
    expect(w.html()).toContain('class="hd-title">Week of Tue 17 Nov<');
    expect(w.html()).not.toContain(">This week<");
    w.tap("add-missing");
    await w.settle();
    expect(w.calls).toEqual([
        {
            name: "add_plan_missing_to_groceries",
            args: { from: "2026-11-17" },
        },
    ]);
    const now = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(),
    });
    expect(now.html()).toContain('class="hd-title">This week<');
});

test("week-plan v2: a card whose window starts before the household's today has no add to groceries", async () => {
    const w = await mountRecipe(await v2Widget("week-plan"), {
        data: weekData(undefined, { today: "2026-11-15" }),
        reply: planReply,
    });
    const body = w.html();
    expect(body).toContain("2 ingredients missing");
    expect(body).toContain('data-act="remove:plan-2"');
    expect(body).not.toContain("add to groceries");
    w.tap("add-missing");
    await w.settle();
    expect(w.calls).toEqual([]);
});
