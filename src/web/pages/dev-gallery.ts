import type { AppChromeBase } from "../attention.js";
import { pageHeader } from "../components/ui.js";
import { renderAppShell } from "../shell.js";
import { bell } from "../components/v2/bell.js";
import { button, filterButton } from "../components/v2/button.js";
import { chip, chipGroup } from "../components/v2/chip.js";
import { detailBar } from "../components/v2/detail-bar.js";
import { field } from "../components/v2/field.js";
import { navBar, type NavBarActive } from "../components/v2/nav-bar.js";
import { pageHeader as pageHeaderV2 } from "../components/v2/page-header.js";
import { searchField } from "../components/v2/search-field.js";
import { segment, segmented } from "../components/v2/segmented.js";
import { tab, tabs } from "../components/v2/tabs.js";
import { toggle } from "../components/v2/toggle.js";
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
import { menu, type MenuItem } from "../components/v2/menu.js";
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
import { avatarInitials } from "../components/v2/avatar-initials.js";
import { brandHero } from "../components/v2/brand-hero.js";
import { calorieGauge } from "../components/v2/calorie-gauge.js";
import { card } from "../components/v2/card.js";
import { emptyState } from "../components/v2/empty-state.js";
import { macroBar } from "../components/v2/macro-bar.js";
import { macroTile, macroTiles } from "../components/v2/macro-tile.js";
import { miniCard } from "../components/v2/mini-card.js";
import { nutrientLine } from "../components/v2/nutrient-line.js";
import { profileCard } from "../components/v2/profile-card.js";
import { quickAction } from "../components/v2/quick-action.js";
import { scoreCard } from "../components/v2/score-card.js";
import { scorePill } from "../components/v2/score-badge-pill.js";
import { statCard } from "../components/v2/stat-tiles-card.js";
import { stepperControl } from "../components/v2/stepper-control.js";
import { tableRow, tableRows } from "../components/v2/table-row.js";
import { weekDay, weekStrip } from "../components/v2/week-strip.js";
import { stepper } from "../components/v2/stepper.js";
import {
    deltaStat,
    statStrip,
    statTiles,
} from "../components/v2/stat-tiles.js";

const DEV_GALLERY_EDIT_SHEET = "dev-gallery-edit-sheet";
// Live sheets from parts: the trigger of each is on the gallery, for check:nav.
const DEV_GALLERY_DIALOG_SHEET = "dev-gallery-dialog-sheet";
const DEV_GALLERY_MENU_SHEET = "dev-gallery-menu-sheet";
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

/** A menu drawn open, as in the design frames; its script still closes it on Escape or a tap outside. */
function drawnOpen(html: Html): string {
    return String(html)
        .replace('aria-expanded="false"', 'aria-expanded="true"')
        .replace(" hidden>", ">");
}

/** Room under the trigger for the panel, which sits out of flow. */
function menuStage(html: string, height: number): string {
    return `<div style="display:flex;align-items:flex-start;justify-content:flex-end;min-height:${height}px;max-width:300px">${html}</div>`;
}

