import { describe, expect, test } from "bun:test";
import { calorieGauge } from "./calorie-gauge.js";
import { XSS } from "./test-helpers.js";

const arcs = (html: string) =>
    [
        ...html.matchAll(
            /<path class="fd-calorie-gauge__arc fd-calorie-gauge__arc--(\w+)" d="([^"]+)"/g,
        ),
    ].map((m) => ({ kind: m[1]!, d: m[2]! }));

test("a negative zero is spoken and drawn as 0, never -0", () => {
    const html = String(calorieGauge({ consumed: -0, target: 2000 }));
    expect(html).toContain("Eaten 0 of 2,000 kcal");
    expect(html).not.toContain("-0");
    expect(html).toContain(
        '<span class="fd-calorie-gauge__figure">2,000</span>',
    );
});

describe("calorieGauge (FigCraft 381807)", () => {
    test("the figure is what is left, over the target line", () => {
        const html = String(
            calorieGauge({
                consumed: 1284,
                target: 2421,
                protein: 384,
                carbs: 513,
                fat: 387,
            }),
        );
        expect(html).toContain(
            '<span class="fd-calorie-gauge__figure">1,137</span>',
        );
        expect(html).toContain(
            '<span class="fd-calorie-gauge__sub">kcal left of 2,421</span>',
        );
    });

    test("a track and the three macro arcs, drawn on a 196 x 103.5 box", () => {
        const html = String(
            calorieGauge({
                consumed: 1284,
                target: 2421,
                protein: 384,
                carbs: 513,
                fat: 387,
            }),
        );
        expect(html).toContain('viewBox="0 0 196 103.5"');
        expect(html).toContain('aria-hidden="true"');
        const found = arcs(html);
        expect(found.map((a) => a.kind).sort()).toEqual([
            "carbs",
            "fat",
            "protein",
            "track",
        ]);
        // The track is the whole half circle: from the left end to the right end.
        expect(found.find((a) => a.kind === "track")!.d).toBe(
            "M5.5 98A92.5 92.5 0 0 1 190.5 98",
        );
    });

    test("the arcs together cover the share of the target eaten", () => {
        const html = String(
            calorieGauge({
                consumed: 1210.5,
                target: 2421,
                protein: 100,
                carbs: 100,
                fat: 100,
            }),
        );
        // Half the target eaten: the macro arcs end at the top of the half circle.
        const fat = arcs(html).find((a) => a.kind === "fat")!;
        expect(fat.d.endsWith("98.00 5.50")).toBe(true);
    });

    test("over the target the arcs fill the ring and the text says over", () => {
        const html = String(
            calorieGauge({
                consumed: 2600,
                target: 2421,
                protein: 1,
                carbs: 1,
                fat: 1,
            }),
        );
        expect(html).toContain("fd-calorie-gauge--over");
        expect(html).toContain(
            '<span class="fd-calorie-gauge__figure">179</span>',
        );
        expect(html).toContain("kcal over 2,421");
        expect(
            arcs(html)
                .find((a) => a.kind === "fat")!
                .d.endsWith("190.50 98.00"),
        ).toBe(true);
    });

    test("macro arcs with no kcal are left out; none at all gives one calories arc", () => {
        const html = String(calorieGauge({ consumed: 500, target: 2000 }));
        expect(
            arcs(html)
                .map((a) => a.kind)
                .sort(),
        ).toEqual(["calories", "track"]);
        const none = String(
            calorieGauge({ consumed: 0, target: 2000, protein: 0 }),
        );
        expect(arcs(none).map((a) => a.kind)).toEqual(["track"]);
    });

    test("a target that rounds below 1 counts as no target", () => {
        const html = String(calorieGauge({ consumed: 100, target: 0.3 }));
        expect(html).toContain("no calorie goal");
        expect(html).toContain("—");
        expect(arcs(html).map((a) => a.kind)).toEqual(["track"]);
        expect(html).not.toContain("left of 0");
    });

    test("within half a kcal of the target the figure and the spoken line agree", () => {
        const html = String(calorieGauge({ consumed: 2000.4, target: 2000 }));
        expect(html).toContain("Eaten 2,000 of 2,000 kcal");
        expect(html).toContain(
            '<span class="fd-calorie-gauge__figure">0</span>',
        );
        expect(html).toContain("kcal left of 2,000");
        expect(html).not.toContain("over");
        const past = String(calorieGauge({ consumed: 2000.6, target: 2000 }));
        expect(past).toContain("Eaten 2,001 of 2,000 kcal");
        expect(past).toContain(
            '<span class="fd-calorie-gauge__figure">1</span>',
        );
        expect(past).toContain("kcal over 2,000");
    });

    test("unknown consumed or target shows a dash and only the track", () => {
        for (const opts of [
            { consumed: null, target: 2000 },
            { consumed: 100, target: null },
            { consumed: 100, target: 0 },
            { consumed: -100, target: 2000 },
            { consumed: NaN, target: 2000 },
            { consumed: 100, target: -2000 },
        ]) {
            const html = String(calorieGauge(opts));
            expect(html).toContain("—");
            expect(arcs(html).map((a) => a.kind)).toEqual(["track"]);
        }
        expect(String(calorieGauge({ consumed: 100, target: null }))).toContain(
            "no calorie goal",
        );
        expect(
            String(calorieGauge({ consumed: null, target: 2000 })),
        ).toContain("kcal left of 2,000");
    });

    test("the unknown figure is a dash with a spoken no data", () => {
        for (const consumed of [null, -100, NaN]) {
            const html = String(calorieGauge({ consumed, target: 2000 }));
            expect(html).toContain(
                '<span class="fd-calorie-gauge__figure"><span aria-hidden="true">—</span>',
            );
            expect(html).toContain("no data");
            expect(html).not.toContain("2,100");
            expect(html).toContain("kcal left of 2,000");
        }
    });

    test("a spoken summary of what was eaten", () => {
        const html = String(
            calorieGauge({
                consumed: 1284,
                target: 2421,
                protein: 384,
                carbs: 513,
                fat: 387,
            }),
        );
        expect(html).toContain("Eaten 1,284 of 2,421 kcal");
    });

    test("escapes the class", () => {
        expect(
            String(calorieGauge({ consumed: 1, target: 2, className: XSS })),
        ).not.toContain("<script>");
    });
});
