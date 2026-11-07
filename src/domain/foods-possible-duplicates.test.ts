import { describe, expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    duplicatePairs,
    duplicatesNeedRefCounts,
    foodNameTokens,
    foodPairMergeConflicts,
    mergeFoodPair,
    mergeFoods,
    newFood,
    possibleDuplicates,
    type Food,
    type PossibleDuplicatePair,
} from "./foods.js";
import { createMemoryFridgeStore } from "./fridge.js";
import { createMemoryGroceryStore } from "./grocery.js";
import { createMemoryRecipesStore } from "./recipes.js";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKeyString,
    lookupDismissalKey,
} from "./notice-dismissals.js";
import {
    dismissalSubjectLabel,
    dismissNotice,
    noticesFor,
    possibleDuplicateNotices,
} from "./notices-for.js";
import {
    noticeSentence,
    NOTICE_COPY,
    noticeDismissLabel,
    noticeDismissPair,
} from "../copy/notices.js";
import { attentionFromNotices } from "../web/attention.js";
import { needsAttentionCount, tabDotsFromNotices } from "./notices.js";
import { HELP_GLOSSARY_IDS } from "../web/pages/settings-help.js";

function pairListed(
    pairs: readonly PossibleDuplicatePair[],
    x: string,
    y: string,
): boolean {
    return pairs.some(
        (p) =>
            (p.subject.id === x && p.related.id === y) ||
            (p.subject.id === y && p.related.id === x),
    );
}

const HH = "hh-poss-dup";

function food(over: Partial<Food> & Pick<Food, "id" | "name">): Food {
    const householdId = over.householdId ?? HH;
    return {
        ...newFood({
            householdId,
            kind: over.kind ?? "food",
            name: over.name,
        }),
        ...over,
        householdId,
        kind: over.kind ?? "food",
        createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
        updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
    } as Food;
}

