import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { relative } from "node:path";

// Running as the system skips every household boundary row level security
// draws, so each file that does it is listed here on purpose. A new caller
// fails this test until it is added (with a reason in review); a listed file
// that stops calling it fails too, so the list never outgrows the code.
const RUN_AS_SYSTEM_ALLOWLIST = [
    // Reading an archive by its signed link, which has no session.
    "src/exports-route.ts",
    // Process-wide flag pin and snapshot cache, and its sweep.
    "src/flag-pins.ts",
    // Bearer token and household membership resolution before the actor is known.
    "src/household-token.ts",
    // Export sweep, unverified recipe sweep and fetch memory sweep timers.
    "src/index.ts",
    // OAuth sign-in, authorization codes, token exchange, client registration.
    "src/oauth.ts",
    // Listing the households whose restock run is due.
    "src/restock-runner.ts",
    // Site session membership lookup before the actor is known.
    "src/web/middleware.ts",
].sort();

const SRC = new URL("../", import.meta.url).pathname;
const ROOT = new URL("../../", import.meta.url).pathname;

function isScanned(path: string): boolean {
    return (
        !path.endsWith(".test.ts") &&
        !path.startsWith("src/db/testing/") &&
        // The definition itself.
        path !== "src/db/actor.ts"
    );
}

async function filesMatching(pattern: RegExp): Promise<string[]> {
    const found: string[] = [];
    for await (const file of new Glob("**/*.ts").scan({ cwd: SRC })) {
        const path = relative(ROOT, `${SRC}${file}`);
        if (!isScanned(path)) continue;
        const text = await Bun.file(`${SRC}${file}`).text();
        if (pattern.test(text)) found.push(path);
    }
    return found.sort();
}

describe("runAsSystem callers", () => {
    test("only allowlisted files run as the system, and each still does", async () => {
        const callers = await filesMatching(/\brunAsSystem\b/);
        const unlisted = callers.filter(
            (f) => !RUN_AS_SYSTEM_ALLOWLIST.includes(f),
        );
        const stale = RUN_AS_SYSTEM_ALLOWLIST.filter(
            (f) => !callers.includes(f),
        );
        expect({ unlisted, stale }).toEqual({ unlisted: [], stale: [] });
    });

    test("only the test harness sets a fallback actor", async () => {
        const callers = await filesMatching(/\bsetFallbackActorForTests\b/);
        expect(callers).toEqual([]);
    });
});
