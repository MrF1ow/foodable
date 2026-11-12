import { describe, expect, test } from "bun:test";
import {
    NOTICE_COPY,
    noticeActionFor,
    noticeCodeDismissible,
    noticeSentence,
} from "../copy/notices.js";
import { createMemoryFoodsStore, newFood, type Food } from "./foods.js";
import { effectiveFoodsFromListed } from "./foods.js";
import type { FridgeItem } from "./fridge.js";
import { createMemoryFridgeStore } from "./fridge.js";
import { createMemoryGroceryStore, type GroceryLine } from "./grocery.js";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKey,
} from "./notice-dismissals.js";
import {
    createMemoryWeighInStore,
    PLAN_NOTICE_DAYS,
    planMissingNotices,
    runningLowNotices,
    WEIGH_IN_DUE_AFTER_DAYS,
    weighInDueNotices,
    type LatestWeighIn,
} from "./notices-actionable.js";
import { dismissNotice, noticesFor } from "./notices-for.js";
import { NOTICE_CODES, NOTICE_SEVERITY } from "./notices.js";
import {
    createMemoryPlansStore,
    type PlanSlot,
    type RecipePlan,
} from "./plan.js";
import type { PlanRecipe } from "./plan-week.js";
import { createMemoryRecipesStore } from "./recipes.js";

const HH = "hh-actionable";
const TODAY = "2026-11-12";

function food(over: Partial<Food> = {}): Food {
    return {
        ...newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        id: "eggs",
        ...over,
    };
}

function stockItem(over: Partial<FridgeItem> = {}): FridgeItem {
    return {
        id: "i1",
        householdId: HH,
        kind: "food",
        displayName: "Eggs",
        foodId: "eggs",
        quantity: { amount: 1, unit: "each" },
        locationId: "loc",
        expiresOn: null,
        openedOn: null,
        purchasedOn: null,
        ...over,
    };
}

function listLine(over: Partial<GroceryLine> = {}): GroceryLine {
    return {
        id: "l1",
        householdId: HH,
        storeId: "s",
        sectionId: "sec",
        kind: "food",
        displayName: "Eggs",
        quantity: { amount: 12, unit: "each" },
        foodId: "eggs",
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
        ...over,
    };
}

function effective(...foods: Food[]) {
    return effectiveFoodsFromListed(foods);
}

describe("registry", () => {
    test("three codes, each with badge, sentence, action label and a dismissal", () => {
        for (const code of [
            "grocery.running_low",
            "plan.missing_ingredient",
            "nutrition.weigh_in_due",
        ] as const) {
            expect(NOTICE_CODES).toContain(code);
            expect(NOTICE_COPY[code].badge.length).toBeGreaterThan(0);
            expect(noticeCodeDismissible(code)).toBe(true);
        }
        expect(NOTICE_SEVERITY["grocery.running_low"]).toBe("warn");
        expect(NOTICE_SEVERITY["plan.missing_ingredient"]).toBe("warn");
        expect(NOTICE_SEVERITY["nutrition.weigh_in_due"]).toBe("info");
    });
});

