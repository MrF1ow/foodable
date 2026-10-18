import {
    formatQuantity,
    isQuantityUnit,
    type Quantity,
} from "../domain/quantity.js";

/** Web-app quantity text: count units show the number only (`4`, not `4 each`). */
export function formatQuantityDisplay(q: Quantity): string {
    if (q.unit === "each") {
        return String(q.amount);
    }
    return formatQuantity(q);
}

export function formatQuantityDisplayParts(
    amount: number,
    unit: string,
): string {
    if (isQuantityUnit(unit)) {
        return formatQuantityDisplay({ amount, unit });
    }
    return `${amount} ${unit}`;
}

/** Label for unit `<select>` options in the household app (value stays `each`). */
export function quantityUnitOptionLabel(unit: string): string {
    return unit === "each" ? "count" : unit;
}
