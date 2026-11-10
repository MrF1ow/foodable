import {
    AlreadyRegisteredError,
    type AuthStore,
    normalizeEmail,
    signIn as domainSignIn,
    signUp as domainSignUp,
    type SignInOptions,
} from "../domain/auth.js";
import { maybeOne, one, pgCode, run, type Tx } from "./sql.js";

export function liveAuthStore(): AuthStore {
    return {
        findByEmail: (emailLower) => findUserByEmail(emailLower),
        insertUser: (input) => insertAuthUser(input),
        updatePasswordHash: (id, hash) => updateAuthPasswordHash(id, hash),
        countUsers: () => countAuthUsersInDb(),
        deleteUser: (id) => deleteAuthUser(id),
    };
}

async function findUserByEmail(
    emailLower: string,
): Promise<{ id: string; email: string; passwordHash: string | null } | null> {
    return run(async (tx) => {
        const row = await maybeOne<{
            id: string;
            email: string | null;
            password_hash: string | null;
        }>(
            tx,
            tx`
                select id, email, password_hash
                from public.users
                where lower(email) = ${emailLower}
            `,
            "find user by email",
        );
        if (!row?.email) return null;
        return {
            id: row.id,
            passwordHash: row.password_hash,
            email: row.email,
        };
    });
}

async function insertAuthUser(input: {
    email: string;
    passwordHash: string;
}): Promise<string> {
    return run(async (tx) => {
        try {
            const row = await one<{ id: string }>(
                tx,
                tx`
                    insert into public.users (email, password_hash)
                    values (${input.email}, ${input.passwordHash})
                    returning id
                `,
                "insert user",
            );
            return row.id;
        } catch (err) {
            if (pgCode(err) === "23505") {
                throw new AlreadyRegisteredError("User already registered");
            }
            throw err;
        }
    });
}

async function updateAuthPasswordHash(id: string, hash: string): Promise<void> {
    await run(async (tx) => {
        await tx`
            update public.users
            set password_hash = ${hash}, updated_at = now()
            where id = ${id}
        `;
    });
}

async function countAuthUsersInDb(): Promise<number> {
    return run(async (tx) => {
        const row = await one<{ count: number }>(
            tx,
            tx`select count(*)::int as count from public.users`,
            "count users",
        );
        return row.count;
    });
}

export async function deleteAuthUser(
    userId: string,
    tx?: Tx,
): Promise<boolean> {
    const exec = async (conn: Tx): Promise<boolean> => {
        const rows = await conn`
            delete from public.users
            where id = ${userId}
            returning id
        `;
        return rows.length > 0;
    };
    if (tx) return exec(tx);
    return run(exec);
}

export async function signUpUser(
    email: string,
    password: string,
): Promise<string> {
    return domainSignUp(liveAuthStore(), email, password);
}

export async function signInUser(
    email: string,
    password: string,
    opts?: SignInOptions,
): Promise<string> {
    return domainSignIn(liveAuthStore(), email, password, opts);
}

/** Whether a login exists for this email (case-insensitive). */
export async function authAccountExists(email: string): Promise<boolean> {
    return (await findUserByEmail(normalizeEmail(email))) != null;
}

export async function authUserCount(): Promise<number> {
    return countAuthUsersInDb();
}
