// The grocery and store admin tools (flag mcp-household-admin) against real
// Postgres, through the real /mcp handler. Each destructive one records what it
// removed or changed in the household's activity log, says so in its result,
// can be undone for 24 hours, and does nothing at all while the household's
// switch is Off. The in-memory tests in src/mcp.test.ts cover the tool list
// with the flag on and off and both protocol eras; what only the database can
// show is that the snapshot holds every affected row (lines, sections, store
// rules, the default store in the household's preferences, a food's usual
// store, dismissed notices) and that undo puts them all back exactly.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import { liveSettingsStore } from "../../db/settings.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { undoAgentAction } from "../../domain/agent-actions.js";
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

const ADMIN_TOOLS = [
    "clear_grocery_list",
    "move_grocery_lines",
    "update_grocery_line",
    "list_stores",
    "create_store",
    "update_store",
    "delete_store",
    "reorder_stores",
    "set_store_sections",
];

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

/** Every table an admin tool can touch. `updated_at` is bookkeeping undo never restores. */
const FINGERPRINT_TABLES = [
    "households",
    "grocery_stores",
    "grocery_sections",
    "grocery_lines",
    "store_rules",
    "foods",
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
};

describeDb(
    pgAvailable !== null,
    "grocery and store admin tools (db)",
    (getCtx) => {
        let householdId: string;
        let ownerId: string;
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
                createMemoryFlags({ "mcp-household-admin": true }),
            );
            ({ householdId, userId: ownerId } = await seedHousehold(sql));
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
            return (await getCtx().sql.unsafe(
                query,
                params as any[],
            )) as Record<string, any>[];
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

        type MadeStore = { id: string; sections: Record<string, string> };

        async function makeStore(
            name: string,
            sections?: string[],
        ): Promise<MadeStore> {
            const made = await call("create_store", { name, sections });
            expect(made.isError).toBeFalsy();
            const wire = made.structuredContent!.sections as {
                id: string;
                name: string;
            }[];
            return {
                id: made.structuredContent!.id as string,
                sections: Object.fromEntries(
                    wire.map((row) => [row.name, row.id]),
                ),
            };
        }

        async function food(name: string): Promise<string> {
            const made = await call("upsert_food", {
                name,
                on_similar: "create",
            });
            return made.structuredContent!.id as string;
        }

        async function line(
            store: MadeStore,
            name: string,
            section?: string,
        ): Promise<string> {
            const added = await call("add_grocery_line", {
                store_id: store.id,
                section_id: section ? store.sections[section] : undefined,
                kind: "food",
                food_id: await food(name),
                amount: 2,
                unit: "each",
            });
            expect(added.isError).toBeFalsy();
            return added.structuredContent!.id as string;
        }

        async function dismiss(lineId: string, code = "x"): Promise<void> {
            await getCtx().sql`
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id, related_key
            )
            values (${householdId}, ${code}, ${"grocery_line"}, ${lineId}, ${""})
        `;
        }

        async function storeRule(storeId: string, body: string): Promise<void> {
            await getCtx().sql`
            insert into public.store_rules (household_id, store_id, body, sort_order)
            values (${householdId}, ${storeId}, ${body}, ${0})
        `;
        }

        async function lineRows() {
            return rows(
                "select id, store_id, section_id, amount::float as amount, unit, note, checked from public.grocery_lines order by id",
            );
        }

        async function storeNames(): Promise<string[]> {
            return (
                await rows(
                    "select name from public.grocery_stores order by sort_order, name",
                )
            ).map((row) => row.name);
        }

        async function preferences(): Promise<Record<string, unknown>> {
            const [row] = await rows(
                "select household_preferences as p from public.households where id = $1",
                householdId,
            );
            return row!.p as Record<string, unknown>;
        }

        async function sectionNames(storeId: string): Promise<string[]> {
            return (
                await rows(
                    "select name from public.grocery_sections where store_id = $1 order by sort_order",
                    storeId,
                )
            ).map((row) => row.name);
        }

        async function setDefault(storeId: string) {
            const res = await call("update_store", {
                id: storeId,
                is_default: true,
            });
            expect(res.isError).toBeFalsy();
            // Set-up only: it is its own recorded action, not part of the one under test.
            await getCtx().sql`delete from public.agent_actions`;
        }

        // ---------- every destructive tool ----------

        const scenarios: Record<string, () => Promise<Arranged>> = {
            clear_grocery_list: async () => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                const a = await line(costco, "Eggs");
                await line(costco, "Milk");
                await line(aldi, "Flour");
                await call("check_grocery_line", { id: a, checked: true });
                await dismiss(a);
                return {
                    tool: "clear_grocery_list",
                    args: {},
                    summary: "Cleared 3 lines from the grocery list",
                    text: "Cleared 3 lines from the grocery list (1 ticked, 2 not).",
                    changed: async () => {
                        expect(await count("grocery_lines")).toBe(0);
                        expect(await count("notice_dismissals")).toBe(0);
                    },
                };
            },
            "clear_grocery_list (one store)": async () => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                await line(costco, "Eggs");
                await line(costco, "Milk");
                const kept = await line(aldi, "Flour");
                return {
                    tool: "clear_grocery_list",
                    args: { store_id: costco.id },
                    summary: "Cleared 2 lines from Costco",
                    text: "Cleared 2 lines from Costco (0 ticked, 2 not).",
                    changed: async () => {
                        expect((await lineRows()).map((row) => row.id)).toEqual(
                            [kept],
                        );
                    },
                };
            },
            move_grocery_lines: async () => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                const eggs = await line(costco, "Eggs", "Dairy");
                const veg = await line(costco, "Kale", "Produce");
                await line(costco, "Flour", "Pantry");
                return {
                    tool: "move_grocery_lines",
                    args: { line_ids: [eggs, veg], store_id: aldi.id },
                    summary: "Moved 2 lines to Aldi",
                    text: "Moved 2 lines: Aldi (Dairy), Aldi (Produce).",
                    changed: async () => {
                        const moved = await rows(
                            "select id, store_id, section_id from public.grocery_lines where store_id = $1 order by section_id",
                            aldi.id,
                        );
                        expect(moved.map((row) => row.id).sort()).toEqual(
                            [eggs, veg].sort(),
                        );
                        // The aisle came with each line, by name.
                        const byId = Object.fromEntries(
                            moved.map((row) => [row.id, row.section_id]),
                        );
                        expect(byId[eggs]).toBe(aldi.sections.Dairy!);
                        expect(byId[veg]).toBe(aldi.sections.Produce!);
                    },
                };
            },
            update_grocery_line: async () => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                const id = await line(costco, "Eggs", "Dairy");
                return {
                    tool: "update_grocery_line",
                    args: {
                        id,
                        amount: 12,
                        unit: "each",
                        note: "large",
                        store_id: aldi.id,
                        section: "pantry",
                    },
                    summary: "Updated grocery line Eggs",
                    text: `Updated Eggs: 12 each at Aldi (Pantry), note "large".`,
                    changed: async () => {
                        const [row] = await lineRows();
                        expect(row).toMatchObject({
                            id,
                            store_id: aldi.id,
                            section_id: aldi.sections.Pantry,
                            amount: 12,
                            note: "large",
                        });
                    },
                };
            },
            update_store: async () => {
                const costco = await makeStore("Costco");
                await makeStore("Aldi");
                return {
                    tool: "update_store",
                    args: {
                        id: costco.id,
                        name: "Costco Wholesale",
                        is_default: true,
                        use_usual_store: true,
                    },
                    summary:
                        "Store Costco: renamed Costco to Costco Wholesale; made Costco Wholesale the default store; usual store first is now on",
                    text: "Updated store Costco Wholesale.",
                    changed: async () => {
                        expect(await storeNames()).toContain(
                            "Costco Wholesale",
                        );
                        expect(await preferences()).toMatchObject({
                            "grocery.default_store_id": costco.id,
                            "grocery.use_usual_store": true,
                        });
                    },
                };
            },
            delete_store: async () => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                await setDefault(costco.id);
                const eggs = await line(costco, "Eggs", "Dairy");
                await line(costco, "Kale", "Produce");
                await line(aldi, "Flour");
                await storeRule(costco.id, "Buy the big pack");
                const foodId = await food("Rice");
                await getCtx()
                    .sql`update public.foods set usual_store_id = ${costco.id} where id = ${foodId}`;
                await dismiss(eggs);
                return {
                    tool: "delete_store",
                    args: { id: costco.id, lines: "move", move_to: aldi.id },
                    summary: "Deleted store Costco (moved 2 lines to Aldi)",
                    text: "Deleted store Costco and moved its 2 lines to Aldi. It was the default store, so the household has no default store now.",
                    changed: async () => {
                        expect(await storeNames()).toEqual(["Aldi"]);
                        const left = await lineRows();
                        expect(left).toHaveLength(3);
                        expect(
                            left.every((row) => row.store_id === aldi.id),
                        ).toBe(true);
                        expect(await count("store_rules")).toBe(0);
                        expect(await count("notice_dismissals")).toBe(1);
                        expect(await preferences()).not.toHaveProperty(
                            "grocery.default_store_id",
                        );
                        const [rice] = await rows(
                            "select usual_store_id from public.foods where id = $1",
                            foodId,
                        );
                        expect(rice!.usual_store_id).toBeNull();
                    },
                };
            },
            "delete_store (delete the lines)": async () => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                await setDefault(costco.id);
                const eggs = await line(costco, "Eggs", "Dairy");
                await line(costco, "Kale", "Produce");
                const kept = await line(aldi, "Flour");
                await storeRule(costco.id, "Buy the big pack");
                await dismiss(eggs);
                return {
                    tool: "delete_store",
                    args: { id: costco.id, lines: "delete" },
                    summary: "Deleted store Costco and its 2 lines",
                    text: "Deleted store Costco and its 2 lines. It was the default store, so the household has no default store now.",
                    changed: async () => {
                        expect(await storeNames()).toEqual(["Aldi"]);
                        expect((await lineRows()).map((row) => row.id)).toEqual(
                            [kept],
                        );
                        expect(await count("store_rules")).toBe(0);
                        expect(await count("notice_dismissals")).toBe(0);
                        expect(await preferences()).not.toHaveProperty(
                            "grocery.default_store_id",
                        );
                    },
                };
            },
            reorder_stores: async () => {
                const a = await makeStore("Alpha");
                const b = await makeStore("Beta");
                const c = await makeStore("Gamma");
                return {
                    tool: "reorder_stores",
                    args: { ordered_ids: [c.id, a.id, b.id] },
                    summary: "Reordered the stores: Gamma, Alpha, Beta",
                    text: "Stores are now in this order: Gamma, Alpha, Beta.",
                    changed: async () =>
                        expect(await storeNames()).toEqual([
                            "Gamma",
                            "Alpha",
                            "Beta",
                        ]),
                };
            },
            set_store_sections: async () => {
                const deli = await makeStore("Deli", [
                    "Meat",
                    "Cheese",
                    "Bread",
                ]);
                await line(deli, "Ham", "Meat");
                return {
                    tool: "set_store_sections",
                    args: {
                        store_id: deli.id,
                        add: ["Olives"],
                        rename: [{ section: "bread", name: "Bakery" }],
                        hide: ["Cheese"],
                        order: ["Olives", "Bakery"],
                    },
                    summary:
                        "Sections of Deli: added Olives; renamed Bread to Bakery; hid Cheese; reordered",
                    // Cheese is hidden and keeps its place; the visible ones fill the rest.
                    text: "Updated the sections of Deli. They are now: Olives, Cheese (hidden), Bakery, Meat, Other.",
                    changed: async () => {
                        const now = await rows(
                            "select name, hidden from public.grocery_sections where store_id = $1 order by sort_order",
                            deli.id,
                        );
                        expect(now.map((row) => row.name)).toEqual([
                            "Olives",
                            "Cheese",
                            "Bakery",
                            "Meat",
                            "Other",
                        ]);
                        expect(
                            now.find((row) => row.name === "Cheese")!.hidden,
                        ).toBe(true);
                    },
                };
            },
        };

        scenarios["set_store_sections (remove a section with lines)"] =
            async () => {
                const deli = await makeStore("Deli", [
                    "Meat",
                    "Cheese",
                    "Bread",
                ]);
                const ham = await line(deli, "Ham", "Meat");
                const brie = await line(deli, "Brie", "Cheese");
                const cheddar = await line(deli, "Cheddar", "Cheese");
                await dismiss(brie);
                return {
                    tool: "set_store_sections",
                    args: { store_id: deli.id, remove: ["cheese"] },
                    summary:
                        "Sections of Deli: removed Cheese (2 lines moved to Other)",
                    text: "Updated the sections of Deli. They are now: Meat, Bread, Other.",
                    changed: async () => {
                        const names = await rows(
                            "select name from public.grocery_sections where store_id = $1 order by sort_order",
                            deli.id,
                        );
                        expect(names.map((row) => row.name)).toEqual([
                            "Meat",
                            "Bread",
                            "Other",
                        ]);
                        const byId = Object.fromEntries(
                            (await lineRows()).map((row) => [
                                row.id,
                                row.section_id,
                            ]),
                        );
                        expect(byId[ham]).toBe(deli.sections.Meat!);
                        // Both moved to Other, and none was deleted with the section.
                        expect(byId[brie]).toBe(deli.sections.Other!);
                        expect(byId[cheddar]).toBe(deli.sections.Other!);
                        // The line lives on, so its dismissed notice does too.
                        expect(await count("notice_dismissals")).toBe(1);
                    },
                };
            };
        scenarios["set_store_sections (remove, add and reorder together)"] =
            async () => {
                const deli = await makeStore("Deli", [
                    "Meat",
                    "Cheese",
                    "Bread",
                ]);
                await line(deli, "Ham", "Meat");
                await line(deli, "Brie", "Cheese");
                return {
                    tool: "set_store_sections",
                    args: {
                        store_id: deli.id,
                        remove: ["Cheese"],
                        add: ["Olives"],
                        hide: ["Meat"],
                        order: ["Olives", "Bread"],
                    },
                    summary:
                        "Sections of Deli: removed Cheese (1 line moved to Other); added Olives; hid Meat",
                    text: "Updated the sections of Deli. They are now: Meat (hidden), Olives, Bread, Other.",
                    changed: async () => {
                        const now = await rows(
                            "select name from public.grocery_sections where store_id = $1 order by sort_order",
                            deli.id,
                        );
                        expect(now.map((row) => row.name)).toEqual([
                            "Meat",
                            "Olives",
                            "Bread",
                            "Other",
                        ]);
                    },
                };
            };

        // ---------- tests ----------

        test("the scenarios cover every destructive admin tool", () => {
            expect(
                [
                    ...new Set(
                        Object.values(
                            Object.fromEntries(
                                Object.entries(scenarios).map(([name]) => [
                                    name,
                                    name.replace(/ \(.*\)$/, ""),
                                ]),
                            ),
                        ),
                    ),
                ].sort(),
            ).toEqual(
                ADMIN_TOOLS.filter(
                    (name) => name !== "list_stores" && name !== "create_store",
                ).sort(),
            );
        });

        for (const [label, arrange] of Object.entries(scenarios)) {
            test(`${label} is recorded with a snapshot, says how to undo, and undo puts everything back`, async () => {
                const arranged = await arrange();
                const before = await fingerprint();
                const tool = arranged.tool;
                const result = await call(tool, arranged.args);
                expect(result.isError).toBeFalsy();
                const said = text(result);
                expect(said).toStartWith(arranged.text);
                expect(said).toContain(UNDO_SENTENCE);
                await arranged.changed();
                expect(await fingerprint()).not.toBe(before);

                const entries = await actions();
                expect(entries).toHaveLength(1);
                const [entry] = entries;
                expect(entry).toMatchObject({
                    household_id: householdId,
                    member_id: ownerId,
                    connection: "Claude",
                    tool,
                    destructive: true,
                    undoable: true,
                });
                expect(entry!.summary).toBe(arranged.summary);
                expect(entry!.snapshot).not.toBeNull();
                expect(entry!.undone_at).toBeNull();
                expect(
                    Date.parse(entry!.undo_expires_at) -
                        Date.parse(entry!.created_at),
                ).toBe(24 * 60 * 60 * 1000);

                const out = await undo(entry!.id);
                expect(out).toMatchObject({ status: "undone" });
                expect(await fingerprint()).toBe(before);
                const [done] = await actions();
                expect(done!.undone_by).toBe(ownerId);
            });

            test(`${label} is refused while agents may not make destructive changes, and changes nothing`, async () => {
                const arranged = await arrange();
                await switchOff();
                const before = await fingerprint();
                const result = await call(arranged.tool, arranged.args);
                expect(result.isError).toBe(true);
                expect(text(result)).toContain(REFUSAL);
                expect(text(result)).toContain("Nothing was changed.");
                expect(await fingerprint()).toBe(before);
                expect(await actions()).toEqual([]);
            });
        }

        test("with the switch Allowed, clear_grocery_list clears every line and undo brings each back with its dismissed notices", async () => {
            const costco = await makeStore("Costco");
            const aldi = await makeStore("Aldi");
            const ids: string[] = [];
            for (let i = 0; i < 20; i += 1) {
                ids.push(await line(i % 2 === 0 ? costco : aldi, `Food ${i}`));
            }
            for (const id of ids.slice(0, 5)) await dismiss(id);
            for (const id of ids.slice(0, 3)) {
                await call("check_grocery_line", { id, checked: true });
            }
            const before = await fingerprint();

            const cleared = await call("clear_grocery_list");
            expect(cleared.isError).toBeFalsy();
            expect(text(cleared)).toStartWith(
                "Cleared 20 lines from the grocery list (3 ticked, 17 not).",
            );
            expect(cleared.structuredContent).toEqual({
                removed: 20,
                checked: 3,
                unchecked: 17,
                store_id: null,
                store: null,
            });
            expect(await count("grocery_lines")).toBe(0);
            expect(await count("notice_dismissals")).toBe(0);

            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await count("grocery_lines")).toBe(20);
            expect(await count("notice_dismissals")).toBe(5);
            expect(await fingerprint()).toBe(before);
        });

        test("with the switch Off, clear_grocery_list is refused by name while list_grocery_lines and list_stores still work", async () => {
            const costco = await makeStore("Costco");
            await line(costco, "Eggs");
            await switchOff();

            const refused = await call("clear_grocery_list");
            expect(refused.isError).toBe(true);
            expect(text(refused)).toContain(REFUSAL);
            expect(await count("grocery_lines")).toBe(1);

            const list = await call("list_grocery_lines");
            expect(list.isError).toBeFalsy();
            expect(text(list)).toContain("Eggs");
            const stores = await call("list_stores");
            expect(stores.isError).toBeFalsy();
            expect(stores.structuredContent!.stores[0]).toMatchObject({
                name: "Costco",
                line_count: 1,
            });
        });

        test("list_stores and create_store work with the switch Off, because neither is destructive", async () => {
            await switchOff();
            const made = await call("create_store", { name: "Aldi" });
            expect(made.isError).toBeFalsy();
            expect(text(made)).not.toContain("undo");
            expect(await actions()).toEqual([]);
            const listed = await call("list_stores");
            expect(listed.isError).toBeFalsy();
            expect(
                listed.structuredContent!.stores.map((s: any) => s.name),
            ).toEqual(["Aldi"]);
        });

        test("list_stores gives the stores in order with sections, counts and the preferences", async () => {
            const costco = await makeStore("Costco", ["Produce", "Deli"]);
            const aldi = await makeStore("Aldi");
            await line(costco, "Kale", "Produce");
            await line(costco, "Ham", "Deli");
            await line(costco, "Rice", "Other");
            await call("update_store", { id: aldi.id, is_default: true });
            await call("set_store_sections", {
                store_id: costco.id,
                hide: ["Deli"],
            });

            const listed = await call("list_stores");
            const sc = listed.structuredContent!;
            expect(sc.default_store_id).toBe(aldi.id);
            expect(sc.use_usual_store).toBe(false);
            expect(
                sc.stores.map((s: any) => [
                    s.name,
                    s.position,
                    s.is_default,
                    s.line_count,
                ]),
            ).toEqual([
                ["Costco", 1, false, 3],
                ["Aldi", 2, true, 0],
            ]);
            expect(
                sc.stores[0].sections.map((s: any) => [
                    s.name,
                    s.position,
                    s.hidden,
                    s.is_other,
                    s.line_count,
                ]),
            ).toEqual([
                ["Produce", 1, false, false, 1],
                ["Deli", 2, true, false, 1],
                ["Other", 3, false, true, 1],
            ]);
            expect(text(listed)).toContain("2 stores. Default store: Aldi.");
            expect(text(listed)).toContain("Deli (hidden) [1]");
        });

        test("create_store with no sections gets the app's defaults and with sections gets exactly those plus Other", async () => {
            const plain = await call("create_store", { name: "Costco" });
            expect(
                (plain.structuredContent!.sections as { name: string }[]).map(
                    (s) => s.name,
                ),
            ).toEqual([
                "Produce",
                "Dairy",
                "Meat & seafood",
                "Bakery",
                "Frozen",
                "Pantry",
                "Beverages",
                "Household",
                "Other",
            ]);
            const custom = await call("create_store", {
                name: "Deli",
                sections: ["Meat", "Cheese"],
            });
            expect(
                (
                    custom.structuredContent!.sections as {
                        name: string;
                        is_other: boolean;
                    }[]
                ).map((s) => [s.name, s.is_other]),
            ).toEqual([
                ["Meat", false],
                ["Cheese", false],
                ["Other", true],
            ]);
            const dup = await call("create_store", { name: "Deli" });
            expect(dup.isError).toBe(true);
            expect(text(dup)).toContain("That store already exists.");
            expect(await storeNames()).toEqual(["Costco", "Deli"]);
        });

        test("delete_store asks what to do with the lines, and refuses a move with nowhere to go", async () => {
            const only = await makeStore("Costco");
            await line(only, "Eggs");
            const before = await fingerprint();

            const unasked = await call("delete_store", { id: only.id });
            expect(unasked.isError).toBe(true);
            expect(text(unasked)).toContain(
                'Costco has 1 line on the list. Choose what to do with it: lines "move"',
            );
            const alone = await call("delete_store", {
                id: only.id,
                lines: "move",
            });
            expect(alone.isError).toBe(true);
            expect(text(alone)).toContain(
                "There is no other store to move the lines to",
            );
            const stray = await call("delete_store", {
                id: only.id,
                lines: "delete",
                move_to: only.id,
            });
            expect(stray.isError).toBe(true);
            expect(text(stray)).toContain(
                'move_to only applies with lines "move"',
            );
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
        });

        test("delete_store moves the lines to the default store when move_to is left out, and an empty store needs no choice", async () => {
            const costco = await makeStore("Costco");
            const aldi = await makeStore("Aldi");
            const lidl = await makeStore("Lidl");
            await setDefault(lidl.id);
            await line(costco, "Eggs", "Dairy");
            const moved = await call("delete_store", {
                id: costco.id,
                lines: "move",
            });
            expect(moved.isError).toBeFalsy();
            expect(text(moved)).toContain("moved its 1 line to Lidl");
            // What the text says is what the data says.
            expect(moved.structuredContent).toMatchObject({
                deleted: true,
                moved_lines: 1,
                deleted_lines: 0,
                moved_to: { id: lidl.id, name: "Lidl" },
            });
            expect((await lineRows())[0]!.store_id).toBe(lidl.id);
            // The default stays: it was another store that went.
            expect(await preferences()).toMatchObject({
                "grocery.default_store_id": lidl.id,
            });

            // A move asked of a store with no lines moves nothing and says nothing of it.
            const nothing = await call("delete_store", {
                id: aldi.id,
                lines: "move",
                move_to: lidl.id,
            });
            expect(nothing.isError).toBeFalsy();
            expect(nothing.structuredContent).toMatchObject({
                deleted: true,
                moved_lines: 0,
                moved_to: null,
            });
            expect(text(nothing)).toStartWith(
                "Deleted store Aldi (it had no lines).",
            );
            const entry = (await actions()).at(-1)!;
            expect(entry.tool).toBe("delete_store");
            expect((await undo(entry.id)).status).toBe("undone");
            expect(await storeNames()).toContain("Aldi");

            const empty = await call("delete_store", { id: aldi.id });
            expect(empty.isError).toBeFalsy();
            expect(text(empty)).toStartWith(
                "Deleted store Aldi (it had no lines).",
            );
            expect(await storeNames()).toEqual(["Lidl"]);
        });

        test("delete_store of an id that is no store is an error that points at list_stores, like update_store, and records nothing", async () => {
            const id = crypto.randomUUID();
            const result = await call("delete_store", { id });
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(
                `No store found with id ${id}. Use list_stores.`,
            );
            const sameAsUpdate = await call("update_store", { id, name: "X" });
            expect(text(sameAsUpdate)).toBe(text(result));
            expect(await actions()).toEqual([]);
        });

        test("delete_store with lines move refuses when a line reaches the store while it runs, instead of deleting it", async () => {
            const costco = await makeStore("Costco");
            const aldi = await makeStore("Aldi");
            await line(costco, "Eggs", "Dairy");
            const before = await fingerprint();
            const sql = getCtx().sql;
            // Stands in for another request adding a line to Costco while the
            // tool runs: fires once, when the first line leaves Costco.
            await sql.unsafe(`
                create table public.qa_once (done boolean);
                create function public.qa_add_line() returns trigger language plpgsql as $$
                begin
                  if exists (select 1 from public.qa_once) then return new; end if;
                  insert into public.qa_once values (true);
                  insert into public.grocery_lines
                    select (jsonb_populate_record(new, jsonb_build_object('id', gen_random_uuid(), 'store_id', old.store_id, 'section_id', old.section_id, 'display_name', 'Late line'))).*;
                  return new;
                end $$;
                create trigger qa_add_line after update of store_id on public.grocery_lines
                  for each row when (old.store_id is distinct from new.store_id) execute function public.qa_add_line();
            `);
            try {
                const result = await call("delete_store", {
                    id: costco.id,
                    lines: "move",
                    move_to: aldi.id,
                });
                expect(result.isError).toBe(true);
                expect(text(result)).toContain("Try again");
                expect(text(result)).not.toContain("Deleted store");
            } finally {
                await sql.unsafe(
                    `drop trigger qa_add_line on public.grocery_lines; drop function public.qa_add_line(); drop table public.qa_once;`,
                );
            }
            // Nothing moved, nothing deleted, nothing recorded.
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
        });

        // Stands in for another request adding a line to Dairy while
        // set_store_sections removes it: `moved` fires once as the first line
        // leaves Dairy (before the sections are recorded), `deleting` fires as
        // the section itself is deleted (after they were).
        async function removeDairyWithALateLine(
            moment: "moved" | "deleting",
        ): Promise<void> {
            const costco = await makeStore("Costco");
            await line(costco, "Milk", "Dairy");
            const before = await fingerprint();
            const sql = getCtx().sql;
            const moved = moment === "moved";
            await sql.unsafe(`
                create table public.qa_once (done boolean);
                create function public.qa_late() returns trigger language plpgsql as $$
                begin
                  if exists (select 1 from public.qa_once) then return ${moved ? "new" : "old"}; end if;
                  insert into public.qa_once values (true);
                  insert into public.grocery_lines
                    select (jsonb_populate_record(l, jsonb_build_object('id', gen_random_uuid(), 'section_id', ${moved ? "old.section_id" : "old.id"}, 'display_name', 'Late line'))).*
                    from public.grocery_lines l limit 1;
                  return ${moved ? "new" : "old"};
                end $$;
                create trigger qa_late ${
                    moved
                        ? "after update of section_id on public.grocery_lines for each row when (old.section_id is distinct from new.section_id)"
                        : "before delete on public.grocery_sections for each row"
                } execute function public.qa_late();
            `);
            try {
                const result = await call("set_store_sections", {
                    store_id: costco.id,
                    remove: ["Dairy"],
                });
                expect(result.isError).toBe(true);
                expect(text(result)).toContain("Try again");
                expect(text(result)).not.toContain("moved to Other");
            } finally {
                await sql.unsafe(
                    `drop trigger qa_late on public.${moved ? "grocery_lines" : "grocery_sections"}; drop function public.qa_late(); drop table public.qa_once;`,
                );
            }
            // Nothing moved, nothing deleted, nothing recorded.
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
        }

        test("set_store_sections remove refuses when a line reaches the section after the lines were moved, instead of deleting it", async () => {
            await removeDairyWithALateLine("moved");
        });

        test("set_store_sections remove refuses when a line reaches the section as it is deleted, instead of deleting it", async () => {
            await removeDairyWithALateLine("deleting");
        });

        test("undoing set_store_sections keeps a section a person renamed since, and still removes one nobody touched", async () => {
            const deli = await makeStore("Deli", ["Meat"]);
            const done = await call("set_store_sections", {
                store_id: deli.id,
                add: ["Olives", "Pickles"],
            });
            expect(done.isError).toBeFalsy();
            const [entry] = (await actions()).filter(
                (row) => row.tool === "set_store_sections",
            );
            // A person renames and hides one of the sections the agent added.
            await getCtx().sql`
                update public.grocery_sections
                set name = ${"Olives & Pickles"}, hidden = true
                where store_id = ${deli.id} and name = ${"Olives"}
            `;
            const before = await fingerprint();
            const out = await undo(entry!.id);
            expect(out.status).toBe("conflict");
            expect(out.message).toContain("was changed since");
            // Nothing was undone, so the untouched section stays too.
            expect(await fingerprint()).toBe(before);
            expect(await sectionNames(deli.id)).toContain("Olives & Pickles");
            expect(
                (
                    await rows(
                        "select undone_at from public.agent_actions where id = $1",
                        entry!.id,
                    )
                )[0]!.undone_at,
            ).toBeNull();

            // Once the person's edit is gone from the picture, undo is whole again.
            await getCtx().sql`
                update public.grocery_sections
                set name = ${"Olives"}, hidden = false
                where store_id = ${deli.id} and name = ${"Olives & Pickles"}
            `;
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await sectionNames(deli.id)).toEqual(["Meat", "Other"]);
        });

        test("set_store_sections reports no renames when they cancel out, and a chain as one", async () => {
            const costco = await makeStore("Costco");
            const back = await call("set_store_sections", {
                store_id: costco.id,
                rename: [
                    { section: "Dairy", name: "Milk aisle" },
                    { section: "Milk aisle", name: "Dairy" },
                ],
            });
            expect(back.isError).toBeFalsy();
            expect(back.structuredContent!.changed).toBe(false);
            expect(back.structuredContent!.renamed).toEqual([]);
            const chain = await call("set_store_sections", {
                store_id: costco.id,
                rename: [
                    { section: "Dairy", name: "Milk aisle" },
                    { section: "Milk aisle", name: "Cold" },
                ],
            });
            expect(chain.structuredContent!.renamed).toEqual([
                { from: "Dairy", to: "Cold" },
            ]);
        });

        test("set_store_sections order listing a section twice is refused", async () => {
            const costco = await makeStore("Costco");
            const before = await fingerprint();
            for (const order of [
                ["Bakery", "bakery"],
                ["Bakery", costco.sections["Bakery"]!],
            ]) {
                const result = await call("set_store_sections", {
                    store_id: costco.id,
                    order,
                });
                expect(result.isError).toBe(true);
                expect(text(result)).toContain("A section is listed twice.");
            }
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
        });

        test("create_store refuses a name another store has in any case, with or without sections", async () => {
            await makeStore("Costco");
            const before = await fingerprint();
            for (const args of [
                { name: "costco" },
                { name: " COSTCO ", sections: ["Meat"] },
            ]) {
                const result = await call("create_store", args);
                expect(result.isError).toBe(true);
                expect(text(result)).toContain("That store already exists.");
            }
            expect(await fingerprint()).toBe(before);
            expect(await storeNames()).toEqual(["Costco"]);
        });

        test("set_store_sections refuses a name another section holds when the call starts, removed or renamed in the same call or not, and the two-call version works and undoes call by call", async () => {
            const deli = await makeStore("Deli", ["Meat", "Cheese", "Bread"]);
            await line(deli, "Brie", "Cheese");
            const before = await fingerprint();

            const readd = await call("set_store_sections", {
                store_id: deli.id,
                remove: ["Cheese"],
                add: ["Cheese"],
            });
            expect(readd.isError).toBe(true);
            expect(text(readd)).toContain("two calls");
            const swap = await call("set_store_sections", {
                store_id: deli.id,
                rename: [
                    { section: "Meat", name: "Beef" },
                    { section: "Cheese", name: "Meat" },
                ],
            });
            expect(swap.isError).toBe(true);
            expect(text(swap)).toContain("two calls");
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);

            // Remove, then add the name: two calls, each recorded and each undone.
            for (const args of [{ remove: ["Cheese"] }, { add: ["Cheese"] }]) {
                const done = await call("set_store_sections", {
                    store_id: deli.id,
                    ...args,
                });
                expect(done.isError).toBeFalsy();
            }
            const [removed, added] = await actions();
            expect(await sectionNames(deli.id)).toEqual([
                "Meat",
                "Bread",
                "Cheese",
                "Other",
            ]);
            expect((await undo(added!.id)).status).toBe("undone");
            expect((await undo(removed!.id)).status).toBe("undone");
            expect(await fingerprint()).toBe(before);

            // The same for a swap of names.
            await getCtx().sql`delete from public.agent_actions`;
            for (const rename of [
                [{ section: "Meat", name: "Beef" }],
                [{ section: "Cheese", name: "Meat" }],
            ]) {
                const done = await call("set_store_sections", {
                    store_id: deli.id,
                    rename,
                });
                expect(done.isError).toBeFalsy();
            }
            const [first, second] = await actions();
            expect(await sectionNames(deli.id)).toEqual([
                "Beef",
                "Meat",
                "Bread",
                "Other",
            ]);
            expect((await undo(second!.id)).status).toBe("undone");
            expect((await undo(first!.id)).status).toBe("undone");
            expect(await fingerprint()).toBe(before);
        });

        test("undoing delete_store of the default store puts the default back", async () => {
            const costco = await makeStore("Costco");
            const aldi = await makeStore("Aldi");
            await setDefault(costco.id);
            await line(costco, "Eggs");
            const result = await call("delete_store", {
                id: costco.id,
                lines: "move",
                move_to: aldi.id,
            });
            expect(result.structuredContent).toMatchObject({
                deleted: true,
                moved_lines: 1,
                cleared_default: true,
                moved_to: { id: aldi.id, name: "Aldi" },
            });
            expect(await preferences()).not.toHaveProperty(
                "grocery.default_store_id",
            );
            const [entry] = await actions();
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await preferences()).toMatchObject({
                "grocery.default_store_id": costco.id,
            });
            expect((await lineRows())[0]!.store_id).toBe(costco.id);
        });

        test("update_store leaves a default another store holds alone, and no change records nothing", async () => {
            const costco = await makeStore("Costco");
            const aldi = await makeStore("Aldi");
            await setDefault(aldi.id);
            const result = await call("update_store", {
                id: costco.id,
                is_default: false,
            });
            expect(result.isError).toBeFalsy();
            expect(text(result)).toContain("nothing changed");
            expect(text(result)).not.toContain("undo");
            expect(await preferences()).toMatchObject({
                "grocery.default_store_id": aldi.id,
            });
            expect(await actions()).toEqual([]);

            const nothing = await call("update_store", { id: costco.id });
            expect(nothing.isError).toBe(true);
            expect(text(nothing)).toContain("Nothing to change");
        });

        test("update_store refuses a name another store has and an unknown store, changing nothing", async () => {
            const costco = await makeStore("Costco");
            await makeStore("Aldi");
            const before = await fingerprint();
            const taken = await call("update_store", {
                id: costco.id,
                name: "aldi",
            });
            expect(taken.isError).toBe(true);
            expect(text(taken)).toContain("That store already exists.");
            const unknown = await call("update_store", {
                id: crypto.randomUUID(),
                name: "X",
            });
            expect(unknown.isError).toBe(true);
            expect(text(unknown)).toContain("No store found with id");
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
        });

        test("reorder_stores names a store left out, and the same order records nothing", async () => {
            const a = await makeStore("Alpha");
            const b = await makeStore("Beta");
            const missing = await call("reorder_stores", {
                ordered_ids: [b.id],
            });
            expect(missing.isError).toBe(true);
            expect(text(missing)).toContain(
                "List every store once. Missing: Alpha.",
            );
            const same = await call("reorder_stores", {
                ordered_ids: [a.id, b.id],
            });
            expect(same.isError).toBeFalsy();
            expect(text(same)).toContain("already in that order");
            expect(same.structuredContent).toMatchObject({ changed: false });
            expect(await actions()).toEqual([]);
        });

        test("set_store_sections that changes nothing records nothing, and a bad reference rolls the whole call back", async () => {
            const deli = await makeStore("Deli", ["Meat", "Cheese"]);
            const before = await fingerprint();
            const same = await call("set_store_sections", {
                store_id: deli.id,
                show: ["Meat"],
                order: ["Meat", "Cheese"],
            });
            expect(same.isError).toBeFalsy();
            expect(text(same)).toContain("nothing changed");
            expect(await actions()).toEqual([]);

            const bad = await call("set_store_sections", {
                store_id: deli.id,
                add: ["Olives"],
                hide: ["Nope"],
            });
            expect(bad.isError).toBe(true);
            expect(text(bad)).toContain('Deli has no section "Nope".');
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);

            const other = await call("set_store_sections", {
                store_id: deli.id,
                hide: ["Other"],
            });
            expect(other.isError).toBe(true);
            expect(text(other)).toContain(
                "The Other section cannot be hidden.",
            );
            expect(await fingerprint()).toBe(before);
        });

        test("move_grocery_lines reports ids that are no lines and lines already there, and moves the rest", async () => {
            const costco = await makeStore("Costco");
            const eggs = await line(costco, "Eggs", "Dairy");
            const kale = await line(costco, "Kale", "Produce");
            const ghost = crypto.randomUUID();
            const result = await call("move_grocery_lines", {
                line_ids: [eggs, kale, ghost],
                section: "Dairy",
            });
            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                unchanged: [eggs],
                not_found: [ghost],
                moved: [{ id: kale, section: "Dairy" }],
            });
            expect(text(result)).toContain("1 line already there.");
            expect(text(result)).toContain(`Not found: ${ghost}.`);

            const nothing = await call("move_grocery_lines", {
                line_ids: [ghost],
                store_id: costco.id,
            });
            expect(nothing.isError).toBeFalsy();
            expect(text(nothing)).toContain("No lines moved.");
            expect(text(nothing)).not.toContain("undo");
            expect(await actions()).toHaveLength(1);

            const nowhere = await call("move_grocery_lines", {
                line_ids: [eggs],
            });
            expect(nowhere.isError).toBe(true);
            expect(text(nowhere)).toContain("Say where to move the lines");
        });

        test("update_grocery_line clears a note with null, and a line that is none is reported without a record", async () => {
            const costco = await makeStore("Costco");
            const id = await line(costco, "Eggs");
            await call("update_grocery_line", { id, note: "large" });
            const cleared = await call("update_grocery_line", {
                id,
                note: null,
            });
            expect(cleared.isError).toBeFalsy();
            expect((await lineRows())[0]!.note).toBeNull();

            const none = await call("update_grocery_line", {
                id: crypto.randomUUID(),
                amount: 3,
            });
            expect(none.isError).toBeFalsy();
            expect(text(none)).toContain("No grocery line found with id");
            expect(none.structuredContent).toEqual({
                found: false,
                changed: false,
                line: null,
            });
            expect(await actions()).toHaveLength(2);

            const bad = await call("update_grocery_line", { id, amount: 0 });
            expect(bad.isError).toBe(true);
            expect(text(bad)).toContain("Enter an amount greater than zero.");
        });

        test("an id that is not a UUID is refused with a message that says where ids come from", async () => {
            for (const [tool, args] of [
                ["delete_store", { id: "costco" }],
                ["clear_grocery_list", { store_id: "costco" }],
                ["reorder_stores", { ordered_ids: ["costco"] }],
                ["move_grocery_lines", { line_ids: ["x"], store_id: "costco" }],
            ] as const) {
                const result = await call(tool, args).catch(
                    (err: Error) =>
                        ({
                            isError: true,
                            content: [{ type: "text", text: err.message }],
                        }) as Result,
                );
                expect(result.isError, tool).toBe(true);
                expect(text(result), tool).toMatch(
                    /list_stores|list_grocery_lines/,
                );
            }
            expect(await actions()).toEqual([]);
        });

        test("removing sections refuses Other and a section the store lacks, rolling the whole call back", async () => {
            const deli = await makeStore("Deli", ["Meat", "Cheese"]);
            const ham = await line(deli, "Ham", "Meat");
            const before = await fingerprint();

            const other = await call("set_store_sections", {
                store_id: deli.id,
                remove: ["Meat", "Other"],
            });
            expect(other.isError).toBe(true);
            expect(text(other)).toContain(
                "The Other section cannot be removed.",
            );
            const nope = await call("set_store_sections", {
                store_id: deli.id,
                remove: ["Meat", "Nope"],
            });
            expect(nope.isError).toBe(true);
            expect(text(nope)).toContain('Deli has no section "Nope".');
            expect(await fingerprint()).toBe(before);
            expect(await actions()).toEqual([]);
            expect((await lineRows())[0]!.id).toBe(ham);
        });

        test("a removed section's result names it and how many lines moved, and the list shows them in Other", async () => {
            const deli = await makeStore("Deli", ["Meat", "Cheese"]);
            await line(deli, "Brie", "Cheese");
            const result = await call("set_store_sections", {
                store_id: deli.id,
                remove: ["Cheese"],
            });
            expect(result.structuredContent).toMatchObject({
                changed: true,
                removed: [{ name: "Cheese", moved_lines: 1 }],
            });
            const listed = await call("list_stores");
            expect(
                listed.structuredContent!.stores[0].sections.map((s: any) => [
                    s.name,
                    s.line_count,
                ]),
            ).toEqual([
                ["Meat", 0],
                ["Other", 1],
            ]);
            // Removing a section that no longer exists is an error, not a second record.
            const again = await call("set_store_sections", {
                store_id: deli.id,
                remove: ["Cheese"],
            });
            expect(again.isError).toBe(true);
            expect(await actions()).toHaveLength(1);
        });

        test("a plain member can clear and move the list but not change the stores", async () => {
            const costco = await makeStore("Costco");
            const aldi = await makeStore("Aldi");
            const id = await line(costco, "Eggs");
            const memberId = crypto.randomUUID();
            const { sql } = getCtx();
            await sql`insert into public.users (id, email) values (${memberId}, ${`m-${memberId}@foodable.test`})`;
            await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${householdId}, ${memberId}, 'member', 'Bee')
        `;
            const member: Who = {
                kind: "user",
                userId: memberId,
                client: "Claude",
            };

            const moved = await call(
                "move_grocery_lines",
                { line_ids: [id], store_id: aldi.id },
                "legacy",
                member,
            );
            expect(moved.isError).toBeFalsy();
            const listed = await call("list_stores", {}, "legacy", member);
            expect(listed.isError).toBeFalsy();
            for (const [tool, args] of [
                ["create_store", { name: "Lidl" }],
                ["update_store", { id: costco.id, name: "X" }],
                ["delete_store", { id: costco.id }],
                ["reorder_stores", { ordered_ids: [aldi.id, costco.id] }],
                ["set_store_sections", { store_id: costco.id, add: ["X"] }],
            ] as const) {
                const refused = await call(tool, args, "legacy", member);
                expect(refused.isError, tool).toBe(true);
                expect(text(refused), tool).toContain(
                    "only the household owner or an admin may call this",
                );
            }
            expect(await storeNames()).toEqual(["Costco", "Aldi"]);
            const cleared = await call(
                "clear_grocery_list",
                {},
                "legacy",
                member,
            );
            expect(cleared.isError).toBeFalsy();
            expect(await count("grocery_lines")).toBe(0);
            const [entry] = (await actions()).slice(-1);
            expect(entry).toMatchObject({ member_id: memberId });
        });

        test("the household token records no member and its owner can undo it", async () => {
            const costco = await makeStore("Costco");
            await line(costco, "Eggs");
            const before = await fingerprint();
            const result = await call("clear_grocery_list", {}, "legacy", {
                kind: "household",
                householdId,
            });
            expect(result.isError).toBeFalsy();
            expect(text(result)).toContain(UNDO_SENTENCE);
            const [entry] = await actions();
            expect(entry).toMatchObject({
                member_id: null,
                connection: "household token",
                tool: "clear_grocery_list",
            });
            expect((await undo(entry!.id)).status).toBe("undone");
            expect(await fingerprint()).toBe(before);
        });

        test.each(ERAS)(
            "list_stores, a destructive store tool and the refusal answer the same on both protocol eras (%p)",
            async (era) => {
                const costco = await makeStore("Costco");
                const aldi = await makeStore("Aldi");
                const listed = await call("list_stores", {}, era);
                expect(listed.structuredContent!.stores).toHaveLength(2);

                const reordered = await call(
                    "reorder_stores",
                    { ordered_ids: [aldi.id, costco.id] },
                    era,
                );
                expect(reordered.isError).toBeFalsy();
                expect(text(reordered)).toContain(UNDO_SENTENCE);
                expect(await actions()).toHaveLength(1);

                await switchOff();
                const refused = await call(
                    "reorder_stores",
                    { ordered_ids: [costco.id, aldi.id] },
                    era,
                );
                expect(refused.isError).toBe(true);
                expect(text(refused)).toContain(REFUSAL);
                expect(await storeNames()).toEqual(["Aldi", "Costco"]);
            },
        );

        test.each(ERAS)(
            "with the flag off none of the nine tools is listed or callable (%p)",
            async (era) => {
                setFlagsForTests(
                    createMemoryFlags({ "mcp-household-admin": false }),
                );
                const app = new Hono();
                app.all("/mcp", (c) => {
                    c.set("authContext", { kind: "user", userId: ownerId });
                    return handleMcp(c);
                });
                const client = new Client(
                    { name: "t", version: "0" },
                    { versionNegotiation: { mode: era } },
                );
                await client.connect(
                    new StreamableHTTPClientTransport(
                        new URL("http://test.local/mcp"),
                        {
                            fetch: async (url, init) =>
                                app.request(new Request(String(url), init)),
                        },
                    ),
                );
                try {
                    const listed = (await client.listTools()).tools.map(
                        (tool) => tool.name,
                    );
                    for (const name of ADMIN_TOOLS) {
                        expect(listed, name).not.toContain(name);
                    }
                    // The tools that were always there stay.
                    expect(listed).toContain("clear_checked_grocery_lines");
                    const called = await client
                        .callTool({ name: "clear_grocery_list", arguments: {} })
                        .catch((err: Error) => err);
                    expect(
                        called instanceof Error
                            ? called.message
                            : JSON.stringify(called),
                    ).toMatch(/not found|unknown|Unknown/i);
                    expect(await count("agent_actions")).toBe(0);
                } finally {
                    await client.close();
                }
            },
        );
    },
);
