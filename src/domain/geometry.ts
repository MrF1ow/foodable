/*
 * UI gauge, ring and bar geometry (FigCraft source of truth).
 *
 * Phone gauge: Today › Content › Summary › Gauge (children Track, protein, carbs, fat).
 * Desktop gauge: Desktop · Today › Card/Summary › Gauge.
 * Chat widget gauge: get_nutrition_summary › Widget/Nutrition summary › Strip › Gauge.
 * Phone rings: Trends › Week rings › Day N › Day gauge (Track/protein, Track/carbs, Track/fat).
 * Desktop rings: Desktop · Trends › Card/Macros by day › Rings › <Day> › Rings.
 * Today bars: Today › Macro bars › <Macro> › Bar › Fill (height 4).
 * Averages phone: Trends › Averages · last 7 days › Average/<Macro> › Track (Fill, Goal),
 *   height 4, marker 1.5×12 at y −4.
 * Averages desktop: Card/Averages › Avg/<Macro> › Bar (Fill, Goal), height 5,
 *   marker 1.5×11 at y −3, marker x 110.4 of 120 → goalAt 0.92.
 *
 * | Node (design) | radius | stroke | frame (W×H) | notes |
 * |---------------|--------|--------|-------------|-------|
 * | Gauge / Today phone | 92.5 | 11 | 196×103.5 | segment gap 1.44° (starts 180°, 151.45°, 116.36°) |
 * | Gauge / Desktop Card/Summary | 117 | 16 | 250×133 | |
 * | Gauge / chat Strip | 61 | 10 | 132×71 | |
 * | Rings / phone & widget | 18, 12.5, 7 | 4 | 40×22 | spacing 5.5 |
 * | Rings / desktop | 32.5, 23.5, 14.5 | 7 | 72×39.5 | spacing 9 |
 *
 * Design check: goal 2,421, P 96 / C 118 / F 42 → 1,234 macro kcal → 91.75° total arc.
 *
 * Semicircle: fraction f ∈ [0,1] from left end (180°) to right (0°), clockwise over the top.
 * x = cx − r·cos(πf), y = cy − r·sin(πf). Arc path: M x0 y0 A r r 0 0 1 x1 y1.
 *
 * Averages bar mock fills use value/goal of the full track width, while the goal marker sits at
 * 0.92 of the track (desktop 110.4 / 120). This module aligns fill to the marker:
 * fraction = min(ratio × goalAt, 1); at goal the fill ends at the marker; it reaches the track
 * end when ratio ≥ 1/goalAt.
 */

export type MacroKey = "protein" | "carbs" | "fat";
export const MACRO_ORDER: readonly MacroKey[] = ["protein", "carbs", "fat"];
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export type GaugeSpec = { radius: number; stroke: number; gapDeg: number };
export const GAUGE_SPECS: {
    today: GaugeSpec;
    desktop: GaugeSpec;
    widget: GaugeSpec;
} = {
    today: { radius: 92.5, stroke: 11, gapDeg: 1.44 },
    desktop: { radius: 117, stroke: 16, gapDeg: 1.44 },
    widget: { radius: 61, stroke: 10, gapDeg: 1.44 },
};

export type RingSpec = {
    radii: readonly [number, number, number];
    stroke: number;
};
export const RING_SPECS: { phone: RingSpec; desktop: RingSpec } = {
    phone: { radii: [18, 12.5, 7], stroke: 4 },
    desktop: { radii: [32.5, 23.5, 14.5], stroke: 7 },
};

export const AVERAGE_GOAL_AT = 0.92;

export const BAR_SPECS = {
    today: { height: 4 },
    averagePhone: {
        height: 4,
        marker: { width: 1.5, height: 12, y: -4 },
    },
    averageDesktop: {
        height: 5,
        marker: { width: 1.5, height: 11, y: -3 },
    },
} as const;

export type ArcBox = { width: number; height: number; cx: number; cy: number };

