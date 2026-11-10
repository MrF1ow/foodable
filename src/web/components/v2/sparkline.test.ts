import { describe, expect, test } from "bun:test";
import { sparklineSvg } from "./sparkline.js";

describe("sparklineSvg", () => {
    test("returns empty for no values", () => {
        expect(sparklineSvg([], { width: 312, height: 64 })).toBe("");
    });

    test("draws line and area for two points", () => {
        const svg = sparklineSvg([80, 82], { width: 312, height: 64 });
        expect(svg).toContain("<path");
        expect(svg).toContain('viewBox="0 0 312 64"');
        expect(svg).toContain("fd-sparkline__line");
        expect(svg).toContain("fd-sparkline__area");
    });

    test("single point uses midpoint x and renders a dot", () => {
        const svg = sparklineSvg([75], { width: 100, height: 40 });
        expect(svg).toContain("M50.0");
        expect(svg).toContain("<circle");
    });

    test("flat series uses midline y", () => {
        const svg = sparklineSvg([80, 80, 80], { width: 100, height: 40 });
        const line = svg.match(/class="fd-sparkline__line" d="([^"]+)"/)?.[1];
        expect(line).toBeTruthy();
        const ys = [...(line ?? "").matchAll(/[\d.]+ ([\d.]+)/g)].map((m) =>
            Number(m[1]),
        );
        expect(new Set(ys).size).toBe(1);
        expect(ys[0]).toBeGreaterThan(8);
        expect(ys[0]).toBeLessThan(32);
    });
});
