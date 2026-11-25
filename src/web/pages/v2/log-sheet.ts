import {
    formatLocalDateTime,
    guessMealType,
    weekdayInTz,
} from "../../../domain/tz.js";
import { fromGrams, type WeightUnit } from "../../../domain/units.js";
import { unitHintsForLog } from "../../../domain/log-search.js";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
    macrosForLogItem,
    portionLabel,
    type LogBasis,
    type LogServing,
} from "../../../domain/log-macro-format.js";
import { button } from "../../components/v2/button.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { macroTiles } from "../../components/v2/macro-tile.js";
import { quickAction } from "../../components/v2/quick-action.js";
import { segmented } from "../../components/v2/segmented.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepperControl } from "../../components/v2/stepper-control.js";
import {
    FD_BARCODE_SCAN_SHEET_ID,
    renderBarcodeScannerSheet,
} from "./scanner-sheet.js";

export const FD_LOG_SEARCH_SHEET_ID = "fd-log-search";
export const FD_LOG_AMOUNT_SHEET_ID = "fd-log-amount";
export const FD_LOG_QUICK_CAL_SHEET_ID = "fd-log-quick-cal";
export const FD_LOG_WEIGH_IN_SHEET_ID = "fd-log-weigh-in";
export const FD_LOG_POST = "/log";
export const FD_LOG_QUICK_POST = "/log/quick";
export const FD_LOG_WATER_POST = "/log/water";
export const FD_LOG_WEIGHT_POST = "/log/weight";
/** Where a recipe link pasted into the search field goes: Recipes' own import. */
export const FD_LOG_IMPORT_POST = "/recipes/import";

/** Whether `value` satisfies an `<input type="number">` with these constraints. */
export function isStepValid(
    value: number,
    min: number | undefined,
    step: number | "any",
): boolean {
    if (!Number.isFinite(value)) return false;
    if (min != null && value < min) return false;
    if (step === "any") return value > 0;
    const base = min ?? 0;
    const n = (value - base) / step;
    return Math.abs(n - Math.round(n)) < 1e-9;
}

const MEAL_TYPES = [
    { value: "breakfast", label: "Breakfast" },
    { value: "lunch", label: "Lunch" },
    { value: "dinner", label: "Dinner" },
    { value: "snack", label: "Snacks" },
] as const;

const MEAL_SUBMIT_LABEL: Record<string, string> = {
    breakfast: "Add to breakfast",
    lunch: "Add to lunch",
    dinner: "Add to dinner",
    snack: "Add to snacks",
};

export type LogAmountPrefill = {
    name: string;
    food_id?: string;
    recipe_id?: string;
    barcode?: string;
    amount?: number;
    unit?: string;
    unit_hints?: string[];
    meal_type?: string;
    logged_at?: string;
    kcal_per_100g?: number | null;
    protein_per_100g?: number | null;
    carbs_per_100g?: number | null;
    fat_per_100g?: number | null;
    grams_per_ml?: number | null;
    grams_per_each?: number | null;
    /** What the per-100 columns are per; null or missing is 100 g. */
    basis?: LogBasis | null;
    /** The pack serving: one portion of this food. */
    serving?: LogServing | null;
    brand?: string | null;
    source?: string | null;
};

export type QuickCaloriesPrefill = {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    description?: string;
    meal_type?: string;
    logged_at?: string;
};

export type WeighInPrefill = {
    weight?: number;
    unit?: WeightUnit;
    /** Unit for the “Last:” subtitle (viewer preference). */
    preferredUnit?: WeightUnit;
    logged_at?: string;
    lastWeightG?: number | null;
    lastLoggedAt?: string | null;
};

/**
 * The Quick grid's "Copy yesterday" tile: the slots whose yesterday meals can
 * be copied (empty today, filled yesterday: the Today prompt's own rule) and
 * the page to come back to. Only the member's own Today knows this, so every
 * other page renders no tile.
 */
export type CopyYesterdayOpts = {
    slots: readonly string[];
    returnTo: string;
};

