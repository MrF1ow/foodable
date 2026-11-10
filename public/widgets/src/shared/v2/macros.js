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
    const st = g.status;
    const value =
        st === "no-goal"
            ? fmt(v.calories, 0)
            : st === "at"
              ? "0"
              : fmt(Math.abs(g.remaining), 0);
    const caption =
        V2_MACRO_COPY[
            { "no-goal": "kcalEaten", over: "kcalOver", at: "atGoal" }[st] ||
                "kcalLeft"
        ];
    const tone = st === "over" ? " is-over" : "";
    const label = `${MACRO_COPY.labels.calories}: ${value} ${caption}`;
    const a = v2Attrs(attrs) || v2Attrs({ role: "img", "aria-label": label });
    const html = `<div class="gauge"${a}><svg width="${g.box.width}" height="${g.box.height}" viewBox="0 0 ${g.box.width} ${g.box.height}" aria-hidden="true"><path class="g-track" d="${g.track.d}" stroke-width="${sw}"/>${segs}</svg><div class="gauge-c"><span class="gauge-v${tone}">${value}</span><span class="gauge-k">${esc(caption)}</span></div></div>`;
    return { html, status: g.status };
}

// ---- Strip cells ----------------------------------------------------------

// "/ 210 g" against a goal, or the bare unit without one; `show` formats
// the target.
function v2Sub(b, unit, show) {
    return b.pct != null ? `/ ${show(b.target)} ${unit}` : unit;
}

// One protein / carbs / fat bar: dot, name, "96 / 210 g", a 4px bar.
function macroBarV2(m, ctx, interactive) {
    const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
    const sub = v2Sub(b, m.unit, (x) => fmt(x, m.decimals));
    const a = interactive ? v2Attrs(v2TileAttrs(m, b)) : "";
    return `<div class="mb"${a}><div class="mb-row">${v2Dot(m.color)}<span class="mb-l">${esc(macroLabel(m))}</span><span class="v">${fmt(b.val, m.decimals)}</span><span class="vs">${esc(sub)}</span></div>${v2Bar(b.frac, m.color)}</div>`;
}

// One limit cell: name, "31 / 50 g", a 3px bar. Alcohol reads in drinks or
// UK units (DRINK_GRAMS, the user's unit). A ceiling past its limit flags the figure
// in --status-over; the bar keeps the metric colour. The limitShown gate is
// v1's: never-recorded alcohol and caffeine render nothing.
function macroLimitV2(m, ctx, interactive) {
    if (!limitShown(m, ctx)) return "";
    const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
    const drinks = m.gloss === "drinks";
    const show = (x) =>
        drinks ? v2Drinks(x, ctx.drinkUnit) : fmt(x, m.decimals);
    const value = show(b.val);
    // US drinks read "drinks" as the design draws them; UK units keep v1's
    // name, since 2.0 of them is not 2.0 drinks.
    const unit =
        ctx.drinkUnit === "uk"
            ? MACRO_COPY.drinkLabels.uk
            : V2_MACRO_COPY.drinks;
    const sub = v2Sub(b, drinks ? unit : m.unit, show);
    const flag = b.over && m.direction === "ceiling" ? " is-over" : "";
    const a = interactive ? v2Attrs(v2TileAttrs(m, b)) : "";
    return `<div class="lim"${a}><span class="lim-l">${esc(macroLabel(m))}</span><span class="lim-r"><span class="v${flag}">${value}</span><span class="vs">${esc(sub)}</span></span>${v2Bar(b.frac, m.color, { size: "thin" })}</div>`;
}

