import type { AuthContext } from "./auth-context.js";

/** `admin` is an elevated member: they manage the household (settings,
 * stores, everyone's rules, adding people) alongside the owner. Ownership
 * itself (roles, removal, transfer, the bot token) stays with the owner. */
export type MemberRole = "owner" | "admin" | "member";

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;

export type HouseholdMember = {
    householdId: string;
    userId: string;
    role: MemberRole;
    displayName: string;
};

export const RECIPE_PLACE_KINDS = [
    "grocery",
    "recipe_site",
    "meal_kit",
    "other",
] as const;

export type RecipePlaceKind = (typeof RECIPE_PLACE_KINDS)[number];

export type RecipeSearchPlace = {
    name: string;
    kind: RecipePlaceKind;
    url: string | null;
};

export type HouseholdPreferences = {
    constraints: string[];
    budget: string | null;
    shoppingCadence: string | null;
};

export const EMPTY_HOUSEHOLD_PREFERENCES: HouseholdPreferences = {
    constraints: [],
    budget: null,
    shoppingCadence: null,
};

export type HouseholdConfig = {
    name: string;
    fridgeLocations: string[];
    recipeSearchPlaces: RecipeSearchPlace[];
    preferences: HouseholdPreferences;
};

export type Household = HouseholdConfig & { id: string };

export type HouseholdColumns = {
    name: string;
    fridge_locations: string[];
    recipe_search_places: RecipeSearchPlace[];
    household_preferences: HouseholdPreferences;
};

export type HouseholdConfigWire = {
    name: string;
    recipe_search_places: Array<{
        name: string;
        kind: RecipePlaceKind;
        url: string | null;
    }>;
    preferences: {
        constraints: string[];
        budget: string | null;
        shopping_cadence: string | null;
    };
};

export type ParseResult<T> =
    { ok: true; value: T } | { ok: false; error: string };

export type HouseholdPreferencesPatch = {
    constraints?: string[];
    budget?: string | null;
    shoppingCadence?: string | null;
};

export type HouseholdConfigPatch = {
    name?: string;
    fridgeLocations?: string[];
    recipeSearchPlaces?: RecipeSearchPlace[];
    preferences?: HouseholdPreferencesPatch;
};

export type RequireMemberResult =
    | { ok: true; member: HouseholdMember }
    | { ok: false; error: "not_a_member" };

export type RequireOwnerResult =
    | { ok: true; member: HouseholdMember }
    | { ok: false; error: "not_a_member" | "not_owner" };

export type RequireManagerResult =
    | { ok: true; member: HouseholdMember }
    | { ok: false; error: "not_a_member" | "not_manager" };

export class HouseholdAlreadyExistsError extends Error {
    readonly code = "household_already_exists" as const;

    constructor() {
        super("household already exists");
        this.name = "HouseholdAlreadyExistsError";
    }
}

export class DuplicateMembershipError extends Error {
    readonly code = "duplicate_membership" as const;

    constructor() {
        super("membership already exists for this user");
        this.name = "DuplicateMembershipError";
    }
}

export class DuplicateOwnerError extends Error {
    readonly code = "duplicate_owner" as const;

    constructor() {
        super("household already has an owner");
        this.name = "DuplicateOwnerError";
    }
}

export type HouseholdStore = {
    getHousehold(): Household | null;
    insertHousehold(household: Household): void;
    getMember(userId: string): HouseholdMember | null;
    insertMember(member: HouseholdMember): void;
    listMembers(householdId: string): HouseholdMember[];
    deleteUser(userId: string): void;
};

function copyHousehold(household: Household): Household {
    return {
        id: household.id,
        name: household.name,
        fridgeLocations: [...household.fridgeLocations],
        recipeSearchPlaces: household.recipeSearchPlaces.map((place) => ({
            ...place,
        })),
        preferences: {
            constraints: [...household.preferences.constraints],
            budget: household.preferences.budget,
            shoppingCadence: household.preferences.shoppingCadence,
        },
    };
}

export function createMemoryHouseholdStore(): HouseholdStore {
    const households: Household[] = [];
    const members: HouseholdMember[] = [];

    return {
        getHousehold() {
            return households[0] ?? null;
        },
        insertHousehold(household) {
            if (households.length > 0) {
                throw new HouseholdAlreadyExistsError();
            }
            households.push(copyHousehold(household));
        },
        getMember(userId) {
            return members.find((member) => member.userId === userId) ?? null;
        },
        insertMember(member) {
            if (members.some((existing) => existing.userId === member.userId)) {
                throw new DuplicateMembershipError();
            }
            if (
                member.role === "owner" &&
                members.some((existing) => existing.role === "owner")
            ) {
                throw new DuplicateOwnerError();
            }
            members.push({ ...member });
        },
        listMembers(householdId) {
            return members
                .filter((member) => member.householdId === householdId)
                .map((member) => ({ ...member }));
        },
        deleteUser(userId) {
            const index = members.findIndex(
                (member) => member.userId === userId,
            );
            if (index >= 0) members.splice(index, 1);
        },
    };
}

