// The suppression policy, checked outside oxlint.
//
// A lint suppression says "this rule is wrong here", so it has to say which rule
// and why, and it has to stay small:
//
//   // oxlint-disable-next-line foodable/no-wall-clock-waits -- the retry loop under test is time-based
//
// Allowed: `oxlint-disable-next-line` / `oxlint-disable-line` (and the `eslint-`
// spellings) naming at least one rule, followed by `-- <reason>`.
// Rejected outright: `*-disable` / `*-enable` as a file-wide or block directive,
// and any line directive without a rule name or without a reason.
//
// Why this is not an oxlint rule: oxlint applies a directive comment to the
// diagnostics reported about that very comment. A rule that flags a bare
// `/* eslint-disable */` is therefore silenced by it, and a bare
// `// oxlint-disable-line` hides the report on its own line. So `bun run lint`
// (scripts/lint-rules/lint.ts) runs this check next to oxlint instead.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dir, "../..");
const SOURCE = /\.(?:ts|tsx|js|mjs|cjs)$/;
/** Cheap prefilter: parse only files that could hold a directive at all. */
const MAYBE_DIRECTIVE = /(?:oxlint|eslint)-(?:disable|enable)/;
const DIRECTIVE =
    /^\s*(?:oxlint|eslint)-(disable|enable)(-next-line|-line)?(?![\w-])([\s\S]*)$/;
const RULE_NAME = /^[@\w][\w@/.-]*$/;

export type Problem = {
    file: string;
    line: number;
    column: number;
    message: string;
};

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
    ".ts": ts.ScriptKind.TS,
    ".tsx": ts.ScriptKind.TSX,
    ".js": ts.ScriptKind.JS,
    ".mjs": ts.ScriptKind.JS,
    ".cjs": ts.ScriptKind.JS,
};

/** Every real comment in the file (never text inside a string or template). */
function commentRanges(sf: ts.SourceFile): ts.CommentRange[] {
    const text = sf.text;
    const seen = new Map<number, ts.CommentRange>();
    const add = (ranges: ts.CommentRange[] | undefined) => {
        for (const r of ranges ?? []) seen.set(r.pos, r);
    };
    const jsxText: [number, number][] = [];
    const visit = (node: ts.Node) => {
        if (node.kind === ts.SyntaxKind.JsxText) {
            jsxText.push([node.pos, node.end]);
        }
        add(ts.getLeadingCommentRanges(text, node.getFullStart()));
        add(ts.getTrailingCommentRanges(text, node.end));
        for (const child of node.getChildren(sf)) visit(child);
    };
    visit(sf);
    // JSX text is not trivia: a `//` in it is content, but the trivia scan
    // above starts right where the text starts.
    return [...seen.values()]
        .filter(
            (r) => !jsxText.some(([from, to]) => r.pos >= from && r.pos < to),
        )
        .sort((a, b) => a.pos - b.pos);
}

/** The problems with the suppression comments in one file's text. */
export function findBadSuppressions(file: string, text: string): Problem[] {
    if (!MAYBE_DIRECTIVE.test(text)) return [];
    const kind = SCRIPT_KINDS[path.extname(file)] ?? ts.ScriptKind.TS;
    const sf = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        kind,
    );
    const problems: Problem[] = [];
    for (const range of commentRanges(sf)) {
        const body =
            range.kind === ts.SyntaxKind.SingleLineCommentTrivia
                ? text.slice(range.pos + 2, range.end)
                : text.slice(range.pos + 2, range.end - 2);
        const match = DIRECTIVE.exec(body);
        if (!match) continue;
        const [, verb, scope, rest = ""] = match;
        const problem = (message: string) => {
            const { line, character } = sf.getLineAndCharacterOfPosition(
                range.pos,
            );
            problems.push({
                file,
                line: line + 1,
                column: character + 1,
                message,
            });
        };
        const directive = body.trim().split(/\s/)[0];
        if (verb === "enable") {
            problem(
                `\`${directive}\` has no use here: file-wide and block disables are not allowed, so there is nothing to re-enable.`,
            );
            continue;
        }
        if (!scope) {
            problem(
                `\`${directive}\` disables rules for the rest of the file. Use \`oxlint-disable-next-line <rule> -- <why>\` on the one line instead.`,
            );
            continue;
        }
        const dash = /(^|\s)--(\s|$)/.exec(rest);
        const rulePart = dash ? rest.slice(0, dash.index) : rest;
        const reason = dash ? rest.slice(dash.index + dash[0].length) : "";
        const rules = rulePart
            .split(",")
            .map((r) => r.trim())
            .filter((r) => r !== "");
        if (rules.length === 0) {
            problem(
                `\`${directive}\` names no rule, so it would silence every rule. Name the rule: \`${directive} foodable/<rule> -- <why>\`.`,
            );
        } else if (rules.some((r) => !RULE_NAME.test(r))) {
            problem(
                `\`${directive}\` has a malformed rule list (${JSON.stringify(rulePart.trim())}): separate rule names with commas and put the reason after \`--\`.`,
            );
        }
        if (reason.trim() === "") {
            problem(
                `\`${directive}\` needs a reason: add \`-- <why this rule is wrong here>\` after the rule list.`,
            );
        }
    }
    return problems;
}

