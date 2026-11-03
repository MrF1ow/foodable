import type { AnalyticsRecord } from "../analytics.js";
import { definedColumns, run } from "./sql.js";

const TOOL_ANALYTICS = "tool_analytics";

export function insertToolAnalytics(record: AnalyticsRecord): void {
    run(async (tx) => {
        const { row, keys } = definedColumns(
            record as unknown as Record<string, unknown>,
        );
        await tx`
            insert into ${tx.unsafe(TOOL_ANALYTICS)} ${tx(
                row,
                ...(keys as [string, ...string[]]),
            )}
        `;
    }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
            `Failed to persist analytics for ${record.tool_name}:`,
            message,
        );
    });
}
