/**
 * Notes that say an ingredient is deliberately not measured. Only these count
 * as the plan's "explicit not measured"; a prep note such as "boneless" on an
 * ingredient with no amount does not, so the check still asks for an amount.
 */
export const NOT_MEASURED_PHRASES: readonly string[] = [
    "to taste",
    "as needed",
    "as required",
    "as desired",
    "for garnish",
    "to garnish",
    "for serving",
    "to serve",
    "optional",
    "pinch",
    "a pinch",
    "dash",
    "a dash",
    "handful",
    "a handful",
    "some",
    "not measured",
];

export function isNotMeasuredNote(note: string | null | undefined): boolean {
    const text = note?.trim().toLowerCase();
    if (!text) return false;
    return NOT_MEASURED_PHRASES.some((phrase) =>
        new RegExp(`(^|[^a-z])${phrase.replace(/ /g, "\\s+")}([^a-z]|$)`).test(
            text,
        ),
    );
}
