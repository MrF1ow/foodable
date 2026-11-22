import { expect, test } from "bun:test";
import { button, filterButton } from "./button.js";
import { icon } from "./icon.js";
import { XSS, XSS_ESCAPED, text } from "./test-helpers.js";

test("a plain button is a secondary large button the stylesheet can find", () => {
    expect(text(button({ label: "Cancel" }))).toBe(
        `<button type="button" class="fd-btn" data-fd-btn><span class="fd-btn__label">Cancel</span></button>`,
    );
});

test("each variant adds exactly its own modifier", () => {
    const classOf = (variant: Parameters<typeof button>[0]["variant"]) =>
        /class="([^"]*)"/.exec(
            button({ label: "Go", variant, icon: "plus", round: true }),
        )?.[1];
    expect(classOf("secondary")).toBe("fd-btn fd-btn--sm fd-btn--icon");
    expect(classOf("primary")).toBe(
        "fd-btn fd-btn--primary fd-btn--sm fd-btn--icon",
    );
    expect(classOf("danger")).toBe(
        "fd-btn fd-btn--danger fd-btn--sm fd-btn--icon",
    );
    expect(classOf("link")).toBe("fd-btn fd-btn--link fd-btn--sm fd-btn--icon");
});

test("Small is the --sm modifier and Large adds nothing", () => {
    expect(button({ label: "Save", size: "md" })).toContain(
        `class="fd-btn fd-btn--sm"`,
    );
    expect(button({ label: "Save", size: "lg" })).toContain(`class="fd-btn"`);
    expect(button({ label: "Save", variant: "primary", size: "md" })).toContain(
        `class="fd-btn fd-btn--primary fd-btn--sm"`,
    );
});

test("an icon sits before the label at the tier's icon size and is decorative", () => {
    const html = button({ label: "Add", icon: "plus", variant: "primary" });
    expect(html).toContain(`<svg class="fd-icon fd-icon--plus"`);
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("fd-btn__label"));
    // The tier sets the icon size in CSS; the svg itself stays at the default.
    expect(html).toContain(`width="24" height="24"`);
    expect(html).not.toContain("aria-label");
});

test("a round button is icon only and names itself with aria-label", () => {
    const html = button({ label: "More", icon: "more", round: true });
    expect(text(html)).toBe(
        `<button type="button" class="fd-btn fd-btn--sm fd-btn--icon" data-fd-btn aria-label="More">${icon("more")}</button>`,
    );
    expect(html).not.toContain("fd-btn__label");
});

test("a round button is the design's 40 px Icon button unless a size is asked for", () => {
    const sizeOf = (size?: "lg" | "md") =>
        button({ label: "More", icon: "more", round: true, size });
    expect(sizeOf()).toContain("fd-btn--sm");
    expect(sizeOf("md")).toContain("fd-btn--sm");
    expect(sizeOf("lg")).not.toContain("fd-btn--sm");
    // A text button still defaults to Large.
    expect(button({ label: "Save" })).not.toContain("fd-btn--sm");
});

test("an icon-only button needs an icon and a label", () => {
    expect(() => button({ label: "More", round: true })).toThrow(/icon/);
    expect(() => button({ icon: "more", round: true })).toThrow(/label/);
    expect(() => button({})).toThrow(/label/);
});

test("the go button is a round arrow named by its label", () => {
    const html = button({ label: "Search", variant: "go" });
    expect(html).toStartWith(
        `<button type="button" class="fd-btn fd-btn--go" data-fd-btn aria-label="Search"><svg`,
    );
    expect(html).toContain(`d="M9 16L23 16M17 10L23 16L17 22"`);
    expect(html).toContain(`aria-hidden="true"`);
    expect(() => button({ variant: "go" })).toThrow(/label/);
});

test("a link renders an anchor with a safe href and the same markup contract", () => {
    const html = button({
        label: "Open",
        variant: "primary",
        href: "/kitchen?tab=fridge&x=1",
    });
    expect(text(html)).toBe(
        `<a class="fd-btn fd-btn--primary" data-fd-btn href="/kitchen?tab=fridge&amp;x=1"><span class="fd-btn__label">Open</span></a>`,
    );
    expect(() => button({ label: "x", href: "javascript:alert(1)" })).toThrow(
        /unsafe href/,
    );
});