export function getHouseholdId(
    store: HouseholdStore,
    userId: string,
): string | null {
    return store.getMember(userId)?.householdId ?? null;
}

export function listMembers(
    store: HouseholdStore,
    householdId: string,
): HouseholdMember[] {
    return store.listMembers(householdId);
}

export function requireMember(
    store: HouseholdStore,
    userId: string,
): RequireMemberResult {
    return requireMemberOfHousehold(store.getMember(userId), null);
}

export function requireMemberOfHousehold(
    member: HouseholdMember | null | undefined,
    householdId: string | null,
): RequireMemberResult {
    if (member == null) return { ok: false, error: "not_a_member" };
    if (householdId != null && member.householdId !== householdId) {
        return { ok: false, error: "not_a_member" };
    }
    return { ok: true, member };
}

export function requireOwner(
    member: HouseholdMember | null | undefined,
    householdId: string | null = null,
): RequireOwnerResult {
    const check = requireMemberOfHousehold(member, householdId);
    if (!check.ok) return check;
    if (check.member.role !== "owner") {
        return { ok: false, error: "not_owner" };
    }
    return { ok: true, member: check.member };
}

export function canManageHousehold(member: HouseholdMember): boolean {
    return member.role === "owner" || member.role === "admin";
}

/** Owner or admin. */
export function requireManager(
    member: HouseholdMember | null | undefined,
    householdId: string | null = null,
): RequireManagerResult {
    const check = requireMemberOfHousehold(member, householdId);
    if (!check.ok) return check;
    if (!canManageHousehold(check.member)) {
        return { ok: false, error: "not_manager" };
    }
    return { ok: true, member: check.member };
}

/** Anyone edits their own allergens, dislikes and rules; an owner or admin
 * edits anyone's in the same household. */
export function canEditPersonRules(
    actor: HouseholdMember,
    targetUserId: string,
): boolean {
    return actor.userId === targetUserId || canManageHousehold(actor);
}

export type ManagedMemberAction = "transfer" | "remove" | "role";

export type ManagedMemberResult =
    { ok: true; target: HouseholdMember } | { ok: false; error: string };

/** The owner acting on another person: hand them ownership, change their
 * role between admin and member, or remove them.
 * The database enforces the same rules (transfer_household_ownership); this
 * is what turns a bad request into a readable message before it gets there. */
export function checkManagedMember(
    owner: HouseholdMember,
    target: HouseholdMember | null | undefined,
    action: ManagedMemberAction,
): ManagedMemberResult {
    if (owner.role !== "owner") {
        return { ok: false, error: "Only the household owner can do that." };
    }
    if (target == null || target.householdId !== owner.householdId) {
        return { ok: false, error: "That person is not in this household." };
    }
    if (target.userId === owner.userId) {
        return {
            ok: false,
            error:
                action === "transfer"
                    ? "You are already the owner."
                    : action === "role"
                      ? "You are the owner. Transfer ownership to change your role."
                      : "You can't remove yourself. Make someone else the owner first.",
        };
    }
    return { ok: true, target };
}

export type ResolveActorError = "missing_target" | "oauth_mismatch";

export type ActorIntent = "read" | "write";

export type ResolveActorResult =
    | { ok: true; userId: string; membership: "not_required" }
    | {
          ok: true;
          userId: string;
          membership: "required";
          householdId: string;
      }
    | {
          ok: true;
          userId: string;
          membership: "peer";
          viewerUserId: string;
      }
    | { ok: false; error: ResolveActorError };

export function resolveActorUserId(
    auth: AuthContext,
    requestedUserId: string | undefined,
    intent: ActorIntent = "write",
): ResolveActorResult {
    if (auth.kind === "user") {
        if (requestedUserId == null || requestedUserId === auth.userId) {
            return {
                ok: true,
                userId: auth.userId,
                membership: "not_required",
            };
        }
        if (intent === "write") {
            return { ok: false, error: "oauth_mismatch" };
        }
        return {
            ok: true,
            userId: requestedUserId,
            membership: "peer",
            viewerUserId: auth.userId,
        };
    }
    if (requestedUserId == null) {
        return { ok: false, error: "missing_target" };
    }
    return {
        ok: true,
        userId: requestedUserId,
        membership: "required",
        householdId: auth.householdId,
    };
}

