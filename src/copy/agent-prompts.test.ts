import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { UNVERIFIED_RECIPES_PROMPT } from "./agent-prompts.js";

test("UNVERIFIED_RECIPES_PROMPT names registered MCP tools", () => {
    const snapshot = JSON.parse(
        readFileSync(
            new URL("../mcp/tools-list.snapshot.json", import.meta.url),
            "utf8",
        ),
    ) as string[];
    const names = new Set(snapshot);
    const found = [...UNVERIFIED_RECIPES_PROMPT.matchAll(/`([a-z]+_[a-z_]+)`/g)]
        .map((m) => m[1]!)
        .filter((name) => name.includes("_"));
    expect(found.length).toBeGreaterThan(0);
    for (const tool of found) {
        expect(names.has(tool)).toBe(true);
    }
    expect(found).toContain("list_recipes");
    expect(found).toContain("get_recipe");
    expect(found).toContain("verify_recipe");
});
