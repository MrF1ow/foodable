import { describe, expect, test } from "bun:test";
import { createMemoryFoodsStore, findManualFood, newFood } from "./foods.js";
import { didYouMeanView, rememberAliasForChoice } from "./did-you-mean.js";

const HH = "hh-1";

describe("didYouMeanView", () => {
    test("one candidate heading and hidden fields", () => {
        const eggs = newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
        });
        const view = didYouMeanView(
            {
                name: "chicken egg",
                candidates: [
                    {
                        food: eggs,
                        why: "contains_words",
                    },
                ],
            },
            {
                food_name: "chicken egg",
                qty_amount: "2",
                food_id: "ignored",
                new_food: "1",
                remember_alias: "1",
                confirm_allergen: "1",
                store_id: "s1",
            },
        );
        expect(view.heading).toBe("Did you mean Eggs?");
        expect(view.candidates).toHaveLength(1);
        expect(view.candidates[0]!.foodId).toBe(eggs.id);
        expect(view.hiddenFields).toEqual({
            food_name: "chicken egg",
            qty_amount: "2",
            store_id: "s1",
            alias_name: "chicken egg",
        });
        expect(view.aliasLabel).toContain("Eggs");
    });

    test("several candidates", () => {
        const view = didYouMeanView(
            {
                name: "green onion",
                candidates: [
                    {
                        food: newFood({
                            householdId: HH,
                            kind: "food",
                            name: "Scallions",
                        }),
                        why: "word_match",
                    },
                    {
                        food: newFood({
                            householdId: HH,
                            kind: "food",
                            name: "Spring onions",
                            brand: "Fresh",
                        }),
                        why: "word_match",
                    },
                ],
            },
            { food_name: "green onion" },
        );
        expect(view.heading).toBe("Did you mean one of these?");
        expect(view.candidates).toHaveLength(2);
        expect(view.candidates[1]!.label).toBe("Fresh · Spring onions");
        expect(view.aliasLabel).toContain("the food you pick");
    });
});

describe("rememberAliasForChoice", () => {
    test("outcomes and resolves after set", async () => {
        const store = createMemoryFoodsStore();
        const eggs = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        expect(
            await rememberAliasForChoice(store, HH, eggs.id, "chicken egg"),
        ).toBe("set");
        expect(
            await findManualFood(store, HH, "food", "chicken egg"),
        ).toMatchObject({ id: eggs.id });
        expect(await rememberAliasForChoice(store, HH, eggs.id, "Eggs")).toBe(
            "same",
        );
        const other = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Tofu" }),
        );
        await store.setAlias(HH, "bean curd", other.id);
        expect(
            await rememberAliasForChoice(store, HH, eggs.id, "bean curd"),
        ).toBe("taken");
        expect(await rememberAliasForChoice(store, HH, eggs.id, "   ")).toBe(
            "skipped",
        );
        expect(
            await rememberAliasForChoice(store, HH, crypto.randomUUID(), "x"),
        ).toBe("skipped");
    });

    test("archived owner releases alias", async () => {
        const store = createMemoryFoodsStore();
        const archived = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Old pack" }),
        );
        await store.setAlias(HH, "stale label", archived.id);
        await store.updateFoodRow({
            ...archived,
            archivedAt: new Date().toISOString(),
        });
        const eggs = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        expect(
            await rememberAliasForChoice(store, HH, eggs.id, "stale label"),
        ).toBe("set");
        expect(await store.getAliasFoodId(HH, "stale label")).toBe(eggs.id);
    });
});
