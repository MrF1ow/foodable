import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { signExportToken } from "./domain/export-link.js";
import {
    createExportsRouter,
    EXPORT_DOWNLOAD_NOT_FOUND,
} from "./exports-route.js";
import {
    createMemoryExportArchiveStore,
    liveExportArchiveStore,
} from "./db/exports.js";
import {
    resetSessionSecretWarningForTest,
    resolveSessionSigningSecret,
} from "./site-session.js";
import { _resetBuckets } from "./rate-limit.js";
import { setSqlForTests } from "./db/sql.js";
import { describeDb } from "./db/testing/pg.js";
import { findPgBin } from "./db/testing/pg-temp.js";

const pgAvailable = await findPgBin();
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECRET = "test-session-secret-at-least-32-chars!!";

async function notFoundFingerprint(res: Response) {
    return {
        status: res.status,
        body: await res.text(),
        headers: {
            contentType: res.headers.get("Content-Type"),
        },
    };
}

describe("GET /exports/:token", () => {
    beforeEach(() => {
        process.env.SESSION_SECRET = SECRET;
        resetSessionSecretWarningForTest();
        _resetBuckets();
    });

    afterEach(() => {
        delete process.env.SESSION_SECRET;
    });

    test("200 serves the archive with required headers", async () => {
        const store = createMemoryExportArchiveStore();
        const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
        await store.put(USER, zip, 3600);
        const token = signExportToken(
            USER,
            Date.now() + 3600_000,
            resolveSessionSigningSecret(),
        );
        const app = new Hono();
        app.route("/", createExportsRouter(store));
        const res = await app.request(`http://localhost/exports/${token}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/zip");
        expect(res.headers.get("Content-Disposition")).toBe(
            'attachment; filename="foodable-export.zip"',
        );
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(zip);
    });

    test("identical 404 for invalid, expired, and missing archive", async () => {
        const store = createMemoryExportArchiveStore();
        const app = new Hono();
        app.route("/", createExportsRouter(store));
        const validToken = signExportToken(
            USER,
            Date.now() + 3600_000,
            resolveSessionSigningSecret(),
        );
        const expiredToken = signExportToken(
            USER,
            Date.now() - 1000,
            resolveSessionSigningSecret(),
        );
        const tampered = validToken.replace(
            "cccccccc",
            "dddddddd",
        );

        const cases = [
            await app.request("http://localhost/exports/not-valid"),
            await app.request(`http://localhost/exports/${expiredToken}`),
            await app.request(`http://localhost/exports/${tampered}`),
            await app.request(`http://localhost/exports/${validToken}`),
        ];
        expect(cases.every((r) => r.status === 404)).toBe(true);
        const bodies = await Promise.all(cases.map((r) => r.text()));
        expect(new Set(bodies)).toEqual(new Set([EXPORT_DOWNLOAD_NOT_FOUND]));
        const fingerprints = await Promise.all(cases.map(notFoundFingerprint));
        const first = fingerprints[0]!;
        for (const fp of fingerprints.slice(1)) {
            expect(fp.status).toBe(first.status);
            expect(fp.body).toBe(first.body);
            expect(fp.headers.contentType).toBe(first.headers.contentType);
        }
    });

    test("rate limit applies per IP", async () => {
        const store = createMemoryExportArchiveStore();
        const app = new Hono();
        app.route("/", createExportsRouter(store));
        const ip = "198.51.100.55";
        let blocked = false;
        for (let i = 0; i < 35; i++) {
            const res = await app.request("http://localhost/exports/garbage", {
                headers: { "x-forwarded-for": ip },
            });
            if (res.status === 429) {
                blocked = true;
                expect(res.headers.get("Retry-After")).toBeTruthy();
                break;
            }
        }
        expect(blocked).toBe(true);
    });
});

describeDb(pgAvailable !== null, "GET /exports with live store", (getCtx) => {
    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        process.env.SESSION_SECRET = SECRET;
        await sql`
            insert into public.users (id, email)
            values (${USER}, ${"route@test.local"})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
        delete process.env.SESSION_SECRET;
    });

    test("valid token returns bytes from Postgres", async () => {
        const zip = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
        await liveExportArchiveStore().put(USER, zip, 3600);
        const token = signExportToken(
            USER,
            Date.now() + 3600_000,
            resolveSessionSigningSecret(),
        );
        const app = new Hono();
        app.route("/", createExportsRouter());
        const res = await app.request(`http://localhost/exports/${token}`);
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(zip);
    });
});
