import { describe, expect, test } from "bun:test";
import { stepperControl } from "./stepper-control.js";
import { buttonLabels, XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("stepperControl (Stepper, FigCraft 172312)", () => {
    const base = { name: "amount", label: "Amount", value: 150, unit: "g" };

    test("a root the live stepper script drives, two round buttons around a number field", () => {
        const html = String(stepperControl(base));
        expect(html).toContain(
            '<div class="fd-stepper-control" data-fd-stepper style="--fd-chars:3">',
        );
        expect(html).toContain('type="number" name="amount" value="150"');
        expect(html).toContain(
            'step="1" inputmode="decimal" aria-label="Amount"',
        );
        expect(html).toContain(
            '<span class="fd-stepper-control__unit" id="fd-stepper-control-amount-unit">g</span>',
        );
        expect(html.match(/data-fd-step="-1"/g)?.length).toBe(1);
        expect(html.match(/data-fd-step="1"/g)?.length).toBe(1);
        expect(html.match(/data-fd-btn/g)?.length).toBe(2);
        expect(html).toContain("fd-icon--minus");
        expect(html).toContain("fd-icon--plus");
        expect(html).not.toContain("fd-stepper__");
        expect(html).not.toContain('class="fd-stepper"');
    });

    test("buttons are named for the field and point at the input", async () => {
        const html = String(stepperControl(base));
        expect(await buttonLabels(html)).toEqual([
            "Decrease Amount",
            "Increase Amount",
        ]);
        expect(
            html.match(/aria-controls="fd-stepper-control-amount"/g)?.length,
        ).toBe(2);
    });

    test("the minus button is disabled at the minimum, the plus at the maximum", () => {
        const atMin = String(stepperControl({ ...base, min: 150, max: 500 }));
        expect(atMin).toMatch(/aria-label="Decrease Amount"[^>]* disabled/);
        expect(atMin).not.toMatch(/aria-label="Increase Amount"[^>]* disabled/);
        const atMax = String(stepperControl({ ...base, min: 0, max: 150 }));
        expect(atMax).toMatch(/aria-label="Increase Amount"[^>]* disabled/);
    });

    test("step, a typed step and min and max", () => {
        const html = String(
            stepperControl({
                ...base,
                value: 182.4,
                step: 0.1,
                inputStep: "any",
                min: 0,
                max: 900,
            }),
        );
        expect(html).toContain('data-fd-button-step="0.1"');
        expect(html).toContain('min="0" max="900" step="any"');
        expect(html).toContain("--fd-chars:5");
    });

    test('only "any" is accepted as the input\'s own step: a finer numeric step would stop + from moving', () => {
        for (const inputStep of [0.01, 1, 0.1] as const) {
            expect(() =>
                stepperControl({
                    ...base,
                    step: 0.1,
                    inputStep: inputStep as unknown as "any",
                }),
            ).toThrow(/inputStep/);
        }
        expect(() =>
            stepperControl({ ...base, step: 0.1, inputStep: "any" }),
        ).not.toThrow();
    });

    test("no unit draws none and leaves no describedby", () => {
        const html = String(
            stepperControl({ name: "n", label: "N", value: 2 }),
        );
        expect(html).not.toContain("__unit");
        expect(html).not.toContain("aria-describedby");
    });

    test("an id and a class", () => {
        const html = String(
            stepperControl({ ...base, id: "x1", className: "mine" }),
        );
        expect(html).toContain('class="fd-stepper-control mine"');
        expect(html).toContain('id="x1"');
        expect(html).toContain('id="x1-unit"');
    });

    test("refuses a value that would break the script", () => {
        expect(() => stepperControl({ ...base, value: Number.NaN })).toThrow();
        expect(() => stepperControl({ ...base, step: 1e-7 })).toThrow();
    });

    test("escapes the name, label, unit and class", () => {
        const html = String(
            stepperControl({
                name: XSS,
                label: XSS,
                value: 1,
                unit: XSS,
                className: XSS,
                id: "a",
            }),
        );
        expect(html).not.toContain("<script>");
        expect(html).toContain(XSS_ESCAPED);
    });
});

test("a step of zero or below is refused", () => {
    for (const step of [0, -1]) {
        expect(() =>
            stepperControl({ name: "n", label: "N", value: 5, step }),
        ).toThrow();
    }
});

test("the figure can belong to a form it sits outside of", () => {
    const html = String(
        stepperControl({
            name: "qty_amount",
            label: "Amount",
            value: 2,
            form: "edit-form",
        }),
    );
    expect(html).toMatch(/<input[^>]*name="qty_amount"[^>]*form="edit-form"/);
    expect(
        String(stepperControl({ name: "q", label: "Q", value: 1 })),
    ).not.toContain("form=");
});
