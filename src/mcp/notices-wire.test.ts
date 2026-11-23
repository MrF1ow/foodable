import { test, expect } from "bun:test";
import type { Notice } from "../domain/notices.js";
import { NOTICE_CODES, type NoticeCode } from "../domain/notices.js";
import { noticeSentence } from "../copy/notices.js";
import { eventSentence } from "../copy/notifications.js";
import { noticeToWire, NOTICE_SCHEMA } from "./shared.js";
import { notificationOpenHref } from "../web/pages/v2/notifications.js";
import { APP_PATHS } from "../web/route-map.js";
import { NOTIFICATION_SCHEMA, notificationToWire } from "./tools/notices.js";
import {
    kindForNoticeCode,
    NOTIFICATION_KIND_IDS,
    NOTIFICATION_KINDS,
    type NotificationKind,
} from "../domain/notification-kinds.js";
import { fanOutEvent, syncConditions } from "../domain/notifications.js";
import { allergenConditionNotices } from "../domain/notices-allergens.js";
import { fridgeNotices } from "../domain/stock.js";
import { groceryRestockNotices } from "../domain/restock.js";
import { recipeNotices, type RecipeIngredient } from "../domain/recipes.js";
import { allergenNotices } from "../domain/grocery.js";
import { possibleDuplicateNotices } from "../domain/notices-for.js";
import {
    planMissingNotices,
    runningLowNotices,
    weighInDueNotices,
} from "../domain/notices-actionable.js";
import { checkProductForMember } from "../domain/product-checks.js";
import { addAllergen, createMemoryRulesStore } from "../domain/rules.js";
import {
    createMemoryFoodsStore,
    effectiveFoodsByIds,
    effectiveFoodsFromListed,
    findOrCreateManualFood,
    newFood,
    updateFood,
    type Food,
} from "../domain/foods.js";
import type { GroceryLine } from "../domain/grocery.js";
import type { FridgeItem } from "../domain/fridge.js";

test("noticeToWire maps subjects, action, and message", () => {
    const gap: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: { kind: "recipe_ingredient", id: "ing-1", recipeId: "rec-1" },
        related: [],
        params: { name: "Milk", recipeName: "Oatmeal" },
    };
    const w = noticeToWire(gap);
    expect(NOTICE_SCHEMA.parse(w)).toEqual(w);
    expect(w.subject.recipe_id).toBe("rec-1");
    expect(w.action).toEqual({ label: "Pick usual product" });
    expect(w.message).toBe(noticeSentence(gap));
    expect(w.title).toBe("Milk");
    expect(w.detail).toBe("Oatmeal");
    expect(w.group_key).toBe("recipe_gaps");
    expect(w.group_label).toBe("Recipes");
    expect(w.can_dismiss).toBe(false);
    expect(w.dismiss).toBeNull();

    const recipeOnly: Notice = {
        code: "recipe.allergen",
        severity: "block",
        subject: { kind: "recipe", id: "r1" },
        related: [{ kind: "member", id: "u1", name: "Pat" }],
        params: { allergens: ["peanut"] },
    };
    const wr = noticeToWire(recipeOnly);
    expect(wr.subject.recipe_id).toBeNull();
    expect(wr.action).toBeNull();
    expect(wr.message).toBe(noticeSentence(recipeOnly));
    expect(wr.group_key).toBe("household");
});

test("noticeToWire maps food.possible_duplicate", () => {
    const dup: Notice = {
        code: "food.possible_duplicate",
        severity: "info",
        subject: { kind: "food", id: "f-a" },
        related: [{ kind: "food", id: "f-b", name: "Eggs" }],
        params: { name: "chicken egg", rule: "contains_words", foodId: "f-a" },
    };
    const w = noticeToWire(dup);
    expect(NOTICE_SCHEMA.parse(w)).toEqual(w);
    expect(w.message).toBe(noticeSentence(dup));
    expect(w.action).toEqual({ label: "Review" });
    expect(w.can_dismiss).toBe(true);
    expect(w.dismiss?.related_id).toBe("f-b");
    expect(w.detail).toBe("may be the same as Eggs");
});

const TODAY = "2026-06-01";
const HH = "hh-wire";

