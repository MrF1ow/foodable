import crypto from "node:crypto";
import { AlreadyRegisteredError, signUp } from "../domain/auth.js";
import { runAsSystem } from "./actor.js";
import { liveAuthStore } from "./users.js";
import { maybeOne, rows, run } from "./sql.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type HouseholdInvite = {
    id: string;
    householdId: string;
    createdBy: string | null;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    usedBy: string | null;
};

export function hashInviteCode(code: string): string {
    return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

export function generateInviteCode(): string {
    return crypto.randomBytes(16).toString("base64url");
}

function rowToInvite(row: {
    id: unknown;
    household_id: unknown;
    created_by: unknown;
    created_at: unknown;
    expires_at: unknown;
    used_at: unknown;
    used_by: unknown;
}): HouseholdInvite {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        createdBy: row.created_by == null ? null : String(row.created_by),
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        usedBy: row.used_by == null ? null : String(row.used_by),
        usedAt: row.used_at == null ? null : String(row.used_at),
    };
}

export async function listHouseholdInvites(
    householdId: string,
): Promise<HouseholdInvite[]> {
    return run(async (tx) => {
        const data = await rows(
            tx,
            tx`
                select
                    id,
                    household_id,
                    created_by,
                    created_at,
                    expires_at,
                    used_at,
                    used_by
                from public.household_invites
                where household_id = ${householdId}
                order by created_at desc
            `,
        );
        return data.map((row) => rowToInvite(row as never));
    });
}

export async function createHouseholdInvite(
    householdId: string,
    createdBy: string,
): Promise<{ invite: HouseholdInvite; code: string }> {
    const code = generateInviteCode();
    const codeHash = hashInviteCode(code);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    return run(async (tx) => {
        const data = await maybeOne(
            tx,
            tx`
                insert into public.household_invites (
                    household_id,
                    code_hash,
                    created_by,
                    expires_at
                )
                values (
                    ${householdId},
                    ${codeHash},
                    ${createdBy},
                    ${expiresAt}
                )
                returning
                    id,
                    household_id,
                    created_by,
                    created_at,
                    expires_at,
                    used_at,
                    used_by
            `,
            "create household invite",
        );
        if (!data) {
            throw new Error("Could not create invite.");
        }
        return { invite: rowToInvite(data as never), code };
    });
}

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` can name an invite: anything else would fail the uuid cast. */
export function isInviteId(id: string): boolean {
    return UUID_RE.test(id);
}

export async function revokeHouseholdInvite(
    householdId: string,
    inviteId: string,
): Promise<boolean> {
    // A malformed id names no invite; sending it would fail the uuid cast.
    if (!isInviteId(inviteId)) return false;
    return run(async (tx) => {
        const data = await maybeOne<{ id: string }>(
            tx,
            tx`
                delete from public.household_invites
                where id = ${inviteId}
                  and household_id = ${householdId}
                  and used_at is null
                returning id
            `,
            "revoke household invite",
        );
        return data != null;
    });
}

/** Checks whether a plaintext code could still be redeemed (does not consume). */
export async function peekInviteCode(
    code: string,
): Promise<{ valid: true } | { valid: false }> {
    const trimmed = code.trim();
    if (!trimmed) return { valid: false };
    const codeHash = hashInviteCode(trimmed);
    return runAsSystem("peek invite code", async () =>
        run(async (tx) => {
            const data = await maybeOne<{ id: string }>(
                tx,
                tx`
                    select id
                    from public.household_invites
                    where code_hash = ${codeHash}
                      and used_at is null
                      and expires_at > now()
                `,
                "peek invite",
            );
            return data ? { valid: true as const } : { valid: false as const };
        }),
    );
}

export type InviteSignUpResult =
    | { ok: true; userId: string; householdId: string }
    | { ok: false; reason: "invalid-invite" | "already-registered" };

/**
 * Sign up with an invite, all or nothing, in one system transaction:
 * claim the code (the row lock makes it single-use), create the login, add
 * the membership, then record who used the code. A failure after the claim
 * rolls everything back, so the code stays unused and no login is left
 * without a household. `hooks.afterClaim` is for tests only.
 */
export async function signUpWithInvite(
    args: {
        code: string;
        email: string;
        password: string;
        displayName: string;
    },
    hooks?: { afterClaim?: () => Promise<void> },
): Promise<InviteSignUpResult> {
    const trimmed = args.code.trim();
    if (!trimmed) return { ok: false, reason: "invalid-invite" };
    const codeHash = hashInviteCode(trimmed);
    try {
        return await runAsSystem("signing up with an invite code", () =>
            run(async (tx) => {
                const claimed = await maybeOne<{
                    id: string;
                    household_id: string;
                }>(
                    tx,
                    tx`
                        update public.household_invites
                        set used_at = now()
                        where code_hash = ${codeHash}
                          and used_at is null
                          and expires_at > now()
                        returning id, household_id
                    `,
                    "claim invite",
                );
                if (!claimed) {
                    return {
                        ok: false as const,
                        reason: "invalid-invite" as const,
                    };
                }
                await hooks?.afterClaim?.();
                // Nested run() calls reuse this transaction (same actor, same pool).
                const userId = await signUp(
                    liveAuthStore(),
                    args.email,
                    args.password,
                );
                await tx`
                    select public.add_household_member(
                        p_household_id => ${claimed.household_id}::uuid,
                        p_auth_user_id => ${userId}::uuid,
                        p_display_name => ${args.displayName}
                    )
                `;
                await tx`
                    update public.household_invites
                    set used_by = ${userId}::uuid
                    where id = ${claimed.id}::uuid
                `;
                return {
                    ok: true as const,
                    userId,
                    householdId: String(claimed.household_id),
                };
            }),
        );
    } catch (err) {
        // signUp rewrites the store's AlreadyRegisteredError as GoTrue's message.
        if (
            err instanceof AlreadyRegisteredError ||
            (err instanceof Error && err.message === "User already registered")
        ) {
            return { ok: false, reason: "already-registered" };
        }
        throw err;
    }
}
