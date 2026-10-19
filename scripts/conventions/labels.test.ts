import { describe, expect, test } from "bun:test";
import { lintPr, SCOPES, TYPES } from "./conventions.ts";
import { catalogNames, LABEL_CATALOG } from "./labels.ts";

const VALID_BODY = [
    "## Summary",
    "x",
    "## Blast radius",
    "Level: medium",
    "Rollback: revert-safe",
    "## Changes",
    "x",
    "## Migrations",
    "None",
    "## Contracts",
    "None",
    "## Testing",
    "bun test",
    "## Links",
    "",
].join("\n");

function assertLabelsInCatalog(labels: string[]): void {
    const allowed = catalogNames();
    for (const label of labels) {
        expect(allowed.has(label)).toBe(true);
    }
}

describe("LABEL_CATALOG", () => {
    test("every TYPES entry has type: label", () => {
        const names = catalogNames();
        for (const t of TYPES) {
            expect(names.has(`type:${t}`)).toBe(true);
        }
    });

    test("every SCOPES entry has area: label", () => {
        const names = catalogNames();
        for (const s of SCOPES) {
            expect(names.has(`area:${s}`)).toBe(true);
        }
    });

    test("descriptions are at most 100 characters", () => {
        for (const def of LABEL_CATALOG) {
            expect(def.description.length).toBeLessThanOrEqual(100);
            expect(def.color).toMatch(/^[0-9a-f]{6}$/);
        }
    });

    test("no migration-edit-ok label", () => {
        expect(catalogNames().has("migration-edit-ok")).toBe(false);
    });
});

describe("lintPr labels in catalog", () => {
    test("breaking fridge PR", () => {
        const r = lintPr({
            title: "feat(fridge)!: change the tool result",
            branch: "feat/fridge-change",
            body: [
                "## Summary",
                "x",
                "## Blast radius",
                "Level: high",
                "Rollback: revert-safe",
                "## Changes",
                "x",
                "## Migrations",
                "None",
                "## Contracts",
                "None",
                "## Testing",
                "bun test",
                "## Links",
                "",
            ].join("\n"),
            files: ["src/domain/fridge.ts"],
        });
        assertLabelsInCatalog(r.labels);
    });

    test("migration with contract marker", () => {
        const path = "supabase/migrations/x.sql";
        const r = lintPr({
            title: "feat(db): add a table",
            branch: "feat/db-add-table",
            body: [
                "## Summary",
                "add table",
                "## Blast radius",
                "Level: high",
                "Rollback: needs a follow-up migration",
                "## Changes",
                "migration",
                "## Migrations",
                "add table",
                "## Contracts",
                "None",
                "## Testing",
                "db:dryrun",
                "## Links",
                "",
            ].join("\n"),
            files: [path],
            fileContents: {
                [path]: "-- foodable:contract add the table\n",
            },
        });
        expect(r.labels).toContain("migration");
        expect(r.labels).toContain("migration:contract");
        assertLabelsInCatalog(r.labels);
    });

    test("dependabot author adds dependencies", () => {
        const r = lintPr({
            title: "chore(deps): bump left-pad",
            branch: "dependabot/bun/left-pad",
            body: "hello",
            files: ["bun.lock"],
            author: "dependabot[bot]",
        });
        expect(r.labels).toContain("dependencies");
        assertLabelsInCatalog(r.labels);
    });

    test("typical feat PR", () => {
        const r = lintPr({
            title: "feat(fridge): show expiry",
            branch: "feat/fridge-show",
            body: VALID_BODY,
            files: ["src/domain/fridge.ts"],
        });
        assertLabelsInCatalog(r.labels);
    });
});