function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function dupFood(over: Partial<Food> & Pick<Food, "id" | "name">): Food {
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

function wireIng(
    over: Partial<RecipeIngredient> &
        Pick<RecipeIngredient, "id" | "displayName">,
): RecipeIngredient {
    return {
        householdId: HH,
        recipeId: "rec-wire",
        kind: "food",
        quantity: { amount: 100, unit: "g" },
        foodId: null,
        sortOrder: 0,
        note: null,
        ...over,
    };
}

function fridgeItem(
    over: Partial<FridgeItem> &
        Pick<FridgeItem, "id" | "displayName" | "expiresOn">,
): FridgeItem {
    return {
        householdId: HH,
        locationId: "loc",
        kind: "food",
        foodId: "food-1",
        quantity: { amount: 1, unit: "each" },
        ...over,
    };
}

function restockLine(
    over: Partial<GroceryLine> & Pick<GroceryLine, "id">,
): GroceryLine {
    return {
        householdId: HH,
        storeId: "st",
        sectionId: "sec",
        kind: "food",
        displayName: "Milk",
        quantity: { amount: 1, unit: "l" },
        foodId: "food-1",
        checked: false,
        source: "restock",
        sourceFridgeItemId: "fi-restock",
        note: null,
        ...over,
    };
}

async function producerNotices(): Promise<Notice[]> {
    const out: Notice[] = [];
    out.push(
        ...fridgeNotices(
            [
                {
                    id: "fi-exp",
                    kind: "food",
                    foodId: "f-yog",
                    displayName: "Yogurt",
                    quantity: { amount: 1, unit: "cup" },
                    expiresOn: addDays(TODAY, -1),
                },
                {
                    id: "fi-food",
                    kind: "food",
                    foodId: "f-spin",
                    displayName: "Spinach",
                    quantity: { amount: 1, unit: "bag" },
                    expiresOn: addDays(TODAY, 2),
                },
                {
                    id: "fi-supply",
                    kind: "supply",
                    foodId: null,
                    displayName: "Zip bags",
                    quantity: { amount: 1, unit: "box" },
                    expiresOn: addDays(TODAY, 2),
                },
            ],
            TODAY,
        ),
    );
    const restockFridge = fridgeItem({
        id: "fi-restock",
        displayName: "Whole milk",
        foodId: "f-milk",
        expiresOn: addDays(TODAY, 3),
    });
    out.push(
        ...groceryRestockNotices(
            [restockLine({ id: "gl-restock" })],
            [restockFridge],
            TODAY,
        ),
    );
    const rules = createMemoryRulesStore();
    await addAllergen(rules, {
        householdId: HH,
        userId: "pat-id",
        allergen: "peanut",
    });
    const patAllergens = await rules.listAllergens(HH, "pat-id");
    const members = [
        { displayName: "Pat", userId: "pat-id", allergens: patAllergens },
    ];
    out.push(
        ...allergenNotices(
            { kind: "grocery_line", id: "gl-peanut" },
            "Peanut Butter",
            members,
            null,
        ),
    );
    await addAllergen(rules, {
        householdId: HH,
        userId: "sam-id",
        allergen: "milk",
    });
    const samAllergens = await rules.listAllergens(HH, "sam-id");
    out.push(
        ...allergenNotices(
            { kind: "recipe", id: "rec-a" },
            "Milk chocolate tart",
            [{ displayName: "Sam", userId: "sam-id", allergens: samAllergens }],
            null,
        ),
    );
    out.push(
        ...possibleDuplicateNotices(
            [
                dupFood({ id: "f1", name: "chicken egg" }),
                dupFood({ id: "f2", name: "Eggs" }),
            ],
            new Map(),
            new Set(),
            new Set(),
        ),
    );

    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const vol = await findOrCreateManualFood(foods, HH, "food", "Cream");
    const volCat = await effectiveFoodsByIds(foods, HH, [vol.id]);
    const rId = "rec-wire";
    out.push(
        ...recipeNotices(
            rId,
            [wireIng({ id: "ing-nf", displayName: "Cumin", foodId: null })],
            catalog,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-na",
                    displayName: "Salt",
                    foodId: plain.id,
                    quantity: null,
                }),
            ],
            catalog,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-linked",
                    displayName: "Half and half",
                    foodId: plain.id,
                    quantity: { amount: 60, unit: "ml" },
                }),
            ],
            catalog,
        ),
    );
    const partial = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await updateFood(foods, HH, partial.id, {
        calories: 80,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const partialCat = await effectiveFoodsByIds(foods, HH, [partial.id]);
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-partial",
                    displayName: "Yogurt",
                    foodId: partial.id,
                }),
            ],
            partialCat,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-unit",
                    displayName: "Spice",
                    foodId: plain.id,
                    quantity: { amount: 1, unit: "pinch" },
                }),
            ],
            catalog,
        ),
    );
    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggCat = await effectiveFoodsByIds(foods, HH, [eggs.id]);
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-egg",
                    displayName: "Eggs",
                    foodId: eggs.id,
                    quantity: { amount: 2, unit: "each" },
                }),
            ],
            eggCat,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-vol",
                    displayName: "Cream",
                    foodId: vol.id,
                    quantity: { amount: 50, unit: "ml" },
                }),
            ],
            volCat,
        ),
    );
    // Product checks (rate_product): every food.product_* code from one
    // product against one member with an allergy, a dislike and a goal.
    out.push(
        ...checkProductForMember(
            {
                id: "p1",
                name: "Peanut Wheat Bar",
                allergensTags: ["en:peanuts", "en:gluten"],
                tracesTags: ["en:milk"],
                servingNutrition: { calories: 220 },
            },
            {
                id: "u1",
                name: "Alex",
                allergens: ["peanut", "milk", "wheat"],
                dislikes: ["peanut"],
            },
            { remaining: { calories: 500 } },
        ),
    );
    // Running low, missing for the plan, weigh-in due.
    const milk = effectiveFoodsFromListed([
        newFood({
            householdId: HH,
            kind: "food",
            name: "Milk",
            defaultUnit: "ml",
            restockWhenLow: true,
            usualAmount: { amount: 1000, unit: "ml" },
        }),
    ]);
    out.push(
        ...runningLowNotices({
            foodsById: milk,
            stock: [],
            lines: [],
            today: "2026-06-01",
        }),
        ...planMissingNotices({
            plans: [
                {
                    id: "plan-1",
                    householdId: HH,
                    recipeId: "r-bread",
                    date: "2026-06-02",
                    slot: "dinner",
                    servings: 1,
                    createdBy: null,
                    createdAt: "2026-06-01T00:00:00+00:00",
                },
            ],
            recipes: [
                {
                    id: "r-bread",
                    name: "Bread",
                    yieldPortions: 1,
                    ingredients: [
                        {
                            displayName: "Flour",
                            foodId: "flour",
                            quantity: { amount: 200, unit: "g" },
                        },
                    ],
                },
            ],
            stock: [],
            lines: [],
            foodsById: new Map(),
            today: "2026-06-01",
        }),
        ...weighInDueNotices({
            members: [
                {
                    userId: "u1",
                    displayName: "Alex",
                    lastLoggedAt: "2026-05-20T12:00:00Z",
                },
            ],
            today: "2026-06-01",
            timezone: "UTC",
        }),
    );
    return out;
}

