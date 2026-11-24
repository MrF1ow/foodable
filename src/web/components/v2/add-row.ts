/**
 * The design's add row ("+ Add a store", "+ Add a section", "+ Add a rule"):
 * a row with a plus and a label that opens, in place, a field with an Add
 * button. It is a `<details>`, so it opens and posts with no script; the page
 * script (`client/v2/stores.js`) only puts focus in the field when it opens.
 * `open` renders it open, for a page that comes back with the form's error,
 * which then sits under the field it refused (`field()`, its label hidden).
 *
 * The result is an `<li>` for `listGroup()`. Styles: `public/app/v2/item-row.css`.
 */
import { button } from "./button.js";
import { field } from "./field.js";
import { cls, esc, raw, type Html } from "./html.js";
import { icon } from "./icon.js";

export type AddRowOptions = {
    /** The row's words ("Add a store"). */
    label: string;
    /** Where the form posts. */
    action: string;
    /** The field's name. */
    name: string;
    /** Accessible name of the field. */
    fieldLabel: string;
    maxlength?: number;
    open?: boolean;
    /** The refusal the server sent back; shown under the field. */
    error?: string;
    /** Hidden fields posted with the form. */
    fields?: Readonly<Record<string, string>>;
    /** The row's id; the field's id comes from it, so it is unique on the page. */
    id: string;
    className?: string;
};

export function addRow(opts: AddRowOptions): Html {
    const hidden = Object.entries(opts.fields ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
    const input = field({
        id: `${opts.id}-field`,
        label: opts.fieldLabel,
        labelHidden: true,
        name: opts.name,
        maxlength: opts.maxlength,
        required: true,
        autocomplete: "off",
        error: opts.error,
        className: "fd-add-row__field",
    });
    return raw(
        `<li class="${cls("fd-item-row fd-add-row", opts.className)}" id="${esc(opts.id)}"><details class="fd-add-row__details" data-fd-add-row${opts.open ? " open" : ""}><summary class="fd-item-row__face fd-add-row__summary"><span class="fd-item-row__lead fd-item-row__icon">${icon("plus")}</span><span class="fd-item-row__main"><span class="fd-item-row__line"><span class="fd-item-row__title">${esc(opts.label)}</span></span></span></summary><form class="fd-add-row__form" method="post" action="${esc(opts.action)}">${hidden}${input}${button({ label: "Add", variant: "primary", size: "md", type: "submit" })}</form></details></li>`,
    );
}
