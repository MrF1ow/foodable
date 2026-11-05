import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { legacyHouseholdPath, householdRoutes } from "./household.js";

describe("legacyHouseholdPath", () => {
    test("household prefix", () => {
        expect(legacyHouseholdPath("/settings/household")).toBe("/household");
        expect(legacyHouseholdPath("/settings/household/name")).toBe(
            "/household/name",
        );
        expect(legacyHouseholdPath("/settings/household?x=1")).toBe(
            "/household?x=1",
        );
        expect(legacyHouseholdPath("/settings/household/stores?id=1")).toBe(
            "/household/stores?id=1",
        );
    });

    test("foods prefix", () => {
        expect(legacyHouseholdPath("/settings/foods")).toBe("/household/items");
        expect(legacyHouseholdPath("/settings/foods/merge")).toBe(
            "/household/items/merge",
        );
        expect(legacyHouseholdPath("/settings/foods?x=1")).toBe(
            "/household/items?x=1",
        );
    });

    test("non-matches", () => {
        expect(legacyHouseholdPath("/settings")).toBeNull();
        expect(legacyHouseholdPath("/settings/help")).toBeNull();
        expect(legacyHouseholdPath("/settings/householdx")).toBeNull();
        expect(legacyHouseholdPath("/settings/foodsy")).toBeNull();
    });
});

describe("legacy redirect middleware", () => {
    const app = new Hono();
    app.route("/", householdRoutes);

    test("GET /settings/foods?x=1 → 301 /household/items?x=1", async () => {
        const r = await app.request("http://x/settings/foods?x=1");
        expect(r.status).toBe(301);
        expect(r.headers.get("location")).toBe("/household/items?x=1");
    });

    test("POST /settings/household/name → 308 /household/name", async () => {
        const r = await app.request("http://x/settings/household/name", {
            method: "POST",
        });
        expect(r.status).toBe(308);
        expect(r.headers.get("location")).toBe("/household/name");
    });

    test("HEAD → 301", async () => {
        const r = await app.request("http://x/settings/household", {
            method: "HEAD",
        });
        expect(r.status).toBe(301);
        expect(r.headers.get("location")).toBe("/household");
    });
});
