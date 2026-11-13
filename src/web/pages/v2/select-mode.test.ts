import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectMode } from "./select-mode.js";

const GROCERIES = selectMode({
    scope: "groceries",
    returnTo: "/kitchen/groceries?store=s1",
    actions: [
        {
            kind: "submit",
            key: "check",
            label: "Check off",
            action: "/kitchen/groceries/bulk/check",
        },
        {
            kind: "confirm",
            key: "remove",
            label: "Delete",
            action: "/kitchen/groceries/bulk/remove",
            title: "Delete items",
            one: "Delete 1 item?",
            many: "Delete {n} items?",
            confirmLabel: "Delete",
        },
    ],
});

test("the root attribute names the list the toggle and the rows belong to", () => {
    expect(GROCERIES.rootAttrs).toBe(' data-fd-select="groceries"');
});

test("the Select toggle is a plain button naming its list", () => {
    expect(GROCERIES.toggle).toContain(`data-fd-select-toggle="groceries"`);
    expect(GROCERIES.toggle).toContain(">Select</button>");
    expect(GROCERIES.toggle).toContain('type="button"');
    expect(GROCERIES.tools).toContain("fd-select-tools");
    expect(GROCERIES.tools).toContain(GROCERIES.toggle);
});

test("the bar starts hidden with a live count, Cancel, and a disabled-until-picked action each", () => {
    const bar = GROCERIES.bar;
    expect(bar).toContain('data-fd-select-bar="groceries"');
    expect(bar).toMatch(/<div class="fd-select-bar"[^>]* hidden>/);
    expect(bar).toContain('role="region"');
    expect(bar).toContain('aria-label="Selected items"');
    expect(bar).toContain(
        `<span class="fd-select-bar__count" data-fd-select-count role="status">0 selected</span>`,
    );
    expect(bar).toContain(
        `<button type="button" class="fd-btn fd-btn--sm" data-fd-select-cancel>Cancel</button>`,
    );
    expect((bar.match(/data-fd-select-action/g) ?? []).length).toBe(2);
});

test("a plain action posts its own form, which takes the picked ids when it is sent", () => {
    // The form is outside the rows; the client adds the picked ids on submit.
    expect(GROCERIES.bar).toContain(
        `<form id="fd-select-groceries-check" method="post" action="/kitchen/groceries/bulk/check" data-fd-select-form hidden><input type="hidden" name="return_to" value="/kitchen/groceries?store=s1"></form>`,
    );
    expect(GROCERIES.bar).toContain(
        `<button type="submit" class="fd-btn fd-btn--primary" form="fd-select-groceries-check" data-fd-select-action>Check off</button>`,
    );
});

test("a confirm action opens a sheet that states the count, and its form takes the ids", () => {
    expect(GROCERIES.bar).toContain(
        `commandfor="fd-select-groceries-remove" command="show-modal"`,
    );
    expect(GROCERIES.bar).toContain("data-fd-select-action");
    const sheets = GROCERIES.sheets;
    expect(sheets).toContain(`<dialog class="fd-sheet fd-sheet--confirm`);
    expect(sheets).toContain('id="fd-select-groceries-remove"');
    expect(sheets).toContain(
        `<p class="fd-sheet-message" data-fd-select-message data-one="Delete 1 item?" data-many="Delete {n} items?">Delete the selected items?</p>`,
    );
    expect(sheets).toContain(
        `<form id="fd-select-groceries-remove-form" method="post" action="/kitchen/groceries/bulk/remove" data-fd-select-form>`,
    );
    expect(sheets).toContain(
        `<input type="hidden" name="return_to" value="/kitchen/groceries?store=s1">`,
    );
    expect(sheets).toContain(
        `<button type="button" class="fd-btn" command="close" commandfor="fd-select-groceries-remove">Cancel</button>`,
    );
    expect(sheets).toContain(
        `<button type="submit" class="fd-btn fd-btn--danger" form="fd-select-groceries-remove-form">Delete</button>`,
    );
});

test("a plain-only list has no sheets", () => {
    const only = selectMode({
        scope: "x",
        returnTo: "/x",
        actions: [{ kind: "submit", key: "go", label: "Go", action: "/x/go" }],
    });
    expect(only.sheets).toBe("");
});

