import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
    join(import.meta.dir, "../../../../public/app/v2/components.css"),
    "utf8",
);
// Comments may quote hex values or class names; the rules are what ships.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("components.css has no colour literal: every colour is a token", () => {
    expect(rules.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(
        rules.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g),
    ).toBeNull();
    // Named colours would slip past the checks above.
    expect(
        rules.match(
            /:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/g,
        ),
    ).toBeNull();
});

test("components.css only defines fd- classes and --fd- locals", () => {
    const selectors = rules.replace(/\{[^{}]*\}/g, "{}");
    const classes = [...selectors.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(
        (m) => m[1]!,
    );
    expect(classes.length).toBeGreaterThan(40);
    expect(classes.filter((c) => !c.startsWith("fd-"))).toEqual([]);
    const declared = [...rules.matchAll(/[{;]\s*(--[\w-]+)\s*:/g)].map(
        (m) => m[1]!,
    );
    expect(declared.filter((v) => !v.startsWith("--fd-"))).toEqual([]);
});

test("every var(--x) it reads is a tokens.css name or an --fd- local", () => {
    const tokens = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/tokens.css"),
        "utf8",
    );
    const defined = new Set(
        [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!),
    );
    const used = [...rules.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
    const unknown = used.filter(
        (v) => !defined.has(v) && !v.startsWith("--fd-"),
    );
    expect(unknown).toEqual([]);
});

test("transitions are switched off under prefers-reduced-motion", () => {
    expect(rules).toContain("prefers-reduced-motion: reduce");
    expect(rules.match(/transition:/g)?.length).toBeGreaterThan(0);
});

test("a row's name is one line ending in an ellipsis; its neighbours keep their line", () => {
    const block = (selector: string) =>
        rules.match(
            new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`),
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
    // The row body and the manage row's actions never wrap below the name.
    expect(rules).not.toMatch(
        /\.fd-row[\w-]*\s+\.fd-row__body\s*\{[^}]*flex-wrap:\s*wrap/,
    );
    expect(block(".fd-row--manage .fd-row__main")).toMatch(/flex:\s*1 1 0/);
    expect(block(".fd-row__actions")).toContain("flex: none");
});

test("the row delete button is a 32px circle in the danger token", () => {
    const danger =
        rules.match(/\.fd-icon-btn--danger\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(danger).toContain("width: 32px");
    expect(danger).toContain("height: 32px");
    expect(danger).toContain("var(--status-over)");
});

test("the row delete button has a 44px hit area that does not change its 32px look", () => {
    const hit =
        rules.match(/\.fd-icon-btn--danger::before\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(hit).toContain("width: 44px");
    expect(hit).toContain("height: 44px");
    expect(hit).toContain("content:");
    const danger =
        rules.match(/\.fd-icon-btn--danger\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(danger).toContain("position: relative");
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

test("a wrapping action group can shrink, and the dup row puts it under the names on a phone", () => {
    const block = (selector: string) =>
        settingsRules.match(
            new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`),
        )?.[1] ?? "";
    const wrap = block(".fd-row__actions--wrap");
    expect(wrap).toMatch(/flex:\s*0 1 auto/);
    expect(wrap).toContain("flex-wrap: wrap");
    expect(wrap).toContain("min-width: 0");
    expect(block(".fd-row--dup .fd-row__body")).toContain("flex-wrap: wrap");
    expect(block(".fd-row--dup .fd-row__main")).toMatch(/flex:\s*1 1 100%/);
});

test("a social reader's label stays inside its column and the button keeps one line", () => {
    const title =
        settingsRules.match(
            /\.fd-row--social \.fd-row__main > \.fd-row__title,[^{]*\{([^}]*)\}/,
        )?.[1] ?? "";
    expect(title).toContain("min-width: 0");
    expect(title).toContain("overflow: hidden");
    expect(title).toContain("text-overflow: ellipsis");
    expect(title).toContain("white-space: nowrap");
    expect(settingsRules).toMatch(
        /\.fd-row--social \.fd-settings-btn\s*\{[^}]*white-space:\s*nowrap/,
    );
});
