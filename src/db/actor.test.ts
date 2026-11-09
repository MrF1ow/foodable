import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
    currentActor,
    MISSING_ACTOR_MESSAGE,
    runAsSystem,
    withActor,
    type Actor,
} from "./actor.js";
import { rows, run, setSqlForTests } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

type PgSettings = {
    uid: string | null;
    household_id: string | null;
};

async function readPgActor(tx: Parameters<Parameters<typeof run>[0]>[0]) {
    const [row] = await rows<PgSettings>(
        tx,
        tx`
            select auth.uid()::text as uid,
                   nullif(current_setting('app.household_id', true), '') as household_id
        `,
    );
    return row!;
}

describeDb(
    pgAvailable !== null,
    "db actor context",
    (ctx) => {
        afterEach(() => {
            setSqlForTests(null);
        });

        test("withActor(user) sets jwt sub and household on the transaction", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            const userId = randomUUID();
            const householdId = randomUUID();
            const actor: Actor = {
                kind: "user",
                userId,
                householdId,
            };

            await withActor(actor, async () => {
                await run(async (tx) => {
                    const got = await readPgActor(tx);
                    expect(got.uid).toBe(userId);
                    expect(got.household_id).toBe(householdId);
                });
            });
            expect(currentActor()).toBeUndefined();
        });

        test("withActor(user) with null household leaves household setting empty", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            const userId = randomUUID();
            const actor: Actor = {
                kind: "user",
                userId,
                householdId: null,
            };

            await withActor(actor, async () => {
                await run(async (tx) => {
                    const got = await readPgActor(tx);
                    expect(got.uid).toBe(userId);
                    expect(got.household_id).toBeNull();
                });
            });
        });

        test("withActor(household) sets household only", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            const householdId = randomUUID();
            const actor: Actor = { kind: "household", householdId };

            await withActor(actor, async () => {
                await run(async (tx) => {
                    const got = await readPgActor(tx);
                    expect(got.uid).toBeNull();
                    expect(got.household_id).toBe(householdId);
                });
            });
        });

        test("runAsSystem clears jwt and household settings", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);

            await runAsSystem("test sweep", async () => {
                await run(async (tx) => {
                    const got = await readPgActor(tx);
                    expect(got.uid).toBeNull();
                    expect(got.household_id).toBeNull();
                });
            });
            expect(currentActor()).toBeUndefined();
        });

        test("nested run keeps the same actor settings", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            const userId = randomUUID();
            const householdId = randomUUID();

            await withActor({ kind: "user", userId, householdId }, async () => {
                await run(async (tx) => {
                    const outer = await readPgActor(tx);
                    expect(outer.uid).toBe(userId);

                    await run(async (innerTx) => {
                        const inner = await readPgActor(innerTx);
                        expect(inner).toEqual(outer);
                    });
                });
            });
        });

        test("settings do not leak across transactions on a pooled connection", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            const userId = randomUUID();
            const householdId = randomUUID();

            await withActor({ kind: "user", userId, householdId }, async () => {
                await run(async (tx) => {
                    const got = await readPgActor(tx);
                    expect(got.uid).toBe(userId);
                    expect(got.household_id).toBe(householdId);
                });
            });

            await runAsSystem("between", async () => {
                await run(async (tx) => {
                    const got = await readPgActor(tx);
                    expect(got.uid).toBeNull();
                    expect(got.household_id).toBeNull();
                });
            });

            const otherHousehold = randomUUID();
            await withActor(
                { kind: "household", householdId: otherHousehold },
                async () => {
                    await run(async (tx) => {
                        const got = await readPgActor(tx);
                        expect(got.uid).toBeNull();
                        expect(got.household_id).toBe(otherHousehold);
                    });
                },
            );
        });

        test("run() without an actor throws under the test runner", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            expect(currentActor()).toBeUndefined();
            await expect(run(async () => "unreachable")).rejects.toThrow(
                MISSING_ACTOR_MESSAGE,
            );
            expect(MISSING_ACTOR_MESSAGE).toContain("runAsSystem");
            expect(MISSING_ACTOR_MESSAGE).toContain("withActor");
        });

        test("a timer started inside runAsSystem keeps the system actor", async () => {
            const { sql } = ctx();
            setSqlForTests(sql);
            const seen = await new Promise<
                PgSettings & { actor: Actor | undefined }
            >((resolve, reject) => {
                void runAsSystem("timer test", async () => {
                    // oxlint-disable-next-line foodable/no-wall-clock-waits -- the background jobs start on setInterval; this checks the callback keeps its async context, it does not wait for time to pass
                    const handle = setInterval(() => {
                        clearInterval(handle);
                        run(async (tx) => ({
                            ...(await readPgActor(tx)),
                            actor: currentActor(),
                        })).then(resolve, reject);
                    }, 1);
                });
            });
            expect(seen.actor).toEqual({
                kind: "system",
                reason: "timer test",
            });
            expect(seen.uid).toBeNull();
            expect(seen.household_id).toBeNull();
        });
    },
    // No fallback actor: these tests say who is acting, and one proves that
    // nobody acting is an error.
    { actor: null },
);
