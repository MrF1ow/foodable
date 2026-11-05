import { expect, test } from "bun:test";
import { newFood } from "../../domain/foods.js";
import { renderFoodsSettingsPage } from "./foods.js";

const HH = "hh-items";

function food(
    id: string,
    name: string,
    over: Partial<ReturnType<typeof newFood>> = {},
) {
    return {
        ...newFood({
            householdId: HH,
            kind: "food",
            name,
            ...over,
        }),
        id,
        aliases: [] as string[],
    };
}

test("items nests products with Usual pill", () => {
    const plain = food("p1", "Eggs");
    const kirkland = food("k1", "Kirkland Large Eggs", {
        genericFoodId: "p1",
        brand: "Kirkland",
    });
    const html = renderFoodsSettingsPage({
        chrome: { theme: "light" },
        foods: [{ ...plain, usualProductId: "k1" }, kirkland],
    });
    expect(html).toContain('class="food-products list"');
    expect(html).toContain('class="pill pill-dim">Usual</span>');
    expect(html).toContain("Kirkland Large Eggs");
});

test("standalone row shows Belongs to action", () => {
    const solo = food("s1", "Kirkland Large Eggs", { brand: "Kirkland" });
    const plain = food("p1", "Eggs");
    const html = renderFoodsSettingsPage({
        chrome: { theme: "light" },
        foods: [plain, solo],
    });
    expect(html).toContain("Belongs to…");
});
