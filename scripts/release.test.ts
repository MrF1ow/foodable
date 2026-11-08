import { describe, expect, test } from "bun:test";
import { lintPr } from "./conventions/conventions.ts";
import {
    bumpVersion,
    loadMergedPrs,
    prNumbersFromLog,
    releaseBody,
    releaseBranch,
    releaseTitle,
    setPackageVersion,
    suggestLevel,
    type MergedPr,
} from "./release.ts";

const pr = (number: number, ...labels: string[]): MergedPr => ({
    number,
    title: `chore(repo): pr ${number}`,
    labels,
});

describe("bumpVersion", () => {
    test("each level resets the lower parts", () => {
        expect(bumpVersion("0.1.3", "patch")).toBe("0.1.4");
        expect(bumpVersion("0.1.3", "minor")).toBe("0.2.0");
        expect(bumpVersion("0.1.3", "major")).toBe("1.0.0");
    });

    test("rejects a version that is not x.y.z", () => {
        expect(() => bumpVersion("0.1", "patch")).toThrow();
        expect(() => bumpVersion("1.0.0-rc.1", "patch")).toThrow();
    });
});

describe("suggestLevel", () => {
    test("fixes only is a patch", () => {
        expect(suggestLevel("0.1.0", [pr(1, "type:fix")]).level).toBe("patch");
    });

    test("a feature is a minor", () => {
        const s = suggestLevel("0.1.0", [
            pr(1, "type:fix"),
            pr(2, "type:feat"),
        ]);
        expect(s.level).toBe("minor");
        expect(s.reason).toContain("#2");
    });

    test("a feature confined to repo tooling or docs is a patch", () => {
        expect(
            suggestLevel("0.1.0", [
                pr(1, "type:feat", "area:repo"),
                pr(2, "type:feat", "area:docs", "area:test"),
            ]).level,
        ).toBe("patch");
    });

    test("a feature that also touches the product is a minor", () => {
        expect(
            suggestLevel("0.1.0", [
                pr(1, "type:feat", "area:repo", "area:fridge"),
            ]).level,
        ).toBe("minor");
    });

    test("an unlabelled feature counts as product", () => {
        expect(suggestLevel("0.1.0", [pr(1, "type:feat")]).level).toBe("minor");
    });

    test("a breaking repo-only change still bumps", () => {
        expect(
            suggestLevel("0.1.0", [pr(1, "breaking", "area:repo")]).level,
        ).toBe("minor");
    });

    test("before 1.0 a breaking change or contract is minor, never major", () => {
        expect(suggestLevel("0.4.2", [pr(1, "breaking")]).level).toBe("minor");
        expect(
            suggestLevel("0.4.2", [pr(1, "migration", "migration:contract")])
                .level,
        ).toBe("minor");
    });

    test("from 1.0 a breaking change or contract is major", () => {
        expect(suggestLevel("1.2.0", [pr(1, "breaking")]).level).toBe("major");
        expect(suggestLevel("1.2.0", [pr(1, "migration:contract")]).level).toBe(
            "major",
        );
    });
});

test("prNumbersFromLog reads squash-merge subjects", () => {
    const log = [
        "ci(repo): publish a release when the version changes (#148)",
        "docs(repo): add a guided setup skill for new deploys (#147)",
        "Merge branch 'x'",
        "fix: mention (#12) mid-subject",
    ].join("\n");
    expect(prNumbersFromLog(log)).toEqual([148, 147]);
});

test("setPackageVersion only touches the version value", () => {
    const json =
        '{\n    "name": "foodable",\n    "version": "0.1.0",\n    "x": 1\n}\n';
    expect(setPackageVersion(json, "0.2.0")).toBe(
        json.replace('"0.1.0"', '"0.2.0"'),
    );
    expect(() => setPackageVersion("{}", "1.0.0")).toThrow();
});

describe("the release PR passes pr:check", () => {
    for (const prs of [
        [pr(1, "type:fix")],
        [pr(1, "type:feat", "migration"), pr(2, "migration:contract")],
    ]) {
        test(`with ${prs.length} PR(s)`, () => {
            const body = releaseBody({
                from: "0.1.0",
                to: "0.2.0",
                level: "minor",
                reason: "test",
                lastTag: "v0.1.0",
                prs,
            });
            const { findings } = lintPr({
                title: releaseTitle("0.2.0"),
                branch: releaseBranch("0.2.0"),
                body,
                files: ["package.json"],
            });
            expect(findings).toEqual([]);
        });
    }

    test("contract migrations are called out", () => {
        const body = releaseBody({
            from: "0.1.0",
            to: "0.2.0",
            level: "minor",
            reason: "test",
            lastTag: "v0.1.0",
            prs: [pr(7, "migration", "migration:contract")],
        });
        expect(body).toContain("back up before updating");
        expect(body).toContain("(#7)");
    });
});

describe("loadMergedPrs", () => {
    const listed = [
        { number: 210, title: "fix(auth): a", labels: [{ name: "area:auth" }] },
    ];
    const stacked = {
        number: 175,
        title: "feat(recipes): b",
        labels: [{ name: "area:recipes" }],
    };

    test("fetches a PR merged into a stacked branch on its own", async () => {
        const calls: string[][] = [];
        const prs = await loadMergedPrs([210, 175], async (args) => {
            calls.push(args);
            if (args[1] === "list") return JSON.stringify(listed);
            if (args[1] === "view" && args[2] === "175")
                return JSON.stringify(stacked);
            throw new Error("unexpected");
        });
        expect(prs).toEqual([
            { number: 210, title: "fix(auth): a", labels: ["area:auth"] },
            {
                number: 175,
                title: "feat(recipes): b",
                labels: ["area:recipes"],
            },
        ]);
        expect(calls.filter((c) => c[1] === "view")).toHaveLength(1);
    });

    test("fails when a PR cannot be found at all", async () => {
        await expect(
            loadMergedPrs([999], async (args) => {
                if (args[1] === "list") return "[]";
                throw new Error("not found");
            }),
        ).rejects.toThrow("Could not load PR #999 from GitHub");
    });
});
