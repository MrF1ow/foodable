import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import * as stockDb from "../../db/stock.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveStockStore } from "../../db/stock.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedFood,
    seedFridgeLocation,
    seedHousehold,
    seedMember,
} from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { findFoodById } from "../../domain/foods.js";
import { addFridgeItemAdjust, ledgerMatchesStock } from "../../domain/stock.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { householdRoutes } from "./household.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

// Settings › Household › Fridge places over one real database: the list, an
// add, and a removal that takes the place's items through the stock ledger.
const app = new Hono();
app.route("/", householdRoutes);

function request(userId: string, path: string, form?: Record<string, string>) {
    return app.request(`http://test${path}`, {
        method: form ? "POST" : "GET",
        headers: {
            cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
            ...(form
                ? { "content-type": "application/x-www-form-urlencoded" }
                : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
    });
}

describeDb(pgAvailable !== null, "Settings › Fridge places", (getCtx) => {
    let owner: string;
    let householdId: string;
    let member: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId: owner, householdId } = await seedHousehold(sql));
        member = await seedMember(sql, householdId, { displayName: "Bob" });
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    async function place(name: string): Promise<string> {
        return seedFridgeLocation(getCtx().sql, householdId, name);
    }

    /** An item put in through the stock ledger, as the app and the agents do. */
    async function stock(
        locationId: string,
        name: string,
        amount: number,
    ): Promise<string> {
        const foodId = await seedFood(getCtx().sql, householdId, { name });
        await asUser(
            owner,
            () =>
                addFridgeItemAdjust(
                    liveFridgeStore(),
                    liveStockStore(),
                    liveFoodsStore(),
                    {
                        householdId,
                        foodId,
                        amount,
                        unit: "g",
                        locationId,
                    },
                ),
            householdId,
        );
        return foodId;
    }

    async function ledgerWhole(foodId: string): Promise<boolean> {
        return asUser(
            owner,
            async () => {
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
                    await findFoodById(liveFoodsStore(), householdId, foodId),
                );
            },
            householdId,
        );
    }

    async function count(table: string): Promise<number> {
        const [row] = await getCtx().sql.unsafe(
            `select count(*)::int as n from public.${table}`,
        );
        return Number(row.n);
    }

    test("the page lists each place with its item count, and the remove dialog names that count", async () => {
        const freezer = await place("Freezer");
        await place("Pantry");
        await stock(freezer, "Peas", 100);
        await stock(freezer, "Fish", 200);
        const res = await request(owner, "/settings/household/places");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Fridge places");
        expect(html).toContain("2 items");
        expect(html).toContain("Empty");
        expect(html).toContain("2 items are in Freezer.");
        expect(html).toContain("Pantry is empty.");
        expect(html).toContain(
            `action="/settings/household/places/${freezer}/remove"`,
        );
        expect(html).toContain("Add a place");
    });

    test("adding a place shows it on the page and in the fridge, and a repeat name is refused in the add row", async () => {
        const added = await request(owner, "/settings/household/places/add", {
            name: "Garage",
        });
        expect(added.status).toBe(303);
        expect(added.headers.get("location")).toBe(
            "/settings/household/places",
        );
        expect(
            (
                await asUser(
                    owner,
                    () => liveFridgeStore().listLocations(householdId),
                    householdId,
                )
            ).map((row) => row.name),
        ).toEqual(["Garage"]);
        const again = await request(owner, "/settings/household/places/add", {
            name: "Garage",
        });
        expect(again.status).toBe(400);
        const html = await again.text();
        expect(html).toContain("That location already exists.");
        expect(html).toMatch(/fd-places-add[^>]*>\s*<details[^>]* open/);
        const cased = await request(owner, "/settings/household/places/add", {
            name: " garage ",
        });
        expect(cased.status).toBe(400);
        expect(await cased.text()).toContain("That location already exists.");
        expect(await count("fridge_locations")).toBe(1);
    });

    test("removing a place deletes its items with one adjust movement each, and the ledger still matches the stock", async () => {
        const freezer = await place("Freezer");
        const pantry = await place("Pantry");
        const peas = await stock(freezer, "Peas", 100);
        const fish = await stock(freezer, "Fish", 200);
        const salt = await stock(pantry, "Salt", 50);
        const movementsBefore = await count("stock_movements");
        expect(movementsBefore).toBe(3);

        const res = await request(
            owner,
            `/settings/household/places/${freezer}/remove`,
            {},
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/household/places");

        expect(await count("fridge_locations")).toBe(1);
        expect(await count("fridge_items")).toBe(1);
        const adjusts = await getCtx().sql.unsafe(
            `select food_id, delta::float as delta, reason
             from public.stock_movements
             where reason = 'adjust' and delta < 0
             order by delta`,
        );
        expect(adjusts.map((row: any) => [row.food_id, row.delta])).toEqual([
            [fish, -200],
            [peas, -100],
        ]);
        expect(await count("stock_movements")).toBe(movementsBefore + 2);
        for (const food of [peas, fish, salt]) {
            expect(await ledgerWhole(food)).toBe(true);
        }
    });

    test("a removal that fails part-way leaves the place, its items and the ledger as they were", async () => {
        const freezer = await place("Freezer");
        await stock(freezer, "Peas", 100);
        await stock(freezer, "Fish", 200);
        const before = await count("stock_movements");
        const real = stockDb.liveStockStore();
        let inserts = 0;
        const spy = spyOn(stockDb, "liveStockStore").mockImplementation(() => ({
            ...real,
            insertMovement: async (row) => {
                inserts += 1;
                if (inserts === 2) throw new Error("disk full");
                return real.insertMovement(row);
            },
        }));
        try {
            const res = await request(
                owner,
                `/settings/household/places/${freezer}/remove`,
                {},
            );
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Could not save that.");
        } finally {
            spy.mockRestore();
        }
        expect(inserts).toBe(2);
        expect(await count("fridge_locations")).toBe(1);
        expect(await count("fridge_items")).toBe(2);
        expect(await count("stock_movements")).toBe(before);
    });

    test("removing a place that is gone says so and changes nothing", async () => {
        const kept = await place("Pantry");
        await stock(kept, "Salt", 50);
        const res = await request(
            owner,
            `/settings/household/places/${crypto.randomUUID()}/remove`,
            {},
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("That place is already gone.");
        expect(await count("fridge_locations")).toBe(1);
        expect(await count("fridge_items")).toBe(1);
    });

    test("a member reads the list but can neither add nor remove", async () => {
        const freezer = await place("Freezer");
        const res = await request(member, "/settings/household/places");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Freezer");
        expect(html).not.toContain("Add a place");
        expect(html).not.toContain("/remove");
        const add = await request(member, "/settings/household/places/add", {
            name: "Garage",
        });
        expect(add.status).toBe(403);
        const remove = await request(
            member,
            `/settings/household/places/${freezer}/remove`,
            {},
        );
        expect(remove.status).toBe(403);
        expect(await count("fridge_locations")).toBe(1);
    });

    describe("the plurals switch", () => {
        test("the household page posts it, and the owner's post turns it on and off", async () => {
            const page = await (
                await request(owner, "/settings/household")
            ).text();
            expect(page).toContain("Plurals are the same food");
            expect(page).toContain(
                'action="/settings/household/plurals-same-food"',
            );
            expect(page).toContain('name="plurals_same_food" value="true"');
            const on = await request(
                owner,
                "/settings/household/plurals-same-food",
                { plurals_same_food: "true" },
            );
            expect(on.status).toBe(303);
            const after = await (
                await request(owner, "/settings/household")
            ).text();
            expect(after).toContain('name="plurals_same_food" value="false"');
            const off = await request(
                owner,
                "/settings/household/plurals-same-food",
                { plurals_same_food: "false" },
            );
            expect(off.status).toBe(303);
            expect(
                await (await request(owner, "/settings/household")).text(),
            ).toContain('name="plurals_same_food" value="true"');
        });

        test("a member cannot change it", async () => {
            const res = await request(
                member,
                "/settings/household/plurals-same-food",
                { plurals_same_food: "true" },
            );
            expect(res.status).toBe(403);
        });
    });
});
