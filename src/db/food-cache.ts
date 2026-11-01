import { maybeOne, rows, run } from "./sql.js";

const FOOD_CACHE = "food_cache";

export async function selectFoodCacheRow(
    source: string,
    sourceId: string,
): Promise<{ payload: unknown; fetched_at: string } | null> {
    try {
        return await run(async (tx) => {
            return await maybeOne<{ payload: unknown; fetched_at: string }>(
                tx,
                tx`
                    select payload, fetched_at
                    from ${tx.unsafe(FOOD_CACHE)}
                    where source = ${source}
                      and source_id = ${sourceId}
                `,
                "load food cache row",
            );
        });
    } catch {
        return null;
    }
}

export async function upsertFoodCacheRow(row: {
    source: string;
    source_id: string;
    payload: unknown;
    fetched_at: string;
}): Promise<void> {
    await run(async (tx) => {
        await tx`
            insert into ${tx.unsafe(FOOD_CACHE)} (
                source,
                source_id,
                payload,
                fetched_at
            )
            values (
                ${row.source},
                ${row.source_id},
                ${JSON.stringify(row.payload)}::jsonb,
                ${row.fetched_at}
            )
            on conflict (source, source_id) do update set
                payload = excluded.payload,
                fetched_at = excluded.fetched_at
        `;
    });
}

export async function selectFoodCacheRowsBySource(
    source: string,
): Promise<{ payload: unknown; fetched_at: string }[]> {
    try {
        return await run(async (tx) => {
            return await rows<{ payload: unknown; fetched_at: string }>(
                tx,
                tx`
                    select payload, fetched_at
                    from ${tx.unsafe(FOOD_CACHE)}
                    where source = ${source}
                `,
            );
        });
    } catch {
        return [];
    }
}
