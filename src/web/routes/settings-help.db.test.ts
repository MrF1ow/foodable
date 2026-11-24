import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold, seedMember } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { HELP_GLOSSARY_IDS } from "../pages/v2/settings-help.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", settingsRoutes);

function get(userId: string | null, path: string) {
    return app.request(`http://test${path}`, {
        headers: userId
            ? { cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}` }
            : {},
    });
}

/** The ids of the topics a Help page lists. */
function listed(html: string): string[] {
    return [
        ...html.matchAll(
            /<details class="fd-item-row__disclosure" id="([^"]+)"/g,
        ),
    ].map((m) => m[1]!);
}

describeDb(pgAvailable !== null, "Settings › Help search", (getCtx) => {
    let ownerId: string;
    let memberId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        ownerId = seeded.userId;
        memberId = await seedMember(sql, seeded.householdId);
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    test("every member reads Help; with no q it lists every topic", async () => {
        for (const userId of [ownerId, memberId]) {
            const res = await get(userId, "/settings/help");
            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain('data-fd-settings-page="help"');
            expect(listed(html)).toEqual([...HELP_GLOSSARY_IDS]);
        }
    });

    test("q lists the topics that hold every word, and the field keeps what was typed", async () => {
        const res = await get(memberId, "/settings/help?q=export+zip");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(listed(html)).toEqual(["export-data"]);
        expect(html).toContain('value="export zip"');
        const none = await (
            await get(memberId, "/settings/help?q=zzzz")
        ).text();
        expect(listed(none)).toEqual([]);
        expect(none).toContain("No topics match");
    });

    test("odd input in q is a normal page, never an error", async () => {
        const hostile = encodeURIComponent('"><script>alert(1)</script>');
        const cases = [
            "",
            "%20%20",
            ".*",
            "(",
            "%5C",
            "q=a&q=b",
            "a".repeat(5000),
            hostile,
            "%00",
            "%E2%98%95+caf%C3%A9",
            "%F0%9F%8D%8E%F0%9F%8D%8E",
            Array.from({ length: 300 }, () => "food").join("+"),
        ];
        for (const q of cases) {
            const path = q.startsWith("q=")
                ? `/settings/help?${q}`
                : `/settings/help?q=${q}`;
            const res = await get(ownerId, path);
            expect(res.status, path.slice(0, 60)).toBe(200);
            const html = await res.text();
            expect(html).not.toContain("<script>alert(1)");
            expect(html).toContain('aria-label="Search help"');
        }
        // A repeated q uses the first one.
        const repeated = await (
            await get(ownerId, "/settings/help?q=export&q=zzzz")
        ).text();
        expect(listed(repeated)).toEqual(["export-data"]);
    });

    test("signed out, a search gets the login page, not Help", async () => {
        const res = await get(null, "/settings/help?q=export");
        const html = await res.text();
        expect(html).not.toContain("fd-item-row__disclosure");
        expect(html).not.toContain('data-fd-settings-page="help"');
    });
});
