/**
 * The design's Table row (FigCraft 381695): a label and right-aligned columns,
 * for the "1 serving · 30 ml | 100 ml" nutrition table (rule 15). `Row` is a
 * body row; `Header` is the small caps line over the columns.
 *
 * `tableRows` wraps rows in a named table, so a screen reader hears a table.
 * An unknown body cell is an en dash ("–", as 392480 sets it), never a zero; a header cell is plain text,
 * so an empty heading stays empty.
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { valueText } from "./card.js";
import { cls, esc, raw, type Html } from "./html.js";

export type TableRowOptions = {
    kind?: "row" | "header";
    label: string;
    cols: readonly (string | number | null)[];
    className?: string;
};

function tableRow(opts: TableRowOptions): Html {
    const header = opts.kind === "header";
    const role = header ? "columnheader" : "cell";
    const cols = opts.cols
        .map(
            (c) =>
                `<span class="fd-table-row__col" role="${role}">${header ? esc(c ?? "") : valueText(c, "–")}</span>`,
        )
        .join("");
    return raw(
        `<div class="${cls("fd-table-row", header && "fd-table-row--header", opts.className)}" role="row"><span class="fd-table-row__label" role="${header ? "columnheader" : "rowheader"}">${esc(opts.label)}</span>${cols}</div>`,
    );
}

export function tableRows(opts: {
    /** The table's accessible name ("Nutrition"). */
    label: string;
    rows: readonly TableRowOptions[];
    className?: string;
}): Html {
    return raw(
        `<div class="${cls("fd-table-rows", opts.className)}" role="table" aria-label="${esc(opts.label)}">${opts.rows.map(tableRow).join("")}</div>`,
    );
}
