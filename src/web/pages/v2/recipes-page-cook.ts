/**
 * The recipe page's cook sheet (FigCraft "Recipe · cook", 402901 on the
 * phone): a servings stepper, what the cook takes as rows with their
 * checkboxes (a line the kitchen cannot cover keeps its box, greyed and
 * unticked), who the portion is logged for, and the Cook button.
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
import type { CookPreview } from "../../../domain/stock.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { esc, join, raw } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepper } from "../../components/v2/stepper.js";

export const COOK_SHEET_ID = "fd-recipe-cook-sheet";
const COOK_FORM_ID = "fd-recipe-cook-form";

const SLOT_LABELS: Record<CookSlot, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
};

function slotLabel(slot: CookSlot): string {
    return SLOT_LABELS[slot];
}

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
    /** The meal slot the logged portion files under. */
    slot: CookSlot;
    /** The viewer's name: the portion is logged for them. */
    viewerName: string;
    /** Where each fridge item the cook takes from is kept, by item id. */
    places?: ReadonlyMap<string, string>;
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

/** Where each fridge item sits, by item id: the line under what the cook takes. */
export type CookPlaces = ReadonlyMap<string, string>;

/**
 * What the cook takes, as rows: each fridge item it draws from (the amount
 * that leaves, and where it is kept) with a ticked box, then each shortfall
 * in the warning tone with its box greyed and unticked, then the ingredients
 * with no amount to take. Also what the preview endpoint returns, with the
 * preview as a hidden `expected` field the confirm compares.
 */
export function renderCookPreviewRegion(
    preview: CookPreview | null,
    error?: string,
    places?: CookPlaces,
): string {
    const open = `<div class="fd-recipe-cook-region" data-fd-cook-region aria-live="polite">`;
    if (!preview) {
        return `${open}${String(sheetSection({ kind: "message", label: "Takes", text: error ?? "Could not work out what this takes." }))}</div>`;
    }
    // An ingredient the kitchen only partly covers is one row: what it takes,
    // and how much it is short.
    const shortNames = new Set(preview.shortfalls.map((s) => s.displayName));
    const rows = [
        ...preview.lines
            .filter((line) => !shortNames.has(line.displayName))
            .map((line) => {
                const place = places?.get(line.fromItemId);
                return itemRow({
                    title: line.displayName,
                    meta: amountText(line.before - line.after, line.unit),
                    ...(place ? { subtitle: place } : {}),
                    lead: { kind: "done", label: `Takes ${line.displayName}` },
                });
            }),
        ...preview.shortfalls.map((short) => {
            const takes = preview.lines
                .filter((line) => line.displayName === short.displayName)
                .map((line) => amountText(line.before - line.after, line.unit));
            return itemRow({
                title: short.displayName,
                ...(takes.length > 0 ? { meta: takes.join(" + ") } : {}),
                state: "warning",
                subtitle: `${short.unknownFactor ? "May be short" : "Short"} ${amountText(short.amount, short.unit)}`,
                lead: {
                    kind: "checkbox",
                    label: `${short.displayName} is short`,
                    disabled: true,
                },
            });
        }),
        ...preview.unmeasured.map((row) =>
            itemRow({
                title: row.displayName,
                subtitle: "No amount, so nothing is taken",
                lead: {
                    kind: "checkbox",
                    label: `${row.displayName} has no amount`,
                    disabled: true,
                },
            }),
        ),
    ];
    const takes =
        rows.length > 0
            ? sheetSection({
                  kind: "rows",
                  label: "Takes",
                  content: listGroup({ rows, label: "Takes" }),
              })
            : sheetSection({
                  kind: "empty",
                  label: "Takes",
                  text: "Nothing in your kitchen to take.",
              });
    return `${open}${String(takes)}<input type="hidden" name="expected" value="${esc(serializeExpectedCook(preview))}"></div>`;
}

function servingsUnit(servings: number): string {
    return servings === 1 ? "serving" : "servings";
}

export function renderCookSheet(view: CookSheetView): string {
    const recipeId = esc(view.recipeId);
    const err = view.error
        ? `<p class="fd-recipe-error" role="alert">${esc(view.error)}</p>`
        : "";
    const servings = sheetSection({
        kind: "amount",
        label: "Servings",
        content: stepper({
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
    });
    const logFor = sheetSection({
        kind: "choice",
        label: "Log a portion for",
        content: join([
            raw('<div class="fd-recipe-cook-logrow">'),
            choiceGroup({
                name: "log_serving",
                legend: "Log a portion for",
                options: [
                    { value: "1", label: view.viewerName, selected: true },
                    { value: "0", label: "No one" },
                ],
            }),
            raw(
                `<p class="fd-recipe-caption fd-recipe-cook-slot">to ${esc(slotLabel(view.slot).toLowerCase())}</p></div>`,
            ),
        ]),
    });
    const body = `<form id="${COOK_FORM_ID}" class="fd-recipe-cook-form" method="post" action="/recipes/${recipeId}/cook/confirm" data-fd-cook-form data-fd-cook-preview-url="/recipes/${recipeId}/cook/preview">
${err}${String(servings)}
${renderCookPreviewRegion(view.preview, view.previewError, view.places)}
<input type="hidden" name="meal_type" value="${esc(view.slot)}">
<input type="hidden" name="submit_key" value="${esc(view.submitKey)}">
${String(logFor)}
</form>`;
    // Focus parks on the panel: the first field is the stepper, and a focus
    // ring around the number is not in the design.
    return sheet({
        id: COOK_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: `Cook ${view.recipeName}` },
        body: raw(body),
        actions: {
            kind: "single",
            primary: { label: "Cook", type: "submit", form: COOK_FORM_ID },
        },
        openOnLoad: view.open,
        focus: "panel",
    });
}
