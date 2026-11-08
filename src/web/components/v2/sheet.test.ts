import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { confirmSheet, sheet, sheetTrigger } from "./sheet.js";

const edit = () =>
    sheet({
        id: "food-edit",
        kind: "edit",
        title: "Chicken rice bowl",
        subtitle: "Lunch · 12:40 · from your recipe",
        body: "<p>body</p>",
        actions: '<button type="submit">Save</button>',
    });

test("sheet renders a native dialog labelled by its title", () => {
    const html = edit();
    expect(html.startsWith("<dialog ")).toBe(true);
    expect(html).toContain('id="food-edit"');
    expect(html).toContain('aria-labelledby="food-edit-title"');
    expect(html).toContain('<h2 class="fd-sheet-title" id="food-edit-title">');
    expect(html).toContain("Chicken rice bowl</h2>");
});

test("sheet pins its class names", () => {
    const html = edit();
    for (const cls of [
        "fd-sheet fd-sheet--edit",
        "fd-sheet-panel",
        "fd-sheet-handle",
        "fd-sheet-head",
        "fd-sheet-heading",
        "fd-sheet-title",
        "fd-sheet-sub",
        "fd-sheet-close",
        "fd-sheet-body",
        "fd-sheet-actions",
    ]) {
        expect(html).toContain(`class="${cls}"`);
    }
    expect(html).toContain('class="fd-sheet-handle" aria-hidden="true"');
    const confirm = sheet({
        id: "c",
        kind: "confirm",
        title: "T",
        body: "",
    });
    expect(confirm).toContain('class="fd-sheet fd-sheet--confirm"');
    expect(confirm).not.toContain("fd-sheet--edit");
});

test("aria-describedby only appears with a subtitle", () => {
    expect(edit()).toContain('aria-describedby="food-edit-sub"');
    expect(edit()).toContain(
        '<p class="fd-sheet-sub" id="food-edit-sub">Lunch · 12:40 · from your recipe</p>',
    );
    const bare = sheet({ id: "x", kind: "edit", title: "T", body: "" });
    expect(bare).not.toContain("aria-describedby");
    expect(bare).not.toContain("fd-sheet-sub");
});

test("the action row only renders with actions", () => {
    expect(edit()).toContain('<div class="fd-sheet-actions">');
    const bare = sheet({ id: "x", kind: "edit", title: "T", body: "" });
    expect(bare).not.toContain("fd-sheet-actions");
});

test("the close button is a native close command with an accessible name", () => {
    const html = edit();
    expect(html).toContain(
        '<button type="button" class="fd-sheet-close" command="close" commandfor="food-edit" aria-label="Close">',
    );
    const custom = sheet({
        id: "x",
        kind: "edit",
        title: "T",
        body: "",
        closeLabel: 'Fermer "x"',
    });
    expect(custom).toContain('aria-label="Fermer &quot;x&quot;"');
});

test("openOnLoad adds the reopen attribute", () => {
    expect(edit()).not.toContain("data-sheet-open-on-load");
    const html = sheet({
        id: "x",
        kind: "edit",
        title: "T",
        body: "",
        openOnLoad: true,
    });
    expect(html).toContain(" data-sheet-open-on-load>");
});

