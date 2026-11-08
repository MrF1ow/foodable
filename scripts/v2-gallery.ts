/**
 * Dev-only gallery of the v2 shared components (src/web/components/v2/) with
 * fixture data from the FigCraft screens, rendered on the real v2 tokens and
 * components.css, in light and dark. Not a production route; the server never
 * imports this file.
 *
 *   bun run preview:v2            # writes tmp/v2-gallery/*.html, serves :4788
 *   bun run preview:v2 --shots    # also writes a 390px-wide PNG per theme and per section, then exits
 *
 * Every page is self-contained (tokens, components.css, stepper.js and both
 * fonts inlined), one per theme and section, because the token file switches
 * theme on :root[data-theme]; index.html shows both themes as two phone
 * columns. --shots needs Chromium (see scripts/app-preview.ts).
 */
import { APP_FONTS } from "../src/tokens.js";
import {
    choiceGroup,
    chipLink,
    chipNav,
} from "../src/web/components/v2/chips.js";
import { raw, type Html } from "../src/web/components/v2/html.js";
import { iconRepeat } from "../src/web/components/v2/icons.js";
import {
    foodRow,
    fridgeRow,
    groceryRow,
    partRow,
    rowList,
    searchResultRow,
    sectionHeader,
    usualRow,
} from "../src/web/components/v2/rows.js";
import {
    scoreBadge,
    scoreBig,
    scoreVerdict,
} from "../src/web/components/v2/score-badge.js";
import { stepper } from "../src/web/components/v2/stepper.js";
import {
    deltaStat,
    statStrip,
    statTiles,
} from "../src/web/components/v2/stat-tiles.js";

const OUT = "./tmp/v2-gallery";
const PORT = 4788;

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** Gallery-only chrome (`g-` classes); the components under test are all `fd-`. */
const GALLERY_CSS = `
html { background: var(--surface-bg); }
body { margin: 0; background: var(--surface-bg); color: var(--text-primary); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
.g-phone { box-sizing: border-box; width: 390px; margin: 0 auto; padding: 24px var(--space-gutter) 40px; }
.g-title { margin: 0 0 4px; font: 600 11px/14px var(--font-body); letter-spacing: 0.9px; text-transform: uppercase; color: var(--accent-text); }
.g-note { margin: 0 0 12px; font: 400 12px/16px var(--font-body); color: var(--text-tertiary); }
.g-block { margin: 0 0 var(--space-section); }
.g-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-gap); margin-bottom: var(--space-gap); }
.g-sheet { margin: 0 calc(var(--space-gutter) * -1); padding: 0 var(--space-gutter); border-radius: var(--radius-sheet); background: var(--surface-panel); }
.g-split { display: flex; gap: 0; justify-content: center; align-items: flex-start; min-height: 100vh; }
.g-split iframe { border: 0; width: 390px; height: 4200px; }
`;

async function fontFaces(): Promise<string> {
    const faces = await Promise.all(
        APP_FONTS.map(async (font) => {
            const bytes = await Bun.file(`./public/fonts/${font.file}`).bytes();
            const b64 = Buffer.from(bytes).toString("base64");
            return `@font-face{font-family:"${font.family}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${font.weight};font-display:block;}`;
        }),
    );
    return faces.join("\n");
}

function block(title: string, note: string, body: Html | string): string {
    return `<section class="g-block"><h2 class="g-title">${title}</h2><p class="g-note">${note}</p>${body}</section>`;
}

const MACRO = (protein: number, carbs: number, fat: number) => ({
    protein,
    carbs,
    fat,
});

