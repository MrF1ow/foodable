import { test, expect } from "bun:test";
import {
    createGroceryStore,
    createMemorySettingsStore,
    DEFAULT_STORE_SECTIONS,
    renameSection,
    SettingsInputError,
} from "./settings.js";

const HH = "hh-1";

test("creating a store seeds default sections including Other", async () => {
    const store = createMemorySettingsStore();
    const created = await createGroceryStore(store, HH, "Safeway");
    expect(created.name).toBe("Safeway");
    const sections = await store.listSections(created.id);
    expect(sections.map((row) => row.name)).toEqual([
        ...DEFAULT_STORE_SECTIONS,
    ]);
    expect(sections.some((row) => row.isOther && row.name === "Other")).toBe(
        true,
    );
});

test("creating a store refuses a duplicate name", async () => {
    const store = createMemorySettingsStore();
    await createGroceryStore(store, HH, "Safeway");
    await expect(createGroceryStore(store, HH, "Safeway")).rejects.toThrow(
        SettingsInputError,
    );
});

test("section rename updates the stored name", async () => {
    const store = createMemorySettingsStore();
    const created = await createGroceryStore(store, HH, "Safeway");
    const produce = (await store.listSections(created.id)).find(
        (row) => row.name === "Produce",
    )!;
    const renamed = await renameSection(
        store,
        HH,
        produce.id,
        "Household goods",
    );
    expect(renamed.name).toBe("Household goods");
    const names = (await store.listSections(created.id)).map((row) => row.name);
    expect(names).toContain("Household goods");
    expect(names).toContain("Household");
    await expect(
        renameSection(store, HH, produce.id, "Household"),
    ).rejects.toThrow(/already exists/i);
});
