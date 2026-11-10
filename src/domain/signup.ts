export const SIGNUP_POLICIES = ["closed", "invite", "open"] as const;

export type SignupPolicy = (typeof SIGNUP_POLICIES)[number];

export type SignupState = {
    userCount: number;
    householdExists: boolean;
    mode: "register" | "create-household";
};

export type SignupInvite = { valid: true } | { valid: false };

export type SignupDecision =
    | { ok: true; joins: "new-household" | "existing-household" }
    | {
          ok: false;
          reason: "signup-closed" | "invite-required" | "household-exists";
      };

const warnedUnknownPolicy = new Set<string>();

export function parseSignupPolicy(raw: string | undefined): SignupPolicy {
    const trimmed = raw?.trim().toLowerCase() ?? "";
    if (!trimmed) return "closed";
    if ((SIGNUP_POLICIES as readonly string[]).includes(trimmed)) {
        return trimmed as SignupPolicy;
    }
    if (!warnedUnknownPolicy.has(trimmed)) {
        warnedUnknownPolicy.add(trimmed);
        console.warn(
            `[signup] FOODABLE_SIGNUP_POLICY=${JSON.stringify(raw)} is unknown; using closed`,
        );
    }
    return "closed";
}

let cachedSignupPolicy: SignupPolicy | undefined;

export function getSignupPolicy(): SignupPolicy {
    if (cachedSignupPolicy === undefined) {
        cachedSignupPolicy = parseSignupPolicy(
            process.env.FOODABLE_SIGNUP_POLICY,
        );
    }
    return cachedSignupPolicy;
}

/** Test hook — signup policy is read once at boot. */
export function resetSignupPolicyCache(): void {
    cachedSignupPolicy = undefined;
}

// Invite and open routes ship in a later phase; until then HTTP gates keep closed
// behaviour so a mis-set policy cannot widen sign-up without the matching flows.
export function signupPolicyForRoutes(policy: SignupPolicy): SignupPolicy {
    if (policy === "invite" || policy === "open") return "closed";
    return policy;
}

function closedDecision(state: SignupState): SignupDecision {
    if (state.mode === "register") {
        if (state.userCount === 0) {
            return { ok: true, joins: "new-household" };
        }
        return { ok: false, reason: "signup-closed" };
    }
    if (state.householdExists) {
        return { ok: false, reason: "household-exists" };
    }
    return { ok: true, joins: "new-household" };
}

function inviteDecision(
    state: SignupState,
    invite?: SignupInvite,
): SignupDecision {
    if (state.mode === "register") {
        if (state.userCount === 0) {
            return { ok: true, joins: "new-household" };
        }
        if (invite?.valid === true) {
            return { ok: true, joins: "existing-household" };
        }
        return { ok: false, reason: "invite-required" };
    }
    return closedDecision(state);
}

function openDecision(state: SignupState): SignupDecision {
    if (state.mode === "register") {
        return { ok: true, joins: "new-household" };
    }
    return { ok: true, joins: "new-household" };
}

export function canSignUp(
    policy: SignupPolicy,
    state: SignupState,
    invite?: SignupInvite,
): SignupDecision {
    switch (policy) {
        case "closed":
            return closedDecision(state);
        case "invite":
            return inviteDecision(state, invite);
        case "open":
            return openDecision(state);
        default:
            return closedDecision(state);
    }
}
