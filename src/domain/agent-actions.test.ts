import { describe, expect, test } from "bun:test";
import {
    AGENT_SNAPSHOT_TABLES,
    AGENT_TABLES,
    AGENT_TABLE_KEYS,
    AGENT_UNDO_TTL_MS,
    AgentActionsDisabledError,
    agentUndoHint,
    applyRestorePatch,
    changedColumns,
    createMemoryAgentActionsStore,
    isAgentSnapshotTable,
    listAgentActions,
    orderForUndo,
    parseAgentSnapshot,
    purgeExpiredAgentSnapshots,
    restorePatch,
    undoAgentAction,
    withAgentAction,
    type AgentActionActor,
    type AgentActionDeps,
    type AgentActionsStore,
    type CascadeReport,
    type AgentRowTable,
    type AgentUndoDeps,
} from "./agent-actions.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    updateFood,
} from "./foods.js";
import {
    addLocation,
    createMemoryFridgeStore,
    fridgeItemFromRow,
    fridgeItemToRow,
    type FridgeStore,
} from "./fridge.js";
import { createMemorySettingsStore } from "./settings.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
    deleteFridgeItemAdjust,
    discardFridgeItem,
    ledgerMatchesStock,
    updateFridgeItemQuantityAdjust,
} from "./stock.js";

const HH = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000c1";
const T0 = new Date("2026-11-13T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const asMember: AgentActionActor = {
    householdId: HH,
    memberId: MEMBER,
    connection: "Claude",
};
const asHouseholdToken: AgentActionActor = {
    householdId: HH,
    memberId: null,
    connection: "household token",
};

function setup() {
    const store = createMemoryAgentActionsStore();
    store.__setOwner(HH, OWNER);
    const settings = createMemorySettingsStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    let clock = T0;
    const deps: AgentActionDeps & AgentUndoDeps = {
        store,
        settings,
        stock,
        foods,
        now: () => clock,
    };
    return {
        store,
        settings,
        stock,
        foods,
        fridge,
        deps,
        setClock(next: Date) {
            clock = next;
        },
    };
}

function groceryLine(id: string, name: string, extra = {}) {
    return {
        id,
        household_id: HH,
        store_id: "11111111-1111-4111-8111-111111111111",
        section_id: "22222222-2222-4222-8222-222222222222",
        kind: "food",
        display_name: name,
        amount: 1.5,
        unit: "L",
        checked: false,
        created_at: "2026-03-01T12:00:00+00:00",
        updated_at: "2026-03-02T08:30:00+00:00",
        food_id: "33333333-3333-4333-8333-333333333333",
        source: "manual",
        source_fridge_item_id: null,
        note: null,
        ...extra,
    };
}

const L1 = "aaaaaaaa-0000-4000-8000-000000000001";
const L2 = "aaaaaaaa-0000-4000-8000-000000000002";

describe("recording an agent action", () => {
    test("writes the change and its snapshot together, with a 24 hour window", async () => {
        const { store, deps } = setup();
        const milk = groceryLine(L1, "Milk");
        store.__seed("grocery_lines", milk);

        const { result, action } = await withAgentAction(
            deps,
            asMember,
            {
                tool: "delete_grocery_line",
                summary: (n: number) => `Deleted ${n} grocery line`,
            },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
                store.__remove("grocery_lines", L1);
                return 1;
            },
        );

        expect(result).toBe(1);
        expect(store.__rows("grocery_lines")).toEqual([]);
        expect(action).toMatchObject({
            householdId: HH,
            memberId: MEMBER,
            connection: "Claude",
            tool: "delete_grocery_line",
            summary: "Deleted 1 grocery line",
            undoneAt: null,
            canUndo: true,
        });
        expect(action.createdAt).toBe(T0.toISOString());
        expect(action.undoExpiresAt).toBe(
            new Date(T0.getTime() + AGENT_UNDO_TTL_MS).toISOString(),
        );
        expect(AGENT_UNDO_TTL_MS).toBe(24 * HOUR);
        const [record] = store.__records();
        expect(record!.snapshot).toEqual({
            v: 1,
            changes: [{ table: "grocery_lines", op: "deleted", row: milk }],
        });
        expect(record!.undoable).toBe(true);
        expect(record!.destructive).toBe(true);
    });

    test("a household token action has no member", async () => {
        const { store, deps } = setup();
        store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await withAgentAction(
            deps,
            asHouseholdToken,
            { tool: "clear_checked_grocery_lines", summary: "Cleared" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
            },
        );
        expect(action.memberId).toBeNull();
        expect(action.connection).toBe("household token");
    });

    test("a write that throws records nothing and leaves no partial write", async () => {
        const { store, deps } = setup();
        store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        await expect(
            withAgentAction(
                deps,
                asMember,
                { tool: "delete_grocery_line", summary: "x" },
                async (rec) => {
                    await rec.captureByIds("grocery_lines", [L1], "deleted");
                    store.__remove("grocery_lines", L1);
                    throw new Error("boom");
                },
            ),
        ).rejects.toThrow("boom");
        expect(store.__records()).toEqual([]);
        expect(store.__rows("grocery_lines")).toHaveLength(1);
        expect(await listAgentActions(deps, HH, { limit: 10 })).toEqual([]);
    });

    test("with the switch off it throws before the write runs", async () => {
        const { store, settings, deps } = setup();
        store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        await settings.setAgentDestructiveAllowed(HH, false);
        let ran = false;
        const attempt = withAgentAction(
            deps,
            asMember,
            { tool: "delete_grocery_line", summary: "x" },
            async () => {
                ran = true;
            },
        );
        await expect(attempt).rejects.toBeInstanceOf(AgentActionsDisabledError);
        await expect(attempt).rejects.toThrow(
            "Settings › AI connections › Agents may make destructive changes is Off",
        );
        expect(ran).toBe(false);
        expect(store.__records()).toEqual([]);
        // The switch is per household.
        const { result } = await withAgentAction(
            deps,
            { ...asMember, householdId: OTHER },
            { tool: "delete_grocery_line", summary: "x" },
            async () => "went through",
        );
        expect(result).toBe("went through");
    });

    test("an action that recorded no rows is kept but cannot be undone", async () => {
        const { deps } = setup();
        const { action } = await withAgentAction(
            deps,
            asMember,
            {
                tool: "clear_checked_grocery_lines",
                summary: "Nothing to clear",
            },
            async () => 0,
        );
        expect(action.canUndo).toBe(false);
        expect(agentUndoHint(action)).toBe("");
        expect(
            await undoAgentAction(deps, {
                householdId: HH,
                userId: OWNER,
                actionId: action.id,
                now: T0,
            }),
        ).toMatchObject({ status: "not_undoable" });
    });

    test("meta.undoable false keeps the entry without a snapshot", async () => {
        const { store, deps } = setup();
        store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await withAgentAction(
            deps,
            asMember,
            { tool: "delete_account", summary: "Gone", undoable: false },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
            },
        );
        expect(action.canUndo).toBe(false);
        expect(store.__records()[0]!.snapshot).toBeNull();
        expect(
            await undoAgentAction(deps, {
                householdId: HH,
                userId: OWNER,
                actionId: action.id,
                now: T0,
            }),
        ).toMatchObject({ status: "not_undoable" });
    });

    test("only tables on the allowlist can be recorded", async () => {
        const { deps } = setup();
        expect(isAgentSnapshotTable("grocery_lines")).toBe(true);
        expect(isAgentSnapshotTable("users")).toBe(false);
        expect(isAgentSnapshotTable("grocery_lines; drop table x")).toBe(false);
        for (const table of AGENT_SNAPSHOT_TABLES) {
            expect(table).toMatch(/^[a-z_]+$/);
        }
        await expect(
            withAgentAction(
                deps,
                asMember,
                { tool: "t", summary: "s" },
                async (rec) => {
                    rec.deleted("users" as never, [{ id: OWNER }]);
                },
            ),
        ).rejects.toThrow(/not an undoable table/);
        await expect(
            withAgentAction(
                deps,
                asMember,
                { tool: "t", summary: "s" },
                async (rec) => {
                    rec.deleted("grocery_lines", [{ name: "no id" }]);
                },
            ),
        ).rejects.toThrow(/id/);
    });

    test("a snapshot read from storage drops anything off the allowlist", () => {
        expect(parseAgentSnapshot(null)).toBeNull();
        expect(parseAgentSnapshot("{}")).toBeNull();
        expect(parseAgentSnapshot({ v: 2, changes: [] })).toBeNull();
        expect(
            parseAgentSnapshot({
                v: 1,
                changes: [
                    { table: "users", op: "deleted", row: { id: OWNER } },
                ],
            }),
        ).toBeNull();
        expect(
            parseAgentSnapshot({
                v: 1,
                changes: [
                    {
                        table: "grocery_lines",
                        op: "wiped",
                        row: { id: L1 },
                    },
                ],
            }),
        ).toBeNull();
        expect(
            parseAgentSnapshot({
                v: 1,
                changes: [
                    { table: "grocery_lines", op: "inserted", row: { id: L1 } },
                ],
            }),
        ).toEqual({
            v: 1,
            changes: [
                { table: "grocery_lines", op: "inserted", row: { id: L1 } },
            ],
        });
    });
});

