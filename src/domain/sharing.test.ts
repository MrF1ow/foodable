import { expect, test } from "bun:test";
import { createMemoryRecipesStore, createRecipe } from "./recipes.js";
import {
    createMemoryShareLinkStore,
    createShareLink,
    hashToken,
    isLive,
    MAX_SHARE_EXPIRY_DAYS,
    mintShareToken,
    resolveShareToken,
    revokeShareLink,
    ShareLinkInputError,
    shareLinkFromRow,
    shareView,
    validateExpiresInDays,
    type ShareLink,
    type ShareLinkRow,
} from "./sharing.js";

const HH = "hh-1";
const OTHER_HH = "hh-2";
const ME = "user-1";
const NOW = new Date("2026-11-12T12:00:00.000Z");

// Recipe "r1" belongs to HH and to no one else.
const TARGETS = {
    async getRecipe(householdId: string, id: string) {
        return householdId === HH && id === "r1" ? { id } : null;
    },
};

function link(over: Partial<ShareLink> = {}): ShareLink {
    return {
        id: "l1",
        householdId: HH,
        kind: "recipe",
        targetId: "r1",
        createdBy: ME,
        createdAt: "2026-11-12T10:00:00.000Z",
        expiresAt: null,
        revokedAt: null,
        ...over,
    };
}

test("a minted token is 43 base64url characters and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
        const token = mintShareToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        seen.add(token);
    }
    expect(seen.size).toBe(2000);
});

