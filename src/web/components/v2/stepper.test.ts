import { expect, test } from "bun:test";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";
import { stepper } from "./stepper.js";

test("the value is a real number input with name, bounds, step and decimal keypad", () => {
    const html = stepper({
        name: "amount",
        label: "Amount",
        value: 150,
        min: 0,
        max: 5000,
        step: 5,
        unit: "g",
    });
    expect(html).toContain(
        `<div class="fd-stepper" data-fd-stepper style="--fd-chars:3">`,
    );
    expect(html).toContain(`type="number"`);
    expect(html).toContain(`name="amount"`);
    expect(html).toContain(`value="150"`);
    expect(html).toContain(`min="0"`);
    expect(html).toContain(`max="5000"`);
    expect(html).toContain(`step="5"`);
    expect(html).toContain(`inputmode="decimal"`);
    expect(html).toContain(`aria-label="Amount"`);
    expect(html).toContain(`aria-describedby="fd-stepper-amount-unit"`);
    expect(html).toContain(
        `<span class="fd-stepper__unit" id="fd-stepper-amount-unit">g</span>`,
    );
});

test("the buttons are named, typed, wired to the input and carry the step direction", () => {
    const html = stepper({ name: "amount", label: "Amount", value: 150 });
    expect(html).toContain(
        `<button type="button" class="fd-stepper__btn fd-stepper__btn--minus" aria-label="Decrease Amount" data-fd-step="-1" aria-controls="fd-stepper-amount">`,
    );
    expect(html).toContain(
        `<button type="button" class="fd-stepper__btn fd-stepper__btn--plus" aria-label="Increase Amount" data-fd-step="1" aria-controls="fd-stepper-amount">`,
    );
    expect(html).toContain(`id="fd-stepper-amount"`);
});

test("step defaults to 1, bounds are omitted when unset, no unit means no describedby", () => {
    const html = stepper({ name: "n", label: "N", value: 3 });
    expect(html).toContain(`step="1"`);
    expect(html).not.toContain(" min=");
    expect(html).not.toContain(" max=");
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("fd-stepper__unit");
});

test("decimals pass through in the value and step", () => {
    const html = stepper({
        name: "w",
        label: "Weight",
        value: 182.4,
        step: 0.1,
    });
    expect(html).toContain(`value="182.4"`);
    expect(html).toContain(`step="0.1"`);
});

test("minus is disabled at min and plus at max, and only there", () => {
    const atMin = stepper({ name: "n", label: "N", value: 0, min: 0, max: 10 });
    expect(atMin).toMatch(/fd-stepper__btn--minus"[^>]*disabled/);
    expect(atMin).not.toMatch(/fd-stepper__btn--plus"[^>]*disabled/);
    const atMax = stepper({
        name: "n",
        label: "N",
        value: 10,
        min: 0,
        max: 10,
    });
    expect(atMax).not.toMatch(/fd-stepper__btn--minus"[^>]*disabled/);
    expect(atMax).toMatch(/fd-stepper__btn--plus"[^>]*disabled/);
    const mid = stepper({ name: "n", label: "N", value: 5, min: 0, max: 10 });
    expect(mid).not.toContain("disabled");
    const free = stepper({ name: "n", label: "N", value: 0 });
    expect(free).not.toContain("disabled");
});

test("an explicit id is used for the input, controls and unit", () => {
    const html = stepper({
        name: "n",
        label: "N",
        value: 1,
        unit: "x",
        id: "amt",
    });
    expect(html).toContain(`id="amt"`);
    expect(html.match(/aria-controls="amt"/g)?.length).toBe(2);
    expect(html).toContain(`id="amt-unit"`);
});

test("every string is escaped", () => {
    const html = stepper({
        name: XSS,
        label: XSS,
        value: 1,
        unit: XSS,
        id: XSS,
        className: XSS,
    });
    expect(html).not.toContain("<script");
    expect(html).toContain(`name="${XSS_ESCAPED}"`);
    expect(html).toContain(`aria-label="Decrease ${XSS_ESCAPED}"`);
    expect(html).toContain(`aria-controls="${XSS_ESCAPED}"`);
});

test("the no-JS width hint sits on the root, where stepper.js updates it", () => {
    const html = stepper({ name: "n", label: "N", value: 1250 });
    expect(html).toMatch(
        /<div class="fd-stepper" data-fd-stepper style="--fd-chars:4">/,
    );
    // An own value on the input would override the root's updated one.
    expect(html).not.toMatch(/<input[^>]*--fd-chars/);
});

test("non-finite and exponent-form numbers throw instead of rendering", () => {
    expect(() => stepper({ name: "n", label: "N", value: NaN })).toThrow();
    expect(() =>
        stepper({ name: "n", label: "N", value: 1, step: 1e-7 }),
    ).toThrow();
    expect(() =>
        stepper({ name: "n", label: "N", value: 1, max: Infinity }),
    ).toThrow();
});
