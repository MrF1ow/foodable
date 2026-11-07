import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { join } from "path";
import {
    checkPlannerPr,
    nextItems,
    parsePlanner,
    parsePlannerSection,
    type Planner,
} from "./planner.ts";

const root = join(import.meta.dir, "../..");

type ItemFields = {
    id: string;
    status?: string;
    priority?: string;
    size?: string;
    after?: string[];
    prs?: number[];
    extra?: string;
};

function item(f: ItemFields): string {
    return [
        "---",
        `id: ${f.id}`,
        `title: Item ${f.id}`,
        `status: ${f.status ?? "todo"}`,
        `priority: ${f.priority ?? "med"}`,
        `size: ${f.size ?? "M"}`,
        "type: feature",
        "areas: [nutrition]",
        `after: [${(f.after ?? []).join(", ")}]`,
        "plan: null",
        `prs: [${(f.prs ?? []).join(", ")}]`,
        ...(f.extra ? [f.extra] : []),
        "---",
        "",
        "Body.",
        "",
    ].join("\n");
}

const project = (key: string, name = `Project ${key}`) =>
    `---\nkey: ${key}\nname: ${name}\nplan: null\n---\n\nSummary.\n`;

// Items go to calendar/ (CAL) or postgres/ (PG) by their prefix.
function files(
    items: ItemFields[],
    retired: { key: string; name: string; by: number }[] = [],
    dirs: { cal?: boolean; pg?: boolean } = { cal: true, pg: true },
): Record<string, string> {
    const out: Record<string, string> = {};
    if (dirs.cal) out["planner/calendar/_project.md"] = project("CAL");
    if (dirs.pg) out["planner/postgres/_project.md"] = project("PG");
    for (const f of items) {
        const dir = f.id.startsWith("CAL-") ? "calendar" : "postgres";
        out[`planner/${dir}/${f.id}-thing.md`] = item(f);
    }
    if (retired.length > 0) {
        out["planner/retired.yml"] = retired
            .map(
                (r) =>
                    `- key: ${r.key}\n  name: ${r.name}\n  retired_by: ${r.by}\n`,
            )
            .join("");
    }
    return out;
}

function load(fs: Record<string, string>): Planner {
    const { planner, findings } = parsePlanner(fs);
    expect(findings).toEqual([]);
    return planner;
}

function messages(fs: Record<string, string>): string[] {
    return parsePlanner(fs).findings.map((f) => f.message);
}

