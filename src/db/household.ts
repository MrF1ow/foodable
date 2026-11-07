import {
    addHouseholdMember,
    householdConfigFromRow,
    householdConfigToColumns,
    HouseholdAlreadyExistsError,
    type AddMemberResult,
    type AddMemberRpc,
    type AuthUserAdmin,
    type HouseholdConfig,
    type MemberDraft,
    type MemberRole,
} from "../household.js";
import { AlreadyRegisteredError, signUp } from "../domain/auth.js";
import { liveAuthStore } from "./users.js";
import { getProfile, type Profile } from "./profiles.js";
import { maybeOne, rows, run } from "./sql.js";

export type HouseholdMembership = {
    householdId: string;
    userId: string;
    role: MemberRole;
    displayName: string;
};

const HOUSEHOLD_MEMBERS = "household_members";
const HOUSEHOLDS = "households";
const MEMBER_COLS = "household_id, user_id, role, display_name";

export async function getHouseholdMembership(
    userId: string,
    householdId?: string,
): Promise<HouseholdMembership | null> {
    return run(async (tx) => {
        try {
            const data = await maybeOne<{
                household_id: string;
                user_id: string;
                role: MemberRole;
                display_name: string;
            }>(
                tx,
                householdId != null
                    ? tx`
                          select ${tx.unsafe(MEMBER_COLS)}
                          from ${tx.unsafe(HOUSEHOLD_MEMBERS)}
                          where user_id = ${userId}
                            and household_id = ${householdId}
                      `
                    : tx`
                          select ${tx.unsafe(MEMBER_COLS)}
                          from ${tx.unsafe(HOUSEHOLD_MEMBERS)}
                          where user_id = ${userId}
                      `,
                "load household membership",
            );
            if (!data) return null;
            return membershipFromRow(data);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to load household membership: ${message}`);
        }
    });
}

export async function householdExists(): Promise<boolean> {
    return run(async (tx) => {
        try {
            const data = await maybeOne<{ id: string }>(
                tx,
                tx`
                    select id
                    from ${tx.unsafe(HOUSEHOLDS)}
                    limit 1
                `,
                "load household",
            );
            return data != null;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to load household: ${message}`);
        }
    });
}

export async function createHouseholdForCaller(
    userId: string,
    name: string,
    displayName: string,
): Promise<string> {
    return run(async (tx) => {
        try {
            const data = await maybeOne<{ id: string }>(
                tx,
                tx`
                    select public.create_household(
                        p_user_id => ${userId}::uuid,
                        p_name => ${name},
                        p_display_name => ${displayName}
                    ) as id
                `,
                "create household",
            );
            if (typeof data?.id !== "string" || data.id.length === 0) {
                throw new Error("Could not create the household.");
            }
            return data.id;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.toLowerCase().includes("household already exists")) {
                throw new HouseholdAlreadyExistsError();
            }
            throw new Error(message);
        }
    });
}

function membershipFromRow(data: {
    household_id: unknown;
    user_id: unknown;
    role: unknown;
    display_name: unknown;
}): HouseholdMembership {
    return {
        householdId: data.household_id as string,
        userId: data.user_id as string,
        role: data.role as MemberRole,
        displayName: data.display_name as string,
    };
}

export async function listHouseholdMembers(
    householdId: string,
): Promise<HouseholdMembership[]> {
    return run(async (tx) => {
        try {
            const data = await rows(
                tx,
                tx`
                    select ${tx.unsafe(MEMBER_COLS)}
                    from ${tx.unsafe(HOUSEHOLD_MEMBERS)}
                    where household_id = ${householdId}
                    order by display_name asc
                `,
            );
            return data.map((row) => membershipFromRow(row as never));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to list household members: ${message}`);
        }
    });
}

export async function getHouseholdOwnerProfile(
    householdId: string,
): Promise<Profile | null> {
    const members = await listHouseholdMembers(householdId);
    const owner = members.find((member) => member.role === "owner");
    if (!owner) return null;
    return getProfile(owner.userId);
}

function alreadyRegistered(message: string): boolean {
    const lower = message.toLowerCase();
    return (
        lower.includes("already been registered") ||
        lower.includes("already registered")
    );
}

function friendlyMemberError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes("already in use")) {
        return "That login is already in use.";
    }
    if (lower.includes("not a household member")) {
        return "You must be a household member to add people.";
    }
    return message;
}

function liveAuthAdmin(): AuthUserAdmin {
    const store = liveAuthStore();
    return {
        async createUser({ email, password }) {
            try {
                const userId = await signUp(store, email, password);
                return { ok: true, userId };
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                if (
                    err instanceof AlreadyRegisteredError ||
                    alreadyRegistered(message)
                ) {
                    return {
                        ok: false,
                        alreadyRegistered: true,
                        error: message,
                    };
                }
                return {
                    ok: false,
                    alreadyRegistered: false,
                    error: message,
                };
            }
        },
        async deleteUser(userId) {
            const deleted = await store.deleteUser(userId);
            if (!deleted) {
                throw new Error("User not found");
            }
        },
    };
}

function liveAddMemberRpc(): AddMemberRpc {
    return {
        async insertMember({ householdId, userId, displayName }) {
            try {
                const data = await run(async (tx) => {
                    return await maybeOne<{ id: string }>(
                        tx,
                        tx`
                            select public.add_household_member(
                                p_household_id => ${householdId}::uuid,
                                p_auth_user_id => ${userId}::uuid,
                                p_display_name => ${displayName}
                            ) as id
                        `,
                        "add household member",
                    );
                });
                if (typeof data?.id !== "string" || data.id.length === 0) {
                    return {
                        ok: false,
                        error: "Could not add the household member.",
                    };
                }
                return { ok: true, userId: data.id };
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                return {
                    ok: false,
                    error: friendlyMemberError(message),
                };
            }
        },
    };
}

export async function addHouseholdMemberForHousehold(
    householdId: string,
    draft: MemberDraft,
    deps?: { auth: AuthUserAdmin; rpc?: AddMemberRpc },
): Promise<AddMemberResult> {
    return addHouseholdMember(
        {
            auth: deps?.auth ?? liveAuthAdmin(),
            rpc: deps?.rpc ?? liveAddMemberRpc(),
        },
        householdId,
        draft,
    );
}

export async function getHouseholdConfig(
    householdId: string,
): Promise<HouseholdConfig> {
    return run(async (tx) => {
        let data;
        try {
            data = await maybeOne(
                tx,
                tx`
                    select name, recipe_search_places, household_preferences
                    from ${tx.unsafe(HOUSEHOLDS)}
                    where id = ${householdId}
                `,
                "load household config",
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to load household config: ${message}`);
        }
        if (!data) {
            throw new Error("Failed to load household config");
        }
        const parsed = householdConfigFromRow(data as never);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
    });
}