export function arcBox(radius: number, stroke: number): ArcBox {
    const cx = geoRound2(radius + stroke / 2);
    const cy = geoRound2(radius + stroke / 2);
    return {
        width: geoRound2(2 * radius + stroke),
        height: geoRound2(radius + stroke),
        cx,
        cy,
    };
}

export function arcPath(
    cx: number,
    cy: number,
    r: number,
    from: number,
    to: number,
): string {
    const a = geoClamp01(from);
    const b = geoClamp01(to);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const [x0, y0] = geoPointOnArc(cx, cy, r, lo);
    const [x1, y1] = geoPointOnArc(cx, cy, r, hi);
    return `M ${geoFmt(x0)} ${geoFmt(y0)} A ${geoFmt(r)} ${geoFmt(r)} 0 0 1 ${geoFmt(x1)} ${geoFmt(y1)}`;
}

export function arcLength(r: number, from: number, to: number): number {
    const a = geoClamp01(from);
    const b = geoClamp01(to);
    const span = Math.abs(b - a);
    return geoRound2(Math.PI * r * span);
}

export type Arc = { d: string; from: number; to: number; length: number };

export type GaugeInput = {
    goal: number | null | undefined;
    eaten: number | null | undefined;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
};

export type GaugeStatus = "no-goal" | "under" | "at" | "over";

export type CalorieGauge = {
    box: ArcBox;
    radius: number;
    stroke: number;
    track: Arc;
    segments: Array<Arc & { key: MacroKey }>;
    status: GaugeStatus;
    remaining: number | null;
    ratio: number | null;
};

export function calorieGauge(
    input: GaugeInput,
    spec: GaugeSpec = GAUGE_SPECS.today,
): CalorieGauge {
    const { radius, stroke, gapDeg } = spec;
    const box = arcBox(radius, stroke);
    const track: Arc = {
        d: arcPath(box.cx, box.cy, radius, 0, 1),
        from: 0,
        to: 1,
        length: arcLength(radius, 0, 1),
    };

    const goal = geoFinitePositive(input.goal);
    const eaten = geoFiniteNonNeg(input.eaten);
    const protein_g = geoFiniteNonNeg(input.protein_g);
    const carbs_g = geoFiniteNonNeg(input.carbs_g);
    const fat_g = geoFiniteNonNeg(input.fat_g);

    if (goal === null) {
        return {
            box,
            radius,
            stroke,
            track,
            segments: [],
            status: "no-goal",
            remaining: null,
            ratio: null,
        };
    }

    const remaining = Math.round(goal) - Math.round(eaten);
    const ratio = eaten / goal;
    let status: GaugeStatus = "under";
    if (remaining === 0) status = "at";
    else if (remaining < 0) status = "over";

    const grams: Record<MacroKey, number> = {
        protein: protein_g,
        carbs: carbs_g,
        fat: fat_g,
    };
    const kcals = MACRO_ORDER.map((key) => grams[key] * KCAL_PER_GRAM[key]);
    const kcalSum = kcals.reduce((a, b) => a + b, 0);
    // A caller-supplied gap that is negative or not finite would make
    // segments overlap or carry NaN ends; treat it as no gap.
    const gap = (Number.isFinite(gapDeg) ? Math.max(0, gapDeg) : 0) / 180;

    const shareByKey: Record<MacroKey, number> = {
        protein: 0,
        carbs: 0,
        fat: 0,
    };
    if (kcalSum > 0) {
        const scale = kcalSum > goal ? 1 / kcalSum : 1 / goal;
        for (let i = 0; i < MACRO_ORDER.length; i++) {
            const key = MACRO_ORDER[i]!;
            shareByKey[key] = (kcals[i] ?? 0) * scale;
        }
    }

    const segments: Array<Arc & { key: MacroKey }> = [];
    let cursor = 0;
    for (const key of MACRO_ORDER) {
        const share = shareByKey[key];
        if (share <= 0) continue;
        const from = cursor;
        const to = cursor + share - gap;
        if (to <= from) {
            cursor += share;
            continue;
        }
        const cappedTo = Math.min(to, 1);
        if (cappedTo <= from) {
            cursor += share;
            continue;
        }
        segments.push({
            key,
            from,
            to: cappedTo,
            d: arcPath(box.cx, box.cy, radius, from, cappedTo),
            length: arcLength(radius, from, cappedTo),
        });
        cursor += share;
    }

    return {
        box,
        radius,
        stroke,
        track,
        segments,
        status,
        remaining,
        ratio,
    };
}