describe("possibleDuplicates", () => {
    test("lists contains and same-words pairs", () => {
        const foods = [
            food({ id: "a1", name: "chicken egg" }),
            food({ id: "b1", name: "Eggs" }),
            food({ id: "a2", name: "egg" }),
            food({ id: "b2", name: "eggs" }),
        ];
        const pairs = possibleDuplicates(
            foods,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(pairs.some((p) => p.rule === "contains_words")).toBe(true);
        expect(pairs.some((p) => p.rule === "same_words")).toBe(true);
    });

    test("excludes job-auto-merge loose-key same brand", () => {
        const foods = [
            food({ id: "f1", name: "All purpose flour" }),
            food({ id: "f2", name: "all-purpose flour" }),
        ];
        expect(
            possibleDuplicates(foods, new Map(), new Set(), new Set()),
        ).toHaveLength(0);
    });

    test("lists loose-key pair when job would skip conflict", () => {
        const foods = [
            food({ id: "f1", name: "All purpose flour", calories: 100 }),
            food({ id: "f2", name: "all purpose flour", calories: 200 }),
        ];
        expect(
            possibleDuplicates(foods, new Map(), new Set(), new Set()).length,
        ).toBe(1);
    });

    test("excludes products, barcodes, off, kinds, brands, dismissed", () => {
        const foods = [
            food({ id: "plain-egg", name: "egg" }),
            food({
                id: "product-eggs",
                name: "Eggs",
                genericFoodId: "generic-egg",
            }),
            food({ id: "generic-egg", name: "Warehouse stub" }),
            food({ id: "barcoded-eggs", name: "eggs" }),
            food({ id: "off-egg", name: "egg", offSourceId: "off:1" }),
            food({ id: "supply-egg", name: "egg", kind: "supply" }),
            food({ id: "brand-a", name: "milk", brand: "A" }),
            food({ id: "brand-b", name: "milk", brand: "B" }),
            food({ id: "control-a", name: "rice" }),
            food({ id: "control-b", name: "rice" }),
        ];
        const barcoded = new Set(["barcoded-eggs"]);
        const dismissed = new Set([
            dismissalKeyString(
                lookupDismissalKey(
                    "food.possible_duplicate",
                    "food",
                    "control-a",
                    "control-b",
                ),
            ),
        ]);
        const pairs = possibleDuplicates(foods, new Map(), barcoded, dismissed);
        const pairKey = (a: string, b: string) =>
            a < b ? `${a}:${b}` : `${b}:${a}`;
        const keys = new Set(
            pairs.map((p) => pairKey(p.subject.id, p.related.id)),
        );
        expect(keys.has(pairKey("plain-egg", "product-eggs"))).toBe(false);
        expect(keys.has(pairKey("plain-egg", "barcoded-eggs"))).toBe(false);
        expect(keys.has(pairKey("plain-egg", "off-egg"))).toBe(false);
        expect(keys.has(pairKey("plain-egg", "supply-egg"))).toBe(false);
        expect(keys.has(pairKey("brand-a", "brand-b"))).toBe(false);
        expect(keys.has(pairKey("control-a", "control-b"))).toBe(false);
        expect(keys.size).toBe(0);
    });

    test("subject is smaller id and order is deterministic", () => {
        const foods = [
            food({ id: "z-last", name: "egg" }),
            food({ id: "a-first", name: "eggs" }),
        ];
        const pairs = possibleDuplicates(
            foods,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(pairs).toHaveLength(1);
        expect(pairs[0]!.subject.id).toBe("a-first");
        expect(pairs[0]!.related.id).toBe("z-last");
    });

    test("re-lists after merge into third food", async () => {
        const store = createMemoryFoodsStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const a = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "egg" }),
            id: "ea",
        });
        const b = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "eggs" }),
            id: "eb",
        });
        const c = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "chicken egg" }),
            id: "ec",
        });
        const dismissed = new Set([
            dismissalKeyString(
                lookupDismissalKey(
                    "food.possible_duplicate",
                    "food",
                    a.id < b.id ? a.id : b.id,
                    a.id < b.id ? b.id : a.id,
                ),
            ),
        ]);
        let listed = await store.listFoods(HH);
        const hasPair = (
            pairs: PossibleDuplicatePair[],
            x: string,
            y: string,
        ) =>
            pairs.some(
                (p) =>
                    (p.subject.id === x && p.related.id === y) ||
                    (p.subject.id === y && p.related.id === x),
            );
        expect(
            hasPair(
                possibleDuplicates(listed, new Map(), new Set(), dismissed),
                a.id,
                b.id,
            ),
        ).toBe(false);
        const merged = await mergeFoods(store, HH, a.id, b.id);
        listed = await store.listFoods(HH);
        const pairs = possibleDuplicates(
            listed,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(pairs.length).toBeGreaterThan(0);
        expect(
            pairs.some(
                (p) =>
                    (p.subject.id === merged.id ||
                        p.related.id === merged.id) &&
                    (p.subject.id === c.id || p.related.id === c.id),
            ),
        ).toBe(true);
        void dismissals;
    });

    test("job exclusion matches duplicatePairs with refs (three flours)", () => {
        const foods = [
            food({ id: "fa", name: "flour", calories: 100 }),
            food({ id: "fb", name: "flour", calories: 200 }),
            food({ id: "fc", name: "flour", calories: 200 }),
        ];
        const refs = new Map([
            ["fa", 0],
            ["fb", 5],
            ["fc", 0],
        ]);
        const hasPair = (
            pairs: PossibleDuplicatePair[],
            x: string,
            y: string,
        ) =>
            pairs.some(
                (p) =>
                    (p.subject.id === x && p.related.id === y) ||
                    (p.subject.id === y && p.related.id === x),
            );
        const empty = possibleDuplicates(
            foods,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(hasPair(empty, "fb", "fc")).toBe(true);
        const withRefs = possibleDuplicates(
            foods,
            new Map(),
            new Set(),
            new Set(),
            refs,
        );
        expect(hasPair(withRefs, "fb", "fc")).toBe(false);
        expect(withRefs.length).toBeGreaterThan(0);
    });

    test("job exclusion matches duplicatePairs with refs (grams per each)", () => {
        const foods = [
            food({ id: "ga", name: "flour", gramsPerEach: 50 }),
            food({ id: "gb", name: "flour", gramsPerEach: 60 }),
            food({ id: "gc", name: "flour", gramsPerEach: 50 }),
        ];
        const refs = new Map([
            ["ga", 0],
            ["gb", 9],
            ["gc", 0],
        ]);
        const hasPair = (
            pairs: PossibleDuplicatePair[],
            x: string,
            y: string,
        ) =>
            pairs.some(
                (p) =>
                    (p.subject.id === x && p.related.id === y) ||
                    (p.subject.id === y && p.related.id === x),
            );
        const empty = possibleDuplicates(
            foods,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(hasPair(empty, "ga", "gc")).toBe(false);
        const withRefs = possibleDuplicates(
            foods,
            new Map(),
            new Set(),
            new Set(),
            refs,
        );
        expect(hasPair(withRefs, "ga", "gc")).toBe(true);
    });

    test("duplicatesNeedRefCounts is true only when a loose-key group exists", () => {
        expect(
            duplicatesNeedRefCounts([
                food({ id: "a", name: "egg" }),
                food({ id: "b", name: "eggs" }),
            ]),
        ).toBe(false);
        expect(
            duplicatesNeedRefCounts([
                food({ id: "a", name: "All purpose flour" }),
                food({ id: "b", name: "all-purpose flour", brand: "KA" }),
            ]),
        ).toBe(false);
        expect(
            duplicatesNeedRefCounts([
                food({ id: "a", name: "All purpose flour" }),
                food({ id: "b", name: "all-purpose flour" }),
            ]),
        ).toBe(true);
        expect(
            duplicatesNeedRefCounts([
                food({ id: "a", name: "flour" }),
                food({ id: "b", name: "flour" }),
                food({ id: "c", name: "flour" }),
            ]),
        ).toBe(true);
    });

    test("a two-row alias skip depends on refs, and noticesFor loads them", async () => {
        // The job checks only the dropped row's name against existing aliases,
        // so which row is kept (by refs) decides merge vs skip.
        const store = createMemoryFoodsStore();
        const wheat = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Wheat flour" }),
        );
        const older = await store.insertFood({
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "all purpose flour",
            }),
            createdAt: "2020-01-01T00:00:00.000Z",
        });
        const newer = await store.insertFood({
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "all-purpose flour",
            }),
            createdAt: "2024-01-01T00:00:00.000Z",
        });
        await store.setAlias(HH, "all purpose flour", wheat.id);
        const refs = new Map([[newer.id, 8]]);
        store.countFoodRefs = async () => refs;
        const aliases = await store.listAllAliases(HH);
        const catalog = await store.listFoods(HH);
        const noRefs = possibleDuplicates(
            catalog,
            aliases,
            new Set(),
            new Set(),
        );
        const withRefs = possibleDuplicates(
            catalog,
            aliases,
            new Set(),
            new Set(),
            refs,
        );
        expect(pairListed(noRefs, older.id, newer.id)).toBe(false);
        expect(pairListed(withRefs, older.id, newer.id)).toBe(true);
        const result = await noticesFor(
            {
                foods: store,
                fridge: createMemoryFridgeStore(),
                recipes: createMemoryRecipesStore(),
                dismissals: createMemoryNoticeDismissalsStore(),
            },
            HH,
        );
        expect(
            result.notices.some(
                (n) =>
                    n.code === "food.possible_duplicate" &&
                    [n.subject.id, n.related[0]?.id].includes(older.id) &&
                    [n.subject.id, n.related[0]?.id].includes(newer.id),
            ),
        ).toBe(true);
    });
});