export type RenderLogSheetsOpts = {
    timezone: string;
    copyYesterday?: CopyYesterdayOpts;
    /** Reopen the amount sheet after a validation error. */
    amountOpenOnLoad?: boolean;
    /** Reopen search (preview shots). */
    searchOpenOnLoad?: boolean;
    amount?: LogAmountPrefill;
    amountError?: string;
    searchError?: string;
    quickCaloriesOpenOnLoad?: boolean;
    quickCalories?: QuickCaloriesPrefill;
    quickCaloriesError?: string;
    weighInOpenOnLoad?: boolean;
    weighIn?: WeighInPrefill;
    weighInError?: string;
    /** Preview-only: static empty search sheet with recents. */
    previewSearch?: "empty" | "results";
    /** Preview-only: pre-filled search query (e.g. "chick"). */
    previewQuery?: string;
    /** Preview-only: the pasted-link state of the search field. */
    previewLink?: boolean;
    /**
     * Kill switch `barcode-camera`: when false, the sheet draws no Scan
     * barcode tile, no barcode button in the search field and no "Not here?
     * Scan the barcode" link.
     */
    barcodeCamera?: boolean;
    /** Lazy decoder chunk URLs for the scanner sheet. */
    scannerZxingHref?: string;
    scannerWasmHref?: string;
    /** Preview-only: static scanner sheet. */
    previewScanner?: boolean;
    scannerOpenOnLoad?: boolean;
};

export { FD_BARCODE_SCAN_SHEET_ID };

function datetimeLocalValue(raw: string): string {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(raw.trim());
    return m ? `${m[1]}T${m[2]}` : raw.trim().slice(0, 16);
}

function defaultLoggedAtLocal(tz: string): string {
    return datetimeLocalValue(formatLocalDateTime(new Date(), tz));
}

/** "Today 5:10 PM": the When chip that logs at submit time. */
function todayTimeLabel(tz: string): string {
    const raw = formatLocalDateTime(new Date(), tz);
    const time = raw.slice(11, 16);
    const h = Number(time.slice(0, 2));
    const m = time.slice(3, 5);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `Today ${h12}:${m} ${ap}`;
}

export function weighInLastSubtitle(
    lastWeightG: number | null | undefined,
    lastLoggedAt: string | null | undefined,
    unit: WeightUnit,
    tz: string,
): string | undefined {
    if (lastWeightG == null || !lastLoggedAt) return undefined;
    const text = fromGrams(lastWeightG, unit).toFixed(1);
    const day = weekdayInTz(lastLoggedAt, tz);
    return `Last: ${text} ${unit} · ${day}`;
}

/** The ADD TO chips: a radio group, the caps label is the section's. */
function mealChoice(name: string, selected: string): Html {
    return choiceGroup({
        name,
        legend: "Add to",
        options: MEAL_TYPES.map((t) => ({
            ...t,
            selected: t.value === selected,
        })),
        required: true,
    });
}

/** The WHEN chips: Today (logs at submit time) or Pick a time. */
function whenChoice(
    name: string,
    usePick: boolean,
    todayLabel: string,
    labelHook: string,
): Html {
    return choiceGroup({
        name,
        legend: "When",
        required: true,
        options: [
            {
                value: "now",
                label: todayLabel,
                selected: !usePick,
                labelData: { [labelHook]: "" },
            },
            { value: "pick", label: "Pick a time", selected: usePick },
        ],
    });
}

/**
 * The time box behind Pick a time. A disabled field is not submitted, so
 * "Today" logs at submit time; the script enables it with the second chip.
 */
function timeField(id: string, value: string, usePick: boolean): Html {
    const box = field({
        id,
        label: "Time",
        labelHidden: true,
        name: "logged_at",
        type: "datetime-local",
        value,
        required: true,
        disabled: !usePick,
    });
    return raw(
        `<div class="fd-log-time-pick" data-fd-log-time-pick${usePick ? "" : " hidden"}>${box}</div>`,
    );
}

function whenSection(
    mode: { name: string; hook: string },
    ids: { time: string },
    pick: { usePick: boolean; todayLabel: string; loggedAt: string },
): Html {
    return sheetSection({
        kind: "chips",
        label: "When",
        content: join([
            whenChoice(mode.name, pick.usePick, pick.todayLabel, mode.hook),
            timeField(ids.time, pick.loggedAt, pick.usePick),
        ]),
    });
}