describe("runningLowNotices", () => {
    const usual = food({
        restockWhenLow: true,
        usualAmount: { amount: 12, unit: "each" },
        restockLowLevel: 4,
        defaultUnit: "each",
    });

    function low(
        over: {
            foods?: Food[];
            stock?: FridgeItem[];
            lines?: GroceryLine[];
        } = {},
    ) {
        return runningLowNotices({
            foodsById: effective(...(over.foods ?? [usual])),
            stock: over.stock ?? [],
            lines: over.lines ?? [],
            today: TODAY,
        });
    }

    test("a usual below its level that is not on the list", () => {
        const [notice, ...rest] = low({
            stock: [stockItem({ quantity: { amount: 3, unit: "each" } })],
        });
        expect(rest).toEqual([]);
        expect(notice).toMatchObject({
            code: "grocery.running_low",
            severity: "warn",
            subject: { kind: "food", id: "eggs" },
        });
        expect(noticeSentence(notice!)).toBe(
            "Running low: Eggs (3 left, below 4)",
        );
        expect(noticeActionFor(notice!)?.label).toBe("Add to list");
    });

    test("no stock at all counts as low", () => {
        const [notice] = low();
        expect(noticeSentence(notice!)).toBe(
            "Running low: Eggs (0 left, below 4)",
        );
    });

    test("stock at the level is not low", () => {
        expect(
            low({
                stock: [stockItem({ quantity: { amount: 4, unit: "each" } })],
            }),
        ).toEqual([]);
    });

    test("not produced when the usual is already on the list", () => {
        expect(low({ lines: [listLine()] })).toEqual([]);
    });

    test("a checked-off line does not count as on the list", () => {
        expect(low({ lines: [listLine({ checked: true })] })).toHaveLength(1);
    });

    test("a product of the usual on the list counts as the usual being on it", () => {
        const product = food({
            id: "kirkland",
            name: "Kirkland eggs",
            genericFoodId: "eggs",
        });
        expect(
            low({
                foods: [usual, product],
                lines: [listLine({ foodId: "kirkland" })],
            }),
        ).toEqual([]);
    });

    test("an unknown unit factor is not low", () => {
        // 2 cartons cannot be turned into "each" without a weight per carton.
        expect(
            low({
                stock: [stockItem({ quantity: { amount: 1, unit: "g" } })],
            }),
        ).toEqual([]);
    });

    test("a usual that did not opt into add-when-low is skipped", () => {
        expect(low({ foods: [{ ...usual, restockWhenLow: false }] })).toEqual(
            [],
        );
    });

    test("a paused usual is skipped", () => {
        expect(low({ foods: [{ ...usual, restockPaused: true }] })).toEqual([]);
    });

    test("a schedule that is due does not hide a low usual", () => {
        // usualsDue lets the schedule win; the notice is about the stock.
        const [notice] = low({
            foods: [
                {
                    ...usual,
                    restockSchedule: "weekly",
                    lastRestockedOn: "2026-01-01",
                },
            ],
        });
        expect(notice?.code).toBe("grocery.running_low");
    });

    test("dismissal is scoped to the last restock", () => {
        const [first] = low({
            foods: [{ ...usual, lastRestockedOn: "2026-11-01" }],
        });
        const [later] = low({
            foods: [{ ...usual, lastRestockedOn: "2026-11-10" }],
        });
        expect(dismissalKey(first!).relatedKey).toBe("2026-11-01");
        expect(dismissalKey(later!).relatedKey).toBe("2026-11-10");
    });
});

