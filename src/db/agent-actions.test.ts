import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    AGENT_SNAPSHOT_TABLES,
    AGENT_TABLE_KEYS,
    AGENT_UNDO_TTL_MS,
    AgentActionsDisabledError,
    createMemoryAgentActionsStore,
    listAgentActions,
    purgeExpiredAgentSnapshots,
    undoAgentAction,
    withAgentAction,
    type AgentActionActor,
    type CascadeReport,
} from "../domain/agent-actions.js";
import { findFoodById } from "../domain/foods.js";
import { addLocation, deleteLocation } from "../domain/fridge.js";
import { createGroceryStore } from "../domain/settings.js";
import {
    addFridgeItemAdjust,
    deleteFridgeItemAdjust,
    discardFridgeItem,
    ledgerMatchesStock,
} from "../domain/stock.js";
import { setFallbackActorForTests, withActor } from "./actor.js";
import {
    runAgentActionsStoreContract,
    type AgentActionsContractCtx,
} from "./contract/agent-actions.contract.js";
import {
    sampleGroceryLine,
    type StoreContractCtx,
} from "./contract/helpers.js";
import { liveAgentActionDeps, liveAgentActionsStore } from "./agent-actions.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { getHouseholdConfig, updateHouseholdConfig } from "./household.js";
import { liveSettingsStore } from "./settings.js";
import { run, setSqlForTests } from "./sql.js";
import { liveStockStore } from "./stock.js";
import { describeDb } from "./testing/pg.js";
import {
    asUser,
    seedFood,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
const HOUR = 60 * 60 * 1000;

describe("agent actions store (memory)", () => {
    let ctx: AgentActionsContractCtx;
    let store: ReturnType<typeof createMemoryAgentActionsStore>;

    beforeEach(() => {
        ctx = {
            householdId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            ownerId: crypto.randomUUID(),
            memberId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
        };
        store = createMemoryAgentActionsStore();
        store.__setOwner(ctx.householdId, ctx.ownerId);
        store.__unique("grocery_stores", ["household_id", "name"]);
        store.__reference(
            "grocery_sections",
            "store_id",
            "grocery_stores",
            "cascade",
        );
    });

    runAgentActionsStoreContract(
        "memory",
        () => store,
        async () => {},
        () => ctx,
    );
});

describeDb(pgAvailable !== null, "agent actions (live)", (getCtx) => {
    let ctx: AgentActionsContractCtx & {
        storeId: string;
        sectionId: string;
        foodId: string;
    };

    afterEach(() => setSqlForTests(null));

    async function reseed(): Promise<void> {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const primary = await seedHousehold(sql);
        const other = await seedHousehold(sql);
        const memberId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${memberId}, ${`member-${memberId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${primary.householdId}, ${memberId}, 'member', 'Member')
        `;
        // Two households exist; pin the actor so it is not a coin flip.
        setFallbackActorForTests({
            kind: "user",
            userId: primary.userId,
            householdId: primary.householdId,
        });
        const storeId = await seedGroceryStore(
            sql,
            primary.householdId,
            "Main",
        );
        ctx = {
            householdId: primary.householdId,
            otherHouseholdId: other.householdId,
            ownerId: primary.userId,
            memberId,
            asOtherHousehold: (fn) =>
                asUser(other.userId, fn, other.householdId),
            storeId,
            sectionId: await seedGrocerySection(
                sql,
                primary.householdId,
                storeId,
            ),
            foodId: await seedFood(sql, primary.householdId),
        };
    }

    beforeEach(reseed);

    runAgentActionsStoreContract(
        "live",
        () => liveAgentActionsStore(),
        reseed,
        () => ctx,
    );

    const actor = (): AgentActionActor => ({
        householdId: ctx.householdId,
        memberId: ctx.memberId,
        connection: "Claude",
    });
    const lineCtx = (): StoreContractCtx => ({
        householdId: ctx.householdId,
        userId: ctx.ownerId,
        otherHouseholdId: ctx.otherHouseholdId,
        storeId: ctx.storeId,
        sectionId: ctx.sectionId,
        foodId: ctx.foodId,
        locationId: crypto.randomUUID(),
    });

    async function lineJson(ids: string[]) {
        const found = (await getCtx().sql`
            select to_jsonb(t) as j
            from public.grocery_lines t
            where id = any(${getCtx().sql.array(ids, "uuid")})
            order by id
        `) as { j: Record<string, unknown> }[];
        return found.map((row) => row.j);
    }

    test("every table an undo may touch exists with exactly its mapped key columns", async () => {
        const found = (await getCtx().sql`
            select tc.table_name, kcu.column_name, c.data_type
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on kcu.constraint_name = tc.constraint_name
             and kcu.table_schema = tc.table_schema
            join information_schema.columns c
              on c.table_schema = tc.table_schema
             and c.table_name = tc.table_name
             and c.column_name = kcu.column_name
            where tc.table_schema = 'public'
              and tc.constraint_type = 'PRIMARY KEY'
        `) as { table_name: string; column_name: string; data_type: string }[];
        expect(Object.keys(AGENT_TABLE_KEYS)).toEqual([
            ...AGENT_SNAPSHOT_TABLES,
        ]);
        for (const table of AGENT_SNAPSHOT_TABLES) {
            const keys = found.filter((row) => row.table_name === table);
            expect(keys.map((row) => row.column_name).sort()).toEqual(
                [...AGENT_TABLE_KEYS[table]].sort(),
            );
            for (const key of keys) {
                expect(["uuid", "text"]).toContain(key.data_type);
            }
        }
    });

    test("AGENT_SNAPSHOT_TABLES lists a parent before every table that points at it", async () => {
        const fks = (await getCtx().sql`
            select conrelid::regclass::text as child,
                   confrelid::regclass::text as parent
            from pg_constraint
            where contype = 'f'
              and connamespace = 'public'::regnamespace
        `) as { child: string; parent: string }[];
        const rank = (table: string) =>
            (AGENT_SNAPSHOT_TABLES as readonly string[]).indexOf(table);
        let checked = 0;
        for (const { child, parent } of fks) {
            if (child === parent || rank(child) < 0 || rank(parent) < 0) {
                continue;
            }
            checked++;
            expect(
                rank(parent),
                `${parent} must come before ${child}`,
            ).toBeLessThan(rank(child));
        }
        expect(checked).toBeGreaterThan(10);
    });

    test("the snapshot is stored as a jsonb object, not as a string", async () => {
        const grocery = liveGroceryStore();
        const line = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
        );
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_grocery_line", summary: "Deleted Milk" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [line.id], "deleted");
                await grocery.deleteLine(ctx.householdId, line.id);
            },
        );
        const [stored] = (await getCtx().sql`
            select jsonb_typeof(snapshot) as kind,
                   snapshot -> 'changes' -> 0 ->> 'table' as table_name,
                   snapshot -> 'changes' -> 0 -> 'row' ->> 'id' as row_id,
                   jsonb_typeof(snapshot -> 'changes' -> 0 -> 'row' -> 'amount') as amount_kind
            from public.agent_actions where id = ${action.id}
        `) as {
            kind: string;
            table_name: string;
            row_id: string;
            amount_kind: string;
        }[];
        expect(stored).toEqual({
            kind: "object",
            table_name: "grocery_lines",
            row_id: line.id,
            amount_kind: "number",
        });
        const [listed] = await liveAgentActionsStore().list(ctx.householdId, 1);
        expect(typeof listed!.snapshot).toBe("object");
        expect(listed!.snapshot!.changes[0]!.row.id).toBe(line.id);
        expect(listed!.undoExpiresAt).toBe(
            new Date(
                Date.parse(listed!.createdAt) + AGENT_UNDO_TTL_MS,
            ).toISOString(),
        );
    });

    test("a write that throws after the recorder captured rows leaves no action and no partial write", async () => {
        const grocery = liveGroceryStore();
        const keep = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Keep" }),
        );
        const other = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Other" }),
        );
        await expect(
            withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "clear_checked_grocery_lines", summary: "Cleared" },
                async (rec) => {
                    await rec.captureByIds(
                        "grocery_lines",
                        [keep.id, other.id],
                        "deleted",
                    );
                    await grocery.deleteLine(ctx.householdId, keep.id);
                    throw new Error("boom after the first delete");
                },
            ),
        ).rejects.toThrow("boom after the first delete");
        const [count] = (await getCtx().sql`
            select count(*)::int as n from public.agent_actions
        `) as { n: number }[];
        expect(count!.n).toBe(0);
        expect(
            (await grocery.listLines(ctx.householdId)).map(
                (l) => l.displayName,
            ),
        ).toEqual(["Keep", "Other"]);
    });

    test("undo puts deleted grocery lines back exactly, with timestamps and uuids as columns", async () => {
        const grocery = liveGroceryStore();
        const milk = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), {
                displayName: "Milk",
                quantity: { amount: 2.25, unit: "L" },
                note: "skim, the blue one",
            }),
        );
        const eggs = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), {
                displayName: "Eggs",
                checked: true,
                quantity: { amount: 12, unit: "each" },
            }),
        );
        // Give the rows timestamps a default would not produce.
        await getCtx().sql`
            update public.grocery_lines
            set created_at = '2026-01-02 03:04:05.678+00',
                updated_at = '2026-02-03 04:05:06.789+00'
            where id = ${milk.id}
        `;
        const ids = [milk.id, eggs.id].sort();
        const before = await lineJson(ids);
        expect(before).toHaveLength(2);

        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "clear_checked_grocery_lines", summary: "Cleared 2 lines" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", ids, "deleted");
                await grocery.deleteLine(ctx.householdId, milk.id);
                await grocery.deleteLine(ctx.householdId, eggs.id);
            },
        );
        expect(await grocery.listLines(ctx.householdId)).toEqual([]);

        const out = await asUser(
            ctx.memberId,
            () =>
                undoAgentAction(deps, {
                    householdId: ctx.householdId,
                    userId: ctx.memberId,
                    actionId: action.id,
                    now: new Date(),
                }),
            ctx.householdId,
        );
        expect(out).toEqual({
            status: "undone",
            message: "Undone: Cleared 2 lines",
        });
        expect(await lineJson(ids)).toEqual(before);
        const [entry] = await listAgentActions(deps, ctx.householdId, {
            limit: 1,
        });
        expect(entry).toMatchObject({ id: action.id, canUndo: false });
        expect(entry!.undoneAt).not.toBeNull();
    });

    test("a food row with arrays, jsonb and nullable numbers comes back identical", async () => {
        const sql = getCtx().sql;
        const foodId = await seedFood(sql, ctx.householdId, {
            name: "Granola",
        });
        await sql`
            update public.foods
            set allergens = ${sql.array(["gluten", "tree nuts"], "text")},
                additives_tags = ${sql.array(["en:e322"], "text")},
                off_nutrient_levels = ${JSON.stringify({ fat: "moderate", sugars: "high" })}::jsonb,
                calories = 471.5, protein_g = 10.25, grams_per_each = null,
                restock_paused = true,
                usual_amount = 500, usual_unit = 'g',
                serving_label = '1 bowl', serving_amount = 45, serving_unit = 'g',
                archived_at = '2026-10-01 08:00:00.123+00',
                last_restocked_on = '2026-10-02'
            where id = ${foodId}
        `;
        const [before] = (await sql`
            select to_jsonb(t) as j from public.foods t where id = ${foodId}
        `) as { j: Record<string, unknown> }[];
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_food", summary: "Deleted Granola" },
            async (rec) => {
                await rec.captureByIds("foods", [foodId], "deleted");
                await run(
                    (tx) => tx`delete from public.foods where id = ${foodId}`,
                );
            },
        );
        const out = await undoAgentAction(deps, {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        });
        expect(out.status).toBe("undone");
        const [after] = (await sql`
            select to_jsonb(t) as j from public.foods t where id = ${foodId}
        `) as { j: Record<string, unknown> }[];
        expect(after!.j).toEqual(before!.j);
        expect((after!.j.allergens as string[]).sort()).toEqual([
            "gluten",
            "tree nuts",
        ]);
    });

    test("undo puts an updated row back and removes an inserted one", async () => {
        const grocery = liveGroceryStore();
        const milk = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), {
                displayName: "Milk",
                quantity: { amount: 1, unit: "L" },
            }),
        );
        const [beforeJson] = await lineJson([milk.id]);
        const deps = liveAgentActionDeps();
        let madeId = "";
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "replace_list", summary: "Rewrote the list" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [milk.id], "updated");
                await grocery.updateLine({
                    ...milk,
                    quantity: { amount: 9, unit: "L" },
                    note: "changed",
                });
                const made = await grocery.insertLine(
                    sampleGroceryLine(lineCtx(), { displayName: "Oat milk" }),
                );
                madeId = made.id;
                rec.inserted("grocery_lines", [made.id]);
            },
        );
        const out = await undoAgentAction(deps, {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        });
        expect(out.status).toBe("undone");
        const [afterJson] = await lineJson([milk.id]);
        // updated_at is bookkeeping: an undo neither compares nor restores it.
        const { updated_at: _was, ...beforeRest } = beforeJson!;
        const { updated_at: _is, ...afterRest } = afterJson!;
        expect(afterRest).toEqual(beforeRest);
        expect(await lineJson([madeId])).toEqual([]);
    });

    test("a deleted fridge item comes back with the stock ledger still balanced", async () => {
        const sql = getCtx().sql;
        const fridge = liveFridgeStore();
        const stock = liveStockStore();
        const foods = liveFoodsStore();
        const location = await addLocation(fridge, ctx.householdId, "Fridge");
        const added = await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: ctx.householdId,
            foodId: ctx.foodId,
            amount: 250,
            unit: "g",
            locationId: location.id,
            expiresOn: "2026-12-01",
        });
        const itemId = added.item!.id;
        const food = await findFoodById(foods, ctx.householdId, ctx.foodId);
        const [beforeRow] = (await sql`
            select to_jsonb(t) as j from public.fridge_items t where id = ${itemId}
        `) as { j: Record<string, unknown> }[];

        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_fridge_item", summary: "Deleted the eggs" },
            async (rec) => {
                await rec.captureByIds("fridge_items", [itemId], "deleted");
                await deleteFridgeItemAdjust(fridge, stock, foods, {
                    householdId: ctx.householdId,
                    itemId,
                });
            },
        );
        expect(await fridge.listItems(ctx.householdId)).toEqual([]);
        expect(
            ledgerMatchesStock(
                [],
                await stock.listMovements(ctx.householdId),
                food,
            ),
        ).toBe(true);

        const out = await undoAgentAction(deps, {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        });
        expect(out.status).toBe("undone");
        const items = await fridge.listItems(ctx.householdId);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: itemId,
            quantity: { amount: 250, unit: "g" },
            expiresOn: "2026-12-01",
        });
        const [afterRow] = (await sql`
            select to_jsonb(t) as j from public.fridge_items t where id = ${itemId}
        `) as { j: Record<string, unknown> }[];
        expect(afterRow!.j).toEqual(beforeRow!.j);
        expect(
            ledgerMatchesStock(
                items,
                await stock.listMovements(ctx.householdId),
                food,
            ),
        ).toBe(true);
    });

    test("a taken store name refuses the undo and leaves everything as it was", async () => {
        const settings = liveSettingsStore();
        const grocery = liveGroceryStore();
        const costco = await createGroceryStore(
            settings,
            ctx.householdId,
            "Costco",
        );
        const [section] = await settings.listSections(costco.id);
        const line = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), {
                displayName: "Water",
                storeId: costco.id,
                sectionId: section!.id,
            }),
        );
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_grocery_store", summary: "Deleted Costco" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [line.id], "deleted");
                await rec.captureByIds(
                    "grocery_sections",
                    (await settings.listSections(costco.id)).map((s) => s.id),
                    "deleted",
                );
                await rec.captureByIds(
                    "grocery_stores",
                    [costco.id],
                    "deleted",
                );
                await run(
                    (tx) =>
                        tx`delete from public.grocery_stores where id = ${costco.id}`,
                );
            },
        );
        expect(await settings.listStores(ctx.householdId)).toHaveLength(1);
        // A new store took the name in the meantime, made the way a tool or
        // the app would: through run(), not the owner connection.
        await run(
            (tx) => tx`
                insert into public.grocery_stores (household_id, name, sort_order)
                values (${ctx.householdId}, ${"Costco"}, ${5})
            `,
        );
        const storesBefore = await settings.listStores(ctx.householdId);

        const out = await undoAgentAction(deps, {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        });
        expect(out).toEqual({
            status: "conflict",
            message: "A grocery store named Costco already exists.",
        });
        expect(await settings.listStores(ctx.householdId)).toEqual(
            storesBefore,
        );
        expect(await grocery.listLines(ctx.householdId)).toEqual([]);
        const [stored] = await liveAgentActionsStore().list(ctx.householdId, 1);
        expect(stored!.undoneAt).toBeNull();
        expect(stored!.snapshot).not.toBeNull();
    });

    test("a conflict half way through rolls back the rows already put back", async () => {
        const settings = liveSettingsStore();
        const spare = await createGroceryStore(
            settings,
            ctx.householdId,
            "Spare",
        );
        const aldi = await createGroceryStore(
            settings,
            ctx.householdId,
            "Aldi",
        );
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_stuff", summary: "Deleted Spare and Aldi" },
            async (rec) => {
                // Put back in this order: Spare goes in, then Aldi hits the name.
                await rec.captureByIds("grocery_stores", [spare.id], "deleted");
                await rec.captureByIds("grocery_stores", [aldi.id], "deleted");
                await run(
                    (tx) =>
                        tx`delete from public.grocery_stores where id = any(${tx.array([spare.id, aldi.id], "uuid")})`,
                );
            },
        );
        await createGroceryStore(settings, ctx.householdId, "Aldi");
        const out = await undoAgentAction(deps, {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        });
        expect(out.status).toBe("conflict");
        expect(
            (await settings.listStores(ctx.householdId)).map((s) => s.name),
        ).not.toContain("Spare");
        expect((await storedAction(action.id)).undoneAt).toBeNull();
    });

    test("a food merged away since is named in the conflict", async () => {
        const grocery = liveGroceryStore();
        const eggsId = await seedFood(getCtx().sql, ctx.householdId, {
            name: "Free range eggs",
        });
        const line = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), {
                displayName: "Free range eggs",
                foodId: eggsId,
            }),
        );
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_grocery_line", summary: "Deleted eggs" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [line.id], "deleted");
                await grocery.deleteLine(ctx.householdId, line.id);
            },
        );
        await getCtx().sql`delete from public.foods where id = ${eggsId}`;
        const out = await undoAgentAction(deps, {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        });
        expect(out).toEqual({
            status: "conflict",
            message:
                "The food Free range eggs was merged, archived or deleted since.",
        });
    });

    test("undoing twice changes nothing the second time", async () => {
        const grocery = liveGroceryStore();
        const milk = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
        );
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_grocery_line", summary: "Deleted Milk" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [milk.id], "deleted");
                await grocery.deleteLine(ctx.householdId, milk.id);
            },
        );
        const input = {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId: action.id,
            now: new Date(),
        };
        expect((await undoAgentAction(deps, input)).status).toBe("undone");
        await grocery.deleteLine(ctx.householdId, milk.id);
        expect((await undoAgentAction(deps, input)).status).toBe(
            "already_undone",
        );
        expect(await grocery.listLines(ctx.householdId)).toEqual([]);
    });

    test("someone who is neither the owner nor the acting member gets not_found", async () => {
        const grocery = liveGroceryStore();
        const sql = getCtx().sql;
        const milk = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
        );
        const bystander = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${bystander}, ${`b-${bystander}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${ctx.householdId}, ${bystander}, 'member', 'Bystander')
        `;
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_grocery_line", summary: "Deleted Milk" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [milk.id], "deleted");
                await grocery.deleteLine(ctx.householdId, milk.id);
            },
        );
        const attempt = (userId: string, householdId = ctx.householdId) =>
            asUser(
                userId,
                () =>
                    undoAgentAction(deps, {
                        householdId,
                        userId,
                        actionId: action.id,
                        now: new Date(),
                    }),
                householdId,
            );
        expect((await attempt(bystander)).status).toBe("not_found");
        // Another household's owner cannot reach it: row level security hides it.
        const foreignOwner = (await sql`
            select user_id from public.household_members
            where household_id = ${ctx.otherHouseholdId}
        `) as { user_id: string }[];
        expect(
            (await attempt(foreignOwner[0]!.user_id, ctx.otherHouseholdId))
                .status,
        ).toBe("not_found");
        expect(await grocery.listLines(ctx.householdId)).toEqual([]);
        expect((await attempt(ctx.ownerId)).status).toBe("undone");
    });

    test("the 24 hour window: expired undo is refused and the purge keeps the entry", async () => {
        const grocery = liveGroceryStore();
        const milk = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
        );
        const deps = liveAgentActionDeps();
        const { action } = await withAgentAction(
            deps,
            actor(),
            { tool: "delete_grocery_line", summary: "Deleted Milk" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [milk.id], "deleted");
                await grocery.deleteLine(ctx.householdId, milk.id);
            },
        );
        const created = Date.parse(action.createdAt);
        const later = new Date(created + 25 * HOUR);
        expect(
            (
                await undoAgentAction(deps, {
                    householdId: ctx.householdId,
                    userId: ctx.ownerId,
                    actionId: action.id,
                    now: new Date(created + AGENT_UNDO_TTL_MS),
                })
            ).status,
        ).toBe("expired");
        expect(
            await purgeExpiredAgentSnapshots(
                deps,
                new Date(created + 23 * HOUR),
            ),
        ).toBe(0);
        expect(await purgeExpiredAgentSnapshots(deps, later)).toBe(1);
        const [stored] = await liveAgentActionsStore().list(ctx.householdId, 5);
        expect(stored).toMatchObject({
            id: action.id,
            summary: "Deleted Milk",
            snapshot: null,
        });
        expect(
            (
                await undoAgentAction(deps, {
                    householdId: ctx.householdId,
                    userId: ctx.ownerId,
                    actionId: action.id,
                    now: later,
                })
            ).status,
        ).toBe("expired");
    });

    test("the switch: Off refuses before any write, and it lives in household_preferences", async () => {
        const settings = liveSettingsStore();
        const grocery = liveGroceryStore();
        const milk = await grocery.insertLine(
            sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
        );
        expect(await settings.getAgentDestructiveAllowed(ctx.householdId)).toBe(
            true,
        );
        await settings.setAgentDestructiveAllowed(ctx.householdId, false);
        const [prefs] = (await getCtx().sql`
            select household_preferences -> 'agents.destructive_allowed' as v
            from public.households where id = ${ctx.householdId}
        `) as { v: unknown }[];
        expect(prefs!.v).toBe(false);

        let ran = false;
        await expect(
            withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_grocery_line", summary: "Deleted Milk" },
                async (rec) => {
                    ran = true;
                    await rec.captureByIds(
                        "grocery_lines",
                        [milk.id],
                        "deleted",
                    );
                    await grocery.deleteLine(ctx.householdId, milk.id);
                },
            ),
        ).rejects.toBeInstanceOf(AgentActionsDisabledError);
        expect(ran).toBe(false);
        expect(await grocery.listLines(ctx.householdId)).toHaveLength(1);
        expect(await liveAgentActionsStore().list(ctx.householdId, 5)).toEqual(
            [],
        );

        await settings.setAgentDestructiveAllowed(ctx.householdId, true);
        const { result } = await withAgentAction(
            liveAgentActionDeps(),
            actor(),
            { tool: "delete_grocery_line", summary: "Deleted Milk" },
            async (rec) => {
                await rec.captureByIds("grocery_lines", [milk.id], "deleted");
                await grocery.deleteLine(ctx.householdId, milk.id);
                return "done";
            },
        );
        expect(result).toBe("done");
    });

    test("changing the household config keeps the switch Off", async () => {
        const settings = liveSettingsStore();
        await settings.setAgentDestructiveAllowed(ctx.householdId, false);
        const config = await getHouseholdConfig(ctx.householdId);
        await updateHouseholdConfig(ctx.householdId, {
            ...config,
            name: "Renamed",
        });
        expect(await settings.getAgentDestructiveAllowed(ctx.householdId)).toBe(
            false,
        );
    });

    const undoNow = (actionId: string) =>
        undoAgentAction(liveAgentActionDeps(), {
            householdId: ctx.householdId,
            userId: ctx.ownerId,
            actionId,
            now: new Date(),
        });

    async function storedAction(actionId: string) {
        const all = await liveAgentActionsStore().list(ctx.householdId, 20);
        return all.find((entry) => entry.id === actionId)!;
    }

    describe("undo order", () => {
        test("deleted rows go back parents first, whatever order the tool recorded them in", async () => {
            const settings = liveSettingsStore();
            const costco = await createGroceryStore(
                settings,
                ctx.householdId,
                "Costco",
            );
            const sections = await settings.listSections(costco.id);
            expect(sections.length).toBeGreaterThan(0);
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_grocery_store", summary: "Deleted Costco" },
                async (rec) => {
                    // The parent is recorded before its children.
                    await rec.captureByIds(
                        "grocery_stores",
                        [costco.id],
                        "deleted",
                    );
                    await rec.captureByIds(
                        "grocery_sections",
                        sections.map((section) => section.id),
                        "deleted",
                    );
                    await run(
                        (tx) =>
                            tx`delete from public.grocery_stores where id = ${costco.id}`,
                    );
                },
            );
            expect(await undoNow(action.id)).toEqual({
                status: "undone",
                message: "Undone: Deleted Costco",
            });
            expect(
                (await settings.listStores(ctx.householdId)).map((s) => s.name),
            ).toContain("Costco");
            expect(
                (await settings.listSections(costco.id)).map((s) => s.id),
            ).toEqual(sections.map((section) => section.id));
        });

        test("inserted rows are removed children first, even when the tool recorded the children first", async () => {
            const settings = liveSettingsStore();
            let storeId = "";
            let sectionIds: string[] = [];
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "add_grocery_store", summary: "Added Lidl" },
                async (rec) => {
                    const made = await createGroceryStore(
                        settings,
                        ctx.householdId,
                        "Lidl",
                    );
                    storeId = made.id;
                    sectionIds = (await settings.listSections(made.id)).map(
                        (section) => section.id,
                    );
                    // The children are recorded before their parent.
                    rec.inserted("grocery_sections", sectionIds);
                    rec.inserted("grocery_stores", [made.id]);
                },
            );
            expect(sectionIds.length).toBeGreaterThan(0);
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(
                (await settings.listStores(ctx.householdId)).map((s) => s.id),
            ).not.toContain(storeId);
            expect(await settings.listSections(storeId)).toEqual([]);
        });
    });

    describe("an insert is not undone over what was added to it since", () => {
        async function addSection(storeId: string, sectionId: string) {
            return withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "set_store_sections", summary: "Added Cheese shelf" },
                async (rec) => {
                    await run(
                        (tx) => tx`
                            insert into public.grocery_sections
                                (id, household_id, store_id, name, sort_order)
                            values (${sectionId}, ${ctx.householdId}, ${storeId}, ${"Cheese shelf"}, ${99})
                        `,
                    );
                    rec.inserted("grocery_sections", [sectionId]);
                },
            );
        }

        test("refuses while a line a person added points at the section, then goes through once it is gone", async () => {
            const settings = liveSettingsStore();
            const grocery = liveGroceryStore();
            const costco = await createGroceryStore(
                settings,
                ctx.householdId,
                "Costco",
            );
            const sectionId = crypto.randomUUID();
            const { action } = await addSection(costco.id, sectionId);
            const line = await grocery.insertLine(
                sampleGroceryLine(lineCtx(), {
                    displayName: "Milk",
                    storeId: costco.id,
                    sectionId,
                }),
            );

            const out = await undoNow(action.id);
            expect(out).toEqual({
                status: "conflict",
                message:
                    "The grocery section Cheese shelf is used by 1 grocery line now; change or remove it first, or keep the grocery section.",
            });
            expect(
                (await grocery.listLines(ctx.householdId)).map((l) => l.id),
            ).toEqual([line.id]);
            expect(
                (await settings.listSections(costco.id)).map((s) => s.id),
            ).toContain(sectionId);
            const stored = await storedAction(action.id);
            expect(stored.undoneAt).toBeNull();
            expect(stored.snapshot).not.toBeNull();

            await grocery.deleteLine(ctx.householdId, line.id);
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(
                (await settings.listSections(costco.id)).map((s) => s.id),
            ).not.toContain(sectionId);
        });

        test("a reference that only clears itself when the item goes (the put-away movement) does not block", async () => {
            const sql = getCtx().sql;
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Fridge",
            );
            let itemId = "";
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "put_away_grocery_lines", summary: "Stocked eggs" },
                async (rec) => {
                    const added = await addFridgeItemAdjust(
                        fridge,
                        stock,
                        foods,
                        {
                            householdId: ctx.householdId,
                            foodId: ctx.foodId,
                            amount: 6,
                            unit: "g",
                            locationId: location.id,
                        },
                    );
                    itemId = added.item!.id;
                    rec.inserted("fridge_items", [itemId]);
                },
            );
            // The ledger movement the action wrote points at the item.
            const [linked] = (await sql`
                select count(*)::int as n from public.stock_movements
                where fridge_item_id = ${itemId}
            `) as { n: number }[];
            expect(linked!.n).toBe(1);
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(await fridge.listItems(ctx.householdId)).toEqual([]);
            const food = await findFoodById(foods, ctx.householdId, ctx.foodId);
            expect(
                ledgerMatchesStock(
                    [],
                    await stock.listMovements(ctx.householdId),
                    food,
                ),
            ).toBe(true);
        });
    });

    describe("an update is not undone over a change made since", () => {
        async function tenGramsDiscarded() {
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Fridge",
            );
            const added = await addFridgeItemAdjust(fridge, stock, foods, {
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                amount: 10,
                unit: "g",
                locationId: location.id,
            });
            const itemId = added.item!.id;
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "discard_fridge_item", summary: "Discarded 4 g" },
                async (rec) => {
                    await rec.captureByIds("fridge_items", [itemId], "updated");
                    await discardFridgeItem(fridge, stock, foods, {
                        householdId: ctx.householdId,
                        itemId,
                        amount: 4,
                    });
                },
            );
            return { fridge, stock, foods, itemId, action };
        }

        test("refuses when a person changed the row afterwards, and changes nothing", async () => {
            const { fridge, stock, foods, itemId, action } =
                await tenGramsDiscarded();
            // A person uses 2 g more: 6 -> 4.
            await discardFridgeItem(fridge, stock, foods, {
                householdId: ctx.householdId,
                itemId,
                amount: 2,
            });
            const movementsBefore = await stock.listMovements(ctx.householdId);

            const out = await undoNow(action.id);
            expect(out.status).toBe("conflict");
            expect(out.message).toContain("was changed since");
            const items = await fridge.listItems(ctx.householdId);
            expect(items[0]!.quantity).toEqual({ amount: 4, unit: "g" });
            expect(await stock.listMovements(ctx.householdId)).toEqual(
                movementsBefore,
            );
            expect((await storedAction(action.id)).undoneAt).toBeNull();
        });

        test("puts the earlier amount back when nothing changed since, with the ledger balanced", async () => {
            const { fridge, stock, foods, action } = await tenGramsDiscarded();
            expect((await undoNow(action.id)).status).toBe("undone");
            const items = await fridge.listItems(ctx.householdId);
            expect(items[0]!.quantity).toEqual({ amount: 10, unit: "g" });
            const food = await findFoodById(foods, ctx.householdId, ctx.foodId);
            expect(
                ledgerMatchesStock(
                    items,
                    await stock.listMovements(ctx.householdId),
                    food,
                ),
            ).toBe(true);
        });

        test("a household setting changed since is not overwritten, an untouched one goes back", async () => {
            const settings = liveSettingsStore();
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                {
                    tool: "delete_grocery_store",
                    summary: "Cleared the default",
                },
                async (rec) => {
                    await rec.captureByIds(
                        "households",
                        [ctx.householdId],
                        "updated",
                    );
                    await settings.setAgentDestructiveAllowed(
                        ctx.householdId,
                        false,
                    );
                },
            );
            expect(
                await settings.getAgentDestructiveAllowed(ctx.householdId),
            ).toBe(false);
            // Someone sets the same switch to something else before the undo.
            await run(
                (tx) =>
                    tx`update public.households set household_preferences = household_preferences || jsonb_build_object('agents.destructive_allowed', 'maybe'::text) where id = ${ctx.householdId}`,
            );
            const refused = await undoNow(action.id);
            expect(refused.status).toBe("conflict");
            expect(refused.message).toContain("was changed since");
            expect(
                (
                    (await getCtx().sql`
                        select household_preferences ->> 'agents.destructive_allowed' as v
                        from public.households where id = ${ctx.householdId}
                    `) as { v: string }[]
                )[0]!.v,
            ).toBe("maybe");

            await run(
                (tx) =>
                    tx`update public.households set household_preferences = household_preferences || jsonb_build_object('agents.destructive_allowed', false) where id = ${ctx.householdId}`,
            );
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(
                await settings.getAgentDestructiveAllowed(ctx.householdId),
            ).toBe(true);
        });
    });

    describe("the stock ledger after an undo", () => {
        test("a location deleted with its items comes back without an extra movement", async () => {
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Garage",
            );
            const added = await addFridgeItemAdjust(fridge, stock, foods, {
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                amount: 300,
                unit: "g",
                locationId: location.id,
            });
            const food = await findFoodById(foods, ctx.householdId, ctx.foodId);
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_fridge_location", summary: "Deleted Garage" },
                async (rec) => {
                    await rec.captureByIds(
                        "fridge_locations",
                        [location.id],
                        "deleted",
                    );
                    await rec.captureByIds(
                        "fridge_items",
                        [added.item!.id],
                        "deleted",
                    );
                    // The items go with their location: no movement is written.
                    await deleteLocation(fridge, ctx.householdId, location.id);
                },
            );
            expect(await fridge.listItems(ctx.householdId)).toEqual([]);
            const movementsBefore = await stock.listMovements(ctx.householdId);
            expect(movementsBefore).toHaveLength(1);

            expect((await undoNow(action.id)).status).toBe("undone");
            const items = await fridge.listItems(ctx.householdId);
            expect(items).toHaveLength(1);
            const movements = await stock.listMovements(ctx.householdId);
            expect(movements).toHaveLength(1);
            expect(ledgerMatchesStock(items, movements, food)).toBe(true);
        });

        test("a fridge item deleted with its adjust gets a matching adjust back", async () => {
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Fridge",
            );
            const added = await addFridgeItemAdjust(fridge, stock, foods, {
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                amount: 300,
                unit: "g",
                locationId: location.id,
            });
            const itemId = added.item!.id;
            const food = await findFoodById(foods, ctx.householdId, ctx.foodId);
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_fridge_item", summary: "Deleted the eggs" },
                async (rec) => {
                    await rec.captureByIds("fridge_items", [itemId], "deleted");
                    await deleteFridgeItemAdjust(fridge, stock, foods, {
                        householdId: ctx.householdId,
                        itemId,
                    });
                },
            );
            expect((await undoNow(action.id)).status).toBe("undone");
            const items = await fridge.listItems(ctx.householdId);
            const movements = await stock.listMovements(ctx.householdId);
            expect(ledgerMatchesStock(items, movements, food)).toBe(true);
            expect(movements).toHaveLength(3);
            expect(
                movements.find(
                    (m) => m.reason === "adjust" && m.actorUserId !== null,
                ),
            ).toMatchObject({ delta: 300, fridgeItemId: itemId });
        });
    });

    describe("rows that no longer fit the table as it was", () => {
        async function deleteAldi() {
            const settings = liveSettingsStore();
            const aldi = await createGroceryStore(
                settings,
                ctx.householdId,
                "Aldi",
            );
            const sections = (await settings.listSections(aldi.id)).map(
                (section) => section.id,
            );
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_grocery_store", summary: "Deleted Aldi" },
                async (rec) => {
                    await rec.captureByIds(
                        "grocery_stores",
                        [aldi.id],
                        "deleted",
                    );
                    await rec.captureByIds(
                        "grocery_sections",
                        sections,
                        "deleted",
                    );
                    await run(
                        (tx) =>
                            tx`delete from public.grocery_stores where id = ${aldi.id}`,
                    );
                },
            );
            return { settings, aldi, action };
        }

        test("a column added since takes its default instead of failing the undo", async () => {
            const { settings, aldi, action } = await deleteAldi();
            const sql = getCtx().sql;
            await sql.unsafe(
                "alter table public.grocery_stores add column pinned boolean not null default false",
            );
            try {
                expect(await undoNow(action.id)).toEqual({
                    status: "undone",
                    message: "Undone: Deleted Aldi",
                });
                const [restored] = (await sql`
                    select pinned from public.grocery_stores where id = ${aldi.id}
                `) as { pinned: boolean }[];
                expect(restored).toEqual({ pinned: false });
                expect(
                    (await settings.listStores(ctx.householdId)).map(
                        (s) => s.name,
                    ),
                ).toContain("Aldi");
            } finally {
                await sql.unsafe(
                    "alter table public.grocery_stores drop column pinned",
                );
            }
        });

        test("a constraint the row no longer meets is a conflict, not a crash", async () => {
            const { settings, action } = await deleteAldi();
            const sql = getCtx().sql;
            await sql.unsafe(
                "alter table public.grocery_stores add constraint no_aldi check (name <> 'Aldi') not valid",
            );
            try {
                const out = await undoNow(action.id);
                expect(out.status).toBe("conflict");
                expect(out.message).toBe(
                    "The grocery store Aldi can't be put back as it was: the database no longer accepts it.",
                );
                expect(
                    (await settings.listStores(ctx.householdId)).map(
                        (s) => s.name,
                    ),
                ).not.toContain("Aldi");
                expect((await storedAction(action.id)).undoneAt).toBeNull();
            } finally {
                await sql.unsafe(
                    "alter table public.grocery_stores drop constraint no_aldi",
                );
            }
        });
    });

    describe("tables keyed by more than an id", () => {
        test("a composite-key row is captured by its key and goes back to the same row", async () => {
            const sql = getCtx().sql;
            await sql`
                insert into public.food_aliases (household_id, alias, food_id)
                values (${ctx.householdId}, ${"ovos"}, ${ctx.foodId})
            `;
            const key = { household_id: ctx.householdId, alias: "ovos" };
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "merge_foods", summary: "Dropped an alias" },
                async (rec) => {
                    expect(
                        await rec.captureByKeys(
                            "food_aliases",
                            [key],
                            "deleted",
                        ),
                    ).toBe(1);
                    await run(
                        (tx) =>
                            tx`delete from public.food_aliases where household_id = ${ctx.householdId} and alias = ${"ovos"}`,
                    );
                },
            );
            expect(
                await sql`select 1 from public.food_aliases where alias = 'ovos'`,
            ).toHaveLength(0);
            expect((await undoNow(action.id)).status).toBe("undone");
            const back = (await sql`
                select household_id, alias, food_id from public.food_aliases
                where alias = 'ovos'
            `) as Record<string, string>[];
            expect(back).toEqual([
                {
                    household_id: ctx.householdId,
                    alias: "ovos",
                    food_id: ctx.foodId,
                },
            ]);
        });

        test("a composite-key row changed by an action is restored, and one inserted is removed", async () => {
            const sql = getCtx().sql;
            const otherFood = await seedFood(sql, ctx.householdId, {
                name: "Free range eggs",
            });
            await sql`
                insert into public.food_aliases (household_id, alias, food_id)
                values (${ctx.householdId}, ${"ovo"}, ${ctx.foodId})
            `;
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "upsert_food", summary: "Moved an alias" },
                async (rec) => {
                    await rec.captureByKeys(
                        "food_aliases",
                        [{ household_id: ctx.householdId, alias: "ovo" }],
                        "updated",
                    );
                    await run(
                        (tx) =>
                            tx`update public.food_aliases set food_id = ${otherFood} where alias = ${"ovo"}`,
                    );
                    await run(
                        (tx) =>
                            tx`insert into public.food_aliases (household_id, alias, food_id) values (${ctx.householdId}, ${"huevo"}, ${otherFood})`,
                    );
                    rec.insertedKeys("food_aliases", [
                        { household_id: ctx.householdId, alias: "huevo" },
                    ]);
                },
            );
            expect((await undoNow(action.id)).status).toBe("undone");
            const back = (await sql`
                select alias, food_id from public.food_aliases
                where household_id = ${ctx.householdId} order by alias
            `) as Record<string, string>[];
            expect(back).toEqual([{ alias: "ovo", food_id: ctx.foodId }]);
        });

        test("a table keyed by a single column that is not id (nutrition goals) round-trips", async () => {
            const sql = getCtx().sql;
            await sql`
                insert into public.nutrition_goals (user_id, daily_calories)
                values (${ctx.ownerId}, ${2100})
            `;
            const [before] = (await sql`
                select to_jsonb(t) as j from public.nutrition_goals t
                where user_id = ${ctx.ownerId}
            `) as { j: Record<string, unknown> }[];
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "set_nutrition_goals", summary: "Cleared goals" },
                async (rec) => {
                    await rec.captureByKeys(
                        "nutrition_goals",
                        [{ user_id: ctx.ownerId }],
                        "deleted",
                    );
                    await run(
                        (tx) =>
                            tx`delete from public.nutrition_goals where user_id = ${ctx.ownerId}`,
                    );
                },
            );
            expect((await undoNow(action.id)).status).toBe("undone");
            const [after] = (await sql`
                select to_jsonb(t) as j from public.nutrition_goals t
                where user_id = ${ctx.ownerId}
            `) as { j: Record<string, unknown> }[];
            expect(after!.j).toEqual(before!.j);
        });
    });

    describe("undo runs as whoever the agent acted as", () => {
        async function insertMeal(userId: string, description: string) {
            const id = crypto.randomUUID();
            await getCtx().sql`
                insert into public.meals (id, user_id, description)
                values (${id}, ${userId}, ${description})
            `;
            return id;
        }

        async function installProbe() {
            const sql = getCtx().sql;
            await sql.unsafe("create table public.undo_probe (sub text)");
            await sql.unsafe(
                "grant insert, select on public.undo_probe to foodable_app",
            );
            await sql.unsafe(`
                create function public.undo_probe_fn() returns trigger
                language plpgsql as $f$
                begin
                    insert into public.undo_probe
                    values (coalesce(current_setting('request.jwt.claim.sub', true), 'unset'));
                    return new;
                end $f$
            `);
            await sql.unsafe(`
                create trigger undo_probe_trg after insert on public.grocery_lines
                for each row execute function public.undo_probe_fn()
            `);
        }

        async function dropProbe() {
            const sql = getCtx().sql;
            await sql.unsafe(
                "drop trigger if exists undo_probe_trg on public.grocery_lines",
            );
            await sql.unsafe("drop function if exists public.undo_probe_fn()");
            await sql.unsafe("drop table if exists public.undo_probe");
        }

        async function deleteLineAs(memberId: string | null, lineId: string) {
            const guarded = () =>
                withAgentAction(
                    liveAgentActionDeps(),
                    {
                        householdId: ctx.householdId,
                        memberId,
                        connection: memberId ? "Claude" : "household token",
                    },
                    { tool: "delete_grocery_line", summary: "Deleted a line" },
                    async (rec) => {
                        await rec.captureByIds(
                            "grocery_lines",
                            [lineId],
                            "deleted",
                        );
                        await run(
                            (tx) =>
                                tx`delete from public.grocery_lines where id = ${lineId}`,
                        );
                    },
                );
            return memberId
                ? asUser(memberId, guarded, ctx.householdId)
                : withActor(
                      { kind: "household", householdId: ctx.householdId },
                      guarded,
                  );
        }

        test("an owner undoing a member's deleted meal brings it back", async () => {
            const mealId = await insertMeal(ctx.memberId, "Soup");
            const { action } = await asUser(
                ctx.memberId,
                () =>
                    withAgentAction(
                        liveAgentActionDeps(),
                        actor(),
                        { tool: "delete_meal", summary: "Deleted Soup" },
                        async (rec) => {
                            await rec.captureByIds(
                                "meals",
                                [mealId],
                                "deleted",
                            );
                            await run(
                                (tx) =>
                                    tx`delete from public.meals where id = ${mealId}`,
                            );
                        },
                    ),
                ctx.householdId,
            );
            const sql = getCtx().sql;
            expect(
                await sql`select 1 from public.meals where id = ${mealId}`,
            ).toHaveLength(0);

            expect((await undoNow(action.id)).status).toBe("undone");
            expect(
                (await sql`select user_id from public.meals where id = ${mealId}`) as {
                    user_id: string;
                }[],
            ).toEqual([{ user_id: ctx.memberId }]);
        });

        test("the put-back runs as the member the agent acted as, whoever clicks Undo, and as the household for a household token", async () => {
            const grocery = liveGroceryStore();
            const line = await grocery.insertLine(
                sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
            );
            const other = await grocery.insertLine(
                sampleGroceryLine(lineCtx(), { displayName: "Eggs" }),
            );
            await installProbe();
            try {
                const byMember = await deleteLineAs(ctx.memberId, line.id);
                const byToken = await deleteLineAs(null, other.id);
                const sql = getCtx().sql;
                await sql`delete from public.undo_probe`;

                // The owner clicks Undo both times.
                expect((await undoNow(byMember.action.id)).status).toBe(
                    "undone",
                );
                expect(
                    (
                        (await sql`select sub from public.undo_probe`) as {
                            sub: string;
                        }[]
                    ).map((row) => row.sub),
                ).toEqual([ctx.memberId]);

                await sql`delete from public.undo_probe`;
                expect((await undoNow(byToken.action.id)).status).toBe(
                    "undone",
                );
                expect(
                    (
                        (await sql`select sub from public.undo_probe`) as {
                            sub: string;
                        }[]
                    ).map((row) => row.sub),
                ).toEqual([""]);
            } finally {
                await dropProbe();
            }
        });

        test("a table that refuses the write for this account is a conflict with plain words, not a crash", async () => {
            const grocery = liveGroceryStore();
            const line = await grocery.insertLine(
                sampleGroceryLine(lineCtx(), { displayName: "Milk" }),
            );
            const { action } = await deleteLineAs(ctx.memberId, line.id);
            const sql = getCtx().sql;
            await sql.unsafe(`
                create policy undo_deny on public.grocery_lines
                as restrictive for insert to foodable_app with check (false)
            `);
            try {
                const out = await undoNow(action.id);
                expect(out.status).toBe("conflict");
                expect(out.message).toBe(
                    "The grocery line Milk can't be put back from here: the database doesn't let this account write it.",
                );
                expect(
                    await sql`select 1 from public.grocery_lines where id = ${line.id}`,
                ).toHaveLength(0);
                expect((await storedAction(action.id)).undoneAt).toBeNull();
            } finally {
                await sql.unsafe(
                    "drop policy undo_deny on public.grocery_lines",
                );
            }
            // Once the table takes it again, the same undo goes through.
            expect((await undoNow(action.id)).status).toBe("undone");
        });
    });

    describe("an insert is not undone over a reference a person set since", () => {
        test("a food whose usual store was set to the new store since blocks the undo, and keeps its usual store", async () => {
            const sql = getCtx().sql;
            const storeId = crypto.randomUUID();
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "create_store", summary: "Added Aldi" },
                async (rec) => {
                    await run(
                        (tx) =>
                            tx`insert into public.grocery_stores (id, household_id, name) values (${storeId}, ${ctx.householdId}, ${"Aldi"})`,
                    );
                    rec.inserted("grocery_stores", [storeId]);
                },
            );
            await sql`update public.foods set usual_store_id = ${storeId} where id = ${ctx.foodId}`;

            const out = await undoNow(action.id);
            expect(out).toEqual({
                status: "conflict",
                message:
                    "The grocery store Aldi is used by 1 food now; change or remove it first, or keep the grocery store.",
            });
            const [food] = (await sql`
                select usual_store_id from public.foods where id = ${ctx.foodId}
            `) as { usual_store_id: string | null }[];
            expect(food!.usual_store_id).toBe(storeId);
            expect(
                await sql`select 1 from public.grocery_stores where id = ${storeId}`,
            ).toHaveLength(1);

            await sql`update public.foods set usual_store_id = null where id = ${ctx.foodId}`;
            expect((await undoNow(action.id)).status).toBe("undone");
        });
    });

    describe("an update only restores the columns the action changed", () => {
        async function tenGramsDiscarded() {
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Fridge",
            );
            const added = await addFridgeItemAdjust(fridge, stock, foods, {
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                amount: 10,
                unit: "g",
                locationId: location.id,
            });
            const itemId = added.item!.id;
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "discard_fridge_item", summary: "Discarded 4 g" },
                async (rec) => {
                    await rec.captureByIds("fridge_items", [itemId], "updated");
                    await discardFridgeItem(fridge, stock, foods, {
                        householdId: ctx.householdId,
                        itemId,
                        amount: 4,
                    });
                },
            );
            return { fridge, stock, itemId, action, location };
        }

        test("a column added to the table since does not block the undo", async () => {
            const { fridge, action } = await tenGramsDiscarded();
            const sql = getCtx().sql;
            await sql.unsafe(
                "alter table public.fridge_items add column undo_note text not null default 'x'",
            );
            try {
                expect((await undoNow(action.id)).status).toBe("undone");
                const items = await fridge.listItems(ctx.householdId);
                expect(items[0]!.quantity).toEqual({ amount: 10, unit: "g" });
            } finally {
                await sql.unsafe(
                    "alter table public.fridge_items drop column undo_note",
                );
            }
        });

        test("an unrelated column a person edited since does not block it, and keeps their edit", async () => {
            const { fridge, itemId, action } = await tenGramsDiscarded();
            const sql = getCtx().sql;
            await sql`update public.fridge_items set display_name = ${"Party eggs"} where id = ${itemId}`;
            expect((await undoNow(action.id)).status).toBe("undone");
            const [row] = (await sql`
                select amount::float8 as amount, display_name from public.fridge_items where id = ${itemId}
            `) as { amount: number; display_name: string }[];
            expect(row).toEqual({ amount: 10, display_name: "Party eggs" });
            expect(await fridge.listItems(ctx.householdId)).toHaveLength(1);
        });

        test("the same column changed again since still refuses", async () => {
            const { itemId, action } = await tenGramsDiscarded();
            const sql = getCtx().sql;
            await sql`update public.fridge_items set amount = 2 where id = ${itemId}`;
            const out = await undoNow(action.id);
            expect(out.status).toBe("conflict");
            expect(out.message).toContain("was changed since");
            const [row] = (await sql`
                select amount::float8 as amount from public.fridge_items where id = ${itemId}
            `) as { amount: number }[];
            expect(row!.amount).toBe(2);
        });

        describe("a store deleted along with its household default", () => {
            async function deleteDefaultStore() {
                const sql = getCtx().sql;
                const settings = liveSettingsStore();
                const costco = await createGroceryStore(
                    settings,
                    ctx.householdId,
                    "Costco",
                );
                await sql`
                    update public.households
                    set household_preferences = coalesce(household_preferences, '{}'::jsonb)
                        || jsonb_build_object('grocery.default_store_id', ${costco.id}::text)
                    where id = ${ctx.householdId}
                `;
                const sections = await settings.listSections(costco.id);
                const { action } = await withAgentAction(
                    liveAgentActionDeps(),
                    actor(),
                    { tool: "delete_grocery_store", summary: "Deleted Costco" },
                    async (rec) => {
                        await rec.captureByIds(
                            "households",
                            [ctx.householdId],
                            "updated",
                        );
                        await rec.captureByIds(
                            "grocery_stores",
                            [costco.id],
                            "deleted",
                        );
                        await rec.captureByIds(
                            "grocery_sections",
                            sections.map((s) => s.id),
                            "deleted",
                        );
                        await run(
                            (tx) =>
                                tx`update public.households set household_preferences = household_preferences - 'grocery.default_store_id' where id = ${ctx.householdId}`,
                        );
                        await run(
                            (tx) =>
                                tx`delete from public.grocery_stores where id = ${costco.id}`,
                        );
                    },
                );
                return { costco, action };
            }

            async function preferences() {
                const [row] = (await getCtx().sql`
                    select household_preferences as prefs, location
                    from public.households where id = ${ctx.householdId}
                `) as {
                    prefs: Record<string, unknown>;
                    location: string | null;
                }[];
                return row!;
            }

            test("another column of the household renamed since does not block, and keeps the new value", async () => {
                const { costco, action } = await deleteDefaultStore();
                await getCtx()
                    .sql`update public.households set location = ${"Somewhere"} where id = ${ctx.householdId}`;
                expect((await undoNow(action.id)).status).toBe("undone");
                const after = await preferences();
                expect(after.prefs["grocery.default_store_id"]).toBe(costco.id);
                expect(after.location).toBe("Somewhere");
            });

            test("an unrelated preference set since survives the undo, only the changed key goes back", async () => {
                const { costco, action } = await deleteDefaultStore();
                await getCtx().sql`
                    update public.households
                    set household_preferences = household_preferences
                        || jsonb_build_object('grocery.restock_note', 'keep me'::text)
                    where id = ${ctx.householdId}
                `;
                expect((await undoNow(action.id)).status).toBe("undone");
                const after = await preferences();
                expect(after.prefs).toMatchObject({
                    "grocery.default_store_id": costco.id,
                    "grocery.restock_note": "keep me",
                });
            });

            test("the same preference key set to something else since still refuses", async () => {
                const { action } = await deleteDefaultStore();
                const elsewhere = crypto.randomUUID();
                await getCtx().sql`
                    update public.households
                    set household_preferences = household_preferences
                        || jsonb_build_object('grocery.default_store_id', ${elsewhere}::text)
                    where id = ${ctx.householdId}
                `;
                const out = await undoNow(action.id);
                expect(out.status).toBe("conflict");
                expect(out.message).toContain("was changed since");
                expect(
                    (await preferences()).prefs["grocery.default_store_id"],
                ).toBe(elsewhere);
            });
        });
    });

    describe("the stock ledger is corrected for this action only", () => {
        async function fridgeWithDrift() {
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Fridge",
            );
            const added = await addFridgeItemAdjust(fridge, stock, foods, {
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                amount: 10,
                unit: "g",
                locationId: location.id,
            });
            // Drift that has nothing to do with the action: an item with no
            // movement of its own.
            await getCtx().sql`
                insert into public.fridge_items (household_id, location_id, kind, display_name, amount, unit, food_id)
                values (${ctx.householdId}, ${location.id}, 'food', 'Old eggs', 7, 'g', ${ctx.foodId})
            `;
            return { fridge, stock, foods, location, itemId: added.item!.id };
        }

        async function deltas() {
            return (
                (await getCtx().sql`
                    select delta::float8 as d, reason
                    from public.stock_movements
                    where food_id = ${ctx.foodId}
                    order by created_at, id
                `) as { d: number; reason: string }[]
            ).map((row) => [row.d, row.reason]);
        }

        test("an undone discard writes back what the discard took, not the drift of the same food", async () => {
            const { fridge, stock, foods, itemId } = await fridgeWithDrift();
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "discard_fridge_item", summary: "Discarded 4 g" },
                async (rec) => {
                    await rec.captureByIds("fridge_items", [itemId], "updated");
                    await discardFridgeItem(fridge, stock, foods, {
                        householdId: ctx.householdId,
                        itemId,
                        amount: 4,
                    });
                },
            );
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(await deltas()).toEqual([
                [10, "adjust"],
                [-4, "discard"],
                [4, "adjust"],
            ]);
            const stored = await storedAction(action.id);
            expect(stored.snapshot!.ledger).toEqual([
                expect.objectContaining({ delta: -4, unit: "g" }),
            ]);
        });

        test("a movement another request commits during the write is not the action's, and undo leaves it", async () => {
            const { fridge, stock, foods, itemId } = await fridgeWithDrift();
            const sql = getCtx().sql;
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "discard_fridge_item", summary: "Discarded 4 g" },
                async (rec) => {
                    await rec.captureByIds("fridge_items", [itemId], "updated");
                    // A person, on another connection, adds 5 g of the same
                    // food and commits while the agent's write is running.
                    await sql`
                        insert into public.stock_movements
                            (household_id, food_id, delta, unit, reason)
                        values (${ctx.householdId}, ${ctx.foodId}, 5, 'g', 'adjust')
                    `;
                    await discardFridgeItem(fridge, stock, foods, {
                        householdId: ctx.householdId,
                        itemId,
                        amount: 4,
                    });
                },
            );
            const stored = await storedAction(action.id);
            expect(stored.snapshot!.ledger).toEqual([
                expect.objectContaining({ delta: -4, unit: "g" }),
            ]);
            expect((await undoNow(action.id)).status).toBe("undone");
            expect((await deltas()).at(-1)).toEqual([4, "adjust"]);
        });

        test("an item the action added goes away with exactly the movement it wrote", async () => {
            const { fridge, stock, foods } = await fridgeWithDrift();
            const shelf = await addLocation(fridge, ctx.householdId, "Shelf");
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "put_away_grocery_lines", summary: "Stocked 6 g" },
                async (rec) => {
                    const added = await addFridgeItemAdjust(
                        fridge,
                        stock,
                        foods,
                        {
                            householdId: ctx.householdId,
                            foodId: ctx.foodId,
                            amount: 6,
                            unit: "g",
                            locationId: shelf.id,
                        },
                    );
                    rec.inserted("fridge_items", [added.item!.id]);
                },
            );
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(await deltas()).toEqual([
                [10, "adjust"],
                [6, "adjust"],
                [-6, "adjust"],
            ]);
            expect(await fridge.listItems(ctx.householdId)).toHaveLength(2);
        });
    });

    describe("capturing what a delete takes with it", () => {
        test("a store's sections, lines and rules are captured, a food's usual store is recorded as updated, and one undo puts them all back", async () => {
            const sql = getCtx().sql;
            const grocery = liveGroceryStore();
            const line = await grocery.insertLine(
                sampleGroceryLine(lineCtx(), {
                    displayName: "Milk",
                    storeId: ctx.storeId,
                    sectionId: ctx.sectionId,
                }),
            );
            await sql`update public.foods set usual_store_id = ${ctx.storeId} where id = ${ctx.foodId}`;

            const reports: CascadeReport[] = [];
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_grocery_store", summary: "Deleted Main" },
                async (rec) => {
                    reports.push(
                        await rec.captureCascade("grocery_stores", [
                            { id: ctx.storeId },
                        ]),
                    );
                    await run(
                        (tx) =>
                            tx`delete from public.grocery_stores where id = ${ctx.storeId}`,
                    );
                },
            );
            expect(reports).toEqual([{ captured: 4, uncaptured: [] }]);
            const stored = await storedAction(action.id);
            expect(
                stored
                    .snapshot!.changes.map((c) => `${c.op}:${c.table}`)
                    .sort(),
            ).toEqual([
                "deleted:grocery_lines",
                "deleted:grocery_sections",
                "deleted:grocery_stores",
                "updated:foods",
            ]);
            const [gone] = (await sql`
                select usual_store_id from public.foods where id = ${ctx.foodId}
            `) as { usual_store_id: string | null }[];
            expect(gone!.usual_store_id).toBeNull();

            expect((await undoNow(action.id)).status).toBe("undone");
            const [back] = (await sql`
                select usual_store_id from public.foods where id = ${ctx.foodId}
            `) as { usual_store_id: string | null }[];
            expect(back!.usual_store_id).toBe(ctx.storeId);
            expect(
                await sql`select 1 from public.grocery_lines where id = ${line.id}`,
            ).toHaveLength(1);
            expect(
                await sql`select 1 from public.grocery_sections where id = ${ctx.sectionId}`,
            ).toHaveLength(1);
        });

        test("a location deleted with its items: the items, and the ledger links that cleared, come back with no new movement", async () => {
            const fridge = liveFridgeStore();
            const stock = liveStockStore();
            const foods = liveFoodsStore();
            const location = await addLocation(
                fridge,
                ctx.householdId,
                "Garage",
            );
            const added = await addFridgeItemAdjust(fridge, stock, foods, {
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                amount: 300,
                unit: "g",
                locationId: location.id,
            });
            const itemId = added.item!.id;
            const sql = getCtx().sql;
            const reports: CascadeReport[] = [];
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                { tool: "delete_fridge_location", summary: "Deleted Garage" },
                async (rec) => {
                    reports.push(
                        await rec.captureCascade("fridge_locations", [
                            { id: location.id },
                        ]),
                    );
                    await deleteLocation(fridge, ctx.householdId, location.id);
                },
            );
            expect(reports).toEqual([{ captured: 3, uncaptured: [] }]);
            expect(
                (await stock.listMovements(ctx.householdId))[0]!.fridgeItemId,
            ).toBeNull();
            const stored = await storedAction(action.id);
            expect(stored.snapshot!.ledger).toBeUndefined();

            expect((await undoNow(action.id)).status).toBe("undone");
            const items = await fridge.listItems(ctx.householdId);
            const movements = await stock.listMovements(ctx.householdId);
            expect(items.map((item) => item.id)).toEqual([itemId]);
            expect(movements).toHaveLength(1);
            expect(movements[0]!.fridgeItemId).toBe(itemId);
            expect(
                ledgerMatchesStock(
                    items,
                    movements,
                    await findFoodById(foods, ctx.householdId, ctx.foodId),
                ),
            ).toBe(true);
            expect(
                await sql`select 1 from public.fridge_locations where id = ${location.id}`,
            ).toHaveLength(1);
        });

        test("a recipe's favourites are not undoable, and the cascade says so", async () => {
            const sql = getCtx().sql;
            const recipeId = crypto.randomUUID();
            await sql`
                insert into public.recipes (id, household_id, creator_id, name, yield_portions)
                values (${recipeId}, ${ctx.householdId}, ${ctx.ownerId}, 'Soup', 2)
            `;
            await sql`
                insert into public.recipe_favourites (household_id, user_id, recipe_id)
                values (${ctx.householdId}, ${ctx.ownerId}, ${recipeId}), (${ctx.householdId}, ${ctx.memberId}, ${recipeId})
            `;
            const reports: CascadeReport[] = [];
            const { action } = await withAgentAction(
                liveAgentActionDeps(),
                actor(),
                {
                    tool: "delete_recipe",
                    summary: "Deleted Soup (favourites not restored)",
                },
                async (rec) => {
                    reports.push(
                        await rec.captureCascade("recipes", [{ id: recipeId }]),
                    );
                    await run(
                        (tx) =>
                            tx`delete from public.recipes where id = ${recipeId}`,
                    );
                },
            );
            expect(reports[0]!.uncaptured).toEqual(["recipe_favourites"]);
            const stored = await storedAction(action.id);
            expect(
                stored.snapshot!.changes.some(
                    (c) => (c.table as string) === "recipe_favourites",
                ),
            ).toBe(false);
            expect((await undoNow(action.id)).status).toBe("undone");
            expect(
                await sql`select 1 from public.recipes where id = ${recipeId}`,
            ).toHaveLength(1);
            expect(
                await sql`select 1 from public.recipe_favourites where recipe_id = ${recipeId}`,
            ).toHaveLength(0);
        });
    });

    describe("undo locks the rows it checks", () => {
        async function lockedByOther(table: string, id: string) {
            return getCtx()
                .sql.unsafe(
                    `select id from public.${table} where id = '${id}' for update nowait`,
                )
                .then(
                    () => false,
                    (err: { errno?: string }) => err.errno === "55P03",
                );
        }

        test("a keyed read for undo holds the row, a plain read does not", async () => {
            const store = liveAgentActionsStore();
            await store.atomically(async (tx) => {
                await tx.readRows("grocery_sections", [{ id: ctx.sectionId }]);
                expect(
                    await lockedByOther("grocery_sections", ctx.sectionId),
                ).toBe(false);
                await tx.readRows("grocery_sections", [{ id: ctx.sectionId }], {
                    lock: true,
                });
                expect(
                    await lockedByOther("grocery_sections", ctx.sectionId),
                ).toBe(true);
            });
        });

        test("the check for rows that point at a row holds it too", async () => {
            const store = liveAgentActionsStore();
            await store.atomically(async (tx) => {
                await tx.referencingRows("grocery_stores", { id: ctx.storeId });
                expect(await lockedByOther("grocery_stores", ctx.storeId)).toBe(
                    true,
                );
            });
        });
    });
});
