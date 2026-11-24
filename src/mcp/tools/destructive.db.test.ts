// The destructive MCP tools against real Postgres, through the real /mcp
// handler. Each of them is guarded: it records what it removed or changed in
// the household's activity log, says so in its result, can be undone for 24
// hours, and does nothing at all while the household's switch is Off. The
// in-memory tool tests in src/mcp.test.ts cover the wording and both
// protocol eras; what only the database can show is that the snapshot really
// holds the rows (children, ledger and all) and that undo puts them back.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import { liveFoodsStore } from "../../db/foods.js";
import * as groceryDb from "../../db/grocery.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { pairAppSqlForTests, setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedFridgeLocation,
    seedGroceryStore,
    seedHousehold,
    seedMember,
} from "../../db/testing/fixtures.js";
import { waitForLockWaiters } from "../../db/testing/lock-race.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { undoAgentAction } from "../../domain/agent-actions.js";
import { findFoodById, updateFood } from "../../domain/foods.js";
import { ledgerMatchesStock } from "../../domain/stock.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../server.js";

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
// A notification's undo is all or nothing, so its tools say when it is refused.
const NOTICE_UNDO_SENTENCE =
    "The household can undo this for 24 hours in Settings › AI connections, unless someone has changed their copy since.";
const REFUSAL = "Any agent can delete is Off in Settings › AI connections.";
const PERSON_REFUSAL =
    "Your agents can delete is Off in Settings › AI connections for the person you act for.";

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

/**
 * One JSON-RPC batch as one POST: the calls share a tool context and run
 * concurrently, which is what the guard has to survive. Answers come back
 * keyed by request id.
 */
async function callBatch(
    who: Extract<Who, { kind: "user" }>,
    calls: { id: number; name: string; args: Record<string, unknown> }[],
): Promise<Map<number, Result>> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId: who.userId });
        if (who.client) c.set("tokenClient", who.client);
        return handleMcp(c);
    });
    const res = await app.request(
        new Request("http://test.local/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-protocol-version": "2025-11-25",
            },
            body: JSON.stringify(
                calls.map((one) => ({
                    jsonrpc: "2.0",
                    id: one.id,
                    method: "tools/call",
                    params: { name: one.name, arguments: one.args },
                })),
            ),
        }),
    );
    expect(res.status).toBe(200);
    // The answer is a JSON array, or the same messages as server-sent events.
    const raw = await res.text();
    const messages = res.headers.get("content-type")?.includes("text/event")
        ? raw
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => JSON.parse(line.slice(5)))
        : [JSON.parse(raw)];
    const body = messages.flat() as { id: number; result: Result }[];
    expect(body).toHaveLength(calls.length);
    return new Map(body.map((one) => [one.id, one.result]));
}

type Arranged = {
    tool: string;
    args: Record<string, unknown>;
    /** Part of the activity entry's summary. */
    summary: string;
    /** Asserts the tool did its work. */
    changed: () => Promise<void>;
    /** Asserts undo put everything back. */
    restored: () => Promise<void>;
    /** Asserts something about the entry once it is recorded. */
    entry?: (entry: Record<string, any>) => void;
};

const FINGERPRINT_TABLES = [
    "foods",
    "food_barcodes",
    "food_aliases",
    "fridge_locations",
    "fridge_items",
    "stock_movements",
    "grocery_lines",
    "recipes",
    "recipe_ingredients",
    "recipe_plans",
    "plan_rules",
    "recipe_portions",
    "recipe_variant_overrides",
    "recipe_favourites",
    "meals",
    "meal_items",
    "water_log",
    "weight_log",
    "nutrition_goals",
    "nutrition_goal_days",
];

