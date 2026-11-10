import { afterEach, describe, expect, test } from "bun:test";
import {
    SIGNUP_POLICIES,
    canSignUp,
    getSignupPolicy,
    parseSignupPolicy,
    resetSignupPolicyCache,
    signupPolicyForRoutes,
    type SignupPolicy,
    type SignupState,
} from "./signup.js";

const STATE = {
    emptyDeploy: {
        userCount: 0,
        householdExists: false,
        mode: "register",
    } satisfies SignupState,
    ownerNoHousehold: {
        userCount: 1,
        householdExists: false,
        mode: "register",
    } satisfies SignupState,
    closedDeploy: {
        userCount: 1,
        householdExists: true,
        mode: "register",
    } satisfies SignupState,
    founderCreatesHousehold: {
        userCount: 1,
        householdExists: false,
        mode: "create-household",
    } satisfies SignupState,
    secondHouseholdAttempt: {
        userCount: 1,
        householdExists: true,
        mode: "create-household",
    } satisfies SignupState,
} as const;

describe("parseSignupPolicy", () => {
    test("unset and empty default to closed", () => {
        expect(parseSignupPolicy(undefined)).toBe("closed");
        expect(parseSignupPolicy("")).toBe("closed");
        expect(parseSignupPolicy("   ")).toBe("closed");
    });

    test("accepts the three named values", () => {
        for (const policy of SIGNUP_POLICIES) {
            expect(parseSignupPolicy(policy)).toBe(policy);
        }
    });

    test("unknown values become closed with a warning", () => {
        const warnings: string[] = [];
        const previous = console.warn;
        console.warn = (...args: unknown[]) => {
            warnings.push(String(args[0]));
        };
        try {
            expect(parseSignupPolicy("broken")).toBe("closed");
            expect(
                warnings.some((line) =>
                    line.includes("FOODABLE_SIGNUP_POLICY"),
                ),
            ).toBe(true);
        } finally {
            console.warn = previous;
        }
    });
});

describe("canSignUp truth table", () => {
    const policies: SignupPolicy[] = [...SIGNUP_POLICIES];

    for (const policy of policies) {
        test(`${policy}: first auth user may register`, () => {
            expect(canSignUp(policy, STATE.emptyDeploy)).toEqual({
                ok: true,
                joins: "new-household",
            });
        });
    }

    test("closed refuses a second auth registration", () => {
        expect(canSignUp("closed", STATE.ownerNoHousehold)).toEqual({
            ok: false,
            reason: "signup-closed",
        });
        expect(canSignUp("closed", STATE.closedDeploy)).toEqual({
            ok: false,
            reason: "signup-closed",
        });
    });

    test("closed lets the founder create the singleton household", () => {
        expect(canSignUp("closed", STATE.founderCreatesHousehold)).toEqual({
            ok: true,
            joins: "new-household",
        });
    });

    test("closed refuses a second household", () => {
        expect(canSignUp("closed", STATE.secondHouseholdAttempt)).toEqual({
            ok: false,
            reason: "household-exists",
        });
    });

    test("invite registration needs a valid invite after the founder exists", () => {
        expect(canSignUp("invite", STATE.ownerNoHousehold)).toEqual({
            ok: false,
            reason: "invite-required",
        });
        expect(
            canSignUp("invite", STATE.ownerNoHousehold, { valid: true }),
        ).toEqual({
            ok: true,
            joins: "existing-household",
        });
    });

    test("open allows another auth registration and household", () => {
        expect(canSignUp("open", STATE.closedDeploy)).toEqual({
            ok: true,
            joins: "new-household",
        });
        expect(canSignUp("open", STATE.secondHouseholdAttempt)).toEqual({
            ok: true,
            joins: "new-household",
        });
    });

    test("invite and open routes keep closed behaviour until invite/open flows ship", () => {
        expect(signupPolicyForRoutes("invite")).toBe("closed");
        expect(signupPolicyForRoutes("open")).toBe("closed");
        expect(signupPolicyForRoutes("closed")).toBe("closed");
    });
});

describe("signup policy cache", () => {
    afterEach(() => {
        resetSignupPolicyCache();
    });

    test("reads FOODABLE_SIGNUP_POLICY once", () => {
        const previous = process.env.FOODABLE_SIGNUP_POLICY;
        resetSignupPolicyCache();
        process.env.FOODABLE_SIGNUP_POLICY = "open";
        try {
            expect(getSignupPolicy()).toBe("open");
            process.env.FOODABLE_SIGNUP_POLICY = "closed";
            expect(getSignupPolicy()).toBe("open");
        } finally {
            if (previous === undefined) {
                delete process.env.FOODABLE_SIGNUP_POLICY;
            } else {
                process.env.FOODABLE_SIGNUP_POLICY = previous;
            }
            resetSignupPolicyCache();
        }
    });
});
