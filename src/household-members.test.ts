import { test, expect } from "bun:test";
import {
    addHouseholdMember,
    authEmailForLogin,
    authEmailForSignIn,
    checkManagedMember,
    parseMemberInput,
    type AddMemberRpc,
    type AuthUserAdmin,
    type MemberDraft,
} from "./household.js";

function emailDraft(over: Partial<MemberDraft> = {}): MemberDraft {
    return {
        displayName: "Sam",
        login: { kind: "email", email: "sam@example.com" },
        password: "password1",
        ...over,
    };
}

function usernameDraft(over: Partial<MemberDraft> = {}): MemberDraft {
    return {
        displayName: "Sam",
        login: { kind: "username", username: "sam" },
        password: "password1",
        ...over,
    };
}

function memoryAuth(): {
    users: Map<string, { email: string; password: string }>;
    auth: AuthUserAdmin;
} {
    const users = new Map<string, { email: string; password: string }>();
    return {
        users,
        auth: {
            async createUser({ email, password }) {
                for (const row of users.values()) {
                    if (row.email === email) {
                        return {
                            ok: false,
                            alreadyRegistered: true,
                            error: "User already registered",
                        };
                    }
                }
                const userId = crypto.randomUUID();
                users.set(userId, { email, password });
                return { ok: true, userId };
            },
            async deleteUser(userId) {
                users.delete(userId);
            },
        },
    };
}

function memoryRpc(fail = false): {
    members: Map<string, { householdId: string; displayName: string }>;
    rpc: AddMemberRpc;
} {
    const members = new Map<
        string,
        { householdId: string; displayName: string }
    >();
    return {
        members,
        rpc: {
            async insertMember({ householdId, userId, displayName }) {
                if (fail) {
                    return { ok: false, error: "rpc failed" };
                }
                members.set(userId, { householdId, displayName });
                return { ok: true, userId };
            },
        },
    };
}

test("username login becomes the household.invalid Auth email", () => {
    expect(
        parseMemberInput({
            display_name: "Sam",
            username: "sam",
            password: "password1",
        }),
    ).toEqual({
        ok: true,
        value: usernameDraft(),
    });
    expect(authEmailForLogin({ kind: "username", username: "sam" })).toBe(
        "sam@household.invalid",
    );
});

test("the login form signs a bare username in as its household.invalid email", () => {
    expect(authEmailForSignIn("sam")).toBe("sam@household.invalid");
    expect(authEmailForSignIn("  Sam ")).toBe("sam@household.invalid");
    expect(authEmailForSignIn("sam.k_2")).toBe("sam.k_2@household.invalid");
    // Whatever Settings stored for a username, sign-in reaches the same email.
    expect(authEmailForSignIn("sam")).toBe(
        authEmailForLogin({ kind: "username", username: "sam" }),
    );
});

test("the login form passes emails through and leaves non-usernames alone", () => {
    expect(authEmailForSignIn("Sam@Example.com ")).toBe("sam@example.com");
    expect(authEmailForSignIn("sam@household.invalid")).toBe(
        "sam@household.invalid",
    );
    // Not a valid username, so no synthetic email is invented for it.
    expect(authEmailForSignIn("a")).toBe("a");
    expect(authEmailForSignIn("has space")).toBe("has space");
    expect(authEmailForSignIn("")).toBe("");
});

test("email login keeps the real address and rejects a username in the same call", () => {
    expect(
        parseMemberInput({
            display_name: "Sam",
            email: "Sam@Example.com",
            password: "password1",
        }),
    ).toEqual({
        ok: true,
        value: emailDraft(),
    });
    expect(
        parseMemberInput({
            display_name: "Sam",
            email: "sam@example.com",
            username: "sam",
            password: "password1",
        }),
    ).toEqual({
        ok: false,
        error: "Enter an email or username.",
    });
});

