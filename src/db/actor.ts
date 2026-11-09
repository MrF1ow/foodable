import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthContext } from "../auth-context.js";
import type { HouseholdMember } from "../household.js";

export type Actor =
    | { kind: "user"; userId: string; householdId: string | null }
    | { kind: "household"; householdId: string }
    | { kind: "system"; reason: string };

const activeActor = new AsyncLocalStorage<Actor>();

const siteMembershipPeek = new AsyncLocalStorage<HouseholdMember | null>();

/** Stash resolved site membership for loaders in the same request (undefined = not stashed). */
export function withSiteMembershipPeek<T>(
    member: HouseholdMember | null,
    fn: () => Promise<T>,
): Promise<T> {
    return siteMembershipPeek.run(member, fn);
}

export function peekSiteMembership(): HouseholdMember | null | undefined {
    return siteMembershipPeek.getStore();
}

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

/** Maps an authenticated request identity to the actor stored for database access. */
export function actorFromAuthContext(
    auth: AuthContext,
    householdId: string | null,
): Actor {
    if (auth.kind === "household") {
        return { kind: "household", householdId: auth.householdId };
    }
    return { kind: "user", userId: auth.userId, householdId };
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

// Set only by the database test harness (src/db/testing/pg.ts): the actor a
// run() falls back to when no withActor / runAsSystem is active. Production
// code never sets it, so a missing actor there still warns.
let testFallbackActor: Actor | undefined;

/** Test harness only: the actor run() uses when none is active (null clears it). */
export function setFallbackActorForTests(actor: Actor | null): void {
    testFallbackActor = actor ?? undefined;
}

export const MISSING_ACTOR_MESSAGE =
    "run() called without an actor: wrap the caller in withActor(actor, fn), " +
    'or runAsSystem("<reason>", fn) for background work';

function isTestRuntime(): boolean {
    if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
        return true;
    }
    return process.argv.includes("test");
}

/**
 * The actor run() should apply. Without one it throws under the test runner,
 * so a missing actor fails the suite, and in production it logs a warning
 * once per call site and carries on with the settings cleared.
 */
export function actorForRun(): Actor | undefined {
    const actor = currentActor() ?? testFallbackActor;
    if (actor) return actor;
    if (isTestRuntime()) throw new Error(MISSING_ACTOR_MESSAGE);
    warnMissingActor();
    return undefined;
}

function warnMissingActor(): void {
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
    console.warn(`[db] ${MISSING_ACTOR_MESSAGE}; ${line.trim()}`);
}
