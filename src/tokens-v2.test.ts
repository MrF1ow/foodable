import { test, expect } from "bun:test";
import figcraftJson from "../design/figcraft-variables.json";
import {
    V2_CONTROL,
    V2_FONT,
    V2_RADIUS,
    V2_SCALE_RADIUS,
    V2_SCALE_SPACE,
    V2_SPACE,
    V2_TEXT,
    V2_THEME,
    renderV2TokensCss,
    renderWidgetV2TokensCss,
    type V2ColorName,
} from "./tokens.js";

type FigcraftExport = {
    collections: {
        name: string;
        modes: string[];
        variables: Record<
            string,
            {
                type: string;
                values: Record<
                    string,
                    { hex: string; alpha: number } | number | string
                >;
            }
        >;
    }[];
};

const figcraft = figcraftJson as unknown as FigcraftExport;

type ColorValue = { hex: string; alpha: number };

function figcraftColorString({ hex, alpha }: ColorValue): string {
    const byte = Math.round(alpha * 255);
    const lower = hex.toLowerCase();
    if (byte === 255) return lower;
    return lower + byte.toString(16).padStart(2, "0");
}

function v2CssVar(designName: string): string {
    return `--${designName.replace(/\//g, "-")}`;
}

test("the committed v2 tokens.css matches src/tokens.ts", async () => {
    expect(
        await Bun.file("public/app/v2/tokens.css").text(),
        "public/app/v2/tokens.css: run bun run gen:tokens",
    ).toBe(renderV2TokensCss());
});

test("the committed widget v2 tokens.css matches src/tokens.ts", async () => {
    expect(
        await Bun.file("public/widgets/src/shared/v2/tokens.css").text(),
        "public/widgets/src/shared/v2/tokens.css: run bun run gen:tokens",
    ).toBe(renderWidgetV2TokensCss());
});

test("V2_THEME matches design/figcraft-variables.json Theme collection", () => {
    const theme = figcraft.collections.find((c) => c.name === "Theme");
    expect(theme?.modes).toEqual(["Dark", "Light"]);
    // The design also holds app-store and site colours (accent/glow,
    // accent/line, device/body) that the app does not use; compare on the
    // names V2_THEME has, which must all exist in the design, in order.
    const names = Object.keys(V2_THEME.dark);
    expect(Object.keys(V2_THEME.light)).toEqual(names);
    expect(Object.keys(theme!.variables).slice(0, names.length)).toEqual(names);

    for (const name of names) {
        const v = theme!.variables[name]!;
        expect(v.type).toBe("color");
        const values = v.values as { Dark: ColorValue; Light: ColorValue };
        for (const [jsonMode, v2Mode] of [
            ["Dark", "dark"],
            ["Light", "light"],
        ] as const) {
            const raw = values[jsonMode];
            expect(
                Math.abs(raw.alpha * 255 - Math.round(raw.alpha * 255)),
            ).toBeLessThan(1e-3);
            const expected = figcraftColorString(raw);
            expect(V2_THEME[v2Mode][name as V2ColorName]).toBe(expected);
        }
    }
});

test("the design export has no unresolved aliases", () => {
    expect(JSON.stringify(figcraft)).not.toContain("VariableID");
});

/** space/row is 12 in the design and 11 in the code: the app's rows were
 * built at 11 and the shot diff must stay pixel-identical. A later change can
 * move it; until then this is the one named difference. */
const SPACE_EXCEPTIONS: Record<string, { design: number; code: number }> = {
    row: { design: 12, code: 11 },
};

type NumberGroups = {
    radius: Record<string, number>;
    space: Record<string, number>;
    text: Record<string, Record<string, number>>;
    control: Record<string, Record<string, number>>;
    font: Record<string, string>;
};

