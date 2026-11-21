/**
 * The one button of the app, built to the design's `Button` component set
 * (Kind: Secondary, Primary, Danger, Link; Size: Large, Small), its round
 * `Icon button`, `Go button` and `Filter button`.
 *
 * Every rule in `public/app/v2/button.css` matches only this builder's output,
 * which carries `data-fd-btn`, so `.fd-btn` markup that pages write by hand
 * keeps the look its own stylesheet gives it.
 */
import { esc, join, raw, safeHref, type Html } from "./html.js";
import { icon, type IconName } from "./icon.js";

export type ButtonVariant = "secondary" | "primary" | "danger" | "go" | "link";
export type ButtonSize = "lg" | "md";

export type ButtonOptions = {
    /** Visible text; with `round` or `go` it is the accessible name instead. */
    label?: string;
    variant?: ButtonVariant;
    /**
     * `lg` is the Large button, `md` the Small one. Default `lg`, except a
     * round button, whose design is the 40 px Small tier.
     */
    size?: ButtonSize;
    /** Icon before the label. */
    icon?: IconName;
    /** A round, icon-only button (the design's Icon button). Needs `icon` and `label`. */
    round?: boolean;
    /** Render an `<a>` instead of a `<button>`. */
    href?: string;
    /** `<button type>`; default `button`. */
    type?: "button" | "submit";
    disabled?: boolean;
    /** Extra attributes (`name`, `value`, `form`, `data-*`, `aria-*`, `title`). */
    attrs?: Readonly<Record<string, string>>;
};

const ATTR_KEY = /^[a-z][a-z0-9-]*$/;
/** What the builder writes itself (the first copy of an attribute wins in HTML). */
const RESERVED_ATTRS = new Set([
    "class",
    "type",
    "href",
    "disabled",
    "aria-label",
    "aria-disabled",
    "tabindex",
    "style",
    "formaction",
    "data-fd-btn",
]);

function extraAttrs(attrs?: Readonly<Record<string, string>>): string {
    if (!attrs) return "";
    return Object.entries(attrs)
        .map(([key, value]) => {
            if (
                !ATTR_KEY.test(key) ||
                RESERVED_ATTRS.has(key) ||
                key.startsWith("on")
            ) {
                throw new Error(`button: attribute not allowed: ${key}`);
            }
            return ` ${key}="${esc(value)}"`;
        })
        .join("");
}

/** The go arrow, 14 x 12 at (9, 10) of the 32 box, stroke 2.2 (design `Go button`). */
const GO_ARROW = raw(
    `<svg class="fd-btn__arrow" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 16L23 16M17 10L23 16L17 22"/></svg>`,
);

/** The design's filter glyph: three bars of 16, 10 and 4, stroke 1.7. */
const FILTER_GLYPH = raw(
    `<svg class="fd-btn__glyph" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6L20 6M7 12L17 12M10 18L14 18"/></svg>`,
);

function element(
    classes: string,
    options: Pick<ButtonOptions, "href" | "type" | "disabled" | "attrs">,
    accessibleName: string | null,
    content: Html,
): Html {
    const aria =
        accessibleName == null ? "" : ` aria-label="${esc(accessibleName)}"`;
    const extra = extraAttrs(options.attrs);
    if (options.href != null) {
        const state = options.disabled
            ? ` aria-disabled="true" tabindex="-1"`
            : ` href="${safeHref(options.href)}"`;
        return raw(
            `<a class="${classes}" data-fd-btn${aria}${extra}${state}>${content}</a>`,
        );
    }
    const disabled = options.disabled ? " disabled" : "";
    return raw(
        `<button type="${options.type ?? "button"}" class="${classes}" data-fd-btn${aria}${extra}${disabled}>${content}</button>`,
    );
}

export function button(options: ButtonOptions): Html {
    const variant = options.variant ?? "secondary";
    const label = options.label;
    const iconOnly = options.round === true || variant === "go";
    if (iconOnly && label == null) {
        throw new Error(
            "button: an icon-only button needs a label (aria-label)",
        );
    }
    if (!iconOnly && label == null)
        throw new Error("button: label is required");
    if (options.round && !options.icon && variant !== "go") {
        throw new Error("button: a round button needs an icon");
    }

    const classes = [
        "fd-btn",
        variant !== "secondary" && `fd-btn--${variant}`,
        variant !== "go" &&
            (options.size ?? (options.round ? "md" : "lg")) === "md" &&
            "fd-btn--sm",
        options.round && variant !== "go" && "fd-btn--icon",
    ]
        .filter(Boolean)
        .join(" ");

    if (variant === "go")
        return element(classes, options, label ?? null, GO_ARROW);
    if (iconOnly) {
        return element(
            classes,
            options,
            label ?? null,
            icon(options.icon as IconName),
        );
    }
    return element(
        classes,
        options,
        null,
        join([
            options.icon && icon(options.icon),
            `<span class="fd-btn__label">${esc(label ?? "")}</span>`,
        ]),
    );
}

export type FilterButtonOptions = {
    /** Accessible name. */
    label: string;
    /** How many filters are on; the badge shows only a whole count above zero (a fraction is floored). */
    count?: number;
    disabled?: boolean;
    attrs?: Readonly<Record<string, string>>;
};

/** The design's Filter button: the bars glyph with a green count badge. */
export function filterButton(options: FilterButtonOptions): Html {
    const count = Math.floor(options.count ?? 0);
    const badge =
        Number.isFinite(count) && count > 0
            ? `<span class="fd-btn__badge">${esc(count)}</span>`
            : "";
    // The label becomes the accessible name, which hides the badge text, so
    // the count goes into the name too.
    const name = badge === "" ? options.label : `${options.label}, ${count} on`;
    return element(
        "fd-btn fd-btn--filter",
        options,
        name,
        join([FILTER_GLYPH, badge]),
    );
}
