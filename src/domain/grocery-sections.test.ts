import { expect, test } from "bun:test";
import type { GroceryLine } from "./grocery.js";
import {
    addSection,
    applyOrderMove,
    deleteMoveTarget,
    groceryLineCounts,
    reorderSections,
    renameStore,
    setSectionHidden,
} from "./grocery-sections.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
    SettingsInputError,
} from "./settings.js";

const HH = "hh-1";

async function seeded() {
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Costco");
    const sections = await settings.listSections(store.id);
    return { settings, store, sections };
}

async function names(
    settings: ReturnType<typeof createMemorySettingsStore>,
    storeId: string,
) {
    return (await settings.listSections(storeId)).map((row) => row.name);
}

test("renameStore trims, keeps the order and refuses a name another store has", async () => {
    const settings = createMemorySettingsStore();
    const a = await createGroceryStore(settings, HH, "A");
    await createGroceryStore(settings, HH, "B");
    const renamed = await renameStore(settings, HH, a.id, "  Costco  ");
    expect(renamed.name).toBe("Costco");
    expect(renamed.sortOrder).toBe(0);
    expect((await settings.listStores(HH)).map((row) => row.name)).toEqual([
        "Costco",
        "B",
    ]);
    await expect(renameStore(settings, HH, a.id, "B")).rejects.toThrow(
        "That store already exists.",
    );
    await expect(renameStore(settings, HH, a.id, "   ")).rejects.toThrow(
        "Enter a store name.",
    );
    // Keeping its own name (changing only the case) is not a clash.
    expect((await renameStore(settings, HH, a.id, "costco")).name).toBe(
        "costco",
    );
});

test("renameStore refuses an unknown store and another household's store", async () => {
    const settings = createMemorySettingsStore();
    const a = await createGroceryStore(settings, HH, "A");
    await expect(renameStore(settings, HH, "nope", "X")).rejects.toThrow(
        SettingsInputError,
    );
    await expect(renameStore(settings, "hh-2", a.id, "X")).rejects.toThrow(
        "Unknown store.",
    );
});

test("addSection puts a new section before Other with dense positions", async () => {
    const { settings, store } = await seeded();
    const added = await addSection(settings, HH, store.id, "  Deli ");
    expect(added.name).toBe("Deli");
    const listed = await settings.listSections(store.id);
    expect(listed.at(-1)!.name).toBe("Other");
    expect(listed.at(-2)!.name).toBe("Deli");
    expect(listed.map((row) => row.sortOrder)).toEqual(
        listed.map((_, index) => index),
    );
});

test("addSection refuses an empty or repeated name and an unknown store", async () => {
    const { settings, store } = await seeded();
    await expect(addSection(settings, HH, store.id, " ")).rejects.toThrow(
        "Enter a section name.",
    );
    await expect(addSection(settings, HH, store.id, "Produce")).rejects.toThrow(
        "That section already exists.",
    );
    await expect(addSection(settings, HH, "nope", "Deli")).rejects.toThrow(
        "Unknown store.",
    );
});

