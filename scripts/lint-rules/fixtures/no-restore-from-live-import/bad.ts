import { afterAll, mock } from "bun:test";
import * as actualFoods from "../../../../src/foods.js";
import * as actualTz from "../../../../src/domain/tz.js";
import * as actualCsv from "../../../../src/domain/csv.js";

const aliased = actualCsv;

mock.module("../../../../src/foods.js", () => ({
    ...actualFoods,
    lookupBarcode: async () => null,
}));
mock.module("../../../../src/domain/tz.js", () => ({
    ...actualTz,
    todayInTz: () => "2026-11-09",
}));

// Taken after the first mock.module of the module: already holds the mock.
const late = { ...actualTz };

afterAll(() => {
    // Live namespace returned as is.
    mock.module("../../../../src/foods.js", () => actualFoods);
    // Spread of the live namespace is the same thing.
    mock.module("../../../../src/domain/tz.js", () => ({ ...actualTz }));
    // An alias is not a copy.
    mock.module("../../../../src/domain/csv.js", () => aliased);
    // A copy taken after the module was already mocked holds the mock.
    mock.module("../../../../src/domain/tz.js", () => late);
});
