import { expect, test } from "bun:test";
import {
    FOOD_EDIT_MODAL_ID,
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
    expect(html).toContain(`commandfor="${FOOD_EDIT_MODAL_ID}"`);
    expect(html).not.toContain('commandfor="food-edit-f1"');
    expect(html).toContain('data-fill-action="/settings/foods/f1"');
    expect(html).toContain('data-fill-title="Edit Eggs"');
    expect(html).toContain('data-fill-field-name="Eggs"');
    expect(html).toContain(`commandfor="${FOODS_MERGE_MODAL_ID}"`);
    expect(html).toContain('class="food-edit"');
    expect(html).toContain('action="/settings/foods/merge"');
    expect(html).toContain(
        '<button type="submit" class="btn-primary" disabled>Save food</button>',
    );
    expect((html.match(/<dialog/g) ?? []).length).toBe(2);
});

test("food edit dialog count does not grow with the catalog", () => {
    const few = renderFoodsSettingsPage({
        chrome,
        foods: [food, { ...food, id: "f2", name: "Milk" }],
    });
    const many = renderFoodsSettingsPage({
        chrome,
        foods: Array.from({ length: 40 }, (_, i) => ({
            ...food,
            id: `f${i}`,
            name: `Food ${i}`,
        })),
    });
    const dialogs = (html: string) => (html.match(/<dialog/g) ?? []).length;
    expect(dialogs(few)).toBe(dialogs(many));
    expect(dialogs(many)).toBe(2);
});

function expectErrorOnceInModal(
    html: string,
    modalId: string,
    message: string,
): void {
    expect(html.match(new RegExp(message, "g"))?.length).toBe(1);
    const dialog = html.match(
        new RegExp(`<dialog class="modal" id="${modalId}"[\\s\\S]*?</dialog>`),
    )?.[0];
    expect(dialog).toBeDefined();
    expect(dialog).toContain(message);
    expect(dialog!.match(/error-banner/g)?.length).toBe(1);
}

test("foods server error reopens edit and merge modals", () => {
    const editHtml = renderFoodsSettingsPage({
        chrome,
        foods: [food],
        error: "Enter a name.",
        openModalId: "food-edit-f1",
    });
    expect(editHtml).toMatch(
        new RegExp(
            `<dialog class="modal" id="${FOOD_EDIT_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
    expect(editHtml).toContain('action="/settings/foods/f1"');
    expect(editHtml).toContain(">Edit Eggs</h2>");
    expect(editHtml).not.toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expectErrorOnceInModal(editHtml, FOOD_EDIT_MODAL_ID, "Enter a name.");
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
    expectErrorOnceInModal(
        mergeHtml,
        FOODS_MERGE_MODAL_ID,
        "Pick two different foods.",
    );
});
