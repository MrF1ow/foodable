import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../../../../public/app/v2");
const read = (file: string): string =>
    readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector list contains `selector`. */
function ruleBody(css: string, selector: string): string {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const list = (m[1] ?? "").split(",").map((s) => s.trim());
        if (list.includes(selector)) return m[2] ?? "";
    }
    throw new Error(`no rule for ${selector}`);
}

test("side link and account icons are drawn at the 18 px tier, over the bare .fd-icon size", () => {
    const body = ruleBody(read("layout.css"), ".fd-side-link .fd-icon");
    expect(body).toContain("width: var(--control-md-icon)");
    expect(body).toContain("height: var(--control-md-icon)");
    const account = ruleBody(
        read("layout.css"),
        ".fd-sidebar__account .fd-icon",
    );
    expect(account).toBe(body);
});

test("button icons read --fd-btn-icon through a selector that beats the bare .fd-icon", () => {
    const css = read("button.css");
    expect(ruleBody(css, ":where(.fd-btn[data-fd-btn]) svg.fd-icon")).toContain(
        "width: var(--fd-btn-icon)",
    );
    // No zero-specificity icon rule is left to lose to `.fd-icon`.
    expect(css).not.toContain(":where(.fd-icon)");
});

test("quick action and field icons are sized at the 20 px tier by a two-class rule", () => {
    for (const [file, selector] of [
        ["quick-action.css", ".fd-quick-action__box .fd-icon"],
        ["field.css", ".fd-field__icon .fd-icon"],
    ] as const) {
        const body = ruleBody(read(file), selector);
        expect(body).toContain("width: var(--control-lg-icon)");
        expect(body).toContain("height: var(--control-lg-icon)");
    }
});

test("the design sidebar lays itself out as a column at every width", () => {
    const shell = readFileSync(join(dir, "shell.css"), "utf8");
    const marked = shell.slice(shell.lastIndexOf("/* scale-guard: checked */"));
    const body = ruleBody(
        marked.replace(/\/\*[\s\S]*?\*\//g, ""),
        ".fd-sidebar--design",
    );
    expect(body).toContain("flex-direction: column");
    expect(body).toContain("box-sizing: border-box");
    expect(body).toMatch(/width: min\(var\(--fd-sidebar-w\), 100%\)/);
    expect(body).toContain("border-right: 1px solid var(--line)");
    expect(body).toMatch(/gap: /);
});
