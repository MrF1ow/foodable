import { expect, test } from "bun:test";
import {
    applyLineEdit,
    applyLinePlacements,
    findSection,
    lineEditChanges,
    linesToClear,
    planGroceryLineEdit,
    planGroceryLineMoves,
    planLineEdit,
    planLineMoves,
    readStoreLayout,
} from "./grocery-lines.js";
import {
    createMemoryGroceryStore,
    GroceryInputError,
    type GroceryLine,
} from "./grocery.js";
import { createStoreWithSections } from "./grocery-stores.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
    SettingsInputError,
} from "./settings.js";

const HH = "hh-1";

function line(
    id: string,
    storeId: string,
    sectionId: string,
    over: Partial<GroceryLine> = {},
): GroceryLine {
    return {
        id,
        householdId: HH,
        storeId,
        sectionId,
        kind: "food",
        displayName: id,
        quantity: { amount: 1, unit: "each" },
        foodId: null,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
        ...over,
    };
}

/** Two stores: Costco with the default sections, Aldi with Produce, Deli and Other. */
async function seeded() {
    const settings = createMemorySettingsStore();
    const grocery = createMemoryGroceryStore();
    const costco = await createGroceryStore(settings, HH, "Costco");
    const aldi = (
        await createStoreWithSections(settings, HH, "Aldi", ["Produce", "Deli"])
    ).store;
    const costcoSections = await settings.listSections(costco.id);
    const aldiSections = await settings.listSections(aldi.id);
    const pick = (sections: typeof costcoSections, name: string): string =>
        sections.find((row) => row.name === name)!.id;
    return {
        settings,
        grocery,
        costco,
        aldi,
        costcoProduce: pick(costcoSections, "Produce"),
        costcoDairy: pick(costcoSections, "Dairy"),
        costcoPantry: pick(costcoSections, "Pantry"),
        aldiProduce: pick(aldiSections, "Produce"),
        aldiDeli: pick(aldiSections, "Deli"),
        aldiOther: pick(aldiSections, "Other"),
    };
}

test("findSection takes an id or a name in any case", async () => {
    const s = await seeded();
    const sections = await s.settings.listSections(s.aldi.id);
    expect(findSection(sections, s.aldiDeli)?.name).toBe("Deli");
    expect(findSection(sections, "  deli ")?.id).toBe(s.aldiDeli);
    expect(findSection(sections, "Bakery")).toBeUndefined();
});

test("linesToClear is every line, or one store's, and refuses an unknown store", async () => {
    const s = await seeded();
    const lines = [
        line("a", s.costco.id, s.costcoProduce, { checked: true }),
        line("b", s.costco.id, s.costcoDairy),
        line("c", s.aldi.id, s.aldiProduce),
    ];
    const stores = [s.costco, s.aldi];
    expect(linesToClear(lines, stores).map((row) => row.id)).toEqual([
        "a",
        "b",
        "c",
    ]);
    expect(linesToClear(lines, stores, s.aldi.id).map((row) => row.id)).toEqual(
        ["c"],
    );
    expect(() => linesToClear(lines, stores, "nope")).toThrow("Unknown store.");
});

test("planLineMoves to another store keeps the aisle by name, else lands in Other", async () => {
    const s = await seeded();
    const layout = await readStoreLayout(s.settings, HH);
    const lines = [
        line("veg", s.costco.id, s.costcoProduce),
        line("milk", s.costco.id, s.costcoDairy),
    ];
    const plan = planLineMoves({
        lines,
        layout,
        lineIds: ["veg", "milk", "ghost"],
        target: { storeId: s.aldi.id },
    });
    expect(plan.notFound).toEqual(["ghost"]);
    expect(plan.unchanged).toEqual([]);
    expect(
        plan.moves.map((row) => [row.line.id, row.storeId, row.sectionId]),
    ).toEqual([
        ["veg", s.aldi.id, s.aldiProduce],
        ["milk", s.aldi.id, s.aldiOther],
    ]);
});

test("planLineMoves with a section names it in the destination store and refuses one it lacks", async () => {
    const s = await seeded();
    const layout = await readStoreLayout(s.settings, HH);
    const lines = [line("veg", s.costco.id, s.costcoProduce)];
    const moved = planLineMoves({
        lines,
        layout,
        lineIds: ["veg"],
        target: { storeId: s.aldi.id, section: "deli" },
    });
    expect(moved.moves[0]).toMatchObject({
        storeId: s.aldi.id,
        sectionId: s.aldiDeli,
    });
    // A section alone is a section of the line's own store.
    const within = planLineMoves({
        lines,
        layout,
        lineIds: ["veg"],
        target: { section: "Pantry" },
    });
    expect(within.moves[0]).toMatchObject({
        storeId: s.costco.id,
        sectionId: s.costcoPantry,
    });
    expect(() =>
        planLineMoves({
            lines,
            layout,
            lineIds: ["veg"],
            target: { storeId: s.aldi.id, section: "Bakery" },
        }),
    ).toThrow(
        /Aldi has no section "Bakery"\. Its sections: Produce, Deli, Other/,
    );
});

