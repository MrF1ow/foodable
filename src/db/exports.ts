import { getSupabase } from "./client.js";

export const EXPORT_BUCKET = "exports";

export interface ExportArchiveStore {
    upload(path: string, archive: Uint8Array): Promise<void>;
    signedUrl(path: string, ttlSeconds: number): Promise<string>;
    sweepOlderThan(cutoffMs: number): Promise<void>;
    remove(paths: string[]): Promise<void>;
}

export function liveExportArchiveStore(): ExportArchiveStore {
    const storage = () => getSupabase().storage.from(EXPORT_BUCKET);

    return {
        async upload(path, archive) {
            const { error: uploadErr } = await storage().upload(path, archive, {
                contentType: "application/zip",
                upsert: true,
            });
            if (uploadErr)
                throw new Error(
                    `Failed to upload export: ${uploadErr.message}`,
                );
        },

        async signedUrl(path, ttlSeconds) {
            const { data, error: signErr } = await storage().createSignedUrl(
                path,
                ttlSeconds,
            );
            if (signErr || !data)
                throw new Error(
                    `Failed to create download link: ${signErr?.message ?? "unknown error"}`,
                );
            return data.signedUrl;
        },

        async sweepOlderThan(cutoffMs) {
            const { data: folders, error: rootErr } = await storage().list("", {
                limit: 1000,
            });
            if (rootErr) {
                console.warn(
                    "Export sweep: failed to list bucket:",
                    rootErr.message,
                );
                return;
            }
            if (!folders) return;

            const stalePaths: string[] = [];
            for (const folder of folders) {
                const { data: files, error: listErr } = await storage().list(
                    folder.name,
                    { limit: 1000 },
                );
                if (listErr) {
                    console.warn(
                        `Export sweep: failed to list ${folder.name}:`,
                        listErr.message,
                    );
                    continue;
                }
                for (const file of files ?? []) {
                    const ts = file.updated_at ?? file.created_at;
                    if (ts && new Date(ts).getTime() < cutoffMs) {
                        stalePaths.push(`${folder.name}/${file.name}`);
                    }
                }
            }

            if (stalePaths.length === 0) return;
            const { error: removeErr } = await storage().remove(stalePaths);
            if (removeErr) {
                console.warn(
                    "Export sweep: failed to remove files:",
                    removeErr.message,
                );
                return;
            }
            console.log(
                `Export sweep: removed ${stalePaths.length} stale file(s).`,
            );
        },

        async remove(paths) {
            const { error: exportErr } = await storage().remove(paths);
            if (exportErr)
                throw new Error(
                    `Failed to delete exports: ${exportErr.message}`,
                );
        },
    };
}

export function createMemoryExportArchiveStore(): ExportArchiveStore & {
    files: Map<string, { archive: Uint8Array; updatedAt: number }>;
} {
    const files = new Map<string, { archive: Uint8Array; updatedAt: number }>();

    return {
        files,

        async upload(path, archive) {
            files.set(path, { archive, updatedAt: Date.now() });
        },

        async signedUrl(path, ttlSeconds) {
            if (!files.has(path)) {
                throw new Error(
                    `Failed to create download link: Object not found`,
                );
            }
            return `memory://exports/${path}?ttl=${ttlSeconds}`;
        },

        async sweepOlderThan(cutoffMs) {
            for (const [path, entry] of files) {
                if (entry.updatedAt < cutoffMs) files.delete(path);
            }
        },

        async remove(paths) {
            for (const path of paths) {
                files.delete(path);
            }
        },
    };
}
