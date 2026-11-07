// The planner: one Markdown file per planned item under planner/<project>/,
// with YAML frontmatter for the fields and prose below it. Everything here is
// pure: the caller reads the files (from the working tree, or from git at a
// commit) and passes their contents in, so the same input always gives the
// same result.
//
// Layout:
//   planner/<project>/_project.md      key (the ID prefix), name, plan
//   planner/<project>/<ID>-<slug>.md   one item
//   planner/inbox/<slug>.md            an undecided idea: title only, no ID
//   planner/retired.yml                projects whose items are all finished
//
// A project lives only while it has open work. The pull request that finishes
// its last item deletes the folder and appends the key to retired.yml, so the
// folder shows only what is left and a key is never reused.
//
// The PR check (checkPlannerPr) compares the planner at the base commit with
// the planner the pull request would merge, against the PR body's
// "## Planner" section.

export const PLANNER_DIR = "planner";
export const INBOX_DIR = "inbox";
export const PROJECT_FILE = "_project.md";
export const RETIRED_FILE = "retired.yml";

export const STATUSES = ["todo", "decide", "doing", "done", "dropped"] as const;
export const PRIORITIES = ["urgent", "high", "med", "low", "none"] as const;
export const SIZES = ["XS", "S", "M", "L", "XL"] as const;
export const ITEM_TYPES = [
    "feature",
    "improvement",
    "fix",
    "chore",
    "contract",
    "ops",
    "security",
    "decision",
] as const;
export const AREAS = [
    "nutrition",
    "foods",
    "fridge",
    "grocery",
    "recipes",
    "household",
    "web",
    "mcp",
    "db",
    "infra",
    "tooling",
] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];
export type ItemType = (typeof ITEM_TYPES)[number];
export type Area = (typeof AREAS)[number];

export type Item = {
    path: string;
    project: string;
    id: string;
    title: string;
    status: Status;
    priority: Priority;
    size: Size;
    type: ItemType;
    areas: Area[];
    after: string[];
    plan: string | null;
    prs: number[];
};

export type Project = {
    path: string;
    dir: string;
    key: string;
    name: string;
    plan: string | null;
};

export type Retired = { key: string; name: string; retiredBy: number };

export type Planner = {
    projects: Project[];
    items: Item[];
    inbox: string[];
    retired: Retired[];
};

export type PlannerFinding = { rule: string; message: string };

const ID_PATTERN = /^([A-Z]+)-([1-9]\d*)$/;
const KEY_PATTERN = /^[A-Z]{2,5}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ITEM_FILE_PATTERN = /^([A-Z]+-[1-9]\d*)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const ITEM_KEYS = [
    "id",
    "title",
    "status",
    "priority",
    "size",
    "type",
    "areas",
    "after",
    "plan",
    "prs",
];
const PROJECT_KEYS = ["key", "name", "plan"];
const INBOX_KEYS = ["title"];
const RETIRED_KEYS = ["key", "name", "retired_by"];

export const PRIORITY_RANK: Record<Priority, number> = {
    urgent: 0,
    high: 1,
    med: 2,
    low: 3,
    none: 4,
};

const FINISHED: Status[] = ["done", "dropped"];
export const isFinished = (s: Status) => FINISHED.includes(s);

