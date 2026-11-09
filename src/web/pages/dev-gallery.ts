import type { AppChromeBase } from "../attention.js";
import { pageHeader } from "../components/ui.js";
import { renderAppShell } from "../shell.js";
import { choiceGroup, chipLink, chipNav } from "../components/v2/chips.js";
import { DOT_COLORS, dot } from "../components/v2/dot.js";
import { iconRepeat } from "../components/v2/icons.js";
import {
    foodRow,
    fridgeRow,
    groceryRow,
    partRow,
    rowList,
    searchResultRow,
    sectionHeader,
    usualRow,
} from "../components/v2/rows.js";
import {
    scoreBadge,
    scoreBig,
    scoreVerdict,
} from "../components/v2/score-badge.js";
import { sheet, sheetTrigger } from "../components/v2/sheet.js";
import { stepper } from "../components/v2/stepper.js";
import {
    deltaStat,
    statStrip,
    statTiles,
} from "../components/v2/stat-tiles.js";

const DEV_GALLERY_EDIT_SHEET = "dev-gallery-edit-sheet";

function block(title: string, note: string, body: string): string {
    return `<section class="fd-gallery-block"><h2 class="fd-gallery-title">${title}</h2><p class="fd-gallery-note">${note}</p>${body}</section>`;
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
                )}<p class="fd-gallery-note">Row 3 is a swipe row at rest: on a mouse, hover or focus a row to see its actions.</p>`,
            ),
    },
    {
        id: "rows-search",
        render: () =>
            block(
                "Search results",
                "#20321 with score badge #20367, on a sheet's panel surface",
                `<div class="fd-gallery-panel">${rowList(
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
                `<div class="fd-gallery-block">${chipNav(
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
                )}</div><div class="fd-gallery-block">${chipNav(
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
                )}</div><div class="fd-gallery-block">${chipNav(
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
                    `<h2 class="fd-gallery-title">Choice chips (radios)</h2><p class="fd-gallery-note">#20591 units, meal chips, store choice. Tab in, arrow keys move.</p>` +
                    `<div class="fd-gallery-block">${choiceGroup({
                        name: "unit",
                        legend: "Unit",
                        options: [
                            { value: "g", label: "g", selected: true },
                            { value: "oz", label: "oz" },
                            { value: "piece", label: "piece" },
                            { value: "cup", label: "cup" },
                        ],
                    })}</div><div class="fd-gallery-block">${choiceGroup({
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
                    })}</div><div class="fd-gallery-block">${choiceGroup({
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
                `<div class="fd-gallery-block">${statTiles(
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
                )}</div><div class="fd-gallery-block">${statStrip(
                    [
                        { label: "day streak", value: 4 },
                        { label: "best streak", value: 20 },
                        { label: "days logged", value: "86%" },
                    ],
                    { label: "Streaks" },
                )}</div><div class="fd-gallery-block">${deltaStat(
                    {
                        label: "Weight",
                        value: "182.4",
                        unit: "lb",
                        context: "this month",
                        delta: { text: "1.2", direction: "down", tone: "good" },
                    },
                    { label: "Weight" },
                )}</div><div class="fd-gallery-block">${deltaStat(
                    {
                        label: "Weight",
                        value: "183.6",
                        unit: "lb",
                        context: "this month",
                        delta: { text: "1.2", direction: "up", tone: "bad" },
                    },
                    { label: "Weight" },
                )}</div><div class="fd-gallery-block">${deltaStat(
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
                `<div class="fd-gallery-row">${scoreBadge(82)}${scoreBadge(41)}${scoreBadge(23)}${scoreBadge(70)}${scoreBadge(69)}${scoreBadge(Number.NaN)}</div>` +
                    `<div class="fd-gallery-row">${scoreVerdict(82)}${scoreVerdict(55)}${scoreVerdict(12)}</div>` +
                    `<div class="fd-gallery-row" style="justify-content:space-between">${scoreBig(82)}${scoreVerdict(82)}</div>` +
                    `<div class="fd-gallery-row">${scoreBig(55)}</div><div class="fd-gallery-row">${scoreBig(12)}</div>`,
            ),
    },
];

function dotsSection(): string {
    const md = DOT_COLORS.map((color) =>
        dot(color, { size: "md", label: color }),
    ).join("");
    const sm = DOT_COLORS.map((color) => dot(color, { size: "sm" })).join("");
    return block(
        "Colour dots",
        "Macro and status palette (sm 6px, md 8px)",
        `<div class="fd-gallery-row">${md}</div><div class="fd-gallery-row">${sm}</div>`,
    );
}

function sheetsSection(): string {
    const edit = sheet({
        id: DEV_GALLERY_EDIT_SHEET,
        kind: "edit",
        title: "Edit amount",
        subtitle: "Bottom sheet on phone, side panel on desktop",
        body: stepper({
            name: "gallery_amount",
            label: "Amount",
            value: 2,
            min: 0,
            max: 99,
            unit: "each",
        }),
        actions:
            '<button type="button" class="fd-btn" command="close" commandfor="' +
            DEV_GALLERY_EDIT_SHEET +
            '">Cancel</button><button type="button" class="fd-btn fd-btn--primary">Save</button>',
    });
    const trigger = sheetTrigger({
        target: DEV_GALLERY_EDIT_SHEET,
        label: "Open edit sheet",
        className: "fd-btn fd-btn--primary",
    });
    const confirmSample = `<div class="fd-gallery-sheet-sample fd-sheet fd-sheet--confirm" aria-hidden="true">
<div class="fd-sheet-panel">
<header class="fd-sheet-head">
<div class="fd-sheet-heading">
<h2 class="fd-sheet-title">Remove from list?</h2>
</div>
</header>
<div class="fd-sheet-body">
<p class="fd-sheet-message">This cannot be undone.</p>
</div>
<div class="fd-sheet-actions">
<button type="button" class="fd-btn" disabled>Cancel</button>
<button type="button" class="fd-btn fd-btn--danger" disabled>Remove</button>
</div>
</div>
</div>`;
    return block(
        "Sheet",
        "Closed dialogs plus trigger; confirm layout shown inline (not open on load)",
        `${trigger}${edit}${confirmSample}`,
    );
}

function devGalleryBody(): string {
    const sections = [
        ...SECTIONS.map((s) => s.render()),
        dotsSection(),
        sheetsSection(),
    ].join("\n");
    return `<div class="fd-gallery">${pageHeader({ title: "v2 components" })}${sections}</div>`;
}

export function renderDevGalleryV2Page(chrome: AppChromeBase): string {
    return renderAppShell({
        ...chrome,
        title: "v2 components",
        active: "none",
        v2Active: "none",
        body: devGalleryBody(),
    });
}