export type DashboardAccess =
    | {
          ok: true;
          mode: "self" | "peer";
          viewer: HouseholdMember;
          subject: HouseholdMember;
      }
    | { ok: false; error: "not_a_member" | "not_a_peer" };

export function dashboardAccess(
    viewer: HouseholdMember | null,
    subject: HouseholdMember | null,
): DashboardAccess {
    if (viewer == null) return { ok: false, error: "not_a_member" };
    if (subject == null || subject.userId === viewer.userId) {
        return { ok: true, mode: "self", viewer, subject: viewer };
    }
    if (subject.householdId !== viewer.householdId) {
        return { ok: false, error: "not_a_peer" };
    }
    return { ok: true, mode: "peer", viewer, subject };
}

export function createHousehold(
    store: HouseholdStore,
    userId: string,
    name: string,
    displayName: string,
): string {
    if (store.getHousehold() != null) {
        throw new HouseholdAlreadyExistsError();
    }
    const householdId = crypto.randomUUID();
    store.insertHousehold({
        id: householdId,
        name,
        fridgeLocations: [],
        recipeSearchPlaces: [],
        preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
    });
    store.insertMember({
        householdId,
        userId,
        role: "owner",
        displayName,
    });
    return householdId;
}

export function isRecipePlaceKind(value: string): value is RecipePlaceKind {
    return (RECIPE_PLACE_KINDS as readonly string[]).includes(value);
}

function asStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const items: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") return null;
        items.push(item);
    }
    return items;
}

function optionalText(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function parseRecipePlace(value: unknown): ParseResult<RecipeSearchPlace> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "Unknown recipe place kind." };
    }
    const record = value as { name?: unknown; kind?: unknown; url?: unknown };
    if (typeof record.name !== "string" || !record.name.trim()) {
        return { ok: false, error: "Unknown recipe place kind." };
    }
    if (typeof record.kind !== "string" || !isRecipePlaceKind(record.kind)) {
        return { ok: false, error: "Unknown recipe place kind." };
    }
    let url: string | null = null;
    if (record.url !== undefined && record.url !== null) {
        if (typeof record.url !== "string") {
            return { ok: false, error: "Unknown recipe place kind." };
        }
        url = record.url.trim() ? record.url.trim() : null;
    }
    return {
        ok: true,
        value: {
            name: record.name.trim(),
            kind: record.kind,
            url,
        },
    };
}

export function householdConfigFromRow(row: {
    name: unknown;
    fridge_locations?: unknown;
    recipe_search_places: unknown;
    household_preferences: unknown;
}): ParseResult<HouseholdConfig> {
    if (typeof row.name !== "string" || !row.name.trim()) {
        return { ok: false, error: "Enter a household name." };
    }

    const fridgeLocations = asStringArray(row.fridge_locations ?? []);
    if (!fridgeLocations) {
        return {
            ok: false,
            error: "Fridge locations must be a list of names.",
        };
    }

    if (!Array.isArray(row.recipe_search_places)) {
        return { ok: false, error: "Unknown recipe place kind." };
    }

    const recipeSearchPlaces: RecipeSearchPlace[] = [];
    for (const item of row.recipe_search_places) {
        const parsed = parseRecipePlace(item);
        if (!parsed.ok) return parsed;
        recipeSearchPlaces.push(parsed.value);
    }

    const prefsRaw =
        row.household_preferences === null ||
        row.household_preferences === undefined
            ? {}
            : row.household_preferences;
    if (!prefsRaw || typeof prefsRaw !== "object" || Array.isArray(prefsRaw)) {
        return { ok: false, error: "Household preferences must be an object." };
    }
    const prefs = prefsRaw as {
        constraints?: unknown;
        budget?: unknown;
        shoppingCadence?: unknown;
    };
    const constraints =
        prefs.constraints === undefined ? [] : asStringArray(prefs.constraints);
    if (!constraints) {
        return { ok: false, error: "Constraints must be a list of names." };
    }
    const budget =
        prefs.budget === undefined ? null : optionalText(prefs.budget);
    const shoppingCadence =
        prefs.shoppingCadence === undefined
            ? null
            : optionalText(prefs.shoppingCadence);
    if (budget === undefined || shoppingCadence === undefined) {
        return {
            ok: false,
            error: "Budget and shopping cadence must be text.",
        };
    }

    return {
        ok: true,
        value: {
            name: row.name.trim(),
            fridgeLocations,
            recipeSearchPlaces,
            preferences: {
                constraints,
                budget,
                shoppingCadence,
            },
        },
    };
}

