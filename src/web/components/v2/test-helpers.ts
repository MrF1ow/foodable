/** Hostile input every v2 test feeds to every string parameter. */
export const XSS = `"><script>alert(1)</script>`;
/** What `esc(XSS)` must produce. */
export const XSS_ESCAPED = "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;";

/** Widen `Html` to `string` so `toBe` / `toEqual` accept a plain literal. */
export const text = (html: string): string => html;
