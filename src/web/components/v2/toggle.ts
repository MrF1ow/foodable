/**
 * The design's Toggle (FigCraft 172376): a 46 x 28 switch, On or Off. A real
 * switch: a checkbox with `role="switch"`, so it announces its state, takes
 * Space, submits with a form (`name`, `value`) and needs no script. The track
 * and knob are drawn from `:checked`. Disabled is greyed, not removed.
 *
 * Styles: `public/app/v2/toggle.css`.
 */
import { cls, dataAttrs, esc, raw, type Html } from "./html.js";

export type ToggleOptions = {
    /** Accessible name ("Weekly digest"). */
    label: string;
    /** On. */
    on?: boolean;
    disabled?: boolean;
    name?: string;
    /** Submitted when on; default `on`. */
    value?: string;
    id?: string;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function toggle(opts: ToggleOptions): Html {
    const input = [
        `class="fd-toggle__input"`,
        `type="checkbox"`,
        `role="switch"`,
        `aria-label="${esc(opts.label)}"`,
        opts.id != null ? `id="${esc(opts.id)}"` : "",
        opts.name != null
            ? `name="${esc(opts.name)}" value="${esc(opts.value ?? "on")}"`
            : "",
        opts.on ? "checked" : "",
        opts.disabled ? "disabled" : "",
    ]
        .filter(Boolean)
        .join(" ");
    return raw(
        `<label class="${cls("fd-toggle", opts.disabled && "fd-toggle--disabled", opts.className)}"${dataAttrs(opts.data)}><input ${input}><span class="fd-toggle__track" aria-hidden="true"><span class="fd-toggle__knob"></span></span></label>`,
    );
}
