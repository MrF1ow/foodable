import { expect, test } from "bun:test";
import {
    actionButton,
    cls,
    dataAttrs,
    esc,
    join,
    raw,
    srOnly,
} from "./html.js";
import { dot, DOT_COLORS } from "./dot.js";
import { XSS, XSS_ESCAPED, text } from "./test-helpers.js";

test("esc escapes markup and double quotes, and stringifies numbers", () => {
    expect(esc(XSS)).toBe(XSS_ESCAPED);
    expect(esc(`a & b`)).toBe("a &amp; b");
    expect(esc(42)).toBe("42");
});

test("cls drops falsy parts and escapes names", () => {
    expect(cls("a", false, undefined, null, "", "b")).toBe("a b");
    expect(cls(`x" onclick="y`)).toBe("x&quot; onclick=&quot;y");
});

test("join concatenates and skips empties", () => {
    expect(text(join([raw("<a>"), "", false, null, raw("</a>")]))).toBe(
        "<a></a>",
    );
    expect(text(join(["a", "b"], "-"))).toBe("a-b");
});

test("dataAttrs escapes values and rejects keys that could add attributes", () => {
    expect(dataAttrs({ "fd-step": XSS })).toBe(
        ` data-fd-step="${XSS_ESCAPED}"`,
    );
    expect(dataAttrs(undefined)).toBe("");
    expect(() => dataAttrs({ 'x onclick="y"': "1" })).toThrow();
    expect(() => dataAttrs({ Upper: "1" })).toThrow();
});

test("srOnly is the visually hidden span, escaped", () => {
    expect(srOnly("down 1.2")).toBe(`<span class="fd-sr">down 1.2</span>`);
    expect(srOnly(XSS)).not.toContain("<script");
});

test("actionButton without a form is type=button", () => {
    const html = actionButton({
        label: "Add",
        className: "fd-icon-btn",
        data: { id: "7" },
    });
    expect(text(html)).toBe(
        `<button type="button" class="fd-icon-btn" data-id="7">Add</button>`,
    );
});

test("actionButton with a form wraps a submit button and hidden fields, escaped", () => {
    const html = actionButton({
        label: XSS,
        iconOnly: true,
        content: raw("<svg></svg>"),
        name: "n",
        value: XSS,
        form: { action: `/x?${XSS}`, fields: { [XSS]: XSS } },
    });
    expect(html).toContain(`<form class="fd-inline-form" method="post"`);
    expect(html).toContain(`type="submit"`);
    expect(html).toContain(`aria-label="${XSS_ESCAPED}"`);
    expect(html).toContain(`action="/x?${XSS_ESCAPED}"`);
    expect(html).toContain(
        `<input type="hidden" name="${XSS_ESCAPED}" value="${XSS_ESCAPED}">`,
    );
    expect(html).toContain(`value="${XSS_ESCAPED}"`);
    expect(html).not.toContain("<script");
});

test("dot takes only the fixed palette", () => {
    for (const color of DOT_COLORS) {
        expect(dot(color)).toContain(`fd-dot--${color}`);
    }
    expect(dot("protein", { size: "sm" })).toContain("fd-dot--sm");
    expect(dot("protein")).toContain(`aria-hidden="true"`);
    expect(dot("over", { label: "Poor" })).toContain(
        `role="img" aria-label="Poor"`,
    );
    expect(() => dot(`red" onclick="x` as never)).toThrow();
});
