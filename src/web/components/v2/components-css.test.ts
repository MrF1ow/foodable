import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkedPart, scaleViolations } from "./scale-guard";

const css = readFileSync(
    join(import.meta.dir, "../../../../public/app/v2/components.css"),
    "utf8",
);
// Comments may quote hex values or class names; the rules are what ships.
/** Escapes every regex metacharacter, backslash included, so a selector matches literally. */
const escapeRegExp = (text: string): string =>
    text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

// The stylesheets that follow the component rules: same checks, same strictness.
const menuRules = readFileSync(
    join(import.meta.dir, "../../../../public/app/v2/menu.css"),
    "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const guarded = [
    { name: "components.css", rules, minClasses: 40 },
    { name: "menu.css", rules: menuRules, minClasses: 10 },
] as const;

for (const { name, rules: text } of guarded) {
    test(`${name} has no colour literal: every colour is a token`, () => {
        expect(text.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
        expect(
            text.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g),
        ).toBeNull();
        // Named colours would slip past the checks above.
        expect(
            text.match(
                /:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/g,
            ),
        ).toBeNull();
    });
}

for (const { name, rules: text, minClasses } of guarded) {
    test(`${name} only defines fd- classes and --fd- locals`, () => {
        const selectors = text.replace(/\{[^{}]*\}/g, "{}");
        const classes = [...selectors.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(
            (m) => m[1]!,
        );
        expect(classes.length).toBeGreaterThan(minClasses);
        expect(classes.filter((c) => !c.startsWith("fd-"))).toEqual([]);
        const declared = [...text.matchAll(/[{;]\s*(--[\w-]+)\s*:/g)].map(
            (m) => m[1]!,
        );
        expect(declared.filter((v) => !v.startsWith("--fd-"))).toEqual([]);
    });
}

for (const { name, rules: text } of guarded) {
    test(`every var(--x) ${name} reads is a tokens.css name or an --fd- local`, () => {
        const tokens = readFileSync(
            join(import.meta.dir, "../../../../public/app/v2/tokens.css"),
            "utf8",
        );
        const defined = new Set(
            [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!),
        );
        const used = [...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
        const unknown = used.filter(
            (v) => !defined.has(v) && !v.startsWith("--fd-"),
        );
        expect(unknown).toEqual([]);
    });
}

test("transitions are switched off under prefers-reduced-motion", () => {
    expect(rules).toContain("prefers-reduced-motion: reduce");
    expect(rules.match(/transition:/g)?.length).toBeGreaterThan(0);
});

test("a row's name is one line ending in an ellipsis; its neighbours keep their line", () => {
    const block = (selector: string) =>
        rules.match(
            new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`),
        )?.[1] ?? "";
    const title = block(".fd-row__title");
    expect(title).toContain("white-space: nowrap");
    expect(title).toContain("overflow: hidden");
    expect(title).toContain("text-overflow: ellipsis");
    expect(title).toContain("min-width: 0");
    expect(title).not.toContain("overflow-wrap");
    const line = block(".fd-row__line");
    expect(line).toContain("flex-wrap: nowrap");
    expect(line).toContain("min-width: 0");
    expect(
        rules.match(
            /\.fd-row__line > :not\(\.fd-row__title\)\s*\{([^}]*)\}/,
        )?.[1],
    ).toContain("flex: none");
    // The row body never wraps below the name.
    expect(rules).not.toMatch(
        /\.fd-row[\w-]*\s+\.fd-row__body\s*\{[^}]*flex-wrap:\s*wrap/,
    );
});

test("a title line fills its row's text column, so the inline meta cap measures the column", () => {
    // .fd-row__main aligns to flex-start: without stretch the line is sized to
    // its content and the meta's max-width: 45% truncates short real names
    // ("Milk Kirklan…") with half the row empty. Checked in Chromium with the
    // fixture data (Kitchen › Usuals, Household members, Today).
    const line = rules.match(/\.fd-row__line\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(line).toContain("align-self: stretch");
    expect(
        rules.match(/\.fd-row__line > \.fd-row__meta\s*\{([^}]*)\}/)?.[1],
    ).toContain("max-width: 45%");
});

const settingsRules = readFileSync(
    join(import.meta.dir, "../../../../public/app/v2/settings.css"),
    "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const planted = (decl: string) => scaleViolations(`.fd-x { ${decl} }`);

test("a literal size, space, radius or font size is a violation naming selector, property and value", () => {
    expect(planted("padding: 13px")).toEqual([
        { selector: ".fd-x", property: "padding", value: "13px" },
    ]);
    expect(planted("font-size: 13px")).toEqual([
        { selector: ".fd-x", property: "font-size", value: "13px" },
    ]);
    expect(planted("border-radius: 10px")).toEqual([
        { selector: ".fd-x", property: "border-radius", value: "10px" },
    ]);
    expect(planted("gap: 6px")).toHaveLength(1);
    expect(planted("min-height: 44px")).toHaveLength(1);
    expect(planted("margin-top: 0.5rem")).toHaveLength(1);
    expect(planted("border-top-left-radius: 8px")).toHaveLength(1);
    expect(planted("padding: 0 var(--space-md) 13px")).toHaveLength(1);
    expect(planted("font: 600 13px/18px Geist, sans-serif")).toHaveLength(1);
});

test("a scale variable, a --fd- local, zero, a hairline, a percentage and a keyword pass", () => {
    expect(planted("padding: var(--space-md)")).toEqual([]);
    expect(planted("padding: var(--space-sm) var(--space-lg)")).toEqual([]);
    expect(planted("border-radius: var(--radius-pill)")).toEqual([]);
    expect(planted("font-size: var(--text-body-size)")).toEqual([]);
    expect(planted("height: var(--control-md-height)")).toEqual([]);
    expect(planted("width: var(--fd-dialog-width)")).toEqual([]);
    expect(planted("margin: 0")).toEqual([]);
    expect(planted("margin: 0 auto")).toEqual([]);
    expect(planted("border-width: 1px")).toEqual([]);
    expect(planted("margin-top: -1px")).toEqual([]);
    expect(planted("border-radius: 50%")).toEqual([]);
    expect(planted("max-width: 100%")).toEqual([]);
    expect(planted("min-height: 100dvh")).toEqual([]);
    expect(planted("width: fit-content")).toEqual([]);
    expect(planted("max-width: none")).toEqual([]);
    expect(planted("font-size: inherit")).toEqual([]);
    expect(planted("font: inherit")).toEqual([]);
    expect(planted("padding: var(--space-md) !important")).toEqual([]);
});

test("calc() is fine when every length in it is allowed", () => {
    expect(planted("padding: calc(var(--space-md) + 1px)")).toEqual([]);
    expect(
        planted(
            "padding-bottom: calc(env(safe-area-inset-bottom) + var(--space-lg))",
        ),
    ).toEqual([]);
    expect(planted("width: calc(100% - var(--space-2xl) * 2)")).toEqual([]);
    expect(planted("width: calc(100% - 13px)")).toHaveLength(1);
    expect(planted("padding: calc(var(--space-md) + 3px)")).toHaveLength(1);
    expect(planted("width: min(100%, 480px)")).toHaveLength(1);
});

test("a variable outside the scale is a violation, a fallback literal too", () => {
    expect(planted("padding: var(--gutter)")).toHaveLength(1);
    expect(planted("padding: var(--space-md, 13px)")).toHaveLength(1);
    expect(planted("padding: var(--space-md, var(--space-sm))")).toEqual([]);
});

test("a --fd- local may hold a literal; properties outside the scale are not checked", () => {
    expect(
        scaleViolations(
            ".fd-dialog { --fd-dialog-width: 480px; width: var(--fd-dialog-width); }",
        ),
    ).toEqual([]);
    expect(planted("border: 3px solid red")).toEqual([]);
    expect(planted("top: 13px")).toEqual([]);
    expect(planted("line-height: 1.4")).toEqual([]);
});

test("comments are ignored", () => {
    expect(
        scaleViolations(
            "/* padding: 13px */ .fd-x { /* gap: 7px; */ padding: var(--space-md); }",
        ),
    ).toEqual([]);
});

test("rules inside @media and a last declaration without a semicolon are read", () => {
    const found = scaleViolations(
        "@media (min-width: 900px) { .fd-a { gap: var(--space-sm); padding: 13px } } .fd-b, .fd-c { width: 7px }",
    );
    expect(found).toEqual([
        { selector: ".fd-a", property: "padding", value: "13px" },
        { selector: ".fd-b, .fd-c", property: "width", value: "7px" },
    ]);
});

test("the old off-scale names are violations: --fd-s-<n> and the V2_SPACE aliases", () => {
    expect(planted("padding: var(--fd-s-13); gap: var(--space-row)")).toEqual([
        { selector: ".fd-x", property: "padding", value: "var(--fd-s-13)" },
        { selector: ".fd-x", property: "gap", value: "var(--space-row)" },
    ]);
    for (const name of ["gutter", "section", "row", "gap"]) {
        expect(planted(`margin: var(--space-${name})`)).toHaveLength(1);
    }
    expect(planted("padding: var(--space-nope)")).toHaveLength(1);
    expect(planted("height: var(--control-md-nope)")).toHaveLength(1);
    expect(planted("height: var(--control-xx-height)")).toHaveLength(1);
    expect(planted("font-size: var(--text-body-lines)")).toHaveLength(1);
});

test("every scale step is allowed, a component-local --fd- name too", () => {
    for (const name of [
        "--space-2xs",
        "--space-4xl",
        "--radius-xs",
        "--radius-pill",
        "--text-title-page-size",
        "--text-micro-line",
        "--control-xl-radius",
        "--control-sm-icon",
        "--fd-sheet-height",
        "--fd-s",
    ]) {
        expect(planted(`padding: var(${name})`)).toEqual([]);
    }
});

test("in the font shorthand only a --font- family or a scale variable may be a var", () => {
    expect(
        planted(
            "font: 500 var(--text-body-size)/var(--text-body-line) var(--font-body)",
        ),
    ).toEqual([]);
    expect(planted("font: 600 var(--font-display), sans-serif")).toEqual([]);
    expect(
        planted("font: 600 var(--text-label-size)/1.2 var(--font-body)"),
    ).toEqual([]);
    expect(planted("font: 600 var(--fs-body)/1.2 var(--font-body)")).toEqual([
        {
            selector: ".fd-x",
            property: "font",
            value: "600 var(--fs-body)/1.2 var(--font-body)",
        },
    ]);
    expect(planted("font: 600 var(--space-row) var(--font-body)")).toHaveLength(
        1,
    );
    expect(planted("font-size: var(--font-body)")).toHaveLength(1);
});

test("checkedPart returns what follows the marker, nothing without one", () => {
    expect(checkedPart(".a { gap: 7px }")).toBe("");
    expect(
        checkedPart(
            ".a { gap: 7px }\n/* scale-guard: checked */\n.b { gap: 9px }",
        ),
    ).toBe("\n.b { gap: 9px }");
    expect(checkedPart("/*scale-guard:checked*/ .b { gap: 9px }")).toBe(
        " .b { gap: 9px }",
    );
});

test("in a legacy partial a literal before the marker passes and one after it fails", () => {
    const before =
        ".old { padding: 13px }\n/* scale-guard: checked */\n.fd-new { padding: var(--space-md) }";
    expect(scaleViolations(checkedPart(before))).toEqual([]);
    const after =
        ".old { padding: 13px }\n/* scale-guard: checked */\n.fd-new { padding: 13px }";
    expect(scaleViolations(checkedPart(after))).toEqual([
        { selector: ".fd-new", property: "padding", value: "13px" },
    ]);
});

// Partials that predate the scale. A partial leaves this list when it moves
// onto the scale; every partial added since is checked. A legacy partial that
// gains a scaled section puts `/* scale-guard: checked */` before it: every
// declaration after the marker is checked, those before it stay exempt.
const LEGACY_PARTIALS = [
    "app-v2.css",
    "components.css",
    "gallery.css",
    "kitchen.css",
    "menu.css",
    "product.css",
    "recipes.css",
    "select.css",
    "settings.css",
    "share-links.css",
    "sheet.css",
    "shell.css",
    "stores.css",
    "today.css",
    "tokens.css",
    "trends.css",
];

const partialsDir = join(import.meta.dir, "../../../../public/app/v2");
const partials = readdirSync(partialsDir).filter((f) => f.endsWith(".css"));

test("every legacy partial still exists, so a rename cannot hide one from the guard", () => {
    expect(LEGACY_PARTIALS.filter((f) => !partials.includes(f))).toEqual([]);
});

test("the Restock Time input is the Day value's size, and a row's ⋯ dots sit on the row's right edge", () => {
    const block = (selector: string) =>
        settingsRules.match(
            new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`),
        )?.[1] ?? "";
    const input = block(".fd-restock__time-input");
    expect(input).toContain("font-size: var(--text-label-size)");
    expect(input).toContain("line-height: var(--text-label-line)");
    const household =
        ".fd-settings--household .fd-item-row__control > .fd-menu > .fd-btn--icon";
    const readers =
        ".fd-readers .fd-item-row__control > .fd-menu > .fd-btn--icon";
    // One rule for both pages: the household selector, a comma, the readers one.
    expect(settingsRules).toContain(`${household},\n${readers}`);
    expect(block(readers)).toContain(
        "margin-inline-end: calc((var(--control-md-height) - 24px) / -2)",
    );
});

const storesCss = readFileSync(
    join(import.meta.dir, "../../../../public/app/v2/stores.css"),
    "utf8",
);

/** The declarations of the first stores.css rule that starts at `selector`. */
function storesRule(selector: string): string {
    const at = storesCss.indexOf(selector);
    expect(at).toBeGreaterThanOrEqual(0);
    return storesCss.slice(
        storesCss.indexOf("{", at),
        storesCss.indexOf("}", at),
    );
}

test("stores.css: the read-only store name is secondary text at full strength", () => {
    const body = storesRule(".fd-stores-page .fd-field__input:disabled");
    expect(body).toContain("color: var(--text-secondary)");
    expect(body).toContain("opacity: 1");
});

test("stores.css: a section row's ⋯ is a 24 px glyph in the secondary tone", () => {
    const body = storesRule(
        ".fd-stores-page .fd-item-row__control > .fd-menu > .fd-btn--icon",
    );
    expect(body).toContain("--fd-btn-icon: var(--space-2xl)");
    expect(body).toContain("color: var(--text-secondary)");
});

test("stores.css: a store's ⋯ menu hangs where frame 659671 draws it, on desktop only", () => {
    const at = storesCss.indexOf(".fd-store-page");
    expect(storesCss.slice(storesCss.lastIndexOf("@media", at), at)).toContain(
        "(min-width: 1024px)",
    );
    const body = storesRule(".fd-menu__panel {\n        top:");
    expect(body).toContain("top: calc(100% + var(--space-4xl))");
    expect(body).toContain("right: 116px");
});

test("a partial outside the legacy list, and the marked part of a legacy one, have no literal size, space, radius or font size", () => {
    const found: Record<string, ReturnType<typeof scaleViolations>> = {};
    for (const file of partials) {
        const text = readFileSync(join(partialsDir, file), "utf8");
        const violations = scaleViolations(
            LEGACY_PARTIALS.includes(file) ? checkedPart(text) : text,
        );
        if (violations.length > 0) found[file] = violations;
    }
    expect(found).toEqual({});
});

test("the compare page's buttons wrap inside their box and its value segments are equal fixed widths", () => {
    const settings = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/settings.css"),
        "utf8",
    );
    const buttons = settings.match(/\.fd-dup-actions \.fd-btn \{[^}]*\}/)![0];
    expect(buttons).toContain("min-width: 0");
    expect(buttons).toContain("white-space: normal");
    const segment = settings.match(/\.fd-dup-segment \{[^}]*\}/)![0];
    expect(segment).toMatch(/width:\s*168px/);
    expect(settings).toMatch(
        /\.fd-dup-segment \.fd-segmented__option \{[^}]*flex:\s*1 1 0/,
    );
});

test("sheet.css: the log sheets' unflexed section buttons leave other sheets' section buttons alone", () => {
    const sheetRules = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/sheet.css"),
        "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = sheetRules.match(
        /([^{}]*)\.fd-sheet__section\s+\.fd-btn\[data-fd-btn\]\s*\{[^}]*flex:\s*none/,
    );
    expect(rule).not.toBeNull();
    // Scoped by the log and scanner sheets' ids, so a store's delete button
    // (`.fd-store-delete > .fd-btn { flex: 1 }`) still stretches.
    const scope = (rule?.[1] ?? "").replace(/\s+/g, "");
    expect(scope).toContain(":where(#fd-log-search,");
    expect(scope).toContain("#fd-barcode-scan");
});
