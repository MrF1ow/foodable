// v2 markup builders for the generic pieces of a card: header, group label,
// bars, hairline rows, chips, tags, the range toggle, tiles, tips, figures and
// buttons. Each returns an HTML string styled by shared/v2/components.css;
// none knows about nutrition (that is shared/v2/macros.js).
//
// Requires esc() from shared/util.js and MACROS from shared/macros.js. Include
// this file directly from the template, after both — never from another
// partial (src/widgets.test.ts checks every included partial appears
// verbatim).
//
// Nothing a caller passes reaches the markup unchecked:
//   - text is escaped;
//   - attributes are a map { "data-id": value, … } (v2Attrs): names outside
//     data-*, aria-*, role, tabindex and title are dropped, values escaped;
//   - tones, sizes and kinds are enums, and an unknown value is dropped;
//   - colours are a token name ("accent-fill"), its var(--…), or a MACROS
//     colour ("var(--protein)"); anything else is dropped.
// Only arguments named `html` (or ending in Html) are trusted markup, and
// they must come from another builder.
//
// Tones: "over" (status red), "warn" (status amber), "dim" (tertiary), or
// nothing. A dot takes the tone as its colour; text takes it as its colour.
// Text also takes "ok" (accent text).

const V2_TONE_TEXT = {
    over: "is-over",
    warn: "is-warn",
    dim: "is-dim",
    ok: "is-ok",
};
const V2_TONE_DOT = { over: "s-over", warn: "s-warn", dim: "s-dim" };
const V2_BAR_SIZES = { thin: "thin", thick: "thick" };
const V2_ROW_KINDS = { avg: "avg" };
const V2_END_KINDS = { date: "date" };

// Theme tokens a caller may name as a colour, beside every MACROS colour.
const V2_COLOR_TOKENS = [
    "accent-fill",
    "accent-text",
    "status-over",
    "status-warn",
    "text-primary",
    "text-secondary",
    "text-tertiary",
    "macro-calories",
    "macro-protein",
    "macro-carbs",
    "macro-fat",
    "nutrient-water",
    "nutrient-fiber",
    "nutrient-sugar",
    "nutrient-caffeine",
    "nutrient-alcohol",
];

const V2_ATTR_NAME = /^(data-[a-z0-9-]+|aria-[a-z-]+|role|tabindex|title)$/;

function v2ToneText(tone) {
    return Object.hasOwn(V2_TONE_TEXT, tone) ? V2_TONE_TEXT[tone] : "";
}

// Look `key` up in an enum map; anything else is "".
function v2Enum(map, key) {
    return Object.hasOwn(map, key) ? map[key] : "";
}

// A colour expression safe to put in a style attribute, or "".
function v2Color(c) {
    if (typeof c !== "string") return "";
    if (MACROS.some((m) => m.color === c)) return c;
    const name = c.startsWith("var(--") && c.endsWith(")") ? c.slice(6, -1) : c;
    return V2_COLOR_TOKENS.includes(name) ? `var(--${name})` : "";
}

// An attribute map as markup: ` name="value"` per safe entry. A null,
// undefined or boolean value drops the entry (write "true" / "false" for
// aria-*); anything but a plain object, a raw string especially, yields "".
function v2Attrs(attrs) {
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return "";
    return Object.keys(attrs)
        .filter((k) => V2_ATTR_NAME.test(k))
        .map((k) => {
            const v = attrs[k];
            if (v == null || v === false || v === true) return "";
            return ` ${k}="${esc(v)}"`;
        })
        .join("");
}