describe("mergeFoodPair nutrition and allergens", () => {
    test("conflict detection includes null vs number", () => {
        const keep = food({
            id: "k",
            name: "a",
            calories: 100,
            proteinG: null,
            nutritionSource: null,
            allergens: ["xyz", "peanut"],
        });
        const drop = food({
            id: "d",
            name: "b",
            calories: 140,
            proteinG: 12,
            nutritionSource: "openfoodfacts",
            allergens: ["milk"],
        });
        expect(foodPairMergeConflicts(keep, drop).sort()).toEqual([
            "calories",
            "protein_g",
        ]);
    });

    test("merge keeps picked nutrition and source; allergens union via mergeFoods", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "Keep" }),
            calories: 100,
            proteinG: null,
            nutritionSource: null,
            allergens: ["xyz", "peanut"],
        });
        const drop = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "Drop" }),
            calories: 140,
            proteinG: 12,
            nutritionSource: "openfoodfacts",
            allergens: ["milk"],
        });
        await mergeFoodPair(store, HH, {
            keepId: keep.id,
            dropId: drop.id,
            picks: { calories: keep.id, protein_g: keep.id },
        });
        const merged = (await store.getFood(HH, keep.id))!;
        expect(merged.calories).toBe(100);
        expect(merged.proteinG).toBeNull();
        expect(merged.nutritionSource).toBeNull();
        expect(merged.allergens.sort()).toEqual(["milk", "peanut", "xyz"]);
    });

    test("picking drop protein updates value; source stays unless all nutrients from drop", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "Keep2" }),
            calories: 100,
            proteinG: null,
            nutritionSource: null,
            allergens: [],
        });
        const drop = await store.insertFood({
            ...newFood({ householdId: HH, kind: "food", name: "Drop2" }),
            calories: 140,
            proteinG: 12,
            nutritionSource: "openfoodfacts",
            allergens: [],
        });
        await mergeFoodPair(store, HH, {
            keepId: keep.id,
            dropId: drop.id,
            picks: { calories: keep.id, protein_g: drop.id },
        });
        const merged = (await store.getFood(HH, keep.id))!;
        expect(merged.proteinG).toBe(12);
        expect(merged.nutritionSource).toBeNull();
    });
});

