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

export function jwtSubAndHouseholdForActor(actor: Actor): {
    jwtSub: string;
    householdId: string;
} {
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

// Set only by the database test harness (src/db/testing/pg.ts): the actor a
// run() falls back to when no withActor / runAsSystem is active, or a function
// that works it out from the database at the time. Production code never sets
// it, so a missing actor there always throws.
// Per instance by design: test harness only; production never sets a fallback actor.
let testFallbackActor: Actor | (() => Promise<Actor>) | undefined;

/** Test harness only: the actor run() uses when none is active (null clears it). */
export function setFallbackActorForTests(
    actor: Actor | (() => Promise<Actor>) | null,
): void {
    testFallbackActor = actor ?? undefined;
}

export const MISSING_ACTOR_MESSAGE =
    "run() called without an actor: wrap the caller in withActor(actor, fn), " +
    'or runAsSystem("<reason>", fn) for background work';

/**
 * The actor run() should apply. Without one it throws, in production as in
 * tests: a transaction that does not say who is acting would run with no
 * user and no household, which row level security reads as "nobody".
 */
export async function actorForRun(): Promise<Actor> {
    const actor = currentActor();
    if (actor) return actor;
    if (typeof testFallbackActor === "function") return testFallbackActor();
    if (testFallbackActor) return testFallbackActor;
    throw new Error(MISSING_ACTOR_MESSAGE);
}