export async function updateHouseholdConfig(
    householdId: string,
    config: HouseholdConfig,
): Promise<HouseholdConfig> {
    return run(async (tx) => {
        const columns = householdConfigToColumns(config);
        let data;
        try {
            data = await maybeOne(
                tx,
                tx`
                    update ${tx.unsafe(HOUSEHOLDS)}
                    set
                        name = ${columns.name},
                        recipe_search_places = ${JSON.stringify(
                            columns.recipe_search_places,
                        )}::jsonb,
                        household_preferences = ${JSON.stringify(
                            columns.household_preferences,
                        )}::jsonb
                    where id = ${householdId}
                    returning name, recipe_search_places, household_preferences
                `,
                "update household config",
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to update household config: ${message}`);
        }
        if (!data) {
            throw new Error("Failed to update household config");
        }
        const parsed = householdConfigFromRow(data as never);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
    });
}

export async function rotateHouseholdMcpToken(args: {
    householdId: string;
    tokenHashHex: string;
    issuedBy: string | null;
}): Promise<string> {
    return run(async (tx) => {
        try {
            const data = await maybeOne<{ issued_at: string }>(
                tx,
                tx`
                    select public.rotate_household_mcp_token(
                        p_household_id => ${args.householdId}::uuid,
                        p_token_hash_hex => ${args.tokenHashHex},
                        p_issued_by => ${args.issuedBy}::uuid
                    ) as issued_at
                `,
                "rotate household mcp token",
            );
            if (
                typeof data?.issued_at !== "string" ||
                data.issued_at.length === 0
            ) {
                throw new Error(
                    "Failed to rotate household token: empty issued_at",
                );
            }
            return data.issued_at;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (
                message === "Failed to rotate household token: empty issued_at"
            ) {
                throw err instanceof Error ? err : new Error(message);
            }
            throw new Error(`Failed to rotate household token: ${message}`);
        }
    });
}

export async function updateMemberDisplayName(
    householdId: string,
    userId: string,
    displayName: string,
): Promise<void> {
    return run(async (tx) => {
        try {
            await tx`
                update ${tx.unsafe(HOUSEHOLD_MEMBERS)}
                set display_name = ${displayName}
                where household_id = ${householdId}
                  and user_id = ${userId}
            `;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to update display name: ${message}`);
        }
    });
}

// Hands the owner role to another member in one transaction. The database
// re-checks that `fromUserId` is the owner and `toUserId` a member, so a stale
// page cannot move ownership it no longer holds.
export async function transferHouseholdOwnership(
    householdId: string,
    fromUserId: string,
    toUserId: string,
): Promise<void> {
    return run(async (tx) => {
        try {
            await tx`
                select public.transfer_household_ownership(
                    p_household_id => ${householdId}::uuid,
                    p_from_user_id => ${fromUserId}::uuid,
                    p_to_user_id => ${toUserId}::uuid
                )
            `;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to transfer ownership: ${message}`);
        }
    });
}

// Moves a member between admin and member. The owner row is excluded in the
// query itself, so a stale page cannot demote the owner through this path;
// ownership only moves through transfer_household_ownership.
export async function setHouseholdMemberRole(
    householdId: string,
    userId: string,
    role: "admin" | "member",
): Promise<void> {
    return run(async (tx) => {
        try {
            const updated = await rows<{ user_id: string }>(
                tx,
                tx`
                    update ${tx.unsafe(HOUSEHOLD_MEMBERS)}
                    set role = ${role}
                    where household_id = ${householdId}
                      and user_id = ${userId}
                      and role <> 'owner'
                    returning user_id
                `,
            );
            if (updated.length === 0) {
                throw new Error("That person is not a member you can change.");
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === "That person is not a member you can change.") {
                throw err;
            }
            throw new Error(`Failed to change role: ${message}`);
        }
    });
}
