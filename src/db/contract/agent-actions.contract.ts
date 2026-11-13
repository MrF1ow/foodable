import { describe, expect, test } from "bun:test";
import {
    AGENT_UNDO_TTL_MS,
    AgentUndoConflictError,
    type AgentActionRecord,
    type AgentActionsStore,
    type AgentSnapshotRow,
} from "../../domain/agent-actions.js";

export type AgentActionsContractCtx = {
    householdId: string;
    otherHouseholdId: string;
    /** The household's owner. */
    ownerId: string;
    /** A member of the household who is not its owner. */
    memberId: string;
    /** A food of the household (a plain id where there are no foreign keys). */
    foodId: string;
    /**
     * Runs `fn` as the other household, the way a request for it would. Live
     * contexts only: row level security keeps one household's actions out of
     * another's view, so a test that writes or reads there has to act there.
     */
    asOtherHousehold?: <T>(fn: () => Promise<T>) => Promise<T>;
};

const T0 = new Date("2026-11-13T12:00:00.000Z");

function record(
    ctx: AgentActionsContractCtx,
    overrides: Partial<AgentActionRecord> = {},
): AgentActionRecord {
    const createdAt = overrides.createdAt ?? T0.toISOString();
    return {
        id: crypto.randomUUID(),
        householdId: ctx.householdId,
        memberId: ctx.memberId,
        connection: "Claude",
        tool: "delete_grocery_line",
        summary: "Deleted Milk",
        destructive: true,
        snapshot: {
            v: 1,
            changes: [
                {
                    table: "grocery_stores",
                    op: "deleted",
                    row: {
                        id: crypto.randomUUID(),
                        name: "Costco",
                        created_at: "2026-03-01T12:00:00+00:00",
                    },
                },
            ],
        },
        undoable: true,
        createdAt,
        undoExpiresAt: new Date(
            Date.parse(createdAt) + AGENT_UNDO_TTL_MS,
        ).toISOString(),
        undoneAt: null,
        undoneBy: null,
        ...overrides,
    };
}

function asOther<T>(
    c: AgentActionsContractCtx,
    fn: () => Promise<T>,
): Promise<T> {
    return c.asOtherHousehold ? c.asOtherHousehold(fn) : fn();
}

function storeRow(
    ctx: AgentActionsContractCtx,
    overrides: AgentSnapshotRow = {},
): AgentSnapshotRow {
    return {
        id: crypto.randomUUID(),
        household_id: ctx.householdId,
        name: "Corner shop",
        sort_order: 2,
        created_at: "2026-03-01T12:00:00+00:00",
        ...overrides,
    };
}

