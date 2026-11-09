// v2 nutrition components — the calorie gauge, the macro strip (gauge beside
// three bars, the limits row, the water line), the goal list, per-day macro
// rings with their legend, the averages rows and the P/C/F line.
//
// The data logic is v1's and is reused, not copied: MACROS (roles, colours,
// units, ceilings), macroBits, macroCtxOf, limitShown, macroHasDetail,
// tileLabel, MACRO_COPY and DRINK_GRAMS from shared/macros.js, and the
// tested geometry (calorieGauge, macroRings, barFill) that file inlines from
// src/domain/geometry.ts. shared/v2/base.css maps MACROS' v1 colour names to
// v2 tokens, so `m.color` paints in the Theme palette.
//
// Include order in a template's <script>: shared/bridge.js, shared/util.js,
// shared/macros.js, shared/v2/ui.js, then this file. A tile some meal
// contributed to opens the v1 breakdown (macroToggle in shared/macros.js);
// shared/v2/components.css styles it.
//
// Every figure here reads at least 0: a negative amount (a correction logged
// as a meal) shows as 0 with an empty bar, never "-1%".

const V2_MACRO_COPY = {
    kcalLeft: "kcal left",
    kcalOver: "kcal over",
    atGoal: "at goal",
    kcalEaten: "kcal eaten",
    drinks: "drinks",
    noGoal: "no goal",
};

// Reading order of the limits row in the design: the two daily-diet limits,
// then caffeine, then alcohol. It only sorts entries whose role is "limit";
// a new limit entry lands at the end rather than nowhere.
const V2_LIMIT_ORDER = ["sugar_g", "fiber_g", "caffeine_mg", "alcohol_g"];

function v2MacroByKey(key) {
    return MACROS.find((m) => m.key === key);
}

function v2Litres(ml) {
    // "1.6 / 3 L": a tenth, without a trailing ".0". A sip under 50 ml would
    // round to "0" beside a bar that is not empty, so it reads "<0.1".
    const n = Number(ml) || 0;
    const tenth = Math.round(n / 100) / 10;
    return tenth === 0 && n > 0 ? "<0.1" : String(tenth);
}

// A copy of a figures object with every negative number read as 0 (null and
// missing stay as they are: they mean "not recorded").
function v2NonNeg(vals) {
    const out = {};
    for (const [k, x] of Object.entries(vals || {})) {
        out[k] = typeof x === "number" && x < 0 ? 0 : x;
    }
    return out;
}

// The attributes that make a strip tile a button for v1's breakdown toggle
// (the same ones v1's interactiveAttrs writes), as a v2Attrs map.
function v2TileAttrs(m, b) {
    return {
        role: "button",
        tabindex: "0",
        "data-macro": m.key,
        "aria-expanded": "false",
        "aria-label": tileLabel(m, b),
    };
}

function v2Drinks(grams, unit) {
    const n = (Number(grams) || 0) / DRINK_GRAMS[unit];
    return n === 0 ? "0" : n.toFixed(1);
}

// ---- Gauge ----------------------------------------------------------------

// The calorie gauge: a semicircular track with protein, carbs and fat as
// consecutive segments (their kcal share of the goal, from calorieGauge), and
// the figure in the bowl — kcal left, kcal over (in --status-over), or with
// no goal the kcal eaten.
//
// `vals` / `goal` are the strip's plain objects (calories, protein_g, …);
// `attrs` an optional v2Attrs map that replaces the default role="img" and
// label (the strip passes the tile-button attributes).
// Returns { html, status } so a template can word its header from the state.
function gaugeV2(vals, goal, attrs) {
    const v = v2NonNeg(vals);
    const g = calorieGauge(
        {
            goal: goal ? goal.calories : null,
            eaten: v.calories,
            protein_g: v.protein_g,
            carbs_g: v.carbs_g,
            fat_g: v.fat_g,
        },
        GAUGE_SPECS.widget,
    );
    const sw = g.stroke;
    const segs = g.segments
        .map((s) => {
            const m = v2MacroByKey(`${s.key}_g`);
            return `<path d="${s.d}" stroke-width="${sw}" style="stroke:${m ? m.color : "currentColor"}"/>`;
        })
        .join("");
    let value;
    let caption;
    let tone = "";
    if (g.status === "no-goal") {
        value = fmt(v.calories, 0);
        caption = V2_MACRO_COPY.kcalEaten;
    } else if (g.status === "over") {
        value = fmt(-g.remaining, 0);
        caption = V2_MACRO_COPY.kcalOver;
        tone = " is-over";
    } else if (g.status === "at") {
        value = "0";
        caption = V2_MACRO_COPY.atGoal;
    } else {
        value = fmt(g.remaining, 0);
        caption = V2_MACRO_COPY.kcalLeft;
    }
    const label = `${MACRO_COPY.labels.calories}: ${value} ${caption}`;
    const a = v2Attrs(attrs) || v2Attrs({ role: "img", "aria-label": label });
    const html = `<div class="gauge"${a}><svg width="${g.box.width}" height="${g.box.height}" viewBox="0 0 ${g.box.width} ${g.box.height}" aria-hidden="true"><path class="g-track" d="${g.track.d}" stroke-width="${sw}"/>${segs}</svg><div class="gauge-c"><span class="gauge-v${tone}">${value}</span><span class="gauge-k">${esc(caption)}</span></div></div>`;
    return { html, status: g.status };
}

