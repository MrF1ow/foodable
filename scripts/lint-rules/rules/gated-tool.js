// foodable/gated-tool
//
// A flag-gated tool is declared with `gatedTool` (src/mcp/gated.ts), which keeps
// it out of tools/list while the flag is off AND records it in ctx.gatedTools so
// the flag tests can prove the flag-off list is the snapshot minus the gated
// tools. A hand-rolled `if (flagOn) server.registerTool(…)` registers the same
// way but is invisible to those tests, so a gate can rot unnoticed.
//
// Flagged in src/mcp: a `.registerTool(…)` call that is
//   - inside an `if` / ternary / `&&` / `||` whose condition reads a flag, or
//   - after an earlier `if (…flag…) return` in the same function.
// A condition "reads a flag" if it calls the repo's flag API (isViewerFlagOn,
// isEnabled, evaluateViewerFlags, loadViewerFlags, defaultViewerFlags,
// flagKey: src/flags.ts, src/viewer-flags.ts) or indexes a `flags` record
// (`ctx.flags[…]`, the ViewerFlags shape). A bare `if (args.flags)` is not one.
import { propName, unwrap } from "../util.js";

const FLAG_TEST =
    /\b(?:isViewerFlagOn|isEnabled|evaluateViewerFlags|loadViewerFlags|defaultViewerFlags|flagKey)\s*\(|\bflags\s*(?:\?\.)?\s*\[/;

const FUNCTIONS = new Set([
    "ArrowFunctionExpression",
    "FunctionExpression",
    "FunctionDeclaration",
]);

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        const { sourceCode } = context;
        const textOf = (/** @type {any} */ node) =>
            sourceCode.text.slice(node.range[0], node.range[1]);

        /** Does `node` contain a return statement (not inside a nested function)? */
        function returns(/** @type {any} */ node) {
            if (!node || typeof node !== "object") return false;
            if (node.type === "ReturnStatement") return true;
            if (FUNCTIONS.has(node.type)) return false;
            if (node.type === "BlockStatement") return node.body.some(returns);
            if (node.type === "IfStatement") {
                return returns(node.consequent) || returns(node.alternate);
            }
            return false;
        }

        return {
            CallExpression(node) {
                const callee = unwrap(node.callee);
                if (
                    callee?.type !== "MemberExpression" ||
                    propName(callee.property) !== "registerTool"
                ) {
                    return;
                }
                let child = node;
                for (let up = node.parent; up; child = up, up = up.parent) {
                    const gatedHere =
                        ((up.type === "IfStatement" ||
                            up.type === "ConditionalExpression") &&
                            child !== up.test &&
                            FLAG_TEST.test(textOf(up.test))) ||
                        (up.type === "LogicalExpression" &&
                            child === up.right &&
                            FLAG_TEST.test(textOf(up.left)));
                    if (gatedHere) {
                        context.report({
                            node,
                            message:
                                "This tool is registered behind a flag check. Declare it with gatedTool(server, ctx, flag, name, config, handler) from src/mcp/gated.ts so tools/list and the flag tests see the gate.",
                        });
                        return;
                    }
                    if (!FUNCTIONS.has(up.type)) continue;
                    // Early-return guard earlier in the enclosing function body.
                    const body =
                        up.body?.type === "BlockStatement" ? up.body.body : [];
                    const guarded = body.some(
                        (/** @type {any} */ stmt) =>
                            stmt.range[1] <= node.range[0] &&
                            stmt.type === "IfStatement" &&
                            FLAG_TEST.test(textOf(stmt.test)) &&
                            returns(stmt.consequent),
                    );
                    if (guarded) {
                        context.report({
                            node,
                            message:
                                "This tool is registered after an early return on a flag check. Declare it with gatedTool(server, ctx, flag, name, config, handler) from src/mcp/gated.ts so tools/list and the flag tests see the gate.",
                        });
                    }
                    return;
                }
            },
        };
    },
};