describe("parsePlanner", () => {
    test("reads projects, items in ID order, inbox ideas and retired keys", () => {
        const fs = files(
            [{ id: "CAL-10" }, { id: "CAL-2", after: ["CAL-10", "OLD-3"] }],
            [{ key: "OLD", name: "Old project", by: 12 }],
            { cal: true },
        );
        fs["planner/inbox/per-member-usual.md"] =
            "---\ntitle: A per-member usual product\n---\n\nWhy.\n";
        fs["planner/README.md"] = "# How it works\n";
        const planner = load(fs);
        expect(planner.projects.map((p) => p.key)).toEqual(["CAL"]);
        expect(planner.items.map((i) => i.id)).toEqual(["CAL-2", "CAL-10"]);
        expect(planner.inbox).toEqual(["A per-member usual product"]);
        expect(planner.retired).toEqual([
            { key: "OLD", name: "Old project", retiredBy: 12 },
        ]);
    });

    test("an empty retired.yml (comments only) is fine", () => {
        const fs = files([{ id: "CAL-1" }]);
        fs["planner/retired.yml"] = "# nothing retired yet\n";
        expect(load(fs).retired).toEqual([]);
    });

    test("rejects bad field values with one finding each", () => {
        const fs = files([]);
        fs["planner/calendar/CAL-1-x.md"] = item({
            id: "CAL-1",
            status: "started",
            priority: "p1",
            size: "XXL",
        });
        const m = messages(fs);
        expect(m.some((x) => x.includes("status must be one of"))).toBe(true);
        expect(m.some((x) => x.includes("priority must be one of"))).toBe(true);
        expect(m.some((x) => x.includes("size must be one of"))).toBe(true);
    });

    test("rejects unknown fields and unknown areas", () => {
        const fs = files([{ id: "CAL-1", extra: "owner: me" }]);
        fs["planner/calendar/CAL-2-x.md"] = item({ id: "CAL-2" }).replace(
            "areas: [nutrition]",
            "areas: [kitchen]",
        );
        const m = messages(fs);
        expect(m).toContain(
            "planner/calendar/CAL-1-thing.md: unknown fields: owner",
        );
        expect(m.some((x) => x.includes("unknown areas: kitchen"))).toBe(true);
    });

    test("the file name must carry the item's ID", () => {
        const fs = files([]);
        fs["planner/calendar/CAL-3-x.md"] = item({ id: "CAL-4" });
        fs["planner/calendar/notes.md"] = item({ id: "CAL-5" });
        const m = messages(fs);
        expect(m).toContain(
            "planner/calendar/CAL-3-x.md: id CAL-4 does not match the file name (CAL-3)",
        );
        expect(
            m.some((x) =>
                x.startsWith("planner/calendar/notes.md: item files are named"),
            ),
        ).toBe(true);
    });

    test("IDs use the project's key and never repeat", () => {
        const fs = files([{ id: "CAL-1" }]);
        fs["planner/calendar/PG-1-x.md"] = item({ id: "PG-1" });
        fs["planner/calendar/CAL-1-again.md"] = item({ id: "CAL-1" });
        const m = messages(fs);
        expect(m).toContain(
            "planner/calendar/PG-1-x.md: IDs in planner/calendar/ start with CAL-",
        );
        expect(m.some((x) => x.includes("ID CAL-1 is also used by"))).toBe(
            true,
        );
    });

    test("an item folder needs a _project.md, and keys are unique", () => {
        const fs = files([{ id: "CAL-1" }]);
        fs["planner/other/_project.md"] = project("CAL");
        fs["planner/orphan/ORP-1-x.md"] = item({ id: "ORP-1" });
        const m = messages(fs);
        expect(m.some((x) => x.includes("key CAL is already used by"))).toBe(
            true,
        );
        expect(m).toContain(
            "planner/orphan/ORP-1-x.md: planner/orphan/ has no _project.md",
        );
    });

    test("after must point at real items, without cycles", () => {
        const m = messages(
            files([
                { id: "CAL-1", after: ["CAL-9"] },
                { id: "CAL-2", after: ["CAL-3"] },
                { id: "CAL-3", after: ["CAL-2"] },
            ]),
        );
        expect(m).toContain(
            "planner/calendar/CAL-1-thing.md: after names CAL-9, which does not exist",
        );
        expect(
            m.some((x) => x.includes("dependency cycle CAL-2 → CAL-3 → CAL-2")),
        ).toBe(true);
    });

    test("a done item must name its PR", () => {
        const m = messages(
            files([{ id: "CAL-1", status: "done" }, { id: "CAL-2" }]),
        );
        expect(m).toContain(
            "planner/calendar/CAL-1-thing.md: a done item names the PR that shipped it in prs",
        );
    });

    test("inbox ideas have only a title", () => {
        const fs = files([{ id: "CAL-1" }]);
        fs["planner/inbox/idea.md"] = "---\ntitle: Idea\npriority: high\n---\n";
        expect(
            messages(fs).some((x) =>
                x.includes("inbox ideas only have a title"),
            ),
        ).toBe(true);
    });

    test("missing or broken frontmatter is reported, not thrown", () => {
        const fs = files([]);
        fs["planner/calendar/CAL-1-x.md"] = "No frontmatter here.\n";
        fs["planner/calendar/CAL-2-x.md"] = "---\nid: [unclosed\n---\n";
        const m = messages(fs);
        expect(m).toContain(
            "planner/calendar/CAL-1-x.md: missing frontmatter (--- … ---)",
        );
        expect(
            m.some((x) =>
                x.startsWith("planner/calendar/CAL-2-x.md: invalid YAML"),
            ),
        ).toBe(true);
    });

    test("a project with nothing left open must be retired", () => {
        const m = messages(
            files([
                { id: "CAL-1", status: "done", prs: [5] },
                { id: "CAL-2", status: "dropped" },
                { id: "PG-1" },
            ]),
        );
        expect(m).toEqual([
            "planner/calendar/_project.md: every CAL item is done or dropped: remove planner/calendar/ and retire CAL in planner/retired.yml (bun run planner --close does both)",
        ]);
    });

    test("a retired key is never reused, and is retired once", () => {
        const m = messages(
            files(
                [{ id: "CAL-1" }],
                [
                    { key: "CAL", name: "Old calendar", by: 3 },
                    { key: "OLD", name: "Old", by: 4 },
                    { key: "OLD", name: "Old again", by: 5 },
                ],
            ),
        );
        expect(m).toContain(
            "planner/calendar/_project.md: key CAL was retired in #3 and is never reused; pick another",
        );
        expect(m).toContain("planner/retired.yml: OLD is retired twice");
    });

    test("retired.yml entries need a key, a name and the PR number", () => {
        const fs = files([{ id: "CAL-1" }]);
        fs["planner/retired.yml"] =
            "- key: cal\n  name: x\n  retired_by: 1\n- key: OLD\n  retired_by: 2\n- key: NEW\n  name: New\n";
        const m = messages(fs);
        expect(m).toContain(
            "planner/retired.yml: entry 1: key must be 2–5 capital letters",
        );
        expect(m).toContain("planner/retired.yml: entry 2: name is required");
        expect(m).toContain(
            "planner/retired.yml: entry 3: retired_by must be the PR number that retired it",
        );
    });
});

