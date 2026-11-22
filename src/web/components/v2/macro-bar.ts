/**
 * The design's Macro bar (FigCraft 382028, Kind: protein, carbs, fat): the
 * macro's dot and name, the figure over its target ("96 / 210 g"), and a 4 px
 * bar filled to the share of the target.
 *
 * The bar is a named meter with its range when both numbers are known. An
 * unknown (null, negative or non-finite) figure is a dash and an empty bar,
 * never a zero; over the target the
 * fill stops at the full bar and the figure says the rest.
 *
 * Styles: `public/app/v2/nutrition-display.css`.
 */
import { valueText } from "./card.js";
import { dot, type DotColor } from "./dot.js";
import { cls, esc, raw, type Html } from "./html.js";

export type MacroBarKind = "protein" | "carbs" | "fat";

const KINDS: Record<MacroBarKind, { dot: DotColor; label: string }> = {
    protein: { dot: "protein", label: "Protein" },
    carbs: { dot: "carbs", label: "Carbs" },
    fat: { dot: "fat", label: "Fat" },
};

export type MacroBarOptions = {
    kind: MacroBarKind;
    /** What was eaten; null is unknown. */
    value: number | null;
    /** The goal; null, or one that rounds below 1, means there is none. */
    target: number | null;
    /** Default `g`. */
    unit?: string;
    /** Default from the kind. */
    label?: string;
    className?: string;
};

const whole = (n: number) => String(Math.round(n));

export function macroBar(opts: MacroBarOptions): Html {
    const kind = KINDS[opts.kind];
    const name = opts.label ?? kind.label;
    const unit = opts.unit ?? "g";
    // A negative or non-finite figure is unknown, as in the calorie gauge; a
    // target that rounds below 1 would print "/ 0" and is no target at all.
    const hasValue =
        opts.value != null && Number.isFinite(opts.value) && opts.value >= 0;
    const hasTarget =
        opts.target != null &&
        Number.isFinite(opts.target) &&
        Math.round(opts.target) >= 1;
    const fill =
        hasValue && hasTarget
            ? Math.min(100, Math.max(0, (opts.value! / opts.target!) * 100))
            : 0;
    const fillText = `${Math.round(fill * 10) / 10}%`;
    const target = hasTarget
        ? `<span class="fd-macro-bar__target">/ ${esc(whole(opts.target!))} ${esc(unit)}</span>`
        : "";
    const meter =
        hasValue && hasTarget
            ? ` role="meter" aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="${whole(opts.target!)}" aria-valuenow="${whole(Math.min(opts.target!, opts.value!))}" aria-valuetext="${esc(`${whole(opts.value!)} of ${whole(opts.target!)} ${unit}`)}"`
            : "";
    return raw(
        `<div class="${cls("fd-macro-bar", `fd-macro-bar--${opts.kind}`, opts.className)}"><div class="fd-macro-bar__head">${dot(kind.dot, { size: "sm" })}<span class="fd-macro-bar__name">${esc(name)}</span></div><div class="fd-macro-bar__figures"><span class="fd-macro-bar__value">${valueText(hasValue ? whole(opts.value!) : null)}</span>${target}</div><div class="fd-macro-bar__track"${meter}><div class="fd-macro-bar__fill" style="--fd-fill:${fillText}"></div></div></div>`,
    );
}