function errorLine(message: string | undefined): string {
    return message
        ? `<p class="fd-log-error" role="alert">${esc(message)}</p>`
        : "";
}

const PREVIEW_RECENTS: Array<{
    name: string;
    kcal: number;
    payload: Record<string, unknown>;
}> = [
    {
        name: "Scrambled eggs",
        kcal: 216,
        payload: { name: "Scrambled eggs", food_id: "f-eggs", kcal: 216 },
    },
    {
        name: "Chicken rice bowl",
        kcal: 852,
        payload: {
            name: "Chicken rice bowl",
            recipe_id: "r-bowl",
            unit_hints: ["portion"],
            kcal: 852,
        },
    },
    {
        name: "Greek yogurt",
        kcal: 150,
        payload: { name: "Greek yogurt", food_id: "f-yogurt", kcal: 150 },
    },
    {
        name: "Protein shake",
        kcal: 180,
        payload: { name: "Protein shake", food_id: "f-shake", kcal: 180 },
    },
    {
        name: "Banana",
        kcal: 105,
        payload: { name: "Banana", food_id: "f-banana", kcal: 105 },
    },
];

/** The Recent chips: one button per recently logged food, its kcal as the count. */
function recentChips(items: typeof PREVIEW_RECENTS): string {
    return items
        .map(
            (r) =>
                `<button type="button" class="fd-chip" data-fd-log-pick="${esc(JSON.stringify(r.payload))}"><span class="fd-chip__label">${esc(r.name)}</span><span class="fd-chip__count">${r.kcal}</span></button>`,
        )
        .join("");
}

/** Where "Add to groceries" lands: the Groceries tab with its add sheet open. */
export const FD_GROCERY_ADD_HREF = "/kitchen/groceries?add=1";

function quickTiles(
    barcodeCamera: boolean,
    copy: CopyYesterdayOpts | undefined,
    selectedMeal: string,
): Html {
    const tiles: Html[] = [];
    if (barcodeCamera) {
        tiles.push(
            quickAction({
                label: "Scan barcode",
                icon: "scan",
                data: { "fd-open-sheet": FD_BARCODE_SCAN_SHEET_ID },
            }),
        );
    }
    tiles.push(
        quickAction({
            label: "Quick calories",
            icon: "bolt",
            data: { "fd-open-sheet": FD_LOG_QUICK_CAL_SHEET_ID },
        }),
        raw(
            `<form class="fd-log-quick-form" method="post" action="${FD_LOG_WATER_POST}"><input type="hidden" name="amount_ml" value="250"><input type="hidden" name="return_to" value="/">${quickAction({ label: "Water +250 ml", icon: "drop", submit: true })}</form>`,
        ),
        quickAction({
            label: "Weigh in",
            icon: "scale",
            data: { "fd-open-sheet": FD_LOG_WEIGH_IN_SHEET_ID },
        }),
        // Cook a recipe goes to the recipes, where each one has its Cook step;
        // Add to groceries opens the Groceries tab's add sheet (log-sheet.js
        // reads add=1).
        quickAction({ label: "Cook a recipe", icon: "pot", href: "/recipes" }),
    );
    // Posts to the route behind Today's "Same as yesterday?" prompt, so a
    // repeat is the same idempotent write. With no yesterday to copy in any
    // meal there is no tile (the design's "no yesterday"); disabled while the
    // chosen meal alone has nothing to copy; copy-yesterday.js re-points it
    // when the meal changes.
    if (copy && copy.slots.length > 0) {
        tiles.push(
            raw(
                `<form class="fd-log-quick-form" method="post" action="/log/copy-yesterday" data-fd-copy-yesterday data-fd-copy-yesterday-slots="${esc(copy.slots.join(" "))}"><input type="hidden" name="slot" value="${esc(selectedMeal)}"><input type="hidden" name="return_to" value="${esc(copy.returnTo)}">${quickAction({ label: "Copy yesterday", icon: "copy", submit: true, disabled: !copy.slots.includes(selectedMeal), data: { "fd-copy-yesterday-button": "" } })}</form>`,
            ),
        );
    }
    tiles.push(
        quickAction({
            label: "Add to groceries",
            icon: "cart",
            href: FD_GROCERY_ADD_HREF,
        }),
    );
    return join(tiles);
}