describe("nextItems", () => {
    test("open, unblocked items: priority, then doing, then size, then ID", () => {
        const planner = load(
            files(
                [
                    { id: "CAL-1", status: "done", prs: [1] },
                    {
                        id: "CAL-2",
                        priority: "high",
                        size: "L",
                        after: ["CAL-1"],
                    },
                    { id: "CAL-3", priority: "high", size: "S" },
                    { id: "CAL-4", priority: "urgent", after: ["CAL-5"] },
                    { id: "CAL-5", priority: "low" },
                    {
                        id: "CAL-6",
                        priority: "high",
                        size: "L",
                        status: "doing",
                    },
                    { id: "CAL-7", status: "dropped" },
                    { id: "CAL-8", priority: "med", after: ["CAL-7", "OLD-2"] },
                ],
                [{ key: "OLD", name: "Old", by: 9 }],
                { cal: true },
            ),
        );
        expect(nextItems(planner).map((i) => i.id)).toEqual([
            "CAL-6",
            "CAL-3",
            "CAL-2",
            "CAL-8",
            "CAL-5",
        ]);
    });
});

describe("parsePlannerSection", () => {
    test("reads Closes, Part of and None", () => {
        expect(
            parsePlannerSection("Closes CAL-2, CAL-1\nPart of PG-5"),
        ).toEqual({
            none: false,
            closes: ["CAL-1", "CAL-2"],
            partOf: ["PG-5"],
        });
        expect(parsePlannerSection("<!-- hint -->\nNone.")).toEqual({
            none: true,
            closes: [],
            partOf: [],
        });
        expect(parsePlannerSection("- Closes CAL-2 and CAL-3.")).toEqual({
            none: false,
            closes: ["CAL-2", "CAL-3"],
            partOf: [],
        });
    });

    test("rejects a missing, empty, unreadable or contradictory section", () => {
        expect(parsePlannerSection(undefined)).toHaveProperty("error");
        expect(parsePlannerSection("<!-- only a hint -->")).toHaveProperty(
            "error",
        );
        expect(parsePlannerSection("Fixes CAL-2")).toHaveProperty("error");
        expect(parsePlannerSection("Closes cal-2")).toHaveProperty("error");
        expect(parsePlannerSection("None.\nCloses CAL-2")).toHaveProperty(
            "error",
        );
        expect(
            parsePlannerSection("Closes CAL-2\nPart of CAL-2"),
        ).toHaveProperty("error");
    });
});