test("a hash is stable, 64 hex characters, and not the token", () => {
    const token = mintShareToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hashToken(mintShareToken())).not.toBe(hash);
    // a known SHA-256, from an independent source
    expect(hashToken("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
});

test("isLive: not revoked and not expired", () => {
    expect(isLive(link(), NOW)).toBe(true);
    expect(isLive(link({ revokedAt: "2026-11-12T11:00:00.000Z" }), NOW)).toBe(
        false,
    );
    expect(isLive(link({ expiresAt: "2026-11-12T11:59:59.999Z" }), NOW)).toBe(
        false,
    );
    // expiry is an instant: at exactly that moment the link is gone
    expect(isLive(link({ expiresAt: NOW.toISOString() }), NOW)).toBe(false);
    expect(isLive(link({ expiresAt: "2026-11-13T12:00:00.000Z" }), NOW)).toBe(
        true,
    );
    // revoked wins over a future expiry
    expect(
        isLive(
            link({
                expiresAt: "2026-11-13T12:00:00.000Z",
                revokedAt: "2026-11-12T11:00:00.000Z",
            }),
            NOW,
        ),
    ).toBe(false);
});

test("expires_in_days is a whole number from 1 to 365, or absent", () => {
    expect(validateExpiresInDays(undefined)).toBeNull();
    expect(validateExpiresInDays(null)).toBeNull();
    expect(validateExpiresInDays(1)).toBe(1);
    expect(validateExpiresInDays(MAX_SHARE_EXPIRY_DAYS)).toBe(365);
    for (const bad of [0, -1, 366, 1.5, Number.NaN, Infinity, "7"]) {
        expect(() => validateExpiresInDays(bad as never)).toThrow(
            ShareLinkInputError,
        );
    }
});

test("creating a link returns the raw token once and stores only its hash", async () => {
    const store = createMemoryShareLinkStore();
    const { link: made, token } = await createShareLink(
        store,
        {
            householdId: HH,
            kind: "recipe",
            targetId: "r1",
            createdBy: ME,
            expiresInDays: 7,
        },
        NOW,
        TARGETS,
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made.expiresAt).toBe("2026-11-19T12:00:00.000Z");
    expect(JSON.stringify(made)).not.toContain(token);
    expect(JSON.stringify(made)).not.toContain(hashToken(token));
    expect(
        JSON.stringify(await store.listForHousehold(HH, { now: NOW })),
    ).not.toContain(token);
    expect((await store.findByHash(token))?.id).toBeUndefined();
    expect((await store.findByHash(hashToken(token)))?.id).toBe(made.id);
});

test("a link without an expiry never expires", async () => {
    const store = createMemoryShareLinkStore();
    const { link: made } = await createShareLink(
        store,
        { householdId: HH, kind: "grocery_list", createdBy: ME },
        NOW,
        TARGETS,
    );
    expect(made.expiresAt).toBeNull();
    expect(made.targetId).toBeNull();
    expect(isLive(made, new Date("2036-01-01T00:00:00.000Z"))).toBe(true);
});

test("a recipe link needs a target, a grocery list link refuses one", async () => {
    const store = createMemoryShareLinkStore();
    await expect(
        createShareLink(
            store,
            { householdId: HH, kind: "recipe", createdBy: ME },
            NOW,
            TARGETS,
        ),
    ).rejects.toBeInstanceOf(ShareLinkInputError);
    await expect(
        createShareLink(
            store,
            {
                householdId: HH,
                kind: "grocery_list",
                targetId: "r1",
                createdBy: ME,
            },
            NOW,
            TARGETS,
        ),
    ).rejects.toBeInstanceOf(ShareLinkInputError);
    await expect(
        createShareLink(
            store,
            { householdId: HH, kind: "fridge" as never, createdBy: ME },
            NOW,
            TARGETS,
        ),
    ).rejects.toBeInstanceOf(ShareLinkInputError);
    expect(await store.listForHousehold(HH, { now: NOW })).toEqual([]);
});

test("a bad expiry creates nothing", async () => {
    const store = createMemoryShareLinkStore();
    await expect(
        createShareLink(
            store,
            {
                householdId: HH,
                kind: "grocery_list",
                createdBy: ME,
                expiresInDays: 400,
            },
            NOW,
            TARGETS,
        ),
    ).rejects.toBeInstanceOf(ShareLinkInputError);
    expect(
        await store.listForHousehold(HH, { now: NOW, includeInactive: true }),
    ).toEqual([]);
});

test("resolving a token finds a live link and nothing else", async () => {
    const store = createMemoryShareLinkStore();
    const live = await createShareLink(
        store,
        { householdId: HH, kind: "grocery_list", createdBy: ME },
        NOW,
        TARGETS,
    );
    const expiring = await createShareLink(
        store,
        {
            householdId: HH,
            kind: "recipe",
            targetId: "r1",
            createdBy: ME,
            expiresInDays: 1,
        },
        NOW,
        TARGETS,
    );
    const revoked = await createShareLink(
        store,
        { householdId: HH, kind: "grocery_list", createdBy: ME },
        NOW,
        TARGETS,
    );
    await revokeShareLink(store, HH, revoked.link.id, NOW);

    expect((await resolveShareToken(store, live.token, NOW))?.id).toBe(
        live.link.id,
    );
    expect((await resolveShareToken(store, expiring.token, NOW))?.id).toBe(
        expiring.link.id,
    );
    const later = new Date("2026-11-13T12:00:00.000Z");
    expect(await resolveShareToken(store, expiring.token, later)).toBeNull();
    expect(await resolveShareToken(store, revoked.token, NOW)).toBeNull();
    expect(await resolveShareToken(store, mintShareToken(), NOW)).toBeNull();
    expect(await resolveShareToken(store, "", NOW)).toBeNull();
});

test("listing is per household and active-only unless asked otherwise", async () => {
    const store = createMemoryShareLinkStore();
    const a = await createShareLink(
        store,
        { householdId: HH, kind: "grocery_list", createdBy: ME },
        NOW,
        TARGETS,
    );
    const b = await createShareLink(
        store,
        {
            householdId: HH,
            kind: "recipe",
            targetId: "r1",
            createdBy: ME,
            expiresInDays: 1,
        },
        NOW,
        TARGETS,
    );
    const c = await createShareLink(
        store,
        { householdId: HH, kind: "grocery_list", createdBy: ME },
        NOW,
        TARGETS,
    );
    await createShareLink(
        store,
        { householdId: OTHER_HH, kind: "grocery_list", createdBy: "user-2" },
        NOW,
        TARGETS,
    );
    await revokeShareLink(store, HH, c.link.id, NOW);
    const later = new Date("2026-11-14T00:00:00.000Z");

    const active = await store.listForHousehold(HH, { now: later });
    expect(active.map((l) => l.id)).toEqual([a.link.id]);
    const all = await store.listForHousehold(HH, {
        now: later,
        includeInactive: true,
    });
    expect(all.map((l) => l.id).sort()).toEqual(
        [a.link.id, b.link.id, c.link.id].sort(),
    );
    expect(all.every((l) => l.householdId === HH)).toBe(true);
});

test("revoking is household-scoped and idempotent", async () => {
    const store = createMemoryShareLinkStore();
    const { link: made, token } = await createShareLink(
        store,
        { householdId: HH, kind: "grocery_list", createdBy: ME },
        NOW,
        TARGETS,
    );

    // another household cannot revoke it, and it stays live
    expect(await revokeShareLink(store, OTHER_HH, made.id, NOW)).toBeNull();
    expect(await resolveShareToken(store, token, NOW)).not.toBeNull();

    const first = await revokeShareLink(store, HH, made.id, NOW);
    expect(first?.revokedAt).toBe(NOW.toISOString());
    expect(await resolveShareToken(store, token, NOW)).toBeNull();

    // a second revoke succeeds and keeps the first timestamp
    const later = new Date("2026-11-13T12:00:00.000Z");
    const second = await revokeShareLink(store, HH, made.id, later);
    expect(second?.revokedAt).toBe(NOW.toISOString());

    // an unknown id is not found
    expect(await revokeShareLink(store, HH, "nope", NOW)).toBeNull();
});

test("a row maps to a link without its hash, dates as ISO strings", () => {
    const row: ShareLinkRow = {
        id: "l1",
        household_id: HH,
        kind: "recipe",
        target_id: "r1",
        token_hash: "deadbeef",
        created_by: null,
        created_at: new Date("2026-11-12T10:00:00.000Z"),
        expires_at: "2026-11-20T10:00:00.000Z",
        revoked_at: null,
    };
    const mapped = shareLinkFromRow(row);
    expect(mapped).toEqual({
        id: "l1",
        householdId: HH,
        kind: "recipe",
        targetId: "r1",
        createdBy: null,
        createdAt: "2026-11-12T10:00:00.000Z",
        expiresAt: "2026-11-20T10:00:00.000Z",
        revokedAt: null,
    });
    expect(JSON.stringify(mapped)).not.toContain("deadbeef");
    expect(() => shareLinkFromRow({ ...row, kind: "fridge" })).toThrow();
});

// A recipe as the app holds it: ids, the household, the creator and
// per-person amounts that a share must not carry.
const RECIPE = {
    id: "recipe-secret-id",
    householdId: "household-secret-id",
    creatorId: "creator-secret-id",
    name: "Lentil soup",
    yieldPortions: 4,
    instructions: "Simmer everything for 30 minutes.",
    sourceUrl: "https://example.invalid/soup",
    tags: ["dinner", "vegan"],
    notes: "Grandma Marta's secret",
    prepMinutes: 10,
    cookMinutes: 30,
    verification: { status: "verified" },
    updatedAt: "2026-11-01T00:00:00.000Z",
    portionCount: 2,
    ingredients: [
        {
            id: "ing-2",
            householdId: "household-secret-id",
            recipeId: "recipe-secret-id",
            kind: "food" as const,
            displayName: "Salt",
            quantity: null,
            foodId: "food-secret-2",
            sortOrder: 1,
            note: "to taste",
            perPortionAmount: null,
            personAmount: 3,
        },
        {
            id: "ing-1",
            householdId: "household-secret-id",
            recipeId: "recipe-secret-id",
            kind: "food" as const,
            displayName: "Red lentils",
            quantity: { amount: 300, unit: "g" },
            foodId: "food-secret-1",
            sortOrder: 0,
            note: null,
            perPortionAmount: 75,
            personAmount: 150,
        },
    ],
};

test("a recipe share shows the recipe and nothing about the household", () => {
    const view = shareView("recipe", RECIPE);
    expect(view).toEqual({
        kind: "recipe",
        recipe: {
            name: "Lentil soup",
            portions: 4,
            instructions: "Simmer everything for 30 minutes.",
            tags: ["dinner", "vegan"],
            ingredients: [
                { name: "Red lentils", amount: 300, unit: "g", note: null },
                { name: "Salt", amount: null, unit: null, note: "to taste" },
            ],
        },
    });
    const json = JSON.stringify(view);
    for (const secret of [
        "secret-id",
        "Marta",
        "example.invalid",
        "household",
        "creator",
        "food-secret",
    ]) {
        expect(json).not.toContain(secret);
    }
});

test("a recipe share does not alias the source arrays", () => {
    const view = shareView("recipe", RECIPE)!;
    view.recipe.tags.push("changed");
    expect(RECIPE.tags).toEqual(["dinner", "vegan"]);
});

const GROCERY = {
    stores: [
        {
            id: "s2",
            householdId: "household-secret-id",
            name: "Bakery",
            sortOrder: 1,
        },
        {
            id: "s1",
            householdId: "household-secret-id",
            name: "Market",
            sortOrder: 0,
        },
        {
            id: "s3",
            householdId: "household-secret-id",
            name: "Empty",
            sortOrder: 2,
        },
    ],
    lines: [
        {
            id: "line-secret-1",
            householdId: "household-secret-id",
            storeId: "s2",
            sectionId: "sec-1",
            kind: "food" as const,
            displayName: "Rye bread",
            quantity: { amount: 1, unit: "each" },
            foodId: "food-secret-3",
            checked: true,
            source: "manual" as const,
            sourceFridgeItemId: "fridge-secret",
            note: "ask for sliced, for Ana",
        },
        {
            id: "line-secret-2",
            householdId: "household-secret-id",
            storeId: "s1",
            sectionId: "sec-2",
            kind: "food" as const,
            displayName: "Apples",
            quantity: { amount: 6, unit: "each" },
            foodId: null,
            checked: false,
            source: "recipe" as const,
            sourceFridgeItemId: null,
            note: null,
        },
        {
            id: "line-secret-3",
            householdId: "household-secret-id",
            storeId: "s1",
            sectionId: "sec-2",
            kind: "supply" as const,
            displayName: "Soap",
            quantity: { amount: 2, unit: "each" },
            foodId: null,
            checked: false,
            source: "manual" as const,
            sourceFridgeItemId: null,
            note: null,
        },
    ],
};

test("the grocery share groups lines by store and drops everything else", () => {
    const view = shareView("grocery_list", GROCERY);
    expect(view).toEqual({
        kind: "grocery_list",
        list: {
            stores: [
                {
                    name: "Market",
                    lines: [
                        {
                            name: "Apples",
                            amount: 6,
                            unit: "each",
                            checked: false,
                        },
                        {
                            name: "Soap",
                            amount: 2,
                            unit: "each",
                            checked: false,
                        },
                    ],
                },
                {
                    name: "Bakery",
                    lines: [
                        {
                            name: "Rye bread",
                            amount: 1,
                            unit: "each",
                            checked: true,
                        },
                    ],
                },
            ],
        },
    });
    const json = JSON.stringify(view);
    for (const secret of ["secret", "Ana", "household", "Empty"]) {
        expect(json).not.toContain(secret);
    }
});

test("a line whose store is gone is listed under Other, last", () => {
    const view = shareView("grocery_list", {
        stores: GROCERY.stores,
        lines: [
            ...GROCERY.lines,
            { ...GROCERY.lines[1]!, storeId: "gone", displayName: "Tape" },
        ],
    });
    expect(view?.kind).toBe("grocery_list");
    if (view?.kind !== "grocery_list") return;
    const last = view.list.stores.at(-1)!;
    expect(last.name).toBe("Other");
    expect(last.lines.map((l) => l.name)).toEqual(["Tape"]);
});

test("an empty grocery list has no stores", () => {
    expect(
        shareView("grocery_list", { stores: GROCERY.stores, lines: [] }),
    ).toEqual({ kind: "grocery_list", list: { stores: [] } });
});

test("a deleted target has no view", () => {
    expect(shareView("recipe", null)).toBeNull();
    expect(shareView("recipe", undefined)).toBeNull();
});

test("a recipe link needs a recipe that exists in the household", async () => {
    const store = createMemoryShareLinkStore();
    const recipes = createMemoryRecipesStore();
    const mine = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ME,
        name: "Lentil soup",
        yieldPortions: 4,
    });
    const theirs = await createRecipe(recipes, {
        householdId: OTHER_HH,
        creatorId: "user-2",
        name: "Their stew",
        yieldPortions: 2,
    });
    const mint = (targetId: string) =>
        createShareLink(
            store,
            { householdId: HH, kind: "recipe", targetId, createdBy: ME },
            NOW,
            recipes,
        );

    expect((await mint(mine.id)).link.targetId).toBe(mine.id);
    // another household's recipe, and one that does not exist at all
    await expect(mint(theirs.id)).rejects.toBeInstanceOf(ShareLinkInputError);
    await expect(mint(crypto.randomUUID())).rejects.toBeInstanceOf(
        ShareLinkInputError,
    );
    expect(
        (await store.listForHousehold(HH, { now: NOW })).map((l) => l.targetId),
    ).toEqual([mine.id]);
});

test("a token that is not 43 base64url characters never reaches the store", async () => {
    let lookups = 0;
    const store = createMemoryShareLinkStore();
    const counting = {
        ...store,
        async findByHash(hash: string) {
            lookups++;
            return store.findByHash(hash);
        },
    };
    for (const bad of [
        "",
        "abc",
        `${mintShareToken()}x`,
        "a b".padEnd(43, "c"),
    ]) {
        expect(await resolveShareToken(counting, bad, NOW)).toBeNull();
    }
    expect(lookups).toBe(0);
    await resolveShareToken(counting, mintShareToken(), NOW);
    expect(lookups).toBe(1);
});
