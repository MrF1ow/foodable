/**
 * One value as its own form that saves itself: a number or a line of text
 * whose label sits beside it (the goal rows) or is hidden (the goal's name).
 * `client/v2/autosave.js` submits the form when the input is left with a new
 * value; without script Enter submits it, so nothing depends on the script.
 * The server answers 303 back to the page, or 4xx in place with the refusal,
 * which shows under the input (`aria-invalid`, described by it) while the
 * typed text stays.
 *
 * `fields` are hidden fields posted with the value (`field` names which goal).
 * Styles: `public/app/v2/item-row.css` (the row form) and `field.css`.
 */
import { cls, dataAttrs, esc, raw, type Html } from "./html.js";

export type AutosaveInputOptions = {
    /** The input's id; the error's id comes from it. */
    id: string;
    /** Where the form posts. */
    action: string;
    /** Hidden fields posted with the value. */
    fields?: Readonly<Record<string, string>>;
    /** The input's name; default `value`. */
    name?: string;
    value: string;
    /**
     * The visible label, or the input's accessible name with `labelHidden`
     * (a bare input: it fills its row, left-aligned, in the text colour).
     */
    label: string;
    labelHidden?: boolean;
    placeholder?: string;
    inputmode?: "decimal" | "text" | "numeric";
    maxlength?: number;
    /** A unit read after the value ("kcal"). */
    unit?: string;
    /** The refusal the server sent back; shown under the input. */
    error?: string;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function autosaveInput(opts: AutosaveInputOptions): Html {
    const hidden = Object.entries(opts.fields ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
    const label = opts.labelHidden
        ? `<span class="fd-visually-hidden">${esc(opts.label)}</span>`
        : `<span class="fd-autosave-input__label">${esc(opts.label)}</span>`;
    const input = [
        `class="fd-autosave-input__field"`,
        `id="${esc(opts.id)}"`,
        `name="${esc(opts.name ?? "value")}"`,
        `type="text"`,
        opts.inputmode != null ? `inputmode="${opts.inputmode}"` : "",
        `value="${esc(opts.value)}"`,
        opts.placeholder != null
            ? `placeholder="${esc(opts.placeholder)}"`
            : "",
        opts.maxlength != null ? `maxlength="${opts.maxlength}"` : "",
        `autocomplete="off"`,
        `data-fd-autosave-input`,
        opts.error
            ? `aria-invalid="true" aria-describedby="${esc(opts.id)}-error"`
            : "",
    ]
        .filter(Boolean)
        .join(" ");
    const unit = opts.unit
        ? `<span class="fd-autosave-input__unit">${esc(opts.unit)}</span>`
        : "";
    const error = opts.error
        ? `<p class="fd-autosave-input__error" id="${esc(opts.id)}-error" role="alert">${esc(opts.error)}</p>`
        : "";
    return raw(
        `<form class="${cls("fd-autosave-input", opts.labelHidden && "fd-autosave-input--bare", opts.className)}" method="post" action="${esc(opts.action)}" data-fd-autosave${dataAttrs(opts.data)}>${hidden}<label class="fd-autosave-input__control">${label}<span class="fd-autosave-input__entry"><input ${input}>${unit}</span></label>${error}</form>`,
    );
}
