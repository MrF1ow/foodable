export type SparklineOpts = {
    width: number;
    height: number;
    padX?: number;
    padY?: number;
    strokeWidth?: number;
    className?: string;
};

/** Hand-built SVG sparkline (line + gradient area) for desktop cards. */
export function sparklineSvg(
    values: readonly number[],
    opts: SparklineOpts,
): string {
    if (values.length === 0) return "";
    const W = opts.width;
    const H = opts.height;
    const padL = opts.padX ?? 0;
    const padR = opts.padX ?? 0;
    const padT = opts.padY ?? 8;
    const padB = opts.padY ?? 8;
    const stroke = opts.strokeWidth ?? 2;
    const cls = opts.className ?? "fd-sparkline";
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const base = padT + plotH;
    const ymin = Math.min(...values);
    const ymax = Math.max(...values);
    const flat = ymin === ymax;
    const span = flat ? 1 : ymax - ymin;
    const n = values.length;
    const xAt = (i: number) =>
        n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1);
    const yAt = (v: number) =>
        flat ? padT + plotH / 2 : padT + plotH - ((v - ymin) / span) * plotH;
    const coords = values.map((v, i) => [xAt(i), yAt(v)] as const);
    const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
    const line =
        n >= 2
            ? coords
                  .map((p, i) => `${i ? "L" : "M"}${fmt(p[0])} ${fmt(p[1])}`)
                  .join(" ")
            : `M${fmt(coords[0]![0])} ${fmt(coords[0]![1])}`;
    const area =
        n >= 2
            ? `M${fmt(coords[0]![0])} ${base} ` +
              coords.map((p) => `L${fmt(p[0])} ${fmt(p[1])}`).join(" ") +
              ` L${fmt(coords[n - 1]![0])} ${base} Z`
            : "";
    const areaTag = area ? `<path class="${cls}__area" d="${area}"/>` : "";
    const dotTag =
        n === 1
            ? `<circle class="${cls}__dot" cx="${fmt(coords[0]![0])}" cy="${fmt(coords[0]![1])}" r="${stroke + 1}" fill="currentColor"/>`
            : "";
    return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">${areaTag}<path class="${cls}__line" d="${line}" fill="none" stroke-width="${stroke}"/>${dotTag}</svg>`;
}
