import { expect, test } from "bun:test";
import { createMemoryGroceryStore, type GroceryLine } from "./grocery.js";
import { createStoreWithSections } from "./grocery-stores.js";
import {
    addSection,
    applySectionEdits,
    deleteRemovedSections,
    moveRemovedSectionLines,
    planSectionRemoval,
    planStoreSectionsChange,
    applyOrderMove,
    deleteMoveTarget,
    groceryLineCounts,
    reorderSections,
    renameStore,
    sectionsChanged,
    sectionsReordered,
    setSectionHidden,
    type SectionsChange,
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

function memoryRemoval(settings: ReturnType<typeof createMemorySettingsStore>) {
    const gone: string[] = [];
    return {
        gone,
        removal: {
            async deleteSection(householdId: string, sectionId: string) {
                if (!(await settings.getSection(householdId, sectionId))) {
                    return false;
                }
                gone.push(sectionId);
                return true;
            },
        },
    };
}

function lineIn(id: string, storeId: string, sectionId: string): GroceryLine {
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
    };
}

test("planSectionRemoval lists each section's lines and sends them to Other", async () => {
    const { store, sections } = await seeded();
    const dairy = sections.find((row) => row.name === "Dairy")!;
    const other = sections.find((row) => row.isOther)!;
    const plan = planSectionRemoval({
        storeId: store.id,
        sectionIds: [dairy.id, dairy.id],
        sections,
        lines: [
            lineIn("milk", store.id, dairy.id),
            lineIn("veg", store.id, sections[0]!.id),
        ],
    });
    expect(plan.otherSectionId).toBe(other.id);
    expect(plan.removals).toHaveLength(1);
    expect(plan.removals[0]!.section.id).toBe(dairy.id);
    expect(plan.removals[0]!.lineIds).toEqual(["milk"]);
});

test("planSectionRemoval refuses Other, an unknown section and a store with no Other", async () => {
    const { store, sections } = await seeded();
    const other = sections.find((row) => row.isOther)!;
    const base = { storeId: store.id, sections, lines: [] };
    expect(() =>
        planSectionRemoval({ ...base, sectionIds: [other.id] }),
    ).toThrow("The Other section cannot be removed.");
    expect(() => planSectionRemoval({ ...base, sectionIds: ["nope"] })).toThrow(
        "Unknown section.",
    );
    expect(() =>
        planSectionRemoval({
            ...base,
            sections: sections.filter((row) => !row.isOther),
            sectionIds: [sections[0]!.id],
        }),
    ).toThrow("That store has no Other section.");
});

test("removing sections is two steps: the lines move to Other, then the sections go", async () => {
    const { settings, store, sections } = await seeded();
    const grocery = createMemoryGroceryStore();
    const dairy = sections.find((row) => row.name === "Dairy")!;
    const produce = sections.find((row) => row.name === "Produce")!;
    const other = sections.find((row) => row.isOther)!;
    await grocery.insertLine(lineIn("milk", store.id, dairy.id));
    await grocery.insertLine(lineIn("veg", store.id, produce.id));
    await grocery.insertLine(lineIn("kept", store.id, other.id));
    const plan = planSectionRemoval({
        storeId: store.id,
        sectionIds: [dairy.id, produce.id],
        sections,
        lines: await grocery.listLines(HH),
    });
    const { removal, gone } = memoryRemoval(settings);
    expect(await moveRemovedSectionLines(grocery, HH, plan)).toBe(2);
    // Nothing is deleted until the caller says so: it records the sections between.
    expect(gone).toEqual([]);
    expect(
        (await grocery.listLines(HH)).map((row) => [row.id, row.sectionId]),
    ).toEqual([
        ["milk", other.id],
        ["veg", other.id],
        ["kept", other.id],
    ]);
    await deleteRemovedSections(removal, HH, plan);
    expect(gone).toEqual([dairy.id, produce.id]);
});

test("moving a removed section's lines fails when one vanished since the plan, and deleting fails when a section is already gone", async () => {
    const { store, sections } = await seeded();
    const grocery = createMemoryGroceryStore();
    const dairy = sections.find((row) => row.name === "Dairy")!;
    const plan = planSectionRemoval({
        storeId: store.id,
        sectionIds: [dairy.id],
        sections,
        lines: [lineIn("milk", store.id, dairy.id)],
    });
    await expect(moveRemovedSectionLines(grocery, HH, plan)).rejects.toThrow(
        "The list changed. Try again.",
    );
    await expect(
        deleteRemovedSections({ deleteSection: async () => false }, HH, plan),
    ).rejects.toThrow("The list changed. Try again.");
});

// ---------- one call's worth of section changes ----------

async function deli() {
    const settings = createMemorySettingsStore();
    const store = await createStoreWithSections(settings, HH, "Deli", [
        "Meat",
        "Cheese",
        "Bread",
    ]);
    return { settings, store: store.store, sections: store.sections };
}

