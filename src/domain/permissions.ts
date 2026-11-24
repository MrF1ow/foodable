/** The one permission check. "May this person do that" questions in the app
 * and the MCP go through `can()` rather than reading a role by hand.
 * Pure: no store, no clock, no imports from the rest of the app. */

/** The household roles. Same values as `MemberRole` in `src/household.ts`
 * (which imports this module, so the union is spelled out here). */
export type PermissionRole = "member" | "admin" | "owner";

export const PERMISSION_ROLES = ["member", "admin", "owner"] as const;

/** Every named thing a role can be allowed to do. A closed union: a new
 * action is a new line here and in `ROLE_ACTIONS`. */
export type Action =
    // Household
    | "household.manage" // settings, name, timezone, location, fetch refusals
    | "household.owner_only" // the owner's own household actions, nothing broader
    | "household.restock" // restock settings
    | "household.recipe_link_readers" // social readers behind recipe links
    | "household.align_recipe_versions" // recipe settings (version alignment)
    | "household.rotate_token"
    | "stores.manage"
    // Members
    | "member.manage" // invite and revoke invites
    | "member.transfer_ownership"
    | "member.change_role"
    | "member.remove"
    // Agents and flags
    | "agents.household_switch"
    | "agents.undo_any" // undo an agent change someone else's agent made
    | "flags.view_owner_only"
    // Rules and notifications
    | "rules.edit_person" // someone's allergens, dislikes and rules
    | "notification.act" // dismiss, snooze or read a notification of your own
    | "notification.dismiss_everyone"
    | "notification.snooze_everyone"
    // Everyday actions agents and the app take on the household's data
    | "nutrition.edit"
    | "fridge.edit"
    | "grocery.edit"
    | "recipe.edit"
    | "recipe.delete_any" // delete a recipe someone else made
    | "food.edit";

export type PermissionActor = { userId: string; role: PermissionRole };

/** Who the action is aimed at, when it is aimed at a person. */
export type PermissionTarget = { userId?: string; role?: PermissionRole };

export type PermissionResult = { ok: true } | { ok: false; reason: string };

const EVERYDAY: readonly Action[] = [
    "nutrition.edit",
    "fridge.edit",
    "grocery.edit",
    "recipe.edit",
    "food.edit",
    "notification.act",
    "rules.edit_person",
];

const MANAGER_ONLY: readonly Action[] = [
    "household.manage",
    "household.restock",
    "household.align_recipe_versions",
    "stores.manage",
    "notification.dismiss_everyone",
    "notification.snooze_everyone",
];

const OWNER_ONLY: readonly Action[] = [
    "household.owner_only",
    "household.recipe_link_readers",
    "household.rotate_token",
    "member.manage",
    "member.transfer_ownership",
    "member.change_role",
    "member.remove",
    "agents.household_switch",
    "agents.undo_any",
    "flags.view_owner_only",
    "recipe.delete_any",
];

/** What each role is granted before target rules narrow it (`rules.edit_person`
 * and `notification.act` are granted to everyone but aimed at oneself, and the
 * member actions never reach the owner or oneself; see `can`). */
export const ROLE_ACTIONS: Record<PermissionRole, readonly Action[]> = {
    member: EVERYDAY,
    admin: [...EVERYDAY, ...MANAGER_ONLY],
    owner: [...EVERYDAY, ...MANAGER_ONLY, ...OWNER_ONLY],
};

/** Every action, in one list, for tests and tables. */
export const ALL_ACTIONS: readonly Action[] = [
    ...new Set<Action>([...ROLE_ACTIONS.owner]),
];

const OWNER_ONLY_SET: ReadonlySet<Action> = new Set(OWNER_ONLY);

function denied(action: Action): string {
    return OWNER_ONLY_SET.has(action)
        ? "Only the household owner can do that."
        : "Only the household owner or an admin can do that.";
}

function isManager(role: PermissionRole): boolean {
    return ROLE_ACTIONS[role].includes("household.manage");
}

/** Whether `actor` may take `action`, optionally aimed at `target`.
 *
 * Target rules:
 * - `member.transfer_ownership`, `member.change_role`, `member.remove`: the
 *   owner cannot aim them at themselves (there is one owner).
 * - `rules.edit_person`: anyone edits their own; someone else's needs an owner
 *   or admin.
 * - `notification.act`: only the notification's own person. */
export function can(
    actor: PermissionActor,
    action: Action,
    target?: PermissionTarget,
): PermissionResult {
    // An unknown role holds nothing: fail closed rather than throw. hasOwn,
    // so a role named like an Object.prototype key ("constructor") is unknown.
    const held = Object.hasOwn(ROLE_ACTIONS, actor.role)
        ? ROLE_ACTIONS[actor.role]
        : [];
    if (!held.includes(action)) {
        return { ok: false, reason: denied(action) };
    }
    const self = target?.userId !== undefined && target.userId === actor.userId;
    switch (action) {
        case "member.transfer_ownership":
            if (self)
                return { ok: false, reason: "You are already the owner." };
            break;
        case "member.change_role":
            if (self) {
                return {
                    ok: false,
                    reason: "You are the owner. Transfer ownership to change your role.",
                };
            }
            break;
        case "member.remove":
            if (self) {
                return {
                    ok: false,
                    reason: "You can't remove yourself. Make someone else the owner first.",
                };
            }
            break;
        case "rules.edit_person":
            if (
                target?.userId !== undefined &&
                !self &&
                !isManager(actor.role)
            ) {
                return {
                    ok: false,
                    reason: "You can only edit your own rules.",
                };
            }
            break;
        case "notification.act":
            if (target?.userId !== undefined && !self) {
                return {
                    ok: false,
                    reason: "That notification belongs to someone else.",
                };
            }
            break;
        default:
            break;
    }
    return { ok: true };
}

/** The action a guarded MCP tool takes, keyed by the name its handler passes
 * to `ctx.runDestructive`. Every guarded tool is here; a test scans
 * `src/mcp/tools/` for any that is not. */
export const TOOL_ACTIONS = {
    clear_checked_grocery_lines: "grocery.edit",
    clear_grocery_list: "grocery.edit",
    clear_recipe_variant: "recipe.edit",
    delete_fridge_item: "fridge.edit",
    delete_fridge_items: "fridge.edit",
    delete_fridge_location: "fridge.edit",
    delete_grocery_line: "grocery.edit",
    delete_grocery_lines: "grocery.edit",
    delete_meal: "nutrition.edit",
    delete_recipe: "recipe.edit",
    delete_store: "stores.manage",
    delete_water: "nutrition.edit",
    delete_weight: "nutrition.edit",
    discard_fridge_item: "fridge.edit",
    discard_recipe_draft: "recipe.edit",
    dismiss_notice: "notification.dismiss_everyone",
    merge_foods: "food.edit",
    move_fridge_items: "fridge.edit",
    move_grocery_lines: "grocery.edit",
    remove_recipe_ingredient: "recipe.edit",
    remove_usual: "grocery.edit",
    reorder_stores: "stores.manage",
    set_nutrition_goals: "nutrition.edit",
    set_store_sections: "stores.manage",
    snooze_notice: "notification.snooze_everyone",
    unplan_recipe: "recipe.edit",
    update_grocery_line: "grocery.edit",
    update_store: "stores.manage",
} as const satisfies Record<string, Action>;

export type GuardedTool = keyof typeof TOOL_ACTIONS;
