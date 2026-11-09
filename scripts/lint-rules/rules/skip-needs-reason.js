// foodable/skip-needs-reason
//
// A skipped test is a test that stops telling you something, and in a month
// nobody remembers why. `.skip` on test/it/describe (imported from "bun:test")
// needs a comment saying why, on the same line or on the line directly above:
//
//   // Flaky until #123 lands: the stub races the cache warm-up.
//   test.skip("warms the cache", …);
//
// Deliberately not flagged: `.todo` (it is a visible, listed placeholder with
// no body to rot) and `.skipIf(cond)` / `.if(cond)` (the condition is the
// reason, e.g. "no Postgres on this machine").
import { bunTestImports, sourceLines } from "../util.js";

const SUITE_FNS = new Set(["test", "it", "describe"]);

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        const { sourceCode } = context;
        /** @type {Map<string, string>} */
        let locals = new Map();
        /** @type {any[]} */
        let comments = [];
        /** @type {string[]} */
        let lines = [];

        return {
            Program(program) {
                locals = bunTestImports(program);
                comments = sourceCode.getAllComments();
                lines = sourceLines(sourceCode.text);
            },
            CallExpression(node) {
                const callee = node.callee;
                if (
                    callee.type !== "MemberExpression" ||
                    callee.computed ||
                    callee.property.name !== "skip" ||
                    callee.object.type !== "Identifier" ||
                    !SUITE_FNS.has(locals.get(callee.object.name) ?? "")
                ) {
                    return;
                }
                const line = node.loc.start.line;
                const hasReason = comments.some((c) => {
                    if (c.value.trim() === "") return false;
                    if (c.loc.end.line === line) return true;
                    // Above: it must start its own line, not trail other code.
                    return (
                        c.loc.end.line === line - 1 &&
                        (lines[c.loc.start.line - 1] ?? "")
                            .slice(0, c.loc.start.column)
                            .trim() === ""
                    );
                });
                if (!hasReason) {
                    context.report({
                        node,
                        message:
                            "A skipped test needs a reason: a comment on this line or the line above saying why it is skipped and what un-skips it.",
                    });
                }
            },
        };
    },
};