function logQuickCaloriesSheet(opts: RenderLogSheetsOpts): string {
    const tz = opts.timezone;
    const prefill = opts.quickCalories;
    const meal =
        prefill?.meal_type &&
        MEAL_TYPES.some((t) => t.value === prefill.meal_type)
            ? prefill.meal_type!
            : guessMealType(tz);
    const calories = prefill?.calories ?? 350;
    const description = prefill?.description ?? "Quick calories";
    const formId = `${FD_LOG_QUICK_CAL_SHEET_ID}-form`;
    const macro = (name: string, label: string, value: number | undefined) =>
        field({
            id: `${FD_LOG_QUICK_CAL_SHEET_ID}-${name}`,
            label,
            name,
            type: "number",
            value: value == null ? "" : String(value),
            min: 0,
            step: 0.1,
            inputmode: "decimal",
        });
    const body = `${errorLine(opts.quickCaloriesError)}<form id="${formId}" class="fd-log-form" method="post" action="${FD_LOG_QUICK_POST}">
<input type="hidden" name="return_to" value="/">
${sheetSection({
    kind: "amount",
    content: stepperControl({
        name: "calories",
        label: "Calories",
        value: calories,
        min: 1,
        step: 10,
        inputStep: "any",
        unit: "kcal",
        id: "fd-log-kcal",
    }),
})}
${sheetSection({
    kind: "fields",
    content: raw(
        `<div class="fd-log-macro-fields">${macro("protein_g", "Protein g", prefill?.protein_g)}${macro("carbs_g", "Carbs g", prefill?.carbs_g)}${macro("fat_g", "Fat g", prefill?.fat_g)}</div>`,
    ),
})}
${sheetSection({
    kind: "fields",
    content: field({
        id: "fd-log-quick-name",
        label: "Name",
        name: "description",
        value: description,
        autocomplete: "off",
    }),
})}
${sheetSection({ kind: "chips", label: "Add to", content: mealChoice("meal_type", meal) })}
</form>`;
    return sheet({
        id: FD_LOG_QUICK_CAL_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: "Quick calories" },
        body: raw(body),
        actions: {
            kind: "single",
            primary: {
                label: MEAL_SUBMIT_LABEL[meal] ?? "Log",
                type: "submit",
                form: formId,
                attrs: { "data-fd-quick-cal-submit": "" },
            },
        },
        openOnLoad: opts.quickCaloriesOpenOnLoad,
        className: "fd-log-quick-cal-sheet",
        focus: "panel",
    });
}

function logWeighInSheet(opts: RenderLogSheetsOpts): string {
    const tz = opts.timezone;
    const prefill = opts.weighIn ?? {};
    const unit = prefill.unit ?? "kg";
    const weight = prefill.weight ?? (unit === "lb" ? 165 : 75);
    const usePick = Boolean(prefill.logged_at);
    const loggedAt = prefill.logged_at
        ? datetimeLocalValue(prefill.logged_at)
        : defaultLoggedAtLocal(tz);
    const subtitle = weighInLastSubtitle(
        prefill.lastWeightG,
        prefill.lastLoggedAt,
        prefill.preferredUnit ?? unit,
        tz,
    );
    const formId = `${FD_LOG_WEIGH_IN_SHEET_ID}-form`;
    const body = `${errorLine(opts.weighInError)}<form id="${formId}" class="fd-log-form" method="post" action="${FD_LOG_WEIGHT_POST}">
<input type="hidden" name="return_to" value="/">
<input type="hidden" name="unit" value="${esc(unit)}">
${sheetSection({
    kind: "amount",
    content: stepperControl({
        name: "weight",
        label: "Weight",
        value: weight,
        min: 0,
        step: 0.1,
        inputStep: "any",
        unit,
        id: "fd-log-weight-value",
    }),
})}
${whenSection(
    { name: "fd_weigh_time_mode", hook: "fd-weigh-today-label" },
    { time: "fd-weigh-time" },
    { usePick, todayLabel: todayTimeLabel(tz), loggedAt },
)}
</form>`;
    return sheet({
        id: FD_LOG_WEIGH_IN_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: "Weigh in", subtitle },
        body: raw(body),
        actions: {
            kind: "single",
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: opts.weighInOpenOnLoad,
        className: "fd-log-weigh-in-sheet",
        focus: "panel",
    });
}