describe("undoing an agent action", () => {
    async function deleteLines(
        s: ReturnType<typeof setup>,
        ids: string[],
        actor: AgentActionActor = asMember,
    ) {
        return withAgentAction(
            s.deps,
            actor,
            { tool: "delete_grocery_line", summary: "Deleted lines" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", ids, "deleted");
                for (const id of ids) s.store.__remove("grocery_lines", id);
            },
        );
    }

    test("puts deleted rows back with the same ids and values", async () => {
        const s = setup();
        const milk = groceryLine(L1, "Milk", { amount: 2.25 });
        const eggs = groceryLine(L2, "Eggs", { note: "free range" });
        s.store.__seed("grocery_lines", milk);
        s.store.__seed("grocery_lines", eggs);
        const { action } = await deleteLines(s, [L1, L2]);
        expect(s.store.__rows("grocery_lines")).toEqual([]);

        const undone = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: MEMBER,
            actionId: action.id,
            now: new Date(T0.getTime() + HOUR),
        });
        expect(undone.status).toBe("undone");
        expect(undone.message).toContain("Deleted lines");
        expect(s.store.__rows("grocery_lines")).toEqual(
            expect.arrayContaining([milk, eggs]),
        );
        expect(s.store.__rows("grocery_lines")).toHaveLength(2);
        const [entry] = await listAgentActions(s.deps, HH, { limit: 5 });
        expect(entry).toMatchObject({ id: action.id, canUndo: false });
        expect(entry!.undoneAt).toBe(
            new Date(T0.getTime() + HOUR).toISOString(),
        );
        expect(s.store.__records()[0]!.undoneBy).toBe(MEMBER);
    });

    test("puts an updated row back to its earlier values", async () => {
        const s = setup();
        const before = groceryLine(L1, "Milk", { amount: 1, note: "skim" });
        s.store.__seed("grocery_lines", before);
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "update_grocery_line", summary: "Changed the amount" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed("grocery_lines", {
                    ...before,
                    amount: 6,
                    note: null,
                });
            },
        );
        expect(s.store.__rows("grocery_lines")[0]).toMatchObject({
            amount: 6,
            note: null,
        });
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toEqual([before]);
    });

    test("removes a row the action inserted", async () => {
        const s = setup();
        const made = groceryLine(L1, "Batch cook");
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "import_recipe_from_text", summary: "Replaced the recipe" },
            async (rec) => {
                s.store.__seed("grocery_lines", made);
                rec.inserted("grocery_lines", [L1]);
            },
        );
        expect(s.store.__records()[0]!.snapshot).toEqual({
            v: 1,
            changes: [
                {
                    table: "grocery_lines",
                    op: "inserted",
                    row: { id: L1 },
                    after: made,
                },
            ],
        });
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toEqual([]);
    });

    describe("whatever order the tool recorded in", () => {
        const sectionId = "22222222-2222-4222-8222-222222222222";
        const storeId = "11111111-1111-4111-8111-111111111111";

        function withStoreAndLine() {
            const s = setup();
            s.store.__reference(
                "grocery_sections",
                "store_id",
                "grocery_stores",
            );
            s.store.__reference(
                "grocery_lines",
                "section_id",
                "grocery_sections",
            );
            s.store.__seed("grocery_stores", {
                id: storeId,
                household_id: HH,
                name: "Costco",
            });
            s.store.__seed("grocery_sections", {
                id: sectionId,
                household_id: HH,
                store_id: storeId,
                name: "Dairy",
            });
            s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
            return s;
        }

        async function deleteStore(
            s: ReturnType<typeof setup>,
            order: "parents first" | "children first",
        ) {
            return withAgentAction(
                s.deps,
                asMember,
                { tool: "delete_store", summary: "Deleted Costco" },
                async (rec) => {
                    const capture = {
                        grocery_stores: [storeId],
                        grocery_sections: [sectionId],
                        grocery_lines: [L1],
                    } as const;
                    const tables = Object.keys(
                        capture,
                    ) as (keyof typeof capture)[];
                    if (order === "children first") tables.reverse();
                    for (const table of tables) {
                        await rec.captureByIds(
                            table,
                            [...capture[table]],
                            "deleted",
                        );
                    }
                    s.store.__remove("grocery_lines", L1);
                    s.store.__remove("grocery_sections", sectionId);
                    s.store.__remove("grocery_stores", storeId);
                },
            );
        }

        for (const order of ["parents first", "children first"] as const) {
            test(`deleted rows go back parents first when recorded ${order}`, async () => {
                const s = withStoreAndLine();
                const { action } = await deleteStore(s, order);
                const out = await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                });
                expect(out.status).toBe("undone");
                expect(s.store.__rows("grocery_stores")).toHaveLength(1);
                expect(s.store.__rows("grocery_sections")).toHaveLength(1);
                expect(s.store.__rows("grocery_lines")).toHaveLength(1);
            });
        }

        test("inserted rows are removed children first, even when the tool recorded the children first", async () => {
            const s = setup();
            s.store.__reference(
                "grocery_sections",
                "store_id",
                "grocery_stores",
            );
            s.store.__reference(
                "grocery_lines",
                "section_id",
                "grocery_sections",
            );
            const { action } = await withAgentAction(
                s.deps,
                asMember,
                { tool: "add_store", summary: "Added Costco" },
                async (rec) => {
                    s.store.__seed("grocery_stores", {
                        id: storeId,
                        household_id: HH,
                        name: "Costco",
                    });
                    s.store.__seed("grocery_sections", {
                        id: sectionId,
                        household_id: HH,
                        store_id: storeId,
                        name: "Dairy",
                    });
                    s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
                    rec.inserted("grocery_lines", [L1]);
                    rec.inserted("grocery_sections", [sectionId]);
                    rec.inserted("grocery_stores", [storeId]);
                },
            );
            const out = await undoAgentAction(s.deps, {
                householdId: HH,
                userId: OWNER,
                actionId: action.id,
                now: T0,
            });
            expect(out.status).toBe("undone");
            expect(s.store.__rows("grocery_stores")).toEqual([]);
            expect(s.store.__rows("grocery_sections")).toEqual([]);
            expect(s.store.__rows("grocery_lines")).toEqual([]);
        });

        test("the replay plan: deleted, then updated, then inserted, each in table order", () => {
            const change = (
                table: (typeof AGENT_SNAPSHOT_TABLES)[number],
                op: "deleted" | "updated" | "inserted",
                id: string,
            ) => ({ table, op, row: { id } });
            const planned = orderForUndo([
                change("grocery_lines", "inserted", "i-line"),
                change("grocery_stores", "inserted", "i-store"),
                change("grocery_lines", "deleted", "d-line"),
                change("recipes", "updated", "u-recipe"),
                change("grocery_stores", "deleted", "d-store"),
                change("grocery_sections", "inserted", "i-section"),
            ]);
            expect(planned.map((c) => c.row.id)).toEqual([
                "d-store",
                "d-line",
                "u-recipe",
                "i-line",
                "i-section",
                "i-store",
            ]);
        });
    });

    test("a name that is taken refuses the undo, names the conflict and changes nothing", async () => {
        const s = setup();
        s.store.__unique("grocery_stores", ["household_id", "name"]);
        const costcoId = "44444444-4444-4444-8444-444444444444";
        const spareId = "77777777-7777-4777-8777-777777777777";
        s.store.__seed("grocery_stores", {
            id: costcoId,
            household_id: HH,
            name: "Costco",
        });
        s.store.__seed("grocery_stores", {
            id: spareId,
            household_id: HH,
            name: "Spare",
        });
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "delete_store", summary: "Deleted the Costco store" },
            async (rec) => {
                // Put back in this order: Spare goes in, then Costco hits the
                // taken name and takes Spare down with it.
                await rec.captureByIds("grocery_stores", [spareId], "deleted");
                await rec.captureByIds("grocery_stores", [costcoId], "deleted");
                s.store.__remove("grocery_stores", spareId);
                s.store.__remove("grocery_stores", costcoId);
                await rec.captureByIds("grocery_lines", [L1], "deleted");
                s.store.__remove("grocery_lines", L1);
            },
        );
        // The household made a new Costco in the meantime.
        const newCostco = {
            id: "55555555-5555-4555-8555-555555555555",
            household_id: HH,
            name: "Costco",
        };
        s.store.__seed("grocery_stores", newCostco);

        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("conflict");
        expect(out.message).toBe(
            "A grocery store named Costco already exists.",
        );
        // Nothing moved: Spare and the line are still gone, the new store is
        // still there, and the action can still be undone later.
        expect(s.store.__rows("grocery_lines")).toEqual([]);
        expect(s.store.__rows("grocery_stores")).toEqual([newCostco]);
        expect(s.store.__records()[0]!.undoneAt).toBeNull();
        expect(
            (await listAgentActions(s.deps, HH, { limit: 1 }))[0]!.canUndo,
        ).toBe(true);
    });

    test("a food that was merged away since refuses the undo and says so", async () => {
        const s = setup();
        const eggsFoodId = "66666666-6666-4666-8666-666666666666";
        s.store.__reference("grocery_lines", "food_id", "foods");
        s.store.__seed("foods", {
            id: eggsFoodId,
            household_id: HH,
            name: "Eggs",
        });
        s.store.__seed(
            "grocery_lines",
            groceryLine(L1, "Eggs", { food_id: eggsFoodId }),
        );
        const { action } = await deleteLines(s, [L1]);
        s.store.__remove("foods", eggsFoodId);

        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("conflict");
        expect(out.message).toBe(
            "The food Eggs was merged, archived or deleted since.",
        );
        expect(s.store.__rows("grocery_lines")).toEqual([]);
    });

    test("an updated row that was deleted since cannot be put back", async () => {
        const s = setup();
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "update_grocery_line", summary: "Renamed" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed("grocery_lines", groceryLine(L1, "Oat milk"));
            },
        );
        s.store.__remove("grocery_lines", L1);
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("conflict");
        expect(out.message).toBe(
            "The grocery line Milk was removed since, so its earlier values can't be put back.",
        );
    });

    test("undoing twice is a no-op", async () => {
        const s = setup();
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await deleteLines(s, [L1]);
        const input = {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        };
        expect((await undoAgentAction(s.deps, input)).status).toBe("undone");
        // The household deletes it again by hand; a second undo must not
        // resurrect it.
        s.store.__remove("grocery_lines", L1);
        const again = await undoAgentAction(s.deps, input);
        expect(again.status).toBe("already_undone");
        expect(s.store.__rows("grocery_lines")).toEqual([]);
    });

    test("refuses after the 24 hour window", async () => {
        const s = setup();
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await deleteLines(s, [L1]);
        const justInside = new Date(T0.getTime() + AGENT_UNDO_TTL_MS - 1);
        const atTheEdge = new Date(T0.getTime() + AGENT_UNDO_TTL_MS);
        expect(
            (
                await listAgentActions(s.deps, HH, {
                    limit: 1,
                    now: justInside,
                })
            )[0]!.canUndo,
        ).toBe(true);
        expect(
            (
                await listAgentActions(s.deps, HH, { limit: 1, now: atTheEdge })
            )[0]!.canUndo,
        ).toBe(false);
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: atTheEdge,
        });
        expect(out.status).toBe("expired");
        expect(s.store.__rows("grocery_lines")).toEqual([]);
    });

    test("only the owner or the member the agent acted as may undo", async () => {
        const s = setup();
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await deleteLines(s, [L1]);
        const stranger = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OTHER,
            actionId: action.id,
            now: T0,
        });
        expect(stranger.status).toBe("not_found");
        expect(s.store.__rows("grocery_lines")).toEqual([]);
        // Another household cannot see it either, even as an owner there.
        s.store.__setOwner(OTHER, OTHER);
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: OTHER,
                    userId: OTHER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("not_found");
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: MEMBER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
    });

    test("a household token action is undone by the owner, not by a member", async () => {
        const s = setup();
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await deleteLines(s, [L1], asHouseholdToken);
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: MEMBER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("not_found");
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
    });

    test("an unknown action is not found", async () => {
        const { deps } = setup();
        expect(
            await undoAgentAction(deps, {
                householdId: HH,
                userId: OWNER,
                actionId: crypto.randomUUID(),
                now: T0,
            }),
        ).toMatchObject({ status: "not_found" });
    });
});