const SECTIONS: { id: string; render: () => string }[] = [
    {
        id: "rows-food",
        render: () =>
            block(
                "Section header + food rows",
                "#21941, #19186, #19380 (swipe)",
                `${sectionHeader({ title: "Breakfast", count: 432 })}${rowList(
                    [
                        foodRow({
                            title: "Scrambled eggs",
                            meta: "3 large",
                            macros: MACRO(19, 2, 15),
                            trailing: 216,
                            swipe: {
                                lead: {
                                    label: "Again",
                                    icon: iconRepeat(),
                                    form: { action: "/meals/1/again" },
                                },
                                trail: {
                                    label: "Delete",
                                    form: { action: "/meals/1/delete" },
                                },
                                open: "lead",
                            },
                        }),
                        foodRow({
                            title: "Toast",
                            meta: "2 slices",
                            macros: MACRO(7, 24, 2),
                            trailing: 216,
                            swipe: {
                                lead: { label: "Again", icon: iconRepeat() },
                                trail: { label: "Delete" },
                                open: "trail",
                            },
                        }),
                        foodRow({
                            title: "Chicken rice bowl",
                            meta: "1 bowl",
                            macros: MACRO(69, 76, 25),
                            trailing: 852,
                            swipe: {
                                lead: { label: "Again", icon: iconRepeat() },
                                trail: { label: "Delete" },
                            },
                            lead: { dot: "protein" },
                        }),
                        foodRow({ title: "Black coffee", trailing: 5 }),
                    ],
                    { label: "Breakfast" },
                )}<p class="g-note">Row 3 is a swipe row at rest: on a mouse, hover or focus a row to see its actions.</p>`,
            ),
    },
    {
        id: "rows-search",
        render: () =>
            block(
                "Search results",
                "#20321 with score badge #20367, on a sheet's panel surface",
                `<div class="g-sheet">${rowList(
                    [
                        searchResultRow({
                            title: "Chicken thighs",
                            subtitle:
                                "In your fridge · 0.5 lb · 209 / 100 g kcal",
                            macros: MACRO(26, 0, 11),
                            add: { label: "Add Chicken thighs" },
                        }),
                        searchResultRow({
                            title: "Chicken breast, grilled",
                            score: 82,
                            subtitle: "Generic · 165 / 100 g kcal",
                            macros: MACRO(31, 0, 4),
                            add: { label: "Add Chicken breast, grilled" },
                        }),
                        searchResultRow({
                            title: "Chicken noodle soup",
                            score: 41,
                            subtitle: "Campbell's · 1 cup · 90 kcal",
                            macros: MACRO(5, 12, 2),
                            add: { label: "Add Chicken noodle soup" },
                        }),
                        searchResultRow({
                            title: "Chicken caesar wrap",
                            score: 23,
                            subtitle: "Logged 3 times · 540 kcal",
                            macros: MACRO(32, 41, 26),
                            add: { label: "Add Chicken caesar wrap" },
                        }),
                    ],
                    { label: "Results" },
                )}</div>`,
            ),
    },
    {
        id: "rows-grocery",
        render: () =>
            block(
                "Grocery rows",
                "#21941 header, #21945 off, #21994 on",
                `${sectionHeader({ title: "Dairy & eggs", count: 2 })}${rowList(
                    [
                        groceryRow({
                            title: "Kirkland 2% milk",
                            subtitle: "Milk",
                            tag: "usual",
                            amount: "1 gal",
                        }),
                        groceryRow({
                            title: "Vital Farms large eggs",
                            subtitle: "Eggs",
                            tag: "usual",
                            amount: 24,
                        }),
                    ],
                )}<div style="height:var(--space-section)"></div>${sectionHeader({ title: "Pantry", count: 2 })}${rowList(
                    [
                        groceryRow({
                            title: "Jasmine rice",
                            subtitle: "Any brand",
                            amount: "5 lb",
                        }),
                        groceryRow({
                            title: "California Olive Ranch",
                            subtitle: "Olive oil",
                            tag: "usual",
                            amount: "1 bottle",
                            checked: true,
                        }),
                    ],
                )}`,
            ),
    },
    {
        id: "rows-kitchen",
        render: () =>
            block(
                "Fridge rows + usual rows",
                "#21411 fridge; #22410 usual (whole row is a link)",
                `${sectionHeader({ title: "Fridge", count: 4 })}${rowList([
                    fridgeRow({
                        title: "Eggs",
                        qty: 9,
                        date: "Nov 19",
                        dateTime: "2026-11-19",
                    }),
                    fridgeRow({
                        title: "Chicken thighs",
                        qty: "0.5 lb",
                        date: "Nov 10",
                    }),
                    fridgeRow({
                        title: "Cheddar",
                        qty: "200 g",
                        date: "Dec 2",
                    }),
                    fridgeRow({
                        title: "Milk 2%",
                        qty: "½ gal",
                        date: "Nov 12",
                    }),
                ])}<div style="height:var(--space-section)"></div>${sectionHeader({ title: "Usuals", count: 5 })}${rowList(
                    [
                        usualRow({
                            title: "Milk",
                            meta: "Kirkland 2% milk",
                            href: "/kitchen/usuals/milk",
                            parts: [
                                "Costco",
                                "1 gal",
                                "Every week",
                                "next Sunday",
                            ],
                        }),
                        usualRow({
                            title: "Eggs",
                            meta: "Vital Farms large",
                            href: "/kitchen/usuals/eggs",
                            parts: [
                                "Costco",
                                24,
                                "Every week",
                                { text: "low now", tone: "warn" },
                            ],
                        }),
                        usualRow({
                            title: "Greek yogurt",
                            meta: "Fage Total 2%",
                            href: "/kitchen/usuals/yogurt",
                            parts: [
                                "Trader Joe's",
                                "32 oz",
                                { text: "Every week", tone: "accent" },
                                { text: "on the list", tone: "accent" },
                            ],
                        }),
                        usualRow({
                            title: "Bananas",
                            meta: "Any brand",
                            href: "/kitchen/usuals/bananas",
                            parts: ["Trader Joe's", 6, "When low"],
                        }),
                        usualRow({
                            title: "Olive oil",
                            meta: "California Olive Ranch",
                            href: "/kitchen/usuals/olive-oil",
                            parts: [
                                "Costco",
                                "1 bottle",
                                { text: "Paused", tone: "muted" },
                            ],
                        }),
                    ],
                )}`,
            ),
    },
    {
        id: "rows-parts",
        render: () =>
            block(
                "Part rows",
                "#21113 (product score breakdown)",
                `${sectionHeader({ title: "Why this score" })}${rowList([
                    partRow({
                        label: "Nutri-Score",
                        value: "A",
                        status: "good",
                    }),
                    partRow({
                        label: "Processing",
                        value: "NOVA 1 · unprocessed",
                        status: "good",
                    }),
                    partRow({
                        label: "Additives",
                        value: "None",
                        status: "good",
                    }),
                    partRow({
                        label: "Sugar",
                        value: "4 g per 100 g · low",
                        status: "good",
                    }),
                    partRow({
                        label: "Saturated fat",
                        value: "2.0 g per 100 g · moderate",
                        status: "warn",
                    }),
                    partRow({
                        label: "Salt",
                        value: "1.9 g per 100 g · high",
                        status: "over",
                    }),
                    partRow({
                        label: "Green-Score",
                        value: "B",
                        status: "good",
                    }),
                ])}`,
            ),
    },
    {
        id: "chips",
        render: () =>
            block(
                "Filter chips (links)",
                "#20313, #21929, #22527",
                `<div class="g-block">${chipNav(
                    [
                        chipLink({
                            label: "All",
                            href: "#all",
                            selected: true,
                        }),
                        chipLink({ label: "Foods", href: "#foods" }),
                        chipLink({ label: "Recipes", href: "#recipes" }),
                        chipLink({ label: "My foods", href: "#mine" }),
                    ],
                    { label: "Filter foods" },
                )}</div><div class="g-block">${chipNav(
                    [
                        chipLink({
                            label: "Costco",
                            count: 5,
                            href: "#costco",
                            selected: true,
                        }),
                        chipLink({
                            label: "Trader Joe's",
                            count: 3,
                            href: "#tj",
                        }),
                    ],
                    { label: "Filter groceries by store" },
                )}</div><div class="g-block">${chipNav(
                    [
                        chipLink({ label: "All", href: "#a", selected: true }),
                        chipLink({ label: "Costco", count: 4, href: "#c" }),
                        chipLink({
                            label: "Trader Joe's",
                            count: 3,
                            href: "#t",
                        }),
                    ],
                    { label: "Filter usuals by store" },
                )}</div>` +
                    `<h2 class="g-title">Choice chips (radios)</h2><p class="g-note">#20591 units, meal chips, store choice. Tab in, arrow keys move.</p>` +
                    `<div class="g-block">${choiceGroup({
                        name: "unit",
                        legend: "Unit",
                        options: [
                            { value: "g", label: "g", selected: true },
                            { value: "oz", label: "oz" },
                            { value: "piece", label: "piece" },
                            { value: "cup", label: "cup" },
                        ],
                    })}</div><div class="g-block">${choiceGroup({
                        name: "meal",
                        legend: "Add to",
                        showLegend: true,
                        options: [
                            { value: "breakfast", label: "Breakfast" },
                            { value: "lunch", label: "Lunch" },
                            {
                                value: "dinner",
                                label: "Dinner",
                                selected: true,
                            },
                            { value: "snacks", label: "Snacks" },
                        ],
                    })}</div><div class="g-block">${choiceGroup({
                        name: "store",
                        legend: "Store",
                        showLegend: true,
                        options: [
                            {
                                value: "costco",
                                label: "Costco",
                                selected: true,
                            },
                            { value: "tj", label: "Trader Joe's" },
                            { value: "any", label: "Any store" },
                        ],
                    })}</div>`,
            ),
    },
    {
        id: "stepper",
        render: () =>
            block(
                "Stepper",
                "#20578 amount, #20885 weigh-in. Real number inputs: − / + work, typing works, bounds disable the buttons.",
                `<form onsubmit="return false">${stepper({ name: "amount", label: "Amount", value: 150, min: 0, max: 5000, step: 5, unit: "g" })}</form>` +
                    `<div style="height:var(--space-gap)"></div>${stepper({ name: "weight", label: "Weight", value: 182.4, min: 0, max: 700, step: 0.1, unit: "lb", id: "w" })}` +
                    `<div style="height:var(--space-gap)"></div>${stepper({ name: "qty", label: "Quantity", value: 0, min: 0, max: 10, unit: "bag", id: "q" })}`,
            ),
    },
    {
        id: "stat-tiles",
        render: () =>
            block(
                "Stat tiles",
                "#20599 boxed, #21274 strip, #21316 delta",
                `<div class="g-block">${statTiles(
                    [
                        { label: "kcal", value: 248, dot: "calories" },
                        {
                            label: "Protein",
                            value: 46,
                            unit: "g",
                            dot: "protein",
                        },
                        { label: "Carbs", value: 0, unit: "g", dot: "carbs" },
                        { label: "Fat", value: 5, unit: "g", dot: "fat" },
                    ],
                    { label: "This amount" },
                )}</div><div class="g-block">${statStrip(
                    [
                        { label: "day streak", value: 4 },
                        { label: "best streak", value: 20 },
                        { label: "days logged", value: "86%" },
                    ],
                    { label: "Streaks" },
                )}</div><div class="g-block">${deltaStat(
                    {
                        label: "Weight",
                        value: "182.4",
                        unit: "lb",
                        context: "this month",
                        delta: { text: "1.2", direction: "down", tone: "good" },
                    },
                    { label: "Weight" },
                )}</div><div class="g-block">${deltaStat(
                    {
                        label: "Weight",
                        value: "183.6",
                        unit: "lb",
                        context: "this month",
                        delta: { text: "1.2", direction: "up", tone: "bad" },
                    },
                    { label: "Weight" },
                )}</div><div class="g-block">${deltaStat(
                    {
                        label: "Weight",
                        value: "182.4",
                        unit: "lb",
                        context: "this month",
                        delta: {
                            text: "0.0",
                            direction: "flat",
                            tone: "neutral",
                        },
                    },
                    { label: "Weight" },
                )}</div>`,
            ),
    },
    {
        id: "score",
        render: () =>
            block(
                "Score badge",
                "#20367 small, #21105 verdict, #21100 big. Bands: good ≥ 70, middling 40–69, poor < 40.",
                `<div class="g-row">${scoreBadge(82)}${scoreBadge(41)}${scoreBadge(23)}${scoreBadge(70)}${scoreBadge(69)}${scoreBadge(Number.NaN)}</div>` +
                    `<div class="g-row">${scoreVerdict(82)}${scoreVerdict(55)}${scoreVerdict(12)}</div>` +
                    `<div class="g-row" style="justify-content:space-between">${scoreBig(82)}${scoreVerdict(82)}</div>` +
                    `<div class="g-row">${scoreBig(55)}</div><div class="g-row">${scoreBig(12)}</div>`,
            ),
    },
];

