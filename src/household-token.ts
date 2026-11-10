import { createHash, randomBytes } from "node:crypto";
import type { AuthContext } from "./auth-context.js";
import { actorFromAuthContext, runAsSystem, type Actor } from "./db/actor.js";
import { getHouseholdMembership } from "./db/household.js";
import { lookupBearer, type TokenLookup } from "./db/tokens.js";

export const HOUSEHOLD_TOKEN_PREFIX = "nt_hh_";

export type TableLookup =
    | { status: "hit"; id: string }
    | { status: "miss" }
    | { status: "unavailable" };

export type CombinedBearerLookup =
    | { status: "valid"; kind: "user"; userId: string }
    | { status: "valid"; kind: "household"; householdId: string }
    | { status: "invalid" }
    | { status: "unavailable" };

export function generateHouseholdToken(): string {
    return `${HOUSEHOLD_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashHouseholdToken(plaintext: string): Uint8Array {
    return new Uint8Array(createHash("sha256").update(plaintext).digest());
}

export function householdTokenHashHex(hash: Uint8Array): string {
    return Buffer.from(hash).toString("hex");
}

export async function lookupBearerAsSystem(
    token: string,
): Promise<TokenLookup> {
    return runAsSystem("resolve bearer token", () => lookupBearer(token));
}

export async function actorForAuthContext(auth: AuthContext): Promise<Actor> {
    if (auth.kind === "household") {
        return actorFromAuthContext(auth, null);
    }
    const member = await runAsSystem("resolve auth user household", () =>
        getHouseholdMembership(auth.userId),
    );
    return actorFromAuthContext(auth, member?.householdId ?? null);
}

export async function actorForValidBearer(
    lookup: Extract<TokenLookup, { status: "valid" }>,
): Promise<Actor> {
    const auth: AuthContext =
        lookup.kind === "user"
            ? { kind: "user", userId: lookup.userId }
            : { kind: "household", householdId: lookup.householdId };
    return actorForAuthContext(auth);
}

export function combineBearerLookups(
    oauth: TableLookup,
    household: TableLookup,
): CombinedBearerLookup {
    if (oauth.status === "hit") {
        return { status: "valid", kind: "user", userId: oauth.id };
    }
    if (household.status === "hit") {
        return {
            status: "valid",
            kind: "household",
            householdId: household.id,
        };
    }
    if (oauth.status === "unavailable" || household.status === "unavailable") {
        return { status: "unavailable" };
    }
    return { status: "invalid" };
}