function brandKey(brand: string | null | undefined): string | null {
    return brand?.trim() ? brand.trim() : null;
}

function brandsConflict(a: Food, b: Food): boolean {
    const ba = brandKey(a.brand);
    const bb = brandKey(b.brand);
    return ba != null && bb != null && ba !== bb;
}

/** Spec oracle: equal token sets, or strict subset with unbranded larger name. */
function specPairRule(
    a: Food,
    b: Food,
    setA: Set<string>,
    setB: Set<string>,
): PossibleDuplicatePair["rule"] | null {
    if (a.householdId !== b.householdId || a.kind !== b.kind) return null;
    if (setA.size === 0 || setB.size === 0) return null;
    const equalSize = setA.size === setB.size;
    if (equalSize) {
        for (const t of setA) {
            if (!setB.has(t)) return null;
        }
        return "same_words";
    }
    const [small, large, smallFood] =
        setA.size < setB.size ? [setA, setB, a] : [setB, setA, b];
    if (small.size >= large.size) return null;
    for (const t of small) {
        if (!large.has(t)) return null;
    }
    const largerFood = setA.size < setB.size ? b : a;
    if (brandKey(largerFood.brand) != null) return null;
    if (
        brandKey(smallFood.brand) != null &&
        brandKey(largerFood.brand) != null
    ) {
        if (brandKey(smallFood.brand) !== brandKey(largerFood.brand))
            return null;
    }
    return "contains_words";
}