function menuSection(): string {
    const link = (label: string): MenuItem => ({
        kind: "link",
        label,
        href: "#",
    });
    const member = [
        link("Open"),
        link("Snooze until tomorrow"),
        link("Snooze 1 week"),
        link("Dismiss"),
        link("Turn off \u201cFood expiring\u201d"),
    ];
    const admin = [
        link("Open"),
        link("Snooze until tomorrow"),
        link("Snooze 1 week"),
        link("Dismiss for me"),
        link("Dismiss for everyone"),
        link("Turn off \u201cFood expiring\u201d"),
    ];
    const filters: MenuItem[] = [
        { kind: "checked", label: "Cookable now", checked: true },
        { kind: "checked", label: "High protein", checked: true },
        { kind: "checked", label: "Under 30 min", checked: false },
        { kind: "checked", label: "Favourites", checked: false },
        link("Clear"),
    ];
    const stock: MenuItem[] = [
        link("Edit amount or expiry"),
        link("Add to grocery list"),
        link("Eat"),
        { kind: "separator" },
        {
            kind: "destructive",
            label: "Discard",
            confirmLabel: "Discard 3",
            action: "/dev/gallery-v2",
        },
    ];
    const more = (label: string, items: MenuItem[]) =>
        menu({ label, anchor: "more", items });
    return block(
        "Menu",
        "Menu 172271 and Menu item 172270 (default, checked, destructive, divider). A menu is anchored to a visible control: the \u22ef Icon button or the Filter button. Drawn open from Notifications \u00b7 \u22ef menu 387797 (member) and 387895 (admin), and Recipes \u00b7 filter pull-down 402075. A destructive item confirms in place: it turns into Cancel and the same verb.",
        [
            caption("Notifications \u00b7 \u22ef menu \u00b7 member (387797)"),
            menuStage(drawnOpen(more("More for this notice", member)), 270),
            caption("Notifications \u00b7 \u22ef menu \u00b7 admin (387895)"),
            menuStage(drawnOpen(more("More for this notice", admin)), 310),
            caption(
                "Recipes \u00b7 filter pull-down (402075): Filter button, ticks, no filter name",
            ),
            menuStage(
                drawnOpen(
                    menu({
                        label: "Filter recipes",
                        anchor: "filter",
                        filterCount: 2,
                        items: filters,
                    }),
                ),
                270,
            ),
            caption(
                "Destructive item, closed and live: tap Discard to see Cancel and Discard 3 in its place",
            ),
            menuStage(
                String(
                    menu({
                        label: "Actions for Milk",
                        anchor: "more",
                        items: stock,
                        data: { gallery: "menu-more" },
                    }),
                ),
                230,
            ),
            caption(
                "Trigger near the left edge, closed and live: the panel stays inside the screen on a phone",
            ),
            `<div style="display:flex;padding-left:170px;min-height:230px">${menu(
                {
                    label: "Actions for Eggs",
                    anchor: "more",
                    items: stock,
                    data: { gallery: "menu-near-left" },
                },
            )}</div>`,
            caption(
                "Menu inside a live sheet: Escape closes the menu first, a second Escape closes the sheet",
            ),
            sheetTrigger({
                target: DEV_GALLERY_MENU_SHEET,
                label: "Open sheet with a menu",
                className: "fd-btn",
            }),
            sheet({
                id: DEV_GALLERY_MENU_SHEET,
                kind: "edit",
                title: "Menu in a sheet",
                body: menuStage(
                    String(
                        menu({
                            label: "Actions for Oats",
                            anchor: "more",
                            items: [
                                link("Edit amount or expiry"),
                                {
                                    kind: "destructive",
                                    label: "Discard",
                                    confirmLabel: "Discard 3",
                                    action: "/dev/gallery-v2",
                                    fields: { ids: "a,b,c" },
                                },
                            ],
                            data: { gallery: "menu-in-sheet" },
                        }),
                    ),
                    200,
                ),
                actions:
                    '<button type="button" class="fd-btn" command="close" commandfor="' +
                    DEV_GALLERY_MENU_SHEET +
                    '">Close</button>',
            }),
            caption(
                "Filter pull-down, closed and live: ticks toggle, the menu stays open",
            ),
            menuStage(
                String(
                    menu({
                        label: "Filter recipes",
                        anchor: "filter",
                        filterCount: 1,
                        items: filters,
                        data: { gallery: "menu-filter" },
                    }),
                ),
                270,
            ),
        ].join(""),
    );
}

/** A caption, then the component on a panel-width stage. */
function stage(note: string, html: string | Html, narrow = true): string {
    return `${caption(note)}<div class="fd-gallery-row" style="display:block;${narrow ? "max-width:390px;" : ""}margin-top:var(--space-sm)">${html}</div>`;
}