describeDb(pgAvailable !== null, "destructive agent tools (db)", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let storeId: string;
    let locationId: string;
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
        setFlagsForTests(createMemoryFlags({}));
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
        locationId = await seedFridgeLocation(sql, householdId);
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

    async function food(name: string, nutrition = false): Promise<string> {
        const made = await call("upsert_food", { name, on_similar: "create" });
        const id = made.structuredContent!.id as string;
        if (nutrition) {
            await getCtx().sql`
                update public.foods
                set calories = 100, protein_g = 10, carbs_g = 10, fat_g = 5,
                    default_unit = 'g'
                where id = ${id}
            `;
        }
        return id;
    }

    async function fridgeItem(
        foodId: string,
        amount: number,
        into = locationId,
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

    async function groceryLine(foodId: string): Promise<string> {
        const added = await call("add_grocery_line", {
            kind: "food",
            food_id: foodId,
            amount: 2,
            unit: "each",
        });
        expect(added.isError).toBeFalsy();
        return added.structuredContent!.id as string;
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

    async function recipe(): Promise<{ id: string; ingredient: string }> {
        const made = await call("create_recipe", {
            name: "Soup",
            yield_portions: 2,
        });
        const id = made.structuredContent!.id as string;
        const flour = await food("Flour");
        await call("add_recipe_ingredient", {
            recipe_id: id,
            food_id: flour,
            amount: 200,
            unit: "g",
        });
        const [row] = await rows(
            "select id from public.recipe_ingredients where recipe_id = $1",
            id,
        );
        return { id, ingredient: row!.id as string };
    }

    /** Per-day goal overrides for the owner on these dates, as the table holds them. */
    async function goalDays(dates: string[]): Promise<Record<string, any>[]> {
        const { sql } = getCtx();
        for (const date of dates) {
            await sql`
                insert into public.nutrition_goal_days (
                    household_id, user_id, date, daily_calories, daily_protein_g
                )
                values (${householdId}, ${ownerId}, ${date}::date, ${2400}, ${150})
            `;
        }
        return rows(
            "select id, date::text as date, daily_calories, daily_protein_g::float as daily_protein_g from public.nutrition_goal_days where date::text = any($1::text[]) order by date",
            `{${dates.join(",")}}`,
        );
    }

    // ---------- the guarded tools ----------

    const scenarios: Record<string, () => Promise<Arranged>> = {
        delete_grocery_line: async () => {
            const id = await groceryLine(await food("Eggs"));
            return {
                tool: "delete_grocery_line",
                args: { id },
                summary: "Deleted grocery line",
                changed: async () =>
                    expect(await count("grocery_lines")).toBe(0),
                restored: async () => {
                    const back = await rows(
                        "select id from public.grocery_lines",
                    );
                    expect(back.map((row) => row.id)).toEqual([id]);
                },
            };
        },
        clear_checked_grocery_lines: async () => {
            const a = await groceryLine(await food("Eggs"));
            const b = await groceryLine(await food("Milk"));
            await groceryLine(await food("Flour"));
            await call("check_grocery_line", { id: a, checked: true });
            await call("check_grocery_line", { id: b, checked: true });
            return {
                tool: "clear_checked_grocery_lines",
                args: {},
                summary: "Cleared 2 checked grocery lines",
                changed: async () =>
                    expect(await count("grocery_lines")).toBe(1),
                restored: async () => {
                    expect(await count("grocery_lines")).toBe(3);
                    const checked = await rows(
                        "select id from public.grocery_lines where checked",
                    );
                    expect(checked.map((row) => row.id).sort()).toEqual(
                        [a, b].sort(),
                    );
                },
            };
        },
        delete_fridge_item: async () => {
            const eggs = await food("Eggs");
            const id = await fridgeItem(eggs, 300);
            return {
                tool: "delete_fridge_item",
                args: { id },
                summary: "Deleted fridge item",
                changed: async () => {
                    expect(await count("fridge_items")).toBe(0);
                    expect(await ledgerBalanced(eggs)).toBe(true);
                },
                restored: async () => {
                    const items = await rows(
                        "select id, amount::float as amount from public.fridge_items",
                    );
                    expect(items).toEqual([{ id, amount: 300 }]);
                    expect(await ledgerBalanced(eggs)).toBe(true);
                },
            };
        },
        discard_fridge_item: async () => {
            const eggs = await food("Eggs");
            const id = await fridgeItem(eggs, 10);
            return {
                tool: "discard_fridge_item",
                args: { id, amount: 4 },
                summary: "Tossed 4 g of",
                changed: async () => {
                    const [item] = await rows(
                        "select amount::float as amount from public.fridge_items",
                    );
                    expect(item!.amount).toBe(6);
                    expect(await ledgerBalanced(eggs)).toBe(true);
                },
                restored: async () => {
                    const [item] = await rows(
                        "select amount::float as amount from public.fridge_items",
                    );
                    expect(item!.amount).toBe(10);
                    expect(await ledgerBalanced(eggs)).toBe(true);
                },
            };
        },
        delete_fridge_location: async () => {
            const freezer = await seedFridgeLocation(
                getCtx().sql,
                householdId,
                "Freezer",
            );
            const peas = await food("Peas");
            const fish = await food("Fish");
            await fridgeItem(peas, 100, freezer);
            await fridgeItem(fish, 200, freezer);
            const kept = await fridgeItem(await food("Eggs"), 300);
            return {
                tool: "delete_fridge_location",
                args: { id: freezer },
                summary: "Deleted fridge location Freezer and its 2 items",
                changed: async () => {
                    expect(await count("fridge_items")).toBe(1);
                    expect(await count("fridge_locations")).toBe(1);
                },
                restored: async () => {
                    expect(await count("fridge_items")).toBe(3);
                    expect(await count("fridge_locations")).toBe(2);
                    expect(await ledgerBalanced(peas)).toBe(true);
                    expect(await ledgerBalanced(fish)).toBe(true);
                    const [row] = await rows(
                        "select id from public.fridge_items where id = $1",
                        kept,
                    );
                    expect(row).toBeDefined();
                },
            };
        },
        delete_meal: async () => {
            const oats = await food("Oats", true);
            const logged = await call("log_meal", {
                description: "Porridge",
                meal_type: "breakfast",
                items: [{ food_id: oats, amount: 100, unit: "g" }],
            });
            expect(logged.isError).toBeFalsy();
            const [meal] = await rows("select * from public.meals");
            expect(await count("meal_items")).toBe(1);
            return {
                tool: "delete_meal",
                args: { id: meal!.id },
                summary: 'Deleted meal "Porridge"',
                changed: async () => {
                    expect(await count("meals")).toBe(0);
                    expect(await count("meal_items")).toBe(0);
                },
                restored: async () => {
                    const [back] = await rows("select * from public.meals");
                    expect(back).toEqual(meal);
                    expect(Number(back!.calories)).toBe(100);
                    expect(await count("meal_items")).toBe(1);
                },
            };
        },
        delete_recipe: async () => {
            const soup = await recipe();
            await call("plan_recipe", {
                recipe_id: soup.id,
                date: "2099-01-02",
                slot: "dinner",
            });
            await getCtx().sql`
                insert into public.recipe_favourites (household_id, user_id, recipe_id)
                values (${householdId}, ${ownerId}, ${soup.id})
            `;
            return {
                tool: "delete_recipe",
                args: { id: soup.id },
                summary:
                    "Deleted recipe Soup (favourites are not restored by undo)",
                changed: async () => {
                    expect(await count("recipes")).toBe(0);
                    expect(await count("recipe_ingredients")).toBe(0);
                    expect(await count("recipe_plans")).toBe(0);
                },
                restored: async () => {
                    expect(await count("recipes")).toBe(1);
                    expect(await count("recipe_ingredients")).toBe(1);
                    expect(await count("recipe_plans")).toBe(1);
                    // Stars are private to each member; undo cannot return them.
                    expect(await count("recipe_favourites")).toBe(0);
                },
            };
        },
        remove_recipe_ingredient: async () => {
            const soup = await recipe();
            // A member's version of the ingredient goes with it, and comes
            // back with it.
            const set = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "amount",
                ingredient_id: soup.ingredient,
                amount: 50,
                unit: "g",
            });
            expect(set.isError).toBeFalsy();
            const [version] = await rows(
                "select id from public.recipe_variant_overrides",
            );
            return {
                tool: "remove_recipe_ingredient",
                args: { recipe_id: soup.id, ingredient_id: soup.ingredient },
                summary: "Removed Flour from recipe Soup",
                changed: async () => {
                    expect(await count("recipe_ingredients")).toBe(0);
                    expect(await count("recipe_variant_overrides")).toBe(0);
                },
                restored: async () => {
                    const back = await rows(
                        "select id from public.recipe_ingredients",
                    );
                    expect(back.map((row) => row.id)).toEqual([
                        soup.ingredient,
                    ]);
                    expect(
                        await rows(
                            "select id, ingredient_id, amount::float as amount, unit from public.recipe_variant_overrides",
                        ),
                    ).toEqual([
                        {
                            id: version!.id,
                            ingredient_id: soup.ingredient,
                            amount: 50,
                            unit: "g",
                        },
                    ]);
                },
            };
        },
        clear_recipe_variant: async () => {
            const soup = await recipe();
            const set = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "amount",
                ingredient_id: soup.ingredient,
                amount: 50,
                unit: "g",
            });
            expect(set.isError).toBeFalsy();
            const [version] = await rows(
                "select id from public.recipe_variant_overrides",
            );
            return {
                tool: "clear_recipe_variant",
                args: { recipe_id: soup.id, member_id: ownerId },
                summary: "Cleared 1 change to a recipe version",
                changed: async () =>
                    expect(await count("recipe_variant_overrides")).toBe(0),
                restored: async () => {
                    const back = await rows(
                        "select id, amount::float as amount, unit from public.recipe_variant_overrides",
                    );
                    expect(back).toEqual([
                        { id: version!.id, amount: 50, unit: "g" },
                    ]);
                },
            };
        },
        unplan_recipe: async () => {
            const soup = await recipe();
            await call("plan_recipe", {
                recipe_id: soup.id,
                date: "2099-01-02",
                slot: "dinner",
            });
            const [plan] = await rows("select id from public.recipe_plans");
            return {
                tool: "unplan_recipe",
                args: { plan_id: plan!.id },
                summary: "Removed Soup from the plan for 2099-01-02 (dinner)",
                changed: async () =>
                    expect(await count("recipe_plans")).toBe(0),
                restored: async () => {
                    const back = await rows(
                        "select id from public.recipe_plans",
                    );
                    expect(back.map((row) => row.id)).toEqual([plan!.id]);
                },
            };
        },
        delete_water: async () => {
            await call("log_water", { amount_ml: 250 });
            const [entry] = await rows("select * from public.water_log");
            return {
                tool: "delete_water",
                args: { id: entry!.id },
                summary: "Deleted water entry",
                changed: async () => expect(await count("water_log")).toBe(0),
                restored: async () => {
                    const [back] = await rows("select * from public.water_log");
                    expect(back).toEqual(entry);
                },
            };
        },
        delete_weight: async () => {
            await call("log_weight", { weight: 70, unit: "kg" });
            const [entry] = await rows("select * from public.weight_log");
            return {
                tool: "delete_weight",
                args: { id: entry!.id },
                summary: "Deleted weight entry",
                changed: async () => expect(await count("weight_log")).toBe(0),
                restored: async () => {
                    const [back] = await rows(
                        "select * from public.weight_log",
                    );
                    expect(back).toEqual(entry);
                },
            };
        },
        set_nutrition_goals: async () => {
            const days = await goalDays(["2099-01-01", "2099-01-02"]);
            await goalDays(["2099-02-01"]);
            return {
                tool: "set_nutrition_goals",
                args: { from: "2099-01-01", to: "2099-01-03", clear: true },
                summary: "Cleared 2 per-day goal overrides for 2099-01-01",
                changed: async () => {
                    const left = await rows(
                        "select date::text as date from public.nutrition_goal_days",
                    );
                    expect(left).toEqual([{ date: "2099-02-01" }]);
                },
                restored: async () => {
                    expect(
                        await rows(
                            "select id, date::text as date, daily_calories, daily_protein_g::float as daily_protein_g from public.nutrition_goal_days where date < '2099-02-01' order by date",
                        ),
                    ).toEqual(days);
                },
            };
        },
        merge_foods: async () => {
            const keep = await food("Eggs");
            const drop = await food("Egg");
            const sql = getCtx().sql;
            await sql`
                insert into public.food_barcodes (household_id, barcode, food_id)
                values (${householdId}, ${"4006381333931"}, ${drop})
            `;
            await sql`
                insert into public.food_aliases (household_id, alias, food_id)
                values (${householdId}, ${"hen egg"}, ${drop})
            `;
            const fridge = await fridgeItem(drop, 250);
            const line = await groceryLine(drop);
            const soup = await recipe();
            await call("add_recipe_ingredient", {
                recipe_id: soup.id,
                food_id: drop,
                amount: 2,
                unit: "each",
            });
            // The owner's own version adds the dropped food as well.
            const versioned = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "add",
                food_id: drop,
                amount: 3,
                unit: "each",
            });
            expect(versioned.isError).toBeFalsy();
            const refsTo = async (id: string) => ({
                barcode: (
                    await rows(
                        "select food_id from public.food_barcodes where barcode = '4006381333931'",
                    )
                )[0]!.food_id,
                alias: (
                    await rows(
                        "select food_id from public.food_aliases where alias = 'hen egg'",
                    )
                )[0]!.food_id,
                fridge: (
                    await rows(
                        "select food_id from public.fridge_items where id = $1",
                        fridge,
                    )
                )[0]!.food_id,
                line: (
                    await rows(
                        "select food_id from public.grocery_lines where id = $1",
                        line,
                    )
                )[0]!.food_id,
                ingredient: (
                    await rows(
                        "select count(*)::int as n from public.recipe_ingredients where food_id = $1",
                        id,
                    )
                )[0]!.n,
                movements: (
                    await rows(
                        "select count(*)::int as n from public.stock_movements where food_id = $1",
                        id,
                    )
                )[0]!.n,
                version: (
                    await rows(
                        "select count(*)::int as n from public.recipe_variant_overrides where food_id = $1",
                        id,
                    )
                )[0]!.n,
            });
            const before = await fingerprint();
            return {
                tool: "merge_foods",
                args: { keep_id: keep, drop_id: drop },
                summary: "Merged Egg into Eggs",
                changed: async () => {
                    const moved = await refsTo(keep);
                    expect(moved).toMatchObject({
                        barcode: keep,
                        alias: keep,
                        fridge: keep,
                        line: keep,
                        ingredient: 1,
                        movements: 1,
                        version: 1,
                    });
                    const [dropped] = await rows(
                        "select archived_at from public.foods where id = $1",
                        drop,
                    );
                    expect(dropped!.archived_at).not.toBeNull();
                },
                restored: async () => {
                    expect(await refsTo(drop)).toMatchObject({
                        barcode: drop,
                        alias: drop,
                        fridge: drop,
                        line: drop,
                        ingredient: 1,
                        movements: 1,
                        version: 1,
                    });
                    expect(await ledgerBalanced(drop)).toBe(true);
                    // Every column is as it was; updated_at is bookkeeping that
                    // undo never restores, so the fingerprint leaves it out.
                    expect(await fingerprint()).toBe(before);
                },
            };
        },
    };

    const TOOLS = Object.keys(scenarios);

    // ---------- tests ----------

    test("the scenarios cover every guarded tool", () => {
        expect(TOOLS.sort()).toEqual(
            [
                "clear_checked_grocery_lines",
                "delete_fridge_item",
                "delete_fridge_location",
                "delete_grocery_line",
                "delete_meal",
                "delete_recipe",
                "delete_water",
                "delete_weight",
                "discard_fridge_item",
                "merge_foods",
                "remove_recipe_ingredient",
                "set_nutrition_goals",
                "unplan_recipe",
                "clear_recipe_variant",
            ].sort(),
        );
    });

    for (const tool of Object.keys(scenarios)) {
        test(`${tool} is recorded with a snapshot, says how to undo, and undo puts everything back`, async () => {
            const arranged = await scenarios[tool]!();
            const result = await call(arranged.tool, arranged.args);
            expect(result.isError).toBeFalsy();
            expect(result.content.map((c) => c.text).join("\n")).toContain(
                UNDO_SENTENCE,
            );
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
            arranged.entry?.(entry!);

            const out = await undo(entry!.id);
            expect(out.status).toBe("undone");
            await arranged.restored();
            const [done] = await actions();
            expect(done!.undone_by).toBe(ownerId);
        });

        test(`${tool} is refused while agents may not make destructive changes, and changes nothing`, async () => {
            const arranged = await scenarios[tool]!();
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        false,
                    ),
                householdId,
            );
            const before = await fingerprint();
            const result = await call(arranged.tool, arranged.args);
            expect(result.isError).toBe(true);
            expect(result.content.map((c) => c.text).join("\n")).toContain(
                REFUSAL,
            );
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
        });
    }

    // ---------- unplan_recipe on a repeating plan ----------

    describe("unplan_recipe on a repeating plan", () => {
        const START = "2099-01-02";

        async function repeating(): Promise<{ ruleId: string }> {
            const soup = await recipe();
            await call("plan_recipe", {
                recipe_id: soup.id,
                date: START,
                slot: "dinner",
                repeat: "daily",
            });
            const [rule] = await rows("select id from public.plan_rules");
            return { ruleId: rule!.id as string };
        }

        async function ruleRow(): Promise<Record<string, any>> {
            const [row] = await rows(
                `select skipped_on::text[] as skipped_on, ends_on::text as ends_on
                 from public.plan_rules`,
            );
            return JSON.parse(JSON.stringify(row));
        }

        test("series is recorded as an update of the repeat, and undo brings every day back", async () => {
            const { ruleId } = await repeating();
            const before = await fingerprint();
            const result = await call("unplan_recipe", {
                plan_id: `rule:${ruleId}:2099-01-05`,
                scope: "series",
            });
            expect(result.isError).toBeFalsy();
            expect(result.content.map((c) => c.text).join("\n")).toContain(
                UNDO_SENTENCE,
            );
            expect(await ruleRow()).toEqual({
                skipped_on: [],
                ends_on: "2099-01-04",
            });

            const [entry] = await actions();
            expect(entry).toMatchObject({
                tool: "unplan_recipe",
                destructive: true,
                undoable: true,
            });
            expect(entry!.summary).toContain(
                "Ended the repeating plan of Soup from 2099-01-05 (dinner); earlier days stay",
            );
            expect(
                JSON.stringify(entry!.snapshot.changes).includes("plan_rules"),
            ).toBe(true);

            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await ruleRow()).toEqual({
                skipped_on: [],
                ends_on: null,
            });
            expect(await fingerprint()).toBe(before);
        });

        test("one day is recorded the same way, and undo puts that day back", async () => {
            const { ruleId } = await repeating();
            const before = await fingerprint();
            const result = await call("unplan_recipe", {
                plan_id: `rule:${ruleId}:2099-01-05`,
            });
            expect(result.isError).toBeFalsy();
            expect(await ruleRow()).toEqual({
                skipped_on: ["2099-01-05"],
                ends_on: null,
            });
            const [entry] = await actions();
            expect(entry!.summary).toContain(
                "Removed Soup from the plan for 2099-01-05 (dinner); the rest of the repeat stays",
            );
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await fingerprint()).toBe(before);
        });

        test("a day of one repeat is recorded in that repeat only, and undo puts it back", async () => {
            const soup = await recipe();
            // Fridays, then Saturdays: two repeats of the soup on different days.
            const plan = (days: number[]) =>
                call("plan_recipe", {
                    recipe_id: soup.id,
                    date: START,
                    slot: "dinner",
                    repeat: "days",
                    days,
                });
            await plan([5]);
            await plan([6]);
            expect(await count("plan_rules")).toBe(2);
            const [friday] = await rows(
                "select id from public.plan_rules where days = '{5}'",
            );
            const before = await fingerprint();
            const result = await call("unplan_recipe", {
                plan_id: `rule:${friday!.id}:2099-01-09`,
            });
            expect(result.isError).toBeFalsy();
            const skipped = await rows(
                "select days::text as days, skipped_on::text[] as skipped_on from public.plan_rules order by days::text",
            );
            expect(skipped.map((r) => r.skipped_on)).toEqual([
                ["2099-01-09"],
                [],
            ]);
            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await fingerprint()).toBe(before);
        });

        for (const scope of ["day", "series"] as const) {
            test(`${scope} is refused while agents may not make destructive changes, and changes nothing`, async () => {
                const { ruleId } = await repeating();
                await asUser(
                    ownerId,
                    () =>
                        liveSettingsStore().setAgentDestructiveAllowed(
                            householdId,
                            false,
                        ),
                    householdId,
                );
                const before = await fingerprint();
                const result = await call("unplan_recipe", {
                    plan_id: `rule:${ruleId}:2099-01-05`,
                    scope,
                });
                expect(result.isError).toBe(true);
                expect(result.content.map((c) => c.text).join("\n")).toContain(
                    REFUSAL,
                );
                expect(await fingerprint()).toBe(before);
                expect(await actions()).toEqual([]);
            });
        }

        test("the same repeat planned again after its series ended is told when it ended", async () => {
            const { ruleId } = await repeating();
            const end = await call("unplan_recipe", {
                plan_id: `rule:${ruleId}:2099-01-05`,
                scope: "series",
            });
            expect(end.isError).toBeFalsy();
            const [soup] = await rows("select id from public.recipes");
            const again = await call("plan_recipe", {
                recipe_id: soup!.id,
                date: START,
                slot: "dinner",
                repeat: "daily",
            });
            expect(again.isError).toBe(true);
            expect(again.content.map((c) => c.text).join(" ")).toContain(
                "still repeats at dinner until Sun, Jan 4. Pick a start after that, or other days.",
            );
        });

        test("deleting the recipe takes its repeat, and undo brings it back", async () => {
            const { ruleId } = await repeating();
            const [soup] = await rows("select id from public.recipes");
            const before = await fingerprint();
            const result = await call("delete_recipe", { id: soup!.id });
            expect(result.isError).toBeFalsy();
            expect(await count("plan_rules")).toBe(0);
            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");
            const [back] = await rows("select id from public.plan_rules");
            expect(back!.id).toBe(ruleId);
            expect(await fingerprint()).toBe(before);
        });
    });

    // ---------- recipe versions: every reader agrees on what a person needs ----------

    describe("recipe versions across the tools", () => {
        const text = (result: Result) =>
            result.content.map((part) => part.text).join("\n");
        const tomorrow = (from?: string) =>
            new Date(
                (from ? Date.parse(`${from}T00:00:00Z`) : Date.now()) +
                    86400000,
            )
                .toISOString()
                .slice(0, 10);

        test("a recipe that lists one food twice is netted once, whoever has a version", async () => {
            const made = await call("create_recipe", {
                name: "Bread",
                yield_portions: 2,
            });
            const recipeId = made.structuredContent!.id as string;
            const flour = await food("Flour");
            const salt = await food("Salt");
            for (const [foodId, amount, unit] of [
                [flour, 300, "g"],
                [flour, 0.2, "kg"],
                [salt, 10, "g"],
            ] as const) {
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: foodId,
                    amount,
                    unit,
                });
            }
            await call("verify_recipe", { id: recipeId });
            await fridgeItem(flour, 200);
            const bee = await addMember();
            const shop = async () => {
                const result = await call("add_recipe_to_grocery", {
                    recipe_id: recipeId,
                    store_id: storeId,
                    member_ids: [ownerId],
                });
                expect(result.isError).toBeFalsy();
                const lines = await rows(
                    "select display_name, amount::float as amount, unit from public.grocery_lines order by display_name",
                );
                await getCtx().sql`delete from public.grocery_lines`;
                return lines;
            };
            const alone = await shop();
            // One portion of a yield of 2 needs 250 g of the 500 g; 200 g are in the
            // fridge, so one line of 50 g.
            expect(
                alone.filter((line) => line.display_name === "Flour"),
            ).toEqual([{ display_name: "Flour", amount: 50, unit: "g" }]);
            const [saltIngredient] = await rows(
                "select id from public.recipe_ingredients where food_id = $1",
                salt,
            );
            await getCtx().sql`
                insert into public.recipe_variant_overrides (
                    household_id, recipe_id, user_id, ingredient_id, action
                )
                values (${householdId}, ${recipeId}, ${bee}, ${saltIngredient!.id}, 'remove')
            `;
            // Someone else's unrelated version changes nothing for the owner.
            expect(await shop()).toEqual(alone);
        });

        for (const era of ERAS) {
            test(`a notice only a person's version creates can be dismissed (${JSON.stringify(era)})`, async () => {
                const made = await call("create_recipe", {
                    name: "Soup",
                    yield_portions: 1,
                });
                const recipeId = made.structuredContent!.id as string;
                const pasta = await food("Pasta");
                const rice = await food("Rice");
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: pasta,
                    amount: 200,
                    unit: "g",
                });
                const [ingredient] = await rows(
                    "select id from public.recipe_ingredients where recipe_id = $1",
                    recipeId,
                );
                await call("verify_recipe", { id: recipeId });
                await fridgeItem(pasta, 1000);
                const swapped = await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: ownerId,
                    action: "food",
                    ingredient_id: ingredient!.id,
                    food_id: rice,
                });
                expect(swapped.isError).toBeFalsy();
                const today = (await call("get_week_plan", {}, era))
                    .structuredContent!.today as string;
                const planned = await call(
                    "plan_recipe",
                    {
                        recipe_id: recipeId,
                        date: tomorrow(today),
                        slot: "dinner",
                        member_ids: [ownerId],
                    },
                    era,
                );
                expect(planned.isError).toBeFalsy();
                const week = await call("get_week_plan", {}, era);
                const notices = week.structuredContent!.notices as any[];
                expect(notices).toHaveLength(1);
                const { dismiss } = notices[0];
                const out = await call(
                    "dismiss_notice",
                    {
                        code: dismiss.code,
                        subject_kind: dismiss.subject_kind,
                        subject_id: dismiss.subject_id,
                        related_id: dismiss.related_id ?? undefined,
                    },
                    era,
                );
                expect(out.isError).toBeFalsy();
            });
        }

        test("a plan naming a person whose version leaves the allergen out raises no allergen notice; a plan naming nobody does", async () => {
            const { sql } = getCtx();
            await sql`
                insert into public.member_allergens (household_id, user_id, allergen)
                values (${householdId}, ${ownerId}, 'peanut')
            `;
            const made = await call("create_recipe", {
                name: "Satay",
                yield_portions: 1,
            });
            const recipeId = made.structuredContent!.id as string;
            const butter = await food("Peanut butter");
            await sql`update public.foods set allergens = ${sql.array(["peanut"], "text")} where id = ${butter}::uuid`;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: butter,
                amount: 20,
                unit: "g",
            });
            const [ingredient] = await rows(
                "select id from public.recipe_ingredients where recipe_id = $1",
                recipeId,
            );
            await call("verify_recipe", { id: recipeId });
            const left = await call("set_recipe_variant", {
                recipe_id: recipeId,
                member_id: ownerId,
                action: "remove",
                ingredient_id: ingredient!.id,
            });
            expect(left.isError).toBeFalsy();
            const allergenNotices = async () =>
                (
                    (await call("list_notices", {})).structuredContent!
                        .notifications as { kind: string }[]
                ).filter((row) => row.kind === "allergens").length;
            const today = (await call("get_week_plan")).structuredContent!
                .today as string;
            const date = tomorrow(today);
            const named = await call("plan_recipe", {
                recipe_id: recipeId,
                date,
                slot: "dinner",
                member_ids: [ownerId],
            });
            expect(named.isError).toBeFalsy();
            expect(await allergenNotices()).toBe(0);
            // The same recipe planned for nobody in particular is the base.
            const open = await call("plan_recipe", {
                recipe_id: recipeId,
                date,
                slot: "lunch",
            });
            expect(open.isError).toBeFalsy();
            expect(await allergenNotices()).toBe(1);
        });

        test("an upper-case member id reads the same version as the stored one", async () => {
            const soup = await recipe();
            const set = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "amount",
                ingredient_id: soup.ingredient,
                amount: 50,
                unit: "g",
            });
            expect(set.isError).toBeFalsy();
            const lower = await call("get_recipe", {
                id: soup.id,
                member_id: ownerId,
            });
            const upper = await call("get_recipe", {
                id: soup.id,
                member_id: ownerId.toUpperCase(),
            });
            expect(lower.structuredContent!.variant).not.toBeNull();
            expect(upper.structuredContent!.variant).toEqual(
                lower.structuredContent!.variant,
            );
            const first = await call("add_recipe_to_grocery", {
                recipe_id: soup.id,
                member_ids: [ownerId],
                store_id: storeId,
            });
            await getCtx().sql`delete from public.grocery_lines`;
            const second = await call("add_recipe_to_grocery", {
                recipe_id: soup.id,
                member_ids: [ownerId.toUpperCase()],
                store_id: storeId,
            });
            expect(second.structuredContent!.remainder).toEqual(
                first.structuredContent!.remainder,
            );
            const need = (second.structuredContent!.remainder as any[])[0];
            // 50 g is the amount for the whole yield of 2: one portion is 25 g.
            expect(need.need).toEqual({ amount: 25, unit: "g" });
        });

        test("planning for one person sizes the plan from their portions, so what their version leaves out is not missing", async () => {
            const soup = await recipe();
            const set = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "remove",
                ingredient_id: soup.ingredient,
            });
            expect(set.isError).toBeFalsy();
            const planned = await call("plan_recipe", {
                recipe_id: soup.id,
                date: tomorrow(),
                slot: "dinner",
                member_ids: [ownerId],
            });
            expect(planned.isError).toBeFalsy();
            const [plan] = await rows(
                "select servings::float as servings from public.recipe_plans",
            );
            expect(plan!.servings).toBe(1);
            const week = await call("get_week_plan", {});
            expect(week.structuredContent!.missing).toEqual([]);
            const grocery = await call("add_recipe_to_grocery", {
                recipe_id: soup.id,
                member_ids: [ownerId],
                store_id: storeId,
            });
            expect(grocery.isError).toBeFalsy();
            expect(await count("grocery_lines")).toBe(0);
        });

        test("clear_recipe_variant refuses a blank ingredient_id and clears nothing", async () => {
            const soup = await recipe();
            const set = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "remove",
                ingredient_id: soup.ingredient,
            });
            expect(set.isError).toBeFalsy();
            for (const blank of ["", "   "]) {
                const refused = await call("clear_recipe_variant", {
                    recipe_id: soup.id,
                    member_id: ownerId,
                    ingredient_id: blank,
                });
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(
                    "Name the change to clear, or leave ingredient_id out to clear the whole version.",
                );
            }
            expect(await count("recipe_variant_overrides")).toBe(1);
            expect(await actions()).toEqual([]);
        });

        test("two versions of one food in g and kg are netted against the stock once", async () => {
            const soup = await recipe();
            const bee = await seedMember(getCtx().sql, householdId, {
                role: "member",
                displayName: "Bee",
            });
            // Soup yields 2 on 200 g flour: one portion is 100 g. Bee's version
            // writes 0.2 kg for the yield, so her portion is 100 g too: 200 g
            // are needed and 150 g are in stock.
            const set = await callTool(
                { kind: "user", userId: bee, client: "Claude" },
                "legacy",
                "set_recipe_variant",
                {
                    recipe_id: soup.id,
                    member_id: bee,
                    action: "amount",
                    ingredient_id: soup.ingredient,
                    amount: 0.2,
                    unit: "kg",
                },
            );
            expect(set.isError).toBeFalsy();
            await fridgeItem(await food("Flour"), 150);
            const result = await call("add_recipe_to_grocery", {
                recipe_id: soup.id,
                member_ids: [ownerId, bee],
                store_id: storeId,
            });
            expect(result.isError).toBeFalsy();
            const lines = await rows(
                "select amount::float as amount, unit from public.grocery_lines",
            );
            expect(lines).toHaveLength(1);
            expect(lines[0]!.unit).toBe("g");
            expect(lines[0]!.amount).toBeCloseTo(50, 6);
        });
    });

    // ---------- who may delete: household off, own switch, role ----------

    describe("the person's own switch, the household's off and the role", () => {
        type Role = "member" | "admin" | "owner";
        const ROLES: Role[] = ["member", "admin", "owner"];

        async function personFor(role: Role, own: boolean): Promise<Who> {
            const userId =
                role === "owner"
                    ? ownerId
                    : await seedMember(getCtx().sql, householdId, {
                          role,
                          displayName: role,
                      });
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setMemberAgentsCanDelete(
                        householdId,
                        userId,
                        own,
                    ),
                householdId,
            );
            return { kind: "user", userId, client: "Claude" };
        }

        async function setHousehold(allowed: boolean): Promise<void> {
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        allowed,
                    ),
                householdId,
            );
        }

        async function setOwn(who: Who, own: boolean): Promise<void> {
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setMemberAgentsCanDelete(
                        householdId,
                        (who as { userId: string }).userId,
                        own,
                    ),
                householdId,
            );
        }

        const text = (result: Result) =>
            result.content.map((c) => c.text).join("\n");

        for (const role of ROLES) {
            for (const own of [true, false]) {
                for (const householdOn of [true, false]) {
                    const allowed = own && householdOn;
                    test(`${role}, own switch ${own ? "on" : "off"}, household ${householdOn ? "on" : "off"}: ${allowed ? "deletes and records it for them" : "is refused and changes nothing"}`, async () => {
                        const arranged = await scenarios.delete_grocery_line!();
                        const who = await personFor(role, own);
                        await setHousehold(householdOn);
                        const before = await fingerprint();
                        const result = await call(
                            arranged.tool,
                            arranged.args,
                            "legacy",
                            who,
                        );
                        if (allowed) {
                            expect(result.isError).toBeFalsy();
                            expect(text(result)).toContain(UNDO_SENTENCE);
                            const [entry] = await actions();
                            expect(entry).toMatchObject({
                                member_id: (who as { userId: string }).userId,
                                tool: "delete_grocery_line",
                            });
                            // Undo is unchanged: still the owner, within 24 hours.
                            expect((await undo(entry!.id)).status).toBe(
                                "undone",
                            );
                            await arranged.restored();
                        } else {
                            expect(result.isError).toBe(true);
                            // The household's off is the cause named whenever it is Off.
                            expect(text(result)).toContain(
                                householdOn ? PERSON_REFUSAL : REFUSAL,
                            );
                            expect(text(result)).not.toContain(
                                householdOn ? REFUSAL : PERSON_REFUSAL,
                            );
                            expect(await fingerprint()).toBe(before);
                            expect(await actions()).toEqual([]);
                        }
                    });
                }
            }
        }

        test.each(ERAS)(
            "both refusals read the same on both protocol eras (%p)",
            async (era) => {
                const arranged = await scenarios.delete_grocery_line!();
                const bee = await personFor("member", false);
                const person = await call(
                    arranged.tool,
                    arranged.args,
                    era,
                    bee,
                );
                expect(person.isError).toBe(true);
                expect(text(person)).toContain(PERSON_REFUSAL);
                await setHousehold(false);
                const household = await call(
                    arranged.tool,
                    arranged.args,
                    era,
                    bee,
                );
                expect(household.isError).toBe(true);
                expect(text(household)).toContain(REFUSAL);
                expect(await actions()).toEqual([]);
            },
        );

        test("the household token is the owner's agent: the owner's switch, under the household off", async () => {
            const token: Who = { kind: "household", householdId };
            // A member's own switch is off: it is not the token's.
            await personFor("member", false);
            const arranged = await scenarios.delete_grocery_line!();
            // The owner's switch is on (their seeded default): the token deletes,
            // whatever a member's switch says.
            const allowed = await call(
                arranged.tool,
                arranged.args,
                "legacy",
                token,
            );
            expect(allowed.isError).toBeFalsy();
            const [entry] = await actions();
            expect(entry).toMatchObject({
                member_id: null,
                connection: "household token",
            });
            expect((await undo(entry!.id)).status).toBe("undone");

            await personFor("owner", false);
            const refusedOwner = await call(
                arranged.tool,
                arranged.args,
                "legacy",
                token,
            );
            expect(refusedOwner.isError).toBe(true);
            expect(text(refusedOwner)).toContain(PERSON_REFUSAL);

            await personFor("owner", true);
            await setHousehold(false);
            const refusedHousehold = await call(
                arranged.tool,
                arranged.args,
                "legacy",
                token,
            );
            expect(refusedHousehold.isError).toBe(true);
            expect(text(refusedHousehold)).toContain(REFUSAL);
            expect(await count("grocery_lines")).toBe(1);
        });

        test("clear_recipe_variant is refused while the person's own switch is Off, and recorded and undoable once it is On", async () => {
            const bee = await personFor("member", false);
            const beeId = (bee as { userId: string }).userId;
            const soup = await recipe();
            const set = await call(
                "set_recipe_variant",
                {
                    recipe_id: soup.id,
                    member_id: beeId,
                    action: "remove",
                    ingredient_id: soup.ingredient,
                },
                "legacy",
                bee,
            );
            // Changing one's own version is not a deletion: the switch does not stop it.
            expect(set.isError).toBeFalsy();
            const args = { recipe_id: soup.id, member_id: beeId };
            const before = await fingerprint();
            for (const era of ERAS) {
                const refused = await call(
                    "clear_recipe_variant",
                    args,
                    era,
                    bee,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(PERSON_REFUSAL);
            }
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);

            await setOwn(bee, true);
            const done = await call(
                "clear_recipe_variant",
                args,
                "legacy",
                bee,
            );
            expect(done.isError).toBeFalsy();
            expect(text(done)).toContain(UNDO_SENTENCE);
            expect(await count("recipe_variant_overrides")).toBe(0);
            const [entry] = await actions();
            expect(entry).toMatchObject({
                member_id: beeId,
                tool: "clear_recipe_variant",
            });
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await count("recipe_variant_overrides")).toBe(1);
        });

        test("clear_recipe_variant records the rows it deletes: an align landing first is waited for, so undo restores what was there", async () => {
            const soup = await recipe();
            const set = await call("set_recipe_variant", {
                recipe_id: soup.id,
                member_id: ownerId,
                action: "amount",
                ingredient_id: soup.ingredient,
                amount: 50,
                unit: "g",
            });
            expect(set.isError).toBeFalsy();
            const url = getCtx().pg.url;
            const appUrl = new URL(url);
            appUrl.username = "foodable_app";
            const wide = new SQL(url, { prepare: false, max: 4 });
            const wideApp = new SQL(appUrl.toString(), {
                prepare: false,
                max: 4,
            });
            const align = new SQL(url, { prepare: false, max: 1 });
            pairAppSqlForTests(wide, wideApp);
            setSqlForTests(wide);
            try {
                // An align of the recipe is mid-flight: it holds the recipe's
                // align lock and has changed the person's row (the way it
                // replaces one it converts).
                let finish: () => void = () => {};
                const finished = new Promise<void>((r) => (finish = r));
                let started: () => void = () => {};
                const hasChanged = new Promise<void>((r) => (started = r));
                const aligning = align.begin(async (tx) => {
                    await tx`select pg_advisory_xact_lock(hashtextextended(${`recipe-align:${soup.id}`}, 0))`;
                    await tx`update public.recipe_variant_overrides set amount = 70 where recipe_id = ${soup.id}::uuid`;
                    started();
                    await finished;
                });
                await hasChanged;
                const clearing = call("clear_recipe_variant", {
                    recipe_id: soup.id,
                    member_id: ownerId,
                });
                await waitForLockWaiters(getCtx().sql, 1);
                finish();
                await aligning;
                const done = await clearing;
                expect(done.isError).toBeFalsy();
                expect(await count("recipe_variant_overrides")).toBe(0);
                const [entry] = await actions();
                expect((await undo(entry!.id)).status).toBe("undone");
                expect(
                    await rows(
                        "select amount::float as amount from public.recipe_variant_overrides",
                    ),
                ).toEqual([{ amount: 70 }]);
            } finally {
                setSqlForTests(getCtx().sql);
                await align.close();
                await wide.close();
                await wideApp.close();
            }
        });

        test("clear_recipe_variant on an id that is not a recipe says so", async () => {
            const refused = await call("clear_recipe_variant", {
                recipe_id: "not-a-uuid",
                member_id: ownerId,
            });
            expect(refused.isError).toBe(true);
            expect(text(refused)).toContain("Unknown recipe.");
            expect(text(refused)).not.toContain("invalid input syntax");
        });

        test("the bulk tier follows the same switches: clearing and deleting many", async () => {
            const bee = await personFor("member", false);
            const clear = await scenarios.clear_checked_grocery_lines!();
            const before = await fingerprint();
            const refused = await call(clear.tool, clear.args, "legacy", bee);
            expect(refused.isError).toBe(true);
            expect(text(refused)).toContain(PERSON_REFUSAL);
            expect(await fingerprint()).toBe(before);

            await setOwn(bee, true);
            const cleared = await call(clear.tool, clear.args, "legacy", bee);
            expect(cleared.isError).toBeFalsy();
            await clear.changed();
            const [entry] = await actions();
            expect(entry).toMatchObject({
                member_id: (bee as { userId: string }).userId,
                tool: "clear_checked_grocery_lines",
            });
            expect((await undo(entry!.id)).status).toBe("undone");
            await clear.restored();

            // And the household's off stops the bulk delete for the same person.
            await setHousehold(false);
            const lines = await rows("select id from public.grocery_lines");
            const many = await call(
                "delete_grocery_lines",
                { ids: lines.slice(0, 2).map((row) => row.id) },
                "legacy",
                bee,
            );
            expect(many.isError).toBe(true);
            expect(text(many)).toContain(REFUSAL);
            expect(await count("grocery_lines")).toBe(3);
        });

        test("a member's agent is refused an admin-only action even with their switch on; an admin's is allowed", async () => {
            const store = await call("create_store", { name: "Aldi" });
            expect(store.isError).toBeFalsy();
            const storeRow = (
                await rows(
                    "select id from public.grocery_stores where name = 'Aldi'",
                )
            )[0]!.id as string;
            const bee = await personFor("member", true);
            const refused = await call(
                "delete_store",
                { id: storeRow },
                "legacy",
                bee,
            );
            expect(refused.isError).toBe(true);
            expect(text(refused)).toMatch(/owner or an admin/);
            expect(await actions()).toEqual([]);
            expect(
                (
                    await rows(
                        "select id from public.grocery_stores where name = 'Aldi'",
                    )
                ).length,
            ).toBe(1);

            const admin = await personFor("admin", true);
            const done = await call(
                "delete_store",
                { id: storeRow },
                "legacy",
                admin,
            );
            expect(done.isError).toBeFalsy();
            expect(await actions()).toHaveLength(1);
        });

        test("turning a person's switch off does not take back the 24 hour undo of what they did", async () => {
            const arranged = await scenarios.delete_grocery_line!();
            const bee = await personFor("member", true);
            const done = await call(
                arranged.tool,
                arranged.args,
                "legacy",
                bee,
            );
            expect(done.isError).toBeFalsy();
            await setOwn(bee, false);
            await setHousehold(false);
            const [entry] = await actions();
            expect(
                Date.parse(entry!.undo_expires_at) -
                    Date.parse(entry!.created_at),
            ).toBe(24 * 60 * 60 * 1000);
            expect((await undo(entry!.id)).status).toBe("undone");
            await arranged.restored();
        });
    });

    test.each(ERAS)(
        "a destructive call records and answers the same on both protocol eras (%p)",
        async (era) => {
            const arranged = await scenarios.delete_grocery_line!();
            const result = await call(arranged.tool, arranged.args, era);
            expect(result.isError).toBeFalsy();
            expect(result.content[0]!.text).toContain(UNDO_SENTENCE);
            expect(await actions()).toHaveLength(1);
        },
    );

    test("a household token records no member and says so as the connection", async () => {
        const arranged = await scenarios.delete_grocery_line!();
        const result = await call(arranged.tool, arranged.args, "legacy", {
            kind: "household",
            householdId,
        });
        expect(result.isError).toBeFalsy();
        expect(result.content[0]!.text).toContain(UNDO_SENTENCE);
        const [entry] = await actions();
        expect(entry).toMatchObject({
            member_id: null,
            connection: "household token",
            tool: "delete_grocery_line",
        });
        // The owner can undo what the shared token did.
        expect((await undo(entry!.id)).status).toBe("undone");
        await arranged.restored();
    });

    test("an OAuth token without a known app name still records a connection", async () => {
        const arranged = await scenarios.delete_grocery_line!();
        await call(arranged.tool, arranged.args, "legacy", {
            kind: "user",
            userId: ownerId,
        });
        const [entry] = await actions();
        expect(entry!.member_id).toBe(ownerId);
        expect(entry!.connection).toBe("OAuth app");
    });

    test("a call that names nothing records nothing and promises no undo", async () => {
        const result = await call("delete_grocery_line", {
            id: crypto.randomUUID(),
        });
        expect(result.isError).toBeFalsy();
        const text = result.content[0]!.text;
        expect(text).toContain("No grocery line found");
        expect(text).not.toContain("undo");
        expect(await actions()).toEqual([]);
    });

    test("tossing a whole fridge item removes the row and undo brings it back", async () => {
        const eggs = await food("Eggs");
        const id = await fridgeItem(eggs, 10);
        const result = await call("discard_fridge_item", { id });
        expect(result.isError).toBeFalsy();
        expect(result.content[0]!.text).toContain(UNDO_SENTENCE);
        expect(await count("fridge_items")).toBe(0);
        const [entry] = await actions();
        expect((await undo(entry!.id)).status).toBe("undone");
        const [item] = await rows(
            "select id, amount::float as amount from public.fridge_items",
        );
        expect(item).toEqual({ id, amount: 10 });
        expect(await ledgerBalanced(eggs)).toBe(true);
    });

    test("deleting a recipe names what undo will not bring back", async () => {
        const soup = await recipe();
        await getCtx().sql`
            insert into public.recipe_favourites (household_id, user_id, recipe_id)
            values (${householdId}, ${ownerId}, ${soup.id})
        `;
        await call("delete_recipe", { id: soup.id });
        const [entry] = await actions();
        expect(entry!.summary).toBe(
            "Deleted recipe Soup (favourites are not restored by undo)",
        );
    });

    test("a guarded tool that fails leaves no entry behind", async () => {
        const result = await call("unplan_recipe", {
            plan_id: crypto.randomUUID(),
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain("Plan not found");
        expect(await actions()).toEqual([]);
    });

    // ---------- what undo must put back exactly ----------

    async function addMember(): Promise<string> {
        const id = crypto.randomUUID();
        const { sql } = getCtx();
        await sql`insert into public.users (id, email) values (${id}, ${`m-${id}@foodable.test`})`;
        await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${householdId}, ${id}, 'member', 'Bee')
        `;
        return id;
    }

    async function dismiss(
        code: string,
        subjectKind: string,
        subjectId: string,
        relatedKey = "",
    ): Promise<void> {
        await getCtx().sql`
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id, related_key
            )
            values (${householdId}, ${code}, ${subjectKind}, ${subjectId}, ${relatedKey})
        `;
    }

    const dismissals = () =>
        rows(
            "select id, code, subject_kind, subject_id, related_key from public.notice_dismissals order by code",
        );

    for (const [label, who] of [
        ["an OAuth owner", () => owner()],
        ["a household token", (): Who => ({ kind: "household", householdId })],
    ] as const) {
        test(`merging foods records every member's meal items (${label}) and undo puts them back`, async () => {
            const keep = await food("Eggs", true);
            const drop = await food("Egg", true);
            const bee = await addMember();
            // Each person's own agent logs their meal.
            for (const userId of [bee, ownerId]) {
                const logged = await call(
                    "log_meal",
                    {
                        description: "Eggs",
                        meal_type: "breakfast",
                        items: [{ food_id: drop, amount: 100, unit: "g" }],
                    },
                    "legacy",
                    { kind: "user", userId, client: "Claude" },
                );
                expect(logged.isError).toBeFalsy();
            }
            const before = await rows(
                "select id, food_id from public.meal_items order by id",
            );
            expect(before.map((row) => row.food_id)).toEqual([drop, drop]);

            const merged = await call(
                "merge_foods",
                { keep_id: keep, drop_id: drop },
                "legacy",
                who(),
            );
            expect(merged.isError).toBeFalsy();
            const mid = await rows("select food_id from public.meal_items");
            expect(mid.map((row) => row.food_id)).toEqual([keep, keep]);

            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(
                await rows(
                    "select id, food_id from public.meal_items order by id",
                ),
            ).toEqual(before);
        });
    }

    for (const tool of ["delete_fridge_item", "discard_fridge_item"] as const) {
        test(`${tool} records what points at the item, so undo links it back`, async () => {
            const eggs = await food("Eggs", true);
            const id = await fridgeItem(eggs, 300);
            const line = await groceryLine(eggs);
            await getCtx()
                .sql`update public.grocery_lines set source_fridge_item_id = ${id} where id = ${line}`;
            const movements = await rows(
                "select id, fridge_item_id from public.stock_movements order by id",
            );
            expect(movements.length).toBeGreaterThan(0);
            expect(movements.every((m) => m.fridge_item_id === id)).toBe(true);

            const result = await call(tool, { id });
            expect(result.isError).toBeFalsy();
            expect(await count("fridge_items")).toBe(0);
            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");

            expect(
                await rows(
                    "select id, fridge_item_id from public.stock_movements where id = any($1::uuid[]) order by id",
                    `{${movements.map((m) => m.id).join(",")}}`,
                ),
            ).toEqual(movements);
            expect(
                await rows(
                    "select id, source_fridge_item_id from public.grocery_lines",
                ),
            ).toEqual([{ id: line, source_fridge_item_id: id }]);
            expect(await ledgerBalanced(eggs)).toBe(true);
        });
    }

    const dismissalScenarios: Record<
        string,
        () => Promise<{ tool: string; args: Record<string, unknown> }>
    > = {
        delete_recipe: async () => {
            const soup = await recipe();
            await dismiss("x", "recipe", soup.id);
            await dismiss("y", "recipe_ingredient", soup.ingredient);
            return { tool: "delete_recipe", args: { id: soup.id } };
        },
        remove_recipe_ingredient: async () => {
            const soup = await recipe();
            await dismiss("y", "recipe_ingredient", soup.ingredient);
            return {
                tool: "remove_recipe_ingredient",
                args: { recipe_id: soup.id, ingredient_id: soup.ingredient },
            };
        },
        delete_grocery_line: async () => {
            const line = await groceryLine(await food("Eggs"));
            await dismiss("y", "grocery_line", line);
            return { tool: "delete_grocery_line", args: { id: line } };
        },
        clear_checked_grocery_lines: async () => {
            const line = await groceryLine(await food("Eggs"));
            await call("check_grocery_line", { id: line, checked: true });
            await dismiss("y", "grocery_line", line);
            return { tool: "clear_checked_grocery_lines", args: {} };
        },
        delete_fridge_item: async () => {
            const item = await fridgeItem(await food("Eggs", true), 10);
            await dismiss("z", "fridge_item", item);
            return { tool: "delete_fridge_item", args: { id: item } };
        },
        discard_fridge_item: async () => {
            const item = await fridgeItem(await food("Eggs", true), 10);
            await dismiss("z", "fridge_item", item);
            return { tool: "discard_fridge_item", args: { id: item } };
        },
        delete_fridge_location: async () => {
            const item = await fridgeItem(await food("Eggs", true), 10);
            await dismiss("z", "fridge_item", item);
            return {
                tool: "delete_fridge_location",
                args: { id: locationId },
            };
        },
        merge_foods: async () => {
            const keep = await food("Eggs");
            const drop = await food("Egg");
            await dismiss("a", "food", drop);
            await dismiss("b", "food", keep, drop);
            return {
                tool: "merge_foods",
                args: { keep_id: keep, drop_id: drop },
            };
        },
    };

    for (const [name, arrange] of Object.entries(dismissalScenarios)) {
        test(`${name} records the dismissed notices it clears, so undo brings them back`, async () => {
            const { tool, args } = await arrange();
            const before = await dismissals();
            expect(before.length).toBeGreaterThan(0);
            const result = await call(tool, args);
            expect(result.isError).toBeFalsy();
            expect((await dismissals()).length).toBeLessThan(before.length);
            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await dismissals()).toEqual(before);
        });
    }

    test("merging foods records the dislikes that name the dropped food, and every table the merge repoints", async () => {
        const keep = await food("Eggs", true);
        const drop = await food("Egg", true);
        const bee = await addMember();
        const { sql } = getCtx();
        const [dislike] = await sql`
            insert into public.member_dislikes (household_id, user_id, display_name, food_id)
            values (${householdId}, ${bee}, 'Egg', ${drop})
            returning id
        `;
        await fridgeItem(drop, 100);
        await groceryLine(drop);
        const soup = await recipe();
        await sql`update public.recipe_ingredients set food_id = ${drop} where id = ${soup.ingredient}`;
        const logged = await call("log_meal", {
            description: "Eggs",
            meal_type: "breakfast",
            items: [{ food_id: drop, amount: 100, unit: "g" }],
        });
        expect(logged.isError).toBeFalsy();

        // The tables mergeFoods repoints: REF_TABLES in src/db/foods.ts (not
        // exported). Add a table there and it belongs here, with a row seeded
        // above, or this test no longer covers what the merge changes.
        const repointed = [
            "fridge_items",
            "grocery_lines",
            "recipe_ingredients",
            "member_dislikes",
            "stock_movements",
            "meal_items",
        ];
        expect(
            (await call("merge_foods", { keep_id: keep, drop_id: drop }))
                .isError,
        ).toBeFalsy();
        const [entry] = await actions();
        const recorded = new Set(
            (entry!.snapshot.changes as { table: string; op: string }[])
                .filter((change) => change.op === "updated")
                .map((change) => change.table),
        );
        for (const table of repointed) expect(recorded).toContain(table);

        expect((await undo(entry!.id)).status).toBe("undone");
        expect(
            await rows(
                "select food_id from public.member_dislikes where id = $1",
                dislike!.id,
            ),
        ).toEqual([{ food_id: drop }]);
    });

    test("merging two foods one person added to a recipe folds them into one row, and undo brings both back", async () => {
        const keep = await food("Peas", true);
        const drop = await food("Green peas", true);
        const soup = await recipe();
        const { sql } = getCtx();
        for (const [foodId, name, amount, unit] of [
            [keep, "Peas", 40, "g"],
            [drop, "Green peas", 0.06, "kg"],
        ] as const) {
            await sql`
                insert into public.recipe_variant_overrides (
                    household_id, recipe_id, user_id, action, food_id, display_name, amount, unit
                )
                values (${householdId}, ${soup.id}, ${ownerId}, 'add', ${foodId}, ${name}, ${amount}, ${unit})
            `;
        }
        const before = await fingerprint();
        const merged = await call("merge_foods", {
            keep_id: keep,
            drop_id: drop,
        });
        expect(merged.isError).toBeFalsy();
        expect(
            await rows(
                "select food_id, amount::float as amount, unit from public.recipe_variant_overrides",
            ),
        ).toEqual([{ food_id: keep, amount: 100, unit: "g" }]);
        const [entry] = await actions();
        expect((await undo(entry!.id)).status).toBe("undone");
        expect(await fingerprint()).toBe(before);
    });

    test("clearing the checked lines deletes exactly the lines it recorded", async () => {
        const first = await groceryLine(await food("Eggs"));
        const second = await groceryLine(await food("Milk"));
        await call("check_grocery_line", { id: first, checked: true });
        // A second line is checked after the call read the first.
        const real = groceryDb.liveGroceryStore;
        let injected = false;
        const spy = spyOn(groceryDb, "liveGroceryStore").mockImplementation(
            () => {
                const store = real();
                return {
                    ...store,
                    async listLines(hh: string) {
                        const lines = await store.listLines(hh);
                        if (!injected) {
                            injected = true;
                            await getCtx()
                                .sql`update public.grocery_lines set checked = true where id = ${second}`;
                        }
                        return lines;
                    },
                };
            },
        );
        try {
            const result = await call("clear_checked_grocery_lines");
            expect(result.isError).toBeFalsy();
        } finally {
            spy.mockRestore();
        }
        expect(
            (await rows("select id from public.grocery_lines")).map(
                (r) => r.id,
            ),
        ).toEqual([second]);
        const [entry] = await actions();
        expect(entry!.summary).toContain("Cleared 1 checked grocery line");
    });
    // ---------- undo never puts back what has moved on since ----------

    const actionFor = async (tool: string) =>
        (await actions()).find((entry) => entry.tool === tool)!;

    test("undoing a merge refuses once someone ate from the repointed item, and changes nothing", async () => {
        const keep = await food("Eggs", true);
        const drop = await food("Egg", true);
        const item = await fridgeItem(drop, 300);
        const merged = await call("merge_foods", {
            keep_id: keep,
            drop_id: drop,
        });
        expect(merged.isError).toBeFalsy();
        const ate = await call("eat_fridge_item", { id: item, amount: 100 });
        expect(ate.isError).toBeFalsy();
        expect(await ledgerBalanced(keep)).toBe(true);

        const entry = await actionFor("merge_foods");
        const before = await fingerprint();
        const out = await undo(entry.id);
        expect(out.status).toBe("conflict");
        expect(out.message).toContain("was used since");
        // Nothing moved: the item and its movements stay on the kept food,
        // and the entry can still be undone once it is possible.
        expect(await fingerprint()).toBe(before);
        expect(await ledgerBalanced(keep)).toBe(true);
        expect((await actionFor("merge_foods")).undone_at).toBeNull();
    });

    test("undoing a merge still works when nothing touched the item since", async () => {
        const keep = await food("Eggs", true);
        const drop = await food("Egg", true);
        const item = await fridgeItem(drop, 300);
        await call("merge_foods", { keep_id: keep, drop_id: drop });
        const out = await undo((await actionFor("merge_foods")).id);
        expect(out.status).toBe("undone");
        expect(
            (
                await rows(
                    "select food_id from public.fridge_items where id = $1",
                    item,
                )
            )[0]!.food_id,
        ).toBe(drop);
        expect(await ledgerBalanced(keep)).toBe(true);
        expect(await ledgerBalanced(drop)).toBe(true);
    });

    test("undoing a merge refuses once a person changed the alias it added", async () => {
        const keep = await food("Eggs");
        const drop = await food("Egg");
        const other = await food("Hen eggs");
        await call("merge_foods", { keep_id: keep, drop_id: drop });
        const [alias] = await rows(
            "select alias from public.food_aliases where food_id = $1",
            keep,
        );
        expect(alias).toBeDefined();
        await getCtx().sql`
            update public.food_aliases set food_id = ${other}
            where alias = ${alias!.alias}
        `;
        const before = await fingerprint();
        const out = await undo((await actionFor("merge_foods")).id);
        expect(out.status).toBe("conflict");
        expect(out.message).toContain("was changed since");
        expect(await fingerprint()).toBe(before);
        expect(
            (
                await rows(
                    "select food_id from public.food_aliases where alias = $1",
                    alias!.alias,
                )
            )[0]!.food_id,
        ).toBe(other);
    });

    describe("a row is not put back onto a food merged away since", () => {
        const MERGED = "merged, archived or deleted since";

        async function mergeAway(drop: string): Promise<void> {
            const keep = await food(`Kept ${drop.slice(0, 4)}`);
            const merged = await call("merge_foods", {
                keep_id: keep,
                drop_id: drop,
            });
            expect(merged.isError).toBeFalsy();
        }

        test("a grocery line", async () => {
            const eggs = await food("Egg");
            const line = await groceryLine(eggs);
            await call("delete_grocery_line", { id: line });
            await mergeAway(eggs);
            const out = await undo((await actionFor("delete_grocery_line")).id);
            expect(out.status).toBe("conflict");
            expect(out.message).toContain(MERGED);
            expect(await count("grocery_lines")).toBe(0);
            expect(
                (await actionFor("delete_grocery_line")).undone_at,
            ).toBeNull();
        });

        test("a recipe ingredient", async () => {
            const soup = await recipe();
            const [ingredient] = await rows(
                "select food_id from public.recipe_ingredients where id = $1",
                soup.ingredient,
            );
            await call("remove_recipe_ingredient", {
                recipe_id: soup.id,
                ingredient_id: soup.ingredient,
            });
            await mergeAway(ingredient!.food_id);
            const out = await undo(
                (await actionFor("remove_recipe_ingredient")).id,
            );
            expect(out.status).toBe("conflict");
            expect(out.message).toContain(MERGED);
            expect(await count("recipe_ingredients")).toBe(0);
        });

        test("a meal item", async () => {
            const oats = await food("Oats", true);
            const logged = await call("log_meal", {
                description: "Porridge",
                meal_type: "breakfast",
                items: [{ food_id: oats, amount: 100, unit: "g" }],
            });
            expect(logged.isError).toBeFalsy();
            const [meal] = await rows("select id from public.meals");
            await call("delete_meal", { id: meal!.id });
            await mergeAway(oats);
            const out = await undo((await actionFor("delete_meal")).id);
            expect(out.status).toBe("conflict");
            expect(out.message).toContain(MERGED);
            // The meal and its item stay gone together.
            expect(await count("meals")).toBe(0);
            expect(await count("meal_items")).toBe(0);
        });
    });

    describe("a food archived before the action does not block the put-back", () => {
        // Archiving a food in Settings leaves the rows that name it alone, so
        // what was deleted pointed at an archived food all along: putting it
        // back is exact, and refusing would lose it for good.
        async function archive(id: string): Promise<void> {
            await asUser(
                ownerId,
                () =>
                    updateFood(liveFoodsStore(), householdId, id, {
                        archived: true,
                    }),
                householdId,
            );
        }

        test("a grocery line", async () => {
            const eggs = await food("Egg");
            const line = await groceryLine(eggs);
            await archive(eggs);
            expect(await count("grocery_lines")).toBe(1);
            const before = await fingerprint();
            const deleted = await call("delete_grocery_line", { id: line });
            expect(deleted.isError).toBeFalsy();
            expect(await count("grocery_lines")).toBe(0);
            const out = await undo((await actionFor("delete_grocery_line")).id);
            expect(out.status).toBe("undone");
            expect(await fingerprint()).toBe(before);
        });

        test("a recipe and its ingredient", async () => {
            const soup = await recipe();
            const [ingredient] = await rows(
                "select food_id from public.recipe_ingredients where id = $1",
                soup.ingredient,
            );
            await archive(ingredient!.food_id);
            const before = await fingerprint();
            const deleted = await call("delete_recipe", { id: soup.id });
            expect(deleted.isError).toBeFalsy();
            expect(await count("recipes")).toBe(0);
            const out = await undo((await actionFor("delete_recipe")).id);
            expect(out.status).toBe("undone");
            expect(await count("recipes")).toBe(1);
            expect(await count("recipe_ingredients")).toBe(1);
            expect(await fingerprint()).toBe(before);
        });
    });

    // ---------- per-day goal overrides ----------

    test("clearing per-day goals is refused while destructive changes are off, and keeps the rows", async () => {
        await goalDays(["2099-01-01", "2099-01-02"]);
        await asUser(
            ownerId,
            () =>
                liveSettingsStore().setAgentDestructiveAllowed(
                    householdId,
                    false,
                ),
            householdId,
        );
        const result = await call("set_nutrition_goals", {
            from: "2099-01-01",
            to: "2099-01-02",
            clear: true,
        });
        expect(result.isError).toBe(true);
        expect(result.content.map((c) => c.text).join("\n")).toContain(REFUSAL);
        expect(await count("nutrition_goal_days")).toBe(2);
        expect(await actions()).toEqual([]);
    });

    test("emptying a day's last goal removes its override, which is recorded and undone too", async () => {
        const [day] = await goalDays(["2099-01-01"]);
        // Drop one target: the override still has the other, and the change
        // is already recorded, since a person's target went.
        const kept = await call("set_nutrition_goals", {
            date: "2099-01-01",
            daily_protein_g: null,
        });
        expect(kept.isError).toBeFalsy();
        expect(kept.content[0]!.text).toContain(UNDO_SENTENCE);
        expect(await count("nutrition_goal_days")).toBe(1);
        expect(await actions()).toHaveLength(1);

        const emptied = await call("set_nutrition_goals", {
            date: "2099-01-01",
            daily_calories: null,
        });
        expect(emptied.isError).toBeFalsy();
        expect(emptied.content[0]!.text).toContain(UNDO_SENTENCE);
        expect(await count("nutrition_goal_days")).toBe(0);
        const entry = (await actions()).find((one) =>
            one.summary.includes("removed"),
        )!;
        expect((await undo(entry.id)).status).toBe("undone");
        expect(
            await rows(
                "select id, daily_calories, daily_protein_g from public.nutrition_goal_days",
            ),
        ).toEqual([
            {
                id: day!.id,
                daily_calories: 2400,
                daily_protein_g: null,
            },
        ]);
    });

    test("emptying a day's last goal is refused while destructive changes are off", async () => {
        await goalDays(["2099-01-01"]);
        await call("set_nutrition_goals", {
            date: "2099-01-01",
            daily_protein_g: null,
        });
        await asUser(
            ownerId,
            () =>
                liveSettingsStore().setAgentDestructiveAllowed(
                    householdId,
                    false,
                ),
            householdId,
        );
        const result = await call("set_nutrition_goals", {
            date: "2099-01-01",
            daily_calories: null,
        });
        expect(result.isError).toBe(true);
        expect(await count("nutrition_goal_days")).toBe(1);
    });

    test("nulling a target over a range records every override it changes, so undo puts the whole call back", async () => {
        const { sql } = getCtx();
        // One override holds only calories (nulling it empties the day), one
        // holds calories and protein (nulling calories only rewrites it), and
        // the third day has none.
        await sql`
            insert into public.nutrition_goal_days (
                household_id, user_id, date, daily_calories
            )
            values (${householdId}, ${ownerId}, '2099-01-01'::date, ${2000})
        `;
        await sql`
            insert into public.nutrition_goal_days (
                household_id, user_id, date, daily_calories, daily_protein_g
            )
            values (${householdId}, ${ownerId}, '2099-01-02'::date, ${2200}, ${150})
        `;
        const days = () =>
            rows(
                "select id, date::text as date, daily_calories, daily_protein_g::float as daily_protein_g from public.nutrition_goal_days order by date",
            );
        const before = await days();

        const cleared = await call("set_nutrition_goals", {
            from: "2099-01-01",
            to: "2099-01-03",
            daily_calories: null,
        });
        expect(cleared.isError).toBeFalsy();
        expect(cleared.content[0]!.text).toContain(UNDO_SENTENCE);
        expect(await days()).toEqual([
            {
                id: before[1]!.id,
                date: "2099-01-02",
                daily_calories: null,
                daily_protein_g: 150,
            },
        ]);

        const entry = await actionFor("set_nutrition_goals");
        expect((await undo(entry.id)).status).toBe("undone");
        expect(await days()).toEqual(before);
    });

    test("an override the null leaves untouched is not recorded, so removing it later does not block the undo", async () => {
        const { sql } = getCtx();
        await sql`
            insert into public.nutrition_goal_days (
                household_id, user_id, date, daily_calories
            )
            values (${householdId}, ${ownerId}, '2099-01-01'::date, ${2000})
        `;
        await sql`
            insert into public.nutrition_goal_days (
                household_id, user_id, date, daily_protein_g
            )
            values (${householdId}, ${ownerId}, '2099-01-02'::date, ${150})
        `;
        const cleared = await call("set_nutrition_goals", {
            from: "2099-01-01",
            to: "2099-01-03",
            daily_calories: null,
        });
        expect(cleared.isError).toBeFalsy();
        const entry = await actionFor("set_nutrition_goals");
        expect(entry.summary).not.toContain("rewrote");
        // A person removes the override the call never changed.
        await sql`delete from public.nutrition_goal_days where date = '2099-01-02'::date`;
        expect((await undo(entry.id)).status).toBe("undone");
        const back = await rows(
            "select date::text as date, daily_calories from public.nutrition_goal_days order by date",
        );
        expect(back).toEqual([{ date: "2099-01-01", daily_calories: 2000 }]);
    });

    describe("an agent deletes only the entries of the person it acts for", () => {
        const OTHER_PERSON =
            "An agent can only add, change or delete the entries of the person it acts for. " +
            "Nothing was changed. Ask Bea to do it, or their agent.";
        const text = (result: Result) =>
            result.content.map((c) => c.text).join("\n");

        test("with its own switch On, A's agent cannot delete B's meal, water, weight or goals, but can delete A's", async () => {
            const { sql } = getCtx();
            const a = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            const b = await seedMember(sql, householdId, {
                agentsCanDelete: false,
                displayName: "Bea",
            });
            const asA: Who = { kind: "user", userId: a, client: "Claude" };
            const asB: Who = { kind: "user", userId: b, client: "Claude" };

            // B's own agent logs B's entries.
            const logged = await call(
                "log_meal",
                {
                    description: "Bea's dinner",
                    calories: 500,
                    meal_type: "dinner",
                },
                "legacy",
                asB,
            );
            expect(logged.isError).toBeFalsy();
            await call("log_water", { amount_ml: 250 }, "legacy", asB);
            await call("log_weight", { weight: 70, unit: "kg" }, "legacy", asB);
            await sql`
                insert into public.nutrition_goal_days (
                    household_id, user_id, date, daily_calories
                )
                values (${householdId}, ${b}, '2099-01-01'::date, ${2000})
            `;
            const [meal] = await rows(
                "select id from public.meals where user_id = $1",
                b,
            );
            const [water] = await rows(
                "select id from public.water_log where user_id = $1",
                b,
            );
            const [weight] = await rows(
                "select id from public.weight_log where user_id = $1",
                b,
            );
            expect(meal && water && weight).toBeTruthy();
            const before = await fingerprint();

            for (const era of ERAS) {
                for (const [tool, args] of [
                    ["delete_meal", { id: meal!.id, target_member: b }],
                    ["delete_water", { id: water!.id, target_member: b }],
                    ["delete_weight", { id: weight!.id, target_member: b }],
                    [
                        "set_nutrition_goals",
                        { date: "2099-01-01", clear: true, target_member: b },
                    ],
                ] as const) {
                    const refused = await call(tool, args, era, asA);
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(OTHER_PERSON);
                }
            }
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);

            // The household token acts as the owner, so it is bound the same way.
            const token: Who = { kind: "household", householdId };
            const viaToken = await call(
                "delete_meal",
                { id: meal!.id, user_id: b },
                "legacy",
                token,
            );
            expect(viaToken.isError).toBe(true);
            expect(text(viaToken)).toContain(OTHER_PERSON);
            expect(await fingerprint()).toBe(before);

            // A's own entries still go, through the same guard.
            await call("log_water", { amount_ml: 100 }, "legacy", asA);
            const [mine] = await rows(
                "select id from public.water_log where user_id = $1",
                a,
            );
            const own = await call(
                "delete_water",
                { id: mine!.id },
                "legacy",
                asA,
            );
            expect(own.isError).toBeFalsy();
            expect(await count("water_log")).toBe(1);
            expect((await actions()).length).toBe(1);

            // And naming oneself as the target is not another person.
            await call("log_water", { amount_ml: 100 }, "legacy", asA);
            const [again] = await rows(
                "select id from public.water_log where user_id = $1",
                a,
            );
            const self = await call(
                "delete_water",
                { id: again!.id, target_member: a },
                "legacy",
                asA,
            );
            expect(self.isError).toBeFalsy();
        });

        test("an id in upper case is the same person: own deletes work, another person's are still refused", async () => {
            const { sql } = getCtx();
            const a = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            const b = await seedMember(sql, householdId, {
                agentsCanDelete: false,
                displayName: "Bea",
            });
            const asA: Who = { kind: "user", userId: a, client: "Claude" };
            await call("log_water", { amount_ml: 100 }, "legacy", asA);
            await call("log_water", { amount_ml: 120 }, "legacy", {
                kind: "user",
                userId: b,
                client: "Claude",
            });
            const [own] = await rows(
                "select id from public.water_log where user_id = $1",
                a,
            );
            const [theirs] = await rows(
                "select id from public.water_log where user_id = $1",
                b,
            );
            const refused = await call(
                "delete_water",
                { id: theirs!.id, target_member: b.toUpperCase() },
                "legacy",
                asA,
            );
            expect(refused.isError).toBe(true);
            expect(text(refused)).toContain(OTHER_PERSON);
            expect(await count("water_log")).toBe(2);

            const deleted = await call(
                "delete_water",
                { id: own!.id, target_member: a.toUpperCase() },
                "legacy",
                asA,
            );
            expect(deleted.isError).toBeFalsy();
            expect(await count("water_log")).toBe(1);
            expect((await actions()).length).toBe(1);
        });

        test("an own id in another uuid spelling is still the same person", async () => {
            const { sql } = getCtx();
            const a = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            const b = await seedMember(sql, householdId, {
                agentsCanDelete: false,
                displayName: "Bea",
            });
            const asA: Who = { kind: "user", userId: a, client: "Claude" };
            for (const spelling of [`{${a}}`, a.replaceAll("-", "")]) {
                const own = await call(
                    "log_water",
                    { amount_ml: 100, target_member: spelling },
                    "legacy",
                    asA,
                );
                expect([spelling, own.isError ?? false]).toEqual([
                    spelling,
                    false,
                ]);
            }
            const refused = await call(
                "log_water",
                { amount_ml: 100, target_member: `{${b}}` },
                "legacy",
                asA,
            );
            expect(refused.isError).toBe(true);
            expect(
                (
                    await rows(
                        "select id from public.water_log where user_id = $1",
                        b,
                    )
                ).length,
            ).toBe(0);
        });

        test("calls in one JSON-RPC batch cannot change whose entries a delete is checked against", async () => {
            const { sql } = getCtx();
            const a = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            const b = await seedMember(sql, householdId, {
                agentsCanDelete: false,
                displayName: "Bea",
            });
            const asA: Who = { kind: "user", userId: a, client: "Claude" };
            const asB: Who = { kind: "user", userId: b, client: "Claude" };

            for (let round = 0; round < 6; round++) {
                for (const ml of [200, 300, 400, 500]) {
                    await call("log_water", { amount_ml: ml }, "legacy", asB);
                }
                const bWater = await rows(
                    "select id from public.water_log where user_id = $1",
                    b,
                );
                expect(bWater.length).toBe(4);

                // B's entries are named for deletion alongside writes that name
                // A: a write is not a delete, and it must not make the delete
                // next to it look like one of A's own.
                const results = await callBatch(asA, [
                    ...bWater.map((row, i) => ({
                        id: 100 + i,
                        name: "delete_water",
                        args: { id: row.id, target_member: b },
                    })),
                    ...[0, 1, 2].map((i) => ({
                        id: 10 + i,
                        name: "log_water",
                        args: { amount_ml: 10 + i, target_member: a },
                    })),
                ]);
                for (let i = 0; i < bWater.length; i++) {
                    const refused = results.get(100 + i)!;
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(OTHER_PERSON);
                }
                for (const id of [10, 11, 12]) {
                    expect(results.get(id)!.isError).toBeFalsy();
                }
                // Not one of B's entries went, and nothing was recorded.
                expect(
                    (
                        await rows(
                            "select id from public.water_log where user_id = $1",
                            b,
                        )
                    ).length,
                ).toBe(4);
                expect(await actions()).toEqual([]);

                await sql`delete from public.water_log`;
            }
        });

        test("in a batch, A's own delete still goes while the delete of B's entry beside it is refused", async () => {
            const { sql } = getCtx();
            const a = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            const b = await seedMember(sql, householdId, {
                agentsCanDelete: false,
                displayName: "Bea",
            });
            const asA: Who = { kind: "user", userId: a, client: "Claude" };
            const asB: Who = { kind: "user", userId: b, client: "Claude" };
            await call("log_water", { amount_ml: 100 }, "legacy", asA);
            await call("log_water", { amount_ml: 250 }, "legacy", asB);
            const [mine] = await rows(
                "select id from public.water_log where user_id = $1",
                a,
            );
            const [theirs] = await rows(
                "select id from public.water_log where user_id = $1",
                b,
            );
            const results = await callBatch(asA, [
                {
                    id: 1,
                    name: "delete_water",
                    args: { id: theirs!.id, target_member: b },
                },
                { id: 2, name: "delete_water", args: { id: mine!.id } },
                {
                    id: 3,
                    name: "log_water",
                    args: { amount_ml: 25, target_member: b },
                },
            ]);
            expect(results.get(1)!.isError).toBe(true);
            expect(text(results.get(1)!)).toContain(OTHER_PERSON);
            expect(results.get(2)!.isError).toBeFalsy();
            // Adding to B's water is refused as well.
            expect(results.get(3)!.isError).toBe(true);
            expect(text(results.get(3)!)).toContain(OTHER_PERSON);
            expect(
                (
                    await rows(
                        "select id from public.water_log where user_id = $1 order by logged_at",
                        b,
                    )
                ).length,
            ).toBe(1);
            expect(await count("water_log")).toBe(1);
            const recorded = await actions();
            expect(recorded.length).toBe(1);
            expect(recorded[0]!.member_id).toBe(a);
        });

        // ---------- clearing goals ----------

        describe("clearing a goal target", () => {
            const GOALS = {
                daily_calories: 2000,
                daily_protein_g: 120,
            };
            const goalRow = async (user: string) =>
                (
                    await rows(
                        "select daily_calories, daily_protein_g::float as daily_protein_g, daily_fat_g::float as daily_fat_g from public.nutrition_goals where user_id = $1",
                        user,
                    )
                )[0];
            const dayRows = (user: string) =>
                rows(
                    "select date::text as date, daily_calories, daily_protein_g::float as daily_protein_g, daily_fat_g::float as daily_fat_g from public.nutrition_goal_days where user_id = $1 order by date",
                    user,
                );
            let a: string;
            let b: string;
            let asA: Who;
            let asB: Who;
            beforeEach(async () => {
                const { sql } = getCtx();
                a = await seedMember(sql, householdId, {
                    agentsCanDelete: true,
                    displayName: "Ann",
                });
                b = await seedMember(sql, householdId, {
                    agentsCanDelete: false,
                    displayName: "Bea",
                });
                asA = { kind: "user", userId: a, client: "Claude" };
                asB = { kind: "user", userId: b, client: "Claude" };
            });

            test("A's agent cannot clear B's default goals, whoever's switch is On", async () => {
                await call("set_nutrition_goals", GOALS, "legacy", asB);
                const before = await goalRow(b);
                expect(before).toMatchObject(GOALS);
                const fingerprinted = await fingerprint();
                for (const era of ERAS) {
                    const refused = await call(
                        "set_nutrition_goals",
                        {
                            daily_calories: null,
                            daily_protein_g: null,
                            target_member: b,
                        },
                        era,
                        asA,
                    );
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(OTHER_PERSON);
                }
                expect(await goalRow(b)).toEqual(before);
                expect(await fingerprint()).toBe(fingerprinted);
                expect(await actions()).toEqual([]);
                // The household token acts as the owner, so it is bound too.
                const viaToken = await call(
                    "set_nutrition_goals",
                    { daily_calories: null, user_id: b },
                    "legacy",
                    { kind: "household", householdId },
                );
                expect(viaToken.isError).toBe(true);
                expect(text(viaToken)).toContain(OTHER_PERSON);
                expect(await goalRow(b)).toEqual(before);
            });

            test("A's agent cannot null one of B's day targets either", async () => {
                const { sql } = getCtx();
                await sql`
                    insert into public.nutrition_goal_days (
                        household_id, user_id, date, daily_calories, daily_protein_g
                    )
                    values (${householdId}, ${b}, '2099-01-01'::date, ${2000}, ${150})
                `;
                const before = await dayRows(b);
                const refused = await call(
                    "set_nutrition_goals",
                    {
                        date: "2099-01-01",
                        daily_protein_g: null,
                        target_member: b,
                    },
                    "legacy",
                    asA,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(OTHER_PERSON);
                expect(await dayRows(b)).toEqual(before);
                expect(await actions()).toEqual([]);
            });

            test("with the person's own switch Off, their agent cannot clear their own goals", async () => {
                await call("set_nutrition_goals", GOALS, "legacy", asB);
                const before = await goalRow(b);
                const refused = await call(
                    "set_nutrition_goals",
                    { daily_calories: null },
                    "legacy",
                    asB,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(PERSON_REFUSAL);
                expect(await goalRow(b)).toEqual(before);
                expect(await actions()).toEqual([]);

                // The same goes for a target on a day.
                const { sql } = getCtx();
                await sql`
                    insert into public.nutrition_goal_days (
                        household_id, user_id, date, daily_calories, daily_protein_g
                    )
                    values (${householdId}, ${b}, '2099-01-01'::date, ${2000}, ${150})
                `;
                const days = await dayRows(b);
                const dayRefused = await call(
                    "set_nutrition_goals",
                    { date: "2099-01-01", daily_protein_g: null },
                    "legacy",
                    asB,
                );
                expect(dayRefused.isError).toBe(true);
                expect(text(dayRefused)).toContain(PERSON_REFUSAL);
                expect(await dayRows(b)).toEqual(days);
                expect(await actions()).toEqual([]);

                // Nor can it clear the target weight.
                await call(
                    "set_nutrition_goals",
                    { target_weight: 70, unit: "kg" },
                    "legacy",
                    asB,
                );
                const weightRefused = await call(
                    "set_nutrition_goals",
                    { target_weight: null },
                    "legacy",
                    asB,
                );
                expect(weightRefused.isError).toBe(true);
                expect(text(weightRefused)).toContain(PERSON_REFUSAL);
                const [{ n }] = (await rows(
                    "select count(*)::int as n from public.nutrition_goals where user_id = $1 and target_weight_g is not null",
                    b,
                )) as [{ n: number }];
                expect(n).toBe(1);
            });

            test("clearing a stored goal name or note is a delete: refused with the switch Off, and across people", async () => {
                const labelled = {
                    ...GOALS,
                    goal_name: "Recomp",
                    goal_note: "my note",
                };
                const labels = async (user: string) =>
                    (
                        await rows(
                            "select goal_name, goal_note from public.nutrition_goals where user_id = $1",
                            user,
                        )
                    )[0];
                await call("set_nutrition_goals", labelled, "legacy", asB);
                const before = await labels(b);
                expect(before).toEqual({
                    goal_name: "Recomp",
                    goal_note: "my note",
                });
                for (const args of [
                    { goal_name: null },
                    { goal_note: null },
                    { goal_name: "   " },
                    { goal_note: "" },
                ]) {
                    // B's own switch is Off.
                    const own = await call(
                        "set_nutrition_goals",
                        args,
                        "legacy",
                        asB,
                    );
                    expect(own.isError).toBe(true);
                    expect(text(own)).toContain(PERSON_REFUSAL);
                    // A's switch is On, but these are B's goals.
                    const other = await call(
                        "set_nutrition_goals",
                        { ...args, target_member: b },
                        "legacy",
                        asA,
                    );
                    expect(other.isError).toBe(true);
                    expect(text(other)).toContain(OTHER_PERSON);
                }
                expect(await labels(b)).toEqual(before);
                expect(await actions()).toEqual([]);
            });

            test("with the switch On, A's agent clears A's own name and note: recorded, and undo restores them", async () => {
                await call(
                    "set_nutrition_goals",
                    { ...GOALS, goal_name: "Recomp", goal_note: "my note" },
                    "legacy",
                    asA,
                );
                const labels = async () =>
                    (
                        await rows(
                            "select goal_name, goal_note from public.nutrition_goals where user_id = $1",
                            a,
                        )
                    )[0];
                const cleared = await call(
                    "set_nutrition_goals",
                    { goal_name: null, goal_note: "  " },
                    "legacy",
                    asA,
                );
                expect(cleared.isError).toBeFalsy();
                expect(text(cleared)).toContain(UNDO_SENTENCE);
                expect(await labels()).toEqual({
                    goal_name: null,
                    goal_note: null,
                });
                const [entry] = await actions();
                expect(entry!.summary).toContain(
                    "Cleared goal_name, goal_note from the default goals",
                );
                const out = await undoAgentAction(liveAgentActionDeps(), {
                    householdId,
                    userId: ownerId,
                    actionId: entry!.id,
                    now: new Date(),
                });
                expect(out.status).toBe("undone");
                expect(await labels()).toEqual({
                    goal_name: "Recomp",
                    goal_note: "my note",
                });
            });

            test("setting or renaming a goal name, or clearing one that was never set, stays an ordinary write", async () => {
                // B's switch is Off.
                const named = await call(
                    "set_nutrition_goals",
                    { ...GOALS, goal_name: "Cut" },
                    "legacy",
                    asB,
                );
                expect(named.isError).toBeFalsy();
                const renamed = await call(
                    "set_nutrition_goals",
                    { goal_name: "Bulk", goal_note: null },
                    "legacy",
                    asB,
                );
                expect(renamed.isError).toBeFalsy();
                expect(text(renamed)).not.toContain(UNDO_SENTENCE);
                expect(await actions()).toEqual([]);
            });

            test("with the switch On, A's agent clears A's own default goals: recorded, and undo puts them back", async () => {
                await call("set_nutrition_goals", GOALS, "legacy", asA);
                const before = await goalRow(a);
                const cleared = await call(
                    "set_nutrition_goals",
                    { daily_calories: null, daily_protein_g: null },
                    "legacy",
                    asA,
                );
                expect(cleared.isError).toBeFalsy();
                expect(text(cleared)).toContain(UNDO_SENTENCE);
                expect(await goalRow(a)).toMatchObject({
                    daily_calories: null,
                    daily_protein_g: null,
                });
                const [entry] = await actions();
                expect(entry).toMatchObject({
                    tool: "set_nutrition_goals",
                    member_id: a,
                    destructive: true,
                    undoable: true,
                });
                expect(entry!.summary).toContain(
                    "Cleared daily_calories, daily_protein_g from the default goals",
                );
                expect(entry!.snapshot).not.toBeNull();
                const out = await undoAgentAction(liveAgentActionDeps(), {
                    householdId,
                    userId: ownerId,
                    actionId: entry!.id,
                    now: new Date(),
                });
                expect(out.status).toBe("undone");
                expect(await goalRow(a)).toEqual(before);
            });

            test("setting a value, or clearing a target that was never set, stays an ordinary write", async () => {
                // A's agent may set A's goals, and not B's.
                const refused = await call(
                    "set_nutrition_goals",
                    { ...GOALS, target_member: b },
                    "legacy",
                    asA,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(OTHER_PERSON);
                expect(await goalRow(b)).toBeUndefined();
                const set = await call(
                    "set_nutrition_goals",
                    GOALS,
                    "legacy",
                    asB,
                );
                expect(set.isError).toBeFalsy();
                expect(text(set)).not.toContain(UNDO_SENTENCE);
                expect(await goalRow(b)).toMatchObject(GOALS);
                // B's switch is Off, and B's own agent may still change a value
                // and null a target that has none.
                const nothing = await call(
                    "set_nutrition_goals",
                    { daily_calories: 2200, daily_fat_g: null },
                    "legacy",
                    asB,
                );
                expect(nothing.isError).toBeFalsy();
                expect(await goalRow(b)).toMatchObject({
                    daily_calories: 2200,
                    daily_fat_g: null,
                });
                expect(await actions()).toEqual([]);
            });

            test("a day write that nulls one target and sets another undoes whole, removing what it added", async () => {
                const { sql } = getCtx();
                await sql`
                    insert into public.nutrition_goal_days (
                        household_id, user_id, date, daily_calories, daily_protein_g
                    )
                    values (${householdId}, ${a}, '2099-01-01'::date, ${2000}, ${150})
                `;
                const before = await dayRows(a);
                const wrote = await call(
                    "set_nutrition_goals",
                    {
                        from: "2099-01-01",
                        to: "2099-01-02",
                        daily_protein_g: null,
                        daily_fat_g: 70,
                    },
                    "legacy",
                    asA,
                );
                expect(wrote.isError).toBeFalsy();
                expect(text(wrote)).toContain(UNDO_SENTENCE);
                expect(await dayRows(a)).toEqual([
                    {
                        date: "2099-01-01",
                        daily_calories: 2000,
                        daily_protein_g: null,
                        daily_fat_g: 70,
                    },
                    {
                        date: "2099-01-02",
                        daily_calories: null,
                        daily_protein_g: null,
                        daily_fat_g: 70,
                    },
                ]);
                const [entry] = await actions();
                const out = await undoAgentAction(liveAgentActionDeps(), {
                    householdId,
                    userId: ownerId,
                    actionId: entry!.id,
                    now: new Date(),
                });
                expect(out.status).toBe("undone");
                expect(await dayRows(a)).toEqual(before);
            });
        });
    });

    describe("an agent adds and changes only the entries of the person it acts for", () => {
        const refusalFor = (name: string) =>
            "An agent can only add, change or delete the entries of the person it acts for. " +
            `Nothing was changed. Ask ${name} to do it, or their agent.`;
        const OTHER_PERSON = refusalFor("Bea");
        const SHARED_CONNECTION =
            "On the household's shared connection that person is the household owner.";
        const text = (result: Result) =>
            result.content.map((c) => c.text).join("\n");

        let a: string;
        let b: string;
        let asA: Extract<Who, { kind: "user" }>;
        let asB: Extract<Who, { kind: "user" }>;
        let token: Who;
        beforeEach(async () => {
            const { sql } = getCtx();
            a = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            b = await seedMember(sql, householdId, {
                agentsCanDelete: true,
                displayName: "Bea",
            });
            asA = { kind: "user", userId: a, client: "Claude" };
            asB = { kind: "user", userId: b, client: "Claude" };
            token = { kind: "household", householdId };
        });

        /** B's own entries, written by B's own agent. */
        async function seedBea() {
            await call(
                "log_meal",
                {
                    description: "Bea's lunch",
                    calories: 400,
                    meal_type: "lunch",
                },
                "legacy",
                asB,
            );
            await call("log_water", { amount_ml: 250 }, "legacy", asB);
            await call("log_weight", { weight: 70, unit: "kg" }, "legacy", asB);
            await call(
                "set_nutrition_goals",
                { daily_calories: 2000 },
                "legacy",
                asB,
            );
            const [meal] = await rows(
                "select id from public.meals where user_id = $1",
                b,
            );
            const [water] = await rows(
                "select id from public.water_log where user_id = $1",
                b,
            );
            const [weight] = await rows(
                "select id from public.weight_log where user_id = $1",
                b,
            );
            expect(meal && water && weight).toBeTruthy();
            return {
                meal: meal!.id as string,
                water: water!.id as string,
                weight: weight!.id as string,
            };
        }

        /** Every person-scoped nutrition write, aimed at `person` with `field`. */
        function writesAimedAt(
            ids: { meal: string; water: string; weight: string },
            aim: Record<string, string>,
        ): [string, Record<string, unknown>][] {
            return [
                [
                    "log_meal",
                    {
                        description: "Dinner",
                        calories: 600,
                        meal_type: "dinner",
                        ...aim,
                    },
                ],
                ["update_meal", { id: ids.meal, calories: 999, ...aim }],
                ["delete_meal", { id: ids.meal, ...aim }],
                ["log_water", { amount_ml: 100, ...aim }],
                ["delete_water", { id: ids.water, ...aim }],
                ["log_weight", { weight: 80, unit: "kg", ...aim }],
                [
                    "update_weight",
                    { id: ids.weight, weight: 75, unit: "kg", ...aim },
                ],
                ["delete_weight", { id: ids.weight, ...aim }],
                ["set_nutrition_goals", { daily_calories: 1500, ...aim }],
                [
                    "bulk_import_meals",
                    {
                        meals: [
                            {
                                source_line: 1,
                                logged_at: "2026-01-02",
                                meal_type: "lunch",
                                calories: 300,
                            },
                        ],
                        expected_row_count: 1,
                        ...aim,
                    },
                ],
                [
                    "log_recipe_portion",
                    {
                        recipe_id: crypto.randomUUID(),
                        portions: 1,
                        ...aim,
                    },
                ],
            ];
        }

        test("A's agent cannot add, change or delete B's meals, water, weight or goals, in either era", async () => {
            const ids = await seedBea();
            const before = await fingerprint();
            for (const era of ERAS) {
                for (const [tool, args] of writesAimedAt(ids, {
                    target_member: b,
                })) {
                    const refused = await call(tool, args, era, asA);
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(OTHER_PERSON);
                    expect(text(refused)).not.toContain(SHARED_CONNECTION);
                    expect(await fingerprint()).toBe(before);
                }
            }
            expect(await actions()).toEqual([]);
        });

        test("naming B by user_id is no way round it, and a stranger is not a household member", async () => {
            const ids = await seedBea();
            const before = await fingerprint();
            for (const era of ERAS) {
                for (const [tool, args] of writesAimedAt(ids, {
                    user_id: b,
                })) {
                    const refused = await call(tool, args, era, asA);
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(
                        "user_id must match the signed-in user",
                    );
                }
                for (const [tool, args] of writesAimedAt(ids, {
                    target_member: crypto.randomUUID(),
                })) {
                    const refused = await call(tool, args, era, asA);
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain("not a household member");
                }
            }
            expect(await fingerprint()).toBe(before);
        });

        test("A's own writes work, with no target, with user_id, and naming A in any letter case", async () => {
            for (const era of ERAS) {
                for (const aim of [
                    {},
                    { user_id: a },
                    { target_member: a },
                    { target_member: a.toUpperCase() },
                    { user_id: a, target_member: a },
                ]) {
                    const water = await call(
                        "log_water",
                        { amount_ml: 100, ...aim },
                        era,
                        asA,
                    );
                    expect(water.isError).toBeFalsy();
                    const meal = await call(
                        "log_meal",
                        {
                            description: "Toast",
                            calories: 200,
                            meal_type: "breakfast",
                            ...aim,
                        },
                        era,
                        asA,
                    );
                    expect(meal.isError).toBeFalsy();
                }
            }
            expect(
                (
                    await rows(
                        "select id from public.water_log where user_id = $1",
                        a,
                    )
                ).length,
            ).toBe(10);
            expect(
                (
                    await rows(
                        "select id from public.meals where user_id = $1",
                        a,
                    )
                ).length,
            ).toBe(10);
            expect(await count("water_log")).toBe(10);
            const [mine] = await rows(
                "select id from public.water_log where user_id = $1",
                a,
            );
            const changed = await call(
                "update_meal",
                {
                    id: (
                        await rows(
                            "select id from public.meals where user_id = $1",
                            a,
                        )
                    )[0]!.id,
                    calories: 250,
                    target_member: a.toUpperCase(),
                },
                "legacy",
                asA,
            );
            expect(changed.isError).toBeFalsy();
            expect(
                (
                    await call(
                        "set_nutrition_goals",
                        { daily_calories: 1800, target_member: a },
                        "legacy",
                        asA,
                    )
                ).isError,
            ).toBeFalsy();
            const gone = await call(
                "delete_water",
                { id: mine!.id, target_member: a },
                "legacy",
                asA,
            );
            expect(gone.isError).toBeFalsy();
        });

        test("the household token acts as the owner: another member's entries are refused, the owner's work", async () => {
            const ids = await seedBea();
            const before = await fingerprint();
            for (const era of ERAS) {
                // The token names a member with user_id, and may add the same
                // one as target_member.
                for (const aim of [
                    { user_id: b },
                    { user_id: b, target_member: b },
                ] as Record<string, string>[]) {
                    for (const [tool, args] of writesAimedAt(ids, aim)) {
                        const refused = await call(tool, args, era, token);
                        expect(refused.isError).toBe(true);
                        expect(text(refused)).toContain(OTHER_PERSON);
                        expect(text(refused)).toContain(SHARED_CONNECTION);
                        expect(await fingerprint()).toBe(before);
                    }
                }
                // The token still has to say whose entries it writes.
                const nobody = await call(
                    "log_water",
                    { amount_ml: 100 },
                    era,
                    token,
                );
                expect(nobody.isError).toBe(true);
                expect(text(nobody)).toContain("user_id");
            }
            expect(await fingerprint()).toBe(before);

            for (const era of ERAS) {
                for (const aim of [
                    { user_id: ownerId },
                    { user_id: ownerId, target_member: ownerId },
                    { user_id: ownerId.toUpperCase() },
                ]) {
                    const logged = await call(
                        "log_water",
                        { amount_ml: 100, ...aim },
                        era,
                        token,
                    );
                    expect(logged.isError).toBeFalsy();
                }
            }
            expect(
                (
                    await rows(
                        "select id from public.water_log where user_id = $1",
                        ownerId,
                    )
                ).length,
            ).toBe(6);
            expect(
                (
                    await rows(
                        "select id from public.water_log where user_id = $1",
                        b,
                    )
                ).length,
            ).toBe(1);
        });

        test("in one JSON-RPC batch, A's own write goes and the write for B beside it is refused", async () => {
            await seedBea();
            for (let round = 0; round < 4; round++) {
                const before = (
                    await rows(
                        "select id from public.water_log where user_id = $1",
                        b,
                    )
                ).length;
                const results = await callBatch(asA, [
                    ...[0, 1, 2].map((i) => ({
                        id: 10 + i,
                        name: "log_water",
                        args: { amount_ml: 10 + i, target_member: b },
                    })),
                    ...[0, 1, 2].map((i) => ({
                        id: 20 + i,
                        name: "log_water",
                        args: { amount_ml: 20 + i, target_member: a },
                    })),
                    {
                        id: 30,
                        name: "log_meal",
                        args: {
                            description: "Sneaked in",
                            calories: 1,
                            meal_type: "snack",
                            target_member: b,
                        },
                    },
                ]);
                for (const id of [10, 11, 12, 30]) {
                    expect(results.get(id)!.isError).toBe(true);
                    expect(text(results.get(id)!)).toContain(OTHER_PERSON);
                }
                for (const id of [20, 21, 22]) {
                    expect(results.get(id)!.isError).toBeFalsy();
                }
                expect(
                    (
                        await rows(
                            "select id from public.water_log where user_id = $1",
                            b,
                        )
                    ).length,
                ).toBe(before);
                expect(
                    (
                        await rows(
                            "select id from public.meals where user_id = $1",
                            b,
                        )
                    ).length,
                ).toBe(1);
            }
            expect(
                (
                    await rows(
                        "select id from public.water_log where user_id = $1",
                        a,
                    )
                ).length,
            ).toBe(12);
        });

        test("goals: B's standing and per-day goals are not A's to set, and A's own are", async () => {
            await seedBea();
            const { sql } = getCtx();
            await sql`
                insert into public.nutrition_goal_days (
                    household_id, user_id, date, daily_calories
                )
                values (${householdId}, ${b}, '2099-01-01'::date, ${2000})
            `;
            const before = await fingerprint();
            for (const era of ERAS) {
                for (const args of [
                    { daily_calories: 1800, target_member: b },
                    { target_weight: 60, unit: "kg", target_member: b },
                    { goal_name: "Mine now", target_member: b },
                    { date: "2099-01-01", daily_calories: 1, target_member: b },
                    {
                        from: "2099-01-01",
                        to: "2099-01-03",
                        daily_protein_g: 90,
                        target_member: b,
                    },
                ]) {
                    const refused = await call(
                        "set_nutrition_goals",
                        args,
                        era,
                        asA,
                    );
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(OTHER_PERSON);
                }
            }
            expect(await fingerprint()).toBe(before);
            const own = await call(
                "set_nutrition_goals",
                { date: "2099-01-01", daily_calories: 1700 },
                "legacy",
                asA,
            );
            expect(own.isError).toBeFalsy();
            expect(await fingerprint()).not.toBe(before);
        });

        test("personal settings are the acting person's alone: timezone, weight unit, widgets and alcohol tracking", async () => {
            const profiles = () =>
                rows(
                    "select user_id, timezone, preferred_weight_unit, widgets_enabled, alcohol_tracking_enabled, preferred_drink_unit from public.profiles order by user_id",
                );
            const settingsFor = (aim: Record<string, string>) =>
                [
                    ["set_timezone", { timezone: "Europe/Kyiv", ...aim }],
                    ["set_weight_unit", { unit: "lb", ...aim }],
                    ["set_widget_display", { enabled: false, ...aim }],
                    [
                        "set_alcohol_tracking",
                        { enabled: true, drink_unit: "uk", ...aim },
                    ],
                ] as [string, Record<string, unknown>][];
            // B's own agent sets B's settings.
            for (const [tool, args] of [
                ["set_timezone", { timezone: "America/Chicago" }],
                ["set_weight_unit", { unit: "kg" }],
                ["set_widget_display", { enabled: true }],
                ["set_alcohol_tracking", { enabled: false, drink_unit: "us" }],
            ] as [string, Record<string, unknown>][]) {
                const set = await call(tool, args, "legacy", asB);
                expect(set.isError).toBeFalsy();
            }
            const before = await profiles();
            expect(before.find((row) => row.user_id === b)).toMatchObject({
                timezone: "America/Chicago",
                preferred_weight_unit: "kg",
                widgets_enabled: true,
                alcohol_tracking_enabled: false,
            });

            for (const era of ERAS) {
                // The household token acts as the owner: it may not set a
                // member's settings, whichever member it names.
                for (const aim of [{ user_id: a }, { user_id: b }]) {
                    for (const [tool, args] of settingsFor(aim)) {
                        const refused = await call(tool, args, era, token);
                        expect(refused.isError).toBe(true);
                        expect(text(refused)).toContain(
                            "An agent can only add, change or delete the entries of the person it acts for.",
                        );
                        expect(text(refused)).toContain(SHARED_CONNECTION);
                        expect(await profiles()).toEqual(before);
                    }
                }
                // A user token naming another member was already refused.
                for (const [tool, args] of settingsFor({ user_id: b })) {
                    const refused = await call(tool, args, era, asA);
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(
                        "user_id must match the signed-in user",
                    );
                    expect(await profiles()).toEqual(before);
                }
            }

            // A's own settings, with and without naming A.
            for (const aim of [{}, { user_id: a }] as Record<
                string,
                string
            >[]) {
                for (const [tool, args] of settingsFor(aim)) {
                    const set = await call(tool, args, "legacy", asA);
                    expect(set.isError).toBeFalsy();
                }
            }
            // And the owner's, through the household token.
            for (const [tool, args] of settingsFor({ user_id: ownerId })) {
                const set = await call(tool, args, "legacy", token);
                expect(set.isError).toBeFalsy();
            }
            const after = await profiles();
            expect(after.find((row) => row.user_id === b)).toEqual(
                before.find((row) => row.user_id === b),
            );
            for (const user of [a, ownerId]) {
                expect(after.find((row) => row.user_id === user)).toMatchObject(
                    {
                        timezone: "Europe/Kyiv",
                        preferred_weight_unit: "lb",
                        widgets_enabled: false,
                        alcohol_tracking_enabled: true,
                        preferred_drink_unit: "uk",
                    },
                );
            }
        });

        describe("person rules follow the app: your own, or anyone's as an owner or admin", () => {
            const MINE_ONLY = "You can only edit your own rules.";
            const ruleCounts = async () =>
                (
                    await Promise.all(
                        [
                            "person_rules",
                            "member_allergens",
                            "member_dislikes",
                        ].map(count),
                    )
                ).join(",");
            const rulesFor = (userId: string) => ({
                person: [
                    {
                        user_id: userId,
                        rules: ["Quiet after nine"],
                        allergens: [{ allergen: "peanut" }],
                        dislikes: ["Olives"],
                    },
                ],
            });

            test("a member's agent edits their own, and is refused another member's with nothing written", async () => {
                const own = await call(
                    "set_household_rules",
                    rulesFor(a),
                    "legacy",
                    asA,
                );
                expect(own.isError).toBeFalsy();
                expect(await ruleCounts()).toBe("1,1,1");
                const before = await ruleCounts();
                for (const era of ERAS) {
                    // The refused row comes second: the call writes nothing.
                    const refused = await call(
                        "set_household_rules",
                        {
                            person: [
                                ...rulesFor(a).person,
                                ...rulesFor(b).person,
                            ],
                        },
                        era,
                        asA,
                    );
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(MINE_ONLY);
                    expect(await ruleCounts()).toBe(before);
                }
                expect(
                    await rows(
                        "select 1 from public.member_allergens where user_id = $1",
                        b,
                    ),
                ).toHaveLength(0);
            });

            test("an admin's agent edits another member's, and the household token edits as the owner", async () => {
                const { sql } = getCtx();
                const admin = await seedMember(sql, householdId, {
                    role: "admin",
                    displayName: "Cy",
                });
                const asAdmin: Who = {
                    kind: "user",
                    userId: admin,
                    client: "Claude",
                };
                const byAdmin = await call(
                    "set_household_rules",
                    rulesFor(b),
                    "legacy",
                    asAdmin,
                );
                expect(byAdmin.isError).toBeFalsy();
                expect(await ruleCounts()).toBe("1,1,1");
                const byToken = await call(
                    "set_household_rules",
                    rulesFor(a),
                    "legacy",
                    token,
                );
                expect(byToken.isError).toBeFalsy();
                expect(await ruleCounts()).toBe("2,2,2");
            });

            test("store rules need an owner or admin, as in the app", async () => {
                const body = {
                    store_rules: [{ store_id: storeId, body: "x" }],
                };
                const refused = await call(
                    "set_household_rules",
                    body,
                    "legacy",
                    asA,
                );
                expect(refused.isError).toBe(true);
                expect(await count("store_rules")).toBe(0);
                const done = await call("set_household_rules", body);
                expect(done.isError).toBeFalsy();
                expect(await count("store_rules")).toBe(1);
            });

            test("start_meal_import on the household token refuses another member up front", async () => {
                const refused = await call(
                    "start_meal_import",
                    { user_id: b },
                    "legacy",
                    token,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(OTHER_PERSON);
                const own = await call(
                    "start_meal_import",
                    { user_id: ownerId },
                    "legacy",
                    token,
                );
                expect(own.isError).toBeFalsy();
            });
        });

        describe("the fridge and the recipes", () => {
            let oats: string;
            let fridgeId: string;
            let recipeId: string;
            beforeEach(async () => {
                oats = await food("Oats", true);
                fridgeId = await fridgeItem(oats, 500);
                const made = await call("create_recipe", {
                    name: "Porridge",
                    yield_portions: 2,
                });
                recipeId = made.structuredContent!.id as string;
                const added = await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: oats,
                    amount: 200,
                    unit: "g",
                });
                expect(added.isError).toBeFalsy();
            });

            const fridgeAmount = async () =>
                Number(
                    (
                        await rows(
                            "select amount::float as amount from public.fridge_items where id = $1",
                            fridgeId,
                        )
                    )[0]!.amount,
                );
            const mealsOf = async (user: string) =>
                (
                    await rows(
                        "select id from public.meals where user_id = $1",
                        user,
                    )
                ).length;

            test("eat_fridge_item logs only for the person the agent acts for", async () => {
                const before = await fingerprint();
                for (const era of ERAS) {
                    const refused = await call(
                        "eat_fridge_item",
                        { id: fridgeId, amount: 50, member_id: b },
                        era,
                        asA,
                    );
                    expect(refused.isError).toBe(true);
                    expect(text(refused)).toContain(OTHER_PERSON);
                    const viaToken = await call(
                        "eat_fridge_item",
                        { id: fridgeId, amount: 50, member_id: b },
                        era,
                        token,
                    );
                    expect(viaToken.isError).toBe(true);
                    expect(text(viaToken)).toContain(OTHER_PERSON);
                }
                // Nothing deducted, no movement, no meal for anyone.
                expect(await fingerprint()).toBe(before);
                expect(await fridgeAmount()).toBe(500);

                for (const memberId of [undefined, a, a.toUpperCase()]) {
                    const ate = await call(
                        "eat_fridge_item",
                        {
                            id: fridgeId,
                            amount: 50,
                            ...(memberId ? { member_id: memberId } : {}),
                        },
                        "legacy",
                        asA,
                    );
                    expect(ate.isError).toBeFalsy();
                }
                expect(await fridgeAmount()).toBe(350);
                expect(await mealsOf(a)).toBe(3);
                expect(await mealsOf(b)).toBe(0);

                const ownerAte = await call(
                    "eat_fridge_item",
                    { id: fridgeId, amount: 50, member_id: ownerId },
                    "legacy",
                    token,
                );
                expect(ownerAte.isError).toBeFalsy();
                expect(await mealsOf(ownerId)).toBe(1);
                expect(await mealsOf(b)).toBe(0);
            });

            test("set_recipe_portion sets only the portion of the person the agent acts for", async () => {
                const before = await fingerprint();
                for (const era of ERAS) {
                    for (const who of [asA, token]) {
                        const refused = await call(
                            "set_recipe_portion",
                            {
                                recipe_id: recipeId,
                                member_id: b,
                                portion_count: 3,
                            },
                            era,
                            who,
                        );
                        expect(refused.isError).toBe(true);
                        expect(text(refused)).toContain(OTHER_PERSON);
                    }
                }
                expect(await fingerprint()).toBe(before);
                expect(await count("recipe_portions")).toBe(0);

                for (const memberId of [a, a.toUpperCase()]) {
                    const own = await call(
                        "set_recipe_portion",
                        {
                            recipe_id: recipeId,
                            member_id: memberId,
                            portion_count: 2,
                        },
                        "legacy",
                        asA,
                    );
                    expect(own.isError).toBeFalsy();
                }
                const viaToken = await call(
                    "set_recipe_portion",
                    {
                        recipe_id: recipeId,
                        member_id: ownerId,
                        portion_count: 1,
                    },
                    "legacy",
                    token,
                );
                expect(viaToken.isError).toBeFalsy();
                const stored = await rows(
                    "select user_id, portion_count::float as portion_count from public.recipe_portions order by portion_count",
                );
                expect(stored).toEqual([
                    { user_id: ownerId, portion_count: 1 },
                    { user_id: a, portion_count: 2 },
                ]);
            });

            test("set_recipe_variant and clear_recipe_variant touch only the version of the person the agent acts for", async () => {
                const [line] = await rows(
                    "select id from public.recipe_ingredients where recipe_id = $1",
                    recipeId,
                );
                const ingredient = line!.id as string;
                // Bea's own version, made by her own agent.
                const bea = await call(
                    "set_recipe_variant",
                    {
                        recipe_id: recipeId,
                        member_id: b,
                        action: "remove",
                        ingredient_id: ingredient,
                    },
                    "legacy",
                    asB,
                );
                expect(bea.isError).toBeFalsy();
                const before = await fingerprint();
                for (const era of ERAS) {
                    for (const who of [asA, token]) {
                        for (const [tool, args] of [
                            [
                                "set_recipe_variant",
                                {
                                    recipe_id: recipeId,
                                    member_id: b,
                                    action: "remove",
                                    ingredient_id: ingredient,
                                },
                            ],
                            [
                                "clear_recipe_variant",
                                { recipe_id: recipeId, member_id: b },
                            ],
                        ] as const) {
                            const refused = await call(tool, args, era, who);
                            expect(refused.isError).toBe(true);
                            expect(text(refused)).toContain(OTHER_PERSON);
                        }
                    }
                }
                expect(await fingerprint()).toBe(before);
                expect(await actions()).toEqual([]);

                // Ann's own: set, then clear, which leaves Bea's alone.
                const own = await call(
                    "set_recipe_variant",
                    {
                        recipe_id: recipeId,
                        member_id: a,
                        action: "amount",
                        ingredient_id: ingredient,
                        amount: 20,
                        unit: "g",
                    },
                    "legacy",
                    asA,
                );
                expect(own.isError).toBeFalsy();
                expect(await count("recipe_variant_overrides")).toBe(2);
                const cleared = await call(
                    "clear_recipe_variant",
                    { recipe_id: recipeId, member_id: a },
                    "legacy",
                    asA,
                );
                expect(cleared.isError).toBeFalsy();
                expect(text(cleared)).toContain(UNDO_SENTENCE);
                expect(
                    (
                        await rows(
                            "select user_id from public.recipe_variant_overrides",
                        )
                    ).map((row) => row.user_id),
                ).toEqual([b]);
                const [entry] = await actions();
                expect(entry).toMatchObject({
                    member_id: a,
                    tool: "clear_recipe_variant",
                });
                expect((await undo(entry!.id)).status).toBe("undone");
                expect(await count("recipe_variant_overrides")).toBe(2);
            });

            test("a cook sizes the stock by every listed member's version and logs only the acting person's meal", async () => {
                const [line] = await rows(
                    "select id from public.recipe_ingredients where recipe_id = $1",
                    recipeId,
                );
                const ingredient = line!.id as string;
                // Yield 2, 200 g of oats: Ann halves hers, Bea doubles hers.
                for (const [who, member, amount] of [
                    [asA, a, 100],
                    [asB, b, 400],
                ] as const) {
                    const set = await call(
                        "set_recipe_variant",
                        {
                            recipe_id: recipeId,
                            member_id: member,
                            action: "amount",
                            ingredient_id: ingredient,
                            amount,
                            unit: "g",
                        },
                        "legacy",
                        who,
                    );
                    expect(set.isError).toBeFalsy();
                }
                for (const era of ERAS) {
                    const sized = await call(
                        "cook_recipe",
                        {
                            recipe_id: recipeId,
                            portions_by_member: [
                                { user_id: a, portions: 1 },
                                { user_id: b, portions: 1 },
                            ],
                            log_meals: false,
                        },
                        era,
                        asA,
                    );
                    expect(sized.isError).toBeFalsy();
                    // Of 200 g's yield 2: 100 g halved for Ann, 400 g halved for Bea.
                    expect(await fridgeAmount()).toBe(500 - 50 - 200);
                    await getCtx().sql`
                        update public.fridge_items set amount = 500 where id = ${fridgeId}
                    `;
                }
                expect(await mealsOf(a)).toBe(0);
                expect(await mealsOf(b)).toBe(0);

                const cooked = await call(
                    "cook_recipe",
                    {
                        recipe_id: recipeId,
                        portions_by_member: [{ user_id: a, portions: 1 }],
                        total_portions: 2,
                    },
                    "legacy",
                    asA,
                );
                expect(cooked.isError).toBeFalsy();
                // Ann's portion from her version (50 g), the other at the base (100 g).
                expect(await fridgeAmount()).toBe(350);
                expect(await mealsOf(a)).toBe(1);
                expect(await mealsOf(b)).toBe(0);
                const [meal] = await rows(
                    "select calories::float as calories from public.meals where user_id = $1",
                    a,
                );
                // 100 kcal per 100 g of oats: half of Ann's 100 g batch is 50 g.
                expect(meal!.calories).toBe(50);
            });

            test("cook_recipe logs a meal only for the person the agent acts for, and cooks nothing otherwise", async () => {
                const before = await fingerprint();
                for (const era of ERAS) {
                    for (const portions_by_member of [
                        [{ user_id: b, portions: 1 }],
                        [
                            { user_id: a, portions: 1 },
                            { user_id: b, portions: 1 },
                        ],
                    ]) {
                        const refused = await call(
                            "cook_recipe",
                            { recipe_id: recipeId, portions_by_member },
                            era,
                            asA,
                        );
                        expect(refused.isError).toBe(true);
                        expect(text(refused)).toContain(OTHER_PERSON);
                    }
                    const viaToken = await call(
                        "cook_recipe",
                        {
                            recipe_id: recipeId,
                            portions_by_member: [
                                { user_id: ownerId, portions: 1 },
                                { user_id: a, portions: 1 },
                            ],
                        },
                        era,
                        token,
                    );
                    expect(viaToken.isError).toBe(true);
                    expect(text(viaToken)).toContain(refusalFor("Ann"));
                }
                // Nothing cooked, nothing logged, not even A's own meal.
                expect(await fingerprint()).toBe(before);
                expect(await fridgeAmount()).toBe(500);

                const cooked = await call(
                    "cook_recipe",
                    {
                        recipe_id: recipeId,
                        portions_by_member: [{ user_id: a, portions: 1 }],
                    },
                    "legacy",
                    asA,
                );
                expect(cooked.isError).toBeFalsy();
                expect(await fridgeAmount()).toBe(400);
                expect(await mealsOf(a)).toBe(1);
                expect(await mealsOf(b)).toBe(0);

                // Cooking with nobody eating yet is not logging for anyone.
                const ahead = await call(
                    "cook_recipe",
                    { recipe_id: recipeId, total_portions: 1 },
                    "legacy",
                    asA,
                );
                expect(ahead.isError).toBeFalsy();
                expect(await fridgeAmount()).toBe(300);

                // B's portion only sizes the batch when no meal is logged for B.
                const sized = await call(
                    "cook_recipe",
                    {
                        recipe_id: recipeId,
                        portions_by_member: [{ user_id: b, portions: 1 }],
                        log_meals: false,
                    },
                    "legacy",
                    asA,
                );
                expect(sized.isError).toBeFalsy();
                expect(await fridgeAmount()).toBe(200);
                expect(await mealsOf(b)).toBe(0);

                const stranger = await call(
                    "cook_recipe",
                    {
                        recipe_id: recipeId,
                        portions_by_member: [
                            { user_id: crypto.randomUUID(), portions: 1 },
                        ],
                    },
                    "legacy",
                    asA,
                );
                expect(stranger.isError).toBe(true);
                expect(text(stranger)).toContain("not a household member");
                expect(await fridgeAmount()).toBe(200);

                const ownerCooked = await call(
                    "cook_recipe",
                    {
                        recipe_id: recipeId,
                        portions_by_member: [{ user_id: ownerId, portions: 1 }],
                    },
                    "legacy",
                    token,
                );
                expect(ownerCooked.isError).toBeFalsy();
                expect(await mealsOf(ownerId)).toBe(1);
                expect(await fridgeAmount()).toBe(100);
            });

            test("reads are not limited: A's agent still reads B's entries and sizes a grocery list from B's portion", async () => {
                const ids = await seedBea();
                for (const era of ERAS) {
                    const meals = await call(
                        "get_meals",
                        { user_id: b },
                        era,
                        asA,
                    );
                    expect(meals.isError).toBeFalsy();
                    expect(text(meals)).toContain("Bea's lunch");
                    const water = await call(
                        "get_water",
                        { user_id: b },
                        era,
                        asA,
                    );
                    expect(water.isError).toBeFalsy();
                    const viaToken = await call(
                        "get_meals",
                        { user_id: b },
                        era,
                        token,
                    );
                    expect(viaToken.isError).toBeFalsy();
                }
                expect(ids.meal).toBeTruthy();
                await call(
                    "set_recipe_portion",
                    { recipe_id: recipeId, member_id: b, portion_count: 1 },
                    "legacy",
                    asB,
                );
                const grocery = await call(
                    "add_recipe_to_grocery",
                    {
                        recipe_id: recipeId,
                        store_id: storeId,
                        member_ids: [b],
                    },
                    "legacy",
                    asA,
                );
                expect(grocery.isError).toBeFalsy();
            });
        });
    });
    // ---------- notifications: dismiss_notice for everyone ----------

    describe("dismiss_notice for everyone goes through the guard", () => {
        const text = (result: Result) =>
            result.content.map((c) => c.text).join("\n");

        type Inbox = {
            count: number;
            notifications: {
                id: string;
                kind: string;
                message: string;
                can_dismiss_for_everyone: boolean;
            }[];
        };

        async function inboxOf(who: Who): Promise<Inbox> {
            const out = await call("list_notices", {}, "legacy", who);
            expect(out.isError).toBeFalsy();
            return out.structuredContent as Inbox;
        }

        const as = (userId: string): Who => ({
            kind: "user",
            userId,
            client: "Claude",
        });

        /** A second person, in the household with the role and own switch given. */
        async function person(
            role: "member" | "admin",
            agentsCanDelete = true,
        ): Promise<string> {
            return seedMember(getCtx().sql, householdId, {
                role,
                displayName: role,
                agentsCanDelete,
            });
        }

        /** A fridge item that expires in three days: a Food expiring condition. */
        async function expiringItem(name = "Kefir"): Promise<string> {
            const id = await fridgeItem(await food(name), 100);
            await getCtx().sql`
                update public.fridge_items
                set expires_on = current_date + 3
                where id = ${id}
            `;
            return id;
        }

        /** An event row for each person, as a recipe removal writes them. */
        async function recipeRemoved(
            recipients: string[],
            actor: string | null,
        ): Promise<string[]> {
            const key = `event:${crypto.randomUUID()}`;
            const ids: string[] = [];
            for (const recipient of recipients) {
                const [row] = await getCtx().sql`
                    insert into public.notifications (
                        household_id, recipient_user_id, kind, bucket, source,
                        notice_key, subject_kind, subject_id, actor_user_id,
                        payload
                    )
                    values (
                        ${householdId}, ${recipient}, 'recipe_changes',
                        'household', 'event', ${key}, 'recipe',
                        ${crypto.randomUUID()}, ${actor},
                        ${JSON.stringify({ recipeName: "Beef chili" })}::jsonb
                    )
                    returning id
                `;
                ids.push(row!.id as string);
            }
            return ids;
        }

        async function turnOn(userId: string, kind: string): Promise<void> {
            await getCtx().sql`
                insert into public.notification_prefs (household_id, user_id, kind, enabled)
                values (${householdId}, ${userId}, ${kind}, true)
                on conflict (user_id, kind) do update set enabled = true
            `;
        }

        test("a dismissible condition: recorded, gone from every inbox, and undo brings it back", async () => {
            const bee = await person("member");
            await expiringItem();
            const mine = (await inboxOf(owner())).notifications[0]!;
            expect(mine.kind).toBe("food_expiring");
            expect((await inboxOf(as(bee))).notifications).toHaveLength(1);
            const before = await fingerprint();

            const out = await call("dismiss_notice", {
                notification_id: mine.id,
                scope: "everyone",
            });
            expect(out.isError, text(out)).toBeFalsy();
            expect(out.structuredContent).toEqual({ dismissed: true });
            expect(text(out)).toContain(NOTICE_UNDO_SENTENCE);

            expect((await inboxOf(owner())).notifications).toEqual([]);
            expect((await inboxOf(as(bee))).notifications).toEqual([]);
            expect(await count("notice_dismissals")).toBe(1);

            const [entry] = await actions();
            expect(entry).toMatchObject({
                tool: "dismiss_notice",
                destructive: true,
                undoable: true,
                connection: "Claude",
            });
            expect(entry!.summary).toContain("Dismissed for everyone");
            expect(entry!.summary).toContain("Kefir");
            expect(
                (
                    entry!.snapshot.changes as { table: string; op: string }[]
                ).map((r) => `${r.table}:${r.op}`),
            ).toEqual(["notice_dismissals:inserted"]);

            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await count("notice_dismissals")).toBe(0);
            expect((await inboxOf(owner())).notifications).toHaveLength(1);
            expect((await inboxOf(as(bee))).notifications).toHaveLength(1);
            expect(await fingerprint()).toBe(before);
        });

        test("a dismissal the household already made is not the agent's: nothing is recorded, and undo leaves it", async () => {
            await expiringItem("Kefir");
            await expiringItem("Yogurt");
            const inbox = (await inboxOf(owner())).notifications;
            const kefir = inbox.find((n) => n.message.includes("Kefir"))!;
            const yogurt = inbox.find((n) => n.message.includes("Yogurt"))!;
            const [stored] = await rows(
                "select notice_key from public.notifications where id = $1",
                kefir.id,
            );
            const [code, subjectKind, subjectId, ...related] = String(
                stored!.notice_key,
            ).split("|");
            // Dismissed in the app, on Kitchen, before the agent acts.
            await getCtx().sql`
                insert into public.notice_dismissals (
                    household_id, code, subject_kind, subject_id, related_key,
                    dismissed_by
                )
                values (
                    ${householdId}, ${code}, ${subjectKind},
                    ${subjectId}::uuid, ${related.join("|")}, ${ownerId}
                )
            `;
            const [fromApp] = await rows(
                "select id from public.notice_dismissals",
            );

            // An agent that still holds the id dismisses it for everyone.
            const again = await call("dismiss_notice", {
                notification_id: kefir.id,
                scope: "everyone",
            });
            expect(again.isError, text(again)).toBeFalsy();
            expect(again.structuredContent).toEqual({ dismissed: true });
            expect(text(again)).toBe("Already dismissed for everyone.");
            expect(await actions()).toEqual([]);

            // A dismissal it does make is recorded, and only that one is undone.
            const made = await call("dismiss_notice", {
                notification_id: yogurt.id,
                scope: "everyone",
            });
            expect(made.isError, text(made)).toBeFalsy();
            expect(text(made)).toContain(NOTICE_UNDO_SENTENCE);
            expect(await count("notice_dismissals")).toBe(2);
            const [entry] = await actions();
            expect(
                (
                    entry!.snapshot.changes as { table: string; op: string }[]
                ).map((r) => `${r.table}:${r.op}`),
            ).toEqual(["notice_dismissals:inserted"]);

            expect((await undo(entry!.id)).status).toBe("undone");
            expect(
                await rows("select id from public.notice_dismissals"),
            ).toEqual([fromApp!]);
            const left = (await inboxOf(owner())).notifications;
            expect(left.map((n) => n.id)).toEqual([yogurt.id]);
        });

        test("two identical calls in one batch record one insert, and the other records nothing", async () => {
            await expiringItem();
            const mine = (await inboxOf(owner())).notifications[0]!;
            const answers = await callBatch(
                owner() as Extract<Who, { kind: "user" }>,
                [1, 2].map((id) => ({
                    id,
                    name: "dismiss_notice",
                    args: { notification_id: mine.id, scope: "everyone" },
                })),
            );
            const texts: string[] = [];
            for (const answer of answers.values()) {
                expect(answer.isError, text(answer)).toBeFalsy();
                expect(answer.structuredContent).toEqual({ dismissed: true });
                texts.push(text(answer));
            }
            expect(
                texts.filter((t) => t.includes(NOTICE_UNDO_SENTENCE)),
            ).toHaveLength(1);
            expect(
                texts.filter((t) => t === "Already dismissed for everyone."),
            ).toHaveLength(1);
            expect(await count("notice_dismissals")).toBe(1);
            const entries = await actions();
            expect(entries).toHaveLength(1);
            expect(
                (
                    entries[0]!.snapshot.changes as {
                        table: string;
                        op: string;
                    }[]
                ).map((r) => `${r.table}:${r.op}`),
            ).toEqual(["notice_dismissals:inserted"]);
            expect((await undo(entries[0]!.id)).status).toBe("undone");
            expect(await count("notice_dismissals")).toBe(0);
            expect((await inboxOf(owner())).notifications).toHaveLength(1);
        });

        test("two identical event dismissals in one batch record the copies once", async () => {
            const bee = await person("member");
            const [forOwner] = await recipeRemoved([ownerId, bee], null);
            await turnOn(ownerId, "recipe_changes");
            await turnOn(bee, "recipe_changes");
            const answers = await callBatch(
                owner() as Extract<Who, { kind: "user" }>,
                [1, 2].map((id) => ({
                    id,
                    name: "dismiss_notice",
                    args: { notification_id: forOwner!, scope: "everyone" },
                })),
            );
            for (const answer of answers.values()) {
                expect(answer.isError, text(answer)).toBeFalsy();
            }
            const entries = await actions();
            expect(entries).toHaveLength(1);
            expect(
                (
                    entries[0]!.snapshot.changes as {
                        table: string;
                        op: string;
                    }[]
                ).map((r) => `${r.table}:${r.op}`),
            ).toEqual(["notifications:updated", "notifications:updated"]);
            expect((await undo(entries[0]!.id)).status).toBe("undone");
            expect((await inboxOf(as(bee))).notifications).toHaveLength(1);
        });

        test("an event: every copy is recorded as it was, and undo puts each back", async () => {
            const bee = await person("member");
            const [forOwner, forBee] = await recipeRemoved(
                [ownerId, bee],
                null,
            );
            await turnOn(ownerId, "recipe_changes");
            await turnOn(bee, "recipe_changes");
            expect((await inboxOf(owner())).notifications).toHaveLength(1);

            const out = await call("dismiss_notice", {
                notification_id: forOwner,
                scope: "everyone",
            });
            expect(out.isError, text(out)).toBeFalsy();
            const stamped = await rows(
                "select id, dismissed_at, dismissed_by from public.notifications order by id",
            );
            expect(stamped.every((r) => r.dismissed_at !== null)).toBe(true);
            expect(stamped.every((r) => r.dismissed_by === ownerId)).toBe(true);
            expect((await inboxOf(as(bee))).notifications).toEqual([]);

            const [entry] = await actions();
            const tables = (
                entry!.snapshot.changes as { table: string; op: string }[]
            ).map((r) => `${r.table}:${r.op}`);
            expect(tables.sort()).toEqual([
                "notifications:updated",
                "notifications:updated",
            ]);

            expect((await undo(entry!.id)).status).toBe("undone");
            const back = await rows(
                "select id, dismissed_at, dismissed_by from public.notifications",
            );
            expect(back.every((r) => r.dismissed_at === null)).toBe(true);
            expect(back.every((r) => r.dismissed_by === null)).toBe(true);
            expect(back.map((r) => r.id).sort()).toEqual(
                [forOwner, forBee].sort(),
            );
            expect((await inboxOf(as(bee))).notifications).toHaveLength(1);
        });

        test("a member is refused, and nothing is written or recorded", async () => {
            const bee = await person("member");
            await expiringItem();
            const row = (await inboxOf(as(bee))).notifications[0]!;
            const before = await fingerprint();
            const out = await call(
                "dismiss_notice",
                { notification_id: row.id, scope: "everyone" },
                "legacy",
                as(bee),
            );
            expect(out.isError).toBe(true);
            expect(text(out)).toContain("owner or an admin");
            expect(await count("notice_dismissals")).toBe(0);
            expect(await actions()).toEqual([]);
            expect(await fingerprint()).toBe(before);
            expect((await inboxOf(as(bee))).notifications).toHaveLength(1);
            // For themselves, the same member may.
            const mine = await call(
                "dismiss_notice",
                { notification_id: row.id },
                "legacy",
                as(bee),
            );
            expect(mine.isError, text(mine)).toBeFalsy();
            expect((await inboxOf(as(bee))).notifications).toEqual([]);
            expect((await inboxOf(owner())).notifications).toHaveLength(1);
            expect(await actions()).toEqual([]);
        });

        test("an admin may, under both switches, and the household's off still stops them", async () => {
            const admin = await person("admin");
            await expiringItem();
            const row = (await inboxOf(as(admin))).notifications[0]!;
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        false,
                    ),
                householdId,
            );
            const off = await call(
                "dismiss_notice",
                { notification_id: row.id, scope: "everyone" },
                "legacy",
                as(admin),
            );
            expect(off.isError).toBe(true);
            expect(text(off)).toContain(REFUSAL);
            expect(await actions()).toEqual([]);
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        true,
                    ),
                householdId,
            );
            const ok = await call(
                "dismiss_notice",
                { notification_id: row.id, scope: "everyone" },
                "legacy",
                as(admin),
            );
            expect(ok.isError, text(ok)).toBeFalsy();
            expect(await actions()).toHaveLength(1);
        });

        test("an admin whose own switch is Off is refused with their own switch named", async () => {
            const admin = await person("admin", false);
            await expiringItem();
            const row = (await inboxOf(as(admin))).notifications[0]!;
            const out = await call(
                "dismiss_notice",
                { notification_id: row.id, scope: "everyone" },
                "legacy",
                as(admin),
            );
            expect(out.isError).toBe(true);
            expect(text(out)).toContain(PERSON_REFUSAL);
            expect(await actions()).toEqual([]);
        });

        test("an agent acts only for its person: another member's row is refused", async () => {
            const bee = await person("member");
            await expiringItem();
            await inboxOf(owner());
            const beesRow = (await inboxOf(as(bee))).notifications[0]!;
            for (const scope of ["me", "everyone"] as const) {
                const out = await call("dismiss_notice", {
                    notification_id: beesRow.id,
                    scope,
                });
                expect(out.isError, scope).toBe(true);
            }
            const snooze = await call("snooze_notice", {
                notification_id: beesRow.id,
                until: "week",
            });
            expect(snooze.isError).toBe(true);
            const read = await call("mark_notices_read", {
                notification_ids: [beesRow.id],
            });
            expect(read.isError).toBe(true);
            const [row] = await rows(
                "select read_at, snoozed_until, dismissed_at from public.notifications where id = $1",
                beesRow.id,
            );
            expect(row).toEqual({
                read_at: null,
                snoozed_until: null,
                dismissed_at: null,
            });
            expect(await actions()).toEqual([]);
        });

        test("an Allergens row cannot be dismissed, for me or for everyone, and no entry is recorded", async () => {
            const [row] = await getCtx().sql`
                insert into public.notifications (
                    household_id, recipient_user_id, kind, bucket, source,
                    notice_key, subject_kind, subject_id, payload
                )
                values (
                    ${householdId}, ${ownerId}, 'allergens', 'household',
                    'condition',
                    ${`grocery.allergen|grocery_line|${crypto.randomUUID()}|`},
                    'grocery_line', ${crypto.randomUUID()},
                    ${JSON.stringify({
                        code: "grocery.allergen",
                        params: { allergens: ["peanut"] },
                        related: [{ kind: "member", id: ownerId, name: "Pat" }],
                    })}::jsonb
                )
                returning id
            `;
            for (const scope of ["me", "everyone"] as const) {
                const out = await call("dismiss_notice", {
                    notification_id: row!.id as string,
                    scope,
                });
                expect(out.isError, scope).toBe(true);
                expect(text(out)).toContain("Allergen");
            }
            const snooze = await call("snooze_notice", {
                notification_id: row!.id as string,
                until: "week",
            });
            expect(snooze.isError).toBe(true);
            const [after] = await rows(
                "select dismissed_at, snoozed_until from public.notifications where id = $1",
                row!.id,
            );
            expect(after).toEqual({ dismissed_at: null, snoozed_until: null });
            expect(await actions()).toEqual([]);
        });

        test("both protocol eras reach the same refusal and the same entry", async () => {
            const bee = await person("member");
            await expiringItem();
            const row = (await inboxOf(as(bee))).notifications[0]!;
            const modern: Era = { pin: "2026-07-28" };
            const refused = await call(
                "dismiss_notice",
                { notification_id: row.id, scope: "everyone" },
                modern,
                as(bee),
            );
            expect(refused.isError).toBe(true);
            expect(text(refused)).toContain("owner or an admin");
            const mine = (await inboxOf(owner())).notifications[0]!;
            const ok = await call(
                "dismiss_notice",
                { notification_id: mine.id, scope: "everyone" },
                modern,
            );
            expect(ok.isError, text(ok)).toBeFalsy();
            expect(await actions()).toHaveLength(1);
        });

        test("can_dismiss_for_everyone is true only where the call would be allowed", async () => {
            const admin = await person("admin", false);
            const bee = await person("member");
            await expiringItem();
            const flag = async (who: Who) =>
                (await inboxOf(who)).notifications[0]!.can_dismiss_for_everyone;
            // The role allows it, the person's own switch is Off: refused.
            expect(await flag(as(admin))).toBe(false);
            expect(await flag(owner())).toBe(true);
            // A member is never allowed.
            expect(await flag(as(bee))).toBe(false);
            // The admin turns their switch On.
            await getCtx().sql`
                update public.household_members
                set agents_can_delete = true
                where household_id = ${householdId} and user_id = ${admin}
            `;
            expect(await flag(as(admin))).toBe(true);
            // The household's switch Off stops everyone's.
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        false,
                    ),
                householdId,
            );
            expect(await flag(as(admin))).toBe(false);
            expect(await flag(owner())).toBe(false);
        });

        describe("snooze_notice for everyone goes through the guard", () => {
            type Copy = {
                recipient_user_id: string;
                snoozed_until: Date | null;
                snoozed_by: string | null;
            };
            const copies = async (): Promise<Copy[]> =>
                (await rows(
                    `select recipient_user_id, snoozed_until, snoozed_by
                     from public.notifications
                     where kind = 'food_expiring'
                     order by recipient_user_id`,
                )) as Copy[];
            const copyOf = async (userId: string): Promise<Copy> =>
                (await copies()).find(
                    (row) => row.recipient_user_id === userId,
                )!;
            const changesOf = (entry: Record<string, any>) =>
                (entry.snapshot.changes as { table: string; op: string }[])
                    .map((r) => `${r.table}:${r.op}`)
                    .sort();
            const householdSwitch = (allowed: boolean) =>
                asUser(
                    ownerId,
                    () =>
                        liveSettingsStore().setAgentDestructiveAllowed(
                            householdId,
                            allowed,
                        ),
                    householdId,
                );
            const untilIn = (days: number) =>
                `${new Date(Date.now() + days * 86_400_000)
                    .toISOString()
                    .slice(0, 16)}Z`;

            test("allowed: every copy is snoozed over what members set, recorded, and undo gives each its own back", async () => {
                const bee = await person("member");
                const cat = await person("member");
                await expiringItem();
                const mine = (await inboxOf(owner())).notifications[0]!;
                const beeRow = (await inboxOf(as(bee))).notifications[0]!;
                const catRow = (await inboxOf(as(cat))).notifications[0]!;
                // Bee snoozes their own copy to tomorrow, Cat theirs for a year
                // or so: a member's own snooze is a plain write.
                for (const [who, row, until] of [
                    [bee, beeRow, "tomorrow"],
                    [cat, catRow, untilIn(300)],
                ] as const) {
                    const own = await call(
                        "snooze_notice",
                        { notification_id: row.id, until },
                        "legacy",
                        as(who),
                    );
                    expect(own.isError, text(own)).toBeFalsy();
                    expect(own.structuredContent).toMatchObject({
                        for_everyone: false,
                    });
                }
                expect(await actions()).toEqual([]);
                const before = await copies();
                expect(
                    before.filter((r) => r.snoozed_until !== null),
                ).toHaveLength(2);

                const out = await call("snooze_notice", {
                    notification_id: mine.id,
                    until: "week",
                });
                expect(out.isError, text(out)).toBeFalsy();
                expect(out.structuredContent).toMatchObject({
                    snoozed: true,
                    for_everyone: true,
                });
                expect(text(out)).toContain("for every member");
                expect(text(out)).toContain(NOTICE_UNDO_SENTENCE);

                // The owner's and Bee's copies take the week; Cat's longer
                // snooze is left alone.
                const week = (await copyOf(ownerId)).snoozed_until!;
                expect(week.getTime()).toBeGreaterThan(
                    Date.now() + 6 * 86_400_000,
                );
                const bees = await copyOf(bee);
                expect(bees.snoozed_until).toEqual(week);
                expect(bees.snoozed_by).toBe(ownerId);
                expect(await copyOf(cat)).toEqual(
                    before.find((r) => r.recipient_user_id === cat)!,
                );

                const [entry] = await actions();
                expect(entry).toMatchObject({
                    tool: "snooze_notice",
                    destructive: true,
                    undoable: true,
                    connection: "Claude",
                });
                expect(entry!.summary).toContain("Snoozed for everyone");
                expect(entry!.summary).toContain("Kefir");
                expect(changesOf(entry!)).toEqual([
                    "notifications:updated",
                    "notifications:updated",
                ]);

                expect((await undo(entry!.id)).status).toBe("undone");
                expect(await copies()).toEqual(before);
            });

            test('once a member snoozes their own copy again, undo is refused whole: that is what the result\'s "unless someone has changed their copy" means', async () => {
                const bee = await person("member");
                await expiringItem();
                const mine = (await inboxOf(owner())).notifications[0]!;
                const beeRow = (await inboxOf(as(bee))).notifications[0]!;
                const out = await call("snooze_notice", {
                    notification_id: mine.id,
                    until: "week",
                });
                expect(text(out)).toContain(NOTICE_UNDO_SENTENCE);
                const [entry] = await actions();

                const own = await call(
                    "snooze_notice",
                    { notification_id: beeRow.id, until: untilIn(30) },
                    "legacy",
                    as(bee),
                );
                expect(own.isError, text(own)).toBeFalsy();
                const mid = await copies();

                // The guard puts every copy back or none: Bee's changed copy
                // refuses the whole undo, and nothing moves.
                expect((await undo(entry!.id)).status).toBe("conflict");
                expect(await copies()).toEqual(mid);
            });

            test("the household's Off and the person's own Off refuse it, and nothing changes or is recorded", async () => {
                const admin = await person("admin", false);
                await person("member");
                await expiringItem();
                const mine = (await inboxOf(owner())).notifications[0]!;
                const adminRow = (await inboxOf(as(admin))).notifications[0]!;
                const before = await copies();

                const personOff = await call(
                    "snooze_notice",
                    { notification_id: adminRow.id, until: "week" },
                    "legacy",
                    as(admin),
                );
                expect(personOff.isError).toBe(true);
                expect(text(personOff)).toContain(PERSON_REFUSAL);

                await householdSwitch(false);
                const off = await call("snooze_notice", {
                    notification_id: mine.id,
                    until: "week",
                });
                expect(off.isError).toBe(true);
                expect(text(off)).toContain(REFUSAL);

                expect(await copies()).toEqual(before);
                expect(await actions()).toEqual([]);
                expect((await inboxOf(owner())).notifications).toHaveLength(1);
            });

            test("a member's own snooze and a personal row are plain writes, whatever the switches say", async () => {
                const bee = await person("member", false);
                await expiringItem();
                const beeRow = (await inboxOf(as(bee))).notifications[0]!;
                const [weighIn] = await getCtx().sql`
                    insert into public.notifications (
                        household_id, recipient_user_id, kind, bucket, source,
                        notice_key, subject_kind, subject_id, payload
                    )
                    values (
                        ${householdId}, ${ownerId}, 'weigh_in_due', 'personal',
                        'condition',
                        ${`nutrition.weigh_in_due|member|${ownerId}|`},
                        'member', ${ownerId},
                        ${JSON.stringify({
                            code: "nutrition.weigh_in_due",
                            params: { name: "Owner", days: 9 },
                            related: [],
                        })}::jsonb
                    )
                    returning id
                `;
                await householdSwitch(false);

                const own = await call(
                    "snooze_notice",
                    { notification_id: beeRow.id, until: "week" },
                    "legacy",
                    as(bee),
                );
                expect(own.isError, text(own)).toBeFalsy();
                expect(own.structuredContent).toMatchObject({
                    for_everyone: false,
                });
                const personal = await call("snooze_notice", {
                    notification_id: weighIn!.id as string,
                    until: "week",
                });
                expect(personal.isError, text(personal)).toBeFalsy();
                expect(personal.structuredContent).toMatchObject({
                    for_everyone: false,
                });
                expect(text(personal)).not.toContain("every member");
                expect(await actions()).toEqual([]);
                expect((await copyOf(bee)).snoozed_by).toBe(bee);
            });

            test("both protocol eras reach the same refusal and the same entry", async () => {
                await person("member");
                await expiringItem();
                const mine = (await inboxOf(owner())).notifications[0]!;
                const modern: Era = { pin: "2026-07-28" };
                await householdSwitch(false);
                const refused = await call(
                    "snooze_notice",
                    { notification_id: mine.id, until: "week" },
                    modern,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(REFUSAL);
                expect(await actions()).toEqual([]);
                await householdSwitch(true);
                const ok = await call(
                    "snooze_notice",
                    { notification_id: mine.id, until: "week" },
                    modern,
                );
                expect(ok.isError, text(ok)).toBeFalsy();
                expect(text(ok)).toContain(NOTICE_UNDO_SENTENCE);
                expect(await actions()).toHaveLength(1);
            });
        });
    });
});
