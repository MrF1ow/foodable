import { getSupabase } from "./client.js";

export async function selectFoodCacheRow(
    source: string,
    sourceId: string,
): Promise<{ payload: unknown; fetched_at: string } | null> {
    const { data, error } = await getSupabase()
        .from("food_cache")
        .select("payload, fetched_at")
        .eq("source", source)
        .eq("source_id", sourceId)
        .maybeSingle();
    if (error || !data) return null;
    return data;
}

export async function upsertFoodCacheRow(row: {
    source: string;
    source_id: string;
    payload: unknown;
    fetched_at: string;
}): Promise<void> {
    await getSupabase()
        .from("food_cache")
        .upsert(row, { onConflict: "source,source_id" });
}

export async function selectFoodCacheRowsBySource(
    source: string,
): Promise<{ payload: unknown; fetched_at: string }[]> {
    const { data, error } = await getSupabase()
        .from("food_cache")
        .select("payload, fetched_at")
        .eq("source", source);
    if (error || !data) return [];
    return data;
}
