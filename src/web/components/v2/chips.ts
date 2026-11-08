/**
 * Chips (FigCraft `#20313` filter chips, `#21929` / `#21932` store chips,
 * `#20591` unit chips, meal chips in `#20400`): a pill with a label and an
 * optional count. Selected = filled with `--text-primary`; unselected = an
 * outlined pill.
 *
 * Two shapes:
 * - `chipLink` + `chipNav`: filters that navigate (`<a aria-current="true">`
 *   when selected). The state lives in the URL.
 * - `choiceGroup`: a choice inside a form. Real radio inputs (visually hidden,
 *   still focusable and arrow-key navigable), so it submits with no JS.
 */
import { cls, esc, raw, safeHref, type Html } from "./html.js";

export type ChipLabel = string | number;

/** A filter / store chip that is a link. `selected` sets `aria-current="true"`. */
export function chipLink(opts: {
    label: ChipLabel;
    href: string;
    count?: ChipLabel;
    selected?: boolean;
    className?: string;
}): Html {
    const count =
        opts.count != null && opts.count !== ""
            ? `<span class="fd-chip__count">${esc(opts.count)}</span>`
            : "";
    return raw(
        `<a class="${cls("fd-chip", opts.selected && "fd-chip--selected", opts.className)}" href="${safeHref(opts.href)}"${opts.selected ? ' aria-current="true"' : ""}><span class="fd-chip__label">${esc(opts.label)}</span>${count}</a>`,
    );
}

/**
 * A row of chip links in a `<nav>` named `label` ("Filter foods"). Chips wrap
 * with a 6px gap.
 */
export function chipNav(
    chips: readonly Html[],
    opts: { label: string; className?: string },
): Html {
    return raw(
        `<nav class="${cls("fd-chips", opts.className)}" aria-label="${esc(opts.label)}">${chips.join("")}</nav>`,
    );
}

export type ChoiceOption = {
    value: string;
    label: ChipLabel;
    count?: ChipLabel;
    selected?: boolean;
    disabled?: boolean;
};

/**
 * Chip radios in a `<fieldset class="fd-choice-group">` named by its `<legend>`
 * (`legend`). The legend is visually hidden unless `showLegend` (the "ADD TO"
 * label above the meal chips). Each chip is
 * `<label class="fd-chip fd-chip--choice"><input type="radio" class="fd-chip__input">…</label>`;
 * `:checked` drives the selected look and `:focus-visible` the ring. The same
 * `name` must not be reused by another group in the form.
 */
export function choiceGroup(opts: {
    name: string;
    legend: string;
    options: readonly ChoiceOption[];
    required?: boolean;
    showLegend?: boolean;
    className?: string;
}): Html {
    const chips = opts.options
        .map((option) => {
            const count =
                option.count != null && option.count !== ""
                    ? `<span class="fd-chip__count">${esc(option.count)}</span>`
                    : "";
            return `<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="${esc(opts.name)}" value="${esc(option.value)}"${option.selected ? " checked" : ""}${option.disabled ? " disabled" : ""}${opts.required ? " required" : ""}><span class="fd-chip__face"><span class="fd-chip__label">${esc(option.label)}</span>${count}</span></label>`;
        })
        .join("");
    const legend = opts.showLegend
        ? `<legend class="fd-choice-group__legend">${esc(opts.legend)}</legend>`
        : `<legend class="fd-sr">${esc(opts.legend)}</legend>`;
    return raw(
        `<fieldset class="${cls("fd-choice-group", opts.className)}">${legend}<div class="fd-chips">${chips}</div></fieldset>`,
    );
}
