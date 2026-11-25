import { test, expect } from "bun:test";
import { DRAFT_RECIPES_PROMPT } from "./agent-prompts.js";

test("DRAFT_RECIPES_PROMPT names registered MCP tools", async () => {
    const snapshot = (await Bun.file(
        new URL("../mcp/tools-list.snapshot.json", import.meta.url),
    ).json()) as string[];
    const names = new Set(snapshot);
    const found = [...DRAFT_RECIPES_PROMPT.matchAll(/`([a-z]+_[a-z_]+)`/g)]
        .map((m) => m[1]!)
        .filter((name) => name.includes("_"));
    expect(found.length).toBeGreaterThan(0);
    for (const tool of found) {
        expect(names.has(tool)).toBe(true);
    }
    expect(found).toContain("list_recipes");
    expect(found).toContain("get_recipe");
    expect(found).toContain("verify_recipe");
    expect(found).toContain("save_recipe");
});

test("DRAFT_RECIPES_PROMPT speaks of drafts and Save, with the one filter value the tool takes as its only other word", () => {
    expect(DRAFT_RECIPES_PROMPT).toContain("recipe drafts");
    expect(DRAFT_RECIPES_PROMPT).toContain("ready to save");
    expect(DRAFT_RECIPES_PROMPT).toContain("deleted 7 days after import");
    // `list_recipes` names drafts with `verification: "unverified"`; that
    // argument is the one place the word may appear.
    const prose = DRAFT_RECIPES_PROMPT.replace(
        'verification: "unverified"',
        "",
    );
    expect(prose.toLowerCase()).not.toContain("unverified");
});
