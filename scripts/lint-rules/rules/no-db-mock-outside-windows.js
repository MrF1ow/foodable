// foodable/no-db-mock-outside-windows
//
// `mock.module` swaps a module for the whole test process, not just the file
// that asked. A second file mocking the same db module once broke
// middleware.test.ts on Linux CI (not reproducible on macOS). So a db module
// (anything under src/db/, subfolders included) is only mocked from the files
// that already own a sanctioned mock window, and only the modules each of them
// mocks today. The rule's `allow` option maps file → db modules:
//
//   "foodable/no-db-mock-outside-windows": ["error", { "allow": {
//       "src/middleware.test.ts": ["src/db/tokens"]
//   } }]
//
// Module names are repo-relative, without the extension. To stub a db module
// somewhere new, add the stub to one of those files instead. Adding a file or
// a module to `allow` is a decision to open another window, so do it in a PR
// that says why.
import path from "node:path";
import { bunTestImports, memberPath, staticString } from "../util.js";

const DB_MODULE = /(^|\/)(src\/db(?:\/.*)?)$/;

/** "../../db/foods.js" from src/web/x.test.ts → "src/db/foods", or null. */
function dbModuleName(
    /** @type {string} */ specifier,
    /** @type {string} */ filename,
) {
    const resolved = specifier.startsWith(".")
        ? path
              .resolve(path.dirname(filename), specifier)
              .split(path.sep)
              .join("/")
        : specifier;
    const match = DB_MODULE.exec(resolved);
    if (!match) return null;
    return match[2].replace(/\.(?:js|ts|mjs)$/, "").replace(/\/index$/, "");
}

export default {
    meta: {
        type: "problem",
        schema: [
            {
                type: "object",
                properties: {
                    allow: {
                        type: "object",
                        additionalProperties: {
                            type: "array",
                            items: { type: "string" },
                        },
                    },
                },
                additionalProperties: false,
            },
        ],
    },
    create(context) {
        /** @type {Record<string, string[]>} */
        const allow = context.options[0]?.allow ?? {};
        const filename = context.filename.split(path.sep).join("/");
        const entry = Object.keys(allow).find(
            (file) => filename === file || filename.endsWith(`/${file}`),
        );
        const allowedModules = new Set(entry ? allow[entry] : []);
        /** @type {Map<string, string>} */
        let locals = new Map();
        /** @type {Set<string>} `import * as b from "bun:test"` names. */
        let namespaces = new Set();

        return {
            Program(program) {
                locals = bunTestImports(program);
                namespaces = new Set();
                for (const stmt of program.body) {
                    if (
                        stmt.type !== "ImportDeclaration" ||
                        stmt.source.value !== "bun:test"
                    ) {
                        continue;
                    }
                    for (const spec of stmt.specifiers) {
                        if (spec.type === "ImportNamespaceSpecifier") {
                            namespaces.add(spec.local.name);
                        }
                    }
                }
            },
            CallExpression(node) {
                const callee = memberPath(node.callee);
                if (!callee) return;
                const isMockModule =
                    (callee.length === 2 &&
                        callee[1] === "module" &&
                        locals.get(callee[0]) === "mock") ||
                    (callee.length === 3 &&
                        callee[2] === "module" &&
                        callee[1] === "mock" &&
                        namespaces.has(callee[0]));
                if (!isMockModule) return;
                const specifier = staticString(node.arguments[0]);
                if (specifier === null) return;
                const module = dbModuleName(specifier, filename);
                if (module === null || allowedModules.has(module)) return;
                context.report({
                    node,
                    message: entry
                        ? `mock.module(${JSON.stringify(specifier)}) stubs ${module}, which ${entry} does not mock today. mock.module is process-wide; a sanctioned window only covers the modules listed for it under "allow" in .oxlintrc.json.`
                        : `mock.module(${JSON.stringify(specifier)}) stubs a db module outside the files that own a mock window. mock.module is process-wide; add the stub to one of those files (see "allow" in .oxlintrc.json) instead of opening another window.`,
                });
            },
        };
    },
};