export type RingDay = Record<
    MacroKey,
    { value: number | null | undefined; goal: number | null | undefined }
>;

export type MacroRing = {
    key: MacroKey;
    radius: number;
    track: Arc;
    fill: Arc | null;
    ratio: number | null;
    percent: number | null;
    fraction: number;
    over: boolean;
};

export function macroRings(
    day: RingDay,
    spec: RingSpec = RING_SPECS.phone,
): { box: ArcBox; stroke: number; rings: MacroRing[] } {
    const { radii, stroke } = spec;
    const outer = radii[0];
    const box = arcBox(outer, stroke);

    const rings: MacroRing[] = [];
    for (let i = 0; i < MACRO_ORDER.length; i++) {
        const key = MACRO_ORDER[i]!;
        const radius = radii[i]!;
        const { value: rawVal, goal: rawGoal } = day[key];
        const value = geoFiniteNonNeg(rawVal);
        const goal = geoFinitePositive(rawGoal);

        const track: Arc = {
            d: arcPath(box.cx, box.cy, radius, 0, 1),
            from: 0,
            to: 1,
            length: arcLength(radius, 0, 1),
        };

        let ratio: number | null = null;
        let percent: number | null = null;
        let fraction = 0;
        let over = false;
        let fill: Arc | null = null;

        if (goal !== null) {
            ratio = value / goal;
            percent = Math.round(ratio * 100);
            fraction = Math.min(ratio, 1);
            over = value > goal;
            if (value > 0) {
                fill = {
                    d: arcPath(box.cx, box.cy, radius, 0, fraction),
                    from: 0,
                    to: fraction,
                    length: arcLength(radius, 0, fraction),
                };
            }
        }

        rings.push({
            key,
            radius,
            track,
            fill,
            ratio,
            percent,
            fraction,
            over,
        });
    }

    return { box, stroke, rings };
}

export type BarFill = {
    fraction: number;
    ratio: number | null;
    percent: number | null;
    over: boolean;
    goalMarker: number | null;
};

function geoResolveGoalAt(raw: number | undefined): number {
    if (raw === undefined || !Number.isFinite(raw)) {
        return 1;
    }
    return Math.min(1, Math.max(0, raw));
}

export function barFill(
    value: number | null | undefined,
    goal: number | null | undefined,
    opts?: { goalAt?: number },
): BarFill {
    const goalAt = geoResolveGoalAt(opts?.goalAt);
    const v = geoFiniteNonNeg(value);
    const g = geoFinitePositive(goal);

    if (g === null) {
        return {
            fraction: 0,
            ratio: null,
            percent: null,
            over: false,
            goalMarker: null,
        };
    }

    const ratio = v / g;
    const fraction = Math.min(ratio * goalAt, 1);
    return {
        fraction,
        ratio,
        percent: Math.round(ratio * 100),
        over: v > g,
        goalMarker: goalAt,
    };
}

function geoPointOnArc(
    cx: number,
    cy: number,
    r: number,
    f: number,
): [number, number] {
    const t = Math.PI * f;
    return [geoRound2(cx - r * Math.cos(t)), geoRound2(cy - r * Math.sin(t))];
}

function geoClamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

function geoFmt(n: number): string {
    return Object.is(geoRound2(n), -0) ? "0" : String(geoRound2(n));
}

function geoRound2(n: number): number {
    if (!Number.isFinite(n)) return 0;
    const r = Math.round(n * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
}

function geoFiniteNonNeg(n: number | null | undefined): number {
    if (n === null || n === undefined || !Number.isFinite(n) || n < 0) {
        return 0;
    }
    return n;
}

function geoFinitePositive(n: number | null | undefined): number | null {
    if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) {
        return null;
    }
    return n;
}
