/**
 * The size-scale guard: finds the declarations in a stylesheet that spell a
 * size, space, radius or font size as a literal instead of reading the scale
 * variables from `public/app/v2/tokens.css`.
 *
 * Checked properties: width / height (and min-, max-, inline-size, block-size),
 * padding*, margin* (margins are spacing, so they count), gap / row-gap /
 * column-gap, border-radius (every corner), font-size, and the size part of
 * the `font` shorthand.
 *
 * Allowed: `0` in any unit, a `1px` hairline, percentages, viewport units,
 * unitless numbers (a calc() multiplier), keywords, `env()`, and `var()` of a
 * scale variable (`--space-<step>`, `--radius-<step>`,
 * `--text-<role>-size|line`, `--control-<tier>-<prop>`, every name generated
 * from the scale in `src/tokens.ts`) or of a component-local `--fd-*`
 * property. The older names (`--space-gutter|section|row|gap`, `--fd-s-<n>`)
 * are off the scale and are violations. A `--fd-*` custom property may hold
 * any literal: it is a declaration, not one of the checked properties.
 * `calc()`, `min()`, `max()` and `clamp()` pass when every part of them does.
 * In the `font` shorthand a `--font-*` family variable passes too.
 *
 * A legacy partial that predates the scale can opt a later part in with
 * `/* scale-guard: checked *\/` on its own line: `checkedPart` returns only
 * the text after it.
 */

import {
    V2_CONTROL,
    V2_SCALE_RADIUS,
    V2_SCALE_SPACE,
    V2_TEXT,
} from "../../../tokens";

export type ScaleViolation = {
    selector: string;
    property: string;
    value: string;
};

const CHECKED_PROPERTY =
    /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap|border(?:-[a-z]+)*-radius|font-size|font)$/;

const SCALE_NAMES = new Set<string>([
    ...Object.keys(V2_SCALE_SPACE).map((k) => `--space-${k}`),
    ...Object.keys(V2_SCALE_RADIUS).map((k) => `--radius-${k}`),
    ...Object.keys(V2_TEXT).flatMap((role) => [
        `--text-${role}-size`,
        `--text-${role}-line`,
    ]),
    ...Object.entries(V2_CONTROL).flatMap(([tier, c]) =>
        Object.keys(c).map((prop) => `--control-${tier}-${prop}`),
    ),
]);

/** A component-local property; the old `--fd-s-<n>` steps are off the scale. */
const LOCAL_VARIABLE = /^--fd-(?!s-\d)[\w-]+$/;

const FONT_FAMILY_VARIABLE = /^--font-[\w-]+$/;

const isScaleVariable = (name: string, property: string): boolean =>
    SCALE_NAMES.has(name) ||
    LOCAL_VARIABLE.test(name) ||
    (property === "font" && FONT_FAMILY_VARIABLE.test(name));

/** Units that scale with the viewport, not a fixed length. */
const RELATIVE_UNIT = /^(?:%|[sld]?v(?:w|h|i|b|min|max))$/;

type Declaration = ScaleViolation;

/** Reads every `property: value` pair with the innermost real selector. */
function declarations(css: string): Declaration[] {
    const found: Declaration[] = [];
    const preludes: string[] = [];
    let buf = "";
    let parens = 0;
    let quote = "";
    const flush = () => {
        const text = buf.trim();
        buf = "";
        const colon = text.indexOf(":");
        if (preludes.length === 0 || colon < 1) return;
        const selector =
            [...preludes].reverse().find((p) => !p.startsWith("@")) ??
            preludes[preludes.length - 1]!;
        found.push({
            selector,
            property: text.slice(0, colon).trim().toLowerCase(),
            value: text.slice(colon + 1).trim(),
        });
    };
    for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
        if (quote) {
            buf += ch;
            if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            buf += ch;
        } else if (ch === "(") {
            parens++;
            buf += ch;
        } else if (ch === ")") {
            parens--;
            buf += ch;
        } else if (ch === "{" && parens === 0) {
            preludes.push(buf.trim().replace(/\s+/g, " "));
            buf = "";
        } else if (ch === ";" && parens === 0) {
            flush();
        } else if (ch === "}" && parens === 0) {
            flush();
            preludes.pop();
        } else {
            buf += ch;
        }
    }
    return found;
}

/** True when the value spells a size the scale does not own. */
function hasLiteral(property: string, rawValue: string): boolean {
    let value = rawValue
        .replace(/!important\s*$/i, "")
        .replace(/(["'])(?:(?!\1).)*\1/g, " ");
    let foreign = false;
    // `var(--x, fallback)` becomes `(fallback)`, so a literal fallback is
    // still read; a variable outside the scale is itself a violation, except
    // a `--font-*` family in the `font` shorthand.
    value = value.replace(/var\(\s*(--[\w-]+)\s*(,)?/g, (_, name: string) => {
        if (!isScaleVariable(name, property)) foreign = true;
        return "(";
    });
    if (foreign) return true;
    for (const m of value.matchAll(
        /(?<![\w.])([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)/gi,
    )) {
        const amount = Math.abs(Number(m[1]));
        const unit = (m[2] ?? "").toLowerCase();
        if (unit === "" || amount === 0 || RELATIVE_UNIT.test(unit)) continue;
        if (amount === 1 && unit === "px") continue;
        return true;
    }
    return false;
}

/** Every declaration in `css` whose size, space, radius or font size is a literal. */
export function scaleViolations(css: string): ScaleViolation[] {
    return declarations(css).filter(
        (d) =>
            CHECKED_PROPERTY.test(d.property) &&
            hasLiteral(d.property, d.value),
    );
}

const CHECKED_MARKER = /\/\*\s*scale-guard:\s*checked\s*\*\//;

/**
 * The part of a legacy partial the guard checks: everything after its
 * `scale-guard: checked` marker comment, or nothing when it has none. The
 * marker is looked up on the raw text, since parsing strips comments.
 */
export function checkedPart(css: string): string {
    const marker = CHECKED_MARKER.exec(css);
    return marker ? css.slice(marker.index + marker[0].length) : "";
}
