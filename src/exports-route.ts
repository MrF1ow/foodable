import { Hono } from "hono";
import { verifyExportToken } from "./domain/export-link.js";
import {
    liveExportArchiveStore,
    type ExportArchiveStore,
} from "./db/exports.js";
import { rateLimitAuth } from "./middleware.js";
import { resolveSessionSigningSecret } from "./site-session.js";

/** Same body for every failure so callers cannot probe token validity. */
export const EXPORT_DOWNLOAD_NOT_FOUND = "Not found";

const NOT_FOUND_HEADERS = {
    "Content-Type": "text/plain; charset=utf-8",
} as const;

export function createExportsRouter(
    store: ExportArchiveStore = liveExportArchiveStore(),
): Hono {
    const router = new Hono();

    router.get("/exports/:token", rateLimitAuth, async (c) => {
        const userId = verifyExportToken(
            c.req.param("token"),
            Date.now(),
            resolveSessionSigningSecret(),
        );
        if (!userId) {
            return c.body(EXPORT_DOWNLOAD_NOT_FOUND, 404, NOT_FOUND_HEADERS);
        }

        const archive = await store.read(userId);
        if (!archive) {
            return c.body(EXPORT_DOWNLOAD_NOT_FOUND, 404, NOT_FOUND_HEADERS);
        }

        return c.body(archive, 200, {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="foodable-export.zip"',
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex",
        });
    });

    return router;
}