function jobAutoMergedPairKeysBrute(
    foods: readonly Food[],
    refCounts: ReadonlyMap<string, number>,
    aliases: ReadonlyMap<string, string[]>,
): Set<string> {
    const { merges } = duplicatePairs(foods, refCounts, aliases);
    const parent = new Map<string, string>();
    const find = (id: string): string => {
        let p = parent.get(id) ?? id;
        if (p !== id) {
            p = find(p);
            parent.set(id, p);
        }
        return p;
    };
    const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    };
    for (const m of merges) union(m.keep.id, m.drop.id);
    const clusterIds = new Map<string, string[]>();
    for (const m of merges) {
        for (const id of [m.keep.id, m.drop.id]) {
            const root = find(id);
            const list = clusterIds.get(root) ?? [];
            if (!list.includes(id)) list.push(id);
            clusterIds.set(root, list);
        }
    }
    const keys = new Set<string>();
    for (const ids of clusterIds.values()) {
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const subjectId = ids[i]! < ids[j]! ? ids[i]! : ids[j]!;
                const relatedId = ids[i]! < ids[j]! ? ids[j]! : ids[i]!;
                keys.add(`${subjectId}\0${relatedId}`);
            }
        }
    }
    return keys;
}

function possibleDuplicatesBrute(
    foods: readonly Food[],
    aliases: ReadonlyMap<string, string[]>,
    barcodedIds: ReadonlySet<string>,
    dismissed: ReadonlySet<string>,
    refCounts: ReadonlyMap<string, number>,
): PossibleDuplicatePair[] {
    const jobMerged = jobAutoMergedPairKeysBrute(foods, refCounts, aliases);
    const candidates = foods.filter(
        (row) =>
            row.archivedAt == null &&
            row.genericFoodId == null &&
            !barcodedIds.has(row.id) &&
            !row.offSourceId &&
            foodNameTokens(row.name).length > 0,
    );
    const tokenSets = new Map(
        candidates.map((row) => [row.id, new Set(foodNameTokens(row.name))]),
    );
    const seen = new Set<string>();
    const pairs: PossibleDuplicatePair[] = [];
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const a = candidates[i]!;
            const b = candidates[j]!;
            if (a.kind !== b.kind || a.householdId !== b.householdId) continue;
            const aTokens = tokenSets.get(a.id)!;
            const bTokens = tokenSets.get(b.id)!;
            const rule = specPairRule(a, b, aTokens, bTokens);
            if (!rule) continue;
            if (brandsConflict(a, b)) continue;
            const subjectId = a.id < b.id ? a.id : b.id;
            const relatedId = a.id < b.id ? b.id : a.id;
            const key = `${subjectId}\0${relatedId}`;
            if (seen.has(key) || jobMerged.has(key)) continue;
            const dismissKey = dismissalKeyString(
                lookupDismissalKey(
                    "food.possible_duplicate",
                    "food",
                    subjectId,
                    relatedId,
                ),
            );
            if (dismissed.has(dismissKey)) continue;
            seen.add(key);
            const subject = subjectId === a.id ? a : b;
            const related = relatedId === a.id ? a : b;
            pairs.push({ subject, related, rule });
        }
    }
    pairs.sort((p, q) => {
        const bySub = p.subject.name.localeCompare(q.subject.name);
        if (bySub !== 0) return bySub;
        const byRel = p.related.name.localeCompare(q.related.name);
        if (byRel !== 0) return byRel;
        const byIds = p.subject.id.localeCompare(q.subject.id);
        if (byIds !== 0) return byIds;
        return p.related.id.localeCompare(q.related.id);
    });
    return pairs;
}

