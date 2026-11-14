import { test, expect } from "bun:test";
import {
    AGENTS_DESTRUCTIVE_ALLOWED_KEY,
    agentDestructiveAllowedFromJson,
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

test("creating a store refuses a name another store has in any case, like renaming one", async () => {
    const store = createMemorySettingsStore();
    await createGroceryStore(store, HH, "Costco");
    await expect(createGroceryStore(store, HH, "costco")).rejects.toThrow(
        "That store already exists.",
    );
    await expect(createGroceryStore(store, HH, "  COSTCO ")).rejects.toThrow(
        "That store already exists.",
    );
    expect((await store.listStores(HH)).map((row) => row.name)).toEqual([
        "Costco",
    ]);
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

test("the agents switch is Allowed unless the stored value is exactly false", () => {
    expect(AGENTS_DESTRUCTIVE_ALLOWED_KEY).toBe("agents.destructive_allowed");
    expect(agentDestructiveAllowedFromJson(null)).toBe(true);
    expect(agentDestructiveAllowedFromJson(undefined)).toBe(true);
    expect(agentDestructiveAllowedFromJson([])).toBe(true);
    expect(agentDestructiveAllowedFromJson({})).toBe(true);
    expect(
        agentDestructiveAllowedFromJson({
            [AGENTS_DESTRUCTIVE_ALLOWED_KEY]: true,
        }),
    ).toBe(true);
    for (const junk of ["false", 0, null, "off"]) {
        expect(
            agentDestructiveAllowedFromJson({
                [AGENTS_DESTRUCTIVE_ALLOWED_KEY]: junk,
            }),
        ).toBe(true);
    }
    expect(
        agentDestructiveAllowedFromJson({
            [AGENTS_DESTRUCTIVE_ALLOWED_KEY]: false,
        }),
    ).toBe(false);
});

test("the memory settings store keeps the agents switch per household", async () => {
    const store = createMemorySettingsStore();
    expect(await store.getAgentDestructiveAllowed(HH)).toBe(true);
    expect(await store.setAgentDestructiveAllowed(HH, false)).toBe(false);
    expect(await store.getAgentDestructiveAllowed(HH)).toBe(false);
    expect(await store.getAgentDestructiveAllowed("hh-2")).toBe(true);
    expect(await store.setAgentDestructiveAllowed(HH, true)).toBe(true);
    expect(await store.getAgentDestructiveAllowed(HH)).toBe(true);
});
