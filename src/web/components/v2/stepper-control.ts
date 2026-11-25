/**
 * The design's Stepper (FigCraft 172312): a round minus button, a big centred
 * figure with its unit, a round plus button, each button the 48 px Icon button.
 *
 * It keeps the live stepper's hooks and nothing else: the root is
 * `[data-fd-stepper]`, the buttons `[data-fd-step]`, the figure a real
 * `<input type="number">`. `client/v2/stepper.js` therefore drives it with no
 * change, and without the script the field is still typeable and submits. The
 * live `stepper.ts` and its `.fd-stepper*` classes are untouched; this is
 * `fd-stepper-control`.
 *
 * Styles: `public/app/v2/stepper-control.css`.
 */
import { button } from "./button.js";
import { cls, esc, raw, type Html } from "./html.js";

export type StepperControlOptions = {
    /** Form field name. */
    name: string;
    /** Accessible name of the field; the buttons are "Decrease <label>". */
    label: string;
    value: number;
    /** What a button press moves by; default 1. */
    step?: number;
    /**
     * `"any"` lets the field take any typed figure while the buttons move by
     * `step`. A numeric one is refused: the live script steps by the input's
     * own step, so a finer one would stop + from moving.
     */
    inputStep?: "any";
    min?: number;
    max?: number;
    unit?: string;
    /** The input's id; default from `name`. Pass one when two share a name. */
    id?: string;
    className?: string;
    /** The id of a form the figure belongs to, when it sits outside that form. */
    form?: string;
};

/** A plain finite number as text; the script counts decimals from it. */
function num(field: string, n: number): string {
    const text = String(n);
    if (!Number.isFinite(n) || /e/i.test(text)) {
        throw new Error(
            `stepperControl: ${field} must be a plain finite number, got ${text}`,
        );
    }
    return text;
}

const optional = (name: string, n: number | undefined) =>
    n == null ? "" : ` ${name}="${num(name, n)}"`;

export function stepperControl(opts: StepperControlOptions): Html {
    const buttonStep = num("step", opts.step ?? 1);
    if (!((opts.step ?? 1) > 0)) {
        throw new Error(
            `stepperControl: step must be above zero, got ${String(opts.step)}`,
        );
    }
    if (opts.inputStep != null && opts.inputStep !== "any") {
        throw new Error(
            `stepperControl: inputStep must be "any" or left out, got ${String(opts.inputStep)}`,
        );
    }
    const inputStep = opts.inputStep ?? buttonStep;
    const value = num("value", opts.value);
    const id = opts.id ?? `fd-stepper-control-${opts.name}`;
    const unitId = `${id}-unit`;
    const atMin = opts.min != null && opts.value <= opts.min;
    const atMax = opts.max != null && opts.value >= opts.max;
    const step = (dir: "down" | "up") =>
        button({
            round: true,
            size: "lg",
            icon: dir === "down" ? "minus" : "plus",
            label: `${dir === "down" ? "Decrease" : "Increase"} ${opts.label}`,
            disabled: dir === "down" ? atMin : atMax,
            attrs: {
                "data-fd-step": dir === "down" ? "-1" : "1",
                "aria-controls": id,
            },
        });
    const unit = opts.unit
        ? `<span class="fd-stepper-control__unit" id="${esc(unitId)}">${esc(opts.unit)}</span>`
        : "";
    const input = `<input class="fd-stepper-control__input" id="${esc(id)}" type="number" name="${esc(opts.name)}" value="${value}"${optional("min", opts.min)}${optional("max", opts.max)} step="${inputStep}" inputmode="decimal"${opts.form != null ? ` form="${esc(opts.form)}"` : ""} aria-label="${esc(opts.label)}"${opts.unit ? ` aria-describedby="${esc(unitId)}"` : ""}>`;
    const chars = Math.max(2, value.length);
    return raw(
        `<div class="${cls("fd-stepper-control", opts.className)}" data-fd-stepper${opts.inputStep != null ? ` data-fd-button-step="${buttonStep}"` : ""} style="--fd-chars:${chars}">${step("down")}<div class="fd-stepper-control__value">${input}${unit}</div>${step("up")}</div>`,
    );
}