function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("possibleDuplicates matches brute force on seeded catalog", () => {
    const vocab = [
        "egg",
        "eggs",
        "milk",
        "rice",
        "flour",
        "chicken",
        "bread",
        "butter",
        "salt",
        "sugar",
        "mom's",
        "fish & chips",
    ];
    const rand = mulberry32(0xfeedbeef);
    const foods: Food[] = [];
    const households = [HH, "hh-other"];
    for (let i = 0; i < 240; i++) {
        const w1 = vocab[Math.floor(rand() * vocab.length)]!;
        const w2 =
            rand() > 0.7 ? vocab[Math.floor(rand() * vocab.length)]! : "";
        const name = w2 ? `${w1} ${w2}` : w1;
        const kind = rand() > 0.92 ? "supply" : "food";
        const brand = rand() > 0.85 ? `Brand${Math.floor(rand() * 5)}` : null;
        const archived = rand() > 0.96;
        const genericFoodId = rand() > 0.94 ? "generic-parent" : null;
        const offSourceId = rand() > 0.97 ? `off:${i}` : null;
        const householdId = households[Math.floor(rand() * households.length)]!;
        foods.push(
            food({
                id: `f-${i}`,
                name,
                kind,
                brand,
                householdId,
                archivedAt: archived ? "2026-01-01T00:00:00.000Z" : null,
                genericFoodId,
                offSourceId,
                calories: rand() > 0.5 ? Math.floor(rand() * 400) + 50 : null,
            }),
        );
    }
    foods.push(
        food({
            id: "generic-parent",
            name: "Parent",
            genericFoodId: null,
            householdId: HH,
        }),
    );
    const refCounts = new Map<string, number>();
    for (const f of foods) {
        if (!f.archivedAt) {
            refCounts.set(f.id, Math.floor(rand() * 12));
        }
    }
    const barcoded = new Set(
        foods.filter((_, i) => i % 41 === 0).map((f) => f.id),
    );
    const dismissed = new Set<string>();
    if (foods[10] && foods[11]) {
        dismissed.add(
            dismissalKeyString(
                lookupDismissalKey(
                    "food.possible_duplicate",
                    "food",
                    foods[10]!.id < foods[11]!.id
                        ? foods[10]!.id
                        : foods[11]!.id,
                    foods[10]!.id < foods[11]!.id
                        ? foods[11]!.id
                        : foods[10]!.id,
                ),
            ),
        );
    }
    const aliases = new Map<string, string[]>();
    const bucketed = possibleDuplicates(
        foods,
        aliases,
        barcoded,
        dismissed,
        refCounts,
    );
    const brute = possibleDuplicatesBrute(
        foods,
        aliases,
        barcoded,
        dismissed,
        refCounts,
    );
    expect(
        bucketed.map((p) => `${p.subject.id}:${p.related.id}:${p.rule}`),
    ).toEqual(brute.map((p) => `${p.subject.id}:${p.related.id}:${p.rule}`));
});

