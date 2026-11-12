import { describe, expect, test } from "bun:test";
import type { NutritionGoals } from "../../../db/nutrition.js";
import { MAX_CALORIES } from "../../../domain/import.js";
import { MAX_GOAL_G, MAX_GOAL_MG } from "../../../mcp/shared.js";
import {
    goalsDraftFrom,
    parseGoalsForm,
    type GoalsFormDraft,
} from "./settings-goals-form.js";

const stored: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2200,
    daily_protein_g: 140,
    daily_carbs_g: 200,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 50,
    daily_alcohol_g: 14,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: 75000,
    goal_name: "Recomp",
    goal_note: null,
    goals_set_on: "2026-10-02",
    updated_at: "2026-10-02T00:00:00.000Z",
};

function draft(over: Partial<GoalsFormDraft> = {}): GoalsFormDraft {
    return { ...goalsDraftFrom(stored, "us"), ...over };
}

const withAlcohol = { alcohol: "us" as const, stored };

describe("goalsDraftFrom", () => {
    test("shows stored values as plain strings and null as blank", () => {
        const d = goalsDraftFrom({
            ...stored,
            daily_fiber_g: null,
            goal_note: "maintenance minus 5%",
        });
        expect(d.daily_calories).toBe("2200");
        expect(d.daily_fiber_g).toBe("");
        expect(d.goal_name).toBe("Recomp");
        expect(d.goal_note).toBe("maintenance minus 5%");
    });

    test("no stored goals is an all-blank form", () => {
        const d = goalsDraftFrom(null);
        expect(Object.values(d).every((v) => v === "")).toBe(true);
    });
});

