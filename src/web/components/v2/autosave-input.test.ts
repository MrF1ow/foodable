import { expect, test } from "bun:test";
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