function page(
    theme: Theme,
    title: string,
    body: string,
    css: string,
    js: string,
    fonts: string,
): string {
    return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} (${theme})</title>
<style>${fonts}</style>
<style>${css}</style>
<style>${GALLERY_CSS}</style>
</head>
<body>
<main class="g-phone">
${body}
</main>
<script>${js}</script>
</body>
</html>`;
}

const [tokensCss, componentsCss, stepperJs, fonts] = await Promise.all([
    Bun.file("./public/app/v2/tokens.css").text(),
    Bun.file("./public/app/v2/components.css").text(),
    Bun.file("./src/web/client/v2/stepper.js").text(),
    fontFaces(),
]);
const css = `${tokensCss}\n${componentsCss}`;

const names: string[] = [];
for (const theme of THEMES) {
    const all = SECTIONS.map((s) => s.render()).join("\n");
    await Bun.write(
        `${OUT}/all-${theme}.html`,
        page(theme, "v2 components", all, css, stepperJs, fonts),
    );
    names.push(`all-${theme}`);
    for (const section of SECTIONS) {
        await Bun.write(
            `${OUT}/${section.id}-${theme}.html`,
            page(theme, section.id, section.render(), css, stepperJs, fonts),
        );
        names.push(`${section.id}-${theme}`);
    }
}
await Bun.write(
    `${OUT}/index.html`,
    `<!doctype html><html><head><meta charset="utf-8"><title>v2 components</title><style>body{margin:0;background:#888;font-family:system-ui}.g{display:flex;justify-content:center;gap:24px;padding:16px}iframe{border:0;width:390px;height:calc(100vh - 32px)}ul{columns:3;font-size:13px;padding:0 32px;list-style:none}</style></head><body><div class="g"><iframe src="all-light.html" title="light"></iframe><iframe src="all-dark.html" title="dark"></iframe></div><ul>${names.map((n) => `<li><a href="${n}.html">${n}</a></li>`).join("")}</ul></body></html>`,
);

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(`${OUT}${path === "/" ? "/index.html" : path}`);
        return (await file.exists())
            ? new Response(file)
            : new Response("not found", { status: 404 });
    },
});
console.log(`v2 gallery: http://localhost:${server.port}/`);