// One clamped fraction for every bar and toggle that reads a ratio.
function v2Frac(f) {
    const n = Number(f);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

// Card header: title left, then either a meta line or `endHtml` (a range
// toggle) on the right.
function v2Header(title, meta, endHtml) {
    const end =
        endHtml ||
        (meta != null && meta !== ""
            ? `<span class="hd-meta">${esc(meta)}</span>`
            : "");
    return `<div class="hd"><h2 class="hd-title">${esc(title)}</h2>${end}</div>`;
}

// Uppercase group label with an optional count on the right.
function v2Label(text, count) {
    const n = count != null ? `<span class="lbl-n">${esc(count)}</span>` : "";
    return `<div class="lbl">${esc(text)}${n}</div>`;
}

// A dot in a metric colour (`color`, see v2Color) or a tone.
function v2Dot(color, tone, large) {
    const t = v2Enum(V2_TONE_DOT, tone);
    const c = v2Color(color);
    const cls = `dot${large ? " lg" : ""}${t ? ` ${t}` : ""}`;
    const style = c ? ` style="--c:${c}"` : "";
    return `<span class="${cls}"${style}></span>`;
}

// Track + fill. `fraction` is 0..1 of the track; `opts.size` is "thin" (3px,
// limits) or "thick" (6px, goal list), default 4px; `opts.goalAt` (0..1)
// draws the goal marker the averages use.
function v2Bar(fraction, color, opts) {
    const o = opts || {};
    const sz = v2Enum(V2_BAR_SIZES, o.size);
    const size = sz ? ` ${sz}` : "";
    const f = v2Frac(fraction);
    const c = v2Color(color);
    const fill =
        f > 0
            ? `<i style="width:${(f * 100).toFixed(1)}%${c ? `;--c:${c}` : ""}"></i>`
            : "";
    const goal =
        o.goalAt != null
            ? `<b style="left:${(v2Frac(o.goalAt) * 100).toFixed(1)}%"></b>`
            : "";
    return `<div class="bar${size}">${fill}${goal}</div>`;
}

// One hairline row. Every field is optional except `title`:
//   dot: { color } | { tone }       leading status dot (7px)
//   check: boolean                  leading grocery tick (true = ticked)
//   checkLabel: string              accessible name for the tick
//   sub, subTone                    secondary text beside the title
//   tag                             a pill after the sub ("usual")
//   end, endTone, endKind           right-aligned text; endKind "date" = 11px tertiary
//   barHtml                         a bar between title and end (averages)
//   action, actionAttrs             a right-aligned accent button
//   done                            ticked: title struck through and dimmed
//   kind                            row variant: "avg"
//   attrs                           attribute map for the row (v2Attrs)
function v2Row(r) {
    const parts = [];
    if (r.dot) parts.push(v2Dot(r.dot.color, r.dot.tone, true));
    if (r.check != null) {
        parts.push(
            `<button type="button" class="check${r.check ? " on" : ""}" aria-pressed="${r.check ? "true" : "false"}" aria-label="${esc(r.checkLabel || r.title)}"><svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M1.5 5.2 5.2 8.6 12.5 1.4"/></svg></button>`,
        );
    }
    parts.push(`<span class="row-t">${esc(r.title)}</span>`);
    if (r.sub != null && r.sub !== "") {
        const tone = v2ToneText(r.subTone);
        parts.push(
            `<span class="row-s${tone ? ` ${tone}` : ""}">${esc(r.sub)}</span>`,
        );
    }
    if (r.tag) parts.push(v2Tag(r.tag));
    if (r.barHtml) parts.push(r.barHtml);
    if (r.end != null && r.end !== "") {
        const tone = v2ToneText(r.endTone);
        const ek = v2Enum(V2_END_KINDS, r.endKind);
        const kind = ek ? ` ${ek}` : "";
        parts.push(
            `<span class="row-end${kind}${tone ? ` ${tone}` : ""}">${esc(r.end)}</span>`,
        );
    }
    if (r.action) {
        parts.push(
            `<button type="button" class="act"${v2Attrs(r.actionAttrs)}>${esc(r.action)}</button>`,
        );
    }
    const k = v2Enum(V2_ROW_KINDS, r.kind);
    const cls = `row${r.done ? " done" : ""}${k ? ` ${k}` : ""}`;
    return `<div class="${cls}"${v2Attrs(r.attrs)}>${parts.join("")}</div>`;
}

// A labelled group of hairline rows; `rows` is an array of v2Row inputs.
function v2Group(label, rows, count) {
    return `<div class="grp">${label ? v2Label(label, count) : ""}<div class="rows">${rows
        .map(v2Row)
        .join("")}</div></div>`;
}

// Store chips: [{ label, count, on, attrs }] (attrs: see v2Attrs).
function v2Chips(items) {
    return `<div class="chips">${items
        .map(
            (c) =>
                `<button type="button" class="chip" aria-pressed="${c.on ? "true" : "false"}"${v2Attrs(c.attrs)}>${esc(c.label)}${
                    c.count != null
                        ? `<span class="chip-n">${esc(c.count)}</span>`
                        : ""
                }</button>`,
        )
        .join("")}</div>`;
}

function v2Tag(text) {
    return `<span class="tag">${esc(text)}</span>`;
}

// Range toggle: options [{ value, label }], `active` the selected value.
// Buttons carry data-range="<value>" for the template's click handler.
function v2Seg(options, active, ariaLabel) {
    return `<div class="seg" role="group"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ""}>${options
        .map(
            (o) =>
                `<button type="button" data-range="${esc(o.value)}" aria-pressed="${String(o.value) === String(active) ? "true" : "false"}">${esc(o.label)}</button>`,
        )
        .join("")}</div>`;
}

// Use-soon tiles: [{ when, tone, name }] — three across.
function v2Tiles(items) {
    return `<div class="tiles">${items
        .map((t) => {
            const tone = v2ToneText(t.tone);
            return `<div class="tile"><span class="tile-w${tone ? ` ${tone}` : ""}">${esc(t.when)}</span><span class="tile-n">${esc(t.name)}</span></div>`;
        })
        .join("")}</div>`;
}

// A dot and one sentence (goal-progress's pace line).
function v2Tip(text, color) {
    return `<div class="tip">${v2Dot(color || "accent-fill")}<span>${esc(text)}</span></div>`;
}

// Figures in a line: [{ value, unit, xl }] plus optional `endHtml` on the
// right ("↓ 1.2 lb this month").
function v2Figures(items, endHtml) {
    const body = items
        .map(
            (f) =>
                `<span class="fig-v${f.xl ? " xl" : ""}">${esc(f.value)}</span>${
                    f.unit ? `<span class="fig-u">${esc(f.unit)}</span>` : ""
                }`,
        )
        .join("");
    return `<div class="fig">${body}${endHtml ? `<span class="fig-end">${endHtml}</span>` : ""}</div>`;
}

// Buttons in a row: [{ label, primary, attrs }] (attrs: see v2Attrs).
function v2Buttons(items) {
    return `<div class="btns">${items
        .map(
            (b) =>
                `<button type="button" class="btn${b.primary ? " primary" : ""}"${v2Attrs(b.attrs)}>${esc(b.label)}</button>`,
        )
        .join("")}</div>`;
}

// Card markup lives under #widget-mount inside #root. bridge.js appends the
// chat settings footer as a sibling after render(), so in-widget re-renders
// must not assign #root.innerHTML.
function v2Mount() {
    const root = document.getElementById("root");
    let el = document.getElementById("widget-mount");
    if (!el) {
        el = document.createElement("div");
        el.id = "widget-mount";
        root.appendChild(el);
    }
    return el;
}

function v2Paint(html) {
    v2Mount().innerHTML = html;
}

// The bridge's render entry: start from an empty #root, so neither the
// loading placeholder nor a footer from an earlier tool result survives,
// then draw. In-widget re-renders call the template's render (or v2Paint)
// directly and keep the footer.
function v2BridgeRender(render) {
    return (data) => {
        document.getElementById("root").innerHTML = "";
        render(data);
    };
}