export function runAgentActionsStoreContract(
    label: string,
    createStore: () => AgentActionsStore,
    reset: () => Promise<void>,
    ctx: () => AgentActionsContractCtx,
): void {
    describe(`${label} agent actions store`, () => {
        test("an action round-trips and lists newest first within the limit", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const oldest = record(c, {
                summary: "oldest",
                createdAt: "2026-11-13T10:00:00.000Z",
            });
            const middle = record(c, {
                summary: "middle",
                memberId: null,
                connection: "household token",
                createdAt: "2026-11-13T11:00:00.000Z",
            });
            const newest = record(c, {
                summary: "newest",
                createdAt: "2026-11-13T12:00:00.000Z",
            });
            const foreign = record(c, {
                householdId: c.otherHouseholdId,
                memberId: null,
                summary: "foreign",
            });
            await store.atomically(async (tx) => {
                await tx.insertAction(middle);
                await tx.insertAction(oldest);
                await tx.insertAction(newest);
            });
            await asOther(c, () =>
                store.atomically((tx) => tx.insertAction(foreign)),
            );

            expect(await store.list(c.householdId, 10)).toEqual([
                newest,
                middle,
                oldest,
            ]);
            expect(
                (await store.list(c.householdId, 2)).map((r) => r.summary),
            ).toEqual(["newest", "middle"]);
            expect(
                (
                    await asOther(c, () => store.list(c.otherHouseholdId, 10))
                ).map((r) => r.summary),
            ).toEqual(["foreign"]);
        });

        test("lockAction finds only the household's own action; markUndone records who and when", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const action = record(c);
            await store.atomically((tx) => tx.insertAction(action));

            await store.atomically(async (tx) => {
                expect(await tx.lockAction(c.householdId, action.id)).toEqual(
                    action,
                );
                expect(
                    await tx.lockAction(c.otherHouseholdId, action.id),
                ).toBeNull();
                expect(
                    await tx.lockAction(c.householdId, crypto.randomUUID()),
                ).toBeNull();
                await tx.markUndone(
                    action.id,
                    c.ownerId,
                    new Date("2026-11-13T13:00:00.000Z"),
                );
            });
            const [stored] = await store.list(c.householdId, 1);
            expect(stored).toEqual({
                ...action,
                undoneAt: "2026-11-13T13:00:00.000Z",
                undoneBy: c.ownerId,
            });
        });

        test("isOwner is true for the owner only", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.atomically(async (tx) => {
                expect(await tx.isOwner(c.householdId, c.ownerId)).toBe(true);
                expect(await tx.isOwner(c.householdId, c.memberId)).toBe(false);
                expect(
                    await tx.isOwner(c.householdId, crypto.randomUUID()),
                ).toBe(false);
                expect(await tx.isOwner(c.otherHouseholdId, c.ownerId)).toBe(
                    false,
                );
            });
        });

        test("purgeSnapshots empties only snapshots whose window ended and keeps the entries", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const old = record(c, {
                summary: "old",
                createdAt: T0.toISOString(),
            });
            const fresh = record(c, {
                summary: "fresh",
                createdAt: "2026-11-14T08:00:00.000Z",
            });
            await store.atomically(async (tx) => {
                await tx.insertAction(old);
                await tx.insertAction(fresh);
            });
            const now = new Date("2026-11-14T13:00:00.000Z");
            expect(await store.purgeSnapshots(now)).toBe(1);
            const listed = await store.list(c.householdId, 10);
            expect(listed.map((r) => [r.summary, r.snapshot === null])).toEqual(
                [
                    ["fresh", false],
                    ["old", true],
                ],
            );
            expect(await store.purgeSnapshots(now)).toBe(0);
        });

        test("rows read back as stored, replace in place, and delete", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const row = storeRow(c);
            await store.atomically(async (tx) => {
                await tx.insertRow("grocery_stores", row);
                expect(
                    await tx.readRows("grocery_stores", [
                        { id: row.id as string },
                        { id: crypto.randomUUID() },
                    ]),
                ).toEqual([row]);
                expect(
                    await tx.replaceColumns(
                        "grocery_stores",
                        { id: row.id as string },
                        { set: { name: "Renamed", sort_order: 7 }, json: {} },
                    ),
                ).toBe(true);
                expect(
                    await tx.readRows("grocery_stores", [
                        { id: row.id as string },
                    ]),
                ).toEqual([{ ...row, name: "Renamed", sort_order: 7 }]);
                expect(
                    await tx.replaceColumns(
                        "grocery_stores",
                        { id: crypto.randomUUID() },
                        { set: { name: "Renamed" }, json: {} },
                    ),
                ).toBe(false);
                await tx.deleteRow("grocery_stores", { id: row.id as string });
                await tx.deleteRow("grocery_stores", { id: row.id as string });
                expect(
                    await tx.readRows("grocery_stores", [
                        { id: row.id as string },
                    ]),
                ).toEqual([]);
            });
        });

        test("rows with a composite key read, replace and delete by that key", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const mine = {
                household_id: c.householdId,
                alias: "ovos",
                food_id: c.foodId,
            };
            const sibling = { ...mine, alias: "huevos" };
            await store.atomically(async (tx) => {
                await tx.insertRow("food_aliases", mine);
                await tx.insertRow("food_aliases", sibling);
                const key = { household_id: c.householdId, alias: "ovos" };
                expect(await tx.readRows("food_aliases", [key])).toEqual([
                    mine,
                ]);
                expect(
                    await tx.readRows("food_aliases", [
                        key,
                        { household_id: c.householdId, alias: "missing" },
                    ]),
                ).toEqual([mine]);
                expect(
                    await tx.replaceColumns("food_aliases", key, {
                        set: { food_id: c.foodId },
                        json: {},
                    }),
                ).toBe(true);
                expect(
                    await tx.replaceColumns(
                        "food_aliases",
                        { household_id: c.householdId, alias: "missing" },
                        { set: { food_id: c.foodId }, json: {} },
                    ),
                ).toBe(false);
                await tx.deleteRow("food_aliases", key);
                expect(await tx.readRows("food_aliases", [key])).toEqual([]);
                expect(
                    await tx.readRows("food_aliases", [
                        { household_id: c.householdId, alias: "huevos" },
                    ]),
                ).toEqual([sibling]);
            });
        });

        test("referencingRows counts the rows that point at a row and would block or cascade its delete", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const parent = storeRow(c, { name: "Costco" });
            const section = {
                id: crypto.randomUUID(),
                household_id: c.householdId,
                store_id: parent.id,
                name: "Dairy",
                sort_order: 0,
                hidden: false,
                is_other: false,
                created_at: "2026-03-01T12:00:00+00:00",
            };
            await store.atomically(async (tx) => {
                await tx.insertRow("grocery_stores", parent);
                expect(
                    await tx.referencingRows("grocery_stores", {
                        id: parent.id as string,
                    }),
                ).toEqual([]);
                await tx.insertRow("grocery_sections", section);
                expect(
                    await tx.referencingRows("grocery_stores", {
                        id: parent.id as string,
                    }),
                ).toEqual([{ table: "grocery_sections", count: 1 }]);
                expect(
                    await tx.referencingRows("grocery_stores", {
                        id: crypto.randomUUID(),
                    }),
                ).toEqual([]);
            });
        });

        test("cascadeRows lists the rows deleting a row would take with it, and says nothing else", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const parent = storeRow(c, { name: "Costco" });
            const section = {
                id: crypto.randomUUID(),
                household_id: c.householdId,
                store_id: parent.id,
                name: "Dairy",
                sort_order: 0,
                hidden: false,
                is_other: false,
                created_at: "2026-03-01T12:00:00+00:00",
            };
            await store.atomically(async (tx) => {
                await tx.insertRow("grocery_stores", parent);
                expect(
                    await tx.cascadeRows("grocery_stores", [
                        { id: parent.id as string },
                    ]),
                ).toEqual({ rows: [], uncaptured: [] });
                await tx.insertRow("grocery_sections", section);
                expect(
                    await tx.cascadeRows("grocery_stores", [
                        { id: parent.id as string },
                        { id: crypto.randomUUID() },
                    ]),
                ).toEqual({
                    rows: [
                        {
                            table: "grocery_sections",
                            op: "deleted",
                            row: section,
                        },
                    ],
                    uncaptured: [],
                });
            });
        });

        test("a taken name and a missing parent are conflicts, not crashes", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const first = storeRow(c, { name: "Costco" });
            await store.atomically((tx) =>
                tx.insertRow("grocery_stores", first),
            );

            const second = storeRow(c, { name: "Costco" });
            const taken = await store
                .atomically((tx) => tx.insertRow("grocery_stores", second))
                .catch((err: unknown) => err);
            expect(taken).toBeInstanceOf(AgentUndoConflictError);
            expect((taken as AgentUndoConflictError).conflict).toEqual({
                kind: "unique",
            });
            expect((taken as AgentUndoConflictError).message).toBe(
                "A grocery store named Costco already exists.",
            );

            const orphan = {
                id: crypto.randomUUID(),
                household_id: c.householdId,
                store_id: crypto.randomUUID(),
                name: "Dairy",
                sort_order: 0,
                hidden: false,
                is_other: false,
                created_at: "2026-03-01T12:00:00+00:00",
            };
            const missing = await store
                .atomically((tx) => tx.insertRow("grocery_sections", orphan))
                .catch((err: unknown) => err);
            expect(missing).toBeInstanceOf(AgentUndoConflictError);
            expect((missing as AgentUndoConflictError).conflict).toEqual({
                kind: "missing_reference",
                referencedTable: "grocery_stores",
            });
        });
    });
}
