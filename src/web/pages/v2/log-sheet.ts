import { escapeHtml } from "../../../html.js";
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
import { fdIcon } from "../../components/fd-icons.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { stepper } from "../../components/v2/stepper.js";
import { statTiles, type StatTile } from "../../components/v2/stat-tiles.js";
import { sheet } from "../../components/v2/sheet.js";
import { searchResultRow } from "../../components/v2/rows.js";
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

const MEAL_ADDING_LABEL: Record<string, string> = {
    breakfast: "Adding to breakfast",
    lunch: "Adding to lunch",
    dinner: "Adding to dinner",
    snack: "Adding to snacks",
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
    /** Kill switch `barcode-camera`: when false, hide Scan actions. */
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

function todayTimeLabel(tz: string): string {
    const raw = formatLocalDateTime(new Date(), tz);
    const time = raw.slice(11, 16);
    const h = Number(time.slice(0, 2));
    const m = time.slice(3, 5);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `Today ${h12}:${m} ${ap}`;
}

/** 24-hour “Today 7:10” label for weigh-in time chips. */
export function todayTimeLabel24(tz: string): string {
    const time = formatLocalDateTime(new Date(), tz).slice(11, 16);
    return `Today ${time}`;
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

function mealChoiceHtml(
    name: string,
    selected: string,
    className: string,
): string {
    return choiceGroup({
        name,
        legend: "ADD TO",
        showLegend: true,
        options: MEAL_TYPES.map((t) => ({
            ...t,
            selected: t.value === selected,
        })),
        required: true,
        className,
    }).toString();
}

function searchFieldHtml(query = ""): string {
    const q = escapeHtml(query);
    const clearHidden = query ? "" : " hidden";
    return `<div class="fd-log-search-field">
${fdIcon("search")}
<input class="fd-log-search-input" id="fd-log-search-q" type="search" name="q" value="${q}" autocomplete="off" enterkeyhint="search" placeholder="Search foods, recipes, barcodes" aria-label="Search foods, recipes, and barcodes" />
<button type="button" class="fd-log-search-clear" data-fd-log-search-clear aria-label="Clear search"${clearHidden}><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
</div>`;
}

function filterChipsHtml(hidden: boolean): string {
    const filters = ["All", "Foods", "Recipes", "My foods"] as const;
    const chips = filters
        .map(
            (f, i) =>
                `<button type="button" class="fd-chip fd-log-filter${i === 0 ? " fd-chip--selected" : ""}" data-fd-log-filter="${escapeHtml(f)}" aria-pressed="${i === 0 ? "true" : "false"}"><span class="fd-chip__label">${f}</span></button>`,
        )
        .join("");
    return `<div class="fd-chips fd-log-filters" role="group" aria-label="Filter results"${hidden ? " hidden" : ""} data-fd-log-filters>${chips}</div>`;
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
    {
        name: "Oatmeal",
        kcal: 150,
        payload: { name: "Oatmeal", food_id: "f-oats", kcal: 150 },
    },
    {
        name: "Avocado toast",
        kcal: 320,
        payload: { name: "Avocado toast", food_id: "f-avo", kcal: 320 },
    },
    {
        name: "Salmon bowl",
        kcal: 540,
        payload: { name: "Salmon bowl", recipe_id: "r-salmon", kcal: 540 },
    },
    {
        name: "Cottage cheese",
        kcal: 110,
        payload: { name: "Cottage cheese", food_id: "f-cottage", kcal: 110 },
    },
    {
        name: "Peanut butter",
        kcal: 190,
        payload: { name: "Peanut butter", food_id: "f-pb", kcal: 190 },
    },
];

function quickIconBolt(): string {
    return `<svg class="fd-icon fd-quick-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13 2L4.5 13.5H11L9 22l10.5-12.5H13.5L13 2z"/></svg>`;
}

function quickIconWater(): string {
    return `<svg class="fd-icon fd-quick-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3c-4.5 6-7 9.8-7 13a7 7 0 1 0 14 0c0-3.2-2.5-7-7-13z"/></svg>`;
}

function quickIconScan(): string {
    return fdIcon("scan");
}

function quickIconScale(): string {
    return `<svg class="fd-icon fd-quick-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 20h12M7 20v-2h10v2M8.5 18V10a3.5 3.5 0 0 1 7 0v8"/><path d="M10 8h4"/></svg>`;
}

function quickIconCopy(): string {
    return `<svg class="fd-icon fd-quick-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 9h10v11H9z"/><path d="M15 9V5H5v11h4"/></svg>`;
}

/**
 * Posts to the route behind Today's "Same as yesterday?" prompt, so a repeat
 * is the same idempotent write. Disabled (not hidden) while the chosen meal has
 * nothing to copy; copy-yesterday.js re-points it when the meal changes.
 */
function copyYesterdayTile(copy: CopyYesterdayOpts, selected: string): string {
    const disabled = copy.slots.includes(selected) ? "" : " disabled";
    return `<form class="fd-quick-form" method="post" action="/log/copy-yesterday" data-fd-copy-yesterday data-fd-copy-yesterday-slots="${escapeHtml(copy.slots.join(" "))}"><input type="hidden" name="slot" value="${escapeHtml(selected)}" /><input type="hidden" name="return_to" value="${escapeHtml(copy.returnTo)}" /><button type="submit" class="fd-quick-tile" data-fd-copy-yesterday-button${disabled}><span class="fd-quick-tile__icon" aria-hidden="true">${quickIconCopy()}</span><span class="fd-quick-tile__label">Copy yesterday</span></button></form>`;
}

function quickActionsHtml(
    barcodeCamera: boolean,
    copy?: CopyYesterdayOpts,
    selectedMeal = "dinner",
): string {
    const water = `<form class="fd-quick-form" method="post" action="${FD_LOG_WATER_POST}"><input type="hidden" name="amount_ml" value="250" /><input type="hidden" name="return_to" value="/" /><button type="submit" class="fd-quick-tile"><span class="fd-quick-tile__icon" aria-hidden="true">${quickIconWater()}</span><span class="fd-quick-tile__label">Water +250 ml</span></button></form>`;
    const cal = `<button type="button" class="fd-quick-tile" data-fd-open-sheet="${FD_LOG_QUICK_CAL_SHEET_ID}"><span class="fd-quick-tile__icon" aria-hidden="true">${quickIconBolt()}</span><span class="fd-quick-tile__label">Quick calories</span></button>`;
    const weight = `<button type="button" class="fd-quick-tile" data-fd-open-sheet="${FD_LOG_WEIGH_IN_SHEET_ID}"><span class="fd-quick-tile__icon" aria-hidden="true">${quickIconScale()}</span><span class="fd-quick-tile__label">Weigh in</span></button>`;
    const scan = barcodeCamera
        ? `<button type="button" class="fd-quick-tile" data-fd-open-sheet="${FD_BARCODE_SCAN_SHEET_ID}"><span class="fd-quick-tile__icon" aria-hidden="true">${quickIconScan()}</span><span class="fd-quick-tile__label">Scan barcode</span></button>`
        : `<button type="button" class="fd-quick-tile" data-fd-open-sheet="${FD_BARCODE_SCAN_SHEET_ID}"><span class="fd-quick-tile__icon" aria-hidden="true">${quickIconScan()}</span><span class="fd-quick-tile__label">Enter barcode</span></button>`;
    return `<p class="fd-log-section-label">QUICK</p><div class="fd-log-quick-grid">${cal}${water}${weight}${scan}${copy ? copyYesterdayTile(copy, selectedMeal) : ""}</div>`;
}

function macroField(
    id: string,
    name: string,
    label: string,
    value: number | string | undefined = "",
): string {
    const v = escapeHtml(
        value === undefined || value === "" ? "" : String(value),
    );
    return `<label class="fd-log-macro-field"><span class="fd-log-macro-field__label">${escapeHtml(label)}</span><input class="fd-log-macro-field__input" id="${escapeHtml(id)}" type="number" name="${escapeHtml(name)}" value="${v}" min="0" step="0.1" inputmode="decimal" /></label>`;
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
    const error = opts.quickCaloriesError
        ? `<p class="fd-log-error" role="alert">${escapeHtml(opts.quickCaloriesError)}</p>`
        : "";
    const body = `${error}<form id="${formId}" class="fd-log-quick-cal-form" method="post" action="${FD_LOG_QUICK_POST}">
<input type="hidden" name="return_to" value="/" />
<div class="fd-log-kcal-hero"><input class="fd-log-kcal-input" id="fd-log-kcal" type="number" name="calories" value="${escapeHtml(String(calories))}" min="1" step="1" inputmode="numeric" required aria-label="Calories" /><span class="fd-log-kcal-suffix">kcal</span></div>
<div class="fd-log-macro-grid">${macroField("fd-log-protein", "protein_g", "Protein g", prefill?.protein_g ?? "")}${macroField("fd-log-carbs", "carbs_g", "Carbs g", prefill?.carbs_g ?? "")}${macroField("fd-log-fat", "fat_g", "Fat g", prefill?.fat_g ?? "")}</div>
<label class="fd-log-name-field"><span class="fd-log-name-field__label">Name</span><input class="fd-log-name-field__input" id="fd-log-quick-name" type="text" name="description" value="${escapeHtml(description)}" autocomplete="off" /></label>
${mealChoiceHtml("meal_type", meal, "fd-log-meals-quick")}
</form>`;
    const submitLabel =
        MEAL_SUBMIT_LABEL[meal] ?? MEAL_SUBMIT_LABEL.dinner ?? "Log";
    const actions = `<button type="submit" class="fd-btn fd-btn--primary fd-log-submit" form="${formId}" data-fd-quick-cal-submit>${escapeHtml(submitLabel)}</button>`;
    return sheet({
        id: FD_LOG_QUICK_CAL_SHEET_ID,
        kind: "edit",
        title: "Quick calories",
        subtitle: "Log without picking a food",
        body,
        actions,
        openOnLoad: opts.quickCaloriesOpenOnLoad,
        closeLabel: "Close",
        className: "fd-log-quick-cal-sheet",
        focus: "panel",
    });
}

function logWeighInSheet(opts: RenderLogSheetsOpts): string {
    const tz = opts.timezone;
    const prefill = opts.weighIn ?? {};
    const unit = prefill.unit ?? "kg";
    const weight = prefill.weight ?? (unit === "lb" ? 165 : 75);
    const usePickTime = Boolean(prefill.logged_at);
    const loggedAt = prefill.logged_at
        ? datetimeLocalValue(prefill.logged_at)
        : defaultLoggedAtLocal(tz);
    const todayLabel = todayTimeLabel24(tz);
    const subtitle = weighInLastSubtitle(
        prefill.lastWeightG,
        prefill.lastLoggedAt,
        prefill.preferredUnit ?? unit,
        tz,
    );
    const error = opts.weighInError
        ? `<p class="fd-log-error" role="alert">${escapeHtml(opts.weighInError)}</p>`
        : "";
    const formId = `${FD_LOG_WEIGH_IN_SHEET_ID}-form`;
    const body = `${error}<form id="${formId}" class="fd-log-weigh-in-form" method="post" action="${FD_LOG_WEIGHT_POST}">
<input type="hidden" name="return_to" value="/" />
<input type="hidden" name="unit" value="${escapeHtml(unit)}" />
${stepper({
    name: "weight",
    label: "Weight",
    value: weight,
    min: 0,
    step: 0.1,
    inputStep: "any",
    unit,
    id: "fd-log-weight-value",
    className: "fd-log-stepper",
}).toString()}
<fieldset class="fd-choice-group fd-log-time">
<legend class="fd-sr">When</legend>
<div class="fd-chips fd-log-time-chips">
<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="fd_weigh_time_mode" value="now"${usePickTime ? "" : " checked"} data-fd-weigh-time-mode><span class="fd-chip__face"><span class="fd-chip__label" data-fd-weigh-today-label>${escapeHtml(todayLabel)}</span></span></label>
<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="fd_weigh_time_mode" value="pick"${usePickTime ? " checked" : ""} data-fd-weigh-time-mode><span class="fd-chip__face"><span class="fd-chip__label">Pick a time</span></span></label>
</div>
<input class="fd-log-time-input" id="fd-weigh-time" type="datetime-local" name="logged_at" value="${escapeHtml(loggedAt)}" required aria-label="Time"${usePickTime ? "" : " hidden disabled"} />
</fieldset>
</form>`;
    const actions = `<button type="submit" class="fd-btn fd-btn--primary fd-log-submit" form="${formId}">Save</button>`;
    return sheet({
        id: FD_LOG_WEIGH_IN_SHEET_ID,
        kind: "edit",
        title: "Weigh in",
        subtitle,
        body,
        actions,
        openOnLoad: opts.weighInOpenOnLoad,
        closeLabel: "Close",
        className: "fd-log-weigh-in-sheet",
        focus: "panel",
    });
}

function recentChipsHtml(items: typeof PREVIEW_RECENTS): string {
    if (items.length === 0) return "";
    return items
        .map(
            (r) =>
                `<button type="button" class="fd-chip fd-log-recent" data-fd-log-pick="${escapeHtml(JSON.stringify(r.payload))}"><span class="fd-chip__label">${escapeHtml(r.name)}</span><span class="fd-chip__count">${r.kcal}</span></button>`,
        )
        .join("");
}

function previewResultRows(): string {
    const rows = [
        searchResultRow({
            title: "Chicken thighs",
            subtitle: "In your fridge · 0.5 lb · 209 / 100 g kcal",
            macros: { protein: 26, carbs: 0, fat: 11 },
            add: {
                label: "Add Chicken thighs",
                data: {
                    "fd-log-pick": '{"name":"Chicken thighs","kind":"stock"}',
                },
            },
        }),
        searchResultRow({
            title: "Chicken rice bowl",
            subtitle: "Your recipe · 1 serving · 852 kcal",
            macros: { protein: 69, carbs: 76, fat: 25 },
            add: {
                label: "Add Chicken rice bowl",
                data: {
                    "fd-log-pick":
                        '{"name":"Chicken rice bowl","recipe_id":"r1","unit_hints":["portion"]}',
                },
            },
        }),
        searchResultRow({
            title: "Chicken breast, grilled",
            subtitle: "Generic · 165 / 100 g kcal",
            macros: { protein: 31, carbs: 0, fat: 4 },
            add: {
                label: "Add Chicken breast, grilled",
                data: {
                    "fd-log-pick":
                        '{"name":"Chicken breast, grilled","food_id":"f-chicken","kcal_per_100g":165,"protein_per_100g":31,"carbs_per_100g":0,"fat_per_100g":3.3,"unit_hints":["g"]}',
                },
            },
        }),
        searchResultRow({
            title: "Chicken noodle soup",
            score: 41,
            subtitle: "Campbell's · 1 cup · 90 kcal",
            macros: { protein: 5, carbs: 12, fat: 2 },
            add: {
                label: "Add Chicken noodle soup",
                data: {
                    "fd-log-pick":
                        '{"name":"Chicken noodle soup","food_id":"f-soup"}',
                },
            },
        }),
        searchResultRow({
            title: "Chicken caesar wrap",
            subtitle: "Logged 3 times · 540 kcal",
            macros: { protein: 32, carbs: 41, fat: 26 },
            add: {
                label: "Add Chicken caesar wrap",
                data: {
                    "fd-log-pick":
                        '{"name":"Chicken caesar wrap","kind":"history"}',
                },
            },
        }),
    ];
    return `<ul class="fd-list" id="fd-log-result-listbox" role="listbox" aria-label="Search results">${rows.map((r) => r.toString()).join("")}</ul>`;
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

function macroTilesForAmount(
    prefill: LogAmountPrefill | undefined,
    amount: number,
    unit: string,
): StatTile[] {
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
    return [
        {
            label: "kcal",
            value: formatLogMacroKcal(m?.kcal),
            dot: "calories",
        },
        {
            label: "Protein",
            value: formatLogMacroGrams(m?.protein_g),
            unit: "g",
            dot: "protein",
        },
        {
            label: "Carbs",
            value: formatLogMacroGrams(m?.carbs_g),
            unit: "g",
            dot: "carbs",
        },
        {
            label: "Fat",
            value: formatLogMacroGrams(m?.fat_g),
            unit: "g",
            dot: "fat",
        },
    ];
}

function logSearchSheet(opts: RenderLogSheetsOpts): string {
    const meal = guessMealType(opts.timezone);
    const preview = opts.previewSearch;
    const query = opts.previewQuery ?? (preview === "results" ? "chick" : "");
    const showEmpty = preview !== "results";
    const showResults = preview === "results";
    const emptyHidden = showResults ? " hidden" : "";
    const resultsHidden = showResults ? "" : " hidden";
    const previewRecents = preview === "empty" ? PREVIEW_RECENTS : [];
    const searchError = opts.searchError
        ? `<p class="fd-log-error" role="alert">${escapeHtml(opts.searchError)}</p>`
        : "";
    const cameraOn = opts.barcodeCamera !== false;
    const emptyBody = `${searchError}${mealChoiceHtml("search_meal_type", meal, "fd-log-meals-search")}<p class="fd-log-section-label">Recent</p><div class="fd-chips fd-log-recents" data-fd-log-recent>${recentChipsHtml(previewRecents)}</div>${quickActionsHtml(cameraOn, opts.copyYesterday, meal)}`;
    const resultsBody = showResults
        ? previewResultRows()
        : `<ul class="fd-list" id="fd-log-result-listbox" role="listbox" data-fd-log-result-list></ul>`;
    const onlineHidden = showResults ? "" : " hidden";
    const body = `<div class="fd-log-search-panel">
${searchFieldHtml(query)}
${filterChipsHtml(!showResults)}
<div class="fd-log-search-results" data-fd-log-results${resultsHidden}>${resultsBody}</div>
<div class="fd-log-search-empty" data-fd-log-empty${emptyHidden}>${emptyBody}</div>
<button type="button" class="fd-btn fd-btn--primary fd-log-online" data-fd-log-online${onlineHidden}>${fdIcon("search", 2)}<span>Search online</span></button>
</div>`;
    return sheet({
        id: FD_LOG_SEARCH_SHEET_ID,
        kind: "edit",
        title: "Log food",
        subtitle: MEAL_ADDING_LABEL[meal] ?? MEAL_ADDING_LABEL.dinner,
        body,
        openOnLoad: opts.searchOpenOnLoad,
        closeLabel: "Close search",
        showClose: true,
        className: "fd-log-search-sheet",
        // Focus goes to the panel; log-sheet.js focuses the search field only
        // with a fine pointer, so a phone's keyboard waits for a tap.
        focus: "panel",
    });
}

function amountHiddenFields(prefill: LogAmountPrefill | undefined): string {
    const fields: Array<[string, string]> = [];
    if (prefill?.food_id) fields.push(["food_id", prefill.food_id]);
    if (prefill?.recipe_id) fields.push(["recipe_id", prefill.recipe_id]);
    if (prefill?.barcode) fields.push(["barcode", prefill.barcode]);
    return fields
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
        )
        .join("\n");
}

function unitChoiceHtml(
    hints: string[],
    selected: string,
    opts: { empty?: boolean } = {},
): string {
    const options = hints.map((unit) => ({
        value: unit,
        label: unit,
        selected: unit === selected,
    }));
    if (opts.empty || hints.length === 0) {
        return `<fieldset class="fd-choice-group fd-log-units" data-fd-log-unit-chips><legend class="fd-sr">Unit</legend></fieldset>`;
    }
    return choiceGroup({
        name: "unit",
        legend: "Unit",
        options,
        required: true,
        className: "fd-log-units",
    })
        .toString()
        .replace(
            'class="fd-choice-group fd-log-units"',
            'class="fd-choice-group fd-log-units" data-fd-log-unit-chips',
        );
}

/**
 * "1 portion · 30 ml": what the amount is in the pack serving's own unit.
 * Always rendered (empty), so the client can fill it when a food is picked.
 */
function portionEchoHtml(
    serving: LogServing | null,
    amount: number,
    unit: string,
): string {
    const shown = serving != null && unit === "portion" && amount > 0;
    return `<p class="fd-log-portion" data-fd-log-portion${shown ? "" : " hidden"}>${shown ? escapeHtml(portionLabel(serving, amount)) : ""}</p>`;
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
    const usePickTime = Boolean(prefill?.logged_at);
    const loggedAt = prefill?.logged_at
        ? datetimeLocalValue(prefill.logged_at)
        : defaultLoggedAtLocal(tz);
    const todayLabel = todayTimeLabel(tz);
    const error = opts.amountError
        ? `<p class="fd-log-error" role="alert">${escapeHtml(opts.amountError)}</p>`
        : "";
    const formId = `${FD_LOG_AMOUNT_SHEET_ID}-form`;
    const tiles = statTiles(macroTilesForAmount(prefill, amount, unit), {
        className: "fd-log-macros",
    }).toString();
    const body = `${error}<form id="${formId}" class="fd-log-amount-form" method="post" action="${FD_LOG_POST}">
${amountHiddenFields(prefill)}
<input type="hidden" name="return_to" value="/" />
<input type="hidden" name="display_name" value="${escapeHtml(prefill?.name ?? "Food")}" data-fd-log-display-name />
${stepper({
    name: "amount",
    label: "Amount",
    value: amount,
    min: 0,
    step: unit === "portion" ? 0.25 : 1,
    inputStep: "any",
    unit,
    id: "fd-log-amount-value",
    className: "fd-log-stepper",
}).toString()}
${portionEchoHtml(prefill?.serving ?? null, amount, unit)}
${unitChoiceHtml(hints, unit, { empty: !prefill })}
<div data-fd-log-macros>${tiles}</div>
${mealChoiceHtml("meal_type", meal, "fd-log-meals")}
<fieldset class="fd-choice-group fd-log-time">
<legend class="fd-sr">When</legend>
<div class="fd-chips fd-log-time-chips">
<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="fd_log_time_mode" value="now"${usePickTime ? "" : " checked"} data-fd-log-time-mode><span class="fd-chip__face"><span class="fd-chip__label" data-fd-log-today-label>${escapeHtml(todayLabel)}</span></span></label>
<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="fd_log_time_mode" value="pick"${usePickTime ? " checked" : ""} data-fd-log-time-mode><span class="fd-chip__face"><span class="fd-chip__label">Pick a time</span></span></label>
</div>
<input class="fd-log-time-input" id="fd-log-time" type="datetime-local" name="logged_at" value="${escapeHtml(loggedAt)}" required aria-label="Time"${usePickTime ? "" : " hidden disabled"} />
</fieldset>
</form>`;
    const submitLabel =
        MEAL_SUBMIT_LABEL[meal] ?? MEAL_SUBMIT_LABEL.dinner ?? "Log";
    const actions = `<button type="submit" class="fd-btn fd-btn--primary fd-log-submit" form="${formId}" data-fd-log-submit>${escapeHtml(submitLabel)}</button>`;
    const foodName = prefill?.name ?? "Food";
    return sheet({
        id: FD_LOG_AMOUNT_SHEET_ID,
        kind: "edit",
        title: foodName,
        subtitle: amountSubtitle(prefill),
        body,
        actions,
        openOnLoad: opts.amountOpenOnLoad,
        closeLabel: "Close",
        className: "fd-log-amount-sheet",
        focus: "panel",
    });
}

/** Search and amount sheets included once in the v2 shell. */
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