function findChromium(): string | null {
    for (const bin of [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ]) {
        try {
            if (Bun.file(bin).size > 0) return bin;
        } catch {
            // missing
        }
    }
    for (const bin of [
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]) {
        const found = Bun.which(bin);
        if (found) return found;
    }
    return null;
}

/** Window heights per page, tuned so each PNG shows its content without a dead band. */
const SECTION_HEIGHT: Record<string, number> = {
    "rows-food": 520,
    "rows-search": 640,
    "rows-grocery": 640,
    "rows-kitchen": 980,
    "rows-parts": 540,
    chips: 820,
    stepper: 400,
    "stat-tiles": 560,
    score: 440,
    all: 5400,
};

if (process.argv.includes("--shots")) {
    const chromium = findChromium();
    if (!chromium) {
        console.error("--shots: no chromium on PATH");
        process.exit(1);
    }
    for (const name of names) {
        const theme = name.endsWith("-dark") ? "dark" : "light";
        const section = name.slice(0, -(theme.length + 1));
        const height = SECTION_HEIGHT[section] ?? 800;
        const dataDir = `${OUT}/chrome-${name}`;
        // data-theme is stamped on <html>; the emulated scheme only matters for
        // anything left to prefers-color-scheme.
        const colorScheme = theme === "dark" ? 2 : 1;
        await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=390,${height} --virtual-time-budget=3000 --screenshot=${OUT}/${name}.png http://localhost:${PORT}/${name}.html`.quiet();
        console.log(`${OUT}/${name}.png`);
    }
    await Bun.$`rm -rf ${names.map((n) => `${OUT}/chrome-${n}`)}`.quiet();
    server.stop();
}