describe("planMissingNotices", () => {
    let n = 0;
    function planned(
        recipeId: string,
        date: string,
        slot: PlanSlot = "dinner",
        servings = 2,
    ): RecipePlan {
        n += 1;
        return {
            id: `plan-${n}`,
            householdId: HH,
            recipeId,
            date,
            slot,
            servings,
            createdBy: null,
            createdAt: `2026-11-01T00:00:${String(n).padStart(2, "0")}+00:00`,
        };
    }
    const omelette: PlanRecipe = {
        id: "r-omelette",
        name: "Omelette",
        yieldPortions: 2,
        ingredients: [
            {
                displayName: "Eggs",
                foodId: "eggs",
                quantity: { amount: 4, unit: "each" },
            },
        ],
    };
    const eggs = food({ gramsPerEach: 50 });

    function missing(
        over: {
            plans?: RecipePlan[];
            recipes?: PlanRecipe[];
            stock?: FridgeItem[];
            lines?: GroceryLine[];
            foods?: Food[];
        } = {},
    ) {
        return planMissingNotices({
            plans: over.plans ?? [planned("r-omelette", "2026-11-13")],
            recipes: over.recipes ?? [omelette],
            stock: over.stock ?? [],
            lines: over.lines ?? [],
            foodsById: effective(...(over.foods ?? [eggs])),
            today: TODAY,
        });
    }

    test("a planned recipe needing something not in stock and not on the list", () => {
        const [notice, ...rest] = missing();
        expect(rest).toEqual([]);
        expect(notice).toMatchObject({
            code: "plan.missing_ingredient",
            severity: "warn",
            subject: { kind: "food", id: "eggs" },
            related: [{ kind: "recipe", id: "r-omelette", name: "Omelette" }],
        });
        expect(noticeSentence(notice!)).toBe(
            "Eggs, 4 each, missing for Omelette, tomorrow",
        );
        expect(noticeActionFor(notice!)?.label).toBe("Add");
    });

    test("only what is short is named", () => {
        const [notice] = missing({
            stock: [stockItem({ quantity: { amount: 1, unit: "each" } })],
        });
        expect(noticeSentence(notice!)).toBe(
            "Eggs, 3 each, missing for Omelette, tomorrow",
        );
    });

    test("not produced when stock covers it", () => {
        expect(
            missing({
                stock: [stockItem({ quantity: { amount: 4, unit: "each" } })],
            }),
        ).toEqual([]);
    });

    test("not produced when the list already has it", () => {
        expect(missing({ lines: [listLine()] })).toEqual([]);
    });

    test("a list line that covers only part leaves the rest", () => {
        const [notice] = missing({
            lines: [listLine({ quantity: { amount: 1, unit: "each" } })],
        });
        expect(noticeSentence(notice!)).toBe(
            "Eggs, 3 each, missing for Omelette, tomorrow",
        );
    });

    test("a checked-off list line does not cover it", () => {
        expect(missing({ lines: [listLine({ checked: true })] })).toHaveLength(
            1,
        );
    });

    test("not produced for a plan beyond the next 3 days", () => {
        expect(PLAN_NOTICE_DAYS).toBe(3);
        // today + 3 is the fourth day: out.
        expect(
            missing({ plans: [planned("r-omelette", "2026-11-15")] }),
        ).toEqual([]);
        // today + 2 is the third day: in.
        expect(
            missing({ plans: [planned("r-omelette", "2026-11-14")] }),
        ).toHaveLength(1);
        // today itself is in; yesterday is not.
        expect(missing({ plans: [planned("r-omelette", TODAY)] })).toHaveLength(
            1,
        );
        expect(
            missing({ plans: [planned("r-omelette", "2026-11-11")] }),
        ).toEqual([]);
    });

    test("one notice per food across plans, naming every recipe", () => {
        const frittata: PlanRecipe = {
            id: "r-frittata",
            name: "Frittata",
            yieldPortions: 2,
            ingredients: [
                {
                    displayName: "Eggs",
                    foodId: "eggs",
                    quantity: { amount: 6, unit: "each" },
                },
            ],
        };
        const notices = missing({
            recipes: [omelette, frittata],
            plans: [
                planned("r-frittata", "2026-11-14"),
                planned("r-omelette", "2026-11-13"),
            ],
        });
        expect(notices).toHaveLength(1);
        expect(notices[0]!.related.map((r) => r.id)).toEqual([
            "r-omelette",
            "r-frittata",
        ]);
        expect(noticeSentence(notices[0]!)).toBe(
            "Eggs, 10 each, missing for Omelette and 1 more, tomorrow",
        );
    });

    test("one food short in two kinds of unit is one notice listing both amounts", () => {
        // No grams-per-ml, so 200 g and 250 ml cannot be added together.
        const flour = food({
            id: "flour",
            name: "Flour",
            gramsPerEach: null,
            gramsPerMl: null,
        });
        const bread: PlanRecipe = {
            id: "r-bread",
            name: "Bread",
            yieldPortions: 2,
            ingredients: [
                {
                    displayName: "Flour",
                    foodId: "flour",
                    quantity: { amount: 200, unit: "g" },
                },
                {
                    displayName: "Flour",
                    foodId: "flour",
                    quantity: { amount: 250, unit: "ml" },
                },
            ],
        };
        const notices = missing({
            recipes: [bread],
            plans: [planned("r-bread", "2026-11-13")],
            foods: [flour],
        });
        expect(notices).toHaveLength(1);
        expect(noticeSentence(notices[0]!)).toBe(
            "Flour, 200 g + 250 ml, missing for Bread, tomorrow",
        );
        // One identity, so one dismissal and one Add per food.
        expect(
            new Set(notices.map((n) => dismissalKey(n).subjectId)).size,
        ).toBe(1);
    });

    test("an unknown unit factor is flagged with the full amount, not guessed", () => {
        // 200 g of stock cannot be counted against "each" without grams per each.
        const noFactor = food({ gramsPerEach: null });
        const [notice] = missing({
            foods: [noFactor],
            stock: [stockItem({ quantity: { amount: 200, unit: "g" } })],
        });
        expect(notice?.params.unknown).toBe("yes");
        expect(noticeSentence(notice!)).toBe(
            "Eggs: can't tell how much you have, 4 each needed for Omelette, tomorrow",
        );
    });

    test("an unmeasured ingredient with no stock is named without an amount", () => {
        const salty: PlanRecipe = {
            id: "r-salty",
            name: "Salty",
            yieldPortions: 1,
            ingredients: [
                { displayName: "Salt", foodId: "salt", quantity: null },
            ],
        };
        const [notice] = missing({
            recipes: [salty],
            plans: [planned("r-salty", TODAY)],
            foods: [food({ id: "salt", name: "Salt" })],
        });
        expect(noticeSentence(notice!)).toBe("Salt missing for Salty, today");
    });

    test("an ingredient that names no food cannot be added, so has no notice", () => {
        const loose: PlanRecipe = {
            id: "r-loose",
            name: "Loose",
            yieldPortions: 1,
            ingredients: [
                {
                    displayName: "Thing",
                    foodId: null,
                    quantity: { amount: 1, unit: "each" },
                },
            ],
        };
        expect(
            missing({
                recipes: [loose],
                plans: [planned("r-loose", TODAY)],
            }),
        ).toEqual([]);
    });

    test("dismissal is scoped to the first plan that needs it", () => {
        const first = planned("r-omelette", "2026-11-13");
        const [notice] = missing({ plans: [first] });
        expect(dismissalKey(notice!).relatedKey).toBe(first.id);
    });
});