describe("possibleDuplicateNotices and noticesFor", () => {
    test("registry entry", () => {
        const entry = NOTICE_COPY["food.possible_duplicate"];
        expect(entry.dismissible).toBe(true);
        expect(noticeDismissLabel("food.possible_duplicate")).toBe(
            "Keep separate",
        );
        expect(noticeDismissPair("food.possible_duplicate")).toBe(true);
        expect(HELP_GLOSSARY_IDS).toContain("possible-duplicates");
    });

    test("producer output", () => {
        const foods = [
            food({ id: "s1", name: "chicken egg" }),
            food({ id: "s2", name: "Eggs" }),
        ];
        const notices = possibleDuplicateNotices(
            foods,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(notices).toHaveLength(1);
        expect(notices[0]!.code).toBe("food.possible_duplicate");
        expect(notices[0]!.subject).toEqual({ kind: "food", id: "s1" });
        expect(notices[0]!.related[0]?.id).toBe("s2");
        expect(notices[0]!.params.rule).toBe("contains_words");
        expect(noticeSentence(notices[0]!)).toBe(
            "chicken egg may be the same as Eggs",
        );
    });

    test("noticesFor includes pair, respects dismissals, and labels dismissed foods", async () => {
        const foods = createMemoryFoodsStore();
        const fridge = createMemoryFridgeStore();
        const recipes = createMemoryRecipesStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const grocery = createMemoryGroceryStore();
        const a = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "chicken egg" }),
        );
        const b = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const deps = { foods, fridge, recipes, dismissals, grocery };
        let listCalls = 0;
        const orig = dismissals.listForHousehold.bind(dismissals);
        dismissals.listForHousehold = async (hid) => {
            listCalls += 1;
            return orig(hid);
        };
        let countFoodRefsCalls = 0;
        const origCount = foods.countFoodRefs.bind(foods);
        foods.countFoodRefs = async (hid) => {
            countFoodRefsCalls += 1;
            return origCount(hid);
        };
        const twoOnly = await noticesFor(deps, HH);
        expect(countFoodRefsCalls).toBe(0);
        const open = await noticesFor(deps, HH);
        expect(
            open.notices.some((n) => n.code === "food.possible_duplicate"),
        ).toBe(true);
        expect(listCalls).toBeGreaterThanOrEqual(2);
        expect(open.subjectNames.get(`food:${a.id}`)).toBe("chicken egg");
        const openAttention = attentionFromNotices(open);
        const openCount = needsAttentionCount(open.notices);
        expect(openCount).toBeGreaterThan(0);
        expect(tabDotsFromNotices(open.notices).household).toBe(true);
        expect(openAttention.tabs.household).toBe(true);
        await dismissNotice(deps, HH, "u1", {
            code: "food.possible_duplicate",
            subjectKind: "food",
            subjectId: a.id,
            relatedId: b.id,
        });
        const after = await noticesFor(deps, HH);
        expect(
            after.notices.some((n) => n.code === "food.possible_duplicate"),
        ).toBe(false);
        expect(needsAttentionCount(after.notices)).toBe(openCount - 1);
        const withDismissed = await noticesFor(deps, HH, {
            includeDismissed: true,
        });
        expect(
            withDismissed.notices.some(
                (n) => n.code === "food.possible_duplicate",
            ),
        ).toBe(true);
        const row = withDismissed.dismissals.find(
            (d) => d.code === "food.possible_duplicate",
        )!;
        const sub = row.subjectId === a.id ? a.name : b.name;
        const rel = row.relatedKey === a.id ? a.name : b.name;
        expect(dismissalSubjectLabel(row, withDismissed.subjectNames)).toBe(
            `${sub} · ${rel}`,
        );
        const tripleStore = createMemoryFoodsStore();
        for (let i = 0; i < 3; i++) {
            await tripleStore.insertFood({
                ...newFood({
                    householdId: HH,
                    kind: "food",
                    name: "all purpose flour",
                    calories: 100 + i,
                }),
                normalizedName: `flour-triple-${i}`,
            });
        }
        const tripleDeps = {
            ...deps,
            foods: tripleStore,
        };
        let tripleCountCalls = 0;
        tripleStore.countFoodRefs = async (hid) => {
            tripleCountCalls += 1;
            return new Map();
        };
        await noticesFor(tripleDeps, HH);
        expect(tripleCountCalls).toBe(1);
    });
});

describe("pairs that read alike", () => {
    test("brands name each side, and both pairs render and count", async () => {
        const { noticeList } = await import("../web/components/notices.js");
        const foods = [
            food({ id: "m0", name: "Milk" }),
            food({ id: "m1", name: "Milk", brand: "Organic Valley" }),
            food({ id: "m2", name: "Milk", brand: "Horizon" }),
        ];
        const notices = possibleDuplicateNotices(
            foods,
            new Map(),
            new Set(),
            new Set(),
        );
        expect(notices.length).toBe(2);
        expect(notices.map(noticeSentence).sort()).toEqual([
            "Milk may be the same as Milk (Horizon)",
            "Milk may be the same as Milk (Organic Valley)",
        ]);
        const html = noticeList(notices);
        expect(html.match(/class="notice-row"/g)?.length).toBe(2);
        expect(needsAttentionCount(notices)).toBe(2);
    });
});
