/**
 * The design's Quick action (FigCraft 303014): a 48 px icon box over a caption,
 * as in the Today shortcuts. A link with a `href`, else a button. With the
 * caption off the label stays as the accessible name.
 *
 * Styles: `public/app/v2/quick-action.css`.
 */
import { icon, type IconName } from "./icon.js";
import { cls, esc, raw, safeHref, type Html } from "./html.js";

export type QuickActionOptions = {
    label: string;
    icon: IconName;
    href?: string;
    /** Show caption; default on. */
    caption?: boolean;
    disabled?: boolean;
    className?: string;
};

export function quickAction(opts: QuickActionOptions): Html {
    const showCaption = opts.caption !== false;
    const classes = cls("fd-quick-action", opts.className);
    const name = showCaption ? "" : ` aria-label="${esc(opts.label)}"`;
    const inner = `<span class="fd-quick-action__box">${icon(opts.icon, 20)}</span>${showCaption ? `<span class="fd-quick-action__caption">${esc(opts.label)}</span>` : ""}`;
    if (opts.href != null) {
        const state = opts.disabled
            ? ` aria-disabled="true" tabindex="-1"`
            : ` href="${safeHref(opts.href)}"`;
        if (opts.disabled) safeHref(opts.href);
        return raw(`<a class="${classes}"${name}${state}>${inner}</a>`);
    }
    return raw(
        `<button type="button" class="${classes}"${name}${opts.disabled ? " disabled" : ""}>${inner}</button>`,
    );
}
