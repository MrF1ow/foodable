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

function scopeArg(projectId: string): string {
    return `project:${projectId}`;
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
    projectId: string,
    withType: boolean,
): string[] {
    const argv = ["railway", "flag", "set", name, String(value)];
    if (withType) {
        argv.push("--type", flagType(name));
    }
    argv.push("--scope", scopeArg(projectId));
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
    projectId: string,
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
                    "--scope",
                    scopeArg(projectId),
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
                    "--scope",
                    scopeArg(projectId),
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
                "--scope",
                scopeArg(projectId),
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

async function fetchRailwayState(projectId: string): Promise<RailwayFlag[]> {
    const proc = Bun.spawn({
        cmd: [
            "railway",
            "flag",
            "list",
            "--json",
            "--scope",
            scopeArg(projectId),
        ],
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
    const projectId =
        flag("--project") ??
        process.env.RAILWAY_PROJECT_ID ??
        DEFAULT_RAILWAY_PROJECT_ID;

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
