// foodable/no-raw-role-check
//
// "May this person do that" is answered by one function, can() in
// src/domain/permissions.ts, for the app and the MCP. A role compared by hand
// (`member.role === "owner"`) is a second copy of that table that drifts from
// the first.
//
// Flagged: `===`, `!==`, `==` or `!=` between a role (a member expression
// whose property is `role`, or an identifier named `role`) and the string
// "owner", "admin" or "member". Presence checks (`role !== undefined`) are not
// role-string comparisons and are not flagged.
//
// A comparison that is not a permission decision (a display label, form-input
// validation, an owner-row lookup) says so on the line before it:
//
//   // oxlint-disable-next-line foodable/no-raw-role-check -- <why>
import { propName, staticString, unwrap } from "../util.js";

const ROLES = new Set(["owner", "admin", "member"]);
const OPERATORS = new Set(["===", "!==", "==", "!="]);

/** @param {any} rawNode */
function isRole(rawNode) {
    let node = unwrap(rawNode);
    if (node?.type === "ChainExpression") node = unwrap(node.expression);
    if (!node) return false;
    if (node.type === "Identifier") return node.name === "role";
    if (node.type === "MemberExpression") {
        const name = node.computed
            ? staticString(node.property)
            : propName(node.property);
        return name === "role";
    }
    return false;
}

/** @param {any} node */
function isRoleString(node) {
    const value = staticString(node);
    return value !== null && ROLES.has(value);
}

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        return {
            BinaryExpression(node) {
                if (!OPERATORS.has(node.operator)) return;
                const roleVsString =
                    (isRole(node.left) && isRoleString(node.right)) ||
                    (isRole(node.right) && isRoleString(node.left));
                if (!roleVsString) return;
                context.report({
                    node,
                    message:
                        'Do not compare a role by hand. Ask can() from src/domain/permissions.ts. If this is a label, input validation or an owner-row lookup, mark it with "// oxlint-disable-next-line foodable/no-raw-role-check -- <why>".',
                });
            },
        };
    },
};