describe("checkPlannerPr", () => {
    const PR = 200;
    const check = (
        section: string | undefined,
        base: Record<string, string>,
        head: Record<string, string>,
    ) =>
        checkPlannerPr({
            section,
            base: load(base),
            head: load(head),
            prNumber: PR,
        }).map((f) => f.message);
    const pg = { id: "PG-1" };

    test("Closes passes when the item is done with this PR recorded", () => {
        expect(
            check(
                "Closes CAL-1",
                files([{ id: "CAL-1" }, { id: "CAL-2" }, pg]),
                files([
                    { id: "CAL-1", status: "done", prs: [PR] },
                    { id: "CAL-2" },
                    pg,
                ]),
            ),
        ).toEqual([]);
    });

    test("Closes fails when the item was not updated", () => {
        expect(
            check(
                "Closes CAL-1",
                files([{ id: "CAL-1" }, pg]),
                files([{ id: "CAL-1" }, pg]),
            ),
        ).toEqual([
            "Closes CAL-1: set status: done in planner/calendar/CAL-1-thing.md",
            "Closes CAL-1: add 200 to prs in planner/calendar/CAL-1-thing.md",
        ]);
    });

    test("Closes fails for an unknown or already-done item", () => {
        expect(check("Closes CAL-9", files([pg]), files([pg]))).toEqual([
            "Closes CAL-9: no such item",
        ]);
        expect(
            check(
                "Closes CAL-1",
                files([
                    { id: "CAL-1", status: "done", prs: [5] },
                    { id: "CAL-2" },
                    pg,
                ]),
                files([
                    { id: "CAL-1", status: "done", prs: [5, PR] },
                    { id: "CAL-2" },
                    pg,
                ]),
            ),
        ).toEqual(["Closes CAL-1: it was already done before this PR"]);
    });

    test("Part of needs doing and this PR recorded", () => {
        expect(
            check(
                "Part of CAL-1",
                files([{ id: "CAL-1" }, pg]),
                files([{ id: "CAL-1", status: "doing", prs: [PR] }, pg]),
            ),
        ).toEqual([]);
        expect(
            check(
                "Part of CAL-1",
                files([{ id: "CAL-1" }, { id: "CAL-2" }, pg]),
                files([
                    { id: "CAL-1", status: "done", prs: [PR] },
                    { id: "CAL-2" },
                    pg,
                ]),
            ),
        ).toContain(
            "Part of CAL-1: set status: doing in planner/calendar/CAL-1-thing.md (use Closes CAL-1 if this PR finishes it)",
        );
    });

    test("marking an item done without declaring it fails", () => {
        expect(
            check(
                "None.",
                files([{ id: "CAL-1" }, { id: "CAL-2" }, pg]),
                files([
                    { id: "CAL-1", status: "done", prs: [PR] },
                    { id: "CAL-2" },
                    pg,
                ]),
            ),
        ).toEqual([
            "CAL-1 is marked done, but ## Planner does not say Closes CAL-1",
            "CAL-1 records #200, but ## Planner does not name CAL-1",
        ]);
    });

    test("a new item may arrive as done for work that shipped elsewhere", () => {
        expect(
            check(
                "None.",
                files([pg]),
                files([
                    { id: "CAL-1", status: "done", prs: [150] },
                    { id: "CAL-2" },
                    pg,
                ]),
            ),
        ).toEqual([]);
    });

    test("planning edits need no declaration", () => {
        expect(
            check(
                "None.",
                files([{ id: "CAL-1" }, pg]),
                files([
                    { id: "CAL-1", priority: "urgent", size: "S" },
                    { id: "CAL-2" },
                    pg,
                ]),
            ),
        ).toEqual([]);
    });

    test("IDs and recorded PRs are append-only", () => {
        expect(
            check(
                "None.",
                files([{ id: "CAL-1" }, { id: "CAL-2" }, pg]),
                files([{ id: "CAL-1" }, pg]),
            ),
        ).toEqual([
            "CAL-2 was removed; set status: dropped instead, so its ID is never reused",
        ]);
        expect(
            check(
                "None.",
                files([{ id: "CAL-1", status: "doing", prs: [7] }, pg]),
                files([{ id: "CAL-1", status: "doing" }, pg]),
            ),
        ).toEqual(["CAL-1: prs lost #7; recorded PRs stay"]);
    });

    test("a missing section fails", () => {
        expect(check(undefined, files([pg]), files([pg]))).toEqual([
            "Missing ## Planner section (Closes <ID>, Part of <ID>, or None.)",
        ]);
    });

    describe("retiring a finished project", () => {
        const base = files([
            { id: "CAL-1", status: "done", prs: [5] },
            { id: "CAL-2", status: "dropped" },
            { id: "CAL-3" },
            pg,
        ]);
        const retiredHead = (by = PR) =>
            files([pg], [{ key: "CAL", name: "Project CAL", by }], {
                pg: true,
            });

        test("closing the last item removes the folder and retires the key", () => {
            expect(check("Closes CAL-3", base, retiredHead())).toEqual([]);
        });

        test("the retired entry carries this PR's number", () => {
            expect(check("Closes CAL-3", base, retiredHead(999))).toEqual([
                "planner/retired.yml: CAL is retired by this PR, so retired_by is 200",
            ]);
        });

        test("a project with open items cannot be retired", () => {
            expect(check("None.", base, retiredHead())).toEqual([
                "CAL is retired, but CAL-3 was still open; close it in this PR (Closes CAL-3) or set status: dropped first",
            ]);
        });

        test("a folder disappears only by being retired", () => {
            expect(
                check("Closes CAL-3", base, files([pg], [], { pg: true })),
            ).toEqual([
                "planner/calendar/ was removed; a project is removed only by retiring CAL in planner/retired.yml",
                "CAL-1 was removed; set status: dropped instead, so its ID is never reused",
                "CAL-2 was removed; set status: dropped instead, so its ID is never reused",
                "CAL-3 was removed; set status: dropped instead, so its ID is never reused",
                "Closes CAL-3: no such item",
            ]);
        });

        test("retiring the key while keeping the folder fails", () => {
            const fs = files(
                [
                    { id: "CAL-1", status: "done", prs: [5] },
                    { id: "CAL-2", status: "dropped" },
                    { id: "CAL-3", status: "done", prs: [PR] },
                    pg,
                ],
                [{ key: "CAL", name: "Project CAL", by: PR }],
            );
            const head = parsePlanner(fs).planner;
            const m = checkPlannerPr({
                section: "Closes CAL-3",
                base: load(base),
                head,
                prNumber: PR,
            }).map((f) => f.message);
            expect(m).toContain("CAL is retired, so remove planner/calendar/");
        });

        test("retired.yml is append-only", () => {
            const before = files([pg], [{ key: "OLD", name: "Old", by: 3 }], {
                pg: true,
            });
            expect(
                check("None.", before, files([pg], [], { pg: true })),
            ).toEqual([
                "planner/retired.yml: the entry for OLD was changed or removed; retired entries stay as they are",
            ]);
        });
    });
});

