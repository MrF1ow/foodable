import { expect, test } from "bun:test";
import { keyboardHint } from "./keyboard-hint.js";
import { injectedAttributes, text, XSS, XSS_ESCAPED } from "./test-helpers.js";

test("a hint is a kbd with the keys, hidden from assistive tech by default", () => {
    expect(text(keyboardHint({ keys: "⌘K" }))).toBe(
        '<kbd class="fd-keyboard-hint" aria-hidden="true">⌘K</kbd>',
    );
});

test("a label makes it readable: the name is visually hidden text and the drawn keys are hidden", () => {
    const html = keyboardHint({ keys: "⌘K", label: "Command K" });
    expect(text(html)).toBe(
        '<kbd class="fd-keyboard-hint"><span class="fd-visually-hidden">Command K</span><span aria-hidden="true">⌘K</span></kbd>',
    );
    expect(html).not.toContain("aria-label");
});

test("the keys, label and class are escaped", async () => {
    const html = keyboardHint({ keys: XSS, label: XSS, className: XSS });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
});

test("no keys is a mistake, not an empty chip", () => {
    expect(() => keyboardHint({ keys: "  " })).toThrow();
});
