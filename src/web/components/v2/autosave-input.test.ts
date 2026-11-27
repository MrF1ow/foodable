import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { autosaveInput } from "./autosave-input.js";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";

const base = {
    id: "goals-daily-calories",
    action: "/settings/goals/field",
    fields: { field: "daily_calories" },
    value: "2200",
    label: "Calories",
};

test("one value is a form that saves itself: hidden fields, the label around the input, a unit after it", () => {
    const html = autosaveInput({ ...base, unit: "kcal", inputmode: "decimal" });
    expect(html).toStartWith(
        `<form class="fd-autosave-input" method="post" action="/settings/goals/field" data-fd-autosave>`,
    );
    expect(html).toContain(
        `<input type="hidden" name="field" value="daily_calories">`,
    );
    expect(html).toContain(
        `<label class="fd-autosave-input__control"><span class="fd-autosave-input__label">Calories</span>`,
    );
    expect(html).toContain(
        `class="fd-autosave-input__field" id="goals-daily-calories" name="value" type="text" inputmode="decimal" value="2200" autocomplete="off" data-fd-autosave-input>`,
    );
    expect(html).toContain(`<span class="fd-autosave-input__unit">kcal</span>`);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("autofocus");
});

test("a hidden label is the input's name only, and the form is bare", () => {
    const html = autosaveInput({ ...base, labelHidden: true });
    expect(html).toContain("fd-autosave-input fd-autosave-input--bare");
    expect(html).toContain(`<span class="fd-visually-hidden">Calories</span>`);
    expect(html).not.toContain("fd-autosave-input__label");
});

test("a refusal marks the input and sits under it, described by it", () => {
    const html = autosaveInput({
        ...base,
        value: "99999",
        error: "Calories must be at most 20000.",
    });
    expect(html).toContain(
        `aria-invalid="true" aria-describedby="goals-daily-calories-error"`,
    );
    expect(html).toContain(
        `<p class="fd-autosave-input__error" id="goals-daily-calories-error" role="alert">Calories must be at most 20000.</p>`,
    );
    expect(html).toContain('value="99999"');
});

test("a placeholder, a length cap, a class and data land where they belong", () => {
    const html = autosaveInput({
        ...base,
        placeholder: "Not set",
        maxlength: 40,
        className: "x",
        data: { y: "1" },
    });
    expect(html).toContain('placeholder="Not set"');
    expect(html).toContain('maxlength="40"');
    expect(html).toContain('class="fd-autosave-input x"');
    expect(html).toContain(' data-y="1"');
});

test("every string is escaped", async () => {
    const html = autosaveInput({
        ...base,
        value: XSS,
        label: XSS,
        unit: XSS,
        placeholder: XSS,
        error: XSS,
        fields: { field: XSS },
    });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>alert(1)");
    expect(await injectedAttributes(html)).toEqual([]);
});

test("the field has a small corner and roomier padding, not the pill of the legacy input rule", () => {
    const css = readFileSync("./public/app/v2/item-row.css", "utf8");
    const rule = css.match(/\n\.fd-autosave-input__field \{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    // Only the top corners round, so the bottom-border line stays straight
    // under the value instead of curling up into the unit.
    expect(rule).toContain(
        "border-radius: var(--radius-xs) var(--radius-xs) 0 0",
    );
    expect(rule).toContain(
        "padding: var(--space-xs) 0 var(--space-xs) var(--space-sm)",
    );
    expect(rule).not.toContain("999px");
    // A bare field fills its row, so the padding must sit inside its width.
    expect(css).toMatch(
        /\.fd-autosave-input--bare \.fd-autosave-input__field \{\s*box-sizing: border-box;/,
    );
    // A bare field (the Goals card's name and note) sits on the card's text
    // column: no side padding.
    const bare = css.match(
        /\.fd-autosave-input--bare \.fd-autosave-input__field \{([^}]*)\}/,
    )?.[1];
    expect(bare).toContain("padding-inline: 0;");
    // The v2 partial beats /app.css, which stays as it was.
    expect(readFileSync("./public/app/app.css", "utf8")).toContain(
        "border-radius: 12px;",
    );
});

test("the unit sits one gap from the value, and the field's line stops before it", () => {
    const css = readFileSync("./public/app/v2/item-row.css", "utf8");
    const entry = css.match(/\n\.fd-autosave-input__entry \{([^}]*)\}/)?.[1];
    const unit = css.match(/\n\.fd-autosave-input__unit \{([^}]*)\}/)?.[1];
    expect(entry).toContain("gap: var(--space-xs)");
    // The field has no right padding and the unit no margin of its own, so
    // the gap is the entry's 4px and the field's line never runs under it.
    expect(unit).not.toContain("margin-inline-start");
});

test("the Saved foods divider has one gap below it and takes the row above's own hairline, so no line doubles", () => {
    const css = readFileSync("./public/app/v2/settings.css", "utf8");
    const rule = css.match(/\n\.fd-settings-divider \{([^}]*)\}/)?.[1];
    expect(rule).toContain("margin: 0 0 var(--space-md)");
    expect(rule).toContain("border-top: 1px solid var(--line)");
    expect(css).toMatch(
        /\.fd-list-group:has\(\+ \.fd-settings-divider\) > \.fd-item-row:last-child \{\s*border-bottom-color: transparent;/,
    );
});
