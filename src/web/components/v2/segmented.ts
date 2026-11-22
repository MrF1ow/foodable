/**
 * The design's Segment and Segmented (FigCraft 172304, 177891): a row of equal
 * segments in a raised track, the selected one filled with the primary text
 * colour. Two sizes: Regular (a 40 px track) and Small (32 px).
 *
 * Two forms of one radio group. With `name` it is native radios (each segment
 * a label around a visually hidden `<input type="radio">` and the drawn face),
 * so a form posts the chosen value and the arrow keys move the choice with no
 * script; `client/v2/segmented.js` only gives the `change` event a
 * `detail.value`. Without `name` (a control that belongs to no form) it is
 * `role="radio"` buttons, and the script moves the selection and the one tab
 * stop. A segment that is disabled is never drawn selected: a disabled radio
 * posts nothing. Styles: `public/app/v2/choice.css`.
 */
import { cls, dataAttrs, esc, raw, type Html } from "./html.js";

export type SegmentOptions = {
    label: string;
    value?: string;
    selected?: boolean;
    disabled?: boolean;
    /** Whether this segment is the group's tab stop; default the selected one. */
    tabStop?: boolean;
};

export function segment(opts: SegmentOptions): Html {
    const stop = opts.tabStop ?? opts.selected === true;
    return raw(
        `<button type="button" class="${cls("fd-segmented__segment", opts.selected && "fd-segmented__segment--selected")}" role="radio" aria-checked="${opts.selected ? "true" : "false"}" tabindex="${stop ? "0" : "-1"}"${opts.value != null ? ` data-value="${esc(opts.value)}"` : ""}${opts.disabled ? " disabled" : ""}>${esc(opts.label)}</button>`,
    );
}

export type SegmentedOptions = {
    /** Accessible name of the group ("Whose"). */
    label: string;
    segments: readonly SegmentOptions[];
    /** Default `regular`. */
    size?: "regular" | "small";
    /** Makes the group native radios of this name, so a form posts the value. */
    name?: string;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function segmented(opts: SegmentedOptions): Html {
    // The one selected segment: the first that is on and enabled.
    const selected = opts.segments.findIndex((s) => s.selected && !s.disabled);
    const stop =
        selected >= 0 ? selected : opts.segments.findIndex((s) => !s.disabled);
    const faces = opts.segments.map((s, i) => ({
        ...s,
        selected: i === selected,
    }));
    const name = opts.name;
    const inner =
        name != null
            ? faces
                  .map(
                      (s) =>
                          `<label class="fd-segmented__option"><input class="fd-segmented__input" type="radio" name="${esc(name)}" value="${esc(s.value ?? s.label)}"${s.selected ? " checked" : ""}${s.disabled ? " disabled" : ""}><span class="fd-segmented__segment">${esc(s.label)}</span></label>`,
                  )
                  .join("")
            : faces
                  .map((s, i) => segment({ ...s, tabStop: i === stop }))
                  .join("");
    return raw(
        `<div class="${cls("fd-segmented", `fd-segmented--${opts.size ?? "regular"}`, opts.className)}" role="radiogroup" aria-label="${esc(opts.label)}" data-fd-segmented${dataAttrs(opts.data)}>${inner}</div>`,
    );
}
