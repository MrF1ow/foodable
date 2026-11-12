import {
    AlreadyRegisteredError,
    type AuthStore,
    normalizeEmail,
    signIn as domainSignIn,
    signUp as domainSignUp,
    type SignInOptions,
} from "../domain/auth.js";
import { runAsSystem } from "./actor.js";
import { maybeOne, one, pgCode, rows, run, type Tx } from "./sql.js";

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

/**
 * Stamps `last_seen_at` when it is empty or at least `minIntervalMs` old, so
 * callers that race on one user write once between them. Returns whether a row
 * was written. Runs as the system: the caller has already read the session.
 */
export async function touchUserSeen(
    userId: string,
    at: Date,
    minIntervalMs: number,
): Promise<boolean> {
    const staleBefore = new Date(at.getTime() - minIntervalMs);
    return runAsSystem("record user activity", () =>
        run(async (tx) => {
            const touched = await rows<{ id: string }>(
                tx,
                tx`
                    update public.users
                    set last_seen_at = ${at.toISOString()}
                    where id = ${userId}
                      and (last_seen_at is null or last_seen_at <= ${staleBefore.toISOString()})
                    returning id
                `,
            );
            return touched.length > 0;
        }),
    );
}

/**
 * When each member of a household was last active, by user id; null means
 * never. Runs as the system because a user's row is only visible to that user,
 * and is scoped to the household's own members.
 */
export async function listMembersLastSeen(
    householdId: string,
): Promise<Map<string, Date | null>> {
    return runAsSystem("list household members last active", () =>
        run(async (tx) => {
            const found = await rows<{ id: string; last_seen_at: Date | null }>(
                tx,
                tx`
                    select u.id, u.last_seen_at
                    from public.users u
                    join public.household_members m on m.user_id = u.id
                    where m.household_id = ${householdId}
                `,
            );
            return new Map(
                found.map((row) => [
                    row.id,
                    row.last_seen_at == null
                        ? null
                        : new Date(row.last_seen_at),
                ]),
            );
        }),
    );
}