export function householdConfigToColumns(
    config: HouseholdConfig,
): HouseholdColumns {
    return {
        name: config.name,
        fridge_locations: config.fridgeLocations,
        recipe_search_places: config.recipeSearchPlaces,
        household_preferences: config.preferences,
    };
}

export function householdConfigToWire(
    config: HouseholdConfig,
): HouseholdConfigWire {
    return {
        name: config.name,
        recipe_search_places: config.recipeSearchPlaces.map((place) => ({
            name: place.name,
            kind: place.kind,
            url: place.url,
        })),
        preferences: {
            constraints: config.preferences.constraints,
            budget: config.preferences.budget,
            shopping_cadence: config.preferences.shoppingCadence,
        },
    };
}

function parseNameList(value: unknown, error: string): ParseResult<string[]> {
    if (!Array.isArray(value)) return { ok: false, error };
    const items: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") return { ok: false, error };
        const trimmed = item.trim();
        if (trimmed) items.push(trimmed);
    }
    return { ok: true, value: items };
}

export function parseFridgeLocationsInput(
    value: unknown,
): ParseResult<string[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            ok: false,
            error: "Fridge locations must be a list of names.",
        };
    }
    const record = value as { locations?: unknown };
    return parseNameList(
        record.locations,
        "Fridge locations must be a list of names.",
    );
}

function parseHouseholdPreferencesPatch(
    value: unknown,
): ParseResult<HouseholdPreferencesPatch> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "Household preferences must be an object." };
    }
    const prefs = value as {
        constraints?: unknown;
        budget?: unknown;
        shoppingCadence?: unknown;
        shopping_cadence?: unknown;
    };
    const patch: HouseholdPreferencesPatch = {};
    if (prefs.constraints !== undefined) {
        const constraints = parseNameList(
            prefs.constraints,
            "Constraints must be a list of names.",
        );
        if (!constraints.ok) return constraints;
        patch.constraints = constraints.value;
    }
    const budgetRaw = prefs.budget !== undefined ? prefs.budget : undefined;
    if (budgetRaw !== undefined) {
        const budget = optionalText(budgetRaw);
        if (budget === undefined) {
            return {
                ok: false,
                error: "Budget and shopping cadence must be text.",
            };
        }
        patch.budget = budget;
    }
    const cadenceRaw =
        prefs.shoppingCadence !== undefined
            ? prefs.shoppingCadence
            : prefs.shopping_cadence;
    if (cadenceRaw !== undefined) {
        const shoppingCadence = optionalText(cadenceRaw);
        if (shoppingCadence === undefined) {
            return {
                ok: false,
                error: "Budget and shopping cadence must be text.",
            };
        }
        patch.shoppingCadence = shoppingCadence;
    }
    return { ok: true, value: patch };
}

export function parseHouseholdConfigPatch(
    value: unknown,
): ParseResult<HouseholdConfigPatch> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "Household config must be an object." };
    }
    const record = value as {
        name?: unknown;
        recipeSearchPlaces?: unknown;
        recipe_search_places?: unknown;
        preferences?: unknown;
    };
    const patch: HouseholdConfigPatch = {};
    if (record.name !== undefined) {
        if (typeof record.name !== "string" || !record.name.trim()) {
            return { ok: false, error: "Enter a household name." };
        }
        patch.name = record.name.trim();
    }
    const placesRaw =
        record.recipeSearchPlaces !== undefined
            ? record.recipeSearchPlaces
            : record.recipe_search_places;
    if (placesRaw !== undefined) {
        if (!Array.isArray(placesRaw)) {
            return { ok: false, error: "Unknown recipe place kind." };
        }
        const recipeSearchPlaces: RecipeSearchPlace[] = [];
        for (const item of placesRaw) {
            const parsed = parseRecipePlace(item);
            if (!parsed.ok) return parsed;
            recipeSearchPlaces.push(parsed.value);
        }
        patch.recipeSearchPlaces = recipeSearchPlaces;
    }
    if (record.preferences !== undefined) {
        const preferences = parseHouseholdPreferencesPatch(record.preferences);
        if (!preferences.ok) return preferences;
        patch.preferences = preferences.value;
    }
    return { ok: true, value: patch };
}

