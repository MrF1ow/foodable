/** "Ethan Flow" → "EF", "Ethan" → "E". First letters of the first and last
 *  word, upper-cased. */
export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const first = [...words[0]!][0] ?? "";
    const last =
        words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
    return (first + last).toLocaleUpperCase("en");
}