test("title, subtitle, id and close label are escaped; body is passed through", () => {
    const html = sheet({
        id: 'a"><script>1</script>',
        kind: "edit",
        title: "<script>alert(1)</script>",
        subtitle: 'x" onclick="y',
        body: "<b>kept</b>",
        closeLabel: "<i>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("x&quot; onclick=&quot;y");
    expect(html).toContain('id="a&quot;&gt;&lt;script&gt;1&lt;/script&gt;"');
    expect(html).toContain("<b>kept</b>");
    expect(html).toContain('aria-label="&lt;i&gt;"');
});

test("sheetTrigger opens the sheet with the native invoker command", () => {
    expect(
        sheetTrigger({ target: "food-edit", label: "Edit", className: "b" }),
    ).toBe(
        '<button type="button" class="b" commandfor="food-edit" command="show-modal">Edit</button>',
    );
    const icon = sheetTrigger({
        target: "t",
        label: 'Edit "x"',
        icon: "<svg/>",
        data: { 'k"': '<v">' },
    });
    expect(icon).toContain('title="Edit &quot;x&quot;"');
    expect(icon).toContain('aria-label="Edit &quot;x&quot;"');
    expect(icon).toContain(' data-k&quot;="&lt;v&quot;&gt;"');
    expect(icon).toContain("><svg/></button>");
    expect(sheetTrigger({ target: "t", label: "<b>" })).toContain(
        ">&lt;b&gt;</button>",
    );
});

test("confirmSheet posts a form from the sticky row, with escaped hidden fields", () => {
    const html = confirmSheet({
        id: "del-1",
        title: "Delete <Chicken>?",
        message: "Gone for good & ever.",
        action: '/foods/1/delete?x="1"',
        confirmLabel: "Delete",
        hiddenFields: { id: '1"><x', note: "a&b" },
        openOnLoad: true,
        turboFalse: true,
    });
    expect(html).toContain("fd-sheet--confirm");
    expect(html).toContain("data-sheet-open-on-load");
    expect(html).toContain(
        '<form id="del-1-form" method="post" action="/foods/1/delete?x=&quot;1&quot;" data-turbo="false">',
    );
    expect(html).toContain(
        '<input type="hidden" name="id" value="1&quot;&gt;&lt;x" />',
    );
    expect(html).toContain(
        '<input type="hidden" name="note" value="a&amp;b" />',
    );
    expect(html).toContain(
        '<p class="fd-sheet-message">Gone for good &amp; ever.</p>',
    );
    expect(html).toContain("Delete &lt;Chicken&gt;?</h2>");
    // Cancel + danger confirm live in the action row; confirm submits the form by id.
    expect(html).toContain(
        '<button type="button" class="fd-btn" command="close" commandfor="del-1">Cancel</button>',
    );
    expect(html).toContain(
        '<button type="submit" class="fd-btn fd-btn--danger" form="del-1-form">Delete</button>',
    );
    const actions = html.slice(html.indexOf("fd-sheet-actions"));
    expect(actions).toContain("fd-btn--danger");
    expect(html.slice(0, html.indexOf("fd-sheet-actions"))).not.toContain(
        "fd-btn--danger",
    );
});

test("confirmSheet's submit names the form by the exact same escaped id", () => {
    const html = confirmSheet({
        id: 'del"1',
        title: "T",
        message: "M",
        action: "/x",
        confirmLabel: "Delete",
    });
    const formId = html.match(/<form id="([^"]*)"/)?.[1];
    const submitFor = html.match(/type="submit"[^>]*form="([^"]*)"/)?.[1];
    expect(formId).toBe("del&quot;1-form");
    expect(submitFor).toBe(formId);
    // No raw quote broke out of either attribute.
    expect(html).not.toContain('form="del"');
    expect(html).not.toContain('id="del"');
});

// ---- the stylesheet ----

const css = readFileSync("./public/app/v2/sheet.css", "utf8");
const tokens = readFileSync("./public/app/v2/tokens.css", "utf8");
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("sheet.css has no colour literals", () => {
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(stripped).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/);
    // Named colours too (transparent and currentColor are not colours of ours).
    expect(stripped).not.toMatch(
        /(^|[\s:(,])(black|white|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|navy|teal|maroon|olive|lime|aqua|cyan|magenta|gold|ivory|beige|tan|salmon|coral|crimson)(?=[\s;,)]|$)/im,
    );
});

test("every var(--x) in sheet.css is a v2 token or a local --fd- property", () => {
    const defined = new Set(
        [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    );
    for (const m of stripped.matchAll(/(--fd-[\w-]+)\s*:/g)) {
        defined.add(m[1]);
    }
    const used = [...stripped.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const name of used) expect(defined.has(name)).toBe(true);
    // The partial does not borrow the old app's variables.
    expect(stripped).not.toMatch(/var\(--(bg|fg|accent|muted|border)[,)]/);
});

test("every class selector in sheet.css starts with fd-", () => {
    const selectors = stripped
        .replace(/\{[^{}]*\}/g, "{}")
        .replace(/@[^{;]+\{/g, "")
        .replace(/[{}]/g, ",");
    const classes = [...selectors.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(
        (m) => m[1],
    );
    expect(classes.length).toBeGreaterThan(10);
    for (const cls of classes) expect(cls?.startsWith("fd-")).toBe(true);
});

test("sheet.css honours the one breakpoint, [hidden] and reduced motion", () => {
    expect(stripped).toContain("@media (min-width: 1024px)");
    expect(stripped).not.toMatch(/@media \(max-width/);
    expect(stripped).toContain("[hidden]");
    expect(stripped).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
    );
    expect(stripped).toContain("::backdrop");
    expect(stripped).toContain("var(--overlay-scrim)");
});
