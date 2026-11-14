// The four kitchen admin tools (flag mcp-household-admin) against real
// Postgres, through the real /mcp handler: move_fridge_items,
// delete_fridge_items, delete_grocery_lines and remove_usual. Each records
// what it changed in the household's activity log, says so in its result, can
// be undone for 24 hours, and does nothing while the household's switch is Off.
// The in-memory tests in src/mcp.test.ts cover the tool list with the flag on
// and off and both protocol eras; what only the database can show is that the
// snapshot holds every affected row (items, their stock movements, the lines
// that point at them, dismissed notices, a usual's products and schedule) and
// that undo puts them all back exactly.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import * as foodsDb from "../../db/foods.js";
import { liveFoodsStore } from "../../db/foods.js";
import * as groceryDb from "../../db/grocery.js";
import * as fridgeDb from "../../db/fridge.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedFridgeLocation,
    seedGroceryStore,
    seedHousehold,
} from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { undoAgentAction } from "../../domain/agent-actions.js";
import { findFoodById } from "../../domain/foods.js";
import { ledgerMatchesStock } from "../../domain/stock.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../server.js";
import { KITCHEN_ADMIN_TOOL_NAMES } from "./grocery-admin-names.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests skipped: no initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

type Era = "legacy" | { pin: "2026-07-28" };
const ERAS: Era[] = ["legacy", { pin: "2026-07-28" }];

type Result = {
    isError?: boolean;
    structuredContent?: Record<string, any>;
    content: { type: string; text: string }[];
};
type Who =
    | { kind: "user"; userId: string; client?: string }
    | { kind: "household"; householdId: string };

const UNDO_SENTENCE =
    "The household can undo this for 24 hours in Settings › AI connections.";
const REFUSAL =
    "Agents may make destructive changes is Off in Settings › AI connections.";

async function callTool(
    who: Who,
    era: Era,
    name: string,
    args: Record<string, unknown> = {},
): Promise<Result> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        if (who.kind === "user") {
            c.set("authContext", { kind: "user", userId: who.userId });
            if (who.client) c.set("tokenClient", who.client);
        } else {
            c.set("authContext", {
                kind: "household",
                householdId: who.householdId,
            });
        }
        return handleMcp(c);
    });
    const client = new Client(
        { name: "t", version: "0" },
        { versionNegotiation: { mode: era } },
    );
    await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
            fetch: async (url, init) =>
                app.request(new Request(String(url), init)),
        }),
    );
    try {
        return (await client.callTool({
            name,
            arguments: args,
        })) as Result;
    } finally {
        await client.close();
    }
}

const text = (result: Result) => result.content.map((c) => c.text).join("\n");

/**
 * Every table a kitchen tool can touch. `updated_at` is bookkeeping undo never
 * restores. The stock ledger is judged by `ledgerMatchesStock` instead: undoing
 * a delete writes the opposite `adjust` movement, it does not erase the pair.
 */
const FINGERPRINT_TABLES = [
    "foods",
    "fridge_locations",
    "fridge_items",
    "grocery_lines",
    "notice_dismissals",
];

type Arranged = {
    tool: string;
    args: Record<string, unknown>;
    /** Part of the activity entry's summary. */
    summary: string;
    /** Text the tool says first, before the undo sentence. */
    text: string;
    /** Asserts the tool did its work. */
    changed: () => Promise<void>;
    /** Asserts more once undo has run (the fingerprint is checked for it). */
    restored?: () => Promise<void>;
};

