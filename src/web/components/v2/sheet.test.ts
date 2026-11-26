import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
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

test("sheet triggers keep $-patterns in caller text inert", async () => {
    for (const payload of DOLLAR_PAYLOADS) {
        const trigger = sheetTrigger({
            target: "t",
            label: "Disconnect",
            className: "b",
            ariaLabel: `Disconnect ${payload}`,
            data: { name: payload },
        });
        expect(await injectedAttributes(trigger)).toEqual([]);
        expect(await buttonLabels(trigger)).toEqual([`Disconnect ${payload}`]);
    }
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

test("sheetTrigger renders the button the pages style", () => {
    expect(
        sheetTrigger({
            target: "e1",
            label: "Open",
            className: "fd-btn",
            ariaLabel: "Open it",
            data: { k: "v" },
        }),
    ).toBe(
        '<button type="button" class="fd-btn" commandfor="e1" command="show-modal" aria-label="Open it" data-k="v">Open</button>',
    );
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

test("the search header can carry an id, and a Go button hidden until a link is detected", () => {
    const html = String(
        sheetHeader({
            sheetId: "s",
            kind: "search",
            title: "Search",
            search: {
                name: "q",
                id: "s-q",
                label: "Search",
                placeholder: "Search",
                go: { label: "Import recipe", attrs: { "data-fd-go": "" } },
            },
        }),
    );
    expect(html).toContain('<input class="fd-sheet__search-input" id="s-q"');
    expect(html).toContain("fd-sheet__search-icon--link");
    expect(html).toMatch(
        /<button[^>]*fd-btn--go[^>]*aria-label="Import recipe"[^>]*data-fd-go=""[^>]*hidden/,
    );
    // Without Go the lead is the one magnifier.
    expect(
        String(
            sheetHeader({
                sheetId: "s",
                kind: "search",
                title: "Search",
                search: { name: "q", label: "x", placeholder: "x" },
            }),
        ),
    ).not.toContain("search-icon--link");
});

test("the quick grid is four columns on the phone and a tight row of six on the wide dialog", () => {
    const css = readFileSync("public/app/v2/sheet.css", "utf8");
    expect(css).toMatch(
        /\.fd-sheet__section--tiles \.fd-sheet__content \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/,
    );
    const wide = css.slice(css.indexOf("@media (min-width: 1024px)"));
    expect(wide).toMatch(
        /\.fd-sheet--dialog \.fd-sheet__section--tiles \.fd-sheet__content \{[^}]*repeat\(6, minmax\(0, 1fr\)\)/,
    );
});

test("a title header can carry a ⋯ menu before the close button", () => {
    const html = sheetHeader({
        kind: "title",
        title: "Milk",
        sheetId: "s",
        menu: raw('<div class="fd-menu">⋯</div>'),
    });
    const menuAt = html.indexOf('class="fd-sheet__menu"');
    expect(menuAt).toBeGreaterThan(-1);
    expect(menuAt).toBeLessThan(html.indexOf('commandfor="s"'));
    expect(
        sheetHeader({ kind: "title", title: "Milk", sheetId: "s" }),
    ).not.toContain("fd-sheet__menu");
});