function planOf(
    d: Awaited<ReturnType<typeof deli>>,
    change: SectionsChange,
    lines: GroceryLine[] = [],
) {
    return planStoreSectionsChange({
        storeId: d.store.id,
        storeName: d.store.name,
        sections: d.sections,
        lines,
        change,
    });
}

const SPLIT = /two calls/;

test("a section name that another section holds at the start of the call is refused, even when that section is removed in the same call", async () => {
    const d = await deli();
    // Removing Cheese and adding Cheese: undo would put the old one back beside the new one.
    expect(() => planOf(d, { remove: ["Cheese"], add: ["Cheese"] })).toThrow(
        SPLIT,
    );
    expect(() => planOf(d, { remove: ["cheese"], add: [" CHEESE "] })).toThrow(
        SPLIT,
    );
});

test("a rename into a name another section holds is refused, a swap included", async () => {
    const d = await deli();
    expect(() =>
        planOf(d, {
            rename: [
                { section: "Meat", name: "Beef" },
                { section: "Cheese", name: "Meat" },
            ],
        }),
    ).toThrow(SPLIT);
    // Into the name of a section removed in the same call.
    expect(() =>
        planOf(d, {
            remove: ["Cheese"],
            rename: [{ section: "Meat", name: "cheese" }],
        }),
    ).toThrow(SPLIT);
    // Into the name of a section nobody touches: it simply exists.
    expect(() =>
        planOf(d, { rename: [{ section: "Meat", name: "Bread" }] }),
    ).toThrow("That section already exists.");
    expect(() => planOf(d, { add: ["bread"] })).toThrow(
        "That section already exists.",
    );
});

test("two changes of one call that land on the same new name are refused", async () => {
    const d = await deli();
    expect(() => planOf(d, { add: ["Olives", "olives"] })).toThrow(
        'The section name "olives" is used twice in this call.',
    );
    expect(() =>
        planOf(d, {
            add: ["Olives"],
            rename: [{ section: "Meat", name: "OLIVES" }],
        }),
    ).toThrow("used twice in this call");
    expect(() =>
        planOf(d, {
            rename: [
                { section: "Meat", name: "Deli meat" },
                { section: "Bread", name: "deli meat" },
            ],
        }),
    ).toThrow("used twice in this call");
});

test("a rename that only changes the case of a section's own name is allowed, and an unchanged name is no change", async () => {
    const d = await deli();
    const plan = planOf(d, {
        rename: [
            { section: "Meat", name: "MEAT" },
            { section: "Cheese", name: "Cheese" },
        ],
    });
    expect(plan.rename.map((row) => [row.from, row.to])).toEqual([
        ["Meat", "MEAT"],
    ]);
});

test("the two-call version of a refused change plans: remove first, then add the name", async () => {
    const d = await deli();
    const first = planOf(d, { remove: ["Cheese"] });
    expect(first.removal.removals.map((row) => row.section.name)).toEqual([
        "Cheese",
    ]);
    const after = d.sections.filter((row) => row.name !== "Cheese");
    const second = planStoreSectionsChange({
        storeId: d.store.id,
        storeName: d.store.name,
        sections: after,
        lines: [],
        change: { add: ["Cheese"] },
    });
    expect(second.add).toEqual(["Cheese"]);
});

test("sections are named by id or by name in any case, and what does not exist is named in the error", async () => {
    const d = await deli();
    const cheese = d.sections.find((row) => row.name === "Cheese")!;
    const plan = planOf(d, {
        hide: [cheese.id, "bread"],
        remove: ["MEAT"],
    });
    expect(plan.hide.map((row) => row.name)).toEqual(["Cheese", "Bread"]);
    expect(plan.removal.removals.map((row) => row.section.name)).toEqual([
        "Meat",
    ]);
    expect(() => planOf(d, { hide: ["Nope"] })).toThrow(
        'Deli has no section "Nope".',
    );
    expect(() => planOf(d, { remove: ["Nope"] })).toThrow(
        'Deli has no section "Nope".',
    );
    // A removed section is not there for the changes that follow it.
    expect(() => planOf(d, { remove: ["Meat"], hide: ["Meat"] })).toThrow(
        'Deli has no section "Meat".',
    );
});

test("Other cannot be removed or hidden, and hidden sections and Other cannot be ordered", async () => {
    const d = await deli();
    expect(() => planOf(d, { remove: ["Other"] })).toThrow(
        "The Other section cannot be removed.",
    );
    expect(() => planOf(d, { hide: ["Other"] })).toThrow(
        "The Other section cannot be hidden.",
    );
    expect(() => planOf(d, { order: ["Other", "Meat"] })).toThrow(
        "Other cannot be ordered: Other always stays last.",
    );
    expect(() => planOf(d, { hide: ["Cheese"], order: ["Cheese"] })).toThrow(
        "Cheese cannot be ordered: it is hidden.",
    );
    expect(() => planOf(d, { order: ["Nope"] })).toThrow(
        'Deli has no section "Nope".',
    );
});

