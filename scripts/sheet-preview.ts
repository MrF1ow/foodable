/**
 * Dev-only preview of the redesign's sheet component (UI-6). Never a
 * production route: it serves a static page that loads public/app/v2/tokens.css,
 * public/app/v2/sheet.css and src/web/client/v2/sheet.js, with an "edit a food"
 * sheet (bottom sheet on a phone, 480px panel at >= 1024px) and a delete
 * confirmation (bottom sheet on a phone, centred dialog at >= 1024px).
 *
 *   bun run preview:sheet            # writes tmp/sheet-preview/index.html, serves :4788
 *   bun run preview:sheet --shots    # also writes six PNGs to tmp/sheet-preview/, then exits
 *
 * Query flags: ?open=edit|confirm opens a sheet on load, ?theme=light|dark
 * pins the theme. --shots needs Chromium on PATH (see scripts/app-preview.ts
 * for why the PATH google-chrome wrapper is skipped).
 */
import {
    confirmSheet,
    sheet,
    sheetTrigger,
} from "../src/web/components/v2/sheet.js";

const OUT = "./tmp/sheet-preview";
const PORT = 4788;

const PREVIEW_CSS = `
html { background: var(--surface-bg); color: var(--text-primary); font-family: var(--font-body); }
body { margin: 0; padding: 24px var(--space-gutter); }
h1 { font-family: var(--font-display); font-size: 28px; margin: 0 0 12px; }
.demo-triggers { display: flex; gap: 10px; }
.demo-triggers button { height: 40px; padding: 0 16px; border: 0; border-radius: var(--radius-pill);
  background: var(--surface-raised); color: var(--text-primary); font: inherit; font-weight: 600; cursor: pointer; }
/* The edit sheet's content, mirroring the FigCraft "edit a food" frames. */
.pv-stepper { display: flex; align-items: center; justify-content: space-between; height: 60px; }
.pv-stepper button { display: grid; place-items: center; width: 48px; height: 48px; margin: 0; padding: 0;
  border: 0; border-radius: 50%; background: var(--surface-raised); color: var(--text-primary); cursor: pointer; }
.pv-value { display: flex; align-items: baseline; gap: 6px; }
.pv-value b { font-family: var(--font-display); font-size: 36px; font-weight: 600; line-height: 1; }
.pv-value span { font-size: 15px; color: var(--text-secondary); }
.pv-tiles { display: flex; gap: 6px; margin-top: 12px; }
.pv-tile { display: flex; flex: 1 1 0; flex-direction: column; gap: 4px; min-width: 0;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px; }
.pv-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.pv-dot { width: 6px; height: 6px; border-radius: 50%; }
.pv-tile b { font-size: 17px; font-weight: 600; color: var(--text-primary); }
.pv-list { margin-top: 16px; border-radius: var(--radius-lg); background: var(--surface-panel); }
.pv-row { display: flex; align-items: center; gap: 14px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.pv-row > span { display: flex; align-items: center; line-height: 1.2; }
.pv-row svg { flex: none; }
.pv-row .pv-icon { color: var(--text-secondary); }
.pv-row .pv-name { font-size: 15px; color: var(--text-primary); }
.pv-row .pv-spacer { flex: 1 1 auto; }
.pv-row .pv-meta { font-size: 13px; color: var(--text-tertiary); }
.pv-row .pv-chev { color: var(--text-tertiary); }
`;