// ---- Strip cells ----------------------------------------------------------

// One protein / carbs / fat bar: dot, name, "96 / 210 g", a 4px bar.
function macroBarV2(m, ctx, interactive) {
    const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
    const sub =
        b.pct != null ? `/ ${fmt(b.target, m.decimals)} ${m.unit}` : m.unit;
    const a = interactive ? v2Attrs(v2TileAttrs(m, b)) : "";
    return `<div class="mb"${a}><div class="mb-row">${v2Dot(m.color)}<span class="mb-l">${esc(macroLabel(m))}</span><span class="v">${fmt(b.val, m.decimals)}</span><span class="vs">${esc(sub)}</span></div>${v2Bar(b.frac, m.color)}</div>`;
}

// One limit cell: name, "31 / 50 g", a 3px bar. Alcohol reads in drinks
// (DRINK_GRAMS, the user's unit). A ceiling past its limit flags the figure
// in --status-over; the bar keeps the metric colour. The limitShown gate is
// v1's: never-recorded alcohol and caffeine render nothing.
function macroLimitV2(m, ctx, interactive) {
    if (!limitShown(m, ctx)) return "";
    const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
    let value;
    let sub;
    if (m.gloss === "drinks") {
        value = v2Drinks(b.val, ctx.drinkUnit);
        sub =
            b.pct != null
                ? `/ ${v2Drinks(b.target, ctx.drinkUnit)} ${V2_MACRO_COPY.drinks}`
                : V2_MACRO_COPY.drinks;
    } else {
        value = fmt(b.val, m.decimals);
        sub =
            b.pct != null ? `/ ${fmt(b.target, m.decimals)} ${m.unit}` : m.unit;
    }
    const flag = b.over && m.direction === "ceiling" ? " is-over" : "";
    const a = interactive ? v2Attrs(v2TileAttrs(m, b)) : "";
    return `<div class="lim"${a}><span class="lim-l">${esc(macroLabel(m))}</span><span class="lim-r"><span class="v${flag}">${value}</span><span class="vs">${esc(sub)}</span></span>${v2Bar(b.frac, m.color, { size: "thin" })}</div>`;
}

// Water: dot, name, a bar to the goal, "1.6 / 3 L".
function macroWaterV2(m, ctx) {
    const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
    const num =
        b.pct != null
            ? `${v2Litres(b.val)} / ${v2Litres(b.target)} L`
            : `${v2Litres(b.val)} L`;
    return `<div class="water">${v2Dot(m.color)}<span class="mb-l">${esc(macroLabel(m))}</span>${v2Bar(b.frac, m.color)}<span class="v">${esc(num)}</span></div>`;
}

function v2Limits(ctx) {
    const rank = (k) => {
        const i = V2_LIMIT_ORDER.indexOf(k);
        return i < 0 ? V2_LIMIT_ORDER.length : i;
    };
    return MACROS.filter((m) => m.role === "limit" && limitShown(m, ctx)).sort(
        (a, b) => rank(a.key) - rank(b.key),
    );
}

// ---- The strip ------------------------------------------------------------

// v1's delegated toggle (shared/macros.js) reads the breakdown from one
// document-wide slot, __macroCtx. Each interactive v2 strip registers its own
// context under a data-macro-strip id, and a capture-phase listener on the
// document points the slot at the tapped strip's context before v1's
// bubble-phase handler reads it, so any number of interactive strips can share
// a document without v1 changing.
const V2_STRIPS = new Map();
let v2StripSeq = 0;

