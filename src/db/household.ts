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
import { getSupabase } from "./client.js";

export type HouseholdMembership = {
    householdId: string;
    userId: string;
    role: MemberRole;
    displayName: string;
};

export async function getHouseholdMembership(
    userId: string,
    householdId?: string,
): Promise<HouseholdMembership | null> {
    let query = getSupabase()
        .from("household_members")
        .select("household_id, user_id, role, display_name")
        .eq("user_id", userId);
    if (householdId != null) {
        query = query.eq("household_id", householdId);
    }
    const { data, error } = await query.maybeSingle();

    if (error) {
        throw new Error(
            `Failed to load household membership: ${error.message}`,
        );
    }
    if (!data) return null;
    return membershipFromRow(data);
}

export async function householdExists(): Promise<boolean> {
    const { data, error } = await getSupabase()
        .from("households")
        .select("id")
        .limit(1)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to load household: ${error.message}`);
    }
    return data != null;
}

export async function createHouseholdForCaller(
    userId: string,
    name: string,
    displayName: string,
): Promise<string> {
    const { data, error } = await getSupabase().rpc("create_household", {
        p_user_id: userId,
        p_name: name,
        p_display_name: displayName,
    });
    if (error) {
        if (error.message.toLowerCase().includes("household already exists")) {
            throw new HouseholdAlreadyExistsError();
        }
        throw new Error(error.message);
    }
    if (typeof data !== "string" || data.length === 0) {
        throw new Error("Could not create the household.");
    }
    return data;
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
    const { data, error } = await getSupabase()
        .from("household_members")
        .select("household_id, user_id, role, display_name")
        .eq("household_id", householdId)
        .order("display_name", { ascending: true });

    if (error) {
        throw new Error(`Failed to list household members: ${error.message}`);
    }
    return (data ?? []).map((row) => membershipFromRow(row));
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
    return {
        async createUser({ email, password }) {
            const created = await getSupabase().auth.admin.createUser({
                email,
                password,
                email_confirm: true,
            });
            if (created.error) {
                return {
                    ok: false,
                    alreadyRegistered: alreadyRegistered(created.error.message),
                    error: created.error.message,
                };
            }
            const userId = created.data.user?.id;
            if (!userId) {
                return {
                    ok: false,
                    alreadyRegistered: false,
                    error: "Could not create the login.",
                };
            }
            return { ok: true, userId };
        },
        async deleteUser(userId) {
            const { error } = await getSupabase().auth.admin.deleteUser(userId);
            if (error) throw new Error(error.message);
        },
    };
}

function liveAddMemberRpc(): AddMemberRpc {
    return {
        async insertMember({ householdId, userId, displayName }) {
            const { data, error } = await getSupabase().rpc(
                "add_household_member",
                {
                    p_household_id: householdId,
                    p_auth_user_id: userId,
                    p_display_name: displayName,
                },
            );
            if (error || typeof data !== "string" || data.length === 0) {
                return {
                    ok: false,
                    error: error
                        ? friendlyMemberError(error.message)
                        : "Could not add the household member.",
                };
            }
            return { ok: true, userId: data };
        },
    };
}

export async function addHouseholdMemberForHousehold(
    householdId: string,
    draft: MemberDraft,
): Promise<AddMemberResult> {
    return addHouseholdMember(
        { auth: liveAuthAdmin(), rpc: liveAddMemberRpc() },
        householdId,
        draft,
    );
}

export async function getHouseholdConfig(
    householdId: string,
): Promise<HouseholdConfig> {
    const { data, error } = await getSupabase()
        .from("households")
        .select(
            "name, fridge_locations, recipe_search_places, household_preferences",
        )
        .eq("id", householdId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load household config: ${error.message}`);
    }
    if (!data) {
        throw new Error("Failed to load household config");
    }
    const parsed = householdConfigFromRow(data);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
}

export async function updateHouseholdConfig(
    householdId: string,
    config: HouseholdConfig,
): Promise<HouseholdConfig> {
    const columns = householdConfigToColumns(config);
    const { data, error } = await getSupabase()
        .from("households")
        .update({
            name: columns.name,
            fridge_locations: columns.fridge_locations,
            recipe_search_places: columns.recipe_search_places,
            household_preferences: columns.household_preferences,
        })
        .eq("id", householdId)
        .select(
            "name, fridge_locations, recipe_search_places, household_preferences",
        )
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to update household config: ${error.message}`);
    }
    if (!data) {
        throw new Error("Failed to update household config");
    }
    const parsed = householdConfigFromRow(data);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
}

export async function rotateHouseholdMcpToken(args: {
    householdId: string;
    tokenHashHex: string;
    issuedBy: string | null;
}): Promise<string> {
    const { data, error } = await getSupabase().rpc(
        "rotate_household_mcp_token",
        {
            p_household_id: args.householdId,
            p_token_hash_hex: args.tokenHashHex,
            p_issued_by: args.issuedBy,
        },
    );

    if (error) {
        throw new Error(`Failed to rotate household token: ${error.message}`);
    }
    if (typeof data !== "string" || data.length === 0) {
        throw new Error("Failed to rotate household token: empty issued_at");
    }
    return data;
}

export async function updateMemberDisplayName(
    householdId: string,
    userId: string,
    displayName: string,
): Promise<void> {
    const { error } = await getSupabase()
        .from("household_members")
        .update({ display_name: displayName })
        .eq("household_id", householdId)
        .eq("user_id", userId);
    if (error) {
        throw new Error(`Failed to update display name: ${error.message}`);
    }
}

// Hands the owner role to another member in one transaction. The database
// re-checks that `fromUserId` is the owner and `toUserId` a member, so a stale
// page cannot move ownership it no longer holds.
export async function transferHouseholdOwnership(
    householdId: string,
    fromUserId: string,
    toUserId: string,
): Promise<void> {
    const { error } = await getSupabase().rpc("transfer_household_ownership", {
        p_household_id: householdId,
        p_from_user_id: fromUserId,
        p_to_user_id: toUserId,
    });
    if (error) {
        throw new Error(`Failed to transfer ownership: ${error.message}`);
    }
}

// Moves a member between admin and member. The owner row is excluded in the
// query itself, so a stale page cannot demote the owner through this path;
// ownership only moves through transfer_household_ownership.
export async function setHouseholdMemberRole(
    householdId: string,
    userId: string,
    role: "admin" | "member",
): Promise<void> {
    const { data, error } = await getSupabase()
        .from("household_members")
        .update({ role })
        .eq("household_id", householdId)
        .eq("user_id", userId)
        .neq("role", "owner")
        .select("user_id");
    if (error) {
        throw new Error(`Failed to change role: ${error.message}`);
    }
    if ((data ?? []).length === 0) {
        throw new Error("That person is not a member you can change.");
    }
}
