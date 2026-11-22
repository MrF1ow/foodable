import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    confirmSheet,
    sheet,
    sheetActions,
    sheetHeader,
    sheetSection,
    sheetTrigger,
    type SheetActionsOptions,
    type SheetSectionOptions,
} from "./sheet.js";
import { raw } from "./html.js";
import {
    text,
    buttonLabels,
    DOLLAR_PAYLOADS,
    injectedAttributes,
    XSS,
    XSS_ESCAPED,
} from "./test-helpers.js";

const searchWith = (attrs: Record<string, string>, scan = false) =>
    sheetHeader({
        kind: "search",
        title: "Add food",
        sheetId: "s",
        search: {
            name: "q",
            label: "Search",
            placeholder: "Search",
            ...(scan
                ? { scan: { label: "Scan", attrs } }
                : { clear: { label: "Clear", attrs } }),
        },
    });

test("the search box refuses attributes it writes itself", () => {
    for (const key of ["class", "type", "aria-label", "style", "href"]) {
        expect(() => searchWith({ [key]: "x" })).toThrow("not allowed");
        expect(() => searchWith({ [key]: "x" }, true)).toThrow("not allowed");
    }
    const ok = String(searchWith({ "data-x": "1" }));
    expect(ok.match(/aria-label="Clear"/g)?.length).toBe(1);
});

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

