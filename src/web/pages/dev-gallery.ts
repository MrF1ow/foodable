import type { AppChromeBase } from "../attention.js";
import { pageHeader } from "../components/ui.js";
import { renderAppShell } from "../shell.js";
import { button, filterButton } from "../components/v2/button.js";
import { choiceGroup, chipLink, chipNav } from "../components/v2/chips.js";
import { DOT_COLORS, dot } from "../components/v2/dot.js";
import { ICON_NAMES, icon } from "../components/v2/icon.js";
import { iconRepeat } from "../components/v2/icons.js";
import { itemRow, type ItemRowOptions } from "../components/v2/item-row.js";
import { listGroup } from "../components/v2/list-group.js";
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
import { sectionHeader as sectionHeaderV2 } from "../components/v2/section-header.js";
import { raw, type Html } from "../components/v2/html.js";
import {
    sheet,
    sheetActions,
    sheetHeader,
    sheetSection,
    sheetTrigger,
    type SheetActionsOptions,
    type SheetHeaderOptions,
    type SheetPlacement,
} from "../components/v2/sheet.js";
import { stepper } from "../components/v2/stepper.js";
import {
    deltaStat,
    statStrip,
    statTiles,
} from "../components/v2/stat-tiles.js";

const DEV_GALLERY_EDIT_SHEET = "dev-gallery-edit-sheet";
// Live sheets from parts: the trigger of each is on the gallery, for check:nav.
const DEV_GALLERY_DIALOG_SHEET = "dev-gallery-dialog-sheet";
const DEV_GALLERY_SIDE_SHEET = "dev-gallery-side-sheet";
const DEV_GALLERY_SEARCH_SHEET = "dev-gallery-search-sheet";

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

type SheetExample = {
    key: string;
    name: string;
    /** The FigCraft instance. */
    figId: number;
    /** From 1024px up; the phone is always a bottom sheet. */
    placement: SheetPlacement;
    header: SheetHeaderOptions;
    /** Sections, built with the sheet's id. */
    sections: (sheetId: string) => Html[];
    actions?: SheetActionsOptions;
    /** Today's builder for the slot contents, named in the caption. */
    today: string;
};

const FOOD_MACROS = [
    { label: "kcal", value: 248, dot: "calories" },
    { label: "Protein", value: 47, unit: "g", dot: "protein" },
    { label: "Carbs", value: 0, unit: "g", dot: "carbs" },
    { label: "Fat", value: 5, unit: "g", dot: "fat" },
] as const;

/** The design's Amount section: the stepper and the four macro tiles. */
const amountContent = (sheetId: string): Html =>
    raw(
        `${stepper({
            name: `${sheetId}_amount`,
            id: `${sheetId}-amount`,
            label: "Amount",
            value: 150,
            min: 0,
            unit: "g",
        })}${statTiles(FOOD_MACROS, { label: "Per portion" })}`,
    );

/** A stand-in for a component a later step builds (Field, Quick action). */
const slot = (text: string): Html =>
    raw(`<div class="fd-sheet-sample__slot">${text}</div>`);