/** What one row of search results carries: where it opens and what + logs. */
type PreviewResult = {
    name: string;
    subtitle: string;
    score?: number;
    open?: string;
    pick: Record<string, unknown>;
};

const PREVIEW_RESULTS: PreviewResult[] = [
    {
        name: "Chicken thighs",
        subtitle: "In your fridge · 0.5 lb · 209 / 100 g kcal",
        open: "/kitchen/fridge?item=s1",
        pick: { name: "Chicken thighs", food_id: "f-thighs", kind: "stock" },
    },
    {
        name: "Chicken alfredo",
        subtitle: "Your recipe · 1 serving · 690 kcal",
        open: "/recipes/r-alfredo",
        pick: {
            name: "Chicken alfredo",
            recipe_id: "r-alfredo",
            unit_hints: ["portion"],
            kind: "recipe",
        },
    },
    {
        name: "Chicken breast, grilled",
        subtitle: "Generic · 165 / 100 g kcal",
        open: "/foods/f-chicken",
        pick: {
            name: "Chicken breast, grilled",
            food_id: "f-chicken",
            kcal_per_100g: 165,
            protein_per_100g: 31,
            carbs_per_100g: 0,
            fat_per_100g: 3.3,
            unit_hints: ["g"],
            kind: "food",
        },
    },
    {
        name: "Chicken noodle soup",
        subtitle: "Campbell's · 1 cup · 90 kcal",
        score: 41,
        open: "/foods/f-soup",
        pick: { name: "Chicken noodle soup", food_id: "f-soup", kind: "food" },
    },
    {
        name: "Chicken caesar wrap",
        subtitle: "Logged 3 times · 540 kcal",
        pick: {
            name: "Chicken caesar wrap",
            food_id: "f-wrap",
            kind: "history",
        },
    },
];

/**
 * One search result, as the design draws it: the face opens the thing (a link
 * with a chevron), the + beside it logs it. A result that only logs (a past
 * meal) has no chevron, and its face picks like its plus. `client/v2/log-sheet.js`
 * writes the same markup for live results.
 */
export function logResultRow(row: PreviewResult, index: number): Html {
    const pick = JSON.stringify(row.pick);
    const add = {
        kind: "add" as const,
        label: `Add ${row.name}`,
        data: { "fd-log-pick": pick },
    };
    return itemRow({
        title: row.name,
        score: row.score,
        subtitle: row.subtitle,
        id: `fd-log-result-${index}`,
        role: "option",
        data: { "fd-log-row-pick": pick },
        ...(row.open != null
            ? {
                  href: row.open,
                  trailing: { kind: "chevron" as const },
                  add,
              }
            : { trailing: add }),
    });
}

function resultsList(rows: Html[]): Html {
    return listGroup({
        rows,
        id: "fd-log-result-listbox",
        role: "listbox",
        label: "Search results",
        data: { "fd-log-result-list": "" },
    });
}

