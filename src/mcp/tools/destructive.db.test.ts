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
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import { liveFoodsStore } from "../../db/foods.js";
import * as groceryDb from "../../db/grocery.js";
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
    "recipe_favourites",
    "meals",
    "meal_items",
    "water_log",
    "weight_log",
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
        setFlagsForTests(createMemoryFlags({ "mcp-plan-tools": true }));
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
            return {
                tool: "remove_recipe_ingredient",
                args: { recipe_id: soup.id, ingredient_id: soup.ingredient },
                summary: "Removed Flour from recipe Soup",
                changed: async () =>
                    expect(await count("recipe_ingredients")).toBe(0),
                restored: async () => {
                    const back = await rows(
                        "select id from public.recipe_ingredients",
                    );
                    expect(back.map((row) => row.id)).toEqual([
                        soup.ingredient,
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
            for (const target_member of [bee, ownerId]) {
                const logged = await call("log_meal", {
                    description: "Eggs",
                    meal_type: "breakfast",
                    target_member,
                    items: [{ food_id: drop, amount: 100, unit: "g" }],
                });
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
        const MERGED = "merged or deleted since";

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
        // Set a target and drop the other: the override still has one.
        const kept = await call("set_nutrition_goals", {
            date: "2099-01-01",
            daily_protein_g: null,
        });
        expect(kept.isError).toBeFalsy();
        expect(await count("nutrition_goal_days")).toBe(1);
        expect(await actions()).toEqual([]);

        const emptied = await call("set_nutrition_goals", {
            date: "2099-01-01",
            daily_calories: null,
        });
        expect(emptied.isError).toBeFalsy();
        expect(emptied.content[0]!.text).toContain(UNDO_SENTENCE);
        expect(await count("nutrition_goal_days")).toBe(0);
        const entry = await actionFor("set_nutrition_goals");
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
});