describe("parseGoalsForm", () => {
    test("turns every field into the input upsertNutritionGoals takes", () => {
        const res = parseGoalsForm(
            draft({
                goal_name: "  Cut  ",
                goal_note: " slow ",
                daily_calories: "2100",
                daily_protein_g: "150.5",
                daily_carbs_g: "180",
                daily_fat_g: "60",
                daily_water_ml: "3000",
                daily_fiber_g: "35",
                daily_sugar_g: "40",
                daily_alcohol_g: "0.5",
                daily_caffeine_mg: "300",
            }),
            withAlcohol,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.input).toEqual({
            goal_name: "Cut",
            goal_note: "slow",
            daily_calories: 2100,
            daily_protein_g: 150.5,
            daily_carbs_g: 180,
            daily_fat_g: 60,
            daily_water_ml: 3000,
            daily_fiber_g: 35,
            daily_sugar_g: 40,
            daily_alcohol_g: 7,
            daily_caffeine_mg: 300,
        });
        expect(res.changesTargets).toBe(true);
    });

    test("a blank target clears it; a blank name or note clears it", () => {
        const res = parseGoalsForm(
            draft({ daily_fiber_g: "", goal_name: " ", goal_note: "" }),
            withAlcohol,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.input.daily_fiber_g).toBeNull();
        expect(res.input.goal_name).toBeNull();
        expect(res.input.goal_note).toBeNull();
    });

    test("with alcohol tracking off the alcohol limit is left alone", () => {
        const res = parseGoalsForm(draft({ daily_alcohol_g: "" }), {
            alcohol: null,
            stored,
        });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect("daily_alcohol_g" in res.input).toBe(false);
    });

    test("changesTargets is false when only the name or note changed", () => {
        const res = parseGoalsForm(
            draft({ goal_name: "Maintain", goal_note: "new note" }),
            withAlcohol,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.changesTargets).toBe(false);
    });

    test("changesTargets is true for any one target and for a first save", () => {
        const one = parseGoalsForm(
            draft({ daily_water_ml: "2600" }),
            withAlcohol,
        );
        expect(one.ok && one.changesTargets).toBe(true);
        const first = parseGoalsForm(
            { ...goalsDraftFrom(null), daily_calories: "2000" },
            { alcohol: "us" as const, stored: null },
        );
        expect(first.ok && first.changesTargets).toBe(true);
    });

    test("rejects out-of-bounds values with the bounds set_nutrition_goals uses", () => {
        const cases: [Partial<GoalsFormDraft>, string][] = [
            [
                { daily_calories: String(MAX_CALORIES + 1) },
                `Calories must be at most ${MAX_CALORIES}.`,
            ],
            [
                { daily_protein_g: String(MAX_GOAL_G + 1) },
                `Protein must be at most ${MAX_GOAL_G}.`,
            ],
            [
                { daily_caffeine_mg: String(MAX_GOAL_MG + 1) },
                `Caffeine must be at most ${MAX_GOAL_MG}.`,
            ],
        ];
        for (const [over, message] of cases) {
            const res = parseGoalsForm(draft(over), withAlcohol);
            expect(res.ok).toBe(false);
            if (res.ok) continue;
            expect(res.errors).toContain(message);
        }
    });

    test("rejects negatives and non-numbers, and names the fields", () => {
        const res = parseGoalsForm(
            draft({ daily_carbs_g: "-5", daily_fat_g: "lots" }),
            withAlcohol,
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.errors).toEqual([
            "Carbs must be a number, 0 or more.",
            "Fat must be a number, 0 or more.",
        ]);
        expect(res.invalid).toEqual(["daily_carbs_g", "daily_fat_g"]);
    });

    test("rejects a 41-character name and a note over its limit", () => {
        const res = parseGoalsForm(
            draft({ goal_name: "x".repeat(41), goal_note: "y".repeat(281) }),
            withAlcohol,
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.errors).toEqual([
            "Goal name must be at most 40 characters.",
            "Goal note must be at most 280 characters.",
        ]);
        expect(res.invalid).toEqual(["goal_name", "goal_note"]);
    });

    test("a 40-character name is fine", () => {
        const res = parseGoalsForm(
            draft({ goal_name: "x".repeat(40) }),
            withAlcohol,
        );
        expect(res.ok).toBe(true);
    });

    test("refuses a form with no target at all, so no all-blank goals row", () => {
        const blank: Partial<GoalsFormDraft> = {
            daily_calories: "",
            daily_protein_g: "",
            daily_carbs_g: "",
            daily_fat_g: "",
            daily_water_ml: "",
            daily_fiber_g: "",
            daily_sugar_g: "",
            daily_alcohol_g: "",
            daily_caffeine_mg: "",
        };
        const res = parseGoalsForm(
            draft({ ...blank, goal_name: "Only a name" }),
            {
                alcohol: "us" as const,
                stored: null,
            },
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.errors).toEqual(["Set at least one daily target."]);
    });

    test("a hidden alcohol limit already stored still counts as a target", () => {
        const onlyAlcohol: NutritionGoals = {
            ...stored,
            daily_calories: null,
            daily_protein_g: null,
            daily_carbs_g: null,
            daily_fat_g: null,
            daily_fiber_g: null,
            daily_sugar_g: null,
            daily_caffeine_mg: null,
            daily_water_ml: null,
            daily_alcohol_g: 14,
        };
        const res = parseGoalsForm(goalsDraftFrom(onlyAlcohol), {
            alcohol: null,
            stored: onlyAlcohol,
        });
        expect(res.ok).toBe(true);
    });
});

