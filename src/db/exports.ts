import { currentActor, runAsSystem } from "./actor.js";
import { maybeOne, run, type Tx } from "./sql.js";

export interface ExportArchiveStore {
    put(userId: string, archive: Uint8Array, ttlSeconds: number): Promise<void>;
    read(userId: string): Promise<Uint8Array | null>;
    sweepExpired(): Promise<void>;
    remove(userId: string): Promise<void>;
}

function byteaToUint8Array(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (Buffer.isBuffer(value)) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new Error("unexpected bytea type");
}

export function liveExportArchiveStore(): ExportArchiveStore {
    return {
        async put(userId, archive, ttlSeconds) {
            const expiresAt = new Date(
                Date.now() + ttlSeconds * 1000,
            ).toISOString();
            const upsert = async (tx: Tx) => {
                await tx`
                    insert into export_archives (user_id, archive, expires_at)
                    values (${userId}, ${archive}, ${expiresAt}::timestamptz)
                    on conflict (user_id) do update
                    set archive = excluded.archive,
                        created_at = now(),
                        expires_at = excluded.expires_at
                `;
            };
            const actor = currentActor();
            if (actor?.kind !== "household") {
                await run(upsert);
                return;
            }
            // The household bot token exports a member's data, but an archive
            // row belongs to its user and row level security lets only that
            // user write it. Write it as the system, for a member of the
            // token's household only.
            const householdId = actor.householdId;
            await runAsSystem("the household token exporting a member", () =>
                run(async (tx) => {
                    const member = await maybeOne(
                        tx,
                        tx`
                            select 1 as ok
                            from public.household_members
                            where household_id = ${householdId}
                              and user_id = ${userId}
                        `,
                        "load household member",
                    );
                    if (!member) {
                        throw new Error("not a household member");
                    }
                    await upsert(tx);
                }),
            );
        },

        async read(userId) {
            return run(async (tx) => {
                const rows = (await tx`
                    select archive
                    from export_archives
                    where user_id = ${userId}
                      and expires_at > now()
                `) as { archive: unknown }[];
                const row = rows[0];
                if (!row) return null;
                return byteaToUint8Array(row.archive);
            });
        },

        async sweepExpired() {
            await run(async (tx) => {
                await tx`
                    delete from export_archives
                    where expires_at < now()
                `;
            });
        },

        async remove(userId) {
            await run(async (tx) => {
                await tx`
                    delete from export_archives
                    where user_id = ${userId}
                `;
            });
        },
    };
}

export function createMemoryExportArchiveStore(): ExportArchiveStore & {
    rows: Map<string, { archive: Uint8Array; expiresAt: number }>;
} {
    const rows = new Map<string, { archive: Uint8Array; expiresAt: number }>();

    return {
        rows,

        async put(userId, archive, ttlSeconds) {
            rows.set(userId, {
                archive,
                expiresAt: Date.now() + ttlSeconds * 1000,
            });
        },

        async read(userId) {
            const entry = rows.get(userId);
            if (!entry || entry.expiresAt <= Date.now()) return null;
            return entry.archive;
        },

        async sweepExpired() {
            const now = Date.now();
            for (const [userId, entry] of rows) {
                if (entry.expiresAt <= now) rows.delete(userId);
            }
        },

        async remove(userId) {
            rows.delete(userId);
        },
    };
}
