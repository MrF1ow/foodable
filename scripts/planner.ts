// Reading:
//   bun run planner                  open items, grouped by project
//   bun run planner --next           what to work on next: open, unblocked, ranked
//   bun run planner --all            include done and dropped items
//   bun run planner --project CAL    one project (key or folder name)
//   bun run planner --new CAL        the next free ID in a project, and its file name
//   bun run planner --check          validate every file; exit 1 on any problem
//
// Writing (in the PR that does the work, once the PR is open):
//   bun run planner --start CAL-2 --pr 250   status: doing, add 250 to prs
//   bun run planner --close CAL-2 --pr 250   status: done, add 250 to prs; when
//       that was the project's last open item, also delete the project folder,
//       retire its key in planner/retired.yml, and move its ROADMAP.md row
//       from Projects to Shipped
//
// Output is plain, compact text so an agent can read the whole planner cheaply.
import { rm } from "fs/promises";
import { join } from "path";
import {
    dependencySettled,
    isFinished,
    nextItems,
    parsePlanner,
    PLANNER_DIR,
    RETIRED_FILE,
    type Item,
} from "./conventions/planner.ts";
import { readPlannerTree } from "./planner-load.ts";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const die = (message: string): never => {
    console.error(message);
    process.exit(1);
};

const { planner, findings } = parsePlanner(await readPlannerTree());

// --start / --close edit files, so they run before the read-only views.
const startId = value("--start");
const closeId = value("--close");
if (startId || closeId) {
    const id = (startId ?? closeId) as string;
    const pr = Number(value("--pr"));
    if (!Number.isInteger(pr) || pr <= 0)
        die("pass the pull request number: --pr <number>");
    const item = planner.items.find((i) => i.id === id);
    if (!item) die(`no open item ${id}`);
    await setStatus(item!, closeId ? "done" : "doing", pr);
    console.log(`${id}: status ${closeId ? "done" : "doing"}, prs +#${pr}`);

    if (closeId) {
        const project = planner.projects.find((p) => p.dir === item!.project)!;
        const rest = planner.items.filter(
            (i) => i.project === project.dir && i.id !== id,
        );
        if (rest.every((i) => isFinished(i.status))) {
            await retire(project.dir, project.key, project.name, pr);
            console.log(
                `${project.key} is finished: removed ${PLANNER_DIR}/${project.dir}/, retired ${project.key} in ${PLANNER_DIR}/${RETIRED_FILE}, moved it to Shipped in ROADMAP.md`,
            );
        } else {
            const open = rest.filter((i) => !isFinished(i.status)).length;
            console.log(`${project.key}: ${open} open item(s) left`);
        }
    }
    console.log(
        `PR body: ## Planner → ${closeId ? "Closes" : "Part of"} ${id}`,
    );
    process.exit(0);
}

async function setStatus(item: Item, status: "doing" | "done", pr: number) {
    const path = join(root, item.path);
    const text = await Bun.file(path).text();
    const end = text.indexOf("\n---", 4);
    let head = text.slice(0, end);
    const prs = item.prs.includes(pr) ? item.prs : [...item.prs, pr];
    head = head
        .replace(/^status: .*$/m, `status: ${status}`)
        .replace(/^prs: .*$/m, `prs: [${prs.join(", ")}]`);
    await Bun.write(path, head + text.slice(end));
}

async function retire(dir: string, key: string, name: string, pr: number) {
    await rm(join(root, PLANNER_DIR, dir), { recursive: true });

    const retiredPath = join(root, PLANNER_DIR, RETIRED_FILE);
    const file = Bun.file(retiredPath);
    const before = (await file.exists()) ? await file.text() : "";
    const entry = `- key: ${key}\n  name: ${JSON.stringify(name)}\n  retired_by: ${pr}\n`;
    await Bun.write(
        retiredPath,
        before + (before && !before.endsWith("\n") ? "\n" : "") + entry,
    );

    const roadmapPath = join(root, "ROADMAP.md");
    let roadmap = await Bun.file(roadmapPath).text();
    roadmap = roadmap
        .split("\n")
        .filter((line) => !line.includes(`](${PLANNER_DIR}/${dir}/)`))
        .join("\n");
    roadmap = roadmap.replace(
        /^## Shipped\n\n/m,
        `## Shipped\n\n- ${name} (finished in #${pr})\n`,
    );
    await Bun.write(roadmapPath, roadmap);
}

// Read-only views.

if (findings.length > 0) {
    for (const f of findings) console.error(f.message);
    if (flag("--check")) process.exit(1);
    console.error("");
}
if (flag("--check")) {
    console.log(
        `planner: ${planner.items.length} items in ${planner.projects.length} projects, ${planner.inbox.length} inbox ideas, ${planner.retired.length} retired, all valid`,
    );
    process.exit(0);
}

const row = (i: Item) => {
    const blocked = i.after.filter((a) => !dependencySettled(planner, a));
    const tail = [
        blocked.length > 0 ? `after ${blocked.join(",")}` : "",
        i.prs.length > 0 ? i.prs.map((n) => `#${n}`).join(",") : "",
    ]
        .filter(Boolean)
        .join("  ");
    return [
        i.id.padEnd(7),
        i.status.padEnd(7),
        i.priority.padEnd(6),
        i.size.padEnd(3),
        i.title,
        tail ? `  (${tail})` : "",
    ].join(" ");
};

const newKey = value("--new");
if (newKey) {
    const project = planner.projects.find(
        (p) => p.key === newKey || p.dir === newKey,
    );
    if (!project) die(`no project ${newKey}`);
    const max = planner.items
        .filter((i) => i.id.startsWith(`${project!.key}-`))
        .reduce((m, i) => Math.max(m, Number(i.id.split("-")[1])), 0);
    const id = `${project!.key}-${max + 1}`;
    console.log(`${id}  ${PLANNER_DIR}/${project!.dir}/${id}-<slug>.md`);
    process.exit(0);
}

if (flag("--next")) {
    console.log(`ID      status  pri    sz  title`);
    for (const i of nextItems(planner).slice(0, Number(value("--limit") ?? 10)))
        console.log(row(i));
    process.exit(0);
}

const only = value("--project");
const showAll = flag("--all");
for (const project of planner.projects) {
    if (only && only !== project.key && only !== project.dir) continue;
    const own = planner.items.filter((i) => i.project === project.dir);
    const shown = own.filter((i) => showAll || !isFinished(i.status));
    const done = own.filter((i) => i.status === "done").length;
    const total = own.filter((i) => i.status !== "dropped").length;
    console.log(
        `\n${project.key}  ${project.name}  (${done}/${total} done)${project.plan ? `  ${project.plan}` : ""}`,
    );
    for (const i of shown) console.log(`  ${row(i)}`);
}
if (!only && planner.inbox.length > 0) {
    console.log(`\nInbox`);
    for (const t of planner.inbox) console.log(`  - ${t}`);
}
if (!only && planner.retired.length > 0) {
    console.log(
        `\nRetired: ${planner.retired.map((r) => `${r.key} (#${r.retiredBy})`).join(", ")}`,
    );
}