const svg = (w: number, body: string, stroke = 1.6) =>
    `<svg viewBox="0 0 ${w} ${w}" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON_MINUS = svg(14, '<path d="M2 7h10"/>');
const ICON_PLUS = svg(14, '<path d="M2 7h10M7 2v10"/>');
const ICON_CLOCK = svg(
    24,
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
);
const ICON_MOVE = svg(24, '<path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>');
const ICON_CHEVRON = svg(16, '<path d="M6 3l5 5-5 5"/>');

const tile = (macro: string, label: string, value: string) =>
    `<div class="pv-tile"><div class="pv-label"><i class="pv-dot" style="background:var(--macro-${macro})"></i>${label}</div><b>${value}</b></div>`;
const row = (icon: string, name: string, value: string) =>
    `<div class="pv-row"><span class="pv-icon">${icon}</span><span class="pv-name">${name}</span><span class="pv-spacer"></span><span class="pv-meta">${value}</span><span class="pv-chev">${ICON_CHEVRON}</span></div>`;

// The submit button lives in the action row, outside the form, and names it
// with form="demo-edit-form"; the preview swallows the submit.
const EDIT_BODY = `<form id="demo-edit-form" method="post" action="/preview/save" onsubmit="event.preventDefault()">
<div class="pv-stepper"><button type="button" aria-label="Fewer">${ICON_MINUS}</button>
<div class="pv-value"><b>1</b><span>bowl</span></div>
<button type="button" aria-label="More">${ICON_PLUS}</button></div>
<div class="pv-tiles">${tile("calories", "kcal", "852")}${tile("protein", "Protein", "69 g")}${tile("carbs", "Carbs", "76 g")}${tile("fat", "Fat", "25 g")}</div>
<div class="pv-list">${row(ICON_CLOCK, "Time", "12:40")}${row(ICON_MOVE, "Move to", "Lunch")}</div>
</form>`;

const EDIT_ACTIONS = `<button type="button" class="fd-btn fd-btn--danger" command="show-modal" commandfor="demo-confirm">Delete</button>
<button type="submit" class="fd-btn fd-btn--primary" form="demo-edit-form">Save</button>`;

export function previewPage(opts: {
    open?: string | null;
    theme?: string | null;
}): string {
    const theme =
        opts.theme === "light" || opts.theme === "dark" ? opts.theme : null;
    const html = [
        `<h1>Today</h1>`,
        `<div class="demo-triggers">`,
        sheetTrigger({ target: "demo-edit", label: "Edit a food" }),
        sheetTrigger({ target: "demo-confirm", label: "Delete a food" }),
        `</div>`,
        sheet({
            id: "demo-edit",
            kind: "edit",
            title: "Chicken rice bowl",
            subtitle: "Lunch · 12:40 · from your recipe",
            body: EDIT_BODY,
            actions: EDIT_ACTIONS,
            openOnLoad: opts.open === "edit",
        }),
        confirmSheet({
            id: "demo-confirm",
            title: "Delete Chicken rice bowl?",
            message: "This removes it from today's log. You can't undo this.",
            action: "/preview/delete",
            confirmLabel: "Delete",
            hiddenFields: { id: "meal-1" },
            openOnLoad: opts.open === "confirm",
        }),
    ].join("\n");
    return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Sheet preview</title>
<style>
@font-face { font-family: "Geist"; src: url("/fonts/geist-latin.woff2") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Bricolage Grotesque"; src: url("/fonts/bricolage-latin.woff2") format("woff2"); font-weight: 200 800; }
</style>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/sheet.css">
<style>${PREVIEW_CSS}</style>
</head>
<body>
${html}
<script>
window.FoodableApp = { onLoad(fn) { fn(document); } };
</script>
<script src="/sheet.js"></script>
</body>
</html>
`;
}

function findChromium(): string | null {
    for (const bin of [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]) {
        if (bin.startsWith("/")) {
            try {
                if (Bun.file(bin).size > 0) return bin;
            } catch {
                // missing
            }
            continue;
        }
        const path = Bun.which(bin);
        if (path) return path;
    }
    return null;
}

if (import.meta.main) {
    await Bun.write(`${OUT}/index.html`, previewPage({}));

    const assets: Record<string, string> = {
        "/tokens.css": "./public/app/v2/tokens.css",
        "/sheet.css": "./public/app/v2/sheet.css",
        "/sheet.js": "./src/web/client/v2/sheet.js",
    };
    const server = Bun.serve({
        port: PORT,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/" || url.pathname === "/index.html") {
                return new Response(
                    previewPage({
                        open: url.searchParams.get("open"),
                        theme: url.searchParams.get("theme"),
                    }),
                    { headers: { "content-type": "text/html; charset=utf-8" } },
                );
            }
            const asset = assets[url.pathname];
            if (asset) return new Response(Bun.file(asset));
            if (/^\/fonts\/[\w.-]+$/.test(url.pathname)) {
                const f = Bun.file(`./public${url.pathname}`);
                if (await f.exists()) return new Response(f);
            }
            return new Response("not found", { status: 404 });
        },
    });
    console.log(`sheet preview: http://localhost:${server.port}/?open=edit`);

    if (process.argv.includes("--shots")) {
        const chromium = findChromium();
        if (!chromium) {
            console.error("--shots: no chromium on PATH");
            process.exit(1);
        }
        const shots: Array<{
            name: string;
            open: string;
            size: string;
            touch: boolean;
        }> = [
            { name: "phone-edit", open: "edit", size: "390,844", touch: true },
            {
                name: "desktop-edit",
                open: "edit",
                size: "1440,960",
                touch: false,
            },
            {
                name: "desktop-confirm",
                open: "confirm",
                size: "1440,960",
                touch: false,
            },
        ];
        try {
            for (const theme of ["light", "dark"] as const) {
                for (const shot of shots) {
                    const file = `${OUT}/${shot.name}-${theme}.png`;
                    const flags = [
                        "--headless=new",
                        "--no-sandbox",
                        "--disable-gpu",
                        "--disable-dev-shm-usage",
                        "--hide-scrollbars",
                        "--force-prefers-reduced-motion",
                        `--user-data-dir=${OUT}/chrome-${shot.name}-${theme}`,
                        `--window-size=${shot.size}`,
                        "--virtual-time-budget=3000",
                        `--screenshot=${file}`,
                    ];
                    if (shot.touch) flags.push("--touch-events=enabled");
                    await Bun.$`${chromium} ${flags} ${`http://localhost:${PORT}/?open=${shot.open}&theme=${theme}`}`.quiet();
                    console.log(file);
                }
            }
        } finally {
            server.stop(true);
        }
    }
}