test("reorderSections reorders the visible sections and keeps Other last and hidden ones in place", async () => {
    const { settings, store, sections } = await seeded();
    const byName = (name: string) => sections.find((s) => s.name === name)!;
    await setSectionHidden(settings, HH, byName("Bakery").id, true);
    const visible = (await settings.listSections(store.id))
        .filter((row) => !row.hidden && !row.isOther)
        .map((row) => row.id);
    const reversed = [...visible].reverse();
    await reorderSections(settings, HH, store.id, reversed);
    const after = await settings.listSections(store.id);
    expect(after.map((row) => row.name)).toEqual([
        "Household",
        "Beverages",
        "Pantry",
        "Bakery", // hidden: still the fourth slot
        "Frozen",
        "Meat & seafood",
        "Dairy",
        "Produce",
        "Other",
    ]);
    expect(after.map((row) => row.sortOrder)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
});

test("reorderSections refuses a list that is not exactly the visible sections", async () => {
    const { settings, store, sections } = await seeded();
    const visible = sections.filter((row) => !row.isOther).map((r) => r.id);
    await expect(
        reorderSections(settings, HH, store.id, visible.slice(1)),
    ).rejects.toThrow("List every section once.");
    await expect(
        reorderSections(settings, HH, store.id, [...visible, visible[0]!]),
    ).rejects.toThrow("A section is listed twice.");
    await expect(
        reorderSections(settings, HH, store.id, [...visible.slice(1), "x"]),
    ).rejects.toThrow("Unknown section.");
    // Other is not part of the order: naming it is a stale page.
    const other = sections.find((row) => row.isOther)!;
    await expect(
        reorderSections(settings, HH, store.id, [...visible, other.id]),
    ).rejects.toThrow("Unknown section.");
    // Nothing was written by the refused calls.
    expect((await settings.listSections(store.id)).map((r) => r.id)).toEqual(
        sections.map((r) => r.id),
    );
});

test("setSectionHidden hides and shows a section, never Other", async () => {
    const { settings, store, sections } = await seeded();
    const produce = sections.find((row) => row.name === "Produce")!;
    expect(
        (await setSectionHidden(settings, HH, produce.id, true)).hidden,
    ).toBe(true);
    expect(
        (await setSectionHidden(settings, HH, produce.id, false)).hidden,
    ).toBe(false);
    const other = sections.find((row) => row.isOther)!;
    await expect(
        setSectionHidden(settings, HH, other.id, true),
    ).rejects.toThrow("The Other section cannot be hidden.");
    await expect(setSectionHidden(settings, HH, "nope", true)).rejects.toThrow(
        "Unknown section.",
    );
    expect(store.id).toBe(produce.storeId);
});

test("groceryLineCounts counts lines per store and per section", () => {
    const line = (id: string, storeId: string, sectionId: string) =>
        ({ id, storeId, sectionId }) as GroceryLine;
    const counts = groceryLineCounts([
        line("1", "a", "a-produce"),
        line("2", "a", "a-produce"),
        line("3", "a", "a-dairy"),
        line("4", "b", "b-other"),
    ]);
    expect(counts.byStore.get("a")).toBe(3);
    expect(counts.byStore.get("b")).toBe(1);
    expect(counts.byStore.get("c")).toBeUndefined();
    expect(counts.bySection.get("a-produce")).toBe(2);
    expect(counts.bySection.get("b-other")).toBe(1);
});

test("applyOrderMove swaps one step and ignores the edges and bad input", () => {
    const ids = ["a", "b", "c"];
    expect(applyOrderMove(ids, "b:up")).toEqual(["b", "a", "c"]);
    expect(applyOrderMove(ids, "b:down")).toEqual(["a", "c", "b"]);
    expect(applyOrderMove(ids, "a:up")).toEqual(ids);
    expect(applyOrderMove(ids, "c:down")).toEqual(ids);
    expect(applyOrderMove(ids, "x:up")).toEqual(ids);
    expect(applyOrderMove(ids, "b:sideways")).toEqual(ids);
    expect(applyOrderMove(ids, "b")).toEqual(ids);
    // The input is not mutated.
    expect(ids).toEqual(["a", "b", "c"]);
});

test("deleteMoveTarget prefers the default store, else the first other store", () => {
    const stores = ["a", "b", "c"].map((id, sortOrder) => ({
        id,
        householdId: HH,
        name: id.toUpperCase(),
        sortOrder,
    }));
    expect(deleteMoveTarget(stores, "a", "c")?.id).toBe("c");
    expect(deleteMoveTarget(stores, "a", null)?.id).toBe("b");
    // The default store itself is being deleted: fall back to the first other.
    expect(deleteMoveTarget(stores, "c", "c")?.id).toBe("a");
    expect(deleteMoveTarget(stores, "a", "gone")?.id).toBe("b");
    expect(deleteMoveTarget(stores.slice(0, 1), "a", "a")).toBeNull();
});