function tokensCollection(): NumberGroups {
    const tokens = figcraft.collections.find((c) => c.name === "Tokens");
    expect(tokens?.modes).toEqual(["Default"]);
    const out: NumberGroups = {
        radius: {},
        space: {},
        text: {},
        control: {},
        font: {},
    };
    for (const [fullName, spec] of Object.entries(tokens!.variables)) {
        const parts = fullName.split("/");
        const val = spec.values.Default;
        const group = parts[0] as keyof NumberGroups;
        if (group === "font") {
            expect(typeof val).toBe("string");
            out.font[parts[1]!] = val as string;
        } else if (group === "radius" || group === "space") {
            expect(parts.length).toBe(2);
            expect(typeof val).toBe("number");
            out[group][parts[1]!] = val as number;
        } else if (group === "text" || group === "control") {
            expect(parts.length).toBe(3);
            expect(typeof val).toBe("number");
            (out[group][parts[1]!] ??= {})[parts[2]!] = val as number;
        } else throw new Error(`unexpected token: ${fullName}`);
    }
    return out;
}

test("V2_RADIUS, V2_SPACE, V2_FONT keep matching the design Tokens collection", () => {
    const t = tokensCollection();
    // The design's radius/* and space/* hold the legacy names and the new
    // scale together; the legacy names must still agree (space/row aside).
    for (const [k, v] of Object.entries(V2_RADIUS)) {
        expect(t.radius[k], `radius/${k}`).toBe(v);
    }
    for (const [k, v] of Object.entries(V2_SPACE)) {
        expect(t.space[k], `space/${k}`).toBe(
            k in SPACE_EXCEPTIONS ? SPACE_EXCEPTIONS[k]!.design : v,
        );
    }
    for (const [k, e] of Object.entries(SPACE_EXCEPTIONS)) {
        expect(V2_SPACE[k as keyof typeof V2_SPACE] as number).toBe(e.code);
    }
    expect(t.font).toEqual(V2_FONT);
});

test("V2_SCALE_SPACE and V2_SCALE_RADIUS match the design scale", () => {
    const t = tokensCollection();
    const spaceScale = Object.keys(V2_SCALE_SPACE);
    expect(spaceScale).toEqual([
        "2xs",
        "xs",
        "sm",
        "md",
        "lg",
        "xl",
        "2xl",
        "3xl",
        "4xl",
    ]);
    for (const [k, v] of Object.entries(V2_SCALE_SPACE)) {
        expect(t.space[k], `space/${k}`).toBe(v);
    }
    // Every design space name is a legacy name or a scale name.
    expect(Object.keys(t.space).sort()).toEqual(
        [...Object.keys(V2_SPACE), ...spaceScale].sort(),
    );
    // The scale's sm/md/lg/sheet/pill are the legacy radii; xs is new.
    expect(V2_SCALE_RADIUS).toEqual({ xs: 10, ...V2_RADIUS });
    expect(t.radius).toEqual(V2_SCALE_RADIUS);
});

test("V2_TEXT matches the design text/* roles", () => {
    const t = tokensCollection();
    expect(Object.keys(V2_TEXT)).toEqual(Object.keys(t.text));
    for (const [role, spec] of Object.entries(V2_TEXT)) {
        expect(t.text[role], `text/${role}`).toEqual({
            size: spec.size,
            line: spec.line,
        });
    }
    expect(V2_TEXT.body).toEqual({ size: 15, line: 22 });
});

test("V2_CONTROL matches the design control/* tiers, radius resolved", () => {
    const t = tokensCollection();
    expect(Object.keys(V2_CONTROL)).toEqual(["sm", "md", "lg", "xl"]);
    expect(Object.keys(V2_CONTROL)).toEqual(Object.keys(t.control));
    for (const [tier, spec] of Object.entries(V2_CONTROL)) {
        const design = t.control[tier]!;
        expect(Object.keys(spec)).toEqual(Object.keys(design));
        const resolved: Record<string, number> = {
            ...spec,
            radius: V2_SCALE_RADIUS[spec.radius],
        };
        expect(resolved, `control/${tier}`).toEqual(design);
    }
});

// The body of the first rule whose selector line is exactly `selector {`.
function block(css: string, selector: string): string {
    const lines = css.split("\n");
    const start = lines.findIndex((l) => l.trim() === `${selector} {`);
    expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l.trim() === "}");
    return lines.slice(start + 1, end).join("\n");
}

function declsOf(body: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--[a-z0-9-]+|color-scheme):\s*([^;]+);/g)) {
        out[m[1]!] = m[2]!.replace(/\s+/g, " ").trim();
    }
    return out;
}