describe("weighInDueNotices", () => {
    const sam: LatestWeighIn = {
        userId: "u-sam",
        displayName: "Sam",
        lastLoggedAt: "2026-11-05T12:00:00Z",
    };

    test("due when the latest weigh-in is 7 days old", () => {
        expect(WEIGH_IN_DUE_AFTER_DAYS).toBe(7);
        const [notice, ...rest] = weighInDueNotices({
            members: [sam],
            today: "2026-11-12",
            timezone: "UTC",
        });
        expect(rest).toEqual([]);
        expect(notice).toMatchObject({
            code: "nutrition.weigh_in_due",
            severity: "info",
            subject: { kind: "member", id: "u-sam" },
            related: [{ kind: "member", id: "u-sam", name: "Sam" }],
        });
        expect(noticeSentence(notice!)).toBe(
            "Sam hasn't weighed in for 7 days",
        );
        expect(noticeActionFor(notice!)?.label).toBe("Weigh in");
    });

    test("not due when the latest was 6 days ago", () => {
        expect(
            weighInDueNotices({
                members: [sam],
                today: "2026-11-11",
                timezone: "UTC",
            }),
        ).toEqual([]);
    });

    test("days are household-timezone days, not UTC", () => {
        // 23:30 on Nov 5 in New York is already Nov 6 in UTC.
        const late: LatestWeighIn = {
            ...sam,
            lastLoggedAt: "2026-11-06T04:30:00Z",
        };
        const today = "2026-11-12";
        expect(
            weighInDueNotices({
                members: [late],
                today,
                timezone: "UTC",
            }),
        ).toEqual([]);
        expect(
            weighInDueNotices({
                members: [late],
                today,
                timezone: "America/New_York",
            }),
        ).toHaveLength(1);
    });

    test("per member: only the overdue ones", () => {
        const kim: LatestWeighIn = {
            userId: "u-kim",
            displayName: "Kim",
            lastLoggedAt: "2026-11-11T08:00:00Z",
        };
        const notices = weighInDueNotices({
            members: [sam, kim],
            today: "2026-11-12",
            timezone: "UTC",
        });
        expect(notices.map((x) => x.subject.id)).toEqual(["u-sam"]);
    });

    test("a member who never weighed in has no row to read, so no notice", () => {
        expect(
            weighInDueNotices({ members: [], today: TODAY, timezone: "UTC" }),
        ).toEqual([]);
    });

    test("dismissal lapses once there is a newer weigh-in", () => {
        const [notice] = weighInDueNotices({
            members: [sam],
            today: "2026-11-12",
            timezone: "UTC",
        });
        expect(dismissalKey(notice!).relatedKey).toBe("2026-11-05");
    });
});