const SHEET_EXAMPLES: SheetExample[] = [
    {
        key: "log-food",
        name: "Sheet · Log food",
        figId: 172872,
        placement: "dialog",
        header: {
            kind: "title",
            title: "Chicken breast, grilled",
            subtitle: "Generic · 165 kcal per 100 g",
        },
        sections: (id) => [
            sheetSection({ kind: "amount", content: amountContent(id) }),
        ],
        actions: {
            kind: "single",
            primary: { label: "Add to dinner" },
        },
        today: "stepper + statTiles",
    },
    {
        key: "edit",
        name: "Sheet · Edit",
        figId: 172926,
        placement: "side",
        header: { kind: "title", title: "Chicken thighs", subtitle: "Fridge" },
        sections: (id) => [
            sheetSection({
                kind: "fields",
                label: "Name",
                content: slot("Chicken thighs"),
            }),
            sheetSection({
                kind: "amount",
                label: "Amount",
                content: amountContent(id),
            }),
            sheetSection({
                kind: "choice",
                label: "Shared with",
                content: choiceGroup({
                    name: `${id}_shared`,
                    legend: "Shared with",
                    options: [
                        { value: "all", label: "All", selected: true },
                        { value: "me", label: "Just me" },
                        { value: "household", label: "Household" },
                    ],
                }),
            }),
        ],
        actions: { kind: "pair", primary: { label: "Save" } },
        today: "field and segmented are placeholders; stepper, statTiles, choiceGroup",
    },
    {
        key: "put-away",
        name: "Sheet · Put away",
        figId: 173069,
        placement: "dialog",
        header: { kind: "title", title: "Put away", subtitle: "4 items" },
        sections: () => [
            sheetSection({
                kind: "rows",
                content: listGroup({
                    style: "card",
                    rows: [
                        itemRow({
                            title: "Account",
                            lead: { kind: "icon", name: "cart" },
                            trailing: { kind: "chevron" },
                        }),
                        itemRow({
                            title: "Household & members",
                            value: "3",
                            lead: { kind: "icon", name: "cart" },
                            trailing: { kind: "chevron" },
                        }),
                        itemRow({
                            title: "Goals",
                            value: "Recomp",
                            lead: { kind: "icon", name: "cart" },
                            trailing: { kind: "chevron" },
                        }),
                    ],
                }),
            }),
        ],
        actions: { kind: "single", primary: { label: "Put away" } },
        today: "itemRow in a card listGroup",
    },
    {
        key: "confirm",
        name: "Sheet · Confirm",
        figId: 173358,
        placement: "dialog",
        header: { kind: "title", title: "Remove Milk?" },
        sections: () => [
            sheetSection({
                kind: "message",
                text: "Removes Milk from your usuals. Its products stay in the catalog.",
            }),
        ],
        actions: { kind: "destructive", danger: { label: "Remove" } },
        today: "the message of confirmSheet",
    },
    {
        key: "log-search",
        name: "Sheet · Log · search",
        figId: 175699,
        placement: "dialog",
        header: {
            kind: "search",
            title: "Log food",
            search: {
                name: "q",
                label: "Search foods, recipes, barcodes",
                placeholder: "Search foods, recipes, barcodes",
                scan: { label: "Scan a barcode" },
            },
        },
        sections: (id) => [
            sheetSection({
                kind: "chips",
                label: "Add to",
                content: choiceGroup({
                    name: `${id}_meal`,
                    legend: "Add to",
                    options: [
                        { value: "breakfast", label: "Breakfast" },
                        { value: "lunch", label: "Lunch" },
                        { value: "dinner", label: "Dinner", selected: true },
                        { value: "snacks", label: "Snacks" },
                    ],
                }),
            }),
            sheetSection({
                kind: "chips",
                label: "Recent",
                content: chipNav(
                    [
                        chipLink({
                            label: "Scrambled eggs",
                            count: 216,
                            href: "#",
                        }),
                        chipLink({
                            label: "Chicken rice bowl",
                            count: 852,
                            href: "#",
                        }),
                        chipLink({
                            label: "Greek yogurt",
                            count: 150,
                            href: "#",
                        }),
                    ],
                    { label: "Recent foods" },
                ),
            }),
            sheetSection({
                kind: "tiles",
                label: "Quick",
                content: raw(
                    [
                        ["scan", "Scan barcode"],
                        ["camera", "Photo of meal"],
                        ["bolt", "Quick calories"],
                        ["drop", "Water +250 ml"],
                    ]
                        .map(
                            ([name, label]) =>
                                `<span class="fd-sheet-sample__tile"><span class="fd-sheet-sample__tile-icon">${icon(name as "scan")}</span>${label}</span>`,
                        )
                        .join(""),
                ),
            }),
        ],
        today: "choiceGroup and chipLink; the search box and Quick tiles are the sheet's own and a placeholder",
    },
    {
        key: "log-results",
        name: "Sheet · Log · results",
        figId: 175907,
        placement: "dialog",
        header: {
            kind: "search",
            title: "Log food",
            search: {
                name: "q",
                label: "Search foods, recipes, barcodes",
                placeholder: "Search foods, recipes, barcodes",
                value: "chick",
                clear: { label: "Clear search" },
            },
        },
        sections: () => [
            sheetSection({
                kind: "chips",
                content: chipNav(
                    [
                        chipLink({ label: "All", href: "#", selected: true }),
                        chipLink({ label: "Foods", href: "#" }),
                        chipLink({ label: "Recipes", href: "#" }),
                        chipLink({ label: "My foods", href: "#" }),
                    ],
                    { label: "Filter results" },
                ),
            }),
            sheetSection({
                kind: "results",
                content: listGroup({
                    rows: [
                        itemRow({
                            title: "Chicken thighs",
                            subtitle:
                                "In your fridge · 0.5 lb · 209 / 100 g kcal",
                            macros: { protein: 26, carbs: 0, fat: 11 },
                            trailing: {
                                kind: "add",
                                label: "Add Chicken thighs",
                            },
                        }),
                        itemRow({
                            title: "Chicken breast, grilled",
                            subtitle: "Generic · 165 / 100 g kcal",
                            macros: { protein: 26, carbs: 0, fat: 11 },
                            trailing: {
                                kind: "add",
                                label: "Add Chicken breast, grilled",
                            },
                        }),
                        itemRow({
                            title: "Chicken caesar wrap",
                            subtitle: "Logged 3 times · 540 kcal",
                            macros: { protein: 26, carbs: 0, fat: 11 },
                            trailing: {
                                kind: "add",
                                label: "Add Chicken caesar wrap",
                            },
                        }),
                    ],
                }),
            }),
        ],
        actions: {
            kind: "link",
            link: { label: "Not here? Scan the barcode" },
        },
        today: "chipLink and itemRow (add)",
    },
    {
        key: "log-empty",
        name: "Sheet · Log · nothing found",
        figId: 176155,
        placement: "dialog",
        header: {
            kind: "search",
            title: "Log food",
            search: {
                name: "q",
                label: "Search foods, recipes, barcodes",
                placeholder: "Search foods, recipes, barcodes",
                value: "chiken",
                clear: { label: "Clear search" },
            },
        },
        sections: () => [
            sheetSection({
                kind: "empty",
                text: "Nothing called \u201cchiken\u201d",
            }),
        ],
        actions: { kind: "link", link: { label: "Scan the barcode" } },
        today: "the empty message of the log sheet",
    },
];