function headerBarsSection(): string {
    const avatar = { initials: "EF", label: "Ethan F" };
    return block(
        "Page header · Detail bar · Bell",
        "Page header 171972 (title 28/34), Detail bar 171983, Bell 69107. The bell shows a green dot when something is new, never a number.",
        [
            stage(
                "Page header: title, subtitle, bell with a dot, avatar",
                pageHeaderV2({
                    title: "Kitchen",
                    subtitle: "24 items",
                    bell: { unread: true },
                    avatar,
                }),
            ),
            stage(
                "Page header: title only; bell without a dot",
                pageHeaderV2({ title: "Recipes", bell: {}, avatar }),
            ),
            stage(
                "Page header: Actions slot",
                pageHeaderV2({
                    title: "Groceries",
                    subtitle: "8 lines",
                    actions: button({
                        label: "Add",
                        icon: "plus",
                        round: true,
                        size: "md",
                    }),
                    bell: {},
                    avatar,
                }),
            ),
            stage(
                "Detail bar: back, centred title, trailing more",
                detailBar({
                    title: "Settings",
                    back: { href: "#" },
                    trailing: { label: "More" },
                }),
            ),
            stage(
                "Detail bar: balance keeps the title centred",
                detailBar({
                    title: "Add a usual",
                    back: { label: "Close" },
                    balance: true,
                }),
            ),
            caption("Bell: no dot, a dot (a link and a button)"),
            `<div class="fd-gallery-row" style="margin-top:var(--space-sm)">${bell({})}${bell({ unread: true })}${bell({ unread: true, href: "#" })}</div>`,
        ].join(""),
    );
}

function tabsSection(): string {
    const kitchen = [
        { label: "Fridge", href: "#", active: true },
        { label: "Groceries", href: "#", count: 8 },
        { label: "Usuals", href: "#" },
    ];
    return block(
        "Tab · Tabs",
        "Tab 172205 (Active On, Off), Tabs 172206 with its trailing slot. The classes are fd-tab-row*: .fd-tab and .fd-tabs are the phone nav.",
        [
            stage(
                "Tab: Active On, Active Off",
                `<div class="fd-gallery-row">${tab({ label: "Fridge", href: "#", active: true })}${tab({ label: "Groceries", href: "#" })}</div>`,
            ),
            stage(
                "Tabs with a Filter button and an Add button",
                tabs({
                    label: "Kitchen",
                    tabs: kitchen,
                    trailing: raw(
                        `${filterButton({ label: "Filter", count: 2 })}${button({ label: "Add", icon: "plus", round: true, size: "md" })}`,
                    ),
                }),
            ),
            stage(
                "Tabs without the trailing slot",
                tabs({ label: "Kitchen", tabs: kitchen.slice(0, 2) }),
            ),
        ].join(""),
    );
}

function searchFieldSection(): string {
    const placeholder = "Search foods, recipes, barcodes";
    const base = { label: "Search", placeholder } as const;
    return block(
        "Search field",
        "Search field 172259: Boxed (48) and Line (41). Link detected is drawn from the option alone; nothing reads the text.",
        [
            stage(
                "Boxed with the barcode button (the default)",
                searchField({ ...base, barcode: true }),
            ),
            stage(
                "Boxed with the shortcut hint (desktop)",
                searchField({ ...base, shortcut: "⌘K" }),
            ),
            stage(
                "Boxed: a value with Clear",
                searchField({ ...base, value: "oat milk", clear: true }),
            ),
            stage(
                "Boxed: Filter with a count and Go",
                searchField({
                    ...base,
                    filter: { label: "Filter", count: 2 },
                    go: true,
                }),
            ),
            stage(
                "Boxed: link detected (link icon, Go)",
                searchField({
                    ...base,
                    value: "https://example.com/recipe",
                    linkDetected: true,
                }),
            ),
            stage(
                "Line with Filter (the default)",
                searchField({
                    ...base,
                    style: "line",
                    filter: { label: "Filter" },
                }),
            ),
            stage(
                "Line with Barcode and Clear",
                searchField({
                    ...base,
                    style: "line",
                    value: "eggs",
                    clear: true,
                    barcode: true,
                }),
            ),
        ].join(""),
    );
}