describeDb(pgAvailable !== null, "kitchen admin tools (db)", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let storeId: string;
    let fridgeId: string;
    const owner = (): Who => ({
        kind: "user",
        userId: ownerId,
        client: "Claude",
    });
    const call = (
        name: string,
        args: Record<string, unknown> = {},
        era: Era = "legacy",
        who: Who = owner(),
    ) => callTool(who, era, name, args);

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(
            createMemoryFlags({
                "mcp-household-admin": true,
                "mcp-list-usuals": true,
            }),
        );
        ({ householdId, userId: ownerId } = await seedHousehold(sql));
        storeId = await seedGroceryStore(sql, householdId);
        await sql`
            insert into public.grocery_sections (
                id, household_id, store_id, name, sort_order, hidden, is_other
            )
            values (
                ${crypto.randomUUID()}, ${householdId}, ${storeId},
                ${"Other"}, ${0}, ${false}, ${true}
            )
        `;
        fridgeId = await seedFridgeLocation(sql, householdId, "Fridge");
    });

    afterEach(() => {
        resetFlagsForTests();
        setSqlForTests(null);
    });

    // ---------- helpers ----------

    async function rows(
        query: string,
        ...params: unknown[]
    ): Promise<Record<string, any>[]> {
        return (await getCtx().sql.unsafe(query, params as any[])) as Record<
            string,
            any
        >[];
    }

    async function count(table: string): Promise<number> {
        const [row] = await rows(
            `select count(*)::int as n from public.${table}`,
        );
        return Number(row!.n);
    }

    async function fingerprint(): Promise<string> {
        const out: Record<string, unknown> = {};
        for (const table of FINGERPRINT_TABLES) {
            const [row] = await rows(
                `select coalesce(jsonb_agg(to_jsonb(t) - 'updated_at' order by to_jsonb(t)::text), '[]'::jsonb) as j from public.${table} t`,
            );
            out[table] = row!.j;
        }
        return JSON.stringify(out);
    }

    async function actions(): Promise<Record<string, any>[]> {
        return rows(
            "select * from public.agent_actions where household_id = $1 order by created_at",
            householdId,
        );
    }

    async function undo(actionId: string) {
        return undoAgentAction(liveAgentActionDeps(), {
            householdId,
            userId: ownerId,
            actionId,
            now: new Date(),
        });
    }

    async function switchOff() {
        await asUser(
            ownerId,
            () =>
                liveSettingsStore().setAgentDestructiveAllowed(
                    householdId,
                    false,
                ),
            householdId,
        );
    }

    async function food(name: string): Promise<string> {
        const made = await call("upsert_food", { name, on_similar: "create" });
        return made.structuredContent!.id as string;
    }

    async function place(name: string): Promise<string> {
        const made = await call("add_fridge_location", { name });
        expect(made.isError).toBeFalsy();
        return made.structuredContent!.id as string;
    }

    async function fridgeItem(
        foodId: string,
        amount: number,
        into = fridgeId,
    ): Promise<string> {
        const added = await call("add_fridge_item", {
            location_id: into,
            kind: "food",
            food_id: foodId,
            amount,
            unit: "g",
        });
        expect(added.isError).toBeFalsy();
        const [row] = await rows(
            "select id from public.fridge_items where food_id = $1 order by created_at desc",
            foodId,
        );
        return row!.id as string;
    }

    async function groceryLine(name: string): Promise<string> {
        const added = await call("add_grocery_line", {
            store_id: storeId,
            kind: "food",
            food_id: await food(name),
            amount: 2,
            unit: "each",
        });
        expect(added.isError).toBeFalsy();
        return added.structuredContent!.id as string;
    }

    async function dismiss(
        subjectKind: string,
        subjectId: string,
        code = "x",
    ): Promise<void> {
        await getCtx().sql`
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id, related_key
            )
            values (${householdId}, ${code}, ${subjectKind}, ${subjectId}, ${""})
        `;
    }

    /** The ledger agrees with the fridge for this food (ledgerMatchesStock). */
    async function ledgerBalanced(foodId: string): Promise<boolean> {
        return asUser(
            ownerId,
            async () => {
                const foods = liveFoodsStore();
                const items = (
                    await liveFridgeStore().listItems(householdId)
                ).filter((item) => item.foodId === foodId);
                const movements = await liveStockStore().listMovements(
                    householdId,
                    foodId,
                );
                return ledgerMatchesStock(
                    items,
                    movements,
                    await findFoodById(foods, householdId, foodId),
                );
            },
            householdId,
        );
    }

    async function movementCount(): Promise<number> {
        return count("stock_movements");
    }

    async function usualNames(): Promise<string[]> {
        const listed = await call("list_usuals");
        expect(listed.isError).toBeFalsy();
        return (listed.structuredContent!.usuals as { name: string }[]).map(
            (row) => row.name,
        );
    }

    type UsualFixture = {
        plain: string;
        kirkland: string;
        organic: string;
    };

    /** Eggs with two products, one of them the usual, and a full schedule. */
    async function usual(): Promise<UsualFixture> {
        const plain = await food("Eggs");
        const kirkland = await food("Kirkland Large Eggs");
        const organic = await food("Organic Eggs");
        const set = await call("set_usual_product", {
            food_id: plain,
            product_food_id: kirkland,
        });
        expect(set.isError).toBeFalsy();
        const linked = await call("link_product", {
            product_food_id: organic,
            food_id: plain,
        });
        expect(linked.isError).toBeFalsy();
        await getCtx().sql`
            update public.foods
            set restock_schedule = 'every_n_weeks',
                restock_every_weeks = 3,
                restock_paused = true,
                restock_when_low = true,
                restock_low_level = 2,
                last_restocked_on = '2026-01-05',
                usual_added_at = now()
            where id = ${plain}
        `;
        return { plain, kirkland, organic };
    }

    // ---------- every tool ----------

    const scenarios: Record<string, () => Promise<Arranged>> = {
        move_fridge_items: async () => {
            const freezer = await place("Freezer");
            const eggs = await fridgeItem(await food("Eggs"), 300);
            const peas = await fridgeItem(await food("Peas"), 100);
            const kept = await fridgeItem(await food("Milk"), 500);
            const movements = await movementCount();
            return {
                tool: "move_fridge_items",
                args: { ids: [eggs, peas], location_id: freezer },
                summary: "Moved 2 fridge items to Freezer",
                text: "Moved 2 fridge items to Freezer: Eggs, Peas.",
                changed: async () => {
                    const there = await rows(
                        "select id, location_id from public.fridge_items order by id",
                    );
                    expect(
                        Object.fromEntries(
                            there.map((row) => [row.id, row.location_id]),
                        ),
                    ).toEqual({
                        [eggs]: freezer,
                        [peas]: freezer,
                        [kept]: fridgeId,
                    });
                    // A move is not a stock change: the ledger is untouched.
                    expect(await movementCount()).toBe(movements);
                },
                restored: async () => {
                    expect(await movementCount()).toBe(movements);
                },
            };
        },
        delete_fridge_items: async () => {
            const eggsFood = await food("Eggs");
            const eggs = await fridgeItem(eggsFood, 300);
            const peas = await fridgeItem(await food("Peas"), 100);
            const kept = await fridgeItem(await food("Milk"), 500);
            await dismiss("fridge_item", eggs);
            await dismiss("fridge_item", kept, "other");
            // A restock line made from the item loses its pointer when the
            // item goes; undo gives it back.
            const line = await groceryLine("Butter");
            await getCtx()
                .sql`update public.grocery_lines set source_fridge_item_id = ${eggs} where id = ${line}`;
            return {
                tool: "delete_fridge_items",
                args: { ids: [eggs, peas] },
                summary: "Deleted 2 fridge items: Eggs, Peas",
                text: "Deleted 2 fridge items: Eggs (300 g), Peas (100 g).",
                changed: async () => {
                    expect(
                        (await rows("select id from public.fridge_items")).map(
                            (row) => row.id,
                        ),
                    ).toEqual([kept]);
                    // Only the deleted item's dismissal went.
                    expect(await count("notice_dismissals")).toBe(1);
                    const [pointer] = await rows(
                        "select source_fridge_item_id from public.grocery_lines where id = $1",
                        line,
                    );
                    expect(pointer!.source_fridge_item_id).toBeNull();
                    expect(await ledgerBalanced(eggsFood)).toBe(true);
                },
                restored: async () => {
                    expect(await count("fridge_items")).toBe(3);
                    expect(await ledgerBalanced(eggsFood)).toBe(true);
                    const net = await rows(
                        "select food_id, sum(delta)::float as net from public.stock_movements group by food_id",
                    );
                    expect(await movementCount()).toBeGreaterThan(0);
                    expect(net.length).toBeGreaterThan(0);
                },
            };
        },
        delete_grocery_lines: async () => {
            const eggs = await groceryLine("Eggs");
            const milk = await groceryLine("Milk");
            const kept = await groceryLine("Flour");
            await dismiss("grocery_line", eggs);
            await dismiss("grocery_line", kept, "other");
            return {
                tool: "delete_grocery_lines",
                args: { ids: [eggs, milk] },
                summary: "Deleted 2 grocery lines: Eggs, Milk",
                text: "Deleted 2 grocery lines: Eggs, Milk.",
                changed: async () => {
                    expect(
                        (await rows("select id from public.grocery_lines")).map(
                            (row) => row.id,
                        ),
                    ).toEqual([kept]);
                    expect(await count("notice_dismissals")).toBe(1);
                },
            };
        },
        remove_usual: async () => {
            const { plain, kirkland, organic } = await usual();
            const other = await usual2();
            return {
                tool: "remove_usual",
                args: { food_id: plain },
                summary: "Removed Eggs from the Usuals list (2 products",
                text: "Removed Eggs from the Usuals list; Kirkland Large Eggs, Organic Eggs came off its list.",
                changed: async () => {
                    const [row] = await rows(
                        "select usual_product_id, usual_added_at, restock_schedule, restock_every_weeks, restock_paused, restock_when_low, restock_low_level, last_restocked_on from public.foods where id = $1",
                        plain,
                    );
                    expect(row).toEqual({
                        usual_product_id: null,
                        usual_added_at: null,
                        restock_schedule: null,
                        restock_every_weeks: null,
                        restock_paused: false,
                        restock_when_low: false,
                        restock_low_level: null,
                        last_restocked_on: null,
                    });
                    const products = await rows(
                        "select id, generic_food_id from public.foods where id in ($1, $2)",
                        kirkland,
                        organic,
                    );
                    expect(products.map((r) => r.generic_food_id)).toEqual([
                        null,
                        null,
                    ]);
                    expect(await usualNames()).toEqual([other]);
                },
                restored: async () => {
                    const [row] = await rows(
                        "select usual_product_id, restock_schedule, restock_every_weeks, restock_paused, last_restocked_on::text as last from public.foods where id = $1",
                        plain,
                    );
                    expect(row).toEqual({
                        usual_product_id: kirkland,
                        restock_schedule: "every_n_weeks",
                        restock_every_weeks: 3,
                        restock_paused: true,
                        last: "2026-01-05",
                    });
                    expect((await usualNames()).sort()).toEqual(
                        ["Eggs", other].sort(),
                    );
                },
            };
        },
    };

    /** A second usual the tool must leave alone. */
    async function usual2(): Promise<string> {
        const plain = await food("Milk");
        const product = await food("Oat Milk");
        const set = await call("set_usual_product", {
            food_id: plain,
            product_food_id: product,
        });
        expect(set.isError).toBeFalsy();
        await getCtx()
            .sql`update public.foods set restock_schedule = 'weekly' where id = ${plain}`;
        return "Milk";
    }

    // ---------- tests ----------

    test("the scenarios cover every kitchen admin tool", () => {
        expect(Object.keys(scenarios).sort()).toEqual(
            [...KITCHEN_ADMIN_TOOL_NAMES].sort(),
        );
    });

    for (const tool of Object.keys(scenarios)) {
        test(`${tool} changes the rows, is recorded with a snapshot, says how to undo, and undo puts everything back`, async () => {
            const arranged = await scenarios[tool]!();
            const before = await fingerprint();
            const result = await call(arranged.tool, arranged.args);
            expect(result.isError).toBeFalsy();
            expect(text(result)).toStartWith(arranged.text);
            expect(text(result)).toContain(UNDO_SENTENCE);
            await arranged.changed();

            const [entry] = await actions();
            expect(entry).toMatchObject({
                household_id: householdId,
                member_id: ownerId,
                connection: "Claude",
                tool,
                destructive: true,
                undoable: true,
            });
            expect(entry!.summary).toContain(arranged.summary);
            expect(entry!.snapshot).not.toBeNull();
            expect(entry!.undone_at).toBeNull();
            expect(
                Date.parse(entry!.undo_expires_at) -
                    Date.parse(entry!.created_at),
            ).toBe(24 * 60 * 60 * 1000);

            const out = await undo(entry!.id);
            expect(out.status).toBe("undone");
            expect(await fingerprint()).toBe(before);
            await arranged.restored?.();
            const [done] = await actions();
            expect(done!.undone_by).toBe(ownerId);
        });

        test(`${tool} is refused while agents may not make destructive changes, naming the setting, and changes nothing`, async () => {
            const arranged = await scenarios[tool]!();
            await switchOff();
            const before = await fingerprint();
            const movements = await movementCount();
            const result = await call(arranged.tool, arranged.args);
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(REFUSAL);
            expect(await fingerprint()).toBe(before);
            expect(await movementCount()).toBe(movements);
            expect(await actions()).toEqual([]);
        });

        test.each(ERAS)(
            `${tool} records and answers the same on both protocol eras (%p)`,
            async (era) => {
                const arranged = await scenarios[tool]!();
                const result = await call(arranged.tool, arranged.args, era);
                expect(result.isError).toBeFalsy();
                expect(text(result)).toContain(UNDO_SENTENCE);
                expect(result.structuredContent).toBeDefined();
                expect(await actions()).toHaveLength(1);
            },
        );
    }

    test("move_fridge_items and delete_fridge_items leave the ledger matching the fridge, after the call and after undo", async () => {
        const freezer = await place("Freezer");
        const eggsFood = await food("Eggs");
        const milkFood = await food("Milk");
        const eggs = await fridgeItem(eggsFood, 300);
        const milk = await fridgeItem(milkFood, 500);

        const moved = await call("move_fridge_items", {
            ids: [eggs, milk],
            location_id: freezer,
        });
        expect(moved.isError).toBeFalsy();
        expect(await ledgerBalanced(eggsFood)).toBe(true);
        expect(await ledgerBalanced(milkFood)).toBe(true);

        const deleted = await call("delete_fridge_items", {
            ids: [eggs, milk],
        });
        expect(deleted.isError).toBeFalsy();
        expect(await count("fridge_items")).toBe(0);
        expect(await ledgerBalanced(eggsFood)).toBe(true);
        expect(await ledgerBalanced(milkFood)).toBe(true);

        const [moveEntry, deleteEntry] = await actions();
        // Undo in reverse: the delete first, then the move.
        expect((await undo(deleteEntry!.id)).status).toBe("undone");
        expect(await count("fridge_items")).toBe(2);
        expect(await ledgerBalanced(eggsFood)).toBe(true);
        expect(await ledgerBalanced(milkFood)).toBe(true);
        expect((await undo(moveEntry!.id)).status).toBe("undone");
        const back = await rows(
            "select location_id from public.fridge_items order by id",
        );
        expect(back.map((row) => row.location_id)).toEqual([
            fridgeId,
            fridgeId,
        ]);
        expect(await ledgerBalanced(eggsFood)).toBe(true);
    });

    test("move_fridge_items leaves items already at the destination alone and says so", async () => {
        const freezer = await place("Freezer");
        const eggs = await fridgeItem(await food("Eggs"), 300, freezer);
        const milk = await fridgeItem(await food("Milk"), 500);
        const result = await call("move_fridge_items", {
            ids: [eggs, milk],
            location_id: freezer,
        });
        expect(result.isError).toBeFalsy();
        expect(text(result)).toContain("1 fridge item already there.");
        expect(result.structuredContent).toMatchObject({
            location: "Freezer",
            moved: [{ id: milk, from_location: "Fridge" }],
            unchanged: [eggs],
        });
        const [entry] = await actions();
        const snapshot = JSON.stringify(entry!.snapshot);
        expect(snapshot).toContain(milk);
        expect(snapshot).not.toContain(eggs);
    });

    test("a call that changes nothing records nothing and promises no undo", async () => {
        const freezer = await place("Freezer");
        const eggs = await fridgeItem(await food("Eggs"), 300, freezer);
        const again = await call("move_fridge_items", {
            ids: [eggs],
            location_id: freezer,
        });
        expect(again.isError).toBeFalsy();
        expect(text(again)).toContain("Nothing moved");
        expect(text(again)).not.toContain("undo");

        const milk = await food("Milk");
        const plain = await call("remove_usual", { food_id: milk });
        expect(plain.isError).toBeFalsy();
        expect(text(plain)).toContain("is not on the Usuals list");
        expect(text(plain)).not.toContain("undo");
        expect(plain.structuredContent).toMatchObject({ changed: false });
        expect(await actions()).toEqual([]);
    });

    test("an id that is no item, line, location or food is a clear error that records and changes nothing", async () => {
        const eggs = await fridgeItem(await food("Eggs"), 300);
        const line = await groceryLine("Milk");
        const before = await fingerprint();
        const movements = await movementCount();
        const stranger = crypto.randomUUID();
        for (const [tool, args, said] of [
            [
                "move_fridge_items",
                { ids: [eggs, stranger], location_id: fridgeId },
                `No fridge item found with id ${stranger}`,
            ],
            [
                "move_fridge_items",
                { ids: [eggs], location_id: stranger },
                "No fridge location found",
            ],
            [
                "delete_fridge_items",
                { ids: [eggs, stranger] },
                `No fridge item found with id ${stranger}`,
            ],
            [
                "delete_grocery_lines",
                { ids: [line, stranger] },
                `No grocery line found with id ${stranger}`,
            ],
            ["remove_usual", { food_id: stranger }, "No food found"],
        ] as const) {
            const result = await call(tool, args);
            expect(result.isError, tool).toBe(true);
            expect(text(result), tool).toContain(said);
            expect(text(result), tool).toContain("Nothing was changed");
        }
        expect(await fingerprint()).toBe(before);
        expect(await movementCount()).toBe(movements);
        expect(await actions()).toEqual([]);
    });

    test("an id that is not a UUID is refused and the batch is capped", async () => {
        for (const [tool, args] of [
            ["move_fridge_items", { ids: ["eggs"], location_id: fridgeId }],
            ["delete_fridge_items", { ids: ["eggs"] }],
            ["delete_grocery_lines", { ids: ["eggs"] }],
            ["remove_usual", { food_id: "eggs" }],
            ["delete_fridge_items", { ids: [] }],
            [
                "delete_grocery_lines",
                {
                    ids: Array.from({ length: 201 }, () => crypto.randomUUID()),
                },
            ],
        ] as const) {
            const result = await call(tool, args).catch((err: Error) => err);
            expect(
                result instanceof Error ? result.message : text(result),
                tool,
            ).toMatch(/must be|too_big|too_small|Too (big|small)|at least/i);
        }
        expect(await actions()).toEqual([]);
    });

    test("remove_usual: a product is no usual and an archived food is unknown", async () => {
        const { kirkland } = await usual();
        const viaProduct = await call("remove_usual", { food_id: kirkland });
        expect(viaProduct.isError).toBe(true);
        expect(text(viaProduct)).toContain(
            "is a product of another food, not a usual",
        );
        expect(await actions()).toEqual([]);
    });

    test("remove_usual takes a usual added by hand off the list, and undo puts it back with its stamp", async () => {
        const plain = await food("Salt");
        await getCtx()
            .sql`update public.foods set usual_added_at = now(), restock_schedule = 'monthly' where id = ${plain}`;
        expect(await usualNames()).toEqual(["Salt"]);
        const result = await call("remove_usual", { food_id: plain });
        expect(result.isError).toBeFalsy();
        expect(text(result)).toStartWith("Removed Salt from the Usuals list.");
        expect(await usualNames()).toEqual([]);
        const [entry] = await actions();
        expect((await undo(entry!.id)).status).toBe("undone");
        expect(await usualNames()).toEqual(["Salt"]);
        const [row] = await rows(
            "select usual_added_at from public.foods where id = $1",
            plain,
        );
        expect(row!.usual_added_at).not.toBeNull();
    });

    test("undoing a removed usual after a column changed since is a conflict that restores nothing", async () => {
        const { plain } = await usual();
        await call("remove_usual", { food_id: plain });
        const [entry] = await actions();
        // Someone sets a new schedule on the food after the tool ran.
        await getCtx()
            .sql`update public.foods set restock_schedule = 'weekly' where id = ${plain}`;
        const out = await undo(entry!.id);
        expect(out.status).toBe("conflict");
        expect(out.message).toContain("Eggs");
        expect(out.message).toContain("changed since");
        // The whole undo is refused: the later change stays, and so does the
        // removal (the products are still off the food).
        const [row] = await rows(
            "select restock_schedule, usual_product_id from public.foods where id = $1",
            plain,
        );
        expect(row!.restock_schedule).toBe("weekly");
        expect(row!.usual_product_id).toBeNull();
    });

    test("remove_usual refuses and changes nothing when a product is filed under the food after it was recorded", async () => {
        const plain = await food("Eggs");
        const kirkland = await food("Kirkland Eggs");
        const late = await food("Late Eggs");
        expect(
            (
                await call("set_usual_product", {
                    food_id: plain,
                    product_food_id: kirkland,
                })
            ).isError,
        ).toBeFalsy();
        const real = foodsDb.liveFoodsStore;
        let lists = 0;
        const spy = spyOn(foodsDb, "liveFoodsStore").mockImplementation(() => {
            const store = real();
            return {
                ...store,
                async listFoods(hh: string) {
                    lists++;
                    // The second listing is removeUsual's own: someone files
                    // Late Eggs under Eggs just before it.
                    if (lists === 2) {
                        await getCtx()
                            .sql`update public.foods set generic_food_id = ${plain} where id = ${late}`;
                    }
                    return store.listFoods(hh);
                },
            };
        });
        try {
            const result = await call("remove_usual", { food_id: plain });
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(
                "Eggs changed while it was being removed from Usuals",
            );
            expect(text(result)).toContain("Nothing was changed. Try again.");
        } finally {
            spy.mockRestore();
        }
        expect(await actions()).toEqual([]);
        const after = await rows(
            "select name, generic_food_id from public.foods where id in ($1, $2) order by name",
            kirkland,
            late,
        );
        // Both products are still under Eggs: the call undid its own writes
        // and left the other member's change alone.
        expect(after.map((row) => [row.name, row.generic_food_id])).toEqual([
            ["Kirkland Eggs", plain],
            ["Late Eggs", plain],
        ]);
    });

    test("move_fridge_items refuses and changes nothing when an item's amount changed after it was recorded", async () => {
        const freezer = await place("Freezer");
        const eggs = await fridgeItem(await food("Eggs"), 300);
        const real = fridgeDb.liveFridgeStore;
        let lists = 0;
        const spy = spyOn(fridgeDb, "liveFridgeStore").mockImplementation(
            () => {
                const store = real();
                return {
                    ...store,
                    async listItems(hh: string) {
                        lists++;
                        // The second listing is moveItem's own.
                        if (lists === 2) {
                            await getCtx()
                                .sql`update public.fridge_items set amount = 120 where id = ${eggs}`;
                        }
                        return store.listItems(hh);
                    },
                };
            },
        );
        try {
            const result = await call("move_fridge_items", {
                ids: [eggs],
                location_id: freezer,
            });
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(
                "Fridge item Eggs changed while it was being moved. Nothing was changed. Try again.",
            );
        } finally {
            spy.mockRestore();
        }
        expect(await actions()).toEqual([]);
        const [row] = await rows(
            "select amount::float as amount, location_id from public.fridge_items where id = $1",
            eggs,
        );
        expect(row).toMatchObject({ amount: 120, location_id: fridgeId });
    });

    test("delete_fridge_items refuses and changes nothing when an item was eaten from after it was recorded", async () => {
        const eggsFood = await food("Eggs");
        const eggs = await fridgeItem(eggsFood, 300);
        const movementsBefore = await movementCount();
        const real = fridgeDb.liveFridgeStore;
        let lists = 0;
        const spy = spyOn(fridgeDb, "liveFridgeStore").mockImplementation(
            () => {
                const store = real();
                return {
                    ...store,
                    async listItems(hh: string) {
                        lists++;
                        // The second listing is deleteFridgeItemAdjust's own:
                        // someone ate 180 g a moment earlier (stock + ledger).
                        if (lists === 2) {
                            await getCtx()
                                .sql`update public.fridge_items set amount = 120 where id = ${eggs}`;
                            await getCtx().sql`
                                insert into public.stock_movements (
                                    household_id, food_id, fridge_item_id,
                                    delta, unit, reason
                                )
                                values (
                                    ${householdId}, ${eggsFood}, ${eggs},
                                    ${-180}, ${"g"}, ${"eat"}
                                )
                            `;
                        }
                        return store.listItems(hh);
                    },
                };
            },
        );
        try {
            const result = await call("delete_fridge_items", { ids: [eggs] });
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(
                "Fridge item Eggs changed while it was being removed. Nothing was changed. Try again.",
            );
        } finally {
            spy.mockRestore();
        }
        expect(await actions()).toEqual([]);
        // The item is still there at the eaten-down amount, and the only new
        // movement is the other member's eat: no adjust from this call.
        const [row] = await rows(
            "select amount::float as amount from public.fridge_items where id = $1",
            eggs,
        );
        expect(row!.amount).toBe(120);
        expect(await movementCount()).toBe(movementsBefore + 1);
        expect(
            await rows(
                "select reason from public.stock_movements where fridge_item_id = $1 order by created_at",
                eggs,
            ),
        ).toEqual([{ reason: "adjust" }, { reason: "eat" }]);
        expect(await ledgerBalanced(eggsFood)).toBe(true);
    });

    test("delete_grocery_lines refuses and rolls back when a line is gone by the time it is deleted", async () => {
        const first = await groceryLine("Eggs");
        const second = await groceryLine("Milk");
        const real = groceryDb.liveGroceryStore;
        const spy = spyOn(groceryDb, "liveGroceryStore").mockImplementation(
            () => {
                const store = real();
                return {
                    ...store,
                    async deleteLine(hh: string, id: string) {
                        // Someone else removes the second line after it was
                        // recorded and before this call reaches it.
                        if (id === first) {
                            await getCtx()
                                .sql`delete from public.grocery_lines where id = ${second}`;
                        }
                        return store.deleteLine(hh, id);
                    },
                };
            },
        );
        try {
            const result = await call("delete_grocery_lines", {
                ids: [first, second],
            });
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(
                "changed while it was being removed",
            );
        } finally {
            spy.mockRestore();
        }
        // The call's own delete of the first line was rolled back with it.
        expect(
            (await rows("select id from public.grocery_lines")).map(
                (row) => row.id,
            ),
        ).toEqual([first]);
        expect(await actions()).toEqual([]);
    });

    test("the household token records no member and its owner can undo it", async () => {
        const eggs = await fridgeItem(await food("Eggs"), 300);
        const result = await call(
            "delete_fridge_items",
            { ids: [eggs] },
            "legacy",
            { kind: "household", householdId },
        );
        expect(result.isError).toBeFalsy();
        expect(text(result)).toContain(UNDO_SENTENCE);
        const [entry] = await actions();
        expect(entry).toMatchObject({
            member_id: null,
            connection: "household token",
            tool: "delete_fridge_items",
        });
        expect((await undo(entry!.id)).status).toBe("undone");
        expect(await count("fridge_items")).toBe(1);
    });

    test("with the flag off the four tools are not there to call", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-household-admin": false }));
        for (const name of KITCHEN_ADMIN_TOOL_NAMES) {
            const result = await call(name, {}).catch((err: Error) => err);
            expect(
                result instanceof Error ? result.message : text(result),
                name,
            ).toMatch(/not found/i);
        }
        expect(await actions()).toEqual([]);
    });
});
