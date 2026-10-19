import { catalogByName, catalogNames } from "./conventions/labels.ts";

export type SyncPlan = {
    create: string[];
    update: string[];
    delete: string[];
};

export function planSync(
    existingNames: Iterable<string>,
    namesInCatalog: Iterable<string>,
    prune: boolean,
): SyncPlan {
    const existing = new Set(existingNames);
    const catalog = new Set(namesInCatalog);
    const create: string[] = [];
    const update: string[] = [];
    for (const name of catalog) {
        if (!existing.has(name)) {
            create.push(name);
        } else {
            update.push(name);
        }
    }
    create.sort();
    update.sort();
    const deleteList: string[] = [];
    if (prune) {
        for (const name of existing) {
            if (!catalog.has(name)) {
                deleteList.push(name);
            }
        }
        deleteList.sort();
    }
    return { create, update, delete: deleteList };
}

async function gh(args: string[]): Promise<string> {
    const proc = Bun.spawn(["gh", ...args], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    if (code !== 0) {
        throw new Error(`gh ${args.join(" ")} failed: ${err}`);
    }
    return out.trim();
}

async function listExistingNames(): Promise<string[]> {
    const raw = await gh(["label", "list", "--limit", "200", "--json", "name"]);
    const rows = JSON.parse(raw) as Array<{ name: string }>;
    return rows.map((r) => r.name);
}

async function applyPlan(plan: SyncPlan): Promise<void> {
    const byName = catalogByName();
    for (const name of plan.create) {
        const def = byName.get(name);
        if (!def) continue;
        await gh([
            "label",
            "create",
            name,
            "--color",
            def.color,
            "--description",
            def.description,
        ]);
    }
    for (const name of plan.update) {
        const def = byName.get(name);
        if (!def) continue;
        await gh([
            "label",
            "create",
            name,
            "--force",
            "--color",
            def.color,
            "--description",
            def.description,
        ]);
    }
    for (const name of plan.delete) {
        await gh(["label", "delete", name, "--yes"]);
    }
}

async function main(): Promise<void> {
    const prune = process.argv.includes("--prune");
    const existing = await listExistingNames();
    const plan = planSync(existing, catalogNames(), prune);
    await applyPlan(plan);
    console.log(
        `sync: create=${plan.create.length} update=${plan.update.length} delete=${plan.delete.length}`,
    );
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
