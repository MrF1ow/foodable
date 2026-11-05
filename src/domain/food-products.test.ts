import { test, expect } from "bun:test";
import {
    createMemoryFoodsStore,
    createProduct,
    effectiveFood,
    effectiveFoodsByIds,
    familyOf,
    findOrCreateManualFood,
    linkProduct,
    mergeFoods,
    newFood,
    setUsualProduct,
    updateFood,
    type Food,
} from "./foods.js";

const HH = "hh-products";
const HH2 = "hh-other";

async function plainEggs(store: ReturnType<typeof createMemoryFoodsStore>) {
    return findOrCreateManualFood(store, HH, "food", "Eggs");
}

async function insertProduct(
    store: ReturnType<typeof createMemoryFoodsStore>,
    plain: Food,
    over: Partial<Food> & { name: string; normalizedName: string },
) {
    return store.insertFood(
        newFood({
            householdId: HH,
            kind: plain.kind,
            name: over.name,
            brand: over.brand,
            genericFoodId: plain.id,
            calories: over.calories,
            proteinG: over.proteinG,
            carbsG: over.carbsG,
            fatG: over.fatG,
            fiberG: over.fiberG,
            sugarG: over.sugarG,
            alcoholG: over.alcoholG,
            caffeineMg: over.caffeineMg,
            nutritionSource: over.nutritionSource,
            gramsPerEach: over.gramsPerEach,
            gramsPerMl: over.gramsPerMl,
            allergens: over.allergens,
        }),
    );
}

test("familyOf: plain uses own id; product uses plain id", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "Kirkland Eggs",
        normalizedName: "kirkland eggs",
    });
    expect(familyOf(plain)).toBe(plain.id);
    expect(familyOf(product)).toBe(plain.id);
});

test("effectiveFood takes whole nutrition block from usual when any nutrient set", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            proteinG: 99,
            nutritionSource: "manual",
        }),
    );
    const usual = await insertProduct(store, plain, {
        name: "Brand",
        normalizedName: "brand",
        calories: 140,
        nutritionSource: "openfoodfacts",
    });
    await store.updateFoodRow({ ...plain, usualProductId: usual.id });
    const catalog = new Map([
        [plain.id, { ...plain, usualProductId: usual.id }],
        [usual.id, usual],
    ]);
    const eff = effectiveFood({ ...plain, usualProductId: usual.id }, catalog);
    expect(eff.calories).toBe(140);
    expect(eff.proteinG).toBeNull();
    expect(eff.nutritionSource).toBe("openfoodfacts");
    expect(eff.product?.id).toBe(usual.id);
});

test("effectiveFood keeps plain nutrition when usual has none but sets product", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            calories: 50,
        }),
    );
    const usual = await insertProduct(store, plain, {
        name: "Brand",
        normalizedName: "brand",
    });
    const catalog = new Map([
        [plain.id, { ...plain, usualProductId: usual.id }],
        [usual.id, usual],
    ]);
    const eff = effectiveFood({ ...plain, usualProductId: usual.id }, catalog);
    expect(eff.calories).toBe(50);
    expect(eff.product?.name).toBe("Brand");
});

test("effectiveFood merges unit factors field by field", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Milk",
            gramsPerMl: 1.03,
        }),
    );
    const usual = await insertProduct(store, plain, {
        name: "Fairlife",
        normalizedName: "fairlife",
        gramsPerEach: 240,
    });
    const catalog = new Map([
        [plain.id, { ...plain, usualProductId: usual.id }],
        [usual.id, usual],
    ]);
    const eff = effectiveFood({ ...plain, usualProductId: usual.id }, catalog);
    expect(eff.gramsPerEach).toBe(240);
    expect(eff.gramsPerMl).toBe(1.03);
});

test("effectiveFood unions allergens without duplicates", () => {
    const plain: Food = {
        ...newFood({ householdId: HH, kind: "food", name: "X" }),
        allergens: ["milk", "egg"],
    };
    const usual: Food = {
        ...newFood({ householdId: HH, kind: "food", name: "Y" }),
        genericFoodId: plain.id,
        allergens: ["egg", "soy"],
    };
    const catalog = new Map([
        [plain.id, { ...plain, usualProductId: usual.id }],
        [usual.id, usual],
    ]);
    const eff = effectiveFood({ ...plain, usualProductId: usual.id }, catalog);
    expect(eff.allergens).toEqual(["milk", "egg", "soy"]);
});

