import { describe, expect, test } from "bun:test";
import {
    AlreadyRegisteredError,
    createMemoryAuthStore,
    DUMMY_PASSWORD_HASH,
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
    test("empty password uses GoTrue signup message", async () => {
        const store = createMemoryAuthStore();
        await expect(signUp(store, "a@example.com", "")).rejects.toThrow(
            "Signup requires a valid password",
        );
    });

    test("weak password uses GoTrue message", async () => {
        const store = createMemoryAuthStore();
        await expect(signUp(store, "a@example.com", "12345")).rejects.toThrow(
            "Password should be at least 6 characters.",
        );
    });

    test("password is checked before the email, as GoTrue does", async () => {
        const store = createMemoryAuthStore();
        const message = (p: Promise<unknown>) =>
            p.then(
                () => null,
                (e: unknown) => (e as Error).message,
            );
        expect(await message(signUp(store, "", ""))).toBe(
            "Signup requires a valid password",
        );
        expect(await message(signUp(store, "not-an-email", "12345"))).toBe(
            "Password should be at least 6 characters.",
        );
    });

    test("invalid email uses GoTrue validateEmail message", async () => {
        const store = createMemoryAuthStore();
        await expect(signUp(store, "not-an-email", "secret12")).rejects.toThrow(
            "Unable to validate email address: invalid format",
        );
    });

    test("email format matches checkmail rules", async () => {
        const store = createMemoryAuthStore();
        await expect(
            signUp(store, "user@localhost", "secret12"),
        ).resolves.toBeTruthy();
        await expect(
            signUp(store, "space @example.com", "secret12"),
        ).rejects.toThrow("Unable to validate email address: invalid format");
        await expect(
            signUp(store, "a@@example.com", "secret12"),
        ).rejects.toThrow("Unable to validate email address: invalid format");
        await expect(
            signUp(store, "üser@example.com", "secret12"),
        ).rejects.toThrow("Unable to validate email address: invalid format");
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
        let verifyHash = "";
        await expect(
            signIn(store, "ghost@example.com", "secret12", {
                verify: async (_password, hash) => {
                    verifyCalls += 1;
                    verifyHash = hash;
                    return false;
                },
            }),
        ).rejects.toBeInstanceOf(SignInError);
        expect(verifyCalls).toBe(1);
        expect(verifyHash).toBe(DUMMY_PASSWORD_HASH);
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