test("labels, ids and the return path are escaped", () => {
    const evil = `"><script>alert(1)</script>`;
    const html = selectMode({
        scope: "s",
        returnTo: evil,
        actions: [
            {
                kind: "confirm",
                key: "k",
                label: evil,
                action: "/a",
                title: evil,
                one: evil,
                many: evil,
                confirmLabel: evil,
            },
        ],
    });
    const all = html.bar + html.sheets;
    expect(all).not.toContain("<script>");
});

describe("select.css", () => {
    const css = readFileSync(
        join(import.meta.dir, "../../../../public/app/v2/select.css"),
        "utf8",
    );
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

    test("takes every colour from a token", () => {
        expect(rules.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
        expect(rules.match(/\b(?:rgba?|hsla?|oklch|color)\(/g)).toBeNull();
        const tokens = readFileSync(
            join(import.meta.dir, "../../../../public/app/v2/tokens.css"),
            "utf8",
        );
        const components = readFileSync(
            join(import.meta.dir, "../../../../public/app/v2/components.css"),
            "utf8",
        );
        const defined = new Set(
            [...(tokens + components).matchAll(/(--[\w-]+)\s*:/g)].map(
                (m) => m[1]!,
            ),
        );
        const used = [...rules.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
        expect(used.filter((v) => !defined.has(v))).toEqual([]);
    });

    test("has one media block, the desktop one, last, and no max-width query", () => {
        const queries = [...rules.matchAll(/@media[^{]*/g)].map((m) =>
            m[0].trim(),
        );
        expect(queries).toEqual(["@media (min-width: 1024px)"]);
        expect(rules.lastIndexOf("@media")).toBeGreaterThan(
            rules.lastIndexOf(".fd-select-bar .fd-btn:disabled"),
        );
        expect(rules).not.toContain("max-width");
    });

    test("styles every hook the markup and the script use", () => {
        for (const cls of [
            "fd-select-tools",
            "fd-select-toggle",
            "fd-select-bar",
            "fd-select-bar__count",
            "fd-select-bar__actions",
            "fd-row__select",
            "fd-row__select-input",
            "fd-row__select-box",
            "fd-row--selectable",
        ]) {
            expect(rules).toContain(`.${cls}`);
        }
        expect(rules).toContain("[data-fd-selecting]");
    });

    test("the box is a rounded square filled with ink, not the green tick circle", () => {
        const block = (selector: string): string => {
            const at = rules.indexOf(`${selector} {`);
            expect(at, `${selector} is styled`).toBeGreaterThan(-1);
            return rules.slice(at, rules.indexOf("}", at));
        };
        const box = block(".fd-row__select-box");
        expect(box).not.toContain("radius-pill");
        expect(box).toContain("border-radius: calc(var(--radius-sm) / 2)");
        const picked = block(
            ".fd-row__select-input:checked + .fd-row__select-box",
        );
        expect(picked).toContain("background: var(--text-primary)");
        expect(picked).not.toContain("accent");
    });

    test("a grocery line's tick shows beside the box only while selecting", () => {
        expect(rules).toMatch(
            /\.fd-check\.fd-row__select-state\s*\{\s*display:\s*none;/,
        );
        expect(rules).toMatch(
            /\[data-fd-selecting\] \.fd-check\.fd-row__select-state\s*\{\s*display:\s*block;/,
        );
        // The tick button itself still steps aside, so a tap only picks.
        expect(rules).toMatch(
            /\.fd-row--grocery\.fd-row--selectable\s*>\s*\.fd-row__body\s*>\s*\.fd-row__lead\s*\{\s*display:\s*none;/,
        );
    });

    test("the box stays out of sight until the list is selecting", () => {
        expect(rules).toMatch(/\.fd-row__select\s*\{\s*display:\s*none;/);
        expect(rules).toMatch(
            /\[data-fd-selecting\] \.fd-row__select\s*\{[^}]*display:\s*grid;/,
        );
    });

    test("the box opts out of the old app's 36px checkbox-label floor, so rows keep their height", () => {
        const at = rules.indexOf("[data-fd-selecting] .fd-row__select {");
        expect(at).toBeGreaterThanOrEqual(0);
        expect(rules.slice(at, rules.indexOf("}", at))).toMatch(
            /min-height:\s*0\b/,
        );
    });

    test("is included in /app-v2.css", () => {
        const app = readFileSync(
            join(import.meta.dir, "../../../../public/app/v2/app-v2.css"),
            "utf8",
        );
        expect(app).toContain("/*@include select.css@*/");
    });
});
