// foodable/no-string-replacement-patterns
//
// `String.prototype.replace` and `replaceAll` read their replacement STRING for
// patterns: `$&`, `` $` ``, `$'`, `$1`, `$$`. Splice anything dynamic in as a
// string (a template literal, a variable, a concatenation) and a `$` inside the
// spliced text, even HTML-escaped text, rewrites the output: `$'` inserts the
// rest of the page. Pass a function instead; its return value is used verbatim.
//
// Flagged: `.replace(x, y)` / `.replaceAll(x, y)` whose second argument is
// neither a function nor a string literal (an expression-free template counts
// as a literal). A literal replacement is written by the author on purpose, so
// `replace(/(a)b/, "$1c")` passes.
import { isFunction, propName, staticString, unwrap } from "../util.js";

const METHODS = new Set(["replace", "replaceAll"]);

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        return {
            CallExpression(node) {
                const callee = unwrap(node.callee);
                const member =
                    callee?.type === "ChainExpression"
                        ? unwrap(callee.expression)
                        : callee;
                if (member?.type !== "MemberExpression") return;
                const name = member.computed
                    ? staticString(member.property)
                    : propName(member.property);
                if (name === null || !METHODS.has(name)) return;
                if (node.arguments.length !== 2) return;
                const replacement = node.arguments[1];
                if (replacement.type === "SpreadElement") return;
                if (isFunction(replacement)) return;
                if (staticString(replacement) !== null) return;
                context.report({
                    node: replacement,
                    message: `${name}(…) reads its replacement string for $-patterns ($&, $\`, $', $1). Pass a function, \`() => value\`, so the text is used verbatim.`,
                });
            },
        };
    },
};
