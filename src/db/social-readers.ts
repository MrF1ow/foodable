import type {
    SocialReaderId,
    SocialReaderStatusRow,
    SocialReaderStatusStore,
} from "../domain/social-readers.js";
import { createMemorySocialReaderStatusStore } from "../domain/social-readers.js";
import { rows, run } from "./sql.js";

// Per instance by design: lazy Postgres adapter handle; no cached reader status in memory.
let liveStore: SocialReaderStatusStore | null = null;

export function liveSocialReaderStatusStore(): SocialReaderStatusStore {
    if (!liveStore) liveStore = createPostgresSocialReaderStatusStore();
    return liveStore;
}

export function setSocialReaderStatusStoreForTests(
    store: SocialReaderStatusStore | null,
): void {
    liveStore = store;
}

function rowFromDb(row: Record<string, unknown>): SocialReaderStatusRow {
    return {
        reader: String(row.reader) as SocialReaderId,
        lastSuccessAt:
            row.last_success_at == null ? null : String(row.last_success_at),
        lastFailureAt:
            row.last_failure_at == null ? null : String(row.last_failure_at),
        lastFailureReason:
            row.last_failure_reason == null
                ? null
                : String(row.last_failure_reason),
    };
}

function createPostgresSocialReaderStatusStore(): SocialReaderStatusStore {
    return {
        async get(householdId) {
            return run(async (tx) => {
                const data = await rows(
                    tx,
                    tx`
                        select
                            reader,
                            last_success_at,
                            last_failure_at,
                            last_failure_reason
                        from public.social_reader_status
                        where household_id = ${householdId}
                    `,
                );
                const byReader = new Map(
                    data.map((row: Record<string, unknown>) => [
                        String(row.reader),
                        rowFromDb(row),
                    ]),
                );
                return (["tiktok", "facebook"] as const).map(
                    (reader) =>
                        byReader.get(reader) ?? {
                            reader,
                            lastSuccessAt: null,
                            lastFailureAt: null,
                            lastFailureReason: null,
                        },
                );
            });
        },
        async recordSuccess(householdId, reader, at) {
            await run(async (tx) => {
                await tx`
                    insert into public.social_reader_status (
                        household_id,
                        reader,
                        last_success_at
                    )
                    values (
                        ${householdId},
                        ${reader},
                        ${at.toISOString()}
                    )
                    on conflict (household_id, reader) do update
                    set last_success_at = excluded.last_success_at
                `;
            });
        },
        async recordFailure(householdId, reader, at, reason) {
            await run(async (tx) => {
                await tx`
                    insert into public.social_reader_status (
                        household_id,
                        reader,
                        last_failure_at,
                        last_failure_reason
                    )
                    values (
                        ${householdId},
                        ${reader},
                        ${at.toISOString()},
                        ${reason}
                    )
                    on conflict (household_id, reader) do update
                    set
                        last_failure_at = excluded.last_failure_at,
                        last_failure_reason = excluded.last_failure_reason
                `;
            });
        },
    };
}

export { createMemorySocialReaderStatusStore };