// Point __macroCtx at the strip `target` sits in, if it is a registered v2
// strip. Returns that context, or null (the slot is left alone).
function v2ClaimStrip(target) {
    const strip =
        target && typeof target.closest === "function"
            ? target.closest("[data-macro-strip]")
            : null;
    const ctx = strip
        ? V2_STRIPS.get(strip.getAttribute("data-macro-strip"))
        : null;
    if (!ctx) return null;
    __macroCtx = ctx;
    return ctx;
}

if (typeof document !== "undefined" && !window.__v2StripsWired) {
    window.__v2StripsWired = true;
    const claim = (e) => v2ClaimStrip(e.target);
    document.addEventListener("click", claim, true);
    document.addEventListener("keydown", claim, true);
}

// The macro strip, laid out by role like v1's macroPanel: the gauge beside
// the three macro bars, the limits row (one to four cells), and the water
// line when water was logged.
//
// opts (all optional):
//   meals      per-meal breakdown rows (v1's shape); tiles a meal contributed
//              to become buttons that open the "<metric> by meal" list
//   drinkUnit  "us" | "uk" (default "us")
//   wording    v1's floor wording ({ under, over })
// Returns the HTML string.
function macroStripV2(vals, goal, opts) {
    const o = opts || {};
    const ctx = macroCtxOf(v2NonNeg(vals), goal, o.wording, o.meals, o);

    const cal = MACROS.find((m) => m.role === "cal");
    const trio = MACROS.filter((m) => m.role === "macro");
    const limits = v2Limits(ctx);
    const waters = MACROS.filter(
        (m) => m.role === "bar" && (ctx.vals[m.key] ?? 0) > 0,
    );
    const tap = (m) => macroHasDetail(m, ctx);
    const interactive = [cal, ...trio, ...limits].some(tap);
    // Register the context for v2ClaimStrip. The slot itself is also set
    // here, as v1's macroPanel does, so a strip works even before any tap
    // has been routed; a static strip never touches it.
    let stripId = "";
    if (interactive) {
        stripId = `s${++v2StripSeq}`;
        V2_STRIPS.set(stripId, ctx);
        __macroCtx = ctx;
    }

    const calAttrs = tap(cal)
        ? v2TileAttrs(cal, macroBits(cal, ctx.vals, ctx.goal, ctx.wording))
        : null;
    const gauge = gaugeV2(ctx.vals, ctx.goal, calAttrs).html;
    const bars = trio.map((m) => macroBarV2(m, ctx, tap(m))).join("");
    const limitRow = limits.length
        ? `<div class="limits" style="--n:${limits.length}">${limits
              .map((m) => macroLimitV2(m, ctx, tap(m)))
              .join("")}</div>`
        : "";
    const hint = interactive
        ? `<div class="mhint" data-macro-hint>${esc(MACRO_COPY.tapHint)}</div>`
        : "";
    const detail = interactive
        ? `<div class="macro-detail" hidden aria-live="polite"></div>`
        : "";
    const panelAttrs = interactive
        ? ` data-macro-panel${v2Attrs({ "data-macro-strip": stripId })}`
        : "";
    return `<div class="strip"${panelAttrs}><div class="srow">${gauge}<div class="mbars">${bars}</div></div>${limitRow}${waters
        .map((m) => macroWaterV2(m, ctx))
        .join("")}${hint}${detail}</div>`;
}

// ---- Goal list (goal-progress) --------------------------------------------

// Calories then the three macros, each "Name   1,284 / 2,421 kcal   53%" over
// a 6px bar. With no goal a row shows the amount alone.
function goalListV2(vals, goal) {
    const ctx = macroCtxOf(v2NonNeg(vals), goal);
    const rows = MACROS.filter((m) => m.role === "cal" || m.role === "macro")
        .map((m) => {
            const b = macroBits(m, ctx.vals, ctx.goal);
            const fig =
                b.pct != null
                    ? `${fmt(b.val, m.decimals)} / ${fmt(b.target, m.decimals)} ${m.unit}`
                    : `${fmt(b.val, m.decimals)} ${m.unit}`;
            const pct =
                b.pct != null ? `${Math.round(b.pct)}%` : V2_MACRO_COPY.noGoal;
            return `<div class="gl"><div class="gl-row"><span class="gl-l">${esc(macroLabel(m))}</span><span class="gl-v">${fig}</span><span class="gl-p${b.pct == null ? " t-3" : ""}">${esc(pct)}</span></div>${v2Bar(b.frac, m.color, { size: "thick" })}</div>`;
        })
        .join("");
    return `<div class="goals">${rows}</div>`;
}