function logSearchSheet(opts: RenderLogSheetsOpts): string {
    const meal = guessMealType(opts.timezone);
    const preview = opts.previewSearch;
    const query = opts.previewQuery ?? (preview === "results" ? "chick" : "");
    const link = opts.previewLink === true;
    const showResults = preview === "results" && !link;
    const cameraOn = opts.barcodeCamera !== false;
    const recents = preview === "empty" ? recentChips(PREVIEW_RECENTS) : "";
    const hide = (hidden: boolean) => (hidden ? " hidden" : "");

    const importForm = `<form class="fd-log-import" method="post" action="${FD_LOG_IMPORT_POST}" data-fd-log-import data-busy-form hidden><input type="hidden" name="url" value=""></form>`;

    const filters = sectionBlock(
        "data-fd-log-filters",
        !showResults,
        sheetSection({
            kind: "chips",
            content: choiceGroup({
                name: "fd_log_filter",
                legend: "Filter results",
                options: ["All", "Foods", "Recipes", "My foods"].map(
                    (label, i) => ({
                        value: label,
                        label,
                        selected: i === 0,
                    }),
                ),
            }),
        }),
    );

    const scanLink = cameraOn
        ? button({
              variant: "link",
              size: "md",
              icon: "scan",
              label: "Not here? Scan the barcode",
              attrs: { "data-fd-open-sheet": FD_BARCODE_SCAN_SHEET_ID },
          })
        : "";
    const onlineButton = button({
        variant: "link",
        size: "md",
        icon: "search",
        label: "Search online",
        attrs: {
            "data-fd-log-online": "",
            ...(showResults ? {} : { hidden: "" }),
        },
    });
    const results = sectionBlock(
        "data-fd-log-results",
        !showResults,
        sheetSection({
            kind: "results",
            content: join([
                resultsList(
                    showResults
                        ? PREVIEW_RESULTS.map((r, i) => logResultRow(r, i))
                        : [],
                ),
                onlineButton,
                scanLink,
            ]),
        }),
    );

    const empty = sectionBlock(
        "data-fd-log-empty",
        showResults,
        join([
            sheetSection({
                kind: "chips",
                label: "Add to",
                content: mealChoice("search_meal_type", meal),
            }),
            raw(
                `<div class="fd-log-recent-section" data-fd-log-recent-section${hide(recents === "")}>${sheetSection(
                    {
                        kind: "chips",
                        label: "Recent",
                        content: raw(
                            `<div class="fd-chips" data-fd-log-recent>${recents}</div>`,
                        ),
                    },
                )}</div>`,
            ),
            sheetSection({
                kind: "tiles",
                label: "Quick",
                content: quickTiles(cameraOn, opts.copyYesterday, meal),
            }),
        ]),
    );

    const body = join([
        raw(errorLine(opts.searchError)),
        raw(importForm),
        filters,
        results,
        empty,
    ]);
    return sheet({
        id: FD_LOG_SEARCH_SHEET_ID,
        placement: "dialog",
        header: {
            kind: "search",
            title: "Search",
            search: {
                name: "q",
                id: "fd-log-search-q",
                label: "Search foods, recipes, and barcodes",
                placeholder: "Search foods, recipes, barcodes",
                value: query,
                clear: {
                    label: "Clear search",
                    attrs: {
                        "data-fd-log-search-clear": "",
                        ...(query ? {} : { hidden: "" }),
                    },
                },
                go: {
                    label: "Import recipe",
                    attrs: { "data-fd-log-import-go": "" },
                },
                scan: cameraOn
                    ? {
                          label: "Scan a barcode",
                          attrs: {
                              "data-fd-open-sheet": FD_BARCODE_SCAN_SHEET_ID,
                          },
                      }
                    : undefined,
            },
        },
        body,
        openOnLoad: opts.searchOpenOnLoad,
        className: `fd-log-search-sheet${link ? " fd-log-search-sheet--link" : ""}`,
        // Focus goes to the panel; log-sheet.js focuses the search field only
        // with a fine pointer, so a phone's keyboard waits for a tap.
        focus: "panel",
    });
}

/** A wrapper the search script shows and hides as a whole. */
function sectionBlock(hook: string, hidden: boolean, content: Html): Html {
    return raw(
        `<div class="fd-log-block" ${hook}${hidden ? " hidden" : ""}>${content}</div>`,
    );
}

function amountSubtitle(prefill: LogAmountPrefill | undefined): string {
    if (!prefill) return "";
    if (prefill.recipe_id) {
        const k = prefill.kcal_per_100g;
        return k != null
            ? `Your recipe · ${Math.round(k)} kcal per portion`
            : "Your recipe";
    }
    const brand = prefill.brand?.trim();
    const kcal = prefill.kcal_per_100g;
    const per = prefill.basis === "100ml" ? "100 ml" : "100 g";
    if (brand) {
        return kcal != null
            ? `${brand} · ${Math.round(kcal)} kcal per ${per}`
            : brand;
    }
    return kcal != null
        ? `Generic · ${Math.round(kcal)} kcal per ${per}`
        : "Generic";
}

type MacroFigures = {
    kcal?: number | null;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
} | null;