describe("alcohol in the member's drink unit", () => {
    const only = (over: Partial<GoalsFormDraft>) =>
        ({
            ...goalsDraftFrom(null),
            daily_calories: "2000",
            ...over,
        }) as GoalsFormDraft;

    test("US drinks convert to grams (14 g each)", () => {
        const res = parseGoalsForm(only({ daily_alcohol_g: "2" }), {
            alcohol: "us",
            stored: null,
        });
        expect(res.ok && res.input.daily_alcohol_g).toBe(28);
    });

    test("UK units convert to grams (7.893 g each)", () => {
        const res = parseGoalsForm(only({ daily_alcohol_g: "2" }), {
            alcohol: "uk",
            stored: null,
        });
        expect(res.ok && res.input.daily_alcohol_g).toBe(15.79);
    });

    test("tracking off: the field is not read, whatever was posted", () => {
        const res = parseGoalsForm(only({ daily_alcohol_g: "5" }), {
            alcohol: null,
            stored: null,
        });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect("daily_alcohol_g" in res.input).toBe(false);
    });

    test("the draft opens in drinks, and an untouched value keeps its grams", () => {
        const g = { ...stored, daily_alcohol_g: 10 };
        expect(goalsDraftFrom(g, "uk").daily_alcohol_g).toBe("1.27");
        expect(goalsDraftFrom(g, "us").daily_alcohol_g).toBe("0.71");
        expect(goalsDraftFrom(g, null).daily_alcohol_g).toBe("");
        const res = parseGoalsForm(goalsDraftFrom(g, "uk"), {
            alcohol: "uk",
            stored: g,
        });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.input.daily_alcohol_g).toBe(10);
        expect(res.changesTargets).toBe(false);
    });

    test("the bound is the gram bound, shown in drinks", () => {
        const res = parseGoalsForm(only({ daily_alcohol_g: "1000" }), {
            alcohol: "us",
            stored: null,
        });
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.errors).toEqual(["Alcohol must be at most 714.28."]);
        expect(res.invalid).toEqual(["daily_alcohol_g"]);
    });

    test("the advertised maximum fits the column; one step above is refused", () => {
        // numeric(6,2) holds 9999.99 g; 714.29 US drinks would be 10000.06 g.
        for (const [unit, max, over] of [
            ["us", "714.28", "714.29"],
            ["uk", "1266.94", "1266.95"],
        ] as const) {
            const ok = parseGoalsForm(only({ daily_alcohol_g: max }), {
                alcohol: unit,
                stored: null,
            });
            expect(ok.ok).toBe(true);
            if (!ok.ok) return;
            expect(ok.input.daily_alcohol_g as number).toBeLessThanOrEqual(
                MAX_GOAL_G,
            );
            const bad = parseGoalsForm(only({ daily_alcohol_g: over }), {
                alcohol: unit,
                stored: null,
            });
            expect(bad.ok).toBe(false);
            if (bad.ok) return;
            expect(bad.errors).toEqual([`Alcohol must be at most ${max}.`]);
        }
    });

    test("an alcohol limit of 0 is a real target; a floor of 0 is not", () => {
        const ceiling = parseGoalsForm(
            { ...goalsDraftFrom(null), daily_alcohol_g: "0" },
            { alcohol: "us", stored: null },
        );
        expect(ceiling.ok).toBe(true);
        const floor = parseGoalsForm(
            { ...goalsDraftFrom(null), daily_calories: "0" },
            { alcohol: "us", stored: null },
        );
        expect(floor.ok).toBe(false);
        if (floor.ok) return;
        expect(floor.errors).toEqual(["Set at least one daily target."]);
        const protein = parseGoalsForm(
            {
                ...goalsDraftFrom(null),
                daily_protein_g: "0",
                daily_fiber_g: "0",
            },
            { alcohol: null, stored: null },
        );
        expect(protein.ok).toBe(false);
    });
});

describe("what counts as a change", () => {
    test("a decimal the store rounds is not a change", () => {
        const g = { ...stored, daily_calories: 1801, daily_water_ml: 2500 };
        const res = parseGoalsForm(
            {
                ...goalsDraftFrom(g),
                daily_calories: "1800.5",
                daily_water_ml: "2499.5",
            },
            { alcohol: null, stored: g },
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.changesTargets).toBe(false);
    });

    test("a different whole number is", () => {
        const res = parseGoalsForm(
            { ...goalsDraftFrom(stored), daily_calories: "2201" },
            { alcohol: null, stored },
        );
        expect(res.ok && res.changesTargets).toBe(true);
    });
});

describe("thousands separators", () => {
    const only = (over: Partial<GoalsFormDraft>) =>
        ({ ...goalsDraftFrom(null), ...over }) as GoalsFormDraft;
    const opts = { alcohol: null, stored: null } as const;

    test('"2,000" reads as 2000, "1,234.5" as 1234.5', () => {
        const res = parseGoalsForm(
            only({ daily_calories: "2,000", daily_water_ml: "2,500" }),
            opts,
        );
        expect(res.ok && res.input.daily_calories).toBe(2000);
        expect(res.ok && res.input.daily_water_ml).toBe(2500);
        const dec = parseGoalsForm(only({ daily_calories: "1,234.5" }), opts);
        expect(dec.ok && dec.input.daily_calories).toBe(1234.5);
    });

    test("misplaced commas are still refused", () => {
        for (const bad of ["20,00", "2,00", ",500", "2,", "1,2345", "2,000,"]) {
            const res = parseGoalsForm(only({ daily_calories: bad }), opts);
            expect(res.ok).toBe(false);
        }
    });
});