test("noticeToWire digest from real producers covers every code", async () => {
    const notices = await producerNotices();
    const byCode = new Map<NoticeCode, Notice[]>();
    for (const notice of notices) {
        const list = byCode.get(notice.code) ?? [];
        list.push(notice);
        byCode.set(notice.code, list);
    }
    for (const code of NOTICE_CODES) {
        expect(byCode.has(code)).toBe(true);
    }
    for (const [code, list] of byCode) {
        for (const notice of list) {
            const w = noticeToWire(notice);
            expect(() => NOTICE_SCHEMA.parse(w)).not.toThrow();
            expect(w.title.length).toBeGreaterThan(0);
            expect(w.group_key.length).toBeGreaterThan(0);
            expect(w.group_label.length).toBeGreaterThan(0);
            if (code === "grocery.allergen") {
                expect(w.title).toBe("peanut");
                expect(w.detail).toBe("Pat");
                expect(w.group_key).toBe("household");
            }
            if (code === "food.possible_duplicate") {
                expect(w.title).toBe("chicken egg");
                expect(w.detail).toBe("may be the same as Eggs");
            }
            if (code === "recipe.no_food") {
                expect(w.title).toBe("Cumin");
                expect(w.group_label).toBe("Recipes");
            }
        }
    }
});

test("fridge.expiring without daysLeft still gets a dated digest detail", async () => {
    const notices = await producerNotices();
    const supply = notices.find(
        (n) => n.code === "fridge.expiring" && n.subject.id === "fi-supply",
    )!;
    const w = noticeToWire(supply);
    expect(w.detail).toBe("Jun 3");
    expect(w.detail_tone).toBe("warn");
});

