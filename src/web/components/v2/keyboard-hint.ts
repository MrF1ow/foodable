/**
 * The design's Keyboard hint (FigCraft 590349): the small chip that names a
 * shortcut ("⌘K") at the end of a search field or a button. It is a hint for
 * sighted keyboard users; the control it sits on carries the real shortcut
 * (`aria-keyshortcuts`), so the chip is hidden from assistive tech unless a
 * `label` names it.
 *
 * Styles: `public/app/v2/layout.css`.
 */
import { cls, esc, raw, type Html } from "./html.js";

export type KeyboardHintOptions = {
    /** The keys as drawn, e.g. "⌘K". */
    keys: string;
    /** An accessible name ("Command K"); without one the chip is decorative. */
    label?: string;
    className?: string;
};

export function keyboardHint(opts: KeyboardHintOptions): Html {
    const keys = opts.keys.trim();
    if (keys === "") throw new Error("keyboardHint: needs keys");
    const classes = cls("fd-keyboard-hint", opts.className);
    // `aria-label` on a kbd (a generic element) is not reliably announced, so a
    // named hint carries its name as visually hidden text and hides the keys.
    if (opts.label != null) {
        return raw(
            `<kbd class="${classes}"><span class="fd-visually-hidden">${esc(opts.label)}</span><span aria-hidden="true">${esc(keys)}</span></kbd>`,
        );
    }
    return raw(`<kbd class="${classes}" aria-hidden="true">${esc(keys)}</kbd>`);
}