export function splitFrontmatter(
    text: string,
): { data: unknown; body: string } | { error: string } {
    const normalized = text.replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    if (!match) return { error: "missing frontmatter (--- … ---)" };
    try {
        const data = Bun.YAML.parse(match[1]);
        return { data, body: normalized.slice(match[0].length) };
    } catch (err) {
        return { error: `invalid YAML: ${(err as Error).message}` };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
    list: readonly T[],
    value: unknown,
): value is T {
    return (
        typeof value === "string" && (list as readonly string[]).includes(value)
    );
}

function unknownKeys(
    data: Record<string, unknown>,
    allowed: string[],
): string[] {
    return Object.keys(data).filter((k) => !allowed.includes(k));
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): string[] | null {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return null;
    if (!value.every((v) => typeof v === "string")) return null;
    return value as string[];
}

const isPrNumber = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

function parseRetired(
    path: string,
    text: string,
    fail: (path: string, message: string) => void,
): Retired[] {
    let data: unknown;
    try {
        data = Bun.YAML.parse(text);
    } catch (err) {
        fail(path, `invalid YAML: ${(err as Error).message}`);
        return [];
    }
    if (data === null || data === undefined) return [];
    if (!Array.isArray(data)) {
        fail(path, "must be a list of { key, name, retired_by }");
        return [];
    }
    const out: Retired[] = [];
    data.forEach((entry, i) => {
        const where = `entry ${i + 1}`;
        if (!isRecord(entry)) {
            fail(path, `${where} must be a mapping`);
            return;
        }
        const extra = unknownKeys(entry, RETIRED_KEYS);
        if (extra.length > 0) {
            fail(path, `${where}: unknown fields: ${extra.join(", ")}`);
        }
        if (typeof entry.key !== "string" || !KEY_PATTERN.test(entry.key)) {
            fail(path, `${where}: key must be 2–5 capital letters`);
            return;
        }
        if (!nonEmptyString(entry.name)) {
            fail(path, `${where}: name is required`);
            return;
        }
        if (!isPrNumber(entry.retired_by)) {
            fail(
                path,
                `${where}: retired_by must be the PR number that retired it`,
            );
            return;
        }
        out.push({
            key: entry.key,
            name: entry.name,
            retiredBy: entry.retired_by as number,
        });
    });
    return out;
}

// Parses every file under planner/. `files` maps a repo path to its contents;
// paths outside planner/ are ignored. Findings describe every problem found,
// so one run reports them all.
export function parsePlanner(files: Record<string, string>): {
    planner: Planner;
    findings: PlannerFinding[];
} {
    const findings: PlannerFinding[] = [];
    const projects: Project[] = [];
    const items: Item[] = [];
    const inbox: string[] = [];
    let retired: Retired[] = [];
    const fail = (path: string, message: string) =>
        findings.push({ rule: "planner", message: `${path}: ${message}` });

    const paths = Object.keys(files)
        .filter((p) => p.startsWith(`${PLANNER_DIR}/`))
        .sort();

    for (const path of paths) {
        const parts = path.split("/");
        if (parts.length === 2) {
            if (parts[1] === RETIRED_FILE) {
                retired = parseRetired(path, files[path], fail);
            } else if (parts[1] !== "README.md") {
                fail(
                    path,
                    `only README.md and ${RETIRED_FILE} sit directly in ${PLANNER_DIR}/`,
                );
            }
            continue;
        }
        if (parts.length !== 3) {
            fail(
                path,
                `files go one level deep: ${PLANNER_DIR}/<project>/<file>.md`,
            );
            continue;
        }
        const [, dir, file] = parts;
        if (!file.endsWith(".md")) {
            fail(path, "only Markdown files belong in a project folder");
            continue;
        }
        const parsed = splitFrontmatter(files[path]);
        if ("error" in parsed) {
            fail(path, parsed.error);
            continue;
        }
        if (!isRecord(parsed.data)) {
            fail(path, "frontmatter must be a mapping of fields");
            continue;
        }
        const data = parsed.data;

        if (dir === INBOX_DIR) {
            if (!SLUG_PATTERN.test(file.slice(0, -3))) {
                fail(path, "inbox file names are lowercase-with-dashes.md");
            }
            const extra = unknownKeys(data, INBOX_KEYS);
            if (extra.length > 0) {
                fail(
                    path,
                    `inbox ideas only have a title; remove ${extra.join(", ")} (give it an ID by moving it into a project)`,
                );
            }
            if (!nonEmptyString(data.title)) fail(path, "title is required");
            else inbox.push(data.title);
            continue;
        }

        if (!SLUG_PATTERN.test(dir)) {
            fail(path, "project folders are lowercase-with-dashes");
            continue;
        }

        if (file === PROJECT_FILE) {
            const extra = unknownKeys(data, PROJECT_KEYS);
            if (extra.length > 0)
                fail(path, `unknown fields: ${extra.join(", ")}`);
            if (typeof data.key !== "string" || !KEY_PATTERN.test(data.key)) {
                fail(path, "key must be 2–5 capital letters (the ID prefix)");
                continue;
            }
            if (!nonEmptyString(data.name)) fail(path, "name is required");
            if (
                data.plan !== undefined &&
                data.plan !== null &&
                !nonEmptyString(data.plan)
            ) {
                fail(path, "plan must be a repo path or null");
            }
            projects.push({
                path,
                dir,
                key: data.key,
                name: nonEmptyString(data.name) ? data.name : dir,
                plan: nonEmptyString(data.plan) ? data.plan : null,
            });
            continue;
        }

        const fileMatch = ITEM_FILE_PATTERN.exec(file);
        if (!fileMatch) {
            fail(
                path,
                "item files are named <ID>-<slug>.md, for example CAL-2-goals-resolver.md",
            );
            continue;
        }

        const extra = unknownKeys(data, ITEM_KEYS);
        if (extra.length > 0) fail(path, `unknown fields: ${extra.join(", ")}`);

        let ok = true;
        const bad = (message: string) => {
            ok = false;
            fail(path, message);
        };
        if (typeof data.id !== "string" || !ID_PATTERN.test(data.id)) {
            bad("id must look like CAL-2");
        } else if (data.id !== fileMatch[1]) {
            bad(`id ${data.id} does not match the file name (${fileMatch[1]})`);
        }
        if (!nonEmptyString(data.title)) bad("title is required");
        if (!oneOf(STATUSES, data.status))
            bad(`status must be one of ${STATUSES.join(", ")}`);
        if (!oneOf(PRIORITIES, data.priority))
            bad(`priority must be one of ${PRIORITIES.join(", ")}`);
        if (!oneOf(SIZES, data.size))
            bad(`size must be one of ${SIZES.join(", ")}`);
        if (!oneOf(ITEM_TYPES, data.type))
            bad(`type must be one of ${ITEM_TYPES.join(", ")}`);

        const areas = stringList(data.areas);
        if (areas === null || areas.length < 1 || areas.length > 2) {
            bad("areas must list one or two areas");
        } else {
            const unknown = areas.filter((a) => !oneOf(AREAS, a));
            if (unknown.length > 0)
                bad(
                    `unknown areas: ${unknown.join(", ")} (allowed: ${AREAS.join(", ")})`,
                );
            if (new Set(areas).size !== areas.length) bad("areas repeat");
        }

        const after = stringList(data.after);
        if (after === null) bad("after must be a list of item IDs");
        else if (after.some((a) => !ID_PATTERN.test(a)))
            bad("after must list item IDs like CAL-1");

        if (
            data.plan !== undefined &&
            data.plan !== null &&
            !nonEmptyString(data.plan)
        ) {
            bad("plan must be a repo path or null");
        }

        let prs: number[] = [];
        if (data.prs === undefined || data.prs === null) {
            prs = [];
        } else if (!Array.isArray(data.prs) || !data.prs.every(isPrNumber)) {
            bad("prs must be a list of pull request numbers, like [190]");
        } else {
            prs = data.prs as number[];
            if (new Set(prs).size !== prs.length) bad("prs repeat");
        }

        if (data.status === "done" && prs.length === 0) {
            bad("a done item names the PR that shipped it in prs");
        }

        if (!ok) continue;
        items.push({
            path,
            project: dir,
            id: data.id as string,
            title: (data.title as string).trim(),
            status: data.status as Status,
            priority: data.priority as Priority,
            size: data.size as Size,
            type: data.type as ItemType,
            areas: areas as Area[],
            after: after as string[],
            plan: nonEmptyString(data.plan) ? data.plan : null,
            prs,
        });
    }

    // Cross-file rules.
    const retiredKeys = new Map<string, number>();
    for (const r of retired) {
        if (retiredKeys.has(r.key)) {
            fail(`${PLANNER_DIR}/${RETIRED_FILE}`, `${r.key} is retired twice`);
        }
        retiredKeys.set(r.key, r.retiredBy);
    }

    const projectByDir = new Map<string, Project>();
    const keys = new Map<string, string>();
    for (const project of projects) {
        projectByDir.set(project.dir, project);
        const other = keys.get(project.key);
        if (other)
            fail(
                project.path,
                `key ${project.key} is already used by ${other}`,
            );
        if (retiredKeys.has(project.key)) {
            fail(
                project.path,
                `key ${project.key} was retired in #${retiredKeys.get(project.key)} and is never reused; pick another`,
            );
        }
        keys.set(project.key, project.path);
    }

    const ids = new Map<string, string>();
    for (const item of items) {
        const project = projectByDir.get(item.project);
        if (!project) {
            fail(
                item.path,
                `${PLANNER_DIR}/${item.project}/ has no ${PROJECT_FILE}`,
            );
        } else if (!item.id.startsWith(`${project.key}-`)) {
            fail(
                item.path,
                `IDs in ${PLANNER_DIR}/${item.project}/ start with ${project.key}-`,
            );
        }
        const other = ids.get(item.id);
        if (other) fail(item.path, `ID ${item.id} is also used by ${other}`);
        ids.set(item.id, item.path);
    }

    for (const item of items) {
        for (const dep of item.after) {
            if (dep === item.id)
                fail(item.path, "an item cannot come after itself");
            else if (ids.has(dep)) continue;
            // An item in a retired project is finished by definition.
            else if (retiredKeys.has(dep.split("-")[0])) continue;
            else fail(item.path, `after names ${dep}, which does not exist`);
        }
    }
    for (const cycle of findCycles(items)) {
        findings.push({
            rule: "planner",
            message: `after: dependency cycle ${cycle.join(" → ")}`,
        });
    }

    // A project with nothing left to do must be retired, so the folder only
    // ever shows open work.
    for (const project of projects) {
        const own = items.filter((i) => i.project === project.dir);
        if (own.length > 0 && own.every((i) => isFinished(i.status))) {
            fail(
                project.path,
                `every ${project.key} item is done or dropped: remove ${PLANNER_DIR}/${project.dir}/ and retire ${project.key} in ${PLANNER_DIR}/${RETIRED_FILE} (bun run planner --close does both)`,
            );
        }
    }

    items.sort(compareIds);
    return { planner: { projects, items, inbox, retired }, findings };
}

function findCycles(items: Item[]): string[][] {
    const byId = new Map(items.map((i) => [i.id, i]));
    const state = new Map<string, "visiting" | "done">();
    const cycles: string[][] = [];
    const visit = (id: string, stack: string[]) => {
        if (state.get(id) === "done") return;
        if (state.get(id) === "visiting") {
            cycles.push([...stack.slice(stack.indexOf(id)), id]);
            return;
        }
        state.set(id, "visiting");
        for (const dep of byId.get(id)?.after ?? []) {
            if (byId.has(dep)) visit(dep, [...stack, id]);
        }
        state.set(id, "done");
    };
    for (const item of [...items].sort(compareIds)) visit(item.id, []);
    return cycles;
}

export function compareIds(a: { id: string }, b: { id: string }): number {
    const [, pa, na] = ID_PATTERN.exec(a.id) ?? ["", a.id, "0"];
    const [, pb, nb] = ID_PATTERN.exec(b.id) ?? ["", b.id, "0"];
    if (pa !== pb) return pa < pb ? -1 : 1;
    return Number(na) - Number(nb);
}

// Whether an `after` dependency no longer blocks: its item is finished, or its
// project was retired (every item in it was finished).
export function dependencySettled(planner: Planner, id: string): boolean {
    const item = planner.items.find((i) => i.id === id);
    if (item) return isFinished(item.status);
    return planner.retired.some((r) => r.key === id.split("-")[0]);
}

// Open items whose `after` items are all settled, most important first:
// priority, then items already being worked on, then smaller sizes, then ID.
export function nextItems(planner: Planner): Item[] {
    return planner.items
        .filter(
            (i) =>
                !isFinished(i.status) &&
                i.after.every((dep) => dependencySettled(planner, dep)),
        )
        .sort((a, b) => {
            const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if (p !== 0) return p;
            const d =
                Number(b.status === "doing") - Number(a.status === "doing");
            if (d !== 0) return d;
            const s = SIZES.indexOf(a.size) - SIZES.indexOf(b.size);
            if (s !== 0) return s;
            return compareIds(a, b);
        });
}

// ---------------------------------------------------------------------------
// The PR check.

export type PlannerDeclaration = {
    none: boolean;
    closes: string[];
    partOf: string[];
};

// Reads the "## Planner" section. Accepted lines (one or more, any order):
//   None.
//   Closes CAL-2
//   Closes CAL-2, CAL-3
//   Part of PG-5
// HTML comments are ignored, so the template can carry its own hint.
export function parsePlannerSection(
    section: string | undefined,
): PlannerDeclaration | { error: string } {
    if (section === undefined) {
        return {
            error: "Missing ## Planner section (Closes <ID>, Part of <ID>, or None.)",
        };
    }
    const text = section.replace(/<!--[\s\S]*?-->/g, "");
    const lines = text
        .split("\n")
        .map((l) => l.trim().replace(/^[-*]\s+/, ""))
        .filter((l) => l.length > 0);
    if (lines.length === 0) {
        return {
            error: "## Planner must say Closes <ID>, Part of <ID>, or None.",
        };
    }
    const out: PlannerDeclaration = { none: false, closes: [], partOf: [] };
    for (const line of lines) {
        if (/^none\.?$/i.test(line)) {
            out.none = true;
            continue;
        }
        const m = /^(closes|part of)\s+(.+?)\.?$/i.exec(line);
        if (!m) {
            return {
                error: `## Planner: cannot read "${line}" (use Closes <ID>, Part of <ID>, or None.)`,
            };
        }
        const ids = m[2].split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim());
        for (const id of ids) {
            if (!ID_PATTERN.test(id)) {
                return {
                    error: `## Planner: "${id}" is not an item ID like CAL-2`,
                };
            }
        }
        (m[1].toLowerCase() === "closes" ? out.closes : out.partOf).push(
            ...ids,
        );
    }
    if (out.none && (out.closes.length > 0 || out.partOf.length > 0)) {
        return { error: "## Planner says None. and also names items" };
    }
    const both = out.closes.filter((id) => out.partOf.includes(id));
    if (both.length > 0) {
        return {
            error: `## Planner names ${both.join(", ")} under both Closes and Part of`,
        };
    }
    const byId = (a: string, b: string) => compareIds({ id: a }, { id: b });
    out.closes = [...new Set(out.closes)].sort(byId);
    out.partOf = [...new Set(out.partOf)].sort(byId);
    return out;
}

