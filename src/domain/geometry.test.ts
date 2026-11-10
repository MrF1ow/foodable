import { expect, test } from "bun:test";
import { Glob } from "bun";
import {
    AVERAGE_GOAL_AT,
    arcBox,
    arcLength,
    arcPath,
    barFill,
    calorieGauge,
    GAUGE_SPECS,
    macroRings,
    RING_SPECS,
} from "./geometry.js";

const TOP_LEVEL_NAME_RE = /^(?:export\s+)?(?:function|const|let)\s+(\w+)/;

function topLevelNames(src: string): Set<string> {
    const names = new Set<string>();
    for (const line of src.split("\n")) {
        const m = TOP_LEVEL_NAME_RE.exec(line);
        if (m) names.add(m[1]!);
    }
    return names;
}

test("geometry.ts has no runtime imports (@inlinets)", async () => {
    const src = await Bun.file(`${import.meta.dir}/geometry.ts`).text();
    expect(/^\s*import\s/m.test(src)).toBe(false);
});

test("geometry top-level names do not collide with widget inline scope", async () => {
    const geoSrc = await Bun.file(`${import.meta.dir}/geometry.ts`).text();
    const geoNames = topLevelNames(geoSrc);

    const root = `${import.meta.dir}/../..`;
    const paths: string[] = [
        `${root}/src/domain/csv.ts`,
        ...(
            await Array.fromAsync(
                new Glob("public/widgets/src/shared/*.js").scan({ cwd: root }),
            )
        ).map((p) => `${root}/${p}`),
    ];

    const external = new Set<string>();
    for (const path of paths) {
        const src = await Bun.file(path).text();
        for (const name of topLevelNames(src)) external.add(name);
    }

    const overlap = [...geoNames].filter((n) => external.has(n));
    expect(overlap).toEqual([]);
});

test("arcBox today gauge frame", () => {
    const box = arcBox(92.5, 11);
    expect(box).toEqual({ width: 196, height: 103.5, cx: 98, cy: 98 });
});