test("hiding what is hidden and showing what is shown change nothing", async () => {
    const d = await deli();
    const cheese = d.sections.find((row) => row.name === "Cheese")!;
    const hidden = d.sections.map((row) =>
        row.id === cheese.id ? { ...row, hidden: true } : row,
    );
    const plan = planStoreSectionsChange({
        storeId: d.store.id,
        storeName: d.store.name,
        sections: hidden,
        lines: [],
        change: { hide: ["Cheese"], show: ["Meat"] },
    });
    expect(plan.hide).toEqual([]);
    expect(plan.show).toEqual([]);
});

test("a partial order names the sections to put first and the rest keep their order, Other last and hidden ones in place", async () => {
    const d = await deli();
    const plan = planOf(d, { hide: ["Cheese"], order: ["Bread"] });
    // Movable now: Meat, Bread (Cheese is hidden, Other stays last).
    const ids = (plan.order ?? []).map((ref) => ("id" in ref ? ref.id : null));
    const name = (id: string | null) =>
        d.sections.find((row) => row.id === id)?.name;
    expect(ids.map(name)).toEqual(["Bread", "Meat"]);
    expect(planOf(d, { hide: ["Meat"] }).order).toBeNull();
});

test("a section added in the call can be ordered in the same call", async () => {
    const d = await deli();
    const plan = planOf(d, { add: ["Olives"], order: ["olives", "Bread"] });
    expect(plan.add).toEqual(["Olives"]);
    expect(plan.order).toEqual([
        { added: 0 },
        { id: d.sections.find((row) => row.name === "Bread")!.id },
        { id: d.sections.find((row) => row.name === "Meat")!.id },
        { id: d.sections.find((row) => row.name === "Cheese")!.id },
    ]);
});

test("removing sections plans the lines to move, from the sections' own store", async () => {
    const d = await deli();
    const cheese = d.sections.find((row) => row.name === "Cheese")!;
    const plan = planOf(d, { remove: ["Cheese"] }, [
        lineIn("brie", d.store.id, cheese.id),
        lineIn("elsewhere", "other-store", cheese.id),
    ]);
    expect(plan.removal.removals[0]!.lineIds).toEqual(["brie"]);
});

test("applying a plan adds, renames, hides, shows and orders, and tells the caller about each new section", async () => {
    const d = await deli();
    const cheese = d.sections.find((row) => row.name === "Cheese")!;
    await setSectionHidden(d.settings, HH, cheese.id, true);
    const start = await d.settings.listSections(d.store.id);
    const plan = planStoreSectionsChange({
        storeId: d.store.id,
        storeName: d.store.name,
        sections: start,
        lines: [],
        change: {
            add: ["Olives"],
            rename: [{ section: "Bread", name: "Bakery" }],
            show: ["Cheese"],
            hide: ["Meat"],
            order: ["Olives", "Bakery"],
        },
    });
    const told: string[] = [];
    const done = await applySectionEdits(d.settings, HH, plan, {
        added: (section) => told.push(section.name),
    });
    expect(told).toEqual(["Olives"]);
    expect(done.added.map((row) => row.name)).toEqual(["Olives"]);
    const end = await d.settings.listSections(d.store.id);
    expect(end.map((row) => [row.name, row.hidden])).toEqual([
        ["Meat", true],
        ["Olives", false],
        ["Bakery", false],
        ["Cheese", false],
        ["Other", false],
    ]);
    expect(end.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(sectionsChanged(start, end)).toBe(true);
    expect(sectionsReordered(start, end)).toBe(true);
});

test("sectionsChanged and sectionsReordered tell a rename or a hide from a reorder", async () => {
    const d = await deli();
    const start = await d.settings.listSections(d.store.id);
    expect(sectionsChanged(start, start)).toBe(false);
    expect(sectionsReordered(start, start)).toBe(false);
    const hidden = start.map((row) =>
        row.name === "Meat" ? { ...row, hidden: true } : row,
    );
    expect(sectionsChanged(start, hidden)).toBe(true);
    expect(sectionsReordered(start, hidden)).toBe(false);
    // A section that was added is not a reorder of the ones that stayed.
    const added = [
        ...start.slice(0, 1),
        { ...start[0]!, id: "new", name: "New" },
        ...start.slice(1),
    ];
    expect(sectionsReordered(start, added)).toBe(false);
    const swapped = [start[1]!, start[0]!, ...start.slice(2)];
    expect(sectionsReordered(start, swapped)).toBe(true);
});
