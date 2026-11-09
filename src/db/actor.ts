import { AsyncLocalStorage } from "node:async_hooks";

export type Actor =
    | { kind: "user"; userId: string; householdId: string | null }
    | { kind: "household"; householdId: string }
    | { kind: "system"; reason: string };

const activeActor = new AsyncLocalStorage<Actor>();

export function withActor<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
    return activeActor.run(actor, fn);
}

export function currentActor(): Actor | undefined {
    return activeActor.getStore();
}

export function runAsSystem<T>(
    reason: string,
    fn: () => Promise<T>,
): Promise<T> {
    return withActor({ kind: "system", reason }, fn);
}

export function jwtSubAndHouseholdForActor(actor: Actor | undefined): {
    jwtSub: string;
    householdId: string;
} {
    if (!actor) {
        return { jwtSub: "", householdId: "" };
    }
    switch (actor.kind) {
        case "user":
            return {
                jwtSub: actor.userId,
                householdId: actor.householdId ?? "",
            };
        case "household":
            return { jwtSub: "", householdId: actor.householdId };
        case "system":
            return { jwtSub: "", householdId: "" };
    }
}

const warnedMissingActorSites = new Set<string>();

function isTestRuntime(): boolean {
    if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
        return true;
    }
    return process.argv.includes("test");
}

/** Logged when run() starts without an actor; quiet under the test runner. */
export function warnMissingActorIfNeeded(): void {
    if (isTestRuntime()) return;
    const err = new Error();
    const stack = err.stack ?? "";
    const line =
        stack
            .split("\n")
            .find(
                (l) =>
                    l.includes(" at ") &&
                    !l.includes("/db/actor.") &&
                    !l.includes("/db/sql."),
            ) ?? "unknown";
    if (warnedMissingActorSites.has(line)) return;
    warnedMissingActorSites.add(line);
    console.warn(
        `[db] run() without actor context (settings cleared); ${line.trim()}`,
    );
}
