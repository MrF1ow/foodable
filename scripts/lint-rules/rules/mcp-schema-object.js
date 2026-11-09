// foodable/mcp-schema-object
//
// Every tool's `inputSchema` / `outputSchema` (and a prompt's `argsSchema`) is a
// schema object, never a raw Zod shape. SDK v2 still wraps a raw shape through a
// deprecated overload, but the explicit form is the supported path and it lets
// the exported *_OUTPUT_SCHEMA constants be .parse()d in tests.
//
//   inputSchema: z.object({ id: z.string() })        ok
//   inputSchema: personSchema({ id: z.string() })    ok (a helper returning z.object)
//   outputSchema: FOOD_OUTPUT                        ok (an exported schema constant)
//   inputSchema: { id: z.string() }                  flagged: a raw shape
//   inputSchema: SHAPE  (const SHAPE = { … })        flagged: the same raw shape
//
// Checked on registerTool / registerPrompt / registerResource / gatedTool configs.
// Calls, members and imported identifiers are trusted; only a literal object, or
// an identifier bound to one in the same file, is wrong.
import { propName, unwrap } from "../util.js";

const REGISTERS = new Set([
    "registerTool",
    "registerPrompt",
    "registerResource",
    "gatedTool",
]);
const SCHEMA_KEYS = new Set(["inputSchema", "outputSchema", "argsSchema"]);

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        /** name → true for `const NAME = { … }` in this file. */
        const objectConsts = new Set();
        /** @type {{ property: any, name: string }[]} */
        const byName = [];

        return {
            VariableDeclarator(node) {
                if (
                    node.id.type === "Identifier" &&
                    unwrap(node.init)?.type === "ObjectExpression"
                ) {
                    objectConsts.add(node.id.name);
                }
            },
            CallExpression(node) {
                const callee = unwrap(node.callee);
                const name =
                    callee?.type === "Identifier"
                        ? callee.name
                        : callee?.type === "MemberExpression" &&
                            !callee.computed
                          ? callee.property.name
                          : null;
                if (!name || !REGISTERS.has(name)) return;
                for (const arg of node.arguments) {
                    const config = unwrap(arg);
                    if (config?.type !== "ObjectExpression") continue;
                    for (const property of config.properties) {
                        if (
                            property.type !== "Property" ||
                            !SCHEMA_KEYS.has(propName(property.key) ?? "")
                        ) {
                            continue;
                        }
                        const value = unwrap(property.value);
                        if (value?.type === "ObjectExpression") {
                            context.report({
                                node: property,
                                message: `${propName(property.key)} is a raw object shape. Wrap it: z.object({ … }) (or a helper that returns one).`,
                            });
                        } else if (value?.type === "Identifier") {
                            byName.push({ property, name: value.name });
                        }
                    }
                }
            },
            "Program:exit"() {
                for (const { property, name } of byName) {
                    if (!objectConsts.has(name)) continue;
                    context.report({
                        node: property,
                        message: `${propName(property.key)} is \`${name}\`, a raw object shape. Wrap it: z.object(${name}).`,
                    });
                }
            },
        };
    },
};