test("a disabled button has the attribute; a disabled link loses its href", () => {
    expect(button({ label: "Save", disabled: true })).toContain(
        `data-fd-btn disabled>`,
    );
    const link = button({ label: "Save", href: "/x", disabled: true });
    expect(link).not.toContain("href=");
    expect(link).toContain(`aria-disabled="true" tabindex="-1"`);
});

test("a disabled link has role=link, or aria-disabled is ignored and AT reads plain text", () => {
    const link = button({ label: "Save", href: "/x", disabled: true });
    expect(link).toContain(`role="link"`);
    expect(link).toContain(`aria-disabled="true"`);
    expect(button({ label: "Save", href: "/x" })).not.toContain("role=");
});

test("type submit and extra attributes are emitted; reserved ones are refused", () => {
    const html = button({
        label: "Save",
        type: "submit",
        attrs: { name: "mode", value: "save", "data-id": "7", form: "f1" },
    });
    expect(html).toContain(`type="submit"`);
    expect(html).toContain(`name="mode" value="save" data-id="7" form="f1"`);
    for (const key of [
        "class",
        "type",
        "href",
        "disabled",
        "onclick",
        "aria-label",
        "aria-disabled",
        "tabindex",
        "style",
        "formaction",
        "data-fd-btn",
    ]) {
        expect(() => button({ label: "x", attrs: { [key]: "y" } })).toThrow(
            /attribute/,
        );
    }
    expect(() => button({ label: "x", attrs: { "a b": "y" } })).toThrow(
        /attribute/,
    );
});

test("a disabled link cannot be re-enabled through attrs", () => {
    expect(() =>
        button({
            label: "x",
            href: "/a",
            disabled: true,
            attrs: { tabindex: "0" },
        }),
    ).toThrow(/attribute/);
});

test("label and attribute values are escaped", () => {
    const html = button({ label: XSS, attrs: { title: XSS } });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain(XSS);
    expect(button({ label: XSS, round: true, icon: "plus" })).toContain(
        `aria-label="${XSS_ESCAPED}"`,
    );
});

test("the filter button is a glyph with an optional count badge, never a number when zero", () => {
    const html = filterButton({ label: "Filter", count: 2 });
    expect(html).toStartWith(
        `<button type="button" class="fd-btn fd-btn--filter" data-fd-btn aria-label="Filter, 2 on">`,
    );
    expect(html).toContain(`<span class="fd-btn__badge">2</span>`);
    expect(filterButton({ label: "Filter" })).not.toContain("fd-btn__badge");
    expect(filterButton({ label: "Filter" })).toContain(`aria-label="Filter"`);
    expect(filterButton({ label: "Filter", count: 0 })).not.toContain(
        "fd-btn__badge",
    );
});

test("a count is shown only when it is a whole number above zero", () => {
    const badge = (count: number) =>
        filterButton({ label: "Filter", count }).toString();
    expect(badge(2)).toContain(`>2</span>`);
    expect(badge(2.5)).toContain(`>2</span>`);
    expect(badge(0.9)).not.toContain("fd-btn__badge");
    expect(badge(-1)).not.toContain("fd-btn__badge");
    expect(badge(Number.NaN)).not.toContain("fd-btn__badge");
    expect(badge(Number.POSITIVE_INFINITY)).not.toContain("fd-btn__badge");
});

test("focus and disabled rules outrank the app's .native form rules but not a context's own class", async () => {
    const css = await Bun.file("public/app/v2/button.css").text();
    // The state pseudo-class sits outside :where, so each selector is one type
    // plus one pseudo-class (0,1,1): above `:where(.native button):disabled`
    // and `:where(.native :is(…button)):focus-visible` (0,1,0), below any rule
    // that names a class (0,2,0 and up).
    expect(css).toContain(
        `:is(a, button):where(.fd-btn[data-fd-btn]):focus-visible {`,
    );
    expect(css).toContain(
        `:is(a, button):where(.fd-btn[data-fd-btn]):disabled,`,
    );
    expect(css).toContain(
        `:is(a, button):where(.fd-btn[data-fd-btn])[aria-disabled="true"] {`,
    );
    // It also undoes the form rule's ring, which would otherwise stack.
    const focus = css.slice(css.indexOf(":focus-visible {"));
    expect(focus).toContain("box-shadow: none");
    expect(focus).toContain("border-color: transparent");
    expect(css).not.toMatch(/:where\([^)]*:(focus-visible|disabled)/);
});
