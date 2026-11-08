/**
 * Shared plumbing for the v2 (`fd-`) components: the trusted-markup type, the
 * escaper re-export, and the attribute / form-button helpers every component
 * builds on.
 *
 * Every caller-supplied string passes through `esc` (text and double-quoted
 * attributes alike). Markup a caller must hand in (an icon, a prebuilt row) is
 * typed `Html`: the only ways to make one are `raw()` for a trusted constant
 * and the return value of another v2 helper, so a plain user string cannot
 * reach the output unescaped by accident. (`ui.ts` takes plain `string` for the
 * same slots and documents them "pre-escaped"; `Html` is the same contract,
 * checked by the compiler.)
 */
import { escapeHtml } from "../../../html.js";

/** Markup that is already safe to insert verbatim. Built by `raw()` or a v2 helper. */
export type Html = string & { readonly __fdHtml: true };

/** Mark a trusted markup constant (an SVG icon) as `Html`. Never pass user input. */
export function raw(markup: string): Html {
    return markup as Html;
}

/** Escape text for an element body or a double-quoted attribute. */
export function esc(value: string | number): string {
    return escapeHtml(String(value));
}

/** Join class names, dropping falsy parts. Names are escaped. */
export function cls(...parts: (string | false | null | undefined)[]): string {
    return parts
        .filter((p): p is string => typeof p === "string" && p !== "")
        .map(esc)
        .join(" ");
}

/** Concatenate `Html` fragments (falsy entries are skipped). */
export function join(
    parts: readonly (Html | string | false | null | undefined)[],
    separator = "",
): Html {
    return raw(
        parts
            .filter((p): p is string => typeof p === "string" && p !== "")
            .join(separator),
    );
}

const DATA_KEY = /^[a-z][a-z0-9-]*$/;

/**
 * ` data-<key>="<value>"` for each entry. Keys are code constants: one that is
 * not lowercase letters, digits and hyphens throws instead of escaping, since
 * a space in a key would add attributes.
 */
export function dataAttrs(data?: Readonly<Record<string, string>>): string {
    if (!data) return "";
    return Object.entries(data)
        .map(([key, value]) => {
            if (!DATA_KEY.test(key)) {
                throw new Error(`invalid data attribute key: ${key}`);
            }
            return ` data-${key}="${esc(value)}"`;
        })
        .join("");
}

/** A POST form wrapped around one button, so the action works with no JS. */
export type ActionForm = {
    action: string;
    /** Default `post`. */
    method?: "post" | "get";
    /** Hidden fields submitted with the button. */
    fields?: Readonly<Record<string, string>>;
};

export type ButtonSpec = {
    /** Accessible name when the content is an icon (also the visible text if no `content`). */
    label: string;
    /** Button content. Default: the escaped `label`. */
    content?: Html;
    className?: string;
    /** `name` / `value` submitted by the button itself. */
    name?: string;
    value?: string;
    data?: Readonly<Record<string, string>>;
    disabled?: boolean;
    /** With a form the button is `type="submit"` inside it; without, `type="button"`. */
    form?: ActionForm;
    /** Render `label` as `aria-label` (icon-only buttons). */
    iconOnly?: boolean;
    extraAttrs?: string;
};

function hiddenFields(fields?: Readonly<Record<string, string>>): string {
    if (!fields) return "";
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
}

/**
 * A `<button>`, wrapped in a `<form class="fd-inline-form">` when `form` is
 * given. The wrapper is `display: contents`, so layout sees only the button.
 */
export function actionButton(spec: ButtonSpec): Html {
    const label = esc(spec.label);
    const content = spec.content ?? raw(label);
    const attrs = [
        `type="${spec.form ? "submit" : "button"}"`,
        spec.className ? `class="${cls(spec.className)}"` : "",
        spec.iconOnly ? `aria-label="${label}"` : "",
        spec.name != null ? `name="${esc(spec.name)}"` : "",
        spec.value != null ? `value="${esc(spec.value)}"` : "",
        spec.disabled ? "disabled" : "",
    ]
        .filter(Boolean)
        .join(" ");
    const button = `<button ${attrs}${dataAttrs(spec.data)}${spec.extraAttrs ?? ""}>${content}</button>`;
    if (!spec.form) return raw(button);
    const method = spec.form.method ?? "post";
    return raw(
        `<form class="fd-inline-form" method="${method}" action="${esc(spec.form.action)}">${hiddenFields(spec.form.fields)}${button}</form>`,
    );
}

/**
 * An escaped href that can only point inside the app or at an http(s) page:
 * a path ("/…", not the protocol-relative "//…"), a query ("?…"), a fragment
 * ("#…") or an absolute http/https URL. Anything else (`javascript:`, `data:`)
 * throws, so a URL built from data (an OFF product link) can never run script.
 */
export function safeHref(href: string): string {
    const ok =
        (href.startsWith("/") && !href.startsWith("//")) ||
        href.startsWith("?") ||
        href.startsWith("#") ||
        /^https?:\/\//i.test(href);
    if (!ok)
        throw new Error(`v2 components: unsafe href ${JSON.stringify(href)}`);
    return esc(href);
}

/** Visually-hidden text for screen readers. */
export function srOnly(text: string): string {
    return `<span class="fd-sr">${esc(text)}</span>`;
}
