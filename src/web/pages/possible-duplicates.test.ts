import { expect, test } from "bun:test";
import { newFood } from "../../domain/foods.js";
import {
    DUP_MERGE_MODAL_ID,
    renderPossibleDuplicatesPage,
} from "./possible-duplicates.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../test-support/chrome-flags.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

test("open merge modal renders filled form for conflicting pair", () => {
    const subject = {
        ...newFood({ householdId: "hh", kind: "food", name: "chicken egg" }),
        id: "a",
        calories: 100,
        proteinG: null,
    };
    const related = {
        ...newFood({ householdId: "hh", kind: "food", name: "Eggs" }),
        id: "b",
        calories: 140,
        proteinG: 12,
        allergens: ["milk"],
    };
    const html = renderPossibleDuplicatesPage({
        chrome,
        pairs: [{ subject, related, rule: "contains_words" }],
        refCounts: new Map([
            ["a", 2],
            ["b", 0],
        ]),
        openModalId: DUP_MERGE_MODAL_ID,
        mergePost: {
            foodA: "a",
            foodB: "b",
            keepId: "a",
            picks: {},
        },
    });
    expect(html).toContain('id="dup-merge"');
    expect(html).toContain("data-modal-open-on-load");
    expect(html).toContain('name="pick_calories"');
    expect(html).toContain('name="pick_protein_g"');
    expect(html).toContain("chicken egg: 100");
    expect(html).toContain("Eggs: 140");
    expect(html).toContain('value="a" checked');
    expect(html).toMatch(/name="pick_calories"[\s\S]*value="a"[\s\S]*checked/);
    expect(html).toContain("Allergens are combined");
    expect(html).toContain("data-filled-template=");
});
