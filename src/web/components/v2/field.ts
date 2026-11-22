/**
 * The design's Field (FigCraft 172366): a 48 px text box with a trailing icon.
 * Around the box this builder adds a label above and a hint or an error below;
 * the design draws only the box.
 *
 * A `<label>` wraps the label text and the box, so the text names the input with
 * no `for`/`id` pairing to keep in step. The hint or error sits outside it, in
 * the field's `<div>`: inside the label it would join the input's name. Classes
 * are `fd-field*`; `field()` in `components/ui.ts` is the older builder (class
 * `field`) and stays until the pages move. An error marks the input
 * `aria-invalid` and is what the input is described by, in place of the hint.
 * Styles: `public/app/v2/field.css`.
 */
import { cls, dataAttrs, esc, raw, type Html } from "./html.js";
import { icon, type IconName } from "./icon.js";

export type FieldOptions = {
    /** The input's id; the hint's and the error's ids come from it. */
    id: string;
    label: string;
    name: string;
    type?: "text" | "email" | "password" | "search" | "number" | "tel" | "url";
    value?: string;
    placeholder?: string;
    autocomplete?: string;
    required?: boolean;
    disabled?: boolean;
    /** A decorative icon at the end of the box (the eye of a password). */
    trailingIcon?: IconName;
    hint?: string;
    error?: string;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function field(opts: FieldOptions): Html {
    const describedBy = opts.error
        ? `${opts.id}-error`
        : opts.hint
          ? `${opts.id}-hint`
          : null;
    const input = [
        `class="fd-field__input"`,
        `id="${esc(opts.id)}"`,
        `name="${esc(opts.name)}"`,
        `type="${opts.type ?? "text"}"`,
        opts.value != null ? `value="${esc(opts.value)}"` : "",
        opts.placeholder != null
            ? `placeholder="${esc(opts.placeholder)}"`
            : "",
        opts.autocomplete != null
            ? `autocomplete="${esc(opts.autocomplete)}"`
            : "",
        opts.required ? "required" : "",
        opts.disabled ? "disabled" : "",
        opts.error ? `aria-invalid="true"` : "",
        describedBy != null ? `aria-describedby="${esc(describedBy)}"` : "",
    ]
        .filter(Boolean)
        .join(" ");
    const trailing = opts.trailingIcon
        ? `<span class="fd-field__icon" aria-hidden="true">${icon(opts.trailingIcon, 20)}</span>`
        : "";
    const note = opts.error
        ? `<span class="fd-field__error" id="${esc(opts.id)}-error">${esc(opts.error)}</span>`
        : opts.hint
          ? `<span class="fd-field__hint" id="${esc(opts.id)}-hint">${esc(opts.hint)}</span>`
          : "";
    return raw(
        `<div class="${cls("fd-field", opts.error && "fd-field--invalid", opts.className)}"${dataAttrs(opts.data)}><label class="fd-field__control"><span class="fd-field__label">${esc(opts.label)}</span><span class="fd-field__box"><input ${input}>${trailing}</span></label>${note}</div>`,
    );
}