test("the Settings form's single login field is an email when it has an @", () => {
    expect(
        parseMemberInput({
            display_name: "Sam",
            login: "sam",
            password: "password1",
            email: "",
            username: "",
        }),
    ).toEqual({ ok: true, value: usernameDraft() });
    expect(
        parseMemberInput({
            display_name: "Sam",
            login: " Sam@Example.com ",
            password: "password1",
        }),
    ).toEqual({ ok: true, value: emailDraft() });
    expect(
        parseMemberInput({
            display_name: "Sam",
            login: "",
            password: "password1",
        }),
    ).toEqual({ ok: false, error: "Enter an email or username." });
});

test("addHouseholdMember with a username stores only the display name on the member row", async () => {
    const { users, auth } = memoryAuth();
    const { members, rpc } = memoryRpc();
    const result = await addHouseholdMember(
        { auth, rpc },
        "hh-1",
        usernameDraft(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(users.get(result.userId)).toEqual({
        email: "sam@household.invalid",
        password: "password1",
    });
    expect(members.get(result.userId)).toEqual({
        householdId: "hh-1",
        displayName: "Sam",
    });
});

test("addHouseholdMember with an email stores that Auth email", async () => {
    const { users, auth } = memoryAuth();
    const { members, rpc } = memoryRpc();
    const result = await addHouseholdMember(
        { auth, rpc },
        "hh-1",
        emailDraft(),
    );
    expect(result).toEqual({
        ok: true,
        userId: [...users.keys()][0]!,
    });
    if (!result.ok) return;
    expect(users.get(result.userId)).toEqual({
        email: "sam@example.com",
        password: "password1",
    });
    expect(members.get(result.userId)).toEqual({
        householdId: "hh-1",
        displayName: "Sam",
    });
});

test("RPC failure deletes the Auth user and inserts no member", async () => {
    const { users, auth } = memoryAuth();
    const { members, rpc } = memoryRpc(true);
    const result = await addHouseholdMember(
        { auth, rpc },
        "hh-1",
        usernameDraft(),
    );
    expect(result).toEqual({ ok: false, error: "rpc failed" });
    expect([...users.entries()]).toEqual([]);
    expect([...members.entries()]).toEqual([]);
});

test("a duplicate Auth email returns an error and leaves the first user", async () => {
    const { users, auth } = memoryAuth();
    const { members, rpc } = memoryRpc();
    const first = await addHouseholdMember({ auth, rpc }, "hh-1", emailDraft());
    expect(first.ok).toBe(true);
    const second = await addHouseholdMember(
        { auth, rpc },
        "hh-1",
        emailDraft({ displayName: "Other" }),
    );
    expect(second).toEqual({
        ok: false,
        error: "That login is already in use.",
    });
    expect(users.size).toBe(1);
    expect(members.size).toBe(1);
    if (!first.ok) return;
    expect(members.get(first.userId)).toEqual({
        householdId: "hh-1",
        displayName: "Sam",
    });
});

const OWNER = {
    householdId: "hh-1",
    userId: "owner-1",
    role: "owner" as const,
    displayName: "Alice",
};
const MEMBER = {
    householdId: "hh-1",
    userId: "member-1",
    role: "member" as const,
    displayName: "Bob",
};

test("the owner may transfer to or remove another member", () => {
    expect(checkManagedMember(OWNER, MEMBER, "transfer")).toEqual({
        ok: true,
        target: MEMBER,
    });
    expect(checkManagedMember(OWNER, MEMBER, "remove")).toEqual({
        ok: true,
        target: MEMBER,
    });
});

test("only the owner may manage members", () => {
    expect(checkManagedMember(MEMBER, OWNER, "remove")).toEqual({
        ok: false,
        error: "Only the household owner can do that.",
    });
});

test("the target must be in the owner's household", () => {
    expect(checkManagedMember(OWNER, null, "transfer").ok).toBe(false);
    expect(
        checkManagedMember(OWNER, { ...MEMBER, householdId: "hh-2" }, "remove")
            .ok,
    ).toBe(false);
});

test("the owner cannot transfer to or remove themselves", () => {
    expect(checkManagedMember(OWNER, OWNER, "transfer")).toEqual({
        ok: false,
        error: "You are already the owner.",
    });
    expect(checkManagedMember(OWNER, OWNER, "remove")).toEqual({
        ok: false,
        error: "You can't remove yourself. Make someone else the owner first.",
    });
});