// Water: dot, name, a bar to the goal, "1.6 / 3 L".
function macroWaterV2(m, ctx) {
    const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
    const num = `${v2Litres(b.val)} ${v2Sub(b, "L", v2Litres)}`;
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

// The strip's context (v1's macroCtxOf) from a panel's arguments and opts.
function v2Ctx(vals, goal, opts) {
    return macroCtxOf(v2NonNeg(vals), goal, opts?.wording, opts?.meals, opts);
}

// A breakdown panel (the strip, a goal list with opts): `body(tap)` draws the
// panel's own tiles, then come the limits row for `limits` (from v2Limits)
// and, when `water` is set, the water line if water was logged. `tap(m)` says
// whether metric m opens a breakdown. A panel with a tappable tile among
// `tiles` and `limits` registers its context under a fresh strip id and
// points the slot at it, as v1's macroPanel does, so it works before any tap
// has been routed, and carries the hint and the detail region; a static
// panel never touches the slot.
function v2Panel(ctx, tiles, limits, water, body) {
    const tap = (m) => macroHasDetail(m, ctx);
    let attrs = "";
    let tail = "";
    if ([...tiles, ...limits].some(tap)) {
        const id = `s${++v2StripSeq}`;
        V2_STRIPS.set(id, ctx);
        __macroCtx = ctx;
        attrs = ` data-macro-panel${v2Attrs({ "data-macro-strip": id })}`;
        tail = `<div class="mhint" data-macro-hint>${esc(MACRO_COPY.tapHint)}</div><div class="macro-detail" hidden aria-live="polite"></div>`;
    }
    const limitRow = limits.length
        ? `<div class="limits" style="--n:${limits.length}">${limits
              .map((m) => macroLimitV2(m, ctx, tap(m)))
              .join("")}</div>`
        : "";
    const waters = water
        ? MACROS.filter((m) => m.role === "bar" && (ctx.vals[m.key] ?? 0) > 0)
              .map((m) => macroWaterV2(m, ctx))
              .join("")
        : "";
    return `<div class="strip"${attrs}>${body(tap)}${limitRow}${waters}${tail}</div>`;
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
    const ctx = v2Ctx(vals, goal, opts);
    const cal = MACROS.find((m) => m.role === "cal");
    const trio = MACROS.filter((m) => m.role === "macro");
    return v2Panel(ctx, [cal, ...trio], v2Limits(ctx), true, (tap) => {
        const calAttrs = tap(cal)
            ? v2TileAttrs(cal, macroBits(cal, ctx.vals, ctx.goal, ctx.wording))
            : null;
        const gauge = gaugeV2(ctx.vals, ctx.goal, calAttrs).html;
        const bars = trio.map((m) => macroBarV2(m, ctx, tap(m))).join("");
        return `<div class="srow">${gauge}<div class="mbars">${bars}</div></div>`;
    });
}

// ---- Goal list (goal-progress) --------------------------------------------

// Calories then the three macros, each "Name   1,284 / 2,421 kcal   53%" over
// a 6px bar. With no goal a row shows the amount alone.
//
// opts (all optional) make it a breakdown panel like the strip:
//   meals       per-meal breakdown rows (v1's shape); rows and limit cells a
//               meal contributed to become buttons that open the "<metric>
//               by meal" list, under the list's own strip id
//   drinkUnit   "us" | "uk", for alcohol in the limits row
//   wording     v1's floor wording ({ under, over })
//   withLimits  append the strip's limits row
//   withWater   append the strip's water line (when water was logged)
// Without opts it returns the bare `.goals` list; with opts the list and its
// extras sit in one `.strip` panel.
function goalListV2(vals, goal, opts) {
    const ctx = v2Ctx(vals, goal, opts);
    const listed = MACROS.filter((m) => m.role === "cal" || m.role === "macro");
    const list = (tap) =>
        `<div class="goals">${listed
            .map((m) => {
                const b = macroBits(m, ctx.vals, ctx.goal, ctx.wording);
                const pct =
                    b.pct != null
                        ? `${Math.round(b.pct)}%`
                        : V2_MACRO_COPY.noGoal;
                const a = tap(m) ? v2Attrs(v2TileAttrs(m, b)) : "";
                return `<div class="gl"${a}><div class="gl-row"><span class="gl-l">${esc(macroLabel(m))}</span><span class="gl-v">${fmt(b.val, m.decimals)} ${v2Sub(b, m.unit, (x) => fmt(x, m.decimals))}</span><span class="gl-p${b.pct == null ? " t-3" : ""}">${esc(pct)}</span></div>${v2Bar(b.frac, m.color, { size: "thick" })}</div>`;
            })
            .join("")}</div>`;
    if (!opts) return list(() => false);
    return v2Panel(
        ctx,
        listed,
        opts.withLimits ? v2Limits(ctx) : [],
        opts.withWater,
        list,
    );
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

// "P 69  C 76  F 25" in macro colours (a meal, a recipe). An unrecorded part
// (null or missing) is left out rather than read as 0, and with none of the
// three recorded there is no line at all. A recorded 0 still shows.
function pcfV2(vals) {
    const v = v2NonNeg(vals);
    const parts = [
        ["p", "P", v.protein_g],
        ["c", "C", v.carbs_g],
        ["f", "F", v.fat_g],
    ]
        .filter((p) => p[2] != null)
        .map(([c, l, x]) => `<span class="${c}">${l} ${fmt(x, 0)}</span>`);
    return parts.length ? `<span class="pcf">${parts.join("")}</span>` : "";
}

// The meal-logged top block: name over its P/C/F line, "+852 kcal" right.
// A meal with no calorie figure (null or missing) shows none, as v1 does:
// "+0 kcal" would claim a measured zero. A recorded 0 still reads "+0".
function mealBlockV2(name, vals) {
    const v = v2NonNeg(vals);
    const kcal =
        v.calories == null
            ? ""
            : `<span class="meal-k">+${fmt(v.calories, 0)}</span><span class="fig-u">kcal</span>`;
    return `<div class="meal"><div class="meal-t"><span class="meal-n">${esc(name)}</span>${pcfV2(v)}</div>${kcal}</div>`;
}