/** Does a repo-relative path match one of .oxlintrc.json's ignorePatterns? */
export function isIgnored(rel: string, patterns: readonly string[]): boolean {
    return patterns.some(
        (pattern) =>
            rel === pattern ||
            rel.startsWith(`${pattern.replace(/\/$/, "")}/`) ||
            new Bun.Glob(pattern).match(rel),
    );
}

async function ignorePatterns(): Promise<string[]> {
    try {
        const config = JSON.parse(
            await Bun.file(path.join(ROOT, ".oxlintrc.json")).text(),
        ) as { ignorePatterns?: string[] };
        return config.ignorePatterns ?? [];
    } catch {
        return [];
    }
}

/** Files to check: the given files (directories expand), else every source file. */
async function sourceFiles(args: readonly string[]): Promise<string[]> {
    const out = new Set<string>();
    const dirs: string[] = [];
    for (const arg of args) {
        const abs = path.resolve(arg);
        if (!existsSync(abs)) continue;
        if (statSync(abs).isDirectory()) dirs.push(path.relative(ROOT, abs));
        else out.add(path.relative(ROOT, abs));
    }
    if (args.length === 0 || dirs.length > 0) {
        // Tracked plus untracked-not-ignored: what oxlint walks, without
        // node_modules and build output.
        const proc = Bun.spawn(
            [
                "git",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                ...(args.length === 0 ? ["."] : dirs),
            ],
            { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
        );
        const listing = await new Response(proc.stdout).text();
        if ((await proc.exited) !== 0) {
            throw new Error(
                `git ls-files failed: ${await new Response(proc.stderr).text()}`,
            );
        }
        for (const rel of listing.split("\0")) {
            if (rel !== "" && existsSync(path.join(ROOT, rel))) out.add(rel);
        }
    }
    return [...out].sort();
}

/**
 * Check the given files (or the whole tree when none), print problems, and
 * return the exit code: 0 clean, 1 problems.
 */
export async function runSuppressionCheck(
    args: readonly string[],
): Promise<number> {
    const ignored = await ignorePatterns();
    const files = (await sourceFiles(args)).filter(
        (rel) => SOURCE.test(rel) && !isIgnored(rel, ignored),
    );
    const problems: Problem[] = [];
    for (const rel of files) {
        const text = await Bun.file(path.join(ROOT, rel)).text();
        problems.push(...findBadSuppressions(rel, text));
    }
    for (const p of problems) {
        console.error(
            `  x foodable(suppression-policy): ${p.message}\n   ,-[${p.file}:${p.line}:${p.column}]`,
        );
    }
    if (problems.length > 0) {
        console.error(
            `\nFound ${problems.length} suppression problem${problems.length === 1 ? "" : "s"} (policy: scripts/lint-rules/check-suppressions.ts).`,
        );
        return 1;
    }
    return 0;
}

if (import.meta.main) {
    process.exit(
        await runSuppressionCheck(
            process.argv.slice(2).filter((a) => !a.startsWith("-")),
        ),
    );
}
