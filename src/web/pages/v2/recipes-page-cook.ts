/**
 * The recipe page's cook sheet (FigCraft Screens › Recipes › "Recipe · cook",
 * dark 22962, light 27874; desktop dark 48994, light 57877): a servings
 * stepper, the list of what leaves the kitchen for that many servings, a
 * "Log 1 serving to <slot>" switch and the Cook button.
 *
 * The preview comes from `previewCookRecipe` (src/domain/stock.ts), the dry run
 * of the cook the confirm route then performs. It sits in one region
 * (`data-fd-cook-region`) that `GET /recipes/:id/cook/preview` re-renders when
 * the stepper moves (src/web/client/v2/recipes.js). Without script the sheet
 * still cooks: the confirm route reads the field, not the preview.
 *
 * The region also carries the preview as a hidden `expected` field. If the
 * kitchen changed between the preview and the confirm, the confirm compares
 * what it is about to take with that field and the toast names the differences.
 */
import type { RecipeMacros } from "../../../domain/recipes.js";
import type { CookPreview } from "../../../domain/stock.js";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
} from "../../../domain/log-macro-format.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import { stepper } from "../../components/v2/stepper.js";

export const COOK_SHEET_ID = "fd-recipe-cook-sheet";
const COOK_FORM_ID = "fd-recipe-cook-form";

export type CookSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type CookSheetView = {
    recipeId: string;
    recipeName: string;
    /** The stepper's value: portions the whole pot yields, or the viewer's choice. */
    servings: number;
    yieldPortions: number;
    /** Null when the preview could not be built (`previewError` says why). */
    preview: CookPreview | null;
    previewError?: string;
    /** The meal slot "Log 1 serving" files under. */
    slot: CookSlot;
    macrosPerPortion: RecipeMacros;
    /** One per render; the confirm turns it into the meal's idempotency key. */
    submitKey: string;
    /** A failed confirm re-renders the page with the sheet open. */
    open?: boolean;
    error?: string;
};

/** A figure to at most two decimals ("1.6", not 1.5999999999999999). */
function tidy(n: number): number {
    return Math.round(n * 100) / 100;
}

function amountText(amount: number, unit: string): string {
    return formatQuantityDisplayParts(tidy(amount), unit);
}

function afterText(after: number, unit: string): string {
    return after <= 0 ? "0" : amountText(after, unit);
}

/* ---- What the confirm compares: the preview as the sheet last showed it ---- */

export type ExpectedCook = {
    /** The servings the preview was for. */
    servings: number;
    lines: {
        id: string;
        name: string;
        unit: string;
        before: number;
        after: number;
    }[];
    short: { name: string; unit: string; amount: number }[];
};

const EXPECTED_MAX_ROWS = 100;

export function serializeExpectedCook(preview: CookPreview): string {
    return JSON.stringify({
        v: preview.totalPortions,
        l: preview.lines.map((line) => [
            line.fromItemId,
            line.displayName,
            line.unit,
            tidy(line.before),
            tidy(line.after),
        ]),
        s: preview.shortfalls.map((short) => [
            short.displayName,
            short.unit,
            tidy(short.amount),
        ]),
    });
}

/** The `expected` field back into data, or null when it is missing or not ours. */
export function parseExpectedCook(text: string): ExpectedCook | null {
    if (!text.trim()) return null;
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof data !== "object" || data === null) return null;
    const { v, l, s } = data as { v?: unknown; l?: unknown; s?: unknown };
    if (typeof v !== "number" || !Array.isArray(l) || !Array.isArray(s)) {
        return null;
    }
    if (l.length > EXPECTED_MAX_ROWS || s.length > EXPECTED_MAX_ROWS) {
        return null;
    }
    const lines: ExpectedCook["lines"] = [];
    for (const row of l) {
        if (!Array.isArray(row) || row.length !== 5) return null;
        const [id, name, unit, before, after] = row;
        if (
            typeof id !== "string" ||
            typeof name !== "string" ||
            typeof unit !== "string" ||
            typeof before !== "number" ||
            typeof after !== "number"
        ) {
            return null;
        }
        lines.push({ id, name, unit, before, after });
    }
    const short: ExpectedCook["short"] = [];
    for (const row of s) {
        if (!Array.isArray(row) || row.length !== 3) return null;
        const [name, unit, amount] = row;
        if (
            typeof name !== "string" ||
            typeof unit !== "string" ||
            typeof amount !== "number"
        ) {
            return null;
        }
        short.push({ name, unit, amount });
    }
    return { servings: v, lines, short };
}