test("track path for today spec", () => {
    const g = calorieGauge(
        { goal: 2421, eaten: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
        GAUGE_SPECS.today,
    );
    expect(g.track.d).toBe("M 5.5 98 A 92.5 92.5 0 0 1 190.5 98");
});

test("arcPath rounds coordinates and avoids -0 at semicircle mid/end", () => {
    expect(arcPath(0, 0, 10, 0.5, 1)).toBe("M 0 -10 A 10 10 0 0 1 10 0");
});

test("arcLength", () => {
    expect(arcLength(92.5, 0, 1)).toBe(round2(Math.PI * 92.5));
    expect(arcLength(10, 0.25, 0.75)).toBe(round2(Math.PI * 10 * 0.5));
});

test("calorieGauge zero eaten", () => {
    const g = calorieGauge({
        goal: 2000,
        eaten: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
    });
    expect(g.status).toBe("under");
    expect(g.remaining).toBe(2000);
    expect(g.ratio).toBe(0);
    expect(g.segments).toHaveLength(0);
});

test("calorieGauge negative eaten treated as zero", () => {
    const g = calorieGauge({
        goal: 2000,
        eaten: -50,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
    });
    expect(g.status).toBe("under");
    expect(g.remaining).toBe(2000);
});

test("calorieGauge partial intake", () => {
    const g = calorieGauge({
        goal: 2000,
        eaten: 500,
        protein_g: 50,
        carbs_g: 40,
        fat_g: 10,
    });
    expect(g.status).toBe("under");
    expect(g.remaining).toBe(1500);
    expect(g.segments.length).toBeGreaterThan(0);
});

test("calorieGauge exactly at goal", () => {
    const g = calorieGauge({ goal: 2000.4, eaten: 2000.4 });
    expect(g.status).toBe("at");
    expect(g.remaining).toBe(0);
    expect(g.segments).toEqual([]);
});

test("calorieGauge over goal scales segments and status over", () => {
    const g = calorieGauge({
        goal: 1000,
        eaten: 1200,
        protein_g: 200,
        carbs_g: 50,
        fat_g: 50,
    });
    const gap = GAUGE_SPECS.today.gapDeg / 180;
    const cumulativeShares = [800 / 1450, 1000 / 1450, 1];

    expect(g.status).toBe("over");
    expect(g.remaining).toBe(-200);
    expect(g.segments.map((s) => s.key)).toEqual(["protein", "carbs", "fat"]);
    for (let i = 0; i < g.segments.length; i++) {
        const seg = g.segments[i]!;
        expect(seg.to).toBeCloseTo(cumulativeShares[i]! - gap, 10);
    }
    const last = g.segments[g.segments.length - 1]!;
    expect(last.to).toBeCloseTo(1 - GAUGE_SPECS.today.gapDeg / 180, 10);
});

test("calorieGauge missing goal variants", () => {
    for (const goal of [null, undefined, 0, -1, NaN] as const) {
        const g = calorieGauge({ goal, eaten: 100 });
        expect(g.status).toBe("no-goal");
        expect(g.segments).toEqual([]);
        expect(g.remaining).toBeNull();
        expect(g.ratio).toBeNull();
        expect(g.track.d).toContain("M ");
    }
});

test("calorieGauge invalid grams treated as zero", () => {
    const g = calorieGauge({
        goal: 2000,
        eaten: 0,
        protein_g: -5,
        carbs_g: NaN,
        fat_g: null,
    });
    expect(g.segments).toHaveLength(0);
});

test("design reproduction goal 2421 macros", () => {
    const g = calorieGauge(
        {
            goal: 2421,
            eaten: 1284,
            protein_g: 96,
            carbs_g: 118,
            fat_g: 42,
        },
        GAUGE_SPECS.today,
    );
    expect(g.remaining).toBe(2421 - 1284);
    const ends = g.segments.map((s) => s.to * 180);
    expect(ends[0]).toBeCloseTo(27.11, 2);
    expect(ends[1]).toBeCloseTo(62.2, 2);
    expect(ends[2]).toBeCloseTo(90.31, 2);
});

test("segments protein carbs fat order, no overlap, within sweep", () => {
    const g = calorieGauge({
        goal: 2421,
        eaten: 500,
        protein_g: 96,
        carbs_g: 118,
        fat_g: 42,
    });
    expect(g.segments.map((s) => s.key)).toEqual(["protein", "carbs", "fat"]);
    for (let i = 0; i < g.segments.length - 1; i++) {
        const a = g.segments[i]!;
        const b = g.segments[i + 1]!;
        expect(a.to).toBeLessThanOrEqual(b.from);
    }
    for (const s of g.segments) {
        expect(s.to).toBeLessThanOrEqual(1);
        expect(s.from).toBeGreaterThanOrEqual(0);
    }
});

test("segment gap between consecutive macros", () => {
    const g = calorieGauge(
        {
            goal: 2421,
            protein_g: 96,
            carbs_g: 118,
            fat_g: 42,
            eaten: 0,
        },
        GAUGE_SPECS.today,
    );
    const gap = GAUGE_SPECS.today.gapDeg / 180;
    expect(g.segments[0]!.to).toBeCloseTo(384 / 2421 - gap, 5);
    expect(g.segments[1]!.from).toBeCloseTo(384 / 2421, 5);
});

test("tiny macro share smaller than gap is omitted", () => {
    const g = calorieGauge(
        {
            goal: 10000,
            eaten: 0,
            protein_g: 0.001,
            carbs_g: 100,
            fat_g: 50,
        },
        GAUGE_SPECS.today,
    );
    expect(g.segments.some((s) => s.key === "protein")).toBe(false);
    expect(g.segments.length).toBeGreaterThan(0);
});

test("macroRings zero value has null fill", () => {
    const { rings } = macroRings({
        protein: { value: 0, goal: 100 },
        carbs: { value: 0, goal: 100 },
        fat: { value: 0, goal: 100 },
    });
    for (const r of rings) {
        expect(r.fill).toBeNull();
        expect(r.fraction).toBe(0);
    }
});

test("macroRings partial fill", () => {
    const { rings } = macroRings({
        protein: { value: 90, goal: 100 },
        carbs: { value: 0, goal: 100 },
        fat: { value: 0, goal: 100 },
    });
    const protein = rings[0]!;
    expect(protein.fill).not.toBeNull();
    expect(protein.fraction).toBe(0.9);
    expect(protein.fill!.to).toBeCloseTo(0.9, 5);
});

test("macroRings over goal", () => {
    const { rings } = macroRings({
        protein: { value: 120, goal: 100 },
        carbs: { value: 0, goal: 100 },
        fat: { value: 0, goal: 100 },
    });
    const protein = rings[0]!;
    expect(protein.fraction).toBe(1);
    expect(protein.percent).toBe(120);
    expect(protein.over).toBe(true);
});

test("macroRings missing goal", () => {
    const { rings } = macroRings({
        protein: { value: 50, goal: null },
        carbs: { value: 50, goal: undefined },
        fat: { value: 50, goal: 0 },
    });
    for (const r of rings) {
        expect(r.ratio).toBeNull();
        expect(r.fill).toBeNull();
        expect(r.fraction).toBe(0);
    }
});

test("macroRings desktop box", () => {
    const { box } = macroRings(
        {
            protein: { value: 0, goal: 100 },
            carbs: { value: 0, goal: 100 },
            fat: { value: 0, goal: 100 },
        },
        RING_SPECS.desktop,
    );
    expect(box.width).toBe(72);
    expect(box.height).toBe(39.5);
});

test("barFill zero partial at goal over", () => {
    expect(barFill(0, 100).fraction).toBe(0);
    expect(barFill(50, 100).fraction).toBe(0.5);
    expect(barFill(100, 100).fraction).toBe(1);
    expect(barFill(150, 100).fraction).toBe(1);
    expect(barFill(150, 100).over).toBe(true);
});

test("barFill goalAt sanitization", () => {
    expect(barFill(50, 100, { goalAt: -1 })).toEqual({
        fraction: 0,
        ratio: 0.5,
        percent: 50,
        over: false,
        goalMarker: 0,
    });
    expect(barFill(50, 100, { goalAt: NaN })).toEqual({
        fraction: 0.5,
        ratio: 0.5,
        percent: 50,
        over: false,
        goalMarker: 1,
    });
    expect(barFill(0, 100, { goalAt: Infinity })).toEqual({
        fraction: 0,
        ratio: 0,
        percent: 0,
        over: false,
        goalMarker: 1,
    });
    expect(barFill(50, 100, { goalAt: 1.5 })).toEqual({
        fraction: 0.5,
        ratio: 0.5,
        percent: 50,
        over: false,
        goalMarker: 1,
    });
});

test("barFill average goalAt 0.92", () => {
    const at = barFill(210, 210, { goalAt: AVERAGE_GOAL_AT });
    expect(at.goalMarker).toBe(0.92);
    expect(at.fraction).toBeCloseTo(0.92, 5);
    const partial = barFill(189, 210, { goalAt: AVERAGE_GOAL_AT });
    expect(partial.fraction).toBeCloseTo((189 / 210) * AVERAGE_GOAL_AT, 5);
    const over = barFill(250, 210, { goalAt: AVERAGE_GOAL_AT });
    expect(over.fraction).toBe(1);
    expect(over.over).toBe(true);
});

test("barFill missing goal", () => {
    const b = barFill(50, null);
    expect(b.fraction).toBe(0);
    expect(b.ratio).toBeNull();
    expect(b.goalMarker).toBeNull();
});

function round2(n: number): number {
    const r = Math.round(n * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
}

test("calorieGauge treats a negative or NaN gapDeg as no gap", () => {
    const input = {
        goal: 1000,
        eaten: 580,
        protein_g: 50,
        carbs_g: 50,
        fat_g: 20,
    };
    const base = { radius: 92.5, stroke: 11 };
    const none = calorieGauge(input, { ...base, gapDeg: 0 });
    expect(none.segments.map((s) => s.key)).toEqual([
        "protein",
        "carbs",
        "fat",
    ]);
    expect(none.segments[0]!.to).toBeCloseTo(0.2, 10);
    expect(none.segments[1]!.from).toBeCloseTo(0.2, 10);
    for (const gapDeg of [-10, Number.NaN, Number.POSITIVE_INFINITY]) {
        const g = calorieGauge(input, { ...base, gapDeg });
        expect(g.segments).toEqual(none.segments);
    }
});
