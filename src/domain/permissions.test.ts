import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    ALL_ACTIONS,
    can,
    PERMISSION_ROLES,
    ROLE_ACTIONS,
    TOOL_ACTIONS,
    type Action,
    type PermissionRole,
} from "./permissions.js";

const ME = "user-me";
const OTHER = "user-other";

function actor(role: PermissionRole) {
    return { userId: ME, role };
}

const EVERYONE: readonly PermissionRole[] = ["member", "admin", "owner"];
const MANAGERS: readonly PermissionRole[] = ["admin", "owner"];
const OWNER: readonly PermissionRole[] = ["owner"];

/** Who may take each action with no target. Every Action must be a key, so a
 * new action is a compile error here until its row is written. */
const GRANTS: Record<Action, readonly PermissionRole[]> = {
    "household.manage": MANAGERS,
    "household.owner_only": OWNER,
    "household.restock": MANAGERS,
    "household.recipe_link_readers": OWNER,
    "household.align_recipe_versions": MANAGERS,
    "household.rotate_token": OWNER,
    "stores.manage": MANAGERS,
    "member.manage": OWNER,
    "member.transfer_ownership": OWNER,
    "member.change_role": OWNER,
    "member.remove": OWNER,
    "agents.household_switch": OWNER,
    "agents.undo_any": OWNER,
    "flags.view_owner_only": OWNER,
    "rules.edit_person": EVERYONE,
    "notification.act": EVERYONE,
    "notification.dismiss_everyone": MANAGERS,
    "notification.snooze_everyone": MANAGERS,
    "nutrition.edit": EVERYONE,
    "fridge.edit": EVERYONE,
    "grocery.edit": EVERYONE,
    "recipe.edit": EVERYONE,
    "recipe.delete_any": OWNER,
    "food.edit": EVERYONE,
};

describe("can: action x role", () => {
    const cases = (Object.keys(GRANTS) as Action[]).flatMap((action) =>
        PERMISSION_ROLES.map((role) => ({
            action,
            role,
            allowed: GRANTS[action].includes(role),
        })),
    );
    test.each(cases)("$role $action allowed=$allowed", (c) => {
        expect(can(actor(c.role), c.action).ok).toBe(c.allowed);
    });

    test("the table covers every action and ROLE_ACTIONS agrees with it", () => {
        expect(new Set(ALL_ACTIONS)).toEqual(
            new Set(Object.keys(GRANTS) as Action[]),
        );
        for (const role of PERMISSION_ROLES) {
            const granted = (Object.keys(GRANTS) as Action[]).filter((action) =>
                GRANTS[action].includes(role),
            );
            expect(new Set(ROLE_ACTIONS[role])).toEqual(new Set(granted));
        }
    });

    test("a refusal names who can do it", () => {
        expect(can(actor("member"), "household.rotate_token")).toEqual({
            ok: false,
            reason: "Only the household owner can do that.",
        });
        expect(can(actor("member"), "household.manage")).toEqual({
            ok: false,
            reason: "Only the household owner or an admin can do that.",
        });
    });
});

describe("can: target rules", () => {
    test("the owner cannot transfer, change the role of, or remove themselves", () => {
        const self = { userId: ME };
        expect(can(actor("owner"), "member.transfer_ownership", self)).toEqual({
            ok: false,
            reason: "You are already the owner.",
        });
        expect(can(actor("owner"), "member.change_role", self)).toEqual({
            ok: false,
            reason: "You are the owner. Transfer ownership to change your role.",
        });
        expect(can(actor("owner"), "member.remove", self)).toEqual({
            ok: false,
            reason: "You can't remove yourself. Make someone else the owner first.",
        });
    });

    test("the owner may aim the member actions at someone else", () => {
        for (const action of [
            "member.transfer_ownership",
            "member.change_role",
            "member.remove",
        ] as const) {
            expect(
                can(actor("owner"), action, { userId: OTHER, role: "member" })
                    .ok,
            ).toBe(true);
            expect(
                can(actor("owner"), action, { userId: OTHER, role: "admin" })
                    .ok,
            ).toBe(true);
        }
    });

    test("an admin cannot remove, re-role or hand over to anyone, owner included", () => {
        for (const action of [
            "member.transfer_ownership",
            "member.change_role",
            "member.remove",
        ] as const) {
            for (const role of ["owner", "admin", "member"] as const) {
                expect(
                    can(actor("admin"), action, { userId: OTHER, role }).ok,
                ).toBe(false);
            }
        }
    });

    test("anyone edits their own rules; someone else's needs a manager", () => {
        for (const role of PERMISSION_ROLES) {
            expect(
                can(actor(role), "rules.edit_person", { userId: ME }).ok,
            ).toBe(true);
            expect(can(actor(role), "rules.edit_person").ok).toBe(true);
        }
        const elsewhere = { userId: OTHER };
        expect(can(actor("member"), "rules.edit_person", elsewhere)).toEqual({
            ok: false,
            reason: "You can only edit your own rules.",
        });
        expect(can(actor("admin"), "rules.edit_person", elsewhere).ok).toBe(
            true,
        );
        expect(can(actor("owner"), "rules.edit_person", elsewhere).ok).toBe(
            true,
        );
    });

    test("only a notification's own person acts on it, whatever their role", () => {
        for (const role of PERMISSION_ROLES) {
            expect(
                can(actor(role), "notification.act", { userId: ME }).ok,
            ).toBe(true);
            expect(
                can(actor(role), "notification.act", { userId: OTHER }),
            ).toEqual({
                ok: false,
                reason: "That notification belongs to someone else.",
            });
        }
    });

    test("an unknown role is refused, not thrown", () => {
        const stranger = {
            userId: ME,
            role: "guest" as unknown as PermissionRole,
        };
        expect(can(stranger, "fridge.edit").ok).toBe(false);
        for (const role of ["constructor", "toString", "__proto__"]) {
            const odd = { userId: ME, role: role as unknown as PermissionRole };
            expect(can(odd, "household.manage").ok).toBe(false);
        }
    });

    test("a target changes nothing for an action with no target rule", () => {
        for (const role of PERMISSION_ROLES) {
            expect(
                can(actor(role), "household.manage", { userId: OTHER }).ok,
            ).toBe(GRANTS["household.manage"].includes(role));
        }
    });
});

