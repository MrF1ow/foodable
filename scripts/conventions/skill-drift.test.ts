import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
    driftMessage,
    jsonKeyDiffers,
    loadSkills,
    resolveKeyChanges,
    skillDrift,
    skipsSkillDrift,
    splitWatch,
    type FileReader,
    type Skill,
} from "./skill-drift.ts";

const testSkill: Skill = {
    name: "foodable-test",
    dir: ".claude/skills/foodable-test",
    watches: ["package.json", "scripts/nav-check*.ts", "src/db/testing/**"],
};
const otherSkill: Skill = {
    name: "foodable-pr",
    dir: ".claude/skills/foodable-pr",
    watches: ["scripts/pr-lint.ts"],
};

describe("skillDrift", () => {
    test("a watched path changed without the skill: fails", () => {
        const found = skillDrift(["package.json"], [testSkill, otherSkill]);
        expect(found).toEqual([
            {
                skill: "foodable-test",
                dir: ".claude/skills/foodable-test",
                changed: ["package.json"],
            },
        ]);
        expect(driftMessage(found[0]!)).toContain("same PR");
    });

    test("the skill's SKILL.md changed too: passes", () => {
        expect(
            skillDrift(
                ["package.json", ".claude/skills/foodable-test/SKILL.md"],
                [testSkill, otherSkill],
            ),
        ).toEqual([]);
    });

    test("any file under the skill folder counts as updating it", () => {
        expect(
            skillDrift(
                ["scripts/nav-check.ts", ".claude/skills/foodable-test/x.md"],
                [testSkill],
            ),
        ).toEqual([]);
    });

    test("globs match, unrelated paths do not", () => {
        expect(
            skillDrift(["scripts/nav-check-turbo.ts"], [testSkill]),
        ).toHaveLength(1);
        expect(skillDrift(["src/db/testing/pg.ts"], [testSkill])).toHaveLength(
            1,
        );
        expect(
            skillDrift(["src/db/other.ts", "README.md"], [testSkill]),
        ).toEqual([]);
    });

    test("a sibling skill's folder does not satisfy this skill", () => {
        expect(
            skillDrift(
                ["package.json", ".claude/skills/foodable-pr/SKILL.md"],
                [testSkill],
            ),
        ).toHaveLength(1);
    });

    test("a deleted or renamed watched path (old name listed) still counts", () => {
        expect(skillDrift(["scripts/nav-check.ts"], [testSkill])).toHaveLength(
            1,
        );
    });

    test("no changes, no skills: nothing to report", () => {
        expect(skillDrift([], [testSkill])).toEqual([]);
        expect(skillDrift(["package.json"], [])).toEqual([]);
    });
});

describe("loadSkills", () => {
    test("reads the repo's skills and their watches", async () => {
        const skills = await loadSkills(join(import.meta.dir, "../.."));
        const names = skills.map((s) => s.name);
        expect(names).toContain("foodable-test");
        const test = skills.find((s) => s.name === "foodable-test")!;
        expect(test.dir).toBe(".claude/skills/foodable-test");
        expect(test.watches).toContain("package.json#scripts");
    });
});

describe("jsonKeyDiffers", () => {
    const pkg = (o: object) => JSON.stringify(o);

    test("a version bump leaves scripts alone", () => {
        expect(
            jsonKeyDiffers(
                pkg({ version: "1.0.0", scripts: { a: "x" } }),
                pkg({ version: "1.0.1", scripts: { a: "x" } }),
                "scripts",
            ),
        ).toBe(false);
    });

    test("reordered keys are not a change", () => {
        expect(
            jsonKeyDiffers(
                pkg({ scripts: { a: "x", b: "y" } }),
                pkg({ scripts: { b: "y", a: "x" } }),
                "scripts",
            ),
        ).toBe(false);
    });

    test("an edited, added or removed script is a change", () => {
        const base = pkg({ scripts: { a: "x" } });
        expect(
            jsonKeyDiffers(base, pkg({ scripts: { a: "y" } }), "scripts"),
        ).toBe(true);
        expect(
            jsonKeyDiffers(
                base,
                pkg({ scripts: { a: "x", b: "y" } }),
                "scripts",
            ),
        ).toBe(true);
        expect(jsonKeyDiffers(base, pkg({}), "scripts")).toBe(true);
    });

    test("an added or deleted file, or unparseable JSON, counts as changed", () => {
        expect(jsonKeyDiffers(null, pkg({ scripts: {} }), "scripts")).toBe(
            true,
        );
        expect(jsonKeyDiffers(pkg({ scripts: {} }), null, "scripts")).toBe(
            true,
        );
        expect(jsonKeyDiffers("{", pkg({ scripts: {} }), "scripts")).toBe(true);
    });
});

describe("package.json#scripts watch", () => {
    const skill: Skill = {
        name: "foodable-test",
        dir: ".claude/skills/foodable-test",
        watches: ["package.json#scripts", "Dockerfile"],
    };
    const files =
        (base: object, head: object): FileReader =>
        async (_p, side) =>
            JSON.stringify(side === "base" ? base : head);

    const run = async (changed: string[], base: object, head: object) =>
        skillDrift(
            changed,
            [skill],
            await resolveKeyChanges(changed, [skill], files(base, head)),
        );

    test("a version-only package.json change: no finding", async () => {
        expect(
            await run(
                ["package.json"],
                { version: "1.0.0", scripts: { a: "x" } },
                { version: "1.0.1", scripts: { a: "x" } },
            ),
        ).toEqual([]);
    });

    test("a dependencies-only change: no finding", async () => {
        expect(
            await run(
                ["package.json", "bun.lock"],
                { dependencies: { a: "1" }, scripts: { a: "x" } },
                { dependencies: { a: "2" }, scripts: { a: "x" } },
            ),
        ).toEqual([]);
    });

    test("a scripts change: finding", async () => {
        const found = await run(
            ["package.json"],
            { scripts: { a: "x" } },
            { scripts: { a: "y" } },
        );
        expect(found.map((f) => f.changed)).toEqual([["package.json"]]);
    });

    test("a scripts change with the skill touched: passes", async () => {
        expect(
            await run(
                ["package.json", ".claude/skills/foodable-test/SKILL.md"],
                { scripts: { a: "x" } },
                { scripts: { a: "y" } },
            ),
        ).toEqual([]);
    });

    test("other watches on the same skill still fire without a key", async () => {
        expect(
            await run(["Dockerfile"], { scripts: {} }, { scripts: {} }),
        ).toHaveLength(1);
    });

    test("only files a key watch matches are read", async () => {
        const reads: string[] = [];
        await resolveKeyChanges(
            ["Dockerfile", "README.md"],
            [skill],
            async (p) => {
                reads.push(p);
                return null;
            },
        );
        expect(reads).toEqual([]);
    });

    test("skillDrift without a lookup treats a keyed watch as changed", () => {
        expect(skillDrift(["package.json"], [skill])).toHaveLength(1);
    });

    test("splitWatch separates the key", () => {
        expect(splitWatch("package.json#scripts")).toEqual({
            glob: "package.json",
            key: "scripts",
        });
    });
});

describe("skipsSkillDrift", () => {
    test("dependabot bumps skip the check", () => {
        expect(skipsSkillDrift("dependabot[bot]")).toBe(true);
    });

    test("every other author, and an unknown one, is checked", () => {
        expect(skipsSkillDrift("MrF1ow")).toBe(false);
        expect(skipsSkillDrift("")).toBe(false);
        expect(skipsSkillDrift("dependabot")).toBe(false);
    });
});
