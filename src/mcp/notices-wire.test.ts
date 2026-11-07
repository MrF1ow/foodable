import { test, expect } from "bun:test";
import type { Notice } from "../domain/notices.js";
import { noticeSentence } from "../copy/notices.js";
import { noticeToWire, NOTICE_SCHEMA } from "./shared.js";

test("noticeToWire maps subjects, action, and message", () => {
    const gap: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: { kind: "recipe_ingredient", id: "ing-1", recipeId: "rec-1" },
        related: [],
        params: { name: "Milk" },
    };
    const w = noticeToWire(gap);
    expect(NOTICE_SCHEMA.parse(w)).toEqual(w);
    expect(w.subject.recipe_id).toBe("rec-1");
    expect(w.action).toEqual({ label: "Pick usual product" });
    expect(w.message).toBe(noticeSentence(gap));

    const recipeOnly: Notice = {
        code: "recipe.allergen",
        severity: "block",
        subject: { kind: "recipe", id: "r1" },
        related: [{ kind: "member", id: "u1", name: "Pat" }],
        params: { allergens: ["peanut"] },
    };
    const wr = noticeToWire(recipeOnly);
    expect(wr.subject.recipe_id).toBeNull();
    expect(wr.action).toBeNull();
    expect(wr.message).toBe(noticeSentence(recipeOnly));
});

test("noticeToWire maps food.possible_duplicate", () => {
    const dup: Notice = {
        code: "food.possible_duplicate",
        severity: "info",
        subject: { kind: "food", id: "f-a" },
        related: [{ kind: "food", id: "f-b", name: "Eggs" }],
        params: { name: "chicken egg", rule: "contains_words", foodId: "f-a" },
    };
    const w = noticeToWire(dup);
    expect(NOTICE_SCHEMA.parse(w)).toEqual(w);
    expect(w.message).toBe(noticeSentence(dup));
    expect(w.action).toEqual({ label: "Review" });
});