test("effectiveFood passes product and standalone through unchanged", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "P",
        normalizedName: "p",
        calories: 1,
    });
    const cat = new Map<string, Food>([[product.id, product]]);
    const effP = effectiveFood(product, cat);
    expect(effP.product).toBeNull();
    expect(effP.calories).toBe(1);
    const effS = effectiveFood(plain, cat);
    expect(effS.product).toBeNull();
    expect(effS.id).toBe(plain.id);
});

test("effectiveFood ignores invalid usual", () => {
    const plain = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const missing = effectiveFood(
        { ...plain, usualProductId: crypto.randomUUID() },
        new Map([[plain.id, plain]]),
    );
    expect(missing.product).toBeNull();
    const archivedUsual = newFood({
        householdId: HH,
        kind: "food",
        name: "U",
    });
    archivedUsual.archivedAt = new Date().toISOString();
    const wrongPlain = newFood({
        householdId: HH,
        kind: "food",
        name: "Other",
    });
    const wrongLink = newFood({
        householdId: HH,
        kind: "food",
        name: "U2",
        genericFoodId: wrongPlain.id,
    });
    const cat = new Map([
        [plain.id, { ...plain, usualProductId: archivedUsual.id }],
        [archivedUsual.id, archivedUsual],
        [wrongLink.id, wrongLink],
    ]);
    expect(
        effectiveFood({ ...plain, usualProductId: archivedUsual.id }, cat)
            .product,
    ).toBeNull();
    expect(
        effectiveFood({ ...plain, usualProductId: wrongLink.id }, cat).product,
    ).toBeNull();
});

test("effectiveFood does not mutate inputs", () => {
    const plain = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const usual = newFood({
        householdId: HH,
        kind: "food",
        name: "U",
        genericFoodId: plain.id,
        calories: 1,
    });
    const plainCopy = { ...plain, usualProductId: usual.id };
    const allergensBefore = [...plain.allergens];
    const cat = new Map([
        [plain.id, plainCopy],
        [usual.id, usual],
    ]);
    effectiveFood(plainCopy, cat);
    expect(plain.allergens).toEqual(allergensBefore);
});

test("effectiveFoodsByIds loads usual and omits missing ids", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "K",
        normalizedName: "k",
        calories: 10,
    });
    await setUsualProduct(store, HH, plain.id, product.id);
    const map = await effectiveFoodsByIds(store, HH, [plain.id]);
    expect(map.get(plain.id)?.calories).toBe(10);
    expect(map.has(crypto.randomUUID())).toBe(false);
});

test("linkProduct link and unlink", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Kirkland" }),
    );
    const linked = await linkProduct(store, HH, product.id, plain.id);
    expect(linked.genericFoodId).toBe(plain.id);
    const unlinked = await linkProduct(store, HH, product.id, null);
    expect(unlinked.genericFoodId).toBeNull();
});

test("linkProduct unlink clears usual when product was usual", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "Kirkland",
        normalizedName: "kirkland",
    });
    await setUsualProduct(store, HH, plain.id, product.id);
    const unlinked = await linkProduct(store, HH, product.id, null);
    expect(unlinked.genericFoodId).toBeNull();
    expect((await store.getFood(HH, plain.id))?.usualProductId).toBeNull();
});

test("rejected archive with invalid fields writes nothing", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "Kirkland",
        normalizedName: "kirkland",
    });
    await setUsualProduct(store, HH, plain.id, product.id);
    const beforePlainArchive = JSON.stringify(await store.listFoods(HH));
    await expect(
        updateFood(store, HH, plain.id, { archived: true, calories: -1 }),
    ).rejects.toThrow(/negative/i);
    expect(JSON.stringify(await store.listFoods(HH))).toBe(beforePlainArchive);

    const beforeProductArchive = JSON.stringify(await store.listFoods(HH));
    await expect(
        updateFood(store, HH, product.id, { archived: true, gramsPerEach: 0 }),
    ).rejects.toThrow(/greater than zero/i);
    expect(JSON.stringify(await store.listFoods(HH))).toBe(
        beforeProductArchive,
    );
});