function chipsSection(): string {
    const meals = [
        { label: "Breakfast", value: "breakfast" },
        { label: "Lunch", value: "lunch" },
        { label: "Dinner", value: "dinner", selected: true },
        { label: "Snack", value: "snack" },
    ];
    return block(
        "Chip · Chip group",
        "Chip 172299 (On, Off, with a count). Classes fd-pill-chip*: .fd-chip is the live chip. Groups act by keyboard and click.",
        [
            stage(
                "Chip: Off, On, with counts, disabled",
                `<div class="fd-gallery-row">${chip({ label: "Lunch" })}${chip({ label: "Dinner", selected: true })}${chip({ label: "Dinner", count: 4 })}${chip({ label: "Dinner", count: 4, selected: true })}${chip({ label: "Snack", disabled: true })}</div>`,
            ),
            stage(
                "Single: exactly one is on (radio group; arrow keys select)",
                chipGroup({ label: "Meal", select: "single", chips: meals }),
            ),
            stage(
                "Multiple: any number (pressed toggles)",
                chipGroup({
                    label: "Meals",
                    select: "multiple",
                    chips: meals.map((m, i) => ({ ...m, selected: i < 2 })),
                }),
            ),
            stage(
                "Links: a filter that navigates",
                chipGroup({
                    label: "Filter foods",
                    select: "links",
                    chips: [
                        { label: "All", href: "#", count: 24, selected: true },
                        { label: "Fridge", href: "#", count: 12 },
                        { label: "Pantry", href: "#", count: 7 },
                    ],
                }),
            ),
        ].join(""),
    );
}

function segmentedSection(): string {
    const scope = (selected: number) =>
        ["All", "Just me", "Household"].map((label, i) => ({
            label,
            value: label.toLowerCase().replace(" ", "-"),
            selected: i === selected,
        }));
    return block(
        "Segment · Segmented",
        "Segment 172304 (Selected On, Off), Segmented 177891 (Regular 40, Small 32). A radio group: arrow keys select.",
        [
            stage(
                "Segment: Selected On, Off",
                `<div class="fd-gallery-row">${segment({ label: "All", selected: true })}${segment({ label: "Just me" })}</div>`,
            ),
            stage(
                "Regular, three segments",
                segmented({ label: "Whose", segments: scope(0) }),
            ),
            stage(
                "Regular, two segments, a named group",
                segmented({
                    label: "Unit",
                    name: "unit",
                    segments: [
                        { label: "g", value: "g", selected: true },
                        { label: "ml", value: "ml" },
                    ],
                }),
            ),
            stage(
                "Small, three segments",
                segmented({
                    label: "Whose",
                    size: "small",
                    segments: scope(1),
                }),
            ),
            stage(
                "Regular with a disabled segment",
                segmented({
                    label: "Whose",
                    segments: scope(0).map((s, i) => ({
                        ...s,
                        disabled: i === 2,
                    })),
                }),
            ),
        ].join(""),
    );
}

function toggleFieldSection(): string {
    return block(
        "Toggle · Field",
        "Toggle 172376 (On, Off; 46 x 28), Field 172366 (48, trailing icon). The label above and the hint or error below are added around the design's box.",
        [
            stage(
                "Toggle: Off, On, disabled Off, disabled On",
                `<div class="fd-gallery-row">${toggle({ label: "Off" })}${toggle({ label: "On", on: true })}${toggle({ label: "Disabled off", disabled: true })}${toggle({ label: "Disabled on", on: true, disabled: true })}</div>`,
            ),
            stage(
                "Field: the design's box",
                field({
                    id: "gallery-field-user",
                    label: "Email or username",
                    name: "user",
                    placeholder: "Email or username",
                }),
            ),
            stage(
                "Field: a value and a trailing icon",
                field({
                    id: "gallery-field-pass",
                    label: "Password",
                    name: "pass",
                    type: "password",
                    value: "correct horse",
                    trailingIcon: "eye",
                }),
            ),
            stage(
                "Field: hint",
                field({
                    id: "gallery-field-hint",
                    label: "Household name",
                    name: "household",
                    value: "Flow household",
                    hint: "Shown to everyone you invite.",
                }),
            ),
            stage(
                "Field: error",
                field({
                    id: "gallery-field-error",
                    label: "Email",
                    name: "email",
                    value: "ethan@",
                    error: "Enter a full email address.",
                }),
            ),
            stage(
                "Field: disabled",
                field({
                    id: "gallery-field-off",
                    label: "Household id",
                    name: "hid",
                    value: "h-4821",
                    disabled: true,
                }),
            ),
        ].join(""),
    );
}

function navBarSection(): string {
    const active: [NavBarActive, string][] = [
        ["today", "Active=Today"],
        ["kitchen", "Active=Kitchen"],
        ["recipes", "Active=Recipes"],
        ["trends", "Active=Trends"],
        ["none", "Active=None"],
    ];
    return block(
        "Nav bar",
        "Nav bar 294: today's .fd-tabs markup (phone). Shown in the page flow here; the live bar is fixed to the screen's foot. No notice dots.",
        active
            .map(([state, name]) =>
                stage(name, navBar({ active: state, inline: true }), false),
            )
            .join(""),
    );
}