test("grocery.restocked digest uses weekday wording from the producer", async () => {
    const notices = await producerNotices();
    const restock = notices.find((n) => n.code === "grocery.restocked")!;
    expect(noticeSentence(restock)).toContain("Thursday");
    const w = noticeToWire(restock);
    expect(w.detail).toBe("Thursday");
    expect(w.detail).not.toBe("3 days");
    expect(w.group_key).toBe("running_low");
    expect(w.title).toBe("Whole milk");
});

test("fridge.expired wire detail keeps expiry date when on grocery list", async () => {
    const notices = await producerNotices();
    const notice = notices.find((n) => n.code === "fridge.expired")!;
    const w = noticeToWire(notice);
    expect(w.detail).toContain("expired");
    expect(w.detail).toContain("May 31");
    expect(w.detail).not.toContain("grocery list");
});

test("recipe gap without plannedOn uses neutral group label", () => {
    const notice: Notice = {
        code: "recipe.no_food",
        severity: "warn",
        subject: {
            kind: "recipe_ingredient",
            id: "ing",
            recipeId: "r",
        },
        related: [],
        params: { name: "Cumin", recipeName: "Curry" },
    };
    const w = noticeToWire(notice);
    expect(w.group_label).toBe("Recipes");
    expect(w.detail).toBe("Curry");
});

test("product checks digest as the product with the check as detail", () => {
    const [allergen] = checkProductForMember(
        {
            id: "p1",
            name: "Peanut Bar",
            allergensTags: ["en:peanuts"],
            tracesTags: [],
        },
        { id: "u1", name: "Alex", allergens: ["peanut"], dislikes: [] },
        { remaining: {} },
    );
    const w = noticeToWire(allergen!);
    expect(w.title).toBe("Peanut Bar");
    expect(w.detail).toBe("Contains peanut — Alex.");
    expect(w.group_key).toBe("product_checks");
    expect(w.group_label).toBe("Product checks");
    expect(w.dot_tone).toBe("over");
    expect(w.detail_tone).toBe("over");
});

const INBOX_NOW = new Date("2026-06-01T12:00:00.000Z");
const OWNER = { userId: "pat-id", role: "owner" as const };
const MEMBER = { userId: "sam-id", role: "member" as const };
// The member the weigh-in notice names (see producerNotices).
const ALEX = { userId: "u1", role: "member" as const };

test("an inbox notice offers no dismiss form; a data-quality mark keeps its own", async () => {
    const notices = await producerNotices();
    let inbox = 0;
    let marks = 0;
    for (const notice of notices) {
        const w = noticeToWire(notice);
        if (kindForNoticeCode(notice.code) !== null) {
            inbox += 1;
            // Dismissed by notification_id from list_notices, never by code.
            expect(w.dismiss, notice.code).toBeNull();
            expect(w.can_dismiss, notice.code).toBe(false);
        } else if (w.can_dismiss) {
            marks += 1;
            expect(w.dismiss, notice.code).not.toBeNull();
            expect(w.dismiss!.code).toBe(notice.code);
        }
    }
    expect(inbox).toBeGreaterThan(0);
    expect(marks).toBeGreaterThan(0);
});