test("link rules: one level deep and validation", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "P",
        normalizedName: "p",
    });
    const other = await findOrCreateManualFood(store, HH, "food", "Milk");
    await expect(
        linkProduct(store, HH, product.id, product.id),
    ).rejects.toThrow(/different foods/i);
    await expect(
        linkProduct(store, HH, product.id, plain.id),
    ).resolves.toBeTruthy();
    const child = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Child" }),
    );
    await expect(linkProduct(store, HH, child.id, product.id)).rejects.toThrow(
        /product of another food/i,
    );
    const withUsual = await findOrCreateManualFood(store, HH, "food", "Cheese");
    const cheeseBrand = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Brand cheese" }),
    );
    await setUsualProduct(store, HH, withUsual.id, cheeseBrand.id);
    await expect(
        linkProduct(store, HH, withUsual.id, other.id),
    ).rejects.toThrow(/usual product/i);
    const supply = await findOrCreateManualFood(store, HH, "supply", "Foil");
    const supplyProduct = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Wrap" }),
    );
    await expect(
        linkProduct(store, HH, supplyProduct.id, supply.id),
    ).rejects.toThrow(/same kind/i);
    const archived = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Archived target" }),
    );
    await updateFood(store, HH, archived.id, { archived: true });
    const fresh = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Fresh" }),
    );
    await expect(linkProduct(store, HH, fresh.id, archived.id)).rejects.toThrow(
        /unknown food/i,
    );
    await store.insertFood(
        newFood({ householdId: HH2, kind: "food", name: "Remote" }),
    );
    const remotePlain = (await store.listFoods(HH2))[0]!;
    await expect(
        linkProduct(store, HH, fresh.id, remotePlain.id),
    ).rejects.toThrow(/unknown food/i);
});

test("setUsualProduct auto-links and rejects", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const other = await findOrCreateManualFood(store, HH, "food", "Milk");
    const solo = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Solo brand" }),
    );
    await setUsualProduct(store, HH, plain.id, solo.id);
    expect((await store.getFood(HH, solo.id))?.genericFoodId).toBe(plain.id);
    const product = await insertProduct(store, other, {
        name: "Other brand",
        normalizedName: "other-brand",
    });
    await expect(
        setUsualProduct(store, HH, plain.id, product.id),
    ).rejects.toThrow(/belongs to another food/i);
    await expect(
        setUsualProduct(store, HH, product.id, solo.id),
    ).rejects.toThrow(/product of another food/i);
    await setUsualProduct(store, HH, plain.id, null);
    expect((await store.getFood(HH, plain.id))?.usualProductId).toBeNull();
});

test("moving usual via linkProduct clears old plain usual", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await plainEggs(store);
    const milk = await findOrCreateManualFood(store, HH, "food", "Milk");
    const product = await insertProduct(store, eggs, {
        name: "K",
        normalizedName: "k",
    });
    await setUsualProduct(store, HH, eggs.id, product.id);
    await linkProduct(store, HH, product.id, milk.id);
    expect((await store.getFood(HH, eggs.id))?.usualProductId).toBeNull();
});

test("archive clears usual and product links", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "K",
        normalizedName: "k",
    });
    await setUsualProduct(store, HH, plain.id, product.id);
    await updateFood(store, HH, product.id, { archived: true });
    expect((await store.getFood(HH, plain.id))?.usualProductId).toBeNull();
    const p2 = await insertProduct(store, plain, {
        name: "K2",
        normalizedName: "k2",
    });
    await updateFood(store, HH, plain.id, { archived: true });
    expect((await store.getFood(HH, p2.id))?.genericFoodId).toBeNull();
    expect((await store.getFood(HH, plain.id))?.usualProductId).toBeNull();
});

test("rejected link writes nothing", async () => {
    const store = createMemoryFoodsStore();
    const before = await store.listFoods(HH);
    const plain = await plainEggs(store);
    const product = await insertProduct(store, plain, {
        name: "P",
        normalizedName: "p",
    });
    try {
        await linkProduct(store, HH, plain.id, product.id);
    } catch {
        /* expected */
    }
    const after = await store.listFoods(HH);
    expect(after.length).toBe(before.length + 2);
    expect((await store.getFood(HH, plain.id))?.genericFoodId).toBeNull();
});

