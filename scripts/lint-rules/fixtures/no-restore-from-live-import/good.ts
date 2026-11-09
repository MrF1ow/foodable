import { afterAll, mock } from "bun:test";
import * as actualFoods from "../../../../src/foods.js";
import * as actualTz from "../../../../src/domain/tz.js";

// Snapshot BEFORE mock.module runs.
const realFoods = { ...actualFoods };
const realTz = { ...actualTz };

// A stub that spreads the real exports and overrides one is a mock, not a restore.
mock.module("../../../../src/foods.js", () => ({
    ...actualFoods,
    lookupBarcode: async () => null,
}));
mock.module("../../../../src/domain/tz.js", () => ({
    ...actualTz,
    todayInTz: () => "2026-11-09",
}));

afterAll(() => {
    mock.module("../../../../src/foods.js", () => realFoods);
    mock.module("../../../../src/domain/tz.js", () => realTz);
});