/** Amounts closer than this are the same figure (the preview rounds to 2 decimals). */
const SAME_WITHIN = 0.05;

/**
 * Names of the foods whose line differs between what the sheet showed and what
 * the cook is about to take: an item whose amounts moved, one that appeared or
 * vanished, a shortfall that came or went. Empty when they agree, and when the
 * sheet carried no preview for these servings to compare.
 */
export function cookPreviewChanges(
    expected: ExpectedCook | null,
    actual: CookPreview,
): string[] {
    // A sheet whose preview was for other servings than are being cooked (the
    // refresh did not run) has nothing to compare.
    if (!expected || expected.servings !== actual.totalPortions) return [];
    const changed: string[] = [];
    const note = (name: string) => {
        if (!changed.includes(name)) changed.push(name);
    };
    const nowLines = new Map(actual.lines.map((l) => [l.fromItemId, l]));
    const wasIds = new Set(expected.lines.map((l) => l.id));
    for (const was of expected.lines) {
        const now = nowLines.get(was.id);
        if (
            !now ||
            Math.abs(now.before - was.before) > SAME_WITHIN ||
            Math.abs(now.after - was.after) > SAME_WITHIN
        ) {
            note(was.name);
        }
    }
    for (const now of actual.lines) {
        if (!wasIds.has(now.fromItemId)) note(now.displayName);
    }
    const shortKey = (name: string, unit: string) => `${name}\u0000${unit}`;
    const wasShort = new Map(
        expected.short.map((s) => [shortKey(s.name, s.unit), s]),
    );
    const nowShort = new Map(
        actual.shortfalls.map((s) => [shortKey(s.displayName, s.unit), s]),
    );
    for (const [key, was] of wasShort) {
        const now = nowShort.get(key);
        if (!now || Math.abs(now.amount - was.amount) > SAME_WITHIN) {
            note(was.name);
        }
    }
    for (const [key, now] of nowShort) {
        if (!wasShort.has(key)) note(now.displayName);
    }
    return changed;
}

/* ---- Markup ---- */

/**
 * The "Takes from your kitchen" block: each fridge item the cook draws from
 * (before → after, "0" once it is used up), then any shortfall in the warning
 * colour and the ingredients with no amount to take. Also what the preview
 * endpoint returns.
 */
export function renderCookPreviewRegion(
    preview: CookPreview | null,
    error?: string,
): string {
    const head = `<p class="fd-recipe-cook-label">Takes from your kitchen</p>`;
    if (!preview) {
        return `<div class="fd-recipe-cook-region" data-fd-cook-region aria-live="polite">${head}<p class="fd-recipe-cook-note fd-recipe-cook-note--warn">${esc(error ?? "Could not work out what this takes.")}</p></div>`;
    }
    const rows: string[] = [];
    for (const line of preview.lines) {
        rows.push(
            `<li class="fd-recipe-cook-use"><span class="fd-recipe-cook-use__name">${esc(line.displayName)}</span><span class="fd-recipe-cook-use__change">${esc(`${amountText(line.before, line.unit)} → ${afterText(line.after, line.unit)}`)}</span></li>`,
        );
    }
    for (const short of preview.shortfalls) {
        const lead = short.unknownFactor ? "may be short" : "short";
        rows.push(
            `<li class="fd-recipe-cook-use fd-recipe-cook-use--short"><span class="fd-recipe-cook-use__name">${esc(short.displayName)}</span><span class="fd-recipe-cook-use__change">${esc(`${lead} ${amountText(short.amount, short.unit)}`)}</span></li>`,
        );
    }
    const list =
        rows.length > 0
            ? `<ul class="fd-recipe-cook-uses">${rows.join("")}</ul>`
            : `<p class="fd-recipe-cook-note">Nothing in your kitchen to take.</p>`;
    const unmeasured =
        preview.unmeasured.length > 0
            ? `<p class="fd-recipe-cook-note">${esc(preview.unmeasured.map((u) => u.displayName).join(", "))} — no amount, so nothing is taken.</p>`
            : "";
    return `<div class="fd-recipe-cook-region" data-fd-cook-region aria-live="polite">${head}${list}${unmeasured}<input type="hidden" name="expected" value="${esc(serializeExpectedCook(preview))}"></div>`;
}

