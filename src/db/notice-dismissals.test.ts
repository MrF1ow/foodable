import { afterEach, expect, test } from "bun:test";
import { liveNoticeDismissalsStore } from "./notice-dismissals.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "notice dismissals (live)", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("concurrent insert returns the same row", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId, userId } = await seedHousehold(sql);
        const store = liveNoticeDismissalsStore();
        const subjectId = crypto.randomUUID();
        const row = {
            householdId,
            code: "fridge.expiring" as const,
            subjectKind: "fridge_item" as const,
            subjectId,
            relatedKey: "",
            dismissedBy: userId,
        };
        const [a, b] = await Promise.all([
            store.insert(row),
            store.insert(row),
        ]);
        expect(a.id).toBe(b.id);
    });
});
