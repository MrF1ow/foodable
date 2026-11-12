import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setFallbackActorForTests } from "./actor.js";
import { setSqlForTests } from "./sql.js";
import { seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { liveWeighInStore } from "./weigh-ins.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "weigh-ins db", (getCtx) => {
    let userId: string;
    let householdId: string;
    let otherHouseholdId: string;
    let otherUserId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId, householdId } = await seedHousehold(sql));
        ({ userId: otherUserId, householdId: otherHouseholdId } =
            await seedHousehold(sql));
        setFallbackActorForTests({ kind: "user", userId, householdId });
    });

    afterEach(() => {
        setSqlForTests(null);
        setFallbackActorForTests(null);
    });

    async function weigh(user: string, loggedAt: string) {
        const { sql } = getCtx();
        await sql`
            insert into public.weight_log (user_id, weight_g, logged_at)
            values (${user}, ${70_000}, ${loggedAt}::timestamptz)
        `;
    }

    async function addMember(name: string): Promise<string> {
        const { sql } = getCtx();
        const id = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${id}, ${`m-${id}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${id}, ${"member"}, ${name})
        `;
        return id;
    }

    test("the latest weigh-in of each member who has logged weight", async () => {
        const kim = await addMember("Kim");
        await addMember("Never"); // no weight log ever: absent
        await weigh(userId, "2026-11-01T08:00:00Z");
        await weigh(userId, "2026-11-05T21:30:15.250Z");
        await weigh(kim, "2026-10-20T06:00:00Z");
        const latest = await liveWeighInStore().latestWeighIns(householdId);
        expect(latest).toEqual([
            {
                userId: kim,
                displayName: "Kim",
                lastLoggedAt: "2026-10-20T06:00:00.000Z",
            },
            {
                userId,
                displayName: "Owner",
                lastLoggedAt: "2026-11-05T21:30:15.250Z",
            },
        ]);
    });

    test("another household's members are not included", async () => {
        await weigh(otherUserId, "2026-11-05T12:00:00Z");
        expect(await liveWeighInStore().latestWeighIns(householdId)).toEqual(
            [],
        );
        expect(otherHouseholdId).not.toBe(householdId);
    });
});