function displayCardsSection(): string {
    return block(
        "Display & data · cards",
        "Card 381516, Mini card 172377, Stat tile 381522, Empty state 381519, Table row 381695, Score card 381529, Profile card 381535, with the design's example data.",
        [
            stage("Card", card({ children: raw("<span>Card content</span>") })),
            stage(
                "Mini card: Tomorrow, Salmon, 1 lb (over); warn without meta",
                `<div class="fd-gallery-row">${miniCard({ label: "Tomorrow", title: "Salmon", meta: "1 lb" })}${miniCard({ label: "In 3 days", title: "Yoghurt", tone: "warn" })}${miniCard({ label: "Next week", title: "Cheddar", meta: "200 g", tone: "muted", href: "#" })}</div>`,
            ),
            stage(
                "Stat tile: two to a row; a value with no data",
                `<div class="fd-gallery-row" style="flex-wrap:nowrap">${statCard({ value: "2,057", label: "Avg kcal" })}${statCard({ value: null, label: "Avg protein" })}</div>`,
            ),
            stage(
                "Empty state: title and body; with an action",
                `${emptyState({ title: "Nothing here yet", body: "Things you add show up here" })}${emptyState({ title: "No meals today", body: "Log your first meal.", action: button({ label: "Log food", variant: "primary" }) })}`,
            ),
            stage(
                "Table row: Header and Row, with an unknown cell",
                tableRows({
                    label: "Nutrition per serving",
                    rows: [
                        {
                            kind: "header",
                            label: "Calories",
                            cols: ["40", "133"],
                        },
                        { label: "Calories", cols: ["40", "133"] },
                        { label: "Fibre", cols: [null, "2 g"] },
                    ],
                }),
            ),
            stage(
                "Score card: good, middling, poor, no score",
                [
                    scoreCard({ score: 96, note: "Your weights: Balanced" }),
                    scoreCard({ score: 52, note: "Your weights: Balanced" }),
                    scoreCard({ score: 18, note: "Your weights: Balanced" }),
                    scoreCard({ score: null, note: "Not enough data" }),
                ]
                    .map(
                        (c) =>
                            `<div style="margin-bottom:var(--space-sm)">${c}</div>`,
                    )
                    .join(""),
            ),
            stage(
                "Profile card",
                profileCard({
                    name: "Ethan Flow",
                    email: "ethan@example.com",
                    fields: [
                        { key: "Household", value: "The Flow household" },
                        { key: "Members", value: "3" },
                        { key: "Role", value: "Owner" },
                    ],
                }),
            ),
        ].join(""),
    );
}

function macroBarRow(bars: Html[]): string {
    return `<div class="fd-gallery-row" style="flex-wrap:nowrap;align-items:flex-start">${bars
        .map((b) => `<div style="flex:1;min-width:0">${b}</div>`)
        .join("")}</div>`;
}

