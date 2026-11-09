// Helpers shared by the foodable lint rules. Plain ESM JavaScript on purpose:
// oxlint loads JS plugins with Node, which cannot strip types before 22.18.
//
// Rules here read the ESTree that oxlint hands to JS plugins (ESLint-compatible
// plugin API, alpha: https://oxc.rs/docs/guide/usage/linter/js-plugins.html).

/** @typedef {any} Node ESTree node as oxlint produces it. */

/** Strip parentheses and TypeScript wrappers (`as`, `satisfies`, `!`). */
export function unwrap(/** @type {Node} */ node) {
    let current = node;
    while (
        current &&
        (current.type === "TSAsExpression" ||
            current.type === "TSSatisfiesExpression" ||
            current.type === "TSNonNullExpression" ||
            current.type === "TSTypeAssertion" ||
            current.type === "ParenthesizedExpression")
    ) {
        current = current.expression;
    }
    return current;
}

/** The static name of a property key or member property, or null. */
export function propName(/** @type {Node} */ node) {
    if (!node) return null;
    if (node.type === "Identifier") return node.name;
    if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
    }
    return null;
}

/** The text of a string literal or an expression-free template, or null. */
export function staticString(/** @type {Node} */ rawNode) {
    const node = unwrap(rawNode);
    if (!node) return null;
    if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
    }
    if (
        node.type === "TemplateLiteral" &&
        node.expressions.length === 0 &&
        node.quasis.length === 1
    ) {
        return node.quasis[0].value.cooked ?? null;
    }
    return null;
}

/** `a.b.c` → ["a", "b", "c"]; null if the chain is not made of plain names. */
export function memberPath(/** @type {Node} */ rawNode) {
    const node = unwrap(rawNode);
    if (!node) return null;
    if (node.type === "ChainExpression") return memberPath(node.expression);
    if (node.type === "Identifier") return [node.name];
    if (node.type === "MemberExpression") {
        const base = memberPath(node.object);
        const name = node.computed
            ? staticString(node.property)
            : propName(node.property);
        return base && name !== null ? [...base, name] : null;
    }
    return null;
}

/** Is this node a function expression (arrow or `function`)? */
export function isFunction(/** @type {Node} */ rawNode) {
    const node = unwrap(rawNode);
    return (
        !!node &&
        (node.type === "ArrowFunctionExpression" ||
            node.type === "FunctionExpression")
    );
}

/**
 * Local name → imported name for everything a file imports from "bun:test".
 * `import { test as t }` maps `t` → `test`. Scanning the Program body is enough
 * because imports are top-level.
 */
export function bunTestImports(/** @type {Node} */ program) {
    /** @type {Map<string, string>} */
    const locals = new Map();
    for (const stmt of program.body) {
        if (
            stmt.type !== "ImportDeclaration" ||
            stmt.source.value !== "bun:test"
        ) {
            continue;
        }
        for (const spec of stmt.specifiers) {
            if (spec.type === "ImportSpecifier") {
                locals.set(spec.local.name, propName(spec.imported) ?? "");
            }
        }
    }
    return locals;
}

/**
 * The bun:test global a callee is rooted at, or null. Looks through
 * `test.only`, `test.skipIf(c)`, `test.each(rows)` and the call that finally
 * runs it, so `test.each(rows)("name", fn, 5000)` roots at `test`.
 */
export function bunTestRoot(
    /** @type {Node} */ callee,
    /** @type {Map<string, string>} */ locals,
) {
    let node = unwrap(callee);
    while (node) {
        if (node.type === "CallExpression") node = unwrap(node.callee);
        else if (node.type === "MemberExpression") node = unwrap(node.object);
        else if (node.type === "ChainExpression")
            node = unwrap(node.expression);
        else break;
    }
    if (node?.type !== "Identifier") return null;
    return locals.get(node.name) ?? null;
}

/** 1-based line → the whole text of that line (without the newline). */
export function sourceLines(/** @type {string} */ text) {
    return text.split(/\r\n|\r|\n/);
}
