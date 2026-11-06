import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    liveSocialReaderStatusStore,
    setSocialReaderStatusStoreForTests,
} from "./social-readers.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "social_reader_status db", (getCtx) => {
    let householdId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
    });

    afterEach(() => {
        setSqlForTests(null);
        setSocialReaderStatusStoreForTests(null);
    });

    test("recordSuccess and recordFailure round-trip", async () => {
        const store = liveSocialReaderStatusStore();
        const at = new Date("2026-11-05T15:00:00.000Z");
        await store.recordSuccess(householdId, "tiktok", at);
        await store.recordFailure(
            householdId,
            "facebook",
            new Date("2026-11-06T10:00:00.000Z"),
            "blocked",
        );
        const rows = await store.get(householdId);
        expect(rows.find((r) => r.reader === "tiktok")).toMatchObject({
            lastSuccessAt: expect.stringMatching(/^2026-11-05T15:00:00/),
            lastFailureAt: null,
        });
        expect(rows.find((r) => r.reader === "facebook")).toMatchObject({
            lastFailureAt: expect.stringMatching(/^2026-11-06T10:00:00/),
            lastFailureReason: "blocked",
        });
    });
});