test("every condition the inbox stores reads as its notice does and parses as a notification", async () => {
    const notices = await producerNotices();
    const plan = syncConditions({
        householdId: HH,
        notices,
        rows: [],
        members: [OWNER, MEMBER, ALEX],
        now: INBOX_NOW,
    });
    expect(plan.insert.length).toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const row of plan.insert) {
        kinds.add(row.kind);
        const w = notificationToWire(row, new Map(), true);
        expect(() => NOTIFICATION_SCHEMA.parse(w), row.kind).not.toThrow();
        expect(w.message.length).toBeGreaterThan(0);
        expect(w.open.startsWith("/"), w.open).toBe(true);
        expect(w.read).toBe(false);
        // The sentence is the notice's own, from the stored parameters.
        const payload = row.payload as { code: Notice["code"] };
        const source = notices.find(
            (n) =>
                n.code === payload.code &&
                n.subject.id === row.subjectId &&
                JSON.stringify(n.params) ===
                    JSON.stringify((row.payload as { params: unknown }).params),
        );
        expect(source, `${payload.code} ${row.subjectId}`).toBeTruthy();
        // The sentence is the notice's own, except that an Allergens row,
        // which is read apart from its item, leads with the item's name.
        const own = noticeSentence(source!);
        const name = (source!.params as { name?: unknown }).name;
        expect(w.message).toBe(
            row.kind === "allergens" && typeof name === "string"
                ? `${name} contains ${own.replace(/^Contains /, "")}`
                : own,
        );
        // For everyone is a household row's, and never Allergens'; the guard's
        // verdict on the agent (here: allowed) decides the rest.
        expect(w.can_dismiss_for_everyone).toBe(
            row.bucket === "household" &&
                NOTIFICATION_KINDS[row.kind].canDisable,
        );
        // Where the guard would refuse the agent, none says it can.
        expect(
            notificationToWire(row, new Map(), false).can_dismiss_for_everyone,
        ).toBe(false);
        // A snooze still running is on the wire; one that has run out is not.
        const later = new Date(INBOX_NOW.getTime() + 3_600_000).toISOString();
        const earlier = new Date(INBOX_NOW.getTime() - 3_600_000).toISOString();
        expect(
            notificationToWire(
                { ...row, snoozedUntil: later },
                new Map(),
                true,
                INBOX_NOW,
            ).snoozed_until,
        ).toBe(later);
        expect(
            notificationToWire(
                { ...row, snoozedUntil: earlier },
                new Map(),
                true,
                INBOX_NOW,
            ).snoozed_until,
        ).toBeNull();
    }
    for (const kind of [
        "allergens",
        "food_expiring",
        "running_low",
        "weigh_in_due",
    ]) {
        expect(kinds.has(kind), kind).toBe(true);
    }
});

test("every event kind fans out to a wire notification that names who did it", () => {
    const events = [
        {
            kind: "recipe_changes" as const,
            subjectKind: "recipe",
            subjectId: "rec-1",
            payload: { recipeName: "Beef chili" },
        },
        {
            kind: "week_plan_changes" as const,
            subjectKind: "recipe",
            subjectId: "rec-2",
            payload: {
                recipeName: "Lasagna",
                date: "2026-12-01",
                slot: "dinner",
                change: "planned",
            },
        },
        {
            kind: "new_usuals" as const,
            subjectKind: "food",
            subjectId: "f-1",
            payload: { foodName: "Eggs", productName: null },
        },
    ];
    for (const event of events) {
        const [row] = fanOutEvent({
            householdId: HH,
            event,
            actorUserId: MEMBER.userId,
            members: [OWNER, MEMBER],
            prefs: [
                {
                    householdId: HH,
                    userId: OWNER.userId,
                    kind: event.kind,
                    enabled: true,
                    updatedAt: INBOX_NOW.toISOString(),
                },
            ],
            now: INBOX_NOW,
        });
        // The actor gets none; the owner, who turned it on, gets one.
        expect(row!.recipientUserId).toBe(OWNER.userId);
        const w = notificationToWire(
            row!,
            new Map([[MEMBER.userId, "Sam"]]),
            true,
        );
        expect(() => NOTIFICATION_SCHEMA.parse(w), event.kind).not.toThrow();
        expect(w.message).toBe(eventSentence(row!, "Sam"));
        expect(w.message.startsWith("Sam ")).toBe(true);
        expect(w.subject).toEqual({
            kind: event.subjectKind,
            id: event.subjectId,
        });
        expect(w.bucket).toBe("household");
        expect(w.can_dismiss_for_everyone).toBe(true);
        // A person who left the household reads as Someone.
        expect(notificationToWire(row!, new Map(), true).message).toStartWith(
            "Someone ",
        );
    }
    expect(NOTIFICATION_KIND_IDS.length).toBe(7);
});