describe("the activity list and the purge", () => {
    test("lists newest first with the limit, canUndo derived and the hint worded", async () => {
        const s = setup();
        const record = (summary: string) =>
            withAgentAction(
                s.deps,
                asMember,
                { tool: "delete_grocery_line", summary },
                async (rec) => {
                    rec.deleted("grocery_lines", [{ id: crypto.randomUUID() }]);
                },
            );
        s.setClock(T0);
        await record("first");
        s.setClock(new Date(T0.getTime() + HOUR));
        await record("second");
        s.setClock(new Date(T0.getTime() + 2 * HOUR));
        const { action: third } = await record("third");

        const listed = await listAgentActions(s.deps, HH, { limit: 2 });
        expect(listed.map((e) => e.summary)).toEqual(["third", "second"]);
        expect(await listAgentActions(s.deps, OTHER, { limit: 5 })).toEqual([]);
        expect(agentUndoHint(third)).toBe(
            "The household can undo this for 24 hours in Settings › AI connections.",
        );
        // Past the first one's window, the other two are still inside theirs.
        const later = new Date(T0.getTime() + 24.5 * HOUR);
        const all = await listAgentActions(s.deps, HH, {
            limit: 10,
            now: later,
        });
        expect(all.map((e) => [e.summary, e.canUndo])).toEqual([
            ["third", true],
            ["second", true],
            ["first", false],
        ]);
        expect(agentUndoHint(all[2]!)).toBe("");
    });

    test("purge nulls snapshots past 24 hours and keeps the entries", async () => {
        const s = setup();
        const record = (at: Date, summary: string) => {
            s.setClock(at);
            return withAgentAction(
                s.deps,
                asMember,
                { tool: "delete_grocery_line", summary },
                async (rec) => {
                    rec.deleted("grocery_lines", [{ id: crypto.randomUUID() }]);
                },
            );
        };
        const { action: old } = await record(T0, "old");
        await record(new Date(T0.getTime() + 20 * HOUR), "fresh");
        const now = new Date(T0.getTime() + 25 * HOUR);

        expect(await purgeExpiredAgentSnapshots(s.deps, now)).toBe(1);
        const records = s.store.__records();
        expect(records).toHaveLength(2);
        expect(records.find((r) => r.summary === "old")!.snapshot).toBeNull();
        expect(
            records.find((r) => r.summary === "fresh")!.snapshot,
        ).not.toBeNull();
        // Again: nothing left to purge.
        expect(await purgeExpiredAgentSnapshots(s.deps, now)).toBe(0);
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: old.id,
            now,
        });
        expect(out.status).toBe("expired");
        expect(
            (await listAgentActions(s.deps, HH, { limit: 5, now })).map((e) => [
                e.summary,
                e.canUndo,
            ]),
        ).toEqual([
            ["fresh", true],
            ["old", false],
        ]);
    });
});

// The fridge items live in a real memory fridge store, and the agent
// actions store reads and writes them through it.
async function fridgeSetup() {
    const s = setup();
    const fridge = s.fridge;
    const eggs = await findOrCreateManualFood(s.foods, HH, "food", "Eggs");
    const eggsFood = await updateFood(s.foods, HH, eggs.id, {
        defaultUnit: "each",
        gramsPerEach: 50,
    });
    const location = await addLocation(fridge, HH, "Fridge");
    s.store.__attach("fridge_items", fridgeTable(fridge));
    // The movements these tests write are stamped by the real clock, so the
    // action must be too: undo tells the movements that came after an action
    // from the ones before it by their time.
    s.deps.now = () => new Date();
    return { ...s, fridge, eggsFood, location };
}

function fridgeTable(fridge: FridgeStore): AgentRowTable {
    return {
        async get(key) {
            const item = (await fridge.listItems(HH)).find(
                (row) => row.id === key.id,
            );
            return item
                ? {
                      ...fridgeItemToRow(item),
                      created_at: "2026-03-01T12:00:00+00:00",
                  }
                : null;
        },
        async insert(row) {
            await fridge.insertItem(fridgeItemFromRow(row as never));
        },
        async replace(row) {
            return (
                (await fridge.updateItem(fridgeItemFromRow(row as never))) !==
                null
            );
        },
        async remove(key) {
            await fridge.deleteItem(HH, key.id!);
        },
    };
}