function themeDecls(t: "dark" | "light"): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(V2_THEME[t])) {
        out[v2CssVar(name)] = value;
    }
    out["color-scheme"] = t;
    return out;
}

test("v2 tokens.css: dark by default, light by media query, data-theme wins both ways", () => {
    const css = renderV2TokensCss();
    const media = css.indexOf("@media (prefers-color-scheme: light) {");
    expect(media).toBeGreaterThan(0);
    const statics: Record<string, string> = {};
    for (const [k, v] of Object.entries(V2_RADIUS)) {
        statics[`--radius-${k}`] = `${v}px`;
    }
    for (const [k, v] of Object.entries(V2_SPACE)) {
        statics[`--space-${k}`] = `${v}px`;
    }
    for (const [k, v] of Object.entries(V2_SCALE_SPACE)) {
        statics[`--space-${k}`] = `${v}px`;
    }
    statics["--radius-xs"] = `${V2_SCALE_RADIUS.xs}px`;
    for (const [role, { size, line }] of Object.entries(V2_TEXT)) {
        statics[`--text-${role}-size`] = `${size}px`;
        statics[`--text-${role}-line`] = `${line}px`;
    }
    for (const [tier, c] of Object.entries(V2_CONTROL)) {
        statics[`--control-${tier}-height`] = `${c.height}px`;
        statics[`--control-${tier}-padding`] = `${c.padding}px`;
        statics[`--control-${tier}-gap`] = `${c.gap}px`;
        statics[`--control-${tier}-text`] = `${c.text}px`;
        statics[`--control-${tier}-icon`] = `${c.icon}px`;
        statics[`--control-${tier}-radius`] = `${V2_SCALE_RADIUS[c.radius]}px`;
    }
    const root = declsOf(block(css, ":root"));
    expect(root).toMatchObject({ ...themeDecls("dark"), ...statics });
    // Legacy names keep their value; the new scale is app-only.
    expect(root["--space-row"]).toBe("11px");
    expect(root["--font-body"]).toStartWith(`"${V2_FONT.body}", `);
    expect(root["--font-display"]).toBe(
        `"${V2_FONT.display}", var(--font-body)`,
    );
    expect(declsOf(block(css.slice(media), ":root"))).toEqual(
        themeDecls("light"),
    );
    expect(declsOf(block(css, ':root[data-theme="dark"]'))).toEqual(
        themeDecls("dark"),
    );
    expect(declsOf(block(css, ':root[data-theme="light"]'))).toEqual(
        themeDecls("light"),
    );
    // The explicit overrides come after the media query, so equal
    // specificity would still resolve in their favour.
    expect(css.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(media);
});

test("widget v2 tokens.css: light by default, dark by media query, data-theme wins both ways", () => {
    const css = renderWidgetV2TokensCss();
    const media = css.indexOf("@media (prefers-color-scheme: dark) {");
    expect(media).toBeGreaterThan(0);
    const statics: Record<string, string> = {
        "--nutrient-alcohol": "var(--text-tertiary)",
    };
    for (const [k, v] of Object.entries(V2_RADIUS)) {
        statics[`--radius-${k}`] = `${v}px`;
    }
    for (const [k, v] of Object.entries(V2_SPACE)) {
        statics[`--space-${k}`] = `${v}px`;
    }
    const root = declsOf(block(css, ":root"));
    expect(root).toMatchObject({ ...themeDecls("light"), ...statics });
    for (const name of Object.keys(root)) {
        expect(name).not.toMatch(/^--(text-[a-z-]+-(size|line)|control-)/);
    }
    for (const k of Object.keys(V2_SCALE_SPACE)) {
        if (!(k in V2_SPACE)) expect(root).not.toHaveProperty(`--space-${k}`);
    }
    expect(root).not.toHaveProperty("--radius-xs");
    expect(root["--font-body"]).not.toContain("Geist");
    expect(root["--font-display"]).toBe("var(--font-body)");
    expect(declsOf(block(css.slice(media), ":root"))).toEqual(
        themeDecls("dark"),
    );
    expect(declsOf(block(css, ':root[data-theme="dark"]'))).toEqual(
        themeDecls("dark"),
    );
    expect(declsOf(block(css, ':root[data-theme="light"]'))).toEqual(
        themeDecls("light"),
    );
    expect(css.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(media);
});