/** One example as an inert sample: the same parts as a live sheet, in the page. */
function sheetSample(example: SheetExample): string {
    const id = `sample-${example.key}`;
    const classes = [
        "fd-sheet-sample",
        `fd-sheet-sample--${example.placement}`,
        example.header.kind === "search" && "fd-sheet-sample--search",
    ]
        .filter(Boolean)
        .join(" ");
    const actions = example.actions
        ? `\n${sheetActions({ ...example.actions, sheetId: id })}`
        : "";
    return `<div>${caption(`${example.name} ${example.figId} · phone: bottom; 1024px up: ${example.placement} · today: ${example.today}`)}<div class="${classes}" inert><div class="fd-sheet-panel">${sheetHeader({ ...example.header, sheetId: id })}<div class="fd-sheet-body">${example.sections(id).join("\n")}</div>${actions}</div></div></div>`;
}

/** A live sheet from the same parts, opened from a trigger. */
function liveSheet(id: string, example: SheetExample): string {
    return sheet({
        id,
        placement: example.placement,
        header: example.header,
        body: raw(example.sections(id).join("\n")),
        actions: example.actions,
    });
}

function sheetPartsSection(): string {
    const byKey = (key: string) =>
        SHEET_EXAMPLES.find((e) => e.key === key) as SheetExample;
    const live = [
        {
            id: DEV_GALLERY_DIALOG_SHEET,
            example: byKey("log-food"),
            label: "Open Log food (dialog)",
        },
        {
            id: DEV_GALLERY_SIDE_SHEET,
            example: byKey("edit"),
            label: "Open Edit (side)",
        },
        {
            id: DEV_GALLERY_SEARCH_SHEET,
            example: byKey("log-search"),
            label: "Open Log search (dialog)",
        },
    ];
    const triggers = live
        .map((l) =>
            sheetTrigger({
                target: l.id,
                label: l.label,
                className: "fd-btn",
            }),
        )
        .join("");
    return block(
        "Sheet · header, section and actions",
        "Sheet 591786 with Sheet header 175498, Sheet section 172791 and Sheet actions 172816: the seven examples (172872 … 176155) as inert samples, then live sheets to open. The phone is always a bottom sheet; from 1024px a quick task is a dialog and an edit a side panel.",
        `<div class="fd-gallery-row">${triggers}</div>${live.map((l) => liveSheet(l.id, l.example)).join("")}<div class="fd-sheet-samples">${SHEET_EXAMPLES.map(sheetSample).join("")}</div>`,
    );
}

