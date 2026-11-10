import { createHash } from "node:crypto";
import { FLAGS_EPOCH } from "../src/flags.js";
import {
    DEFAULT_ROLLOUT_PATH,
    loadRolloutFile,
    validateRolloutFile,
    type RolloutFile,
} from "../src/flags-rollout.js";

export const DEFAULT_RAILWAY_PROJECT_ID =
    "5c73bffd-c005-4e7f-8c92-57db06aed483";

export type RailwayRule = {
    id: string;
    when: string;
    value: unknown;
};

export type RailwayFlag = {
    name: string;
    type?: string;
    default?: unknown;
    rules?: unknown;
};

export type FlagChangePlan = {
    commands: string[][];
    extraInRailway: string[];
};

/**
 * `--scope project:<id>` for a logged-in CLI. Under RAILWAY_TOKEN (a project
 * token) the CLI takes the project from the token, and an explicit scope made
 * writes fail with "Unauthorized", so the caller passes null and no scope.
 */
export function scopeArgs(projectId: string | null): string[] {
    return projectId === null ? [] : ["--scope", `project:${projectId}`];
}

export function expandInternalRule(internal: unknown): string {
    const ids = Array.isArray(internal)
        ? internal.filter((id): id is string => typeof id === "string")
        : [];
    if (ids.length === 0) {
        return "false";
    }
    if (ids.length === 1) {
        return `key == "${ids[0]}"`;
    }
    return ids.map((id) => `key == "${id}"`).join(" || ");
}

export function ruleIdForExpression(expression: string): string {
    return createHash("sha256").update(expression).digest("hex").slice(0, 8);
}

export function parseRailwayRules(rules: unknown): RailwayRule[] {
    if (!Array.isArray(rules)) {
        return [];
    }
    const out: RailwayRule[] = [];
    for (const entry of rules) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const row = entry as Record<string, unknown>;
        const id = String(row.id ?? row.ruleId ?? row.rule_id ?? "").trim();
        const when = String(
            row.when ?? row.expression ?? row.condition ?? "",
        ).trim();
        const value = row.value ?? row.serve ?? true;
        if (!id && !when) {
            continue;
        }
        out.push({ id, when, value });
    }
    return out;
}

type DesiredRule = {
    ruleId: string;
    when: string;
};

function desiredRulesForFlag(
    file: RolloutFile,
    flagName: string,
    entry: { rules?: unknown },
): DesiredRule[] {
    const raw = Array.isArray(entry.rules) ? entry.rules : [];
    const out: DesiredRule[] = [];
    for (const rule of raw) {
        if (rule === "internal") {
            const when = expandInternalRule(file.internal);
            out.push({ ruleId: "internal", when });
            continue;
        }
        if (typeof rule === "string") {
            out.push({
                ruleId: ruleIdForExpression(rule),
                when: rule,
            });
        }
    }
    return out;
}

function flagType(name: string): "bool" | "number" {
    return name === FLAGS_EPOCH ? "number" : "bool";
}

function defaultArgv(
    name: string,
    value: unknown,
    projectId: string | null,
    withType: boolean,
): string[] {
    const argv = ["railway", "flag", "set", name, String(value)];
    if (withType) {
        argv.push("--type", flagType(name));
    }
    argv.push(...scopeArgs(projectId));
    return argv;
}

function valuesEqual(a: unknown, b: unknown): boolean {
    return Object.is(a, b);
}

function ruleMatches(desired: DesiredRule, actual: RailwayRule): boolean {
    return (
        actual.when === desired.when &&
        valuesEqual(actual.value, true) &&
        (actual.id === "" || actual.id === desired.ruleId)
    );
}

