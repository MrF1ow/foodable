import { closeSql, getSql, rows, run } from "../src/db/sql.js";
import { liveFoodsStore, mergeLiveFoods } from "../src/db/foods.js";
import {
    formatMergeJobReport,
    parseMergeJobArgs,
    runMergeJob,
    MERGE_JOB_USAGE,
} from "../src/domain/food-merge-job.js";

async function listHouseholdIds(): Promise<string[]> {
    return run(async (tx) => {
        const data = await rows<{ id: string }>(
            tx,
            tx`
                select id::text as id
                from public.households
                order by created_at asc, id asc
            `,
        );
        return data.map((r) => r.id);
    });
}

async function main() {
    const parsed = parseMergeJobArgs(process.argv.slice(2));
    if (!parsed.ok) {
        console.error(parsed.message);
        process.exit(2);
    }
    if (parsed.help) {
        console.log(MERGE_JOB_USAGE);
        process.exit(0);
    }

    const url = process.env.DATABASE_URL;
    if (!url?.trim()) {
        console.error("DATABASE_URL is not set");
        process.exit(1);
    }

    getSql();
    let exitCode = 0;
    try {
        const report = await runMergeJob(
            {
                listHouseholdIds,
                store: liveFoodsStore(),
                merge: (householdId, keepId, dropId) =>
                    mergeLiveFoods(householdId, keepId, dropId),
            },
            { apply: parsed.apply },
        );

        if (parsed.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(formatMergeJobReport(report));
        }

        exitCode = report.failedCount > 0 ? 1 : 0;
    } finally {
        await closeSql();
    }
    process.exit(exitCode);
}

if (import.meta.main) {
    await main();
}