describe("undo keeps the stock ledger balanced", () => {
    test("a deleted fridge item comes back and the ledger still adds up", async () => {
        const f = await fridgeSetup();
        const added = await addFridgeItemAdjust(f.fridge, f.stock, f.foods, {
            householdId: HH,
            foodId: f.eggsFood.id,
            amount: 12,
            unit: "each",
            locationId: f.location.id,
        });
        const itemId = added.item!.id;

        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "delete_fridge_item", summary: "Deleted the eggs" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "deleted");
                await deleteFridgeItemAdjust(f.fridge, f.stock, f.foods, {
                    householdId: HH,
                    itemId,
                });
            },
        );
        expect(await f.fridge.listItems(HH)).toEqual([]);
        expect(
            ledgerMatchesStock([], await f.stock.listMovements(HH), f.eggsFood),
        ).toBe(true);

        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        const items = await f.fridge.listItems(HH);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: itemId,
            quantity: { amount: 12, unit: "each" },
        });
        const movements = await f.stock.listMovements(HH);
        expect(ledgerMatchesStock(items, movements, f.eggsFood)).toBe(true);
        const undoMovement = movements.find(
            (m) => m.actorUserId === OWNER && m.delta > 0,
        );
        expect(undoMovement).toMatchObject({
            reason: "adjust",
            fridgeItemId: itemId,
        });
    });

    test("an updated quantity goes back with a compensating adjust", async () => {
        const f = await fridgeSetup();
        const added = await addFridgeItemAdjust(f.fridge, f.stock, f.foods, {
            householdId: HH,
            foodId: f.eggsFood.id,
            amount: 12,
            unit: "each",
            locationId: f.location.id,
        });
        const itemId = added.item!.id;
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "update_fridge_item", summary: "Set the eggs to 3" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "updated");
                await updateFridgeItemQuantityAdjust(
                    f.fridge,
                    f.stock,
                    f.foods,
                    { householdId: HH, itemId, amount: 3 },
                );
            },
        );
        let items = await f.fridge.listItems(HH);
        expect(items[0]!.quantity.amount).toBe(3);

        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        items = await f.fridge.listItems(HH);
        expect(items[0]!.quantity).toEqual({ amount: 12, unit: "each" });
        expect(
            ledgerMatchesStock(
                items,
                await f.stock.listMovements(HH),
                f.eggsFood,
            ),
        ).toBe(true);
    });

    test("an item that went with its location comes back without a second movement", async () => {
        const f = await fridgeSetup();
        const added = await addFridgeItemAdjust(f.fridge, f.stock, f.foods, {
            householdId: HH,
            foodId: f.eggsFood.id,
            amount: 12,
            unit: "each",
            locationId: f.location.id,
        });
        const itemId = added.item!.id;
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "delete_fridge_location", summary: "Deleted the shelf" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "deleted");
                // The items go with their location: no movement is written.
                await f.fridge.deleteItem(HH, itemId);
            },
        );
        const movementsBefore = await f.stock.listMovements(HH);
        expect(movementsBefore).toHaveLength(1);

        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        const items = await f.fridge.listItems(HH);
        expect(items).toHaveLength(1);
        const movements = await f.stock.listMovements(HH);
        expect(movements).toEqual(movementsBefore);
        expect(ledgerMatchesStock(items, movements, f.eggsFood)).toBe(true);
    });

    test("an item changed by a person since is not overwritten", async () => {
        const f = await fridgeSetup();
        const added = await addFridgeItemAdjust(f.fridge, f.stock, f.foods, {
            householdId: HH,
            foodId: f.eggsFood.id,
            amount: 12,
            unit: "each",
            locationId: f.location.id,
        });
        const itemId = added.item!.id;
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "discard_fridge_item", summary: "Discarded 4" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "updated");
                await discardFridgeItem(f.fridge, f.stock, f.foods, {
                    householdId: HH,
                    itemId,
                    amount: 4,
                });
            },
        );
        // A person eats two more.
        await discardFridgeItem(f.fridge, f.stock, f.foods, {
            householdId: HH,
            itemId,
            amount: 2,
        });
        const movementsBefore = await f.stock.listMovements(HH);
        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("conflict");
        expect(out.message).toContain("was changed since");
        const items = await f.fridge.listItems(HH);
        expect(items[0]!.quantity.amount).toBe(6);
        expect(await f.stock.listMovements(HH)).toEqual(movementsBefore);
    });

    test("an undone discard puts the amount back and the correction comes from the movements that exist", async () => {
        const f = await fridgeSetup();
        const added = await addFridgeItemAdjust(f.fridge, f.stock, f.foods, {
            householdId: HH,
            foodId: f.eggsFood.id,
            amount: 12,
            unit: "each",
            locationId: f.location.id,
        });
        const itemId = added.item!.id;
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "discard_fridge_item", summary: "Discarded 5" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "updated");
                await discardFridgeItem(f.fridge, f.stock, f.foods, {
                    householdId: HH,
                    itemId,
                    amount: 5,
                });
            },
        );
        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        const items = await f.fridge.listItems(HH);
        expect(items[0]!.quantity.amount).toBe(12);
        const movements = await f.stock.listMovements(HH);
        expect(ledgerMatchesStock(items, movements, f.eggsFood)).toBe(true);
        expect(movements.filter((m) => m.actorUserId === OWNER)).toHaveLength(
            1,
        );
    });

    test("a fridge item the action added goes away with its stock", async () => {
        const f = await fridgeSetup();
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "put_away_grocery_lines", summary: "Stocked eggs" },
            async (rec) => {
                const added = await addFridgeItemAdjust(
                    f.fridge,
                    f.stock,
                    f.foods,
                    {
                        householdId: HH,
                        foodId: f.eggsFood.id,
                        amount: 6,
                        unit: "each",
                        locationId: f.location.id,
                    },
                );
                rec.inserted("fridge_items", [added.item!.id]);
            },
        );
        expect(await f.fridge.listItems(HH)).toHaveLength(1);
        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(await f.fridge.listItems(HH)).toEqual([]);
        expect(
            ledgerMatchesStock([], await f.stock.listMovements(HH), f.eggsFood),
        ).toBe(true);
    });
});

describe("an insert is not undone over what was added to it since", () => {
    const storeId = "11111111-1111-4111-8111-111111111111";
    const sectionId = "22222222-2222-4222-8222-222222222222";

    async function addSection(
        s: ReturnType<typeof setup>,
        onDelete?: "set null",
    ) {
        s.store.__reference(
            "grocery_lines",
            "section_id",
            "grocery_sections",
            onDelete,
        );
        return withAgentAction(
            s.deps,
            asMember,
            { tool: "set_store_sections", summary: "Added Dairy" },
            async (rec) => {
                s.store.__seed("grocery_sections", {
                    id: sectionId,
                    household_id: HH,
                    store_id: storeId,
                    name: "Dairy",
                });
                rec.inserted("grocery_sections", [sectionId]);
            },
        );
    }

    test("refuses while something added since points at it, and changes nothing", async () => {
        const s = setup();
        const { action } = await addSection(s);
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out).toEqual({
            status: "conflict",
            message:
                "The grocery section Dairy is used by 1 grocery line now; change or remove it first, or keep the grocery section.",
        });
        expect(s.store.__rows("grocery_sections")).toHaveLength(1);
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
        expect(s.store.__records()[0]!.undoneAt).toBeNull();

        s.store.__remove("grocery_lines", L1);
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(s.store.__rows("grocery_sections")).toEqual([]);
    });

    test("says how many, in the plural", async () => {
        const s = setup();
        const { action } = await addSection(s);
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        s.store.__seed("grocery_lines", groceryLine(L2, "Cheese"));
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.message).toBe(
            "The grocery section Dairy is used by 2 grocery lines now; change or remove them first, or keep the grocery section.",
        );
    });

    test("a reference that would only clear itself when the row goes still blocks, and stays", async () => {
        const s = setup();
        const { action } = await addSection(s, "set null");
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out).toEqual({
            status: "conflict",
            message:
                "The grocery section Dairy is used by 1 grocery line now; change or remove it first, or keep the grocery section.",
        });
        expect(s.store.__rows("grocery_sections")).toHaveLength(1);
        expect(s.store.__rows("grocery_lines")[0]).toMatchObject({
            id: L1,
            section_id: sectionId,
        });
    });

    test("the ledger's audit links, which only clear themselves, do not block", async () => {
        const s = setup();
        const itemId = "44444444-4444-4444-8444-444444444444";
        const movementId = "55555555-5555-4555-8555-555555555555";
        s.store.__reference(
            "stock_movements",
            "fridge_item_id",
            "fridge_items",
            "set null",
        );
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "put_away_grocery_lines", summary: "Stocked" },
            async (rec) => {
                s.store.__seed("fridge_items", {
                    id: itemId,
                    household_id: HH,
                    food_id: null,
                });
                rec.inserted("fridge_items", [itemId]);
            },
        );
        s.store.__seed("stock_movements", {
            id: movementId,
            household_id: HH,
            fridge_item_id: itemId,
        });
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(s.store.__rows("fridge_items")).toEqual([]);
        expect(s.store.__rows("stock_movements")[0]).toMatchObject({
            id: movementId,
            fridge_item_id: null,
        });
    });
});

describe("an update is not undone over a change made since", () => {
    test("records the row as the write left it, and undoes while it is still that", async () => {
        const s = setup();
        const before = groceryLine(L1, "Milk", { amount: 1 });
        s.store.__seed("grocery_lines", before);
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "update_grocery_line", summary: "Changed the amount" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed("grocery_lines", { ...before, amount: 6 });
            },
        );
        expect(s.store.__records()[0]!.snapshot!.changes).toEqual([
            {
                table: "grocery_lines",
                op: "updated",
                row: before,
                after: { ...before, amount: 6 },
            },
        ]);
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toEqual([before]);
    });

    test("refuses when the row was changed afterwards, and changes nothing", async () => {
        const s = setup();
        const before = groceryLine(L1, "Milk", { amount: 10 });
        s.store.__seed("grocery_lines", before);
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "update_grocery_line", summary: "Changed the amount" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed("grocery_lines", { ...before, amount: 6 });
            },
        );
        // A person edits it by hand.
        s.store.__seed("grocery_lines", { ...before, amount: 4 });
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out).toEqual({
            status: "conflict",
            message:
                "The grocery line Milk was changed since, so its earlier values can't be put back.",
        });
        expect(s.store.__rows("grocery_lines")[0]).toMatchObject({
            amount: 4,
        });
        expect(s.store.__records()[0]!.undoneAt).toBeNull();
    });

    test("a row captured twice keeps its first before-image", async () => {
        const s = setup();
        const before = groceryLine(L1, "Milk", { amount: 10 });
        s.store.__seed("grocery_lines", before);
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "update_grocery_line", summary: "Changed it twice" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed("grocery_lines", { ...before, amount: 7 });
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed("grocery_lines", { ...before, amount: 3 });
            },
        );
        expect(s.store.__records()[0]!.snapshot!.changes).toHaveLength(1);
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toEqual([before]);
    });

    test("a row recorded as updated that the same write removed is an error, not a bad snapshot", async () => {
        const s = setup();
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        await expect(
            withAgentAction(
                s.deps,
                asMember,
                { tool: "delete_grocery_line", summary: "x" },
                async (rec) => {
                    await rec.captureByIds("grocery_lines", [L1], "updated");
                    s.store.__remove("grocery_lines", L1);
                },
            ),
        ).rejects.toThrow(/record it as deleted/);
        expect(s.store.__records()).toEqual([]);
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
    });
});

