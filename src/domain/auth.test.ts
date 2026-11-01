import { describe, expect, test } from "bun:test";
import {
    AlreadyRegisteredError,
    createMemoryAuthStore,
    normalizeEmail,
    SignInError,
    signIn,
    signUp,
} from "./auth.js";

describe("normalizeEmail", () => {
    test("trims and lowercases", () => {
        expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
    });
});

describe("signUp", () => {
    test("weak password uses GoTrue message", async () => {
        const store = createMemoryAuthStore();
        await expect(signUp(store, "a@example.com", "12345")).rejects.toThrow(
            "Password should be at least 6 characters.",
        );
    });

    test("invalid email uses GoTrue validateEmail message", async () => {
        const store = createMemoryAuthStore();
        await expect(signUp(store, "not-an-email", "secret12")).rejects.toThrow(
            "Unable to validate email address: missing '@' or angle-addr",
        );
    });

    test("duplicate email uses GoTrue user already registered message", async () => {
        const store = createMemoryAuthStore();
        await signUp(store, "dup@example.com", "secret12");
        await expect(
            signUp(store, "dup@example.com", "secret12"),
        ).rejects.toThrow("User already registered");
    });
});

describe("signIn", () => {
    test("wrong password raises SignInError", async () => {
        const store = createMemoryAuthStore();
        await signUp(store, "user@example.com", "secret12");
        try {
            await signIn(store, "user@example.com", "wrong-pass");
            throw new Error("expected throw");
        } catch (err) {
            expect(err).toBeInstanceOf(SignInError);
            expect((err as SignInError).message).toBe(
                "Invalid login credentials",
            );
            expect((err as SignInError).status).toBe(400);
            expect((err as SignInError).code).toBe("invalid_credentials");
        }
    });

    test("unknown email still verifies dummy hash", async () => {
        const store = createMemoryAuthStore();
        let verifyCalls = 0;
        await expect(
            signIn(store, "ghost@example.com", "secret12", {
                verify: async () => {
                    verifyCalls += 1;
                    return false;
                },
            }),
        ).rejects.toBeInstanceOf(SignInError);
        expect(verifyCalls).toBe(1);
    });

    test("bcrypt hash rehashes to argon2id on success", async () => {
        const store = createMemoryAuthStore();
        const bcryptHash = await Bun.password.hash("legacy-pass", {
            algorithm: "bcrypt",
        });
        const id = await store.insertUser({
            email: "legacy@example.com",
            passwordHash: bcryptHash.replace(/^\$2[ab]\$/, "$2a$"),
        });
        await signIn(store, "legacy@example.com", "legacy-pass");
        const user = await store.findByEmail("legacy@example.com");
        expect(user?.passwordHash?.startsWith("$argon2id$")).toBe(true);
        expect(user?.id).toBe(id);
        await signIn(store, "legacy@example.com", "legacy-pass");
    });

    test("rehash failure does not fail sign-in", async () => {
        const store = createMemoryAuthStore();
        const bcryptHash = await Bun.password.hash("legacy-pass", {
            algorithm: "bcrypt",
        });
        await store.insertUser({
            email: "norehash@example.com",
            passwordHash: bcryptHash,
        });
        const id = await signIn(store, "norehash@example.com", "legacy-pass", {
            hash: async () => {
                throw new Error("hash down");
            },
        });
        expect(id).toBeTruthy();
    });
});

describe("memory store", () => {
    test("insertUser throws AlreadyRegisteredError on duplicate", async () => {
        const store = createMemoryAuthStore();
        await store.insertUser({
            email: "x@example.com",
            passwordHash: "hash",
        });
        await expect(
            store.insertUser({
                email: "x@example.com",
                passwordHash: "hash2",
            }),
        ).rejects.toBeInstanceOf(AlreadyRegisteredError);
    });
});
