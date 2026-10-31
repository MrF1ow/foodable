import {
    FOOD_QUANTITY_UNITS,
    type QuantityUnit,
} from "../../domain/quantity.js";
import { quantityUnitOptionLabel } from "../display-quantity.js";
import { escapeHtml } from "../shell.js";
import { field } from "./ui.js";

export type QuantityFieldKind = "food" | "supply";

const FOOD_UNITS: readonly QuantityUnit[] = FOOD_QUANTITY_UNITS;
const SUPPLY_UNITS: readonly QuantityUnit[] = [
    "g",
    "oz",
    "lb",
    "ml",
    "fl oz",
    "cup",
    "tbsp",
    "tsp",
    "each",
];

export type QuantityFieldOptions = {
    kind: QuantityFieldKind;
    amount?: number;
    unit?: string;
    units?: readonly string[];
    namePrefix?: string;
    idPrefix?: string;
    required?: boolean;
};

export function renderQuantityField(opts: QuantityFieldOptions): string {
    const units =
        opts.units ?? (opts.kind === "food" ? FOOD_UNITS : SUPPLY_UNITS);
    const selected =
        opts.unit && units.includes(opts.unit) ? opts.unit : units[0]!;
    const prefix = opts.namePrefix ?? "qty";
    const idPrefix = opts.idPrefix ?? prefix;
    const amountValue =
        opts.amount == null || !Number.isFinite(opts.amount)
            ? ""
            : String(opts.amount);
    const req = opts.required ? " required" : "";
    const options = units
        .map((unit) => {
            const sel = unit === selected ? " selected" : "";
            const label = quantityUnitOptionLabel(unit);
            return `<option value="${escapeHtml(unit)}"${sel}>${escapeHtml(label)}</option>`;
        })
        .join("");
    const amountId = `${idPrefix}-amount`;
    const unitId = `${idPrefix}-unit`;
    return `<div class="quantity-field" data-kind="${opts.kind}">
${field({
    id: amountId,
    label: "Amount",
    control: `<input id="${escapeHtml(amountId)}" name="${escapeHtml(prefix)}_amount" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(amountValue)}"${req} />`,
})}
${field({
    id: unitId,
    label: "Unit",
    control: `<select id="${escapeHtml(unitId)}" name="${escapeHtml(prefix)}_unit"${req}>${options}</select>`,
})}
</div>`;
}