describe("tables keyed by more than an id", () => {
    const FOOD = "66666666-6666-4666-8666-666666666666";
    const alias = (name: string, extra = {}) => ({
        household_id: HH,
        alias: name,
        food_id: FOOD,
        ...extra,
    });

    test("every table has key columns, and the list order is the table order", () => {
        expect(Object.keys(AGENT_TABLE_KEYS)).toEqual([
            ...AGENT_SNAPSHOT_TABLES,
        ]);
        expect(AGENT_TABLE_KEYS.grocery_lines).toEqual(["id"]);
        expect(AGENT_TABLE_KEYS.food_aliases).toEqual([
            "household_id",
            "alias",
        ]);
        expect(AGENT_TABLE_KEYS.food_barcodes).toEqual([
            "household_id",
            "barcode",
        ]);
        expect(AGENT_TABLE_KEYS.recipe_imports).toEqual(["recipe_id"]);
        expect(AGENT_TABLE_KEYS.nutrition_goals).toEqual(["user_id"]);
        for (const table of [
            "stock_movements",
            "recipe_portions",
            "notice_dismissals",
            "nutrition_goal_days",
            "households",
        ] as const) {
            expect(AGENT_TABLE_KEYS[table].length).toBeGreaterThan(0);
        }
    });

    test("a composite-key row is captured by its key and goes back", async () => {
        const s = setup();
        s.store.__seed("food_aliases", alias("ovos"));
        s.store.__seed("food_aliases", alias("huevos"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "merge_foods", summary: "Dropped an alias" },
            async (rec) => {
                expect(
                    await rec.captureByKeys(
                        "food_aliases",
                        [
                            { household_id: HH, alias: "ovos" },
                            { household_id: HH, alias: "nope" },
                        ],
                        "deleted",
                    ),
                ).toBe(1);
                s.store.__remove("food_aliases", {
                    household_id: HH,
                    alias: "ovos",
                });
            },
        );
        expect(s.store.__rows("food_aliases")).toEqual([alias("huevos")]);
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(s.store.__rows("food_aliases")).toHaveLength(2);
        expect(s.store.__rows("food_aliases")).toEqual(
            expect.arrayContaining([alias("ovos"), alias("huevos")]),
        );
    });

    test("a composite-key row changed or inserted by the action is restored or removed", async () => {
        const s = setup();
        s.store.__seed("food_aliases", alias("ovo"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "upsert_food", summary: "Moved an alias" },
            async (rec) => {
                await rec.captureByKeys(
                    "food_aliases",
                    [{ household_id: HH, alias: "ovo" }],
                    "updated",
                );
                s.store.__seed(
                    "food_aliases",
                    alias("ovo", { food_id: OTHER }),
                );
                s.store.__seed("food_aliases", alias("huevo"));
                rec.insertedKeys("food_aliases", [
                    { household_id: HH, alias: "huevo" },
                ]);
            },
        );
        expect(
            (
                await undoAgentAction(s.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(s.store.__rows("food_aliases")).toEqual([alias("ovo")]);
    });

    test("a snapshot row must carry its table's key columns", () => {
        const stored = (row: Record<string, unknown>) =>
            parseAgentSnapshot({
                v: 1,
                changes: [{ table: "food_aliases", op: "deleted", row }],
            });
        expect(stored({ id: L1 })).toBeNull();
        expect(stored({ household_id: HH })).toBeNull();
        expect(stored(alias("ovos"))).not.toBeNull();
        expect(
            parseAgentSnapshot({
                v: 1,
                changes: [
                    {
                        table: "nutrition_goals",
                        op: "inserted",
                        row: { user_id: OWNER },
                    },
                ],
            }),
        ).not.toBeNull();
    });

    test("ids and keys are not interchangeable", async () => {
        const s = setup();
        const attempt = (
            write: (
                rec: Parameters<Parameters<typeof withAgentAction>[3]>[0],
            ) => Promise<unknown>,
        ) =>
            withAgentAction(
                s.deps,
                asMember,
                { tool: "t", summary: "s" },
                write as never,
            );
        await expect(
            attempt((rec) =>
                rec.captureByIds("food_aliases", ["x"], "deleted"),
            ),
        ).rejects.toThrow(/captureByKeys/);
        await expect(
            attempt(async (rec) => rec.inserted("food_aliases", ["x"])),
        ).rejects.toThrow(/insertedKeys/);
        await expect(
            attempt((rec) =>
                rec.captureByKeys(
                    "food_aliases",
                    [{ household_id: HH }],
                    "deleted",
                ),
            ),
        ).rejects.toThrow(/alias/);
        await expect(
            attempt((rec) =>
                rec.captureByKeys(
                    "grocery_lines",
                    [{ id: L1, display_name: "Milk" }],
                    "deleted",
                ),
            ),
        ).rejects.toThrow(/display_name/);
    });
});

describe("the switch is read again inside the write transaction", () => {
    test("turning it Off after the guard was entered still refuses before the write runs", async () => {
        const s = setup();
        const original = s.store.atomically.bind(s.store);
        let ran = false;
        // The household flips the switch while the guard is opening its
        // transaction: after any early check, before the write.
        s.store.atomically = async (fn) => {
            await s.settings.setAgentDestructiveAllowed(HH, false);
            return original(fn);
        };
        await expect(
            withAgentAction(
                s.deps,
                asMember,
                { tool: "delete_grocery_line", summary: "x" },
                async () => {
                    ran = true;
                },
            ),
        ).rejects.toBeInstanceOf(AgentActionsDisabledError);
        expect(ran).toBe(false);
        expect(s.store.__records()).toEqual([]);
    });
});

describe("which tables undo covers", () => {
    test("every table says whose rows it holds", () => {
        const scopes = (scope: "household" | "member") =>
            AGENT_SNAPSHOT_TABLES.filter(
                (table) => AGENT_TABLES[table].scope === scope,
            );
        expect(scopes("member")).toEqual([
            "recipe_portions",
            "meals",
            "meal_items",
            "water_log",
            "weight_log",
            "person_rules",
            "member_allergens",
            "member_dislikes",
            "nutrition_goals",
            "nutrition_goal_days",
        ]);
        expect(scopes("household")).toContain("grocery_lines");
        expect(scopes("household")).toContain("households");
        expect(scopes("household").length + scopes("member").length).toBe(
            AGENT_SNAPSHOT_TABLES.length,
        );
    });

    test("favourite recipes are off the list: another member's rows cannot be captured or claimed back", async () => {
        expect(isAgentSnapshotTable("recipe_favourites")).toBe(false);
        expect(Object.keys(AGENT_TABLES)).not.toContain("recipe_favourites");
        const s = setup();
        await expect(
            withAgentAction(
                s.deps,
                asMember,
                { tool: "delete_recipe", summary: "x" },
                async (rec) => {
                    await rec.captureByKeys(
                        "recipe_favourites" as never,
                        [{ user_id: MEMBER, recipe_id: L1 }],
                        "deleted",
                    );
                },
            ),
        ).rejects.toThrow("recipe_favourites is not an undoable table");
        expect(
            parseAgentSnapshot({
                v: 1,
                changes: [
                    {
                        table: "recipe_favourites",
                        op: "deleted",
                        row: { user_id: MEMBER, recipe_id: L1 },
                    },
                ],
            }),
        ).toBeNull();
    });
});

describe("the put-back runs as the member the agent acted as", () => {
    async function deleteLine(
        s: ReturnType<typeof setup>,
        actor: AgentActionActor,
    ) {
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        const { action } = await withAgentAction(
            s.deps,
            actor,
            { tool: "delete_grocery_line", summary: "Deleted Milk" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
                s.store.__remove("grocery_lines", L1);
            },
        );
        return action;
    }
    const undoAs = (
        s: ReturnType<typeof setup>,
        actionId: string,
        userId: string,
    ) =>
        undoAgentAction(s.deps, {
            householdId: HH,
            userId,
            actionId,
            now: T0,
        });

    test("the owner clicking Undo on a member's action replays as that member", async () => {
        const s = setup();
        const action = await deleteLine(s, asMember);
        expect((await undoAs(s, action.id, OWNER)).status).toBe("undone");
        expect(s.store.__actedAs()).toEqual([MEMBER]);
    });

    test("a household token action replays as the household, not as the owner", async () => {
        const s = setup();
        const action = await deleteLine(s, asHouseholdToken);
        expect((await undoAs(s, action.id, OWNER)).status).toBe("undone");
        expect(s.store.__actedAs()).toEqual([null]);
    });

    test("a refused undo never acts as anyone, and a rolled back one forgets it did", async () => {
        const s = setup();
        const action = await deleteLine(s, asMember);
        expect((await undoAs(s, action.id, OTHER)).status).toBe("not_found");
        expect(s.store.__actedAs()).toEqual([]);

        s.store.__unique("grocery_lines", ["display_name"]);
        s.store.__seed("grocery_lines", groceryLine(L2, "Milk"));
        expect((await undoAs(s, action.id, OWNER)).status).toBe("conflict");
        expect(s.store.__actedAs()).toEqual([]);
    });
});

describe("what an update restores", () => {
    const before = {
        id: L1,
        household_id: HH,
        name: "Home",
        location: "Kyiv",
        updated_at: "2026-11-13T10:00:00+00:00",
        prefs: { keep: "same", change: 1, drop: true },
        tags: ["a"],
    };
    const after = {
        ...before,
        name: "Renamed",
        updated_at: "2026-11-13T11:00:00+00:00",
        prefs: { keep: "same", change: 2, added: "x" },
    };

    test("changedColumns lists only what differs, never a key or the bookkeeping column", () => {
        expect(changedColumns("households", before, after)).toEqual([
            { kind: "value", column: "name", before: "Home", after: "Renamed" },
            {
                kind: "keys",
                column: "prefs",
                keys: [
                    {
                        key: "added",
                        before: undefined,
                        after: "x",
                        hadBefore: false,
                        hadAfter: true,
                    },
                    {
                        key: "change",
                        before: 1,
                        after: 2,
                        hadBefore: true,
                        hadAfter: true,
                    },
                    {
                        key: "drop",
                        before: true,
                        after: undefined,
                        hadBefore: true,
                        hadAfter: false,
                    },
                ],
            },
        ]);
        expect(changedColumns("households", before, before)).toEqual([]);
    });

    test("a column the row did not have before counts as changed", () => {
        const { location: _gone, ...without } = before;
        expect(changedColumns("households", without, before)).toEqual([
            {
                kind: "value",
                column: "location",
                before: undefined,
                after: "Kyiv",
            },
        ]);
    });

    test("restorePatch sets the whole columns and, for an object, only its changed keys", () => {
        const patch = restorePatch(changedColumns("households", before, after));
        expect(patch).toEqual({
            set: { name: "Home" },
            json: {
                prefs: { set: { change: 1, drop: true }, remove: ["added"] },
            },
        });
        // Applied to a row a person has edited since: their edits stay.
        expect(
            applyRestorePatch(
                {
                    ...after,
                    location: "Lviv",
                    prefs: { ...after.prefs, since: "mine" },
                },
                patch,
            ),
        ).toEqual({
            ...before,
            updated_at: after.updated_at,
            location: "Lviv",
            prefs: { keep: "same", change: 1, drop: true, since: "mine" },
        });
    });

    function updatedByAction(
        s: ReturnType<typeof setup>,
        start: Record<string, unknown>,
        end: Record<string, unknown>,
    ) {
        s.store.__seed("households", start);
        return withAgentAction(
            s.deps,
            asMember,
            { tool: "update_household_config", summary: "Changed it" },
            async (rec) => {
                await rec.captureByIds("households", [L1], "updated");
                s.store.__seed("households", end);
            },
        );
    }
    const undoNow = (s: ReturnType<typeof setup>, actionId: string) =>
        undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId,
            now: T0,
        });

    test("an unrelated column a person edited since, and a column added since, do not block the undo", async () => {
        const s = setup();
        const { action } = await updatedByAction(s, before, after);
        s.store.__seed("households", {
            ...after,
            location: "Lviv",
            updated_at: "2026-11-13T12:00:00+00:00",
            added_later: "new column",
        });
        expect((await undoNow(s, action.id)).status).toBe("undone");
        expect(s.store.__rows("households")[0]).toMatchObject({
            name: "Home",
            location: "Lviv",
            added_later: "new column",
            prefs: { keep: "same", change: 1, drop: true },
        });
    });

    test("an unrelated preference set since survives, and only the changed keys go back", async () => {
        const s = setup();
        const { action } = await updatedByAction(s, before, after);
        s.store.__seed("households", {
            ...after,
            prefs: { ...after.prefs, since: "mine" },
        });
        expect((await undoNow(s, action.id)).status).toBe("undone");
        expect(s.store.__rows("households")[0]!.prefs).toEqual({
            keep: "same",
            change: 1,
            drop: true,
            since: "mine",
        });
    });

    test("a column or a key changed again since still refuses, and changes nothing", async () => {
        for (const since of [
            { ...after, name: "Mine" },
            { ...after, prefs: { ...after.prefs, change: 9 } },
            { ...after, prefs: { keep: "same", change: 2 } },
        ]) {
            const s = setup();
            const { action } = await updatedByAction(s, before, after);
            s.store.__seed("households", since);
            const out = await undoNow(s, action.id);
            expect(out.status).toBe("conflict");
            expect(out.message).toContain("was changed since");
            expect(s.store.__rows("households")[0]).toEqual(since);
        }
    });
});

describe("the ledger is corrected for this action only", () => {
    // Smallest first: the memory store lists movements newest first, and all
    // of these share one clock.
    const deltas = async (f: Awaited<ReturnType<typeof fridgeSetup>>) =>
        (await f.stock.listMovements(HH))
            .map((m) => [m.delta, m.reason])
            .sort((a, b) => (a[0] as number) - (b[0] as number));

    async function twelveEggsAndSomeDrift() {
        const f = await fridgeSetup();
        const added = await addFridgeItemAdjust(f.fridge, f.stock, f.foods, {
            householdId: HH,
            foodId: f.eggsFood.id,
            amount: 12,
            unit: "each",
            locationId: f.location.id,
        });
        const first = added.item!;
        // An item with no movement of its own: drift the action knows nothing of.
        await f.fridge.insertItem({
            ...first,
            id: crypto.randomUUID(),
            displayName: "Old eggs",
            quantity: { amount: 7, unit: "each" },
        });
        return { f, itemId: first.id };
    }

    test("an undone discard writes back the discard, not the drift of the same food", async () => {
        const { f, itemId } = await twelveEggsAndSomeDrift();
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "discard_fridge_item", summary: "Discarded 4" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "updated");
                await discardFridgeItem(f.fridge, f.stock, f.foods, {
                    householdId: HH,
                    itemId,
                    amount: 4,
                });
            },
        );
        expect(action.canUndo).toBe(true);
        const out = await undoAgentAction(f.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(await deltas(f)).toEqual([
            [-4, "discard"],
            [4, "adjust"],
            [12, "adjust"],
        ]);
        expect(
            (await f.fridge.listItems(HH)).map((i) => i.quantity.amount).sort(),
        ).toEqual([12, 7]);
        expect(f.store.__records()[0]!.snapshot!.ledger).toEqual([
            expect.objectContaining({ delta: -4, unit: "each" }),
        ]);
    });

    test("an action that wrote no movement leaves the ledger alone, drift and all", async () => {
        const { f, itemId } = await twelveEggsAndSomeDrift();
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "delete_fridge_location", summary: "Deleted the shelf" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "deleted");
                await f.fridge.deleteItem(HH, itemId);
            },
        );
        expect(f.store.__records()[0]!.snapshot!.ledger).toBeUndefined();
        const before = await f.stock.listMovements(HH);
        expect(
            (
                await undoAgentAction(f.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(await f.stock.listMovements(HH)).toEqual(before);
    });

    test("an item the action added goes away with exactly the movement it wrote", async () => {
        const { f } = await twelveEggsAndSomeDrift();
        const shelf = await addLocation(f.fridge, HH, "Shelf");
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "put_away_grocery_lines", summary: "Stocked 6" },
            async (rec) => {
                const added = await addFridgeItemAdjust(
                    f.fridge,
                    f.stock,
                    f.foods,
                    {
                        householdId: HH,
                        foodId: f.eggsFood.id,
                        amount: 6,
                        unit: "each",
                        locationId: shelf.id,
                    },
                );
                rec.inserted("fridge_items", [added.item!.id]);
            },
        );
        expect(
            (
                await undoAgentAction(f.deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(await deltas(f)).toEqual([
            [-6, "adjust"],
            [6, "adjust"],
            [12, "adjust"],
        ]);
    });

    test("a food merged away since cannot take the opposite movement, so the undo refuses", async () => {
        const { f, itemId } = await twelveEggsAndSomeDrift();
        const { action } = await withAgentAction(
            f.deps,
            asMember,
            { tool: "discard_fridge_item", summary: "Discarded 4" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "updated");
                await discardFridgeItem(f.fridge, f.stock, f.foods, {
                    householdId: HH,
                    itemId,
                    amount: 4,
                });
            },
        );
        // The food is gone by the time the undo looks for it.
        const out = await undoAgentAction(
            { ...f.deps, foods: createMemoryFoodsStore() },
            {
                householdId: HH,
                userId: OWNER,
                actionId: action.id,
                now: T0,
            },
        );
        expect(out).toEqual({
            status: "conflict",
            message: "The food was merged, archived or deleted since.",
        });
    });

    test("recording fridge items needs the stock store, and a baseline read before the write", async () => {
        const { f, itemId } = await twelveEggsAndSomeDrift();
        await expect(
            withAgentAction(
                { ...f.deps, stock: undefined },
                asMember,
                { tool: "discard_fridge_item", summary: "x" },
                async (rec) => {
                    await rec.captureByIds("fridge_items", [itemId], "updated");
                },
            ),
        ).rejects.toThrow("needs deps.stock");
        const row = fridgeItemToRow(
            (await f.fridge.listItems(HH)).find((item) => item.id === itemId)!,
        );
        await expect(
            withAgentAction(
                f.deps,
                asMember,
                { tool: "discard_fridge_item", summary: "x" },
                async (rec) => {
                    rec.updated("fridge_items", [row]);
                },
            ),
        ).rejects.toThrow("use captureByIds or captureByKeys");
    });
});

