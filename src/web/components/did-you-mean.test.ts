import { expect, test } from "bun:test";
import { renderDidYouMeanBlock } from "./did-you-mean.js";
import type { DidYouMeanView } from "../../domain/foods.js";

const view: DidYouMeanView = {
    name: "chicken egg",
    heading: "Did you mean one of these?",
    candidates: [
        { foodId: "f-1", label: "Egg" },
        { foodId: "f-2", label: "Duck egg" },
    ],
    aliasLabel: "Remember chicken egg as another name for the food you pick",
    newFoodLabel: "Add chicken egg as a new food",
    hiddenFields: { store_id: "st-1", return_to: "/kitchen/groceries" },
};

test("the question is the shared buttons, an item row with a toggle, and one form", () => {
    const html = renderDidYouMeanBlock({
        action: "/kitchen/groceries/lines",
        view,
    });
    expect(html).toContain('class="did-you-mean-block"');

    expect(html).not.toContain("btn-sm");
    // Candidates and the new-food button are the design's buttons.
    expect(html.match(/data-fd-btn/g)?.length).toBe(3);
    expect(html).toMatch(/name="food_id" value="f-1"/);
    expect(html).toMatch(/name="food_id" value="f-2"/);
    expect(html).toMatch(/name="new_food" value="1"/);
    // The alias choice is an Item row carrying a Toggle that posts remember_alias.
    expect(html).toContain("fd-item-row");
    expect(html).toContain(
        '<span class="fd-item-row__subtitle">Remember chicken egg as another name for the food you pick</span>',
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('name="remember_alias" value="1"');
    // Its own fields ride along, and there is one form.
    expect(html).toContain('name="return_to" value="/kitchen/groceries"');
    expect(html.match(/<form /g)?.length).toBe(1);
});

test("a single candidate is asked by name", () => {
    const html = renderDidYouMeanBlock({
        action: "/x",
        view: { ...view, candidates: [{ foodId: "f-1", label: "Egg" }] },
    });
    expect(html).toContain("Did you mean <em>Egg</em>?");
});
