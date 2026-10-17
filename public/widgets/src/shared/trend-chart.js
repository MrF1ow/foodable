// Shared calories-per-day trend chart (plan D5 / U9).
//
// The trends.html version is the superset: padding 8/8/6/4, dot radius 2.2,
// optional `range` and `logged` (current trends behaviour when omitted: range
// and logged default to the series length). Both templates @include this file
// directly. Do not pull it in from another partial: src/widgets.test.ts
// requires every included partial's full text to appear verbatim in the
// assembled HTML.
//
// Calories-per-day trend: SVG area + line that scales to any range
// (7 to 30 days). Compact — a 54-unit-tall viewBox sitting inside
// the widget's panel, not a card of its own. Uniform scaling — no
// preserveAspectRatio distortion — so it keeps its aspect ratio at
// any container width.

function trendChart(days, goal, range, logged) {
    const W = 480,
        H = 54,
        padL = 8,
        padR = 8,
        padT = 6,
        padB = 4;
    const n = days.length;
    // nutrition-summary calls with (days, goal) only. When range/logged are
    // omitted, keep that widget's chead (avg · goal, no date row) so the
    // visible change is the chart geometry: 3 px more side padding and
    // dots 2.6 → 2.2. Trends always passes both, so its chrome is unchanged.
    const trendChrome = range != null;
    if (range == null) range = n;
    if (logged == null) logged = n;
    const vals = days.map((d) => d.calories || 0);
    const maxV = Math.max(...vals, goal || 0, 1) * 1.15;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const base = padT + plotH;
    const x = (i) =>
        n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1);
    const y = (v) => padT + plotH - (v / maxV) * plotH;
    const pts = vals.map((v, i) => [x(i), y(v)]);

    const line = pts
        .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
        .join(" ");
    const area =
        `M${pts[0][0].toFixed(1)} ${base} ` +
        pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") +
        ` L${pts[n - 1][0].toFixed(1)} ${base} Z`;

    const goalLine =
        goal && goal > 0
            ? `<line class="goalline" x1="${padL}" y1="${y(goal).toFixed(1)}" x2="${W - padR}" y2="${y(goal).toFixed(1)}"/>`
            : "";
    // Dots only while they still read as individual days: at 10
    // points they are ~52 units apart, at a fortnight they crowd the
    // line into a beaded string and at a month they are noise.
    const dots =
        n <= 10
            ? pts
                  .map(
                      (p) =>
                          `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="var(--calories)"/>`,
                  )
                  .join("")
            : "";
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / n);
    const md = (d) => esc(d.date.slice(5)); // MM-DD

    if (trendChrome) {
        return `
          <div class="chart">
            <div class="chead">
              <span class="ctitle">${esc(T.nutritionSummary.caloriesPerDay)}</span>
              <span class="cmeta">${tpl(T.trends.loggedOfTotal, { logged, total: n })}</span>
            </div>
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tpl(T.trends.caloriesOverRange, { range }))}">
              <line class="axis" x1="${padL}" y1="${base}" x2="${W - padR}" y2="${base}"/>
              ${goalLine}
              <path d="${area}" fill="var(--calories)" opacity="0.16"/>
              <path d="${line}" fill="none" stroke="var(--calories)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
              ${dots}
            </svg>
            <div class="tdates">
              <span>${md(days[0])}</span>
              <span>${md(days[n - 1])}</span>
            </div>
          </div>`;
    }

    return `
          <div class="chart">
            <div class="chead">
              <span class="ctitle">${esc(T.nutritionSummary.caloriesPerDay)}</span>
              <span class="cmeta">${esc(T.nutritionSummary.avg)} ${fmt(avg, 0)}${goal && goal > 0 ? ` · ${esc(T.nutritionSummary.goal)} ${fmt(goal, 0)}` : ""}</span>
            </div>
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T.nutritionSummary.chartAriaLabel)}">
              <line class="axis" x1="${padL}" y1="${base}" x2="${W - padR}" y2="${base}"/>
              ${goalLine}
              <path d="${area}" fill="var(--calories)" opacity="0.16"/>
              <path d="${line}" fill="none" stroke="var(--calories)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
              ${dots}
            </svg>
          </div>`;
}
