/**
 * Stepper, FigCraft `#20578` (also `#21063`, `#22681`): a round minus button, a
 * big centred value with its unit, a round plus button.
 *
 * The value is a real `<input type="number">` (name, min, max, step,
 * `inputmode="decimal"`), so it submits with the form and works with no JS.
 * `src/web/client/v2/stepper.js` adds the − / + behaviour; without it the
 * buttons do nothing and the field is still typeable. The buttons start
 * `disabled` at the bounds of the initial value; the script keeps them current.
 */
import { actionButton, esc, raw, type Html } from "./html.js";
import { iconMinus, iconPlus } from "./icons.js";

export type StepperOpts = {
    /** Form field name. */
    name: string;
    /** Accessible name of the input and in the button names ("Amount" → "Decrease Amount"). */
    label: string;
    value: number;
    /** Default 1. Use a decimal ("0.1") for weights. */
    step?: number;
    min?: number;
    max?: number;
    /** Shown beside the value ("g", "lb"); also `aria-describedby` of the input. */
    unit?: string;
    /**
     * Input id, which the buttons' `aria-controls` points at. Default derived
     * from `name`, so pass one whenever a page renders two steppers with the
     * same name (one per row), or the ids collide.
     */
    id?: string;
    className?: string;
};

/**
 * A number for an attribute. Non-finite numbers and exponent forms ("1e-7")
 * throw: the input would get `value="NaN"`, and stepper.js counts the step's
 * decimals from its text, so an exponent would round every step away.
 */
function num(field: string, n: number): string {
    const text = String(n);
    if (!Number.isFinite(n) || /e/i.test(text)) {
        throw new Error(
            `stepper: ${field} must be a plain finite number, got ${text}`,
        );
    }
    return text;
}

function numAttr(name: string, n: number | undefined): string {
    return n == null ? "" : ` ${name}="${num(name, n)}"`;
}

/** Digits of the value, for the input's no-JS width (`--fd-chars`). */
function chars(value: number): number {
    return Math.max(2, String(value).length);
}

export function stepper(opts: StepperOpts): Html {
    const step = num("step", opts.step ?? 1);
    const value = num("value", opts.value);
    const id = opts.id ?? `fd-stepper-${opts.name}`;
    const unitId = `${id}-unit`;
    const atMin = opts.min != null && opts.value <= opts.min;
    const atMax = opts.max != null && opts.value >= opts.max;
    const button = (dir: "down" | "up") =>
        actionButton({
            label: `${dir === "down" ? "Decrease" : "Increase"} ${opts.label}`,
            iconOnly: true,
            content: dir === "down" ? iconMinus() : iconPlus(),
            className: `fd-stepper__btn fd-stepper__btn--${dir === "down" ? "minus" : "plus"}`,
            disabled: dir === "down" ? atMin : atMax,
            data: { "fd-step": dir === "down" ? "-1" : "1" },
            extraAttrs: ` aria-controls="${esc(id)}"`,
        });
    const unit = opts.unit
        ? `<span class="fd-stepper__unit" id="${esc(unitId)}">${esc(opts.unit)}</span>`
        : "";
    const input = `<input class="fd-stepper__input" id="${esc(id)}" type="number" name="${esc(opts.name)}" value="${value}"${numAttr("min", opts.min)}${numAttr("max", opts.max)} step="${step}" inputmode="decimal" aria-label="${esc(opts.label)}"${opts.unit ? ` aria-describedby="${esc(unitId)}"` : ""}>`;
    return raw(
        `<div class="fd-stepper${opts.className ? ` ${esc(opts.className)}` : ""}" data-fd-stepper style="--fd-chars:${chars(opts.value)}">${button("down")}<div class="fd-stepper__value">${input}${unit}</div>${button("up")}</div>`,
    );
}
