import { expect, test } from "bun:test";
import { toggle } from "./toggle.js";
import { injectedAttributes, XSS } from "./test-helpers.js";

test("an Off toggle is an unchecked switch with its name", () => {
    const html = toggle({ label: "Weekly digest" });
    expect(html).toStartWith('<label class="fd-toggle">');
    expect(html).toContain(
        '<input class="fd-toggle__input" type="checkbox" role="switch" aria-label="Weekly digest"',
    );
    expect(html).not.toContain("checked");
    expect(html).toContain(
        '<span class="fd-toggle__track" aria-hidden="true"><span class="fd-toggle__knob"></span></span>',
    );
});

test("an On toggle is checked", () => {
    expect(toggle({ label: "x", on: true })).toContain(" checked");
});

test("a disabled toggle is disabled and drawn so", () => {
    const html = toggle({ label: "x", disabled: true });
    expect(html).toContain("fd-toggle fd-toggle--disabled");
    expect(html).toContain(" disabled");
});

test("name and value make it submit with a form; the value defaults to on", () => {
    expect(toggle({ label: "x", name: "digest" })).toContain(
        'name="digest" value="on"',
    );
    expect(toggle({ label: "x", name: "digest", value: "1" })).toContain(
        'value="1"',
    );
});

test("every string is escaped", async () => {
    const html = toggle({
        label: XSS,
        name: XSS,
        value: XSS,
        id: XSS,
        className: XSS,
        data: { k: XSS },
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
});