describe("capturing what a delete takes with it", () => {
    const STORE = "11111111-1111-4111-8111-111111111111";
    const SECTION = "22222222-2222-4222-8222-222222222222";
    const FOOD = "33333333-3333-4333-8333-333333333333";

    function storeWorld() {
        const s = setup();
        s.store.__reference(
            "grocery_sections",
            "store_id",
            "grocery_stores",
            "cascade",
        );
        s.store.__reference(
            "grocery_lines",
            "store_id",
            "grocery_stores",
            "cascade",
        );
        s.store.__reference(
            "grocery_lines",
            "section_id",
            "grocery_sections",
            "cascade",
        );
        s.store.__reference(
            "foods",
            "usual_store_id",
            "grocery_stores",
            "set null",
        );
        s.store.__seed("grocery_stores", {
            id: STORE,
            household_id: HH,
            name: "Costco",
        });
        s.store.__seed("grocery_sections", {
            id: SECTION,
            household_id: HH,
            store_id: STORE,
            name: "Dairy",
        });
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk"));
        s.store.__seed("foods", {
            id: FOOD,
            household_id: HH,
            name: "Eggs",
            usual_store_id: STORE,
        });
        return s;
    }

    test("the row, what cascades from it, and what it clears are all recorded, and one undo restores them", async () => {
        const s = storeWorld();
        const reports: CascadeReport[] = [];
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "delete_grocery_store", summary: "Deleted Costco" },
            async (rec) => {
                reports.push(
                    await rec.captureCascade("grocery_stores", [{ id: STORE }]),
                );
                s.store.__remove("grocery_lines", L1);
                s.store.__remove("grocery_sections", SECTION);
                s.store.__remove("grocery_stores", STORE);
                s.store.__seed("foods", {
                    id: FOOD,
                    household_id: HH,
                    name: "Eggs",
                    usual_store_id: null,
                });
            },
        );
        expect(reports).toEqual([{ captured: 4, uncaptured: [] }]);
        expect(
            s.store
                .__records()[0]!
                .snapshot!.changes.map((c) => `${c.op}:${c.table}`)
                .sort(),
        ).toEqual([
            "deleted:grocery_lines",
            "deleted:grocery_sections",
            "deleted:grocery_stores",
            "updated:foods",
        ]);

        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("undone");
        expect(s.store.__rows("grocery_stores")).toHaveLength(1);
        expect(s.store.__rows("grocery_sections")).toHaveLength(1);
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
        expect(s.store.__rows("foods")[0]).toMatchObject({
            usual_store_id: STORE,
        });
    });

    test("a row that is not there records nothing, and a restricting reference is left to the write", async () => {
        const s = storeWorld();
        s.store.__reference("store_rules", "store_id", "grocery_stores");
        s.store.__seed("store_rules", {
            id: L2,
            household_id: HH,
            store_id: STORE,
        });
        const reports: CascadeReport[] = [];
        await withAgentAction(
            s.deps,
            asMember,
            { tool: "delete_grocery_store", summary: "x" },
            async (rec) => {
                reports.push(
                    await rec.captureCascade("grocery_stores", [
                        { id: crypto.randomUUID() },
                    ]),
                );
                reports.push(
                    await rec.captureCascade("grocery_stores", [{ id: STORE }]),
                );
                rec.inserted("grocery_lines", [L2]);
            },
        );
        expect(reports[0]).toEqual({ captured: 0, uncaptured: [] });
        // store_rules restricts the delete: the delete would fail, so it is not captured.
        expect(reports[1]).toEqual({ captured: 4, uncaptured: [] });
    });
});

