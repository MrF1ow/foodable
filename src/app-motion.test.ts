import { test, expect } from "bun:test";
import { getAppCss } from "./widgets.js";

const LAYOUT_PROP =
    /(?:^|[;{])\s*(?:width|height|margin|padding|top|left|inset)(?:-[\w]+)?\s*:/;

function keyframeBodies(css: string): string[] {
    const bodies: string[] = [];
    const re = /@keyframes\s+[\w-]+\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
        let depth = 1;
        let i = m.index + m[0].length;
        const start = i;
        while (i < css.length && depth > 0) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
            i++;
        }
        bodies.push(css.slice(start, i - 1));
    }
    return bodies;
}

test("motion.css is inlined in /app.css after brand.css", async () => {
    const css = await getAppCss();
    const motion = (await Bun.file("./public/app/motion.css").text()).trim();
    const brand = (await Bun.file("./public/app/brand.css").text()).trim();
    expect(css).toContain(motion);
    expect(css.indexOf(motion)).toBeGreaterThan(css.indexOf(brand));
});

test("motion.css kills animation and transition under reduced motion", async () => {
    const motion = await Bun.file("./public/app/motion.css").text();
    expect(motion).toContain("@media (prefers-reduced-motion: reduce)");
    expect(motion).toMatch(/animation:\s*none\s*!important/);
    expect(motion).toMatch(/transition:\s*none\s*!important/);
});

test("keyframes never animate layout properties", async () => {
    const css = await getAppCss();
    const bodies = keyframeBodies(css);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
        expect(body, body.slice(0, 80)).not.toMatch(LAYOUT_PROP);
    }
});