export function planFlagChanges(
    file: RolloutFile,
    railwayState: RailwayFlag[],
    projectId: string | null,
): FlagChangePlan {
    const commands: string[][] = [];
    const fileFlags = file.flags ?? {};
    const fileNames = new Set(Object.keys(fileFlags));
    const byName = new Map(railwayState.map((row) => [row.name, row] as const));

    const extraInRailway = railwayState
        .map((row) => row.name)
        .filter((name) => !fileNames.has(name))
        .sort();

    for (const [name, entry] of Object.entries(fileFlags)) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const def = entry.default;
        const railway = byName.get(name);
        const desiredRules = desiredRulesForFlag(file, name, entry);
        const desiredIds = new Set(desiredRules.map((r) => r.ruleId));

        if (!railway) {
            commands.push(defaultArgv(name, def, projectId, true));
            for (const rule of desiredRules) {
                commands.push([
                    "railway",
                    "flag",
                    "set",
                    name,
                    "true",
                    "--when",
                    rule.when,
                    "--rule-id",
                    rule.ruleId,
                    ...scopeArgs(projectId),
                ]);
            }
            continue;
        }

        if (!valuesEqual(railway.default, def)) {
            commands.push(defaultArgv(name, def, projectId, false));
        }

        const actualRules = parseRailwayRules(railway.rules);
        for (const actual of actualRules) {
            const matched = desiredRules.some((d) => ruleMatches(d, actual));
            const idKnown =
                actual.id !== "" &&
                (desiredIds.has(actual.id) ||
                    desiredRules.some(
                        (d) => d.when === actual.when && d.ruleId === actual.id,
                    ));
            if (!matched && !idKnown) {
                if (actual.id === "") {
                    continue;
                }
                commands.push([
                    "railway",
                    "flag",
                    "unset",
                    name,
                    "--rule-id",
                    actual.id,
                    ...scopeArgs(projectId),
                ]);
            }
        }

        for (const desired of desiredRules) {
            const actual = actualRules.find(
                (r) =>
                    r.id === desired.ruleId ||
                    (r.when === desired.when && valuesEqual(r.value, true)),
            );
            if (actual && ruleMatches(desired, actual)) {
                continue;
            }
            commands.push([
                "railway",
                "flag",
                "set",
                name,
                "true",
                "--when",
                desired.when,
                "--rule-id",
                desired.ruleId,
                ...scopeArgs(projectId),
            ]);
        }
    }

    return { commands, extraInRailway };
}

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1 || i + 1 >= process.argv.length) {
        return undefined;
    }
    return process.argv[i + 1];
}

export function parseRailwayListJson(text: string): RailwayFlag[] {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
        throw new Error("railway flag list: expected a JSON array");
    }
    return parsed as RailwayFlag[];
}

/**
 * The project to scope commands to, or null to let a project token name it.
 * An explicit --project or RAILWAY_PROJECT_ID always wins; otherwise a
 * RAILWAY_TOKEN means no scope, and a logged-in CLI gets the default project.
 */
export function resolveProjectId(opts: {
    project?: string;
    envProject?: string;
    hasProjectToken: boolean;
}): string | null {
    if (opts.project) return opts.project;
    if (opts.envProject) return opts.envProject;
    return opts.hasProjectToken ? null : DEFAULT_RAILWAY_PROJECT_ID;
}

/**
 * `railway flag set` of one flag to the value the file already gives it: a
 * real write that changes nothing, to prove the token can write.
 */
export function rewriteCommand(
    file: RolloutFile,
    name: string,
    projectId: string | null,
): string[] {
    const entry = file.flags?.[name];
    if (!entry || typeof entry !== "object") {
        throw new Error(`--rewrite: flag "${name}" is not in the rollout file`);
    }
    return defaultArgv(name, entry.default, projectId, false);
}

async function fetchRailwayState(
    projectId: string | null,
): Promise<RailwayFlag[]> {
    const proc = Bun.spawn({
        cmd: ["railway", "flag", "list", "--json", ...scopeArgs(projectId)],
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exit !== 0) {
        throw new Error(
            `railway flag list failed (${exit}): ${stderr.trim() || stdout.trim()}`,
        );
    }
    return parseRailwayListJson(stdout);
}

async function runCommands(commands: string[][]): Promise<void> {
    for (const argv of commands) {
        const proc = Bun.spawn({
            cmd: argv,
            stdout: "inherit",
            stderr: "inherit",
        });
        const exit = await proc.exited;
        if (exit !== 0) {
            throw new Error(`command failed (${exit}): ${argv.join(" ")}`);
        }
    }
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes("--dry-run");
    const check = process.argv.includes("--check");
    const rolloutPath = flag("--file") ?? DEFAULT_ROLLOUT_PATH;
    const projectId = resolveProjectId({
        project: flag("--project"),
        envProject: process.env.RAILWAY_PROJECT_ID,
        hasProjectToken: Boolean(process.env.RAILWAY_TOKEN),
    });
    const rewrite = flag("--rewrite");

    const file = await loadRolloutFile(rolloutPath);
    const errors = validateRolloutFile(file);
    if (errors.length > 0) {
        for (const err of errors) {
            console.error(err);
        }
        process.exit(1);
    }

    const railway = await fetchRailwayState(projectId);
    const plan = planFlagChanges(file, railway, projectId);
    if (rewrite !== undefined) {
        plan.commands.push(rewriteCommand(file, rewrite, projectId));
    }
    const hasWork = plan.commands.length > 0 || plan.extraInRailway.length > 0;

    if (!hasWork) {
        console.log("in sync");
        return;
    }

    for (const name of plan.extraInRailway) {
        console.log(`report: extra flag "${name}" in Railway (not deleted)`);
    }

    for (const argv of plan.commands) {
        console.log(argv.join(" "));
    }

    if (check) {
        process.exit(1);
    }

    if (!dryRun) {
        await runCommands(plan.commands);
    }
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
