import { expect, test } from "bun:test";
import { field } from "./field.js";
import { injectedAttributes, XSS } from "./test-helpers.js";

test("a field is a box around a named input", () => {
    const html = field({
        id: "email",
        label: "Email or username",
        name: "email",
    });
    expect(html).toStartWith('<div class="fd-field">');
    expect(html).toContain(
        '<span class="fd-field__label">Email or username</span>',
    );
    // The label wraps its text and the input; there is no for/id pairing to break.
    expect(html).not.toContain(" for=");
    expect(html).toContain(
        '<input class="fd-field__input" id="email" name="email" type="text"',
    );
    expect(html).not.toContain("fd-field__hint");
    expect(html).not.toContain("fd-field__error");
    expect(html).not.toContain("aria-invalid");
});

test("a time field is a native time input holding its value", () => {
    const html = field({
        id: "at",
        label: "Time",
        name: "logged_time",
        type: "time",
        value: "12:30",
    });
    expect(html).toContain('name="logged_time" type="time" value="12:30"');
});

test("labelHidden keeps the accessible name and draws no label", () => {
    const html = field({
        id: "q",
        label: "Amount",
        name: "q",
        labelHidden: true,
    });
    // The text stays inside the <label>, so the input is still named by it.
    expect(html).toContain(
        '<label class="fd-field__control"><span class="fd-visually-hidden">Amount</span>',
    );
    expect(html).not.toContain("fd-field__label");
    expect(field({ id: "q", label: "Amount", name: "q" })).not.toContain(
        "fd-visually-hidden",
    );
});

test("type, value, placeholder, autocomplete, required and disabled are written", () => {
    const html = field({
        id: "p",
        label: "Password",
        name: "p",
        type: "password",
        value: "v",
        placeholder: "ph",
        autocomplete: "current-password",
        required: true,
        disabled: true,
    });
    expect(html).toContain('type="password"');
    expect(html).toContain('value="v"');
    expect(html).toContain('placeholder="ph"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain(" required");
    expect(html).toContain(" disabled");
});

test("a trailing icon is decoration inside the box", () => {
    expect(
        field({ id: "a", label: "A", name: "a", trailingIcon: "eye" }),
    ).toContain(
        '<span class="fd-field__icon" aria-hidden="true"><svg class="fd-icon fd-icon--eye"',
    );
});

test("a box takes a length range and a keyboard hint", () => {
    const html = field({
        id: "n",
        label: "Name",
        name: "n",
        minlength: 2,
        maxlength: 80,
        autocapitalize: "none",
        spellcheck: false,
    });
    expect(html).toContain('minlength="2"');
    expect(html).toContain('maxlength="80"');
    expect(html).toContain('autocapitalize="none"');
    expect(html).toContain('spellcheck="false"');
});

test("a hint is described by the input", () => {
    const html = field({ id: "a", label: "A", name: "a", hint: "Lowercase" });
    expect(html).toContain(
        '<span class="fd-field__hint" id="a-hint">Lowercase</span>',
    );
    expect(html).toContain('aria-describedby="a-hint"');
});

test("an error marks the input invalid and replaces the hint", () => {
    const html = field({
        id: "a",
        label: "A",
        name: "a",
        hint: "Lowercase",
        error: "Already taken",
    });
    expect(html).toContain("fd-field fd-field--invalid");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(
        '<span class="fd-field__error" id="a-error">Already taken</span>',
    );
    expect(html).toContain('aria-describedby="a-error"');
    expect(html).not.toContain("Lowercase");
});

test("the old field classes are not used", () => {
    const html = field({ id: "a", label: "A", name: "a" });
    expect(html).not.toMatch(/class="field\b/);
});

test("the label wraps only its text and the input, so the note is not in the name", () => {
    for (const note of [{ hint: "Lowercase" }, { error: "Already taken" }]) {
        const html = String(field({ id: "a", label: "A", name: "a", ...note }));
        const label = html.match(/<label\b[^>]*>(.*?)<\/label>/s)?.[1] ?? "";
        expect(label).toContain("fd-field__label");
        expect(label).toContain("<input ");
        expect(label).not.toContain("fd-field__hint");
        expect(label).not.toContain("fd-field__error");
        // The note is a sibling, reached through aria-describedby.
        expect(html).toMatch(/<\/label><span class="fd-field__(hint|error)"/);
    }
});

test("every string is escaped", async () => {
    const html = field({
        id: XSS,
        label: XSS,
        name: XSS,
        value: XSS,
        placeholder: XSS,
        hint: XSS,
        autocomplete: XSS,
        className: XSS,
        data: { k: XSS },
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
    const withError = field({ id: "a", label: "A", name: "a", error: XSS });
    expect(withError).not.toContain("<script>");
});

test("autofocus and input data land on the input, not the wrapper", () => {
    const html = field({
        id: "n",
        label: "Name",
        name: "name",
        autofocus: true,
        inputData: { "fd-autosave-input": "" },
        data: { x: "1" },
    });
    expect(html).toMatch(/<input [^>]*autofocus data-fd-autosave-input=""/);
    expect(html).toStartWith('<div class="fd-field" data-x="1">');
    expect(field({ id: "n", label: "Name", name: "name" })).not.toContain(
        "autofocus",
    );
});

test("a number box takes its bounds, step and keypad; a date-time box is a type", () => {
    const num = String(
        field({
            id: "p",
            label: "Protein g",
            name: "protein_g",
            type: "number",
            min: 0,
            step: 0.1,
            inputmode: "decimal",
        }),
    );
    expect(num).toContain('type="number"');
    expect(num).toContain('min="0"');
    expect(num).toContain('step="0.1"');
    expect(num).toContain('inputmode="decimal"');
    expect(
        String(
            field({
                id: "t",
                label: "Time",
                name: "logged_at",
                type: "datetime-local",
            }),
        ),
    ).toContain('type="datetime-local"');
    expect(
        String(field({ id: "a", label: "A", name: "a", step: "any" })),
    ).toContain('step="any"');
});
