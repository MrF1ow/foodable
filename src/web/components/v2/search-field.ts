/**
 * The design's Search field (FigCraft 172259), in its two styles: Boxed (a
 * raised box) and Line (a hairline under it). Parts, in the design's order: the
 * lead icon, the input, a shortcut hint, Clear, Barcode, Filter (with a count)
 * and Go.
 *
 * Link detected is a state a caller asks for with `linkDetected`: the lead
 * becomes the link icon and the Go button shows. Nothing here looks at what was
 * typed; the detection comes with universal search. Clear carries
 * `data-fd-search-clear` for that page script to wire.
 *
 * Styles: `public/app/v2/search-field.css`. Wrap it in a `<form>` to submit.
 */
import { button, filterButton } from "./button.js";
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";
import { icon } from "./icon.js";
import { keyboardHint } from "./keyboard-hint.js";

export type SearchFieldOptions = {
    /** Accessible name of the input. */
    label: string;
    style?: "boxed" | "line";
    /** Default `q`. */
    name?: string;
    id?: string;
    value?: string;
    placeholder?: string;
    /** The shortcut hint chip ("⌘K"), desktop only by the caller's choice. */
    shortcut?: string;
    /** Draws the Clear button. */
    clear?: boolean;
    /** Draws the Barcode button; with `href` it is a link. */
    barcode?: { label?: string; href?: string } | true;
    /** Draws the Filter button. */
    filter?: { label: string; count?: number };
    /** Draws the Go button (a submit button). */
    go?: { label?: string } | true;
    /** The link-detected state: link icon and Go. */
    linkDetected?: boolean;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

function barcodeAction(
    option: Exclude<SearchFieldOptions["barcode"], undefined>,
): string {
    const detail = option === true ? {} : option;
    const label = esc(detail.label ?? "Scan a barcode");
    const inner = icon("scan");
    return detail.href != null
        ? `<a class="fd-search-field__action" href="${safeHref(detail.href)}" aria-label="${label}">${inner}</a>`
        : `<button type="button" class="fd-search-field__action" aria-label="${label}">${inner}</button>`;
}

export function searchField(opts: SearchFieldOptions): Html {
    const style = opts.style ?? "boxed";
    const input = [
        `class="fd-search-field__input"`,
        `type="search"`,
        `name="${esc(opts.name ?? "q")}"`,
        opts.id != null ? `id="${esc(opts.id)}"` : "",
        `aria-label="${esc(opts.label)}"`,
        opts.placeholder != null
            ? `placeholder="${esc(opts.placeholder)}"`
            : "",
        opts.value != null ? `value="${esc(opts.value)}"` : "",
        `autocomplete="off"`,
    ]
        .filter(Boolean)
        .join(" ");
    const go =
        opts.go || opts.linkDetected
            ? button({
                  variant: "go",
                  type: "submit",
                  label:
                      (opts.go === true ? undefined : opts.go?.label) ??
                      "Search",
              })
            : "";
    const parts = [
        `<span class="fd-search-field__lead">${icon(opts.linkDetected ? "link" : "search")}</span>`,
        `<input ${input}>`,
        opts.shortcut?.trim()
            ? keyboardHint({
                  keys: opts.shortcut,
                  className: "fd-search-field__shortcut",
              })
            : "",
        opts.clear
            ? `<button type="button" class="fd-search-field__action" data-fd-search-clear aria-label="Clear search">${icon("close")}</button>`
            : "",
        opts.barcode ? barcodeAction(opts.barcode) : "",
        opts.filter
            ? filterButton({
                  label: opts.filter.label,
                  count: opts.filter.count,
              })
            : "",
        go,
    ];
    return raw(
        `<div class="${cls("fd-search-field", `fd-search-field--${style}`, opts.className)}" role="search" aria-label="${esc(opts.label)}"${opts.linkDetected ? " data-link-detected" : ""}${dataAttrs(opts.data)}>${parts.join("")}</div>`,
    );
}
