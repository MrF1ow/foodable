import { test, expect } from "bun:test";
import {
    addAllergen,
    addDislike,
    addPersonRule,
    addStoreRule,
    removePersonRuleRow,
    createMemoryRulesStore,
    RulesInputError,
} from "./rules.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";

const HH = "hh-1";
const USER = "11111111-1111-4111-8111-111111111111";

test("store rule text is saved and listed", async () => {
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Safeway");
    const rules = createMemoryRulesStore();
    const saved = await addStoreRule(rules, {
        householdId: HH,
        storeId: store.id,
        body: "  dairy is on the back wall  ",
    });
    expect(saved.body).toBe("dairy is on the back wall");
    const listed = await rules.listStoreRules(store.id);
    expect(listed.map((row) => row.body)).toEqual([
        "dairy is on the back wall",
    ]);
});

test("empty store rule is refused", async () => {
    const rules = createMemoryRulesStore();
    await expect(
        addStoreRule(rules, { householdId: HH, storeId: "store-1", body: " " }),
    ).rejects.toThrow(RulesInputError);
});

test("allergen list accepts peanut and rejects unknown codes", async () => {
    const rules = createMemoryRulesStore();
    const peanut = await addAllergen(rules, {
        householdId: HH,
        userId: USER,
        allergen: "peanut",
    });
    expect(peanut.allergen).toBe("peanut");
    expect(peanut.otherLabel).toBeNull();
    const listed = await rules.listAllergens(HH, USER);
    expect(listed.map((row) => row.allergen)).toEqual(["peanut"]);
    await expect(
        addAllergen(rules, {
            householdId: HH,
            userId: USER,
            allergen: "gluten",
        }),
    ).rejects.toThrow(/unknown allergen/i);
    await expect(
        addAllergen(rules, {
            householdId: HH,
            userId: USER,
            allergen: "peanut",
        }),
    ).rejects.toThrow(/already listed/i);
});

test("dislike cilantro is listed for the member", async () => {
    const rules = createMemoryRulesStore();
    const saved = await addDislike(rules, {
        householdId: HH,
        userId: USER,
        displayName: " cilantro ",
    });
    expect(saved.displayName).toBe("cilantro");
    const listed = await rules.listDislikes(HH, USER);
    expect(listed.map((row) => row.displayName)).toEqual(["cilantro"]);
});

test("removing a person's entry only touches that person", async () => {
    const rules = createMemoryRulesStore();
    const other = "22222222-2222-4222-8222-222222222222";
    const rule = await addPersonRule(rules, {
        householdId: HH,
        userId: USER,
        body: "No pork",
    });
    const allergen = await addAllergen(rules, {
        householdId: HH,
        userId: USER,
        allergen: "peanut",
    });
    const dislike = await addDislike(rules, {
        householdId: HH,
        userId: USER,
        displayName: "Olives",
    });

    // Someone else's id cannot reach this person's rows.
    await expect(
        removePersonRuleRow(rules, "rule", {
            householdId: HH,
            userId: other,
            id: rule.id,
        }),
    ).rejects.toBeInstanceOf(RulesInputError);
    expect(await rules.listPersonRules(HH, USER)).toHaveLength(1);

    const ref = { householdId: HH, userId: USER };
    await removePersonRuleRow(rules, "rule", { ...ref, id: rule.id });
    await removePersonRuleRow(rules, "allergen", { ...ref, id: allergen.id });
    await removePersonRuleRow(rules, "dislike", { ...ref, id: dislike.id });
    expect(await rules.listPersonRules(HH, USER)).toEqual([]);
    expect(await rules.listAllergens(HH, USER)).toEqual([]);
    expect(await rules.listDislikes(HH, USER)).toEqual([]);
    await expect(
        removePersonRuleRow(rules, "rule", { ...ref, id: rule.id }),
    ).rejects.toThrow(/already gone/);
});
