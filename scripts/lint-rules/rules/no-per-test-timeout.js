// foodable/no-per-test-timeout
//
// The timeout is a property of the suite (Bun's default, or one bunfig.toml
// entry if the suite ever needs it), not of one test. A per-test number is how
// a slow or hanging test gets papered over, and each one is a value that is
// wrong on some other machine.
//
// Flagged, for test/it/describe imported from "bun:test" (including .only,
// .skipIf(c), .each(rows) and friends): a numeric (or other non-object) third
// argument (`test("x", fn, 5000)`), an options object with a `timeout` key
// anywhere in the arguments (`{ timeout: 5000 }`; other options such as
// `{ retry: 2 }` are fine), and setDefaultTimeout / jest.setTimeout.
import {
    bunTestImports,
    bunTestRoot,
    isFunction,
    memberPath,
    propName,
    unwrap,
} from "../util.js";

const SUITE_FNS = new Set(["test", "it", "describe"]);

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        /** @type {Map<string, string>} */
        let locals = new Map();
        return {
            Program(program) {
                locals = bunTestImports(program);
            },
            CallExpression(node) {
                const path = memberPath(node.callee);
                if (path) {
                    const root = locals.get(path[0] ?? "");
                    if (path.length === 1 && root === "setDefaultTimeout") {
                        context.report({
                            node,
                            message:
                                "setDefaultTimeout changes the timeout for the whole process. Do not change it from a test file.",
                        });
                        return;
                    }
                    if (
                        path.length === 2 &&
                        root === "jest" &&
                        path[1] === "setTimeout"
                    ) {
                        context.report({
                            node,
                            message:
                                "jest.setTimeout changes the timeout for the whole process. Do not change it from a test file.",
                        });
                        return;
                    }
                }

                const imported = bunTestRoot(node.callee, locals);
                if (!imported || !SUITE_FNS.has(imported)) return;
                const args = node.arguments;
                const third = unwrap(args[2]);
                const optionsWithTimeout = args.some(
                    (/** @type {any} */ arg) => {
                        const obj = unwrap(arg);
                        return (
                            obj?.type === "ObjectExpression" &&
                            obj.properties.some(
                                (/** @type {any} */ p) =>
                                    p.type === "Property" &&
                                    propName(p.key) === "timeout",
                            )
                        );
                    },
                );
                if (
                    (third &&
                        !isFunction(third) &&
                        third.type !== "ObjectExpression") ||
                    optionsWithTimeout
                ) {
                    context.report({
                        node,
                        message:
                            "Do not give one test its own timeout. The timeout is the suite's, not one test's; a test that needs longer is doing too much or waiting on the wrong thing.",
                    });
                }
            },
        };
    },
};