test("an Allergens row names its item and opens that item's page, whichever kind of item it is", () => {
    const peanutButter: Food = {
        ...newFood({ householdId: HH, kind: "food", name: "Peanut butter" }),
        id: "pb",
        allergens: ["peanut"],
    };
    const notices = allergenConditionNotices({
        today: TODAY,
        members: [
            {
                userId: "pat-id",
                displayName: "Pat",
                allergens: [
                    {
                        id: "a1",
                        householdId: HH,
                        userId: "pat-id",
                        allergen: "peanut",
                        otherLabel: null,
                    },
                ],
            },
        ],
        lines: [
            {
                id: "gl-1",
                displayName: "Crunchy peanut butter",
                foodId: "pb",
                checked: false,
            },
        ],
        plans: [{ recipeId: "rec-1", date: TODAY }],
        recipes: [{ id: "rec-1", name: "Pad thai" }],
        ingredients: [
            { recipeId: "rec-1", displayName: "Peanut butter", foodId: "pb" },
        ],
        fridgeItems: [{ id: "fi-1", displayName: "Jif jar", foodId: "pb" }],
        foodsById: effectiveFoodsFromListed([peanutButter]),
    });
    const plan = syncConditions({
        householdId: HH,
        notices,
        rows: [],
        members: [OWNER],
        now: INBOX_NOW,
    });
    const bySubject = new Map(
        plan.insert.map((row) => [
            row.subjectKind,
            notificationToWire(row, new Map(), true),
        ]),
    );
    expect([...bySubject.keys()].sort()).toEqual([
        "fridge_item",
        "grocery_line",
        "recipe",
    ]);
    const line = bySubject.get("grocery_line")!;
    expect(line.message).toBe("Crunchy peanut butter contains peanut — Pat.");
    expect(line.open).toBe("/kitchen/groceries");
    const recipe = bySubject.get("recipe")!;
    expect(recipe.message).toBe("Pad thai contains peanut — Pat.");
    expect(recipe.open).toBe("/recipes/rec-1");
    const item = bySubject.get("fridge_item")!;
    expect(item.message).toBe("Jif jar contains peanut — Pat.");
    expect(item.subject).toEqual({ kind: "fridge_item", id: "fi-1" });
    expect(item.open).toBe("/kitchen/fridge");
    // A food subject (no producer gives one today) opens the food's page.
    const food = notificationToWire(
        { ...plan.insert[0]!, subjectKind: "food", subjectId: "f-9" },
        new Map(),
        true,
    );
    expect(food.open).toBe("/foods/f-9");
});

test("a Running low row opens the same page from the MCP as from the inbox", () => {
    const notice: Notice = {
        code: "grocery.running_low",
        severity: "warn",
        subject: { kind: "food", id: "f-milk" },
        related: [],
        params: {
            name: "Milk",
            foodId: "f-milk",
            reason: "below 1 l",
            dismissScope: "",
        },
    };
    const [row] = syncConditions({
        householdId: HH,
        notices: [notice],
        rows: [],
        members: [OWNER],
        now: INBOX_NOW,
    }).insert;
    expect(notificationToWire(row!, new Map(), true).open).toBe(
        notificationOpenHref(row!),
    );
    expect(notificationOpenHref(row!)).toBe(APP_PATHS.kitchenGroceries);
});

test("every notification kind opens the page that shows it", () => {
    const [anyRow] = syncConditions({
        householdId: HH,
        notices: [
            {
                code: "fridge.expiring",
                severity: "warn",
                subject: { kind: "fridge_item", id: "fi-9" },
                related: [],
                params: { name: "Milk", daysLeft: 1, expiresOn: TODAY },
            },
        ],
        rows: [],
        members: [OWNER],
        now: INBOX_NOW,
    }).insert;
    const opens = (
        kind: NotificationKind,
        subjectKind: string | null,
        subjectId: string | null,
    ) =>
        notificationToWire(
            { ...anyRow!, kind, subjectKind, subjectId },
            new Map(),
            true,
        ).open;
    expect(opens("food_expiring", "fridge_item", "fi-9")).toBe(
        "/kitchen/fridge",
    );
    // Where the inbox's own row opens.
    expect(opens("running_low", "food", "f-9")).toBe("/kitchen/groceries");
    expect(opens("weigh_in_due", "member", "u-9")).toBe("/");
    expect(opens("recipe_changes", "recipe", "rec-9")).toBe("/recipes");
    // The week strip is on the Recipes page; a recipe's own page does not say
    // where it is planned.
    expect(opens("week_plan_changes", "recipe", "rec-9")).toBe("/recipes");
    expect(opens("week_plan_changes", null, null)).toBe("/recipes");
    expect(opens("new_usuals", "food", "f-9")).toBe("/kitchen/usuals");
    expect(opens("allergens", "grocery_line", "gl-9")).toBe(
        "/kitchen/groceries",
    );
    expect(opens("allergens", "recipe", "rec-9")).toBe("/recipes/rec-9");
    expect(opens("allergens", "fridge_item", "fi-9")).toBe("/kitchen/fridge");
    expect(opens("allergens", "food", "f-9")).toBe("/foods/f-9");
});