describe("the committed planner", () => {
    async function readTree(dir: string): Promise<Record<string, string>> {
        const out: Record<string, string> = {};
        for (const entry of await readdir(join(root, dir), {
            withFileTypes: true,
            recursive: true,
        })) {
            if (!entry.isFile()) continue;
            const abs = join(entry.parentPath, entry.name);
            out[abs.slice(root.length + 1)] = await Bun.file(abs).text();
        }
        return out;
    }

    test("every file under planner/ is valid", async () => {
        const { findings } = parsePlanner(await readTree("planner"));
        expect(findings).toEqual([]);
    });

    test("every plan link points at a real file", async () => {
        const { planner } = parsePlanner(await readTree("planner"));
        const plans = [...planner.projects, ...planner.items]
            .map((x) => x.plan)
            .filter((p): p is string => p !== null);
        for (const plan of plans) {
            expect(
                await Bun.file(join(root, plan.split("#")[0])).exists(),
            ).toBe(true);
        }
    });

    test("ROADMAP.md lists exactly the live projects", async () => {
        const { planner } = parsePlanner(await readTree("planner"));
        const text = await Bun.file(join(root, "ROADMAP.md")).text();
        const linked = [...text.matchAll(/\]\(planner\/([a-z0-9-]+)\/\)/g)]
            .map((m) => m[1])
            .filter((d) => d !== "inbox");
        expect([...new Set(linked)].sort()).toEqual(
            planner.projects.map((p) => p.dir).sort(),
        );
    });
});