describe("undo never puts back what has moved on since", () => {
    const FOOD = "33333333-3333-4333-8333-333333333333";
    const KEPT = "44444444-4444-4444-8444-444444444444";

    // The action runs at T0 (12:00): a food archived before that was already
    // archived when it began, one archived after it was archived since.
    const BEFORE = "2026-11-13T11:00:00+00:00";
    const AFTER = "2026-11-13T12:30:00+00:00";

    function foodRow(id: string, archivedAt: string | null = null) {
        return {
            id,
            household_id: HH,
            name: "Eggs",
            archived_at: archivedAt,
            generic_food_id: null as string | null,
            usual_product_id: null as string | null,
        };
    }

    async function undoIt(
        deps: AgentUndoDeps,
        actionId: string,
        now: Date = T0,
    ) {
        return undoAgentAction(deps, {
            householdId: HH,
            userId: OWNER,
            actionId,
            now,
        });
    }

    test("an inserted row a person edited since stays, and only an untouched one goes", async () => {
        const s = setup();
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "set_store_sections", summary: "Added a section" },
            async (rec) => {
                s.store.__seed("grocery_lines", groceryLine(L1, "Olives"));
                rec.inserted("grocery_lines", [L1]);
            },
        );
        s.store.__seed(
            "grocery_lines",
            groceryLine(L1, "Olives and pickles", { checked: true }),
        );
        const refused = await undoIt(s.deps, action.id);
        expect(refused).toEqual({
            status: "conflict",
            message:
                "The grocery line Olives and pickles was changed since, so its earlier values can't be put back.",
        });
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
        expect(s.store.__records()[0]!.undoneAt).toBeNull();

        // An edit that only moves updated_at says nothing about the data.
        s.store.__seed(
            "grocery_lines",
            groceryLine(L1, "Olives", { updated_at: "2026-04-01T00:00:00Z" }),
        );
        expect((await undoIt(s.deps, action.id)).status).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toEqual([]);
    });

    test("an inserted row the write removed again has nothing left to guard", async () => {
        const s = setup();
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "x", summary: "Added and dropped" },
            async (rec) => {
                s.store.__seed("grocery_lines", groceryLine(L1, "Olives"));
                rec.inserted("grocery_lines", [L1]);
                s.store.__remove("grocery_lines", L1);
            },
        );
        expect(s.store.__records()[0]!.snapshot!.changes[0]!.after).toBe(
            undefined,
        );
        expect((await undoIt(s.deps, action.id)).status).toBe("undone");
    });

    test("a deleted row is not put back onto a food merged away since", async () => {
        const s = setup();
        s.store.__seed("foods", foodRow(FOOD));
        s.store.__seed("grocery_lines", groceryLine(L1, "Eggs"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "delete_grocery_line", summary: "Deleted Eggs" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
                s.store.__remove("grocery_lines", L1);
            },
        );
        // The merge archives the food while the line is gone.
        s.store.__seed("foods", foodRow(FOOD, AFTER));
        expect(await undoIt(s.deps, action.id)).toEqual({
            status: "conflict",
            message: "The food was merged, archived or deleted since.",
        });
        expect(s.store.__rows("grocery_lines")).toEqual([]);

        s.store.__seed("foods", foodRow(FOOD));
        expect((await undoIt(s.deps, action.id)).status).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
    });

    test("an updated row is not pointed back at a food merged away since", async () => {
        const s = setup();
        s.store.__seed("foods", foodRow(FOOD));
        s.store.__seed("foods", foodRow(KEPT));
        s.store.__seed("grocery_lines", groceryLine(L1, "Eggs"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "merge_foods", summary: "Merged" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed(
                    "grocery_lines",
                    groceryLine(L1, "Eggs", { food_id: KEPT }),
                );
            },
        );
        s.store.__seed("foods", foodRow(FOOD, AFTER));
        expect((await undoIt(s.deps, action.id)).message).toBe(
            "The food was merged, archived or deleted since.",
        );
        expect(s.store.__rows("grocery_lines")[0]!.food_id).toBe(KEPT);
    });

    test("a food the action itself archived is live again by the time the rows go back", async () => {
        const s = setup();
        s.store.__seed("foods", foodRow(FOOD));
        s.store.__seed("grocery_lines", groceryLine(L1, "Eggs"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "merge_foods", summary: "Merged" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
                s.store.__remove("grocery_lines", L1);
                await rec.captureByIds("foods", [FOOD], "updated");
                s.store.__seed("foods", foodRow(FOOD, AFTER));
            },
        );
        expect((await undoIt(s.deps, action.id)).status).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
    });

    test("a row is put back onto a food that was already archived when the action began", async () => {
        const s = setup();
        s.store.__seed("foods", foodRow(FOOD, BEFORE));
        s.store.__seed("grocery_lines", groceryLine(L1, "Eggs"));
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "delete_grocery_line", summary: "Deleted Eggs" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "deleted");
                s.store.__remove("grocery_lines", L1);
            },
        );
        expect((await undoIt(s.deps, action.id)).status).toBe("undone");
        expect(s.store.__rows("grocery_lines")).toHaveLength(1);
    });

    describe("a food's own links to other foods", () => {
        // remove_usual lets the products of a plain food go and clears its
        // usual product; undo points them back.
        async function removedUsual() {
            const s = setup();
            s.store.__seed("foods", foodRow(KEPT));
            s.store.__seed("foods", {
                ...foodRow(FOOD),
                name: "Kirkland",
                generic_food_id: KEPT,
            });
            const { action } = await withAgentAction(
                s.deps,
                asMember,
                { tool: "remove_usual", summary: "Removed Eggs" },
                async (rec) => {
                    await rec.captureByIds("foods", [FOOD], "updated");
                    s.store.__seed("foods", foodRow(FOOD));
                },
            );
            return { s, action };
        }

        test("a generic food merged away since refuses the undo", async () => {
            const { s, action } = await removedUsual();
            s.store.__seed("foods", foodRow(KEPT, AFTER));
            expect(await undoIt(s.deps, action.id)).toEqual({
                status: "conflict",
                message: "The food was merged, archived or deleted since.",
            });
            expect(
                s.store.__rows("foods").find((r) => r.id === FOOD)!,
            ).toMatchObject({ generic_food_id: null });
            expect(s.store.__records()[0]!.undoneAt).toBeNull();
        });

        test("a usual product merged away since refuses the undo", async () => {
            const s = setup();
            s.store.__seed("foods", foodRow(KEPT));
            s.store.__seed("foods", {
                ...foodRow(FOOD),
                usual_product_id: KEPT,
            });
            const { action } = await withAgentAction(
                s.deps,
                asMember,
                { tool: "remove_usual", summary: "Removed Eggs" },
                async (rec) => {
                    await rec.captureByIds("foods", [FOOD], "updated");
                    s.store.__seed("foods", foodRow(FOOD));
                },
            );
            s.store.__seed("foods", foodRow(KEPT, AFTER));
            expect((await undoIt(s.deps, action.id)).message).toBe(
                "The food was merged, archived or deleted since.",
            );
            expect(
                s.store.__rows("foods").find((r) => r.id === FOOD)!
                    .usual_product_id,
            ).toBeNull();
        });

        test("the same links go back when their food was archived before the action", async () => {
            const { s, action } = await removedUsual();
            s.store.__seed("foods", foodRow(KEPT, BEFORE));
            expect((await undoIt(s.deps, action.id)).status).toBe("undone");
            expect(
                s.store.__rows("foods").find((r) => r.id === FOOD)!
                    .generic_food_id,
            ).toBe(KEPT);
        });
    });

    describe("a fridge item whose food the action changed", () => {
        async function mergedItem() {
            const f = await fridgeSetup();
            const other = await findOrCreateManualFood(
                f.foods,
                HH,
                "food",
                "Hen eggs",
            );
            const added = await addFridgeItemAdjust(
                f.fridge,
                f.stock,
                f.foods,
                {
                    householdId: HH,
                    foodId: f.eggsFood.id,
                    amount: 12,
                    unit: "each",
                    locationId: f.location.id,
                },
            );
            const item = added.item!;
            const { action } = await withAgentAction(
                f.deps,
                asMember,
                { tool: "merge_foods", summary: "Merged Eggs into Hen eggs" },
                async (rec) => {
                    await rec.captureByIds(
                        "fridge_items",
                        [item.id],
                        "updated",
                    );
                    await f.fridge.updateItem({ ...item, foodId: other.id });
                },
            );
            return { f, item, other, action };
        }

        test("is put back while nothing was written for it since", async () => {
            const { f, item, action } = await mergedItem();
            expect((await undoIt(f.deps, action.id)).status).toBe("undone");
            expect((await f.fridge.listItems(HH))[0]!.foodId).toBe(item.foodId);
        });

        test("is not, once a movement was written for it after the action", async () => {
            const { f, item, other, action } = await mergedItem();
            const after = new Date(Date.now() + 1000).toISOString();
            await f.stock.insertMovement({
                id: crypto.randomUUID(),
                householdId: HH,
                foodId: other.id,
                fridgeItemId: item.id,
                delta: -2,
                unit: "each",
                reason: "eat",
                groceryLineId: null,
                recipeId: null,
                mealId: null,
                actorUserId: OWNER,
                createdAt: after,
            });
            const out = await undoIt(f.deps, action.id);
            expect(out.status).toBe("conflict");
            expect(out.message).toBe(
                "The fridge item Eggs was used since, so its earlier values can't be put back.",
            );
            expect((await f.fridge.listItems(HH))[0]!.foodId).toBe(other.id);
        });

        test("ignores movements for other items and the ones before the action", async () => {
            const { f, other, action } = await mergedItem();
            await f.stock.insertMovement({
                id: crypto.randomUUID(),
                householdId: HH,
                foodId: other.id,
                fridgeItemId: crypto.randomUUID(),
                delta: -2,
                unit: "each",
                reason: "eat",
                groceryLineId: null,
                recipeId: null,
                mealId: null,
                actorUserId: OWNER,
                createdAt: new Date(Date.now() + 1000).toISOString(),
            });
            expect((await undoIt(f.deps, action.id)).status).toBe("undone");
        });
    });
});