/** The four tiles for one amount; an unknown figure is a dash, never a zero. */
function macroTilesFor(m: MacroFigures): Html {
    const grams = (v: number | null | undefined) =>
        v == null || !Number.isFinite(Number(v))
            ? null
            : `${formatLogMacroGrams(v)} g`;
    return macroTiles({
        label: "This amount",
        tiles: [
            {
                kind: "kcal",
                value:
                    m?.kcal == null || !Number.isFinite(Number(m.kcal))
                        ? null
                        : formatLogMacroKcal(m.kcal),
            },
            { kind: "protein", value: grams(m?.protein_g) },
            { kind: "carbs", value: grams(m?.carbs_g) },
            { kind: "fat", value: grams(m?.fat_g) },
        ],
    });
}

function macroTilesForAmount(
    prefill: LogAmountPrefill | undefined,
    amount: number,
    unit: string,
): Html {
    const macroItem = prefill
        ? prefill.recipe_id
            ? {
                  recipe_id: prefill.recipe_id,
                  kcal: prefill.kcal_per_100g,
                  protein_g: prefill.protein_per_100g,
                  carbs_g: prefill.carbs_per_100g,
                  fat_g: prefill.fat_per_100g,
              }
            : {
                  kcal_per_100g: prefill.kcal_per_100g,
                  protein_per_100g: prefill.protein_per_100g,
                  carbs_per_100g: prefill.carbs_per_100g,
                  fat_per_100g: prefill.fat_per_100g,
                  grams_per_ml: prefill.grams_per_ml,
                  grams_per_each: prefill.grams_per_each,
                  basis: prefill.basis,
                  serving: prefill.serving,
              }
        : null;
    const m = macroItem ? macrosForLogItem(macroItem, amount, unit) : null;
    return macroTilesFor(m);
}

function amountHiddenFields(prefill: LogAmountPrefill | undefined): string {
    const fields: Array<[string, string]> = [];
    if (prefill?.food_id) fields.push(["food_id", prefill.food_id]);
    if (prefill?.recipe_id) fields.push(["recipe_id", prefill.recipe_id]);
    if (prefill?.barcode) fields.push(["barcode", prefill.barcode]);
    return fields
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("\n");
}

/** "each · 174 g": a piece says what it weighs when the food knows. */
export function unitSegmentLabel(
    unit: string,
    gramsPerEach: number | null | undefined,
): string {
    if (unit !== "each" || gramsPerEach == null || !(gramsPerEach > 0)) {
        return unit;
    }
    return `each · ${Math.round(gramsPerEach * 10) / 10} g`;
}

/**
 * The unit as the design's small Segmented: one segment per unit the food can
 * be logged in. A food with one unit has nothing to choose, so it posts the
 * unit from a hidden field instead. The script rebuilds it when a food is
 * picked, into the same `[data-fd-log-units]` slot.
 */
function unitControl(
    hints: string[],
    selected: string,
    gramsPerEach: number | null | undefined,
): Html {
    if (hints.length < 2) {
        return raw(
            `<div class="fd-log-units" data-fd-log-units>${
                hints.length === 1
                    ? `<input type="hidden" name="unit" value="${esc(hints[0]!)}">`
                    : ""
            }</div>`,
        );
    }
    return raw(
        `<div class="fd-log-units" data-fd-log-units>${segmented({
            label: "Unit",
            size: "small",
            name: "unit",
            segments: hints.map((unit) => ({
                value: unit,
                label: unitSegmentLabel(unit, gramsPerEach),
                selected: unit === selected,
            })),
        })}</div>`,
    );
}

/**
 * "1 portion · 30 ml": what the amount is in the pack serving's own unit.
 * Always rendered (empty), so the client can fill it when a food is picked.
 */
function portionEcho(
    serving: LogServing | null,
    amount: number,
    unit: string,
): string {
    const shown = serving != null && unit === "portion" && amount > 0;
    return `<p class="fd-log-portion" data-fd-log-portion${shown ? "" : " hidden"}>${shown ? esc(portionLabel(serving, amount)) : ""}</p>`;
}

