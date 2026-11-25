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
import { icon, type IconName } from "./icon.js";
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
    /** The input's `aria-keyshortcuts` ("Control+K Meta+K"): the real shortcut the hint names. */
    keyShortcuts?: string;
    /**
     * Draws the Clear button. `"auto"` draws it for a page script to show and
     * hide with what is typed: out of sight while the field is empty.
     */
    clear?: boolean | "auto";
    /** Draws the Barcode button; with `href` it is a link. */
    barcode?: { label?: string; href?: string } | true;
    /** Draws the Filter button. */
    filter?: { label: string; count?: number };
    /**
     * A Filter menu (`menu()` with `anchor: "filter"`) drawn in the Filter
     * button's place, for a field whose filters are a pull-down.
     */
    filterMenu?: Html;
    /**
     * Draws the Go button (a submit button). `hidden` draws it out of sight for
     * a page script to show with the link-detected state; `attrs` are the
     * hooks that script finds it by.
     */
    go?:
        | {
              label?: string;
              hidden?: boolean;
              attrs?: Readonly<Record<string, string>>;
          }
        | true;
    /**
     * Draws both lead icons, the magnifier and the link, and lets the
     * `data-link-detected` attribute pick one, for a field whose script
     * detects a pasted link as it is typed.
     */
    leadSwap?: boolean;
    /** The link-detected state: link icon and Go. */
    linkDetected?: boolean;
    /** The lead icon when it is not the magnifier (the barcode's scan icon). */
    lead?: IconName;
    /** The keypad a phone raises (`numeric` for a barcode). */
    inputmode?: "numeric" | "decimal" | "text" | "search" | "url";
    /** The label of a phone keyboard's Enter key (`go` for a barcode). */
    enterkeyhint?: "go" | "search" | "done";
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
        opts.inputmode != null ? `inputmode="${opts.inputmode}"` : "",
        opts.enterkeyhint != null ? `enterkeyhint="${opts.enterkeyhint}"` : "",
        opts.keyShortcuts != null
            ? `aria-keyshortcuts="${esc(opts.keyShortcuts)}"`
            : "",
    ]
        .filter(Boolean)
        .join(" ");
    const goOpts = opts.go === true ? {} : opts.go;
    const go =
        opts.go || opts.linkDetected
            ? button({
                  variant: "go",
                  type: "submit",
                  label: goOpts?.label ?? "Search",
                  attrs: {
                      ...goOpts?.attrs,
                      ...(goOpts?.hidden ? { hidden: "" } : {}),
                  },
              })
            : "";
    const lead = opts.leadSwap
        ? `<span class="fd-search-field__lead fd-search-field__lead--swap"><span class="fd-search-field__lead-search">${icon("search")}</span><span class="fd-search-field__lead-link">${icon("link")}</span></span>`
        : `<span class="fd-search-field__lead">${icon(opts.linkDetected ? "link" : (opts.lead ?? "search"))}</span>`;
    const parts = [
        lead,
        `<input ${input}>`,
        opts.shortcut?.trim()
            ? keyboardHint({
                  keys: opts.shortcut,
                  className: "fd-search-field__shortcut",
              })
            : "",
        opts.clear
            ? `<button type="button" class="fd-search-field__action" data-fd-search-clear aria-label="Clear search"${opts.clear === "auto" && !opts.value ? " hidden" : ""}>${icon("close")}</button>`
            : "",
        opts.barcode ? barcodeAction(opts.barcode) : "",
        opts.filterMenu ??
            (opts.filter
                ? filterButton({
                      label: opts.filter.label,
                      count: opts.filter.count,
                  })
                : ""),
        go,
    ];
    return raw(
        `<div class="${cls("fd-search-field", `fd-search-field--${style}`, opts.className)}" role="search" aria-label="${esc(opts.label)}"${opts.linkDetected ? " data-link-detected" : ""}${dataAttrs(opts.data)}>${parts.join("")}</div>`,
    );
}
