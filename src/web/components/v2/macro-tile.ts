/**
 * The design's Macro tile (FigCraft 172344, Kind: kcal, protein, carbs, fat)
 * and Macro tiles (172345), the row of the four: a bordered tile with a dot
 * and its label over the figure.
 *
 * The live boxed tile in `stat-tiles.ts` is untouched; this is the design's
 * tile under `fd-macro-tile`. The figure is formatted by the caller ("47 g");
 * unknown is a dash, never a zero.
 *
 * Styles: `public/app/v2/nutrition-display.css`.
 */
import { valueText } from "./card.js";
import { dot, type DotColor } from "./dot.js";
import { cls, esc, raw, type Html } from "./html.js";

export type MacroKind = "kcal" | "protein" | "carbs" | "fat";

export const MACRO_KINDS: Record<MacroKind, { dot: DotColor; label: string }> =
    {
        kcal: { dot: "calories", label: "kcal" },
        protein: { dot: "protein", label: "Protein" },
        carbs: { dot: "carbs", label: "Carbs" },
        fat: { dot: "fat", label: "Fat" },
    };

export type MacroTileOptions = {
    kind: MacroKind;
    /** Formatted by the caller; null is unknown. */
    value: string | number | null;
    /** Default from the kind. */
    label?: string;
    className?: string;
};

export function macroTile(opts: MacroTileOptions): Html {
    const kind = MACRO_KINDS[opts.kind];
    return raw(
        `<div class="${cls("fd-macro-tile", `fd-macro-tile--${opts.kind}`, opts.className)}"><dt class="fd-macro-tile__label">${dot(kind.dot, { size: "sm" })}${esc(opts.label ?? kind.label)}</dt><dd class="fd-macro-tile__value">${valueText(typeof opts.value === "number" && opts.value < 0 ? null : opts.value)}</dd></div>`,
    );
}

export function macroTiles(opts: {
    /** The row's accessible name. */
    label: string;
    tiles: readonly MacroTileOptions[];
    className?: string;
}): Html {
    return raw(
        `<dl class="${cls("fd-macro-tiles", opts.className)}" aria-label="${esc(opts.label)}">${opts.tiles.map(macroTile).join("")}</dl>`,
    );
}