describe("noticesFor", () => {
    async function setup() {
        const foods = createMemoryFoodsStore();
        const fridge = createMemoryFridgeStore();
        const recipes = createMemoryRecipesStore();
        const dismissals = createMemoryNoticeDismissalsStore();
        const grocery = createMemoryGroceryStore();
        const plans = createMemoryPlansStore();
        const weighIns = createMemoryWeighInStore([
            {
                userId: crypto.randomUUID(),
                displayName: "Sam",
                lastLoggedAt: "2026-11-01T12:00:00Z",
            },
        ]);
        const eggs = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
                restockWhenLow: true,
                usualAmount: { amount: 12, unit: "each" },
            }),
        );
        return {
            deps: {
                foods,
                fridge,
                recipes,
                dismissals,
                grocery,
                plans,
                weighIns,
            },
            eggs,
        };
    }

    test("the three notices come only when the caller opts in", async () => {
        const { deps } = await setup();
        const off = await noticesFor(deps, HH, { today: TODAY });
        expect(off.notices.map((x) => x.code)).toEqual([]);
        const on = await noticesFor(deps, HH, {
            today: TODAY,
            actionable: true,
            timezone: "UTC",
        });
        expect(on.notices.map((x) => x.code).sort()).toEqual([
            "grocery.running_low",
            "nutrition.weigh_in_due",
        ]);
    });

    test("without the stores nothing is produced and nothing breaks", async () => {
        const { deps } = await setup();
        const { plans: _p, weighIns: _w, grocery: _g, ...bare } = deps;
        const result = await noticesFor(bare, HH, {
            today: TODAY,
            actionable: true,
            timezone: "UTC",
        });
        expect(result.notices).toEqual([]);
    });

    test("each is dismissable, and a dismissed one stays out", async () => {
        const { deps, eggs } = await setup();
        const opts = { today: TODAY, actionable: true, timezone: "UTC" };
        await dismissNotice(
            deps,
            HH,
            "user-1",
            {
                code: "grocery.running_low",
                subjectKind: "food",
                subjectId: eggs.id,
                relatedId: "",
            },
            opts,
        );
        const after = await noticesFor(deps, HH, opts);
        expect(after.notices.map((x) => x.code)).toEqual([
            "nutrition.weigh_in_due",
        ]);
        const weigh = after.notices[0]!;
        await dismissNotice(
            deps,
            HH,
            "user-1",
            {
                code: "nutrition.weigh_in_due",
                subjectKind: "member",
                subjectId: weigh.subject.id,
                relatedId: String(weigh.params.lastWeighedOn),
            },
            opts,
        );
        const none = await noticesFor(deps, HH, opts);
        expect(none.notices).toEqual([]);
        const withDismissed = await noticesFor(deps, HH, {
            ...opts,
            includeDismissed: true,
        });
        expect(withDismissed.notices).toHaveLength(2);
    });

    test("a planned recipe missing food shows up and is deduped against the list", async () => {
        const { deps, eggs } = await setup();
        const recipe = await deps.recipes.insertRecipe({
            id: crypto.randomUUID(),
            householdId: HH,
            creatorId: "u",
            name: "Omelette",
            yieldPortions: 2,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "unverified",
            updatedAt: "2026-11-01T00:00:00Z",
        } as never);
        await deps.recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: "Eggs",
            quantity: { amount: 4, unit: "each" },
            foodId: eggs.id,
            sortOrder: 0,
            note: null,
        });
        await deps.plans.addPlan({
            householdId: HH,
            recipeId: recipe.id,
            date: "2026-11-13",
            slot: "dinner",
            servings: 2,
        });
        const opts = { today: TODAY, actionable: true, timezone: "UTC" };
        const codes = (await noticesFor(deps, HH, opts)).notices.map(
            (x) => x.code,
        );
        expect(codes).toContain("plan.missing_ingredient");
        await deps.grocery.insertLine(
            listLine({ foodId: eggs.id, id: crypto.randomUUID() }),
        );
        const after = (await noticesFor(deps, HH, opts)).notices.map(
            (x) => x.code,
        );
        expect(after).not.toContain("plan.missing_ingredient");
        expect(after).not.toContain("grocery.running_low");
    });
});