function buttonSection(): string {
    const row = (...items: string[]) =>
        `<div class="fd-gallery-row">${items.join("")}</div>`;
    const kinds = [
        ["secondary", "Cancel"],
        ["primary", "Save"],
        ["danger", "Delete"],
        ["link", "Save"],
    ] as const;
    const large = kinds.map(([variant, label]) => button({ label, variant }));
    const largeIcon = kinds.map(([variant, label]) =>
        button({ label, variant, icon: "plus" }),
    );
    const small = kinds.map(([variant, label]) =>
        button({ label, variant, size: "md" }),
    );
    const smallIcon = kinds.map(([variant, label]) =>
        button({ label, variant, size: "md", icon: "plus" }),
    );
    const disabled = kinds.map(([variant, label]) =>
        button({ label, variant, disabled: true }),
    );
    return block(
        "Button",
        "Button 171966 (Kind × Size), Icon button 171939, Go button 69115, Filter button 69111. Large 48, Small 40, Go 32.",
        `<p class="fd-gallery-note">Large</p>${row(...large)}${row(...largeIcon)}` +
            `<p class="fd-gallery-note">Small</p>${row(...small)}${row(...smallIcon)}` +
            `<p class="fd-gallery-note">Icon button (40), primary and danger rounds</p>${row(
                button({
                    label: "Back",
                    icon: "chevron-left",
                    round: true,
                    size: "md",
                }),
                button({
                    label: "More",
                    icon: "more",
                    round: true,
                    size: "md",
                }),
                button({
                    label: "Add",
                    icon: "plus",
                    round: true,
                    variant: "primary",
                    size: "md",
                }),
                button({
                    label: "Delete",
                    icon: "trash",
                    round: true,
                    variant: "danger",
                    size: "md",
                }),
            )}` +
            `<p class="fd-gallery-note">Go button (32), Filter button (24) without and with a count</p>${row(
                button({ label: "Search", variant: "go" }),
                filterButton({ label: "Filter" }),
                `<span style="display:inline-flex;width:24px;height:24px"></span>`,
                filterButton({ label: "Filter, 2 on", count: 2 }),
            )}` +
            `<p class="fd-gallery-note">Links and submit buttons render the same markup</p>${row(
                button({ label: "Open", variant: "primary", href: "#" }),
                button({ label: "Open", href: "#", size: "md" }),
                button({ label: "Save", variant: "primary", type: "submit" }),
            )}` +
            `<p class="fd-gallery-note">Disabled</p>${row(...disabled)}` +
            row(
                button({
                    label: "More",
                    icon: "more",
                    round: true,
                    disabled: true,
                }),
                button({ label: "Search", variant: "go", disabled: true }),
                button({ label: "Open", href: "#", disabled: true }),
            ),
    );
}

function iconsSection(): string {
    const cells = ICON_NAMES.map(
        (name) =>
            `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:84px;color:var(--text-primary)">${icon(name)}<span class="fd-gallery-note" style="margin:0">${name}</span></div>`,
    ).join("");
    return block(
        "Icons",
        "The 40 design Icon/* components at their 24 frame",
        `<div class="fd-gallery-row" style="gap:12px 0">${cells}</div>`,
    );
}