// ---- Rings (trends) -------------------------------------------------------

// One cell per day: three concentric arcs (protein outside, fat inside) at
// the phone ring spec, and the day's initial underneath. `days` is
// [{ label, protein_g, carbs_g, fat_g }] — a day with no data (or a null
// day) draws its tracks only. `active` is the index drawn on the inset
// surface (today, or the selected day); any other value highlights nothing.
//
// Up to fourteen days sit in one row; more wrap into two equal rows (thirty
// days: two rows of fifteen). A cell narrower than the ring scales the ring
// down (components.css), so a 30-day range fits a chat card without
// scrolling and seven days draw at the design's full size.
const V2_RING_ROW_MAX = 14;

function ringsV2(days, goal, active) {
    const g = goal || {};
    const list = days || [];
    const cols =
        list.length <= V2_RING_ROW_MAX
            ? Math.max(1, list.length)
            : Math.ceil(list.length / 2);
    const cells = list
        .map((day, i) => {
            const d = v2NonNeg(day);
            const r = macroRings(
                {
                    protein: { value: d.protein_g, goal: g.protein_g },
                    carbs: { value: d.carbs_g, goal: g.carbs_g },
                    fat: { value: d.fat_g, goal: g.fat_g },
                },
                RING_SPECS.phone,
            );
            const paths = r.rings
                .map((ring) => {
                    const m = v2MacroByKey(`${ring.key}_g`);
                    const fill = ring.fill
                        ? `<path d="${ring.fill.d}" stroke-width="${r.stroke}" style="stroke:${m ? m.color : "currentColor"}"/>`
                        : "";
                    return `<path class="r-track" d="${ring.track.d}" stroke-width="${r.stroke}"/>${fill}`;
                })
                .join("");
            return `<div class="rday${i === active ? " on" : ""}"><svg width="${r.box.width}" height="${r.box.height}" viewBox="0 0 ${r.box.width} ${r.box.height}" aria-hidden="true">${paths}</svg><span>${esc(d.label)}</span></div>`;
        })
        .join("");
    return `<div class="rings" style="--cols:${cols}">${cells}</div>`;
}

// Protein · Carbs · Fat key under the rings.
function macroLegendV2() {
    return `<div class="legend">${MACROS.filter((m) => m.role === "macro")
        .map((m) => `<span>${v2Dot(m.color)}${esc(macroLabel(m))}</span>`)
        .join("")}</div>`;
}

// ---- Averages (trends) ----------------------------------------------------

// The three macros then calories as hairline rows: name, a bar whose goal
// marker sits at AVERAGE_GOAL_AT of the track (the fill reaches the marker at
// goal), and "189 / 210" — in --status-over past the goal, as the design
// draws it.
function averagesV2(vals, goal) {
    const v = v2NonNeg(vals);
    const gl = goal || {};
    const order = [
        ...MACROS.filter((m) => m.role === "macro"),
        ...MACROS.filter((m) => m.role === "cal"),
    ];
    return `<div class="rows">${order
        .map((m) => {
            const f = barFill(v[m.key], gl[m.key], {
                goalAt: AVERAGE_GOAL_AT,
            });
            const end =
                f.ratio != null
                    ? `${fmt(v[m.key], m.decimals)} / ${fmt(gl[m.key], m.decimals)}`
                    : fmt(v[m.key], m.decimals);
            return v2Row({
                kind: "avg",
                title: macroLabel(m),
                barHtml: v2Bar(f.fraction, m.color, {
                    goalAt: f.goalMarker,
                }),
                end,
                endTone: f.over ? "over" : "",
            });
        })
        .join("")}</div>`;
}

// ---- P / C / F line and the meal block ------------------------------------

// "P 69  C 76  F 25" in macro colours (a meal, a recipe).
function pcfV2(vals) {
    const v = v2NonNeg(vals);
    return `<span class="pcf"><span class="p">P ${fmt(v.protein_g, 0)}</span><span class="c">C ${fmt(v.carbs_g, 0)}</span><span class="f">F ${fmt(v.fat_g, 0)}</span></span>`;
}

// The meal-logged top block: name over its P/C/F line, "+852 kcal" right.
function mealBlockV2(name, vals) {
    const v = v2NonNeg(vals);
    return `<div class="meal"><div class="meal-t"><span class="meal-n">${esc(name)}</span>${pcfV2(v)}</div><span class="meal-k">+${fmt(v.calories, 0)}</span><span class="fig-u">kcal</span></div>`;
}