describe("TOOL_ACTIONS", () => {
    const root = join(import.meta.dir, "..", "mcp", "tools");
    const guarded = new Set<string>();
    let calls = 0;
    let literalCalls = 0;
    for (const file of readdirSync(root)) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const source = readFileSync(join(root, file), "utf8");
        calls += [...source.matchAll(/runDestructive\s*(?:<[^()]*?>)?\s*\(/g)]
            .length;
        for (const match of source.matchAll(
            /runDestructive\s*(?:<[^()]*?>)?\s*\(\s*"([a-z_]+)"/g,
        )) {
            literalCalls += 1;
            guarded.add(match[1]!);
        }
    }

    test("every guarded call names its tool as a string literal", () => {
        // A name in a variable or template would slip past the scan below.
        expect(literalCalls).toBe(calls);
    });

    test("the scan finds the guarded tools", () => {
        expect(guarded.size).toBeGreaterThanOrEqual(20);
        expect(guarded.has("delete_meal")).toBe(true);
        expect(guarded.has("delete_store")).toBe(true);
    });

    test("every guarded tool in the source has an action", () => {
        const missing = [...guarded].filter((tool) => !(tool in TOOL_ACTIONS));
        expect(missing).toEqual([]);
    });

    test("every entry is a guarded tool and an action the owner holds", () => {
        const owner = new Set<Action>(ROLE_ACTIONS.owner);
        for (const [tool, action] of Object.entries(TOOL_ACTIONS)) {
            expect(guarded.has(tool)).toBe(true);
            expect(owner.has(action)).toBe(true);
        }
    });

    test("store tools need a manager, the rest are everyday", () => {
        for (const tool of [
            "update_store",
            "delete_store",
            "reorder_stores",
            "set_store_sections",
        ] as const) {
            expect(TOOL_ACTIONS[tool]).toBe("stores.manage");
            expect(can(actor("member"), TOOL_ACTIONS[tool]).ok).toBe(false);
            expect(can(actor("admin"), TOOL_ACTIONS[tool]).ok).toBe(true);
        }
        for (const [tool, action] of Object.entries(TOOL_ACTIONS)) {
            if (action === "stores.manage") continue;
            if (action === "notification.dismiss_everyone") continue;
            if (action === "notification.snooze_everyone") continue;
            expect([tool, can(actor("member"), action).ok]).toEqual([
                tool,
                true,
            ]);
        }
    });

    test("dismiss_notice is the dismiss-for-everyone action: a manager's, never a member's", () => {
        expect(TOOL_ACTIONS.dismiss_notice).toBe(
            "notification.dismiss_everyone",
        );
        expect(can(actor("member"), TOOL_ACTIONS.dismiss_notice).ok).toBe(
            false,
        );
        expect(can(actor("admin"), TOOL_ACTIONS.dismiss_notice).ok).toBe(true);
        expect(can(actor("owner"), TOOL_ACTIONS.dismiss_notice).ok).toBe(true);
    });

    test("snooze_notice is the snooze-for-everyone action: a manager's, never a member's", () => {
        expect(TOOL_ACTIONS.snooze_notice).toBe("notification.snooze_everyone");
        expect(can(actor("member"), TOOL_ACTIONS.snooze_notice).ok).toBe(false);
        expect(can(actor("admin"), TOOL_ACTIONS.snooze_notice).ok).toBe(true);
        expect(can(actor("owner"), TOOL_ACTIONS.snooze_notice).ok).toBe(true);
    });
});