function macroSubline(macros: RecipeMacros): string {
    if (macros.calories == null) return "";
    const parts = [`${formatLogMacroKcal(macros.calories)} kcal`];
    const letters: [string, number | null][] = [
        ["P", macros.protein_g],
        ["C", macros.carbs_g],
        ["F", macros.fat_g],
    ];
    const grams = letters
        .filter(([, value]) => value != null)
        .map(([letter, value]) => `${letter} ${formatLogMacroGrams(value)}`);
    if (grams.length > 0) parts.push(grams.join(" "));
    return parts.join(" · ");
}

function servingsUnit(servings: number): string {
    return servings === 1 ? "serving" : "servings";
}

export function renderCookSheet(view: CookSheetView): string {
    const recipeId = esc(view.recipeId);
    const slot = esc(view.slot);
    const err = view.error
        ? `<p class="fd-recipe-cook-error" role="alert">${esc(view.error)}</p>`
        : "";
    const subline = macroSubline(view.macrosPerPortion);
    const body = `<form id="${COOK_FORM_ID}" class="fd-recipe-cook-form" method="post" action="/recipes/${recipeId}/cook/confirm" data-fd-cook-form data-fd-cook-preview-url="/recipes/${recipeId}/cook/preview">
${err}<p class="fd-recipe-cook-label">Servings</p>
${String(
    stepper({
        name: "servings",
        label: "Servings",
        value: view.servings,
        step: 1,
        inputStep: "any",
        min: Math.min(1, view.yieldPortions),
        unit: servingsUnit(view.servings),
        id: "fd-recipe-cook-servings",
        className: "fd-recipe-cook-stepper",
    }),
)}
${renderCookPreviewRegion(view.preview, view.previewError)}
<input type="hidden" name="meal_type" value="${slot}">
<input type="hidden" name="submit_key" value="${esc(view.submitKey)}">
<label class="fd-recipe-cook-log"><span class="fd-recipe-cook-log__text"><span class="fd-recipe-cook-log__title">Log 1 serving to ${slot}</span>${subline ? `<span class="fd-recipe-cook-log__sub">${esc(subline)}</span>` : ""}</span><input type="checkbox" class="fd-recipe-cook-switch" role="switch" name="log_serving" value="1" checked></label>
</form>`;
    // Focus parks on the panel: the first field is the stepper, and a focus
    // ring around the number is not in the design.
    return sheet({
        id: COOK_SHEET_ID,
        kind: "confirm",
        title: "Cook",
        subtitle: view.recipeName,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${COOK_FORM_ID}">Cook</button>`,
        openOnLoad: view.open,
        focus: "panel",
    });
}

const POT_ICON = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 11h18v2.5a5.5 5.5 0 0 1-5.5 5.5h-7A5.5 5.5 0 0 1 3 13.5V11z"/><path d="M1.5 11h21"/><path d="M9 7.5c0-1 1-1.2 1-2.2M14 7.5c0-1 1-1.2 1-2.2"/></svg>`,
);

/** The Cook button that opens the sheet. */
export function renderCookTrigger(): Html {
    return raw(
        sheetTrigger({
            target: COOK_SHEET_ID,
            label: "Cook",
            className: "fd-recipe-cook-btn",
            icon: `${String(POT_ICON)}<span>Cook</span>`,
        }),
    );
}
