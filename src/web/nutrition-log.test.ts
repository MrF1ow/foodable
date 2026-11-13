import { test, expect } from "bun:test";
import type { WaterInput, WaterInsertResult } from "../db/nutrition.js";
import { logWaterFromForm } from "./form.js";

const USER = "11111111-1111-4111-8111-111111111111";

test("logs water through insertWater", async () => {
    const calls: { userId: string; input: WaterInput }[] = [];
    const result = await logWaterFromForm(
        USER,
        { amount_ml: "250" },
        async (userId, input) => {
            calls.push({ userId, input });
            return {
                entry: { id: "w1", amount_ml: input.amount_ml },
                deduplicated: false,
            } as WaterInsertResult;
        },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ userId: USER, input: { amount_ml: 250 } }]);
});

test("rounds a fractional water amount to whole millilitres", async () => {
    const calls: WaterInput[] = [];
    await logWaterFromForm(
        USER,
        { amount_ml: "249.6" },
        async (_userId, input) => {
            calls.push(input);
            return {
                entry: { id: "w2", amount_ml: input.amount_ml },
                deduplicated: false,
            } as WaterInsertResult;
        },
    );
    expect(calls).toEqual([{ amount_ml: 250 }]);
});

test("refuses a missing, zero or negative water amount without inserting", async () => {
    let inserts = 0;
    const insert = async (): Promise<WaterInsertResult> => {
        inserts += 1;
        throw new Error("must not insert");
    };
    for (const amount_ml of [undefined, "", "0", "-5", "abc"]) {
        const result = await logWaterFromForm(USER, { amount_ml }, insert);
        expect(result).toEqual({
            ok: false,
            error: "Enter a water amount greater than zero.",
        });
    }
    expect(inserts).toBe(0);
});
