/**
 * The live stepper builder's markup, pinned byte for byte. The design's new
 * component has its own module and class; this output must not move until the
 * pages that call it switch over.
 */
import { expect, test } from "bun:test";
import { raw } from "./html.js";
import { stepper } from "./stepper.js";

test("stepper: the live output with min, max and a unit is unchanged", () => {
    expect(
        stepper({
            name: "amount",
            label: "Amount",
            value: 150,
            step: 5,
            min: 0,
            max: 500,
            unit: "g",
        }),
    ).toBe(
        raw(
            '<div class="fd-stepper" data-fd-stepper style="--fd-chars:3"><button type="button" class="fd-stepper__btn fd-stepper__btn--minus" aria-label="Decrease Amount" data-fd-step="-1" aria-controls="fd-stepper-amount"><svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/></svg></button><div class="fd-stepper__value"><input class="fd-stepper__input" id="fd-stepper-amount" type="number" name="amount" value="150" min="0" max="500" step="5" inputmode="decimal" aria-label="Amount" aria-describedby="fd-stepper-amount-unit"><span class="fd-stepper__unit" id="fd-stepper-amount-unit">g</span></div><button type="button" class="fd-stepper__btn fd-stepper__btn--plus" aria-label="Increase Amount" data-fd-step="1" aria-controls="fd-stepper-amount"><svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg></button></div>',
        ),
    );
});

test("stepper: the live output with a typed step, id and class is unchanged", () => {
    expect(
        stepper({
            name: "w",
            label: "Weight",
            value: 182.4,
            step: 0.1,
            inputStep: "any",
            unit: "lb",
            id: "w1",
            className: "x",
        }),
    ).toBe(
        raw(
            '<div class="fd-stepper x" data-fd-stepper data-fd-button-step="0.1" style="--fd-chars:5"><button type="button" class="fd-stepper__btn fd-stepper__btn--minus" aria-label="Decrease Weight" data-fd-step="-1" aria-controls="w1"><svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/></svg></button><div class="fd-stepper__value"><input class="fd-stepper__input" id="w1" type="number" name="w" value="182.4" step="any" inputmode="decimal" aria-label="Weight" aria-describedby="w1-unit"><span class="fd-stepper__unit" id="w1-unit">lb</span></div><button type="button" class="fd-stepper__btn fd-stepper__btn--plus" aria-label="Increase Weight" data-fd-step="1" aria-controls="w1"><svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg></button></div>',
        ),
    );
});