describe("undo locks the rows it checks", () => {
    test("an updated row and an inserted row are read with a lock", async () => {
        const s = setup();
        const reads: { table: string; lock: boolean }[] = [];
        const inner = s.store;
        const spy: AgentActionsStore = {
            ...inner,
            atomically: (fn) =>
                inner.atomically((tx) =>
                    fn({
                        ...tx,
                        readRows(table, keys, opts) {
                            reads.push({ table, lock: opts?.lock === true });
                            return tx.readRows(table, keys, opts);
                        },
                    }),
                ),
        };
        const deps = { ...s.deps, store: spy };
        s.store.__seed("grocery_lines", groceryLine(L1, "Milk", { amount: 1 }));
        const { action } = await withAgentAction(
            deps,
            asMember,
            { tool: "change_lists", summary: "Changed" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [L1], "updated");
                s.store.__seed(
                    "grocery_lines",
                    groceryLine(L1, "Milk", { amount: 2 }),
                );
                s.store.__seed("grocery_lines", groceryLine(L2, "Eggs"));
                rec.inserted("grocery_lines", [L2]);
            },
        );
        reads.length = 0;
        expect(
            (
                await undoAgentAction(deps, {
                    householdId: HH,
                    userId: OWNER,
                    actionId: action.id,
                    now: T0,
                })
            ).status,
        ).toBe("undone");
        expect(reads).toHaveLength(2);
        expect(reads.every((read) => read.lock)).toBe(true);
    });
});

describe("the memory store follows keys, not an id column", () => {
    const U = "77777777-7777-4777-8777-777777777777";
    const DAY = "88888888-8888-4888-8888-888888888888";

    test("a reference to a table keyed by another column blocks the removal of what it points at", async () => {
        const s = setup();
        s.store.__reference(
            "nutrition_goal_days",
            "user_id",
            "nutrition_goals",
        );
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "set_nutrition_goals", summary: "Set goals" },
            async (rec) => {
                s.store.__seed("nutrition_goals", {
                    user_id: U,
                    daily_calories: 2000,
                });
                rec.insertedKeys("nutrition_goals", [{ user_id: U }]);
            },
        );
        s.store.__seed("nutrition_goal_days", {
            id: DAY,
            user_id: U,
            household_id: HH,
        });
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out).toEqual({
            status: "conflict",
            message:
                "This nutrition goal is used by 1 nutrition goal day now; change or remove it first, or keep the nutrition goal.",
        });
        expect(s.store.__rows("nutrition_goals")).toHaveLength(1);
    });

    test("a row put back must find the column it references, not an id", async () => {
        const s = setup();
        s.store.__reference(
            "nutrition_goal_days",
            "user_id",
            "nutrition_goals",
        );
        s.store.__seed("nutrition_goals", { user_id: U, daily_calories: 2000 });
        s.store.__seed("nutrition_goal_days", {
            id: DAY,
            user_id: U,
            household_id: HH,
        });
        const { action } = await withAgentAction(
            s.deps,
            asMember,
            { tool: "clear_goals", summary: "Cleared goals" },
            async (rec) => {
                await rec.captureByKeys(
                    "nutrition_goal_days",
                    [{ id: DAY }],
                    "deleted",
                );
                s.store.__remove("nutrition_goal_days", DAY);
            },
        );
        s.store.__remove("nutrition_goals", { user_id: U });
        const out = await undoAgentAction(s.deps, {
            householdId: HH,
            userId: OWNER,
            actionId: action.id,
            now: T0,
        });
        expect(out.status).toBe("conflict");
        expect(s.store.__rows("nutrition_goal_days")).toEqual([]);
    });
});

describe("the module's comments", () => {
    test("carry no plan or phase wording", async () => {
        // Imported as text, so the sibling module is checked whenever it is.
        const source = (await import("./agent-actions.ts", {
            with: { type: "text" },
        })) as unknown as { default: string };
        expect(source.default.length).toBeGreaterThan(1000);
        expect(source.default).not.toMatch(/\bphase\b|\bplan\b/i);
    });
});
