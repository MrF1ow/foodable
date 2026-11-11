import type {
    DuplicateMerge,
    DuplicateSkip,
    Food,
    FoodsStore,
} from "./foods.js";
import { duplicatePairs } from "./foods.js";

export type MergeJobDeps = {
    listHouseholdIds(): Promise<string[]>;
    store: FoodsStore;
    merge(householdId: string, keepId: string, dropId: string): Promise<Food>;
};

export type MergeJobResult =
    { status: "merged" } | { status: "failed"; error: string };

export type MergeJobHouseholdReport = {
    householdId: string;
    /** The household treats singular and plural names as one food. */
    pluralsSameFood: boolean;
    merges: (DuplicateMerge & { result?: MergeJobResult })[];
    skipped: DuplicateSkip[];
};

export type MergeJobReport = {
    mode: "dry-run" | "apply";
    households: MergeJobHouseholdReport[];
    mergedCount: number;
    failedCount: number;
    skippedCount: number;
};

export async function runMergeJob(
    deps: MergeJobDeps,
    opts: { apply: boolean },
): Promise<MergeJobReport> {
    const householdIds = await deps.listHouseholdIds();
    const households: MergeJobHouseholdReport[] = [];
    let mergedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const householdId of householdIds) {
        const foods = await deps.store.listFoods(householdId);
        const refs = await deps.store.countFoodRefs(householdId);
        const allAliases = await deps.store.listAllAliases(householdId);
        // Plural pairs ("Egg" / "Eggs") are duplicates only where the
        // household has said singular and plural are the same food.
        const pluralsSameFood =
            (await deps.store.pluralsSameFood?.(householdId)) ?? false;
        const pairs = duplicatePairs(foods, refs, allAliases, {
            plurals: pluralsSameFood,
        });
        const merges: MergeJobHouseholdReport["merges"] = [];

        if (opts.apply) {
            for (const m of pairs.merges) {
                try {
                    await deps.merge(householdId, m.keep.id, m.drop.id);
                    merges.push({ ...m, result: { status: "merged" } });
                    mergedCount++;
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    merges.push({
                        ...m,
                        result: { status: "failed", error: message },
                    });
                    failedCount++;
                }
            }
        } else {
            merges.push(...pairs.merges);
        }

        skippedCount += pairs.skipped.length;
        households.push({
            householdId,
            pluralsSameFood,
            merges,
            skipped: pairs.skipped,
        });
    }

    return {
        mode: opts.apply ? "apply" : "dry-run",
        households,
        mergedCount,
        failedCount,
        skippedCount,
    };
}

function formatFoodLabel(name: string, brand: string | null): string {
    // JSON string quoting escapes quotes, backslashes and control characters.
    const quoted = JSON.stringify(name);
    if (brand == null) return quoted;
    return `${quoted} (${brand})`;
}

export function formatMergeJobReport(report: MergeJobReport): string {
    const lines: string[] = [];
    if (report.mode === "dry-run") {
        lines.push(
            "DRY RUN — nothing was written. Re-run with --apply to merge.",
        );
    } else {
        lines.push("APPLY");
    }
    lines.push("");

    let anyMergeOrSkip = false;
    for (const h of report.households) {
        const n = h.merges.length;
        const m = h.skipped.length;
        if (n === 0 && m === 0) continue;
        anyMergeOrSkip = true;
        const plurals = h.pluralsSameFood
            ? " (singular and plural are one food)"
            : "";
        lines.push(
            `Household ${h.householdId}${plurals}: ${n} to merge, ${m} skipped`,
        );
        for (const merge of h.merges) {
            lines.push(
                `KEEP ${formatFoodLabel(merge.keep.name, merge.keep.brand)} ${merge.keep.id} — ${merge.reason}`,
            );
            lines.push(
                `  drop ${formatFoodLabel(merge.drop.name, merge.drop.brand)} ${merge.drop.id} (${merge.drop.references} references)`,
            );
            const fills =
                merge.fieldsFilled.length === 0
                    ? "nothing"
                    : merge.fieldsFilled.join(", ");
            lines.push(`  fills: ${fills}`);
            if (merge.result) {
                if (merge.result.status === "merged") {
                    lines.push("  result: merged");
                } else {
                    lines.push(`  result: failed — ${merge.result.error}`);
                }
            }
        }
        if (h.skipped.length > 0) {
            lines.push("Skipped");
            for (const s of h.skipped) {
                lines.push(
                    `${formatFoodLabel(s.keep.name, s.keep.brand)} / ${formatFoodLabel(s.drop.name, s.drop.brand)}: ${s.reason}`,
                );
            }
        }
        lines.push("");
    }

    if (!anyMergeOrSkip) {
        lines.push("Nothing to merge.");
        lines.push("");
    }

    lines.push(
        `Summary: merged ${report.mergedCount}, failed ${report.failedCount}, skipped ${report.skippedCount}.`,
    );
    return lines.join("\n");
}

export const MERGE_JOB_USAGE = `Usage: bun run scripts/merge-duplicate-foods.ts [--dry-run] [--apply] [--json] [--help]

  --dry-run   Plan merges only (default)
  --apply     Execute merges
  --json      Print JSON report
  --help      Show this message`;

export type ParsedMergeJobCli =
    | { ok: true; apply: boolean; json: boolean; help: boolean }
    | { ok: false; message: string };

/** Argument parser for the merge-duplicate-foods script (unit-testable). */
export function parseMergeJobArgs(argv: readonly string[]): ParsedMergeJobCli {
    const allowed = new Set(["--dry-run", "--apply", "--json", "--help"]);
    for (const arg of argv) {
        if (arg.startsWith("-") && !allowed.has(arg)) {
            return {
                ok: false,
                message: `${MERGE_JOB_USAGE}\n\nUnknown flag: ${arg}`,
            };
        }
    }
    const hasApply = argv.includes("--apply");
    const hasDryRun = argv.includes("--dry-run");
    if (hasApply && hasDryRun) {
        return {
            ok: false,
            message: `${MERGE_JOB_USAGE}\n\n--apply and --dry-run together are not allowed.`,
        };
    }
    return {
        ok: true,
        apply: hasApply,
        json: argv.includes("--json"),
        help: argv.includes("--help"),
    };
}