// `base` is the planner on the target branch, `head` the planner the PR would
// merge. `prNumber` is this pull request's number.
export function checkPlannerPr(input: {
    section: string | undefined;
    base: Planner;
    head: Planner;
    prNumber: number;
}): PlannerFinding[] {
    const findings: PlannerFinding[] = [];
    const fail = (message: string) =>
        findings.push({ rule: "planner", message });

    const declared = parsePlannerSection(input.section);
    if ("error" in declared) {
        fail(declared.error);
        return findings;
    }

    const { base, head } = input;
    const pr = input.prNumber;
    const baseById = new Map(base.items.map((i) => [i.id, i]));
    const headById = new Map(head.items.map((i) => [i.id, i]));
    const headRetired = new Map(head.retired.map((r) => [r.key, r]));
    const baseRetiredKeys = new Set(base.retired.map((r) => r.key));
    const headDirs = new Set(head.projects.map((p) => p.dir));

    // retired.yml is append-only.
    for (const r of base.retired) {
        const now = headRetired.get(r.key);
        if (!now || now.retiredBy !== r.retiredBy || now.name !== r.name) {
            fail(
                `${PLANNER_DIR}/${RETIRED_FILE}: the entry for ${r.key} was changed or removed; retired entries stay as they are`,
            );
        }
    }

    // Keys this PR retires: their folders must be gone, recorded with this
    // PR's number, and every item in them finished before or by this PR.
    const retiring = new Set<string>();
    for (const r of head.retired) {
        if (baseRetiredKeys.has(r.key)) continue;
        retiring.add(r.key);
        if (r.retiredBy !== pr) {
            fail(
                `${PLANNER_DIR}/${RETIRED_FILE}: ${r.key} is retired by this PR, so retired_by is ${pr}`,
            );
        }
        const project = base.projects.find((p) => p.key === r.key);
        if (!project) {
            fail(
                `${PLANNER_DIR}/${RETIRED_FILE}: ${r.key} is not a project on the base branch`,
            );
            continue;
        }
        if (headDirs.has(project.dir)) {
            fail(
                `${r.key} is retired, so remove ${PLANNER_DIR}/${project.dir}/`,
            );
        }
        for (const item of base.items.filter(
            (i) => i.project === project.dir,
        )) {
            if (
                !isFinished(item.status) &&
                !declared.closes.includes(item.id)
            ) {
                fail(
                    `${r.key} is retired, but ${item.id} was still open; close it in this PR (Closes ${item.id}) or set status: dropped first`,
                );
            }
        }
    }

    // A project folder disappears only by being retired.
    for (const project of base.projects) {
        if (!headDirs.has(project.dir) && !retiring.has(project.key)) {
            fail(
                `${PLANNER_DIR}/${project.dir}/ was removed; a project is removed only by retiring ${project.key} in ${PLANNER_DIR}/${RETIRED_FILE}`,
            );
        }
    }

    const inRetiringProject = (id: string) =>
        retiring.has(id.split("-")[0]) && baseById.has(id);

    // History is append-only: an item never disappears except with its
    // retired project, and a recorded PR number stays.
    for (const before of base.items) {
        const after = headById.get(before.id);
        if (!after) {
            if (!inRetiringProject(before.id)) {
                fail(
                    `${before.id} was removed; set status: dropped instead, so its ID is never reused`,
                );
            }
            continue;
        }
        const lost = before.prs.filter((n) => !after.prs.includes(n));
        if (lost.length > 0) {
            fail(
                `${before.id}: prs lost ${lost.map((n) => `#${n}`).join(", ")}; recorded PRs stay`,
            );
        }
    }

    for (const id of declared.closes) {
        const item = headById.get(id);
        const before = baseById.get(id);
        if (before?.status === "done") {
            fail(`Closes ${id}: it was already done before this PR`);
        }
        if (!item) {
            // Closing the last item retires the project, so its file goes with
            // the folder in the same PR.
            if (!inRetiringProject(id)) fail(`Closes ${id}: no such item`);
            continue;
        }
        if (item.status !== "done") {
            fail(`Closes ${id}: set status: done in ${item.path}`);
        }
        if (!item.prs.includes(pr)) {
            fail(`Closes ${id}: add ${pr} to prs in ${item.path}`);
        }
    }

    for (const id of declared.partOf) {
        const item = headById.get(id);
        if (!item) {
            fail(`Part of ${id}: no such item`);
            continue;
        }
        if (item.status !== "doing") {
            fail(
                `Part of ${id}: set status: doing in ${item.path} (use Closes ${id} if this PR finishes it)`,
            );
        }
        if (!item.prs.includes(pr)) {
            fail(`Part of ${id}: add ${pr} to prs in ${item.path}`);
        }
    }

    const declaredIds = new Set([...declared.closes, ...declared.partOf]);
    for (const item of head.items) {
        const before = baseById.get(item.id);
        // An item becoming done must be closed by this PR. A brand-new item may
        // be added as done to record work that already shipped elsewhere.
        if (
            before &&
            before.status !== "done" &&
            item.status === "done" &&
            !declared.closes.includes(item.id)
        ) {
            fail(
                `${item.id} is marked done, but ## Planner does not say Closes ${item.id}`,
            );
        }
        const added = item.prs.filter((n) => !(before?.prs ?? []).includes(n));
        if (added.includes(pr) && !declaredIds.has(item.id)) {
            fail(
                `${item.id} records #${pr}, but ## Planner does not name ${item.id}`,
            );
        }
    }

    return findings;
}
