import { afterEach, beforeEach, expect, test } from "bun:test";
import { DB_SYSTEM_ACTOR, describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import { liveFlagPinStore } from "./flag-pins.js";
import type { Pin } from "../domain/flag-pins.js";
import type { SQL } from "bun";

const pgAvailable = await findPgBin();

const HOUR = 60 * 60 * 1000;

function pin(over: Partial<Pin> = {}): Pin {
    const assignedAt = Date.parse("2026-11-08T10:00:00.000Z");
    return {
        flag: "ui-v2",
        value: true,
        reason: "TARGETING_MATCH",
        epoch: 0,
        assignedAt,
        expiresAt: assignedAt + 12 * HOUR,
        ...over,
    };
}

// A deploy has one household, so a second subject is a bare extra user.
async function seedUser(sql: SQL): Promise<string> {
    const id = crypto.randomUUID();
    await sql`
        insert into public.users (id, email)
        values (${id}, ${`test-${id}@foodable.test`})
    `;
    return id;
}

describeDb(
    pgAvailable !== null,
    "flag pins db",
    (getCtx) => {
        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
        });

        afterEach(() => {
            setSqlForTests(null);
        });

        // loadPins filters on the database clock, so loads use far-future pins.
        const future = () => Date.now() + 24 * HOUR;

        test("upsert inserts, then updates on conflict", async () => {
            const { sql } = getCtx();
            const { userId } = await seedHousehold(sql);
            const store = liveFlagPinStore();
            const subject = { kind: "user", id: userId } as const;
            const first = pin({
                assignedAt: Date.now(),
                expiresAt: future(),
                epoch: 1,
            });
            await store.upsertPin(subject, first);
            expect(await store.loadPins(subject)).toEqual([first]);

            const second = pin({
                value: false,
                reason: "NO_MATCH",
                epoch: 2,
                assignedAt: Date.now() + 1000,
                expiresAt: future() + 1000,
            });
            await store.upsertPin(subject, second);
            expect(await store.loadPins(subject)).toEqual([second]);
            const [counted] = (await sql`
            select count(*)::int as n from public.flag_assignments
        `) as { n: number }[];
            expect(counted?.n).toBe(1);
        });

        test("user and household rows set the right column", async () => {
            const { sql } = getCtx();
            const { userId, householdId } = await seedHousehold(sql);
            const store = liveFlagPinStore();
            const exp = { assignedAt: Date.now(), expiresAt: future() };
            await store.upsertPin({ kind: "user", id: userId }, pin(exp));
            await store.upsertPin(
                { kind: "household", id: householdId },
                pin({ flag: "t-hh", ...exp }),
            );
            const rows = (await sql`
            select subject_kind, user_id, household_id, subject_id, flag_name
            from public.flag_assignments order by subject_kind desc
        `) as {
                subject_kind: string;
                user_id: string | null;
                household_id: string | null;
                subject_id: string;
                flag_name: string;
            }[];
            expect(rows).toEqual([
                {
                    subject_kind: "user",
                    user_id: userId,
                    household_id: null,
                    subject_id: userId,
                    flag_name: "ui-v2",
                },
                {
                    subject_kind: "household",
                    user_id: null,
                    household_id: householdId,
                    subject_id: householdId,
                    flag_name: "t-hh",
                },
            ]);
        });

        test("loadPins returns one subject only and skips expired rows", async () => {
            const { sql } = getCtx();
            const a = await seedHousehold(sql);
            const b = { userId: await seedUser(sql) };
            const store = liveFlagPinStore();
            const live = { assignedAt: Date.now(), expiresAt: future() };
            await store.upsertPin({ kind: "user", id: a.userId }, pin(live));
            await store.upsertPin(
                { kind: "user", id: b.userId },
                pin({ flag: "other", ...live }),
            );
            await store.upsertPin(
                { kind: "household", id: a.householdId },
                pin({ flag: "hh-flag", ...live }),
            );
            await store.upsertPin(
                { kind: "user", id: a.userId },
                pin({
                    flag: "old",
                    assignedAt: Date.now() - 2 * HOUR,
                    expiresAt: Date.now() - HOUR,
                }),
            );
            const mine = await store.loadPins({ kind: "user", id: a.userId });
            expect(mine.map((p) => p.flag)).toEqual(["ui-v2"]);
            const theirs = await store.loadPins({ kind: "user", id: b.userId });
            expect(theirs.map((p) => p.flag)).toEqual(["other"]);
            const hh = await store.loadPins({
                kind: "household",
                id: a.householdId,
            });
            expect(hh.map((p) => p.flag)).toEqual(["hh-flag"]);
        });

        test("value round-trips as a json boolean and non-booleans are ignored", async () => {
            const { sql } = getCtx();
            const { userId } = await seedHousehold(sql);
            const store = liveFlagPinStore();
            const subject = { kind: "user", id: userId } as const;
            const exp = { assignedAt: Date.now(), expiresAt: future() };
            await store.upsertPin(subject, pin({ value: false, ...exp }));
            const [row] = (await sql`
            select jsonb_typeof(value) as t, value::text as v
            from public.flag_assignments
        `) as { t: string; v: string }[];
            expect(row).toEqual({ t: "boolean", v: "false" });
            expect((await store.loadPins(subject))[0]?.value).toBe(false);

            await sql`
            insert into public.flag_assignments
                (subject_kind, user_id, flag_name, value, reason, expires_at)
            values ('user', ${userId}, 'weird', '"yes"'::jsonb, 'X',
                    now() + interval '1 hour')
        `;
            expect((await store.loadPins(subject)).map((p) => p.flag)).toEqual([
                "ui-v2",
            ]);
        });

        test("clearPins deletes only that subject's rows", async () => {
            const { sql } = getCtx();
            const a = await seedHousehold(sql);
            const b = { userId: await seedUser(sql) };
            const store = liveFlagPinStore();
            const exp = { assignedAt: Date.now(), expiresAt: future() };
            await store.upsertPin({ kind: "user", id: a.userId }, pin(exp));
            await store.upsertPin(
                { kind: "user", id: a.userId },
                pin({ flag: "second", ...exp }),
            );
            await store.upsertPin({ kind: "user", id: b.userId }, pin(exp));
            await store.clearPins({ kind: "user", id: a.userId });
            expect(
                await store.loadPins({ kind: "user", id: a.userId }),
            ).toEqual([]);
            expect(
                (await store.loadPins({ kind: "user", id: b.userId })).length,
            ).toBe(1);
        });

        test("sweepExpired deletes expired rows and counts them", async () => {
            const { sql } = getCtx();
            const { userId } = await seedHousehold(sql);
            const store = liveFlagPinStore();
            const subject = { kind: "user", id: userId } as const;
            const now = Date.now();
            await store.upsertPin(
                subject,
                pin({
                    flag: "old",
                    assignedAt: now - 2 * HOUR,
                    expiresAt: now - HOUR,
                }),
            );
            await store.upsertPin(
                subject,
                pin({ flag: "fresh", assignedAt: now, expiresAt: future() }),
            );
            expect(await store.sweepExpired(now)).toBe(1);
            const left = (await sql`
            select flag_name from public.flag_assignments
        `) as { flag_name: string }[];
            expect(left.map((r) => r.flag_name)).toEqual(["fresh"]);
            expect(await store.sweepExpired(now)).toBe(0);
        });

        test("snapshot upserts and loads booleans", async () => {
            const store = liveFlagPinStore();
            expect((await store.loadSnapshot()).size).toBe(0);
            await store.saveSnapshot("off-lookups", false);
            await store.saveSnapshot("barcode-camera", true);
            await store.saveSnapshot("off-lookups", true);
            const snap = await store.loadSnapshot();
            expect([...snap].sort()).toEqual([
                ["barcode-camera", true],
                ["off-lookups", true],
            ]);
            const { sql } = getCtx();
            const [counted] = (await sql`
            select count(*)::int as n from public.flag_snapshot
        `) as { n: number }[];
            expect(counted?.n).toBe(2);
        });

        test("alternating households never overwrite each other's snapshot row", async () => {
            const { sql } = getCtx();
            const householdA = crypto.randomUUID();
            const householdB = crypto.randomUUID();
            const store = liveFlagPinStore();
            await store.saveSnapshot("off-lookups", false, {
                kind: "household",
                id: householdA,
            });
            await store.saveSnapshot("off-lookups", true, {
                kind: "household",
                id: householdB,
            });
            await store.saveSnapshot("off-lookups", false, {
                kind: "household",
                id: householdA,
            });
            expect(
                (
                    await store.loadSnapshot({
                        kind: "household",
                        id: householdA,
                    })
                ).get("off-lookups"),
            ).toBe(false);
            expect(
                (
                    await store.loadSnapshot({
                        kind: "household",
                        id: householdB,
                    })
                ).get("off-lookups"),
            ).toBe(true);
            const [counted] = (await sql`
            select count(*)::int as n from public.flag_snapshot
            where flag_name = 'off-lookups'
        `) as { n: number }[];
            expect(counted?.n).toBe(2);
        });

        test("snapshot upserts stay separate per subject", async () => {
            const { sql } = getCtx();
            const householdA = crypto.randomUUID();
            const householdB = crypto.randomUUID();
            const store = liveFlagPinStore();
            await store.saveSnapshot("off-lookups", true);
            await store.saveSnapshot("off-lookups", false, {
                kind: "household",
                id: householdA,
            });
            await store.saveSnapshot("off-lookups", true, {
                kind: "household",
                id: householdB,
            });
            expect((await store.loadSnapshot()).get("off-lookups")).toBe(true);
            expect(
                (
                    await store.loadSnapshot({
                        kind: "household",
                        id: householdA,
                    })
                ).get("off-lookups"),
            ).toBe(false);
            expect(
                (
                    await store.loadSnapshot({
                        kind: "household",
                        id: householdB,
                    })
                ).get("off-lookups"),
            ).toBe(true);
            const [counted] = (await sql`
            select count(*)::int as n from public.flag_snapshot
        `) as { n: number }[];
            expect(counted?.n).toBe(3);
        });
    },
    // The flag pin cache is process-wide and runs as the system.
    { actor: DB_SYSTEM_ACTOR },
);
