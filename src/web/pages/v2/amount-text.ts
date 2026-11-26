import { isQuantityUnit } from "../../../domain/quantity.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";

/**
 * Amounts as the pages say them. Display only: the stored amount and unit,
 * and every posted field, stay as they are.
 */

/**
 * A household's own count word reads in the plural past one ("3 rolls",
 * "2 cloves"). The measuring units (g, cup, fl oz…) keep their short form, and
 * a word that already ends in s is left alone.
 */
export function pluralUnit(unit: string, amount: number): string {
    const word = unit.trim();
    if (!(amount > 1) || word === "" || isQuantityUnit(word)) return word;
    if (/s$/i.test(word)) return word;
    if (/(x|z|ch|sh)$/i.test(word)) return `${word}es`;
    if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
    return `${word}s`;
}

/** An amount and its unit, a count word in the plural past one ("3 rolls", 396429). */
export function formatAmountText(amount: number, unit: string): string {
    if (isQuantityUnit(unit)) return formatQuantityDisplayParts(amount, unit);
    return `${amount} ${pluralUnit(unit, amount)}`;
}

const FRACTIONS: readonly [number, string][] = [
    [1 / 4, "¼"],
    [1 / 3, "⅓"],
    [1 / 2, "½"],
    [2 / 3, "⅔"],
    [3 / 4, "¾"],
];

/**
 * A recipe amount as a cook reads it: halves, thirds and quarters as
 * fractions ("½", "1¼", "⅔"); any other amount as its number.
 */
export function formatFractionAmount(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return String(amount);
    const whole = Math.floor(amount);
    const part = amount - whole;
    if (part < 0.005) return String(whole);
    const hit = FRACTIONS.find(([value]) => Math.abs(part - value) < 0.01);
    if (!hit) return String(amount);
    return whole > 0 ? `${whole}${hit[1]}` : hit[1];
}

/** {@link formatAmountText}, with the amount as a fraction where it is one ("½ cup", 402619). */
export function formatRecipeAmountParts(amount: number, unit: string): string {
    const text = formatAmountText(amount, unit);
    const number = String(amount);
    return text.startsWith(number)
        ? `${formatFractionAmount(amount)}${text.slice(number.length)}`
        : text;
}
