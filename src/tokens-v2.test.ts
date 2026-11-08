import { test, expect } from "bun:test";
import figcraftJson from "../design/figcraft-variables.json";
import {
    V2_FONT,
    V2_RADIUS,
    V2_SPACE,
    V2_THEME,
    renderV2TokensCss,
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

test("V2_THEME matches design/figcraft-variables.json Theme collection", () => {
    const theme = figcraft.collections.find((c) => c.name === "Theme");
    expect(theme?.modes).toEqual(["Dark", "Light"]);
    const jsonNames = Object.keys(theme!.variables);
    expect(Object.keys(V2_THEME.dark)).toEqual(jsonNames);
    expect(Object.keys(V2_THEME.light)).toEqual(jsonNames);

    for (const name of jsonNames) {
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

test("V2_RADIUS, V2_SPACE, V2_FONT match design Tokens collection", () => {
    const tokens = figcraft.collections.find((c) => c.name === "Tokens");
    expect(tokens?.modes).toEqual(["Default"]);
    const vars = tokens!.variables;

    const radiusJson: Record<string, number> = {};
    const spaceJson: Record<string, number> = {};
    const fontJson: Record<string, string> = {};
    for (const [fullName, spec] of Object.entries(vars)) {
        const [group, key] = fullName.split("/") as [string, string];
        const val = spec.values.Default;
        if (group === "radius") {
            expect(typeof val).toBe("number");
            radiusJson[key] = val as number;
        } else if (group === "space") {
            expect(typeof val).toBe("number");
            spaceJson[key] = val as number;
        } else if (group === "font") {
            expect(typeof val).toBe("string");
            fontJson[key] = val as string;
        } else throw new Error(`unexpected token: ${fullName}`);
    }

    expect(radiusJson).toEqual(V2_RADIUS);
    expect(spaceJson).toEqual(V2_SPACE);
    expect(fontJson).toEqual(V2_FONT);
    expect(Object.keys(vars).length).toBe(
        Object.keys(V2_RADIUS).length +
            Object.keys(V2_SPACE).length +
            Object.keys(V2_FONT).length,
    );
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
    const root = declsOf(block(css, ":root"));
    expect(root).toMatchObject({ ...themeDecls("dark"), ...statics });
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
