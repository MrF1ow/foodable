// foodable/no-restore-from-live-import
//
// Bun patches a mocked module's namespace in place, so restoring with the live
// import is a no-op: the next file gets the mock back. A restore has to hand
// `mock.module` a copy taken BEFORE the first mock.module of that module:
//
//   import * as actualTokens from "./db/tokens.js";
//   const realTokens = { ...actualTokens };            // snapshot, before mocking
//   mock.module("./db/tokens.js", () => ({ ...actualTokens, lookupBearer }));
//   afterAll(() => mock.module("./db/tokens.js", () => realTokens));
//
// Flagged:
//   - a factory that returns the live namespace (`() => actualTokens`), or
//     only spreads it (`() => ({ ...actualTokens })`): the same thing;
//   - a "snapshot" that is just an alias of the live namespace;
//   - a snapshot declared after the first mock.module of the module it restores.
//
// Live namespaces: `import * as x from …`, `const x = await import(…)` and
// aliases of those. A stub that spreads the namespace and adds its own exports
// (`() => ({ ...actual, fn })`) is how you mock, not how you restore, and passes.
import { bunTestImports, isFunction, staticString, unwrap } from "../util.js";

/** The expression a factory returns, if it is a plain arrow/function. */
function returned(/** @type {any} */ factory) {
    const fn = unwrap(factory);
    if (!fn) return null;
    if (fn.body.type !== "BlockStatement") return unwrap(fn.body);
    const last = fn.body.body.find(
        (/** @type {any} */ s) => s.type === "ReturnStatement",
    );
    return last?.argument ? unwrap(last.argument) : null;
}

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        /** @type {Map<string, string>} */
        let locals = new Map();
        /** name → import specifier (null if unknown) of a live namespace. */
        const live = new Map();
        /** name → { ns, start } for `const x = { ...liveNs }`. */
        const snapshots = new Map();
        /** @type {{ node: any, specifier: string | null, arg: any }[]} */
        const mocks = [];

        /** Is this a bare reference to a live namespace? */
        const liveName = (/** @type {any} */ node) =>
            node?.type === "Identifier" && live.has(node.name)
                ? node.name
                : null;

        return {
            Program(program) {
                locals = bunTestImports(program);
            },
            ImportDeclaration(node) {
                for (const spec of node.specifiers) {
                    if (spec.type === "ImportNamespaceSpecifier") {
                        live.set(spec.local.name, node.source.value);
                    }
                }
            },
            VariableDeclarator(node) {
                if (node.id.type !== "Identifier") return;
                const init = unwrap(node.init);
                if (!init) return;
                const name = node.id.name;
                if (
                    init.type === "AwaitExpression" &&
                    unwrap(init.argument)?.type === "ImportExpression"
                ) {
                    live.set(name, staticString(unwrap(init.argument).source));
                } else if (liveName(init)) {
                    // `const real = actual` copies nothing.
                    live.set(name, live.get(init.name));
                } else if (
                    init.type === "ObjectExpression" &&
                    init.properties.length > 0 &&
                    init.properties.every(
                        (/** @type {any} */ p) =>
                            p.type === "SpreadElement" &&
                            liveName(unwrap(p.argument)),
                    )
                ) {
                    snapshots.set(name, {
                        spec: live.get(
                            unwrap(init.properties[0].argument).name,
                        ),
                        start: node.range[0],
                    });
                }
            },
            CallExpression(node) {
                const callee = node.callee;
                if (
                    callee.type !== "MemberExpression" ||
                    callee.computed ||
                    callee.property.name !== "module" ||
                    callee.object.type !== "Identifier" ||
                    locals.get(callee.object.name) !== "mock"
                ) {
                    return;
                }
                mocks.push({
                    node,
                    specifier: staticString(node.arguments[0]),
                    arg: node.arguments[1],
                });
            },
            "Program:exit"() {
                for (const mock of mocks) {
                    if (!isFunction(mock.arg)) continue;
                    const value = returned(mock.arg);
                    if (!value) continue;

                    // `() => liveNs` / `() => ({ ...liveNs })`
                    const spreadOnly =
                        value.type === "ObjectExpression" &&
                        value.properties.length > 0 &&
                        value.properties.every(
                            (/** @type {any} */ p) =>
                                p.type === "SpreadElement" &&
                                liveName(unwrap(p.argument)),
                        );
                    if (liveName(value) || spreadOnly) {
                        context.report({
                            node: mock.node,
                            message:
                                "Restoring a mocked module from the live import is a no-op: Bun patches the namespace in place. Spread it into a snapshot (`const real = { ...actual }`) before the first mock.module and restore from that.",
                        });
                        continue;
                    }

                    // `() => snapshot`: it must predate the first mock of this module.
                    if (value.type !== "Identifier") continue;
                    const snap = snapshots.get(value.name);
                    if (!snap || mock.specifier === null) continue;
                    const first = mocks.find(
                        (m) => m.specifier === mock.specifier,
                    );
                    if (
                        first &&
                        first !== mock &&
                        snap.start > first.node.range[0]
                    ) {
                        context.report({
                            node: mock.node,
                            message: `\`${value.name}\` is copied after the first mock.module(${JSON.stringify(mock.specifier)}), so it already holds the mock. Take the snapshot before mocking.`,
                        });
                    }
                }
            },
        };
    },
};
