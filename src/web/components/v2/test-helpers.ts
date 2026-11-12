/** Hostile input every v2 test feeds to every string parameter. */
export const XSS = `"><script>alert(1)</script>`;
/** What `esc(XSS)` must produce. */
export const XSS_ESCAPED = "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;";

/** Widen `Html` to `string` so `toBe` / `toEqual` accept a plain literal. */
export const text = (html: string): string => html;

/**
 * Text that `String.prototype.replace` reads as a pattern when it is the
 * replacement *string* (`$\``, `$'`, `$&`, `$1`, `$$`), each followed by text a
 * browser would act on as attributes. A component that splices caller text
 * into markup with a string replacement lets the first three paste the
 * surrounding markup back in; every v2 test that feeds a name or an id through
 * such a path feeds these too.
 */
export const DOLLAR_PAYLOADS: readonly string[] = [
    "$` onfocus=alert(1) autofocus data-pwn=1 x",
    "$' onfocus=alert(1) autofocus data-pwn=1 x",
    "$& onfocus=alert(1) $1 $$ autofocus data-pwn=1 x",
];

/**
 * The attributes in `html` that only hostile text could have added: event
 * handlers and the `data-pwn` the payloads carry. (`autofocus` is not listed:
 * some pages set it themselves.) Found by parsing the markup the way a browser
 * does, so a quote that broke out of an attribute shows up as the attribute it
 * became.
 */
export async function injectedAttributes(html: string): Promise<string[]> {
    const injected: string[] = [];
    await new HTMLRewriter()
        .on("*", {
            element(el) {
                for (const [name] of el.attributes) {
                    if (/^on/.test(name) || name === "data-pwn") {
                        injected.push(`${el.tagName}[${name}]`);
                    }
                }
            },
        })
        .transform(new Response(html))
        .text();
    return injected;
}

/** `escapeHtml`'s four escapes undone, so a value reads as the text the user wrote. */
function unescapeHtml(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&amp;", "&");
}

/**
 * The `attr` of every element matching `selector` in `html`, as the text it
 * stands for. HTMLRewriter hands back the raw attribute text, escapes and all.
 */
export async function attributeValues(
    html: string,
    selector: string,
    attr: string,
): Promise<string[]> {
    const values: string[] = [];
    await new HTMLRewriter()
        .on(selector, {
            element(el) {
                const value = el.getAttribute(attr);
                if (value != null) values.push(unescapeHtml(value));
            },
        })
        .transform(new Response(html))
        .text();
    return values;
}

/** The `aria-label` of every `<button>` in `html`. */
export function buttonLabels(html: string): Promise<string[]> {
    return attributeValues(html, "button", "aria-label");
}