function displayNutritionSection(): string {
    const days = Array.from({ length: 7 }, (_, i) => ({
        weekday: "SMTWTFS"[i]!,
        day: i + 1,
        label: `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]} ${i + 1} November`,
        selected: i === 6,
        marked: true,
    }));
    return block(
        "Display & data · nutrition",
        "Macro tile 172344 and Macro tiles 172345, Macro bar 382028, Nutrient line 382047, Calorie gauge 381807, Week day 381765 and Week strip 381771.",
        [
            stage(
                "Macro tile: kcal, protein, carbs, fat; a tile with no data",
                macroTiles({
                    label: "Macros",
                    tiles: [
                        { kind: "kcal", value: "248" },
                        { kind: "protein", value: "47 g" },
                        { kind: "carbs", value: "0 g" },
                        { kind: "fat", value: null },
                    ],
                }),
            ),
            stage(
                "Macro bar: protein, carbs, fat at 96 / 210 g",
                macroBarRow([
                    macroBar({ kind: "protein", value: 96, target: 210 }),
                    macroBar({ kind: "carbs", value: 96, target: 210 }),
                    macroBar({ kind: "fat", value: 96, target: 210 }),
                ]),
            ),
            stage(
                "Macro bar: over the target; no data",
                macroBarRow([
                    macroBar({ kind: "fat", value: 240, target: 210 }),
                    macroBar({ kind: "carbs", value: null, target: 210 }),
                ]),
            ),
            stage(
                "Nutrient line: a link with a chevron; plain",
                `${nutrientLine({
                    href: "#",
                    items: [
                        { value: "1.6 / 3 L", dot: "water" },
                        { label: "Fiber", value: "18 g" },
                        { label: "Sugar", value: "31 g" },
                        { label: "Caffeine", value: "180 mg" },
                    ],
                })}${nutrientLine({
                    items: [
                        { value: "0.4 / 3 L", dot: "water" },
                        { label: "Fiber", value: null },
                    ],
                })}`,
            ),
            stage(
                "Calorie gauge: 1,284 of 2,421 kcal; over; no goal",
                `<div class="fd-gallery-row" style="gap:var(--space-xl)">${calorieGauge({ consumed: 1284, target: 2421, protein: 384, carbs: 513, fat: 387 })}${calorieGauge({ consumed: 2600, target: 2421, protein: 500, carbs: 1100, fat: 1000 })}${calorieGauge({ consumed: 600, target: null })}</div>`,
            ),
            stage(
                "Week day: Default, Selected, marked and unmarked",
                `<div class="fd-gallery-row" style="gap:0">${weekDay({ weekday: "S", day: 1, label: "Sunday 1 November", marked: true })}${weekDay({ weekday: "S", day: 1, label: "Sunday 1 November", marked: true, selected: true })}${weekDay({ weekday: "M", day: 2, label: "Monday 2 November" })}</div>`,
            ),
            stage(
                "Week strip: previous, seven days, next",
                weekStrip({
                    label: "Week",
                    days,
                    previous: { label: "Previous week", href: "#" },
                    next: { label: "Next week", href: "#" },
                }),
            ),
        ].join(""),
    );
}

function displayControlsSection(): string {
    return block(
        "Display & data · stepper, avatar, badge, action, hero",
        "Stepper 172312 (the live stepper script drives it), Avatar 171937, Score badge 171563, Quick action 303014, Brand hero 383401.",
        [
            stage(
                "Stepper: 150 g; at its minimum",
                `${stepperControl({ name: "g-amount", label: "Amount", value: 150, unit: "g", step: 5, min: 0, max: 2000 })}${stepperControl({ name: "g-min", label: "Servings", value: 0, min: 0, unit: "servings" })}`,
            ),
            stage(
                "Avatar (initials), with and without a name",
                `<div class="fd-gallery-row">${avatarInitials({ name: "Ethan Flow", label: "Ethan Flow" })}${avatarInitials({ initials: "MK" })}</div>`,
            ),
            stage(
                "Score badge: good, middling, poor",
                `<div class="fd-gallery-row">${scorePill(74)}${scorePill(52)}${scorePill(18)}</div>`,
            ),
            stage(
                "Quick action: with caption, without, disabled",
                `<div class="fd-gallery-row" style="align-items:flex-start;gap:var(--space-lg)">${quickAction({ label: "Scan barcode", icon: "scan" })}${quickAction({ label: "Scan barcode", icon: "scan", caption: false })}${quickAction({ label: "Search", icon: "search", disabled: true })}</div>`,
            ),
            stage(
                "Brand hero",
                brandHero({
                    title: "Foodable",
                    tagline: "Your household's kitchen, in one place.",
                }),
            ),
        ].join(""),
    );
}

function devGalleryBody(): string {
    const sections = [
        ...SECTIONS.map((s) => s.render()),
        dotsSection(),
        sheetsSection(),
        sheetPartsSection(),
        menuSection(),
        buttonSection(),
        itemRowExamplesSection(),
        itemRowOptionsSection(),
        itemRowSwipeSection(),
        listGroupSection(),
        sectionHeaderSection(),
        headerBarsSection(),
        tabsSection(),
        searchFieldSection(),
        chipsSection(),
        segmentedSection(),
        toggleFieldSection(),
        navBarSection(),
        displayCardsSection(),
        displayNutritionSection(),
        displayControlsSection(),
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