test("createProduct", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const created = await createProduct(store, HH, plain.id, {
        name: " Kirkland ",
        calories: 140,
        makeUsual: true,
    });
    expect(created.genericFoodId).toBe(plain.id);
    expect(created.nutritionSource).toBe("manual");
    expect((await store.getFood(HH, plain.id))?.usualProductId).toBe(
        created.id,
    );
    const asProduct = await insertProduct(store, plain, {
        name: "X",
        normalizedName: "x",
    });
    await expect(
        createProduct(store, HH, asProduct.id, { name: "Bad" }),
    ).rejects.toThrow(/product of another food/i);
    const plain2 = await findOrCreateManualFood(store, HH, "food", "Bread");
    await updateFood(store, HH, plain2.id, { archived: true });
    await expect(
        createProduct(store, HH, plain2.id, { name: "B" }),
    ).rejects.toThrow(/unknown food/i);
    const plain3 = await findOrCreateManualFood(store, HH, "food", "Rice");
    await expect(
        createProduct(store, HH, plain3.id, {
            name: "R",
            calories: -1,
        }),
    ).rejects.toThrow(/negative/i);
});

test("mergeFoods with products and usual", async () => {
    const store = createMemoryFoodsStore();
    const keep = await findOrCreateManualFood(store, HH, "food", "Keep");
    const drop = await findOrCreateManualFood(store, HH, "food", "Drop");
    const product = await insertProduct(store, drop, {
        name: "P",
        normalizedName: "p",
    });
    await setUsualProduct(store, HH, drop.id, product.id);
    await mergeFoods(store, HH, keep.id, drop.id);
    expect((await store.getFood(HH, product.id))?.genericFoodId).toBe(keep.id);
    expect((await store.getFood(HH, keep.id))?.usualProductId).toBe(product.id);
});

test("mergeFoods: drop product that is another food's usual", async () => {
    const store = createMemoryFoodsStore();
    const x = await findOrCreateManualFood(store, HH, "food", "X food");
    const keep = await findOrCreateManualFood(store, HH, "food", "Keep solo");
    const drop = await insertProduct(store, x, {
        name: "X brand",
        normalizedName: "x-brand",
    });
    await setUsualProduct(store, HH, x.id, drop.id);
    await mergeFoods(store, HH, keep.id, drop.id);
    expect((await store.getFood(HH, keep.id))?.genericFoodId).toBe(x.id);
    expect((await store.getFood(HH, x.id))?.usualProductId).toBe(keep.id);
});

test("mergeFoods rejects same family and cross-food products", async () => {
    const store = createMemoryFoodsStore();
    const plain = await plainEggs(store);
    const sibling = await insertProduct(store, plain, {
        name: "S",
        normalizedName: "s",
    });
    await expect(mergeFoods(store, HH, plain.id, sibling.id)).rejects.toThrow(
        /same food/i,
    );
    const x = await findOrCreateManualFood(store, HH, "food", "X");
    const y = await findOrCreateManualFood(store, HH, "food", "Y");
    const px = await insertProduct(store, x, {
        name: "PX",
        normalizedName: "px",
    });
    const py = await insertProduct(store, y, {
        name: "PY",
        normalizedName: "py",
    });
    await expect(mergeFoods(store, HH, px.id, py.id)).rejects.toThrow(
        /different foods/i,
    );
});

test("mergeFoods rejects nesting two deep", async () => {
    const store = createMemoryFoodsStore();
    const x = await findOrCreateManualFood(store, HH, "food", "X");
    const keep = await insertProduct(store, x, {
        name: "Keep prod",
        normalizedName: "keep-prod",
    });
    const drop = await findOrCreateManualFood(store, HH, "food", "Drop");
    await insertProduct(store, drop, {
        name: "Child",
        normalizedName: "child",
    });
    const snapshot = JSON.stringify(await store.listFoods(HH));
    await expect(mergeFoods(store, HH, keep.id, drop.id)).rejects.toThrow(
        /two deep/i,
    );
    expect(JSON.stringify(await store.listFoods(HH))).toBe(snapshot);
});
