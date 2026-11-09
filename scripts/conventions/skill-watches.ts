/**
 * Reads the `watches:` list from a skill's frontmatter:
 *
 *   watches:
 *       - package.json
 *       - scripts/nav-check*.ts
 *
 * Meaning: a PR that changes any of these paths must update the skill in the
 * same PR. Entries are paths or globs (Bun.Glob syntax). Accepted forms: an
 * indented or zero-indent block list (blank and comment lines allowed inside)
 * and a one-line flow list (`watches: [a.ts, b.ts]`). Returns [] only when the
 * frontmatter or the `watches:` key is absent. A `watches:` key that yields no
 * entries, or a list that stops at a line that is not an item, throws: a drift
 * check that silently watches nothing is worse than a loud failure.
 */
export function parseWatches(text: string): string[] {
    const fm = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const body = fm?.[1];
    if (body === undefined) return [];
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex((l) => /^watches\s*:/.test(l));
    if (start < 0) return [];

    const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
    const rest = (lines[start] ?? "")
        .replace(/^watches\s*:/, "")
        .replace(/^\s*#.*$/, "")
        .trim();

    if (rest !== "") {
        const flow = rest.match(/^\[(.*)\]\s*(?:#.*)?$/);
        if (!flow) {
            throw new Error(
                `watches: expected a block list or [a, b] flow list, got "${rest}"`,
            );
        }
        const items = (flow[1] ?? "")
            .split(",")
            .map(unquote)
            .filter((s) => s !== "");
        if (items.length === 0) throw new Error("watches: list is empty");
        return items;
    }

    const out: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
        const item = line.match(/^\s*-\s+(.+?)\s*$/);
        if (item?.[1]) {
            out.push(unquote(item[1]));
            continue;
        }
        if (/^[A-Za-z_][\w-]*\s*:/.test(line)) break;
        throw new Error(
            `watches: list stopped at "${line.trim()}", which is not "- item", a comment or a new key`,
        );
    }
    if (out.length === 0) throw new Error("watches: list is empty");
    return out;
}
