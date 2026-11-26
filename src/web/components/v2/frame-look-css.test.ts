import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Look rules the final frame comparison fixed, each pinned to the frame it
 * follows. CSS only: the markup these rules style is pinned by the page tests.
 */

function css(file: string): string {
    return readFileSync(
        join(import.meta.dir, "../../../../public/app/v2", file),
        "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(text: string, selector: string, from = 0): string {
    const flat = (s: string) => s.replace(/\s+/g, " ").trim();
    const want = flat(selector);
    const re = /([^{}]+)\{([^{}]*)\}/g;
    re.lastIndex = from;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (flat(m[1]!) === want) return m[2]!;
    }
    throw new Error(`no rule for ${selector}`);
}

/** The text of every `@media (…)` block with this condition, joined. */
function media(text: string, condition: string): string {
    const blocks: string[] = [];
    let start = text.indexOf(`@media ${condition}`);
    expect(start).toBeGreaterThan(-1);
    while (start !== -1) {
        let depth = 0;
        let end = -1;
        for (let i = text.indexOf("{", start); i < text.length; i++) {
            if (text[i] === "{") depth++;
            if (text[i] === "}" && --depth === 0) {
                end = i + 1;
                break;
            }
        }
        if (end === -1) throw new Error(`unclosed ${condition}`);
        blocks.push(text.slice(start, end));
        start = text.indexOf(`@media ${condition}`, end);
    }
    return blocks.join("\n");
}

test("an unselected chip has no fill, only the line stroke (531717)", () => {
    const body = rule(
        css("components.css"),
        ".fd-chip:not(.fd-chip--choice), .fd-chip__face",
    );
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/border:\s*1px solid var\(--line\)/);
});

test("recipe steps are numbered rows with a hairline under each (402459)", () => {
    const text = css("recipes.css");
    expect(rule(text, ".fd-recipe-steps")).toMatch(/list-style:\s*none/);
    const row = rule(text, ".fd-recipe-steps > li");
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(row).toMatch(/counter-increment:\s*fd-step/);
    expect(rule(text, ".fd-recipe-steps > li::before")).toMatch(
        /content:\s*counter\(fd-step\)/,
    );
});

test("the fridge item's action tiles are rounded squares on the phone, circles from 1024 px (393841)", () => {
    const text = css("kitchen.css");
    const desktop = media(text, "(min-width: 1024px)");
    expect(
        rule(desktop, ".fd-kitchen-item-actions .fd-quick-action__box"),
    ).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    // No unconditional circle: outside the media query the tile keeps the
    // Quick action's own rounded square.
    let outside = text;
    for (const block of desktop.split("\n@media")) {
        outside = outside.replace(block.replace(/^(?!@media)/, "@media"), "");
    }
    expect(outside).not.toMatch(
        /\.fd-kitchen-item-actions \.fd-quick-action__box\s*\{[^}]*radius-pill/,
    );
});

test("the camera well is a token: #1a1d1c in light, near black in dark (533599)", () => {
    const text = css("scanner.css");
    expect(rule(text, ".fd-camera-view")).toMatch(
        /background:\s*var\(--fd-camera-well\)/,
    );
    expect(rule(text, ".fd-camera-view__feed")).toMatch(
        /background:\s*var\(--fd-camera-well\)/,
    );
    expect(rule(text, ':root[data-theme="light"]')).toMatch(
        /--fd-camera-well:\s*#1a1d1c/,
    );
    expect(rule(text, ':root[data-theme="dark"]')).toMatch(
        /--fd-camera-well:\s*#050606/,
    );
    // The well's rules name no colour of their own.
    expect(text.replace(/--fd-camera-well:\s*#[0-9a-f]+/gi, "")).not.toMatch(
        /#[0-9a-f]{3,8}\b/i,
    );
});

test("the desktop week strip hides its ‹ › until the keyboard reaches one (594788)", () => {
    const desktop = media(css("today.css"), "(min-width: 1024px)");
    const hidden = rule(
        desktop,
        ".fd-today-week > .fd-btn:not(:focus-visible)",
    );
    expect(hidden).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(hidden).toMatch(/width:\s*1px/);
});

test("the Groceries dock sizes each button to its words, so Put N away in the kitchen is not clipped (394511)", () => {
    expect(
        rule(
            css("kitchen.css"),
            ".fd-kitchen-grocery-dock .fd-btn[data-fd-btn]",
        ),
    ).toMatch(/flex:\s*1 1 auto/);
});

test("the desktop recipe header's Plan and Cook are the Small size (609258)", () => {
    const desktop = media(css("recipes.css"), "(min-width: 1024px)");
    const body = rule(
        desktop,
        ".fd-recipe-bar:not(.fd-recipe-bar--draft) > [data-fd-btn]",
    );
    expect(body).toMatch(/height:\s*var\(--control-md-height\)/);
    expect(body).toMatch(/min-width:\s*0/);
});

test("the duplicates value pickers are 32 px on the phone (416488)", () => {
    const phone = media(css("settings.css"), "(max-width: 1023px)");
    expect(rule(phone, ".fd-segmented.fd-dup-segment")).toMatch(
        /height:\s*var\(--control-sm-height\)/,
    );
    expect(
        rule(
            phone,
            ".fd-dup-segment .fd-segmented__option .fd-segmented__segment",
        ),
    ).toMatch(/font-size:\s*var\(--text-caption-size\)/);
});

test("a picked radio keeps its ring's line around the fill (404903)", () => {
    expect(
        rule(
            css("item-row.css"),
            ".fd-item-row__check--radio .fd-item-row__check-input:checked + .fd-item-row__check-box",
        ),
    ).toMatch(/border-color:\s*var\(--text-secondary\)/);
});

test("desktop Add member sits at the foot of its panel (666635)", () => {
    const desktop = media(css("settings.css"), "(min-width: 1024px)");
    expect(rule(desktop, "#fd-household-add-member .fd-sheet-body")).toMatch(
        /flex:\s*1 1 auto/,
    );
});

test("the household token is one line, clipped (425210)", () => {
    const body = rule(
        css("settings.css"),
        ".fd-settings-invite-code__box code#household-token",
    );
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/overflow:\s*hidden/);
});
