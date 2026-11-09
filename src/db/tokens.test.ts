import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    consumeAuthCode,
    consumeRefreshToken,
    lookupBearer,
    registerClient,
    storeAuthCode,
    storeRefreshToken,
    storeToken,
} from "./tokens.js";
import {
    hashHouseholdToken,
    householdTokenHashHex,
    HOUSEHOLD_TOKEN_PREFIX,
} from "../household-token.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { run, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

/**
 * Runs two real consume calls against each other on separate connections.
 * A third connection holds the row lock first, so both calls reach the row
 * before either can finish; releasing it lets them race. A consume that
 * reads and then deletes in separate steps lets both read the row before the
 * lock goes, so both would win.
 */
async function raceConsume<T>(opts: {
    url: string;
    sql: SQL;
    lockRow: (tx: SQL) => Promise<unknown>;
    consume: () => Promise<T>;
}): Promise<T[]> {
    const holder = new SQL(opts.url, { prepare: false, max: 1 });
    const left = new SQL(opts.url, { prepare: false, max: 1 });
    const right = new SQL(opts.url, { prepare: false, max: 1 });
    // Watches pg_stat_activity on its own connection, so a consume that
    // queues on the shared test client cannot block the watch.
    const observer = new SQL(opts.url, { prepare: false, max: 1 });
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((r) => (releaseLock = r));
    let lockTaken!: () => void;
    const lockHeld = new Promise<void>((r) => (lockTaken = r));
    const holding = holder.begin(async (tx) => {
        await opts.lockRow(tx);
        lockTaken();
        await lockReleased;
    });
    try {
        await lockHeld;
        // run() picks its client synchronously, so each call keeps its own.
        setSqlForTests(left);
        const first = opts.consume();
        setSqlForTests(right);
        const second = opts.consume();
        setSqlForTests(opts.sql);
        await waitForLockWaiters(observer, 2);
        releaseLock();
        await holding;
        return await Promise.all([first, second]);
    } finally {
        releaseLock();
        await Promise.allSettled([holding]);
        setSqlForTests(opts.sql);
        await Promise.all([
            holder.close(),
            left.close(),
            right.close(),
            observer.close(),
        ]);
    }
}

async function waitForLockWaiters(sql: SQL, count: number): Promise<void> {
    // Well inside the 5 s test timeout, so a failure reads as this message.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const [row] = await sql`
            select count(*)::int as n
            from pg_stat_activity
            where datname = current_database()
              and wait_event_type = 'Lock'
        `;
        if (row.n >= count) return;
        // oxlint-disable-next-line foodable/no-wall-clock-waits -- polls pg_stat_activity for sessions blocked on the row lock; Postgres emits no event to await
        await Bun.sleep(10);
    }
    throw new Error(`expected ${count} sessions waiting on the row lock`);
}

describeDb(pgAvailable !== null, "tokens db", (getCtx) => {
    let userId: string;
    let householdId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId, householdId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("storeToken and lookupBearer for user token", async () => {
        await storeToken("user-bearer-1", userId);
        expect(await lookupBearer("user-bearer-1")).toEqual({
            status: "valid",
            kind: "user",
            userId,
        });
    });

    test("expired oauth token is invalid", async () => {
        const { sql } = getCtx();
        setSqlForTests(sql);
        await run(async (tx) => {
            await tx`
                insert into oauth_tokens (token, user_id, expires_at)
                values (
                    ${"expired"},
                    ${userId},
                    ${"2020-01-01T00:00:00.000Z"}
                )
            `;
        });
        expect(await lookupBearer("expired")).toEqual({ status: "invalid" });
    });

    test("household bearer via resolve_household_mcp_token", async () => {
        const raw = `${HOUSEHOLD_TOKEN_PREFIX}${"a".repeat(32)}`;
        const hex = householdTokenHashHex(hashHouseholdToken(raw));
        const { sql } = getCtx();
        setSqlForTests(sql);
        await run(async (tx) => {
            await tx`
                insert into household_mcp_tokens (household_id, token_hash)
                values (
                    ${householdId},
                    decode(${hex}, 'hex')
                )
            `;
        });
        expect(await lookupBearer(raw)).toEqual({
            status: "valid",
            kind: "household",
            householdId,
        });
    });

    test("auth code store and single consume", async () => {
        await storeAuthCode(
            "code-1",
            "http://localhost/cb",
            userId,
            "challenge",
        );
        const first = await consumeAuthCode("code-1");
        expect(first).toMatchObject({
            code: "code-1",
            redirect_uri: "http://localhost/cb",
            user_id: userId,
            code_challenge: "challenge",
        });
        expect(await consumeAuthCode("code-1")).toBeNull();
    });

    test("refresh token store and single consume", async () => {
        await storeRefreshToken("refresh-1", userId);
        expect(await consumeRefreshToken("refresh-1")).toBe(userId);
        expect(await consumeRefreshToken("refresh-1")).toBeNull();
    });

    test("concurrent auth code consume allows only one winner", async () => {
        await storeAuthCode("race-code", "http://localhost/cb", userId);
        const { pg, sql } = getCtx();
        const results = await raceConsume({
            url: pg.url,
            sql,
            lockRow: (tx) =>
                tx`select 1 from auth_codes where code = 'race-code' for update`,
            consume: () => consumeAuthCode("race-code"),
        });
        const winners = results.filter((r) => r != null);
        expect(winners).toHaveLength(1);
        expect(winners[0]!.user_id).toBe(userId);
    });

    test("concurrent refresh token consume allows only one winner", async () => {
        await storeRefreshToken("race-refresh", userId);
        const { pg, sql } = getCtx();
        const results = await raceConsume({
            url: pg.url,
            sql,
            lockRow: (tx) =>
                tx`select 1 from refresh_tokens where token = 'race-refresh' for update`,
            consume: () => consumeRefreshToken("race-refresh"),
        });
        expect(results.filter((r) => r != null)).toEqual([userId]);
    });

    test("registerClient inserts without throwing", async () => {
        registerClient("test-client", ["http://localhost/a"]);
        // oxlint-disable-next-line foodable/no-wall-clock-waits -- registerClient is fire-and-forget and returns no promise to await
        await new Promise((r) => setTimeout(r, 30));
        const { sql } = getCtx();
        setSqlForTests(sql);
        const count = await run(async (tx) => {
            const [row] = await tx`
                select count(*)::int as n from registered_clients
            `;
            return row.n as number;
        });
        expect(count).toBe(1);
    });
});