test("showClose false omits the close button", () => {
    const html = sheet({
        id: "no-x",
        kind: "edit",
        title: "T",
        body: "",
        showClose: false,
    });
    expect(html).not.toContain("fd-sheet-close");
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

test("sheetTrigger ariaLabel names a text button without touching its text", () => {
    const html = sheetTrigger({
        target: "t",
        label: "Disconnect",
        className: "b",
        data: { k: "v" },
        ariaLabel: 'Disconnect "Claude"',
    });
    expect(html).toBe(
        '<button type="button" class="b" commandfor="t" command="show-modal" aria-label="Disconnect &quot;Claude&quot;" data-k="v">Disconnect</button>',
    );
    // An icon button keeps title from the label, but the name can still differ.
    const icon = sheetTrigger({
        target: "t",
        label: "Edit",
        icon: "<svg/>",
        ariaLabel: "Edit Chicken",
    });
    expect(icon).toContain('title="Edit"');
    expect(icon).toContain('aria-label="Edit Chicken"');
    expect(icon).not.toContain('aria-label="Edit"');
});

test("sheet className and focus add escaped attributes after the id", () => {
    const html = sheet({
        id: "log-amount",
        kind: "edit",
        title: "T",
        body: "",
        className: "fd-log-amount-sheet",
        focus: "panel",
    });
    expect(html).toContain(
        '<dialog class="fd-sheet fd-sheet--edit fd-log-amount-sheet" id="log-amount" data-fd-sheet-focus="panel" aria-labelledby="log-amount-title">',
    );
    const plain = sheet({ id: "x", kind: "edit", title: "T", body: "" });
    expect(plain).not.toContain("data-fd-sheet-focus");
    expect(plain).toContain('<dialog class="fd-sheet fd-sheet--edit" id="x"');
    const hostile = sheet({
        id: "x",
        kind: "edit",
        title: "T",
        body: "",
        className: 'a" onclick="1',
    });
    expect(hostile).toContain('class="fd-sheet fd-sheet--edit a&quot; onclick');
    expect(hostile).not.toContain('" onclick="1"');
});

test("sheet triggers and confirm sheets keep $-patterns in caller text inert", async () => {
    for (const payload of DOLLAR_PAYLOADS) {
        const trigger = sheetTrigger({
            target: "t",
            label: "Disconnect",
            className: "b",
            ariaLabel: `Disconnect ${payload}`,
            data: { name: payload },
        });
        const confirm = confirmSheet({
            id: "c",
            title: `Disconnect ${payload}?`,
            message: payload,
            action: "/x",
            confirmLabel: "Disconnect",
            hiddenFields: { client: payload },
            openOnLoad: true,
        });
        for (const html of [trigger, confirm]) {
            expect(await injectedAttributes(html)).toEqual([]);
        }
        expect(await buttonLabels(trigger)).toEqual([`Disconnect ${payload}`]);
    }
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

// The old signature keeps its exact markup for every caller that has not
// moved to the parts. These strings were taken from the code before the
// placement option was added.
const LEGACY_OUTPUT = {
    editFull:
        '<dialog class="fd-sheet fd-sheet--edit x-y" id="e1" data-fd-sheet-focus="panel" aria-labelledby="e1-title" aria-describedby="e1-sub" data-sheet-open-on-load>\n<div class="fd-sheet-panel" tabindex="-1">\n<div class="fd-sheet-handle" aria-hidden="true"></div>\n<header class="fd-sheet-head">\n<div class="fd-sheet-heading">\n<h2 class="fd-sheet-title" id="e1-title">Edit &lt;b&gt;</h2>\n<p class="fd-sheet-sub" id="e1-sub">Sub &amp; more</p>\n</div>\n<button type="button" class="fd-sheet-close" command="close" commandfor="e1" aria-label="Dismiss"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>\n</header>\n<div class="fd-sheet-body">\n<p>b</p>\n</div>\n<div class="fd-sheet-actions">\n<button type="submit">Save</button>\n</div>\n</div>\n</dialog>',
    editBare:
        '<dialog class="fd-sheet fd-sheet--edit" id="e2" aria-labelledby="e2-title">\n<div class="fd-sheet-panel" tabindex="-1">\n<div class="fd-sheet-handle" aria-hidden="true"></div>\n<header class="fd-sheet-head">\n<div class="fd-sheet-heading">\n<h2 class="fd-sheet-title" id="e2-title">T</h2>\n</div>\n<button type="button" class="fd-sheet-close" command="close" commandfor="e2" aria-label="Close"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>\n</header>\n<div class="fd-sheet-body">\n\n</div>\n</div>\n</dialog>',
    confirmNoClose:
        '<dialog class="fd-sheet fd-sheet--confirm" id="c1" aria-labelledby="c1-title">\n<div class="fd-sheet-panel" tabindex="-1">\n<div class="fd-sheet-handle" aria-hidden="true"></div>\n<header class="fd-sheet-head">\n<div class="fd-sheet-heading">\n<h2 class="fd-sheet-title" id="c1-title">T</h2>\n</div>\n\n</header>\n<div class="fd-sheet-body">\n<p>m</p>\n</div>\n</div>\n</dialog>',
    confirmSheet:
        '<dialog class="fd-sheet fd-sheet--confirm" id="cs" aria-labelledby="cs-title" aria-describedby="cs-sub" data-sheet-open-on-load>\n<div class="fd-sheet-panel" tabindex="-1">\n<div class="fd-sheet-handle" aria-hidden="true"></div>\n<header class="fd-sheet-head">\n<div class="fd-sheet-heading">\n<h2 class="fd-sheet-title" id="cs-title">Remove?</h2>\n<p class="fd-sheet-sub" id="cs-sub">s</p>\n</div>\n<button type="button" class="fd-sheet-close" command="close" commandfor="cs" aria-label="Close"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>\n</header>\n<div class="fd-sheet-body">\n<form id="cs-form" method="post" action="/x" data-turbo="false">\n<input type="hidden" name="a" value="1" />\n<p class="fd-sheet-message">Sure?</p>\n</form>\n</div>\n<div class="fd-sheet-actions">\n<button type="button" class="fd-btn" command="close" commandfor="cs">Cancel</button>\n<button type="submit" class="fd-btn fd-btn--danger" form="cs-form">Remove</button>\n</div>\n</div>\n</dialog>',
    trigger:
        '<button type="button" class="fd-btn" commandfor="e1" command="show-modal" aria-label="Open it" data-k="v">Open</button>',
};

test("the old sheet() signature renders exactly what it rendered before placement existed", () => {
    expect(
        sheet({
            id: "e1",
            kind: "edit",
            title: "Edit <b>",
            subtitle: "Sub & more",
            body: "<p>b</p>",
            actions: '<button type="submit">Save</button>',
            openOnLoad: true,
            closeLabel: "Dismiss",
            className: "x-y",
            focus: "panel",
        }),
    ).toBe(LEGACY_OUTPUT.editFull);
    expect(sheet({ id: "e2", kind: "edit", title: "T", body: "" })).toBe(
        LEGACY_OUTPUT.editBare,
    );
    expect(
        sheet({
            id: "c1",
            kind: "confirm",
            title: "T",
            body: "<p>m</p>",
            showClose: false,
        }),
    ).toBe(LEGACY_OUTPUT.confirmNoClose);
});

test("confirmSheet and sheetTrigger render exactly what they rendered before", () => {
    expect(
        confirmSheet({
            id: "cs",
            title: "Remove?",
            subtitle: "s",
            message: "Sure?",
            action: "/x",
            confirmLabel: "Remove",
            hiddenFields: { a: "1" },
            openOnLoad: true,
            turboFalse: true,
        }),
    ).toBe(LEGACY_OUTPUT.confirmSheet);
    expect(
        sheetTrigger({
            target: "e1",
            label: "Open",
            className: "fd-btn",
            ariaLabel: "Open it",
            data: { k: "v" },
        }),
    ).toBe(LEGACY_OUTPUT.trigger);
});

// ---- The sheet from parts ----

/** The visible text of every button in `html`, in order. */
const labels = (html: string): string[] =>
    [...html.matchAll(/<span class="fd-btn__label">([^<]*)<\/span>/g)].map(
        (m) => m[1] as string,
    );

const PLACEMENTS = ["bottom", "dialog", "side"] as const;

const titleHeader = {
    kind: "title" as const,
    title: "Chicken thighs",
    subtitle: "Fridge",
};

const searchHeader = {
    kind: "search" as const,
    title: "Log food",
    search: {
        name: "q",
        label: "Search foods",
        placeholder: "Search foods, recipes, barcodes",
    },
};

test("sheet places by `placement`: one class each, and the sheet carries no old kind class", () => {
    for (const placement of PLACEMENTS) {
        const html = sheet({
            id: "p",
            placement,
            header: titleHeader,
            body: raw(""),
        });
        expect(html).toContain(
            `<dialog class="fd-sheet fd-sheet--${placement}"`,
        );
        expect(html).not.toContain("fd-sheet--edit");
        expect(html).not.toContain("fd-sheet--confirm");
        expect(html).not.toContain("fd-sheet--search");
    }
});

test("a search header marks the sheet as a search sheet, the dialog's wider form", () => {
    const html = sheet({
        id: "s",
        placement: "dialog",
        header: searchHeader,
        body: raw(""),
    });
    expect(html).toContain(
        'class="fd-sheet fd-sheet--dialog fd-sheet--search"',
    );
});

test("a parts sheet is labelled by its title and described by its subtitle", () => {
    const html = sheet({
        id: "p",
        placement: "side",
        header: titleHeader,
        body: raw("<p>b</p>"),
        actions: { kind: "single", primary: { label: "Save" } },
        openOnLoad: true,
        className: "extra",
        focus: "panel",
    });
    expect(html).toContain(
        '<dialog class="fd-sheet fd-sheet--side extra" id="p" data-fd-sheet-focus="panel" aria-labelledby="p-title" aria-describedby="p-sub" data-sheet-open-on-load>',
    );
    expect(html).toContain('<div class="fd-sheet-panel" tabindex="-1">');
    expect(html).toContain('<div class="fd-sheet-body">\n<p>b</p>\n</div>');
    expect(html).toContain(
        '<div class="fd-sheet__actions fd-sheet__actions--single">',
    );
    const plain = sheet({
        id: "q",
        placement: "bottom",
        header: { kind: "title", title: "T" },
        body: raw(""),
    });
    expect(plain).not.toContain("aria-describedby");
    expect(plain).not.toContain("fd-sheet__actions");
});

test("the title header: grabber, title, subtitle and a close button that closes the sheet", () => {
    const html = text(sheetHeader({ ...titleHeader, sheetId: "p" }));
    expect(html).toContain(
        '<header class="fd-sheet__header fd-sheet__header--title">',
    );
    expect(html).toContain(
        '<div class="fd-sheet-handle" aria-hidden="true"></div>',
    );
    expect(html).toContain(
        '<h2 class="fd-sheet__title" id="p-title">Chicken thighs</h2>',
    );
    expect(html).toContain(
        '<p class="fd-sheet__subtitle" id="p-sub">Fridge</p>',
    );
    expect(html).toContain('command="close"');
    expect(html).toContain('commandfor="p"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("fd-btn--icon");
});

test("the title header without a subtitle or a close button; a renamed close", () => {
    const bare = text(
        sheetHeader({ kind: "title", title: "T", close: false, sheetId: "p" }),
    );
    expect(bare).not.toContain("fd-sheet__subtitle");
    expect(bare).not.toContain("command=");
    const renamed = text(
        sheetHeader({
            kind: "title",
            title: "T",
            close: { label: "Fermer" },
            sheetId: "p",
        }),
    );
    expect(renamed).toContain('aria-label="Fermer"');
});

test("the search header: a labelled search field, optional clear and scan, and an unseen title", () => {
    const plain = text(sheetHeader({ ...searchHeader, sheetId: "s" }));
    expect(plain).toContain(
        '<header class="fd-sheet__header fd-sheet__header--search">',
    );
    expect(plain).toContain('<h2 class="fd-sr" id="s-title">Log food</h2>');
    expect(plain).toContain(
        '<input class="fd-sheet__search-input" type="search" name="q" placeholder="Search foods, recipes, barcodes" aria-label="Search foods" autocomplete="off" enterkeyhint="search">',
    );
    expect(plain).not.toContain("fd-sheet__search-action");
    expect(plain).not.toContain("command=");
    const full = text(
        sheetHeader({
            kind: "search",
            title: "Log food",
            sheetId: "s",
            search: {
                ...searchHeader.search,
                value: "chick",
                clear: { label: "Clear search", attrs: { "data-x": "1" } },
                scan: { label: "Scan a barcode", href: "/scan" },
            },
        }),
    );
    expect(full).toContain(' value="chick"');
    expect(full).toContain('aria-label="Clear search" data-x="1"');
    expect(full).toContain(
        '<a class="fd-sheet__search-action" href="/scan" aria-label="Scan a barcode">',
    );
    expect(() =>
        sheetHeader({ kind: "search", title: "T", sheetId: "s" }),
    ).toThrow("search");
});

const SECTION_KINDS = [
    "amount",
    "fields",
    "choice",
    "rows",
    "chips",
    "tiles",
    "results",
    "custom",
] as const;

test("every section kind has its own container class, an optional label and the content", () => {
    for (const kind of SECTION_KINDS) {
        const html = text(
            sheetSection({ kind, label: "Amount", content: raw("<i>c</i>") }),
        );
        expect(html).toContain(
            `class="fd-sheet__section fd-sheet__section--${kind}"`,
        );
        expect(html).toContain('<h3 class="fd-sheet__label">Amount</h3>');
        expect(html).toContain(
            '<div class="fd-sheet__content">\n<i>c</i>\n</div>',
        );
        const unlabelled = text(sheetSection({ kind, content: raw("") }));
        expect(unlabelled).not.toContain("fd-sheet__label");
    }
});

test("message and empty sections hold escaped text", () => {
    for (const kind of ["message", "empty"] as const) {
        const html = text(sheetSection({ kind, text: `a ${XSS}` }));
        expect(html).toContain(`fd-sheet__section--${kind}`);
        expect(html).toContain(
            `<p class="fd-sheet__text">a ${XSS_ESCAPED}</p>`,
        );
        expect(html).not.toContain("<script>");
    }
});

test("every actions kind renders the design's buttons", () => {
    const pair = text(
        sheetActions({
            kind: "pair",
            primary: { label: "Save" },
            sheetId: "p",
        }),
    );
    expect(pair).toContain("fd-sheet__actions--pair");
    expect(labels(pair)).toEqual(["Cancel", "Save"]);
    // Cancel closes the sheet; the primary is the accent button.
    expect(pair).toContain('commandfor="p"');
    expect(pair).toContain("fd-btn--primary");

    const single = text(
        sheetActions({
            kind: "single",
            primary: { label: "Save" },
            sheetId: "p",
        }),
    );
    expect(single).toContain("fd-sheet__actions--single");
    expect(labels(single)).toEqual(["Save"]);

    const destructive = text(
        sheetActions({
            kind: "destructive",
            danger: { label: "Remove", type: "submit", form: "f" },
            sheetId: "p",
        }),
    );
    expect(destructive).toContain("fd-sheet__actions--destructive");
    expect(labels(destructive)).toEqual(["Cancel", "Remove"]);
    expect(destructive).toContain("fd-btn--danger");
    expect(destructive).toContain('type="submit"');
    expect(destructive).toContain('form="f"');

    const link = text(
        sheetActions({
            kind: "link",
            link: { label: "Scan the barcode", href: "/scan" },
            sheetId: "p",
        }),
    );
    expect(link).toContain("fd-sheet__actions--link");
    expect(link).toContain("fd-btn--link");
    expect(link).toContain('href="/scan"');
    expect(link).toContain("Scan the barcode");
});

test("a pair or destructive row takes the caller's own Cancel", () => {
    const html = text(
        sheetActions({
            kind: "pair",
            cancel: { label: "Back", attrs: { "data-back": "1" } },
            primary: { label: "Next" },
            sheetId: "p",
        }),
    );
    expect(labels(html)).toEqual(["Back", "Next"]);
    expect(html).toContain('data-back="1"');
    expect(html).not.toContain("command=");
});

test("hostile text in every part is escaped and injects no attribute", async () => {
    const actions: SheetActionsOptions[] = [
        { kind: "single", primary: { label: XSS } },
        { kind: "pair", primary: { label: XSS } },
        { kind: "destructive", danger: { label: XSS, form: XSS } },
        { kind: "link", link: { label: XSS, href: "/x" } },
    ];
    const sections: SheetSectionOptions[] = [
        { kind: "message", label: XSS, text: XSS },
        { kind: "empty", text: XSS },
    ];
    const html = [
        sheet({
            id: XSS,
            placement: "dialog",
            header: {
                kind: "title",
                title: XSS,
                subtitle: XSS,
                close: { label: XSS },
            },
            body: raw(sections.map((x) => sheetSection(x)).join("")),
            actions: actions[0],
        }),
        sheetHeader({
            kind: "search",
            title: XSS,
            sheetId: XSS,
            search: {
                name: XSS,
                label: XSS,
                placeholder: XSS,
                value: XSS,
                clear: { label: XSS },
                scan: { label: XSS, href: XSS },
            },
        }),
        ...actions.map((a) => sheetActions({ ...a, sheetId: XSS })),
    ].join("\n");
    expect(html).not.toContain("<script>");
    expect(html).toContain(XSS_ESCAPED);
    expect(await injectedAttributes(html)).toEqual([]);
    for (const payload of DOLLAR_PAYLOADS) {
        const out = sheet({
            id: payload,
            placement: "bottom",
            header: { kind: "title", title: payload, subtitle: payload },
            body: raw(sheetSection({ kind: "message", text: payload })),
            actions: { kind: "pair", primary: { label: payload } },
        });
        expect(await injectedAttributes(out)).toEqual([]);
    }
});

test("an attribute that is not a plain name is refused", () => {
    expect(() =>
        sheetHeader({
            kind: "search",
            title: "T",
            sheetId: "s",
            search: {
                ...searchHeader.search,
                clear: { label: "x", attrs: { onclick: "1" } },
            },
        }),
    ).toThrow("not allowed");
});

test("touch-action none covers the grabber and title row, not the search box", () => {
    const css = readFileSync("public/app/v2/sheet.css", "utf8");
    const header = css.match(/\.fd-sheet__header \{[^}]*\}/)?.[0] ?? "";
    expect(header).not.toBe("");
    expect(header).not.toContain("touch-action");
    const grip = css.match(
        /\.fd-sheet__header \.fd-sheet-handle,\s*\.fd-sheet__row \{([^}]*)\}/,
    );
    expect(grip?.[1]).toContain("touch-action: none");
});

test("the results section spaces its list rows 12px apart", () => {
    const rule = stripped.match(
        /\.fd-sheet__section--results \.fd-list-group \{([^}]*)\}/,
    );
    expect(rule?.[1]).toContain("display: flex");
    expect(rule?.[1]).toContain("flex-direction: column");
    expect(rule?.[1]).toContain("gap: var(--space-md)");
    expect(tokens).toMatch(/--space-md:\s*12px/);
    expect(stripped).not.toMatch(/fd-sheet-sample__(slot|tile)/);
});
