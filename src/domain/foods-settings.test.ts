import { expect, test } from "bun:test";
import {
    FOODS_MERGE_MODAL_ID,
    renderFoodsSettingsPage,
} from "../web/pages/foods.js";

const chrome = { theme: "light" as const };

const food = {
    id: "f1",
    householdId: "hh-1",
    kind: "food" as const,
    name: "Eggs",
    normalizedName: "eggs",
    brand: null,
    defaultUnit: "each",
    gramsPerEach: 50,
    gramsPerMl: null,
    calories: 143,
    proteinG: 13,
    carbsG: 1,
    fatG: 10,
    fiberG: null,
    sugarG: null,
    alcoholG: null,
    caffeineMg: null,
    nutritionSource: null,
    allergens: [],
    offSourceId: null,
    createdBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    aliases: [] as string[],
};

test("foods settings use modals for edit and merge", () => {
    const html = renderFoodsSettingsPage({
        chrome,
        foods: [food, { ...food, id: "f2", name: "Milk" }],
    });
    expect(html).not.toContain('<details class="more">');
    expect(html).toContain('commandfor="food-edit-f1"');
    expect(html).toContain(`commandfor="${FOODS_MERGE_MODAL_ID}"`);
    expect(html).toContain('class="food-edit"');
    expect(html).toContain('action="/settings/foods/merge"');
});

test("foods server error reopens edit and merge modals", () => {
    const editHtml = renderFoodsSettingsPage({
        chrome,
        foods: [food],
        error: "Enter a name.",
        openModalId: "food-edit-f1",
    });
    expect(editHtml).toMatch(
        /<dialog class="modal" id="food-edit-f1"[^>]*data-modal-open-on-load/,
    );
    const mergeHtml = renderFoodsSettingsPage({
        chrome,
        foods: [food, { ...food, id: "f2", name: "Milk" }],
        error: "Pick two different foods.",
        openModalId: FOODS_MERGE_MODAL_ID,
    });
    expect(mergeHtml).toMatch(
        new RegExp(
            `<dialog class="modal" id="${FOODS_MERGE_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
});