test("planLineMoves leaves lines already in place alone and wants a destination", async () => {
    const s = await seeded();
    const layout = await readStoreLayout(s.settings, HH);
    const lines = [line("veg", s.costco.id, s.costcoProduce)];
    const plan = planLineMoves({
        lines,
        layout,
        lineIds: ["veg", "veg"],
        target: { storeId: s.costco.id, section: "Produce" },
    });
    expect(plan.moves).toEqual([]);
    expect(plan.unchanged.map((row) => row.id)).toEqual(["veg"]);
    expect(() =>
        planLineMoves({ lines, layout, lineIds: ["veg"], target: {} }),
    ).toThrow("Say where to move the lines");
    expect(() =>
        planLineMoves({
            lines,
            layout,
            lineIds: ["veg"],
            target: { storeId: "nope" },
        }),
    ).toThrow("Unknown store.");
});

test("moving to a store with no sections is refused, not guessed", async () => {
    const s = await seeded();
    const bare = await s.settings.insertStore({
        id: "bare",
        householdId: HH,
        name: "Bare",
        sortOrder: 9,
    });
    const layout = await readStoreLayout(s.settings, HH);
    expect(() =>
        planLineMoves({
            lines: [line("veg", s.costco.id, s.costcoProduce)],
            layout,
            lineIds: ["veg"],
            target: { storeId: bare.id },
        }),
    ).toThrow(SettingsInputError);
});

test("planGroceryLineMoves reads the household's list and applyLinePlacements writes it", async () => {
    const s = await seeded();
    await s.grocery.insertLine(line("veg", s.costco.id, s.costcoProduce));
    await s.grocery.insertLine(line("milk", s.costco.id, s.costcoDairy));
    const plan = await planGroceryLineMoves(
        { grocery: s.grocery, settings: s.settings },
        HH,
        ["veg", "milk"],
        { storeId: s.aldi.id },
    );
    const moved = await applyLinePlacements(s.grocery, plan.moves);
    expect(moved.map((row) => row.storeId)).toEqual([s.aldi.id, s.aldi.id]);
    const stored = await s.grocery.listLines(HH);
    expect(stored.map((row) => [row.id, row.sectionId])).toEqual([
        ["veg", s.aldiProduce],
        ["milk", s.aldiOther],
    ]);
});

test("applyLinePlacements fails when a line vanished since the plan", async () => {
    const s = await seeded();
    const ghost = line("ghost", s.costco.id, s.costcoProduce);
    await expect(
        applyLinePlacements(s.grocery, [
            { line: ghost, storeId: s.aldi.id, sectionId: s.aldiOther },
        ]),
    ).rejects.toThrow("The list changed. Try again.");
});

test("planLineEdit changes the amount, unit and note and clears a note with null or blank", async () => {
    const s = await seeded();
    const layout = await readStoreLayout(s.settings, HH);
    const base = line("eggs", s.costco.id, s.costcoDairy, {
        note: "free range",
    });
    const plan = planLineEdit({
        line: base,
        layout,
        edit: { amount: 12, unit: " each ", note: "  large  " },
    });
    expect(plan.after.quantity).toEqual({ amount: 12, unit: "each" });
    expect(plan.after.note).toBe("large");
    expect(lineEditChanges(plan)).toBe(true);
    for (const note of [null, "", "   "]) {
        expect(
            planLineEdit({ line: base, layout, edit: { note } }).after.note,
        ).toBeNull();
    }
    // The same values are not a change.
    expect(
        lineEditChanges(
            planLineEdit({
                line: base,
                layout,
                edit: { amount: 1, unit: "each", note: "free range" },
            }),
        ),
    ).toBe(false);
});

test("planLineEdit refuses an empty edit, a non-positive amount and a blank unit", async () => {
    const s = await seeded();
    const layout = await readStoreLayout(s.settings, HH);
    const base = line("eggs", s.costco.id, s.costcoDairy);
    expect(() => planLineEdit({ line: base, layout, edit: {} })).toThrow(
        "Nothing to change",
    );
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
            planLineEdit({ line: base, layout, edit: { amount } }),
        ).toThrow("Enter an amount greater than zero.");
    }
    expect(() =>
        planLineEdit({ line: base, layout, edit: { unit: "  " } }),
    ).toThrow(GroceryInputError);
});

test("planLineEdit moves a line like move_grocery_lines does", async () => {
    const s = await seeded();
    const layout = await readStoreLayout(s.settings, HH);
    const base = line("eggs", s.costco.id, s.costcoDairy);
    expect(
        planLineEdit({ line: base, layout, edit: { storeId: s.aldi.id } })
            .after,
    ).toMatchObject({ storeId: s.aldi.id, sectionId: s.aldiOther });
    expect(
        planLineEdit({ line: base, layout, edit: { section: "Pantry" } }).after,
    ).toMatchObject({ storeId: s.costco.id, sectionId: s.costcoPantry });
});

test("planGroceryLineEdit is null for a line the household does not have; applyLineEdit saves", async () => {
    const s = await seeded();
    const deps = { grocery: s.grocery, settings: s.settings };
    expect(
        await planGroceryLineEdit(deps, HH, "nope", { amount: 2 }),
    ).toBeNull();
    await s.grocery.insertLine(line("eggs", s.costco.id, s.costcoDairy));
    const plan = await planGroceryLineEdit(deps, HH, "eggs", { amount: 6 });
    const saved = await applyLineEdit(s.grocery, plan!);
    expect(saved.quantity.amount).toBe(6);
    expect((await s.grocery.listLines(HH))[0]!.quantity.amount).toBe(6);
    await s.grocery.deleteLine(HH, "eggs");
    await expect(applyLineEdit(s.grocery, plan!)).rejects.toThrow(
        "The list changed. Try again.",
    );
});
