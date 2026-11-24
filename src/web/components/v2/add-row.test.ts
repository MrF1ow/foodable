import { expect, test } from "bun:test";
import { addRow } from "./add-row.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

test("an add row is a closed details: a plus and a label, then a field and Add", () => {
    const html = addRow({
        label: "Add a store",
        action: "/stores/add",
        name: "name",
        fieldLabel: "Store name",
        maxlength: 80,
        id: "add-store",
    });
    expect(html).toStartWith(
        `<li class="fd-item-row fd-add-row" id="add-store">`,
    );
    expect(html).toContain(
        `<details class="fd-add-row__details" data-fd-add-row>`,
    );
    expect(html).toContain(
        `<summary class="fd-item-row__face fd-add-row__summary">`,
    );
    expect(html).toContain(`fd-icon--plus`);
    expect(html).toContain(
        `<span class="fd-item-row__title">Add a store</span>`,
    );
    expect(html).toContain(`method="post" action="/stores/add"`);
    // The field is field(): its label is hidden but names the input.
    expect(html).toContain(`<div class="fd-field fd-add-row__field">`);
    expect(html).toContain(
        `<span class="fd-visually-hidden">Store name</span>`,
    );
    expect(html).toContain(
        `class="fd-field__input" id="add-store-field" name="name" type="text" autocomplete="off" maxlength="80" required>`,
    );
    expect(html).not.toContain("aria-invalid");
    expect(html).toMatch(
        /type="submit"[^>]*><span class="fd-btn__label">Add<\/span><\/button>/,
    );
    expect(html).not.toMatch(/<details[^>]* open/);
});

test("open renders it open, and hidden fields ride the form", () => {
    const html = addRow({
        label: "Add a rule",
        action: "/r",
        name: "body",
        fieldLabel: "Rule",
        open: true,
        fields: { store: "s1" },
        id: "row-1",
    });
    expect(html).toContain(
        `<details class="fd-add-row__details" data-fd-add-row open>`,
    );
    expect(html).toContain(`<input type="hidden" name="store" value="s1">`);
    expect(html).toContain(`id="row-1"`);
});

test("a refused field is aria-invalid, with its error tied to it", () => {
    const html = addRow({
        label: "Add a store",
        action: "/a",
        name: "name",
        fieldLabel: "Store name",
        id: "add-store",
        open: true,
        error: "That store already exists.",
    });
    expect(html).toContain(`aria-invalid="true"`);
    expect(html).toContain(`aria-describedby="add-store-field-error"`);
    expect(html).toContain(
        `<span class="fd-field__error" id="add-store-field-error">That store already exists.</span>`,
    );
});

test("an add row escapes what it prints", () => {
    const html = addRow({
        id: "a",
        label: XSS,
        action: "/a",
        name: "n",
        fieldLabel: XSS,
    });
    expect(html).not.toContain(XSS);
    expect(html).toContain(XSS_ESCAPED);
});