function logAmountSheet(opts: RenderLogSheetsOpts): string {
    const prefill = opts.amount;
    const tz = opts.timezone;
    const hints = prefill?.unit_hints?.length
        ? prefill.unit_hints
        : prefill
          ? unitHintsForLog(
                {
                    grams_per_each: prefill.grams_per_each ?? null,
                    grams_per_ml: prefill.grams_per_ml ?? null,
                    basis: prefill.basis ?? null,
                    serving: prefill.serving ?? null,
                },
                { recipe: !!prefill.recipe_id },
            )
          : [];
    const unitMatches = Boolean(prefill?.unit && hints.includes(prefill.unit));
    const unit = unitMatches ? prefill!.unit! : (hints[0] ?? "g");
    const amount =
        unitMatches && prefill?.amount != null
            ? prefill.amount
            : unit === "portion" || unit === "each"
              ? 1
              : prefill
                ? 100
                : 0;
    const meal =
        prefill?.meal_type &&
        MEAL_TYPES.some((t) => t.value === prefill.meal_type)
            ? prefill.meal_type!
            : guessMealType(tz);
    const usePick = Boolean(prefill?.logged_at);
    const loggedAt = prefill?.logged_at
        ? datetimeLocalValue(prefill.logged_at)
        : defaultLoggedAtLocal(tz);
    const formId = `${FD_LOG_AMOUNT_SHEET_ID}-form`;
    const body = `${errorLine(opts.amountError)}<form id="${formId}" class="fd-log-form" method="post" action="${FD_LOG_POST}">
${amountHiddenFields(prefill)}
<input type="hidden" name="return_to" value="/">
<input type="hidden" name="display_name" value="${esc(prefill?.name ?? "Food")}" data-fd-log-display-name>
${sheetSection({
    kind: "amount",
    content: raw(
        `${stepperControl({
            name: "amount",
            label: "Amount",
            value: amount,
            min: 0,
            step: unit === "portion" ? 0.25 : 1,
            inputStep: "any",
            unit,
            id: "fd-log-amount-value",
        })}${portionEcho(prefill?.serving ?? null, amount, unit)}${unitControl(hints, unit, prefill?.grams_per_each)}<div data-fd-log-macros>${macroTilesForAmount(prefill, amount, unit)}</div>`,
    ),
})}
${sheetSection({ kind: "chips", label: "Add to", content: mealChoice("meal_type", meal) })}
${whenSection(
    { name: "fd_log_time_mode", hook: "fd-log-today-label" },
    { time: "fd-log-time" },
    { usePick, todayLabel: todayTimeLabel(tz), loggedAt },
)}
</form>`;
    return sheet({
        id: FD_LOG_AMOUNT_SHEET_ID,
        placement: "dialog",
        header: {
            kind: "title",
            title: prefill?.name ?? "Food",
            subtitle: amountSubtitle(prefill) || undefined,
        },
        body: raw(body),
        actions: {
            kind: "single",
            primary: {
                label: MEAL_SUBMIT_LABEL[meal] ?? "Log",
                type: "submit",
                form: formId,
                attrs: { "data-fd-log-submit": "" },
            },
        },
        openOnLoad: opts.amountOpenOnLoad,
        className: "fd-log-amount-sheet",
        focus: "panel",
    });
}

/** Search, amount, quick calories, weigh in and scanner sheets, once in the v2 shell. */
export function renderLogSheets(opts: RenderLogSheetsOpts): string {
    const scanner = renderBarcodeScannerSheet({
        barcodeCamera: opts.barcodeCamera,
        previewStatic: opts.previewScanner,
        openOnLoad: opts.scannerOpenOnLoad,
        zxingScriptHref: opts.scannerZxingHref,
        wasmHref: opts.scannerWasmHref,
    });
    return `${logSearchSheet(opts)}${logAmountSheet(opts)}${logQuickCaloriesSheet(opts)}${logWeighInSheet(opts)}${scanner}`;
}

/** For tests: unit chips offered on the amount sheet for the given factors. */
export function logAmountUnitChips(
    factors: {
        grams_per_each?: number | null;
        grams_per_ml?: number | null;
        basis?: LogBasis | null;
        serving?: LogServing | null;
    },
    recipe: boolean,
): string[] {
    return unitHintsForLog(factors, { recipe });
}