export function mergeHouseholdConfig(
    current: HouseholdConfig,
    patch: HouseholdConfigPatch,
): HouseholdConfig {
    return {
        name: patch.name ?? current.name,
        fridgeLocations: patch.fridgeLocations ?? current.fridgeLocations,
        recipeSearchPlaces:
            patch.recipeSearchPlaces ?? current.recipeSearchPlaces,
        preferences: {
            constraints:
                patch.preferences?.constraints ??
                current.preferences.constraints,
            budget:
                patch.preferences?.budget !== undefined
                    ? patch.preferences.budget
                    : current.preferences.budget,
            shoppingCadence:
                patch.preferences?.shoppingCadence !== undefined
                    ? patch.preferences.shoppingCadence
                    : current.preferences.shoppingCadence,
        },
    };
}

export type LoginIdentifier =
    { kind: "email"; email: string } | { kind: "username"; username: string };

export type MemberDraft = {
    displayName: string;
    login: LoginIdentifier;
    password: string;
};

export type AuthUserAdmin = {
    createUser(input: {
        email: string;
        password: string;
    }): Promise<
        | { ok: true; userId: string }
        | { ok: false; alreadyRegistered: boolean; error: string }
    >;
    deleteUser(userId: string): Promise<void>;
};

export type AddMemberRpc = {
    insertMember(input: {
        householdId: string;
        userId: string;
        displayName: string;
    }): Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
};

export type AddMemberResult =
    { ok: true; userId: string } | { ok: false; error: string };

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}$/;

export function authEmailForLogin(login: LoginIdentifier): string {
    if (login.kind === "email") return login.email;
    return `${login.username}@household.invalid`;
}

/** What the login form's one "Email or username" field signs in as. A bare
 * username maps to the same Auth email `authEmailForLogin` created it under;
 * anything with an `@` is an email and passes through. */
export function authEmailForSignIn(raw: string): string {
    const value = raw.trim().toLowerCase();
    if (!value.includes("@") && USERNAME_RE.test(value)) {
        return authEmailForLogin({ kind: "username", username: value });
    }
    return value;
}

function parseEmailLogin(raw: string): ParseResult<LoginIdentifier> {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@") || email.length < 3) {
        return { ok: false, error: "Enter a valid email address." };
    }
    return { ok: true, value: { kind: "email", email } };
}

function parseUsernameLogin(raw: string): ParseResult<LoginIdentifier> {
    const username = raw.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
        return { ok: false, error: "Enter a valid username." };
    }
    return { ok: true, value: { kind: "username", username } };
}

export function parseMemberInput(raw: unknown): ParseResult<MemberDraft> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, error: "Enter a name." };
    }
    const record = raw as {
        display_name?: unknown;
        password?: unknown;
        email?: unknown;
        username?: unknown;
        login?: unknown;
    };
    if (
        typeof record.display_name !== "string" ||
        !record.display_name.trim()
    ) {
        return { ok: false, error: "Enter a name." };
    }
    // The Settings form has one "Email or username" field, like sign-in
    // (`authEmailForSignIn`): an `@` makes it an email. Two separate fields
    // read as "fill in both", which this parser has to refuse.
    const single = typeof record.login === "string" ? record.login.trim() : "";
    const email = single ? (single.includes("@") ? single : "") : record.email;
    const username = single
        ? single.includes("@")
            ? ""
            : single
        : record.username;
    const hasEmail = typeof email === "string" && email.trim() !== "";
    const hasUsername = typeof username === "string" && username.trim() !== "";
    if (hasEmail === hasUsername) {
        return { ok: false, error: "Enter an email or username." };
    }
    if (typeof record.password !== "string" || record.password.length < 8) {
        return { ok: false, error: "Password must be at least 8 characters." };
    }
    const login = hasEmail
        ? parseEmailLogin(email as string)
        : parseUsernameLogin(username as string);
    if (!login.ok) return login;
    return {
        ok: true,
        value: {
            displayName: record.display_name.trim(),
            login: login.value,
            password: record.password,
        },
    };
}

export async function addHouseholdMember(
    deps: { auth: AuthUserAdmin; rpc: AddMemberRpc },
    householdId: string,
    draft: MemberDraft,
): Promise<AddMemberResult> {
    const created = await deps.auth.createUser({
        email: authEmailForLogin(draft.login),
        password: draft.password,
    });
    if (!created.ok) {
        if (created.alreadyRegistered) {
            return { ok: false, error: "That login is already in use." };
        }
        return { ok: false, error: created.error };
    }
    const added = await deps.rpc.insertMember({
        householdId,
        userId: created.userId,
        displayName: draft.displayName,
    });
    if (!added.ok) {
        await deps.auth.deleteUser(created.userId);
        return { ok: false, error: added.error };
    }
    return { ok: true, userId: added.userId };
}