/** The design's nine `Item row` examples, with its example data. */
const ITEM_ROW_EXAMPLES: {
    name: string;
    id: number;
    today: string;
    row: ItemRowOptions;
}[] = [
    {
        name: "Fridge",
        id: 171600,
        today: "fridgeRow: title, qty, date, menu",
        row: {
            title: "Eggs",
            meta: "9",
            score: 74,
            value: "Nov 19",
            trailing: { kind: "more", label: "More for Eggs" },
        },
    },
    {
        name: "Grocery",
        id: 171634,
        today: "groceryRow: check circle, title, subtitle with the usual tag, amount",
        row: {
            title: "Kirkland 2% milk",
            subtitle: "Milk · usual",
            value: "1 gal",
            lead: { kind: "checkbox", label: "Kirkland 2% milk" },
        },
    },
    {
        name: "Usual",
        id: 171668,
        today: "usualRow: title, meta, the parts joined by dots, chevron",
        row: {
            title: "Milk",
            meta: "Kirkland 2% milk",
            subtitle: "Costco · 1 gal · Every week",
            trailing: { kind: "chevron" },
        },
    },
    {
        name: "Ingredient",
        id: 171702,
        today: "partRow: status dot, label, value",
        row: {
            title: "Salmon fillet",
            subtitle: "Fridge · expires tomorrow",
            value: "1 lb",
            lead: { kind: "dot" },
            trailing: { kind: "more", label: "More for Salmon fillet" },
        },
    },
    {
        name: "Log result",
        id: 171736,
        today: "searchResultRow: title, score, subtitle, macros, add",
        row: {
            title: "Chicken thighs",
            subtitle: "In your fridge · 209 / 100 g kcal",
            macros: MACRO(26, 0, 11),
            trailing: { kind: "add", label: "Add Chicken thighs" },
        },
    },
    {
        name: "Recipe",
        id: 171770,
        today: "no row yet: recipe cards are their own markup",
        row: {
            title: "Chicken rice bowl",
            subtitle: "4 servings · 35 min",
            macros: MACRO(26, 0, 11),
            trailing: { kind: "more", label: "More for Chicken rice bowl" },
        },
    },
    {
        name: "Member",
        id: 171804,
        today: "manageRow with a member avatar, chevron",
        row: {
            title: "Sam",
            meta: "Member",
            lead: { kind: "avatar", initials: "S" },
            trailing: { kind: "chevron" },
        },
    },
    {
        name: "Notification",
        id: 171838,
        today: "attention rows: title, subtitle, menu",
        row: {
            title: "Greek yogurt expires tomorrow",
            subtitle: "Fridge · Household",
            trailing: { kind: "more", label: "More for Greek yogurt" },
        },
    },
    {
        name: "Setting",
        id: 171872,
        today: "settings rows: icon, title, subtitle, switch (a Segmented in the control slot is a later component)",
        row: {
            title: "Show cards in chat",
            subtitle: "Goals and meals as widgets",
            lead: { kind: "icon", name: "cart" },
            trailing: {
                kind: "toggle",
                on: true,
                label: "Show cards in chat",
            },
        },
    },
];

function caption(text: string): string {
    return `<p class="fd-gallery-note" style="margin:var(--space-md) 0 0">${text}</p>`;
}

function itemRowExamplesSection(): string {
    return block(
        "Item row · the nine examples",
        "Item row 171566 with the design's example data (171600 … 171872). Each caption names today's builder for the same slots.",
        ITEM_ROW_EXAMPLES.map(
            (ex) =>
                `${caption(`${ex.name} ${ex.id} · today: ${ex.today}`)}${listGroup({ rows: [itemRow(ex.row)] })}`,
        ).join(""),
    );
}

