// foodable/no-wall-clock-waits
//
// Tests do not wait for time to pass. A sleep that is long enough on a laptop
// is flaky on a loaded CI runner, and one that is safe everywhere makes the
// suite slow. Wait for the thing itself: await the promise, the event, or the
// store write, or inject a clock.
//
// Flagged in tests: Bun.sleep / Bun.sleepSync, a `sleep`/`delay` helper call,
// setTimeout, setInterval (the timers behind `new Promise(r => setTimeout(r,
// n))`), and with them every polling loop built on a sleep. node:timers/promises
// is covered under whatever name it is imported (`import { setTimeout as wait }`,
// `import * as timers`, `scheduler.wait`).
//
// Not flagged: a zero delay, literal or left out (`setTimeout(r, 0)`,
// `setTimeout(r)`, `Bun.sleep(0)`). That yields to the event loop so detached
// promise chains can settle; it waits for no time to pass.
import { memberPath, propName } from "../util.js";

const BARE = new Set([
    "setTimeout",
    "setInterval",
    "sleep",
    "sleepSync",
    "delay",
]);
const BUN = new Set(["sleep", "sleepSync"]);
/** Index of the delay argument for each waiting function. */
const DELAY_ARG = { setTimeout: 1, setInterval: 1 };
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "global"]);
const TIMER_MODULES = new Set(["node:timers/promises", "timers/promises"]);
/** Waiting exports of node:timers/promises (`scheduler` is an object, below). */
const PROMISE_TIMERS = new Set(["setTimeout", "setInterval"]);

/**
 * What a file imports from node:timers/promises: local name → the function it
 * is (`setTimeout`, `setInterval`, `scheduler`), and the namespace names.
 */
function timerImports(/** @type {any} */ program) {
    /** @type {Map<string, string>} */
    const locals = new Map();
    /** @type {Set<string>} */
    const namespaces = new Set();
    for (const stmt of program.body) {
        if (
            stmt.type !== "ImportDeclaration" ||
            !TIMER_MODULES.has(stmt.source.value)
        ) {
            continue;
        }
        for (const spec of stmt.specifiers) {
            if (spec.type === "ImportNamespaceSpecifier") {
                namespaces.add(spec.local.name);
            } else if (spec.type === "ImportSpecifier") {
                const imported = propName(spec.imported) ?? "";
                if (PROMISE_TIMERS.has(imported) || imported === "scheduler") {
                    locals.set(spec.local.name, imported);
                }
            }
        }
    }
    return { locals, namespaces };
}

export default {
    meta: { type: "problem", schema: [] },
    create(context) {
        let timers = timerImports({ body: [] });
        return {
            Program(program) {
                timers = timerImports(program);
            },
            CallExpression(node) {
                const path = memberPath(node.callee);
                if (!path) return;
                // Resolve names imported from node:timers/promises first: they
                // may be renamed, and their delay is the first argument.
                /** @type {string | null} */
                let fromPromises = null;
                if (path.length === 1) {
                    fromPromises = timers.locals.get(path[0]) ?? null;
                } else if (path.length === 2) {
                    if (timers.namespaces.has(path[0])) {
                        fromPromises = PROMISE_TIMERS.has(path[1])
                            ? path[1]
                            : null;
                    } else if (
                        timers.locals.get(path[0]) === "scheduler" &&
                        path[1] === "wait"
                    ) {
                        fromPromises = "scheduler.wait";
                    }
                }
                const last = path[path.length - 1];
                const bare = path.length === 1 && BARE.has(last);
                const bun =
                    path.length === 2 && path[0] === "Bun" && BUN.has(last);
                const global =
                    path.length === 2 &&
                    GLOBAL_OBJECTS.has(path[0]) &&
                    BARE.has(last);
                if (fromPromises === null && !bare && !bun && !global) return;
                const kind = fromPromises ?? last;
                // Global setTimeout/setInterval take (fn, delay); the sleeps and
                // the promise timers take (delay).
                const delayAt =
                    fromPromises === null ? (DELAY_ARG[last] ?? 0) : 0;
                const delay = node.arguments[delayAt];
                if (kind !== "setInterval") {
                    if (delay?.type === "Literal" && delay.value === 0) return;
                    // `setTimeout(fn)` with no delay is a zero-delay yield.
                    if (
                        delay === undefined &&
                        (kind === "setTimeout" || kind === "scheduler.wait")
                    ) {
                        return;
                    }
                }
                context.report({
                    node,
                    message: `${path.join(".")}(…) waits on the wall clock. Await the promise or event the test is really waiting for, or inject a clock; sleeps are flaky on CI and slow everywhere.`,
                });
            },
        };
    },
};