function itemRowOptionsSection(): string {
    const group = (note: string, rows: ItemRowOptions[]) =>
        `${caption(note)}${listGroup({ rows: rows.map(itemRow) })}`;
    // The same rows twice: the box is in the markup, shown once the list root
    // carries `data-fd-selecting` (select-mode.js sets it on Select).
    const selectRows: ItemRowOptions[] = [
        {
            title: "Eggs",
            value: "9",
            select: { name: "ids[]", value: "1" },
        },
        {
            title: "Milk",
            value: "1 gal",
            href: "/gallery",
            trailing: { kind: "chevron" },
            select: { name: "ids[]", value: "2" },
        },
        {
            title: "Butter",
            value: "1 stick",
            select: { name: "ids[]", value: "3" },
            swipe: {
                left: { form: { action: "/gallery/delete" } },
                right: { form: { action: "/gallery/again" } },
            },
        },
        {
            title: "Cheese",
            subtitle: "Not available",
            state: "disabled",
            select: { name: "ids[]", value: "4" },
        },
    ];
    const selectLists = () => [
        group("Select mode, idle: no box yet", selectRows),
        `${caption("Select mode, selecting: [data-fd-selecting] on the list")}<div data-fd-selecting>${listGroup({ rows: selectRows.map((r, i) => itemRow(i === 0 && typeof r.select === "object" ? { ...r, select: { ...r.select, checked: true } } : r)) })}</div>`,
    ];
    return block(
        "Item row · options",
        "Leads, extras, trailing, states and select mode.",
        [
            group("Leads: checkbox off and on, avatar, icon, dot", [
                {
                    title: "Checkbox off",
                    lead: { kind: "checkbox", label: "Checkbox off" },
                },
                {
                    title: "Checkbox on",
                    lead: {
                        kind: "checkbox",
                        label: "Checkbox on",
                        checked: true,
                    },
                },
                {
                    title: "Avatar",
                    lead: { kind: "avatar", initials: "EF" },
                },
                { title: "Icon", lead: { kind: "icon", name: "cart" } },
                { title: "Dot", lead: { kind: "dot" } },
                { title: "Dot warn", lead: { kind: "dot", color: "warn" } },
            ]),
            group(
                "Extras: score and macros, with a long title that ends in …",
                [
                    {
                        title: "Chicken thighs, bone-in, skin-on, family pack",
                        meta: "0.5 lb",
                        score: 74,
                        subtitle: "In your fridge · 209 / 100 g kcal",
                        macros: MACRO(26, 0, 11),
                        value: "209",
                    },
                    { title: "Poor score", score: 23, macros: MACRO(5, 12, 2) },
                ],
            ),
            group(
                "Trailing: value, chevron, more, add, toggle on and off, control slot",
                [
                    { title: "Value", value: "Nov 10" },
                    { title: "Chevron", trailing: { kind: "chevron" } },
                    {
                        title: "More",
                        trailing: { kind: "more", label: "More for More" },
                    },
                    {
                        title: "Add",
                        trailing: { kind: "add", label: "Add" },
                    },
                    {
                        title: "Toggle on",
                        trailing: { kind: "toggle", on: true, label: "On" },
                    },
                    {
                        title: "Toggle off",
                        trailing: { kind: "toggle", on: false, label: "Off" },
                    },
                    {
                        title: "Control",
                        trailing: {
                            kind: "control",
                            html: stepper({
                                name: "gallery-qty",
                                label: "Quantity",
                                value: 2,
                            }),
                        },
                    },
                ],
            ),
            group(
                "States: disabled (greyed, still there) and warning (in words)",
                [
                    {
                        title: "Disabled",
                        subtitle: "Not available on this plan",
                        state: "disabled",
                        lead: { kind: "checkbox", label: "Disabled" },
                        trailing: {
                            kind: "toggle",
                            on: false,
                            label: "Disabled",
                        },
                    },
                    {
                        title: "Eggs",
                        subtitle: "low now",
                        state: "warning",
                        value: "2 left",
                    },
                ],
            ),
            ...selectLists(),
        ].join(""),
    );
}

function itemRowSwipeSection(): string {
    const swipe = (open?: "left" | "right"): ItemRowOptions => ({
        title: "Scrambled eggs",
        meta: "3 large",
        macros: MACRO(19, 2, 15),
        value: "216",
        swipe: {
            left: { form: { action: "/meals/1/delete" } },
            right: { form: { action: "/meals/1/again" } },
            open,
        },
    });
    return block(
        "Item row · swipe",
        "Swipe row 383521. Phone only: left deletes (red bed, trash), right repeats (green bed, repeat). Closed, swiped right, swiped left.",
        [undefined, "right" as const, "left" as const]
            .map((open) => listGroup({ rows: [itemRow(swipe(open))] }))
            .join(""),
    );
}

function listGroupSection(): string {
    const rows = [
        itemRow({ title: "Chicken thighs", value: "0.5 lb" }),
        itemRow({ title: "Cheddar", value: "200 g" }),
        itemRow({ title: "Milk 2%", value: "½ gal" }),
    ];
    return block(
        "List group",
        "List group 227951: Flat (the default, on the page) and Card (one standout list on a panel).",
        `${caption("Flat")}${listGroup({ rows })}${caption("Card")}${listGroup({ style: "card", rows })}`,
    );
}

function sectionHeaderSection(): string {
    return block(
        "Section header",
        "Section header 177885: label in caps, count, trailing action, Rule On and Off.",
        [
            sectionHeaderV2({ label: "Fridge", count: 5 }),
            sectionHeaderV2({
                label: "Fridge",
                count: 5,
                action: { label: "See all", href: "#" },
            }),
            sectionHeaderV2({ label: "Fridge", count: 5, rule: false }),
            sectionHeaderV2({
                label: "Fridge",
                rule: false,
                action: { label: "See all", href: "#" },
            }),
            sectionHeaderV2({ label: "Fridge" }),
        ].join(""),
    );
}

function devGalleryBody(): string {
    const sections = [
        ...SECTIONS.map((s) => s.render()),
        dotsSection(),
        sheetsSection(),
        sheetPartsSection(),
        buttonSection(),
        itemRowExamplesSection(),
        itemRowOptionsSection(),
        itemRowSwipeSection(),
        listGroupSection(),
        sectionHeaderSection(),
        iconsSection(),
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
