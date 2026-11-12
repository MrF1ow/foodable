import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    consumeAuthCode,
    consumeRefreshToken,
    isRegisteredClient,
    listConnections,
    connectionsQuery,
    lookupBearer,
    oauthTokenLookupQuery,
    registerClient,
    revokeConnection,
    touchTokenUse,
    storeAuthCode,
    storeRefreshToken,
    storeToken,
    withCodeExchange,
    withRefreshExchange,
} from "./tokens.js";
import {
    hashHouseholdToken,
    householdTokenHashHex,
    HOUSEHOLD_TOKEN_PREFIX,
} from "../household-token.js";
import { DB_SYSTEM_ACTOR, describeDb } from "./testing/pg.js";
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

describeDb(
    pgAvailable !== null,
    "tokens db",
    (getCtx) => {
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
                clientId: null,
                clientName: null,
                lastUsedAt: null,
            });
        });

        test("a token carries the registered client it was issued to", async () => {
            const clientId = await registerClient("Claude", [
                "http://localhost/a",
            ]);
            expect(clientId).toMatch(/^[0-9a-f-]{36}$/);
            await storeToken("app-token", userId, clientId);
            expect(await lookupBearer("app-token")).toEqual({
                status: "valid",
                kind: "user",
                userId,
                clientId,
                clientName: "Claude",
                lastUsedAt: null,
            });
        });

        test("a client id with no registration still rides on the token", async () => {
            await storeToken("static-token", userId, "static-client");
            expect(await lookupBearer("static-token")).toMatchObject({
                status: "valid",
                clientId: "static-client",
                clientName: null,
            });
        });

        test("isRegisteredClient is true only for a registered uuid", async () => {
            const clientId = await registerClient("Claude", [
                "http://localhost/a",
            ]);
            expect(await isRegisteredClient(clientId!)).toBe(true);
            expect(await isRegisteredClient(crypto.randomUUID())).toBe(false);
            expect(await isRegisteredClient("not-a-uuid")).toBe(false);
        });

        test("touchTokenUse writes once per interval and not again inside it", async () => {
            await storeToken("touched", userId, "c1");
            const t0 = new Date("2026-11-12T10:00:00.000Z");
            const interval = 10 * 60 * 1000;
            expect(await touchTokenUse("touched", t0, interval)).toBe(true);
            // Nine minutes later: inside the window, nothing is written.
            const t1 = new Date(t0.getTime() + 9 * 60 * 1000);
            expect(await touchTokenUse("touched", t1, interval)).toBe(false);
            const seen = await lookupBearer("touched");
            expect(seen).toMatchObject({ lastUsedAt: t0 });
            // Ten minutes after the first write: due again.
            const t2 = new Date(t0.getTime() + interval);
            expect(await touchTokenUse("touched", t2, interval)).toBe(true);
            expect(await lookupBearer("touched")).toMatchObject({
                lastUsedAt: t2,
            });
        });

        test("touchTokenUse on an unknown token writes nothing", async () => {
            expect(
                await touchTokenUse("nope", new Date(), 10 * 60 * 1000),
            ).toBe(false);
        });

        test("listConnections groups a member's tokens by client", async () => {
            const { sql } = getCtx();
            const claude = await registerClient("Claude", ["http://l/a"]);
            await run(async (tx) => {
                await tx`
                    insert into oauth_tokens
                        (token, user_id, expires_at, client_id, created_at, last_used_at)
                    values
                        ('a1', ${userId}, now() + interval '1 day', ${claude},
                         '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z'),
                        ('a2', ${userId}, now() + interval '1 day', ${claude},
                         '2026-11-03T00:00:00Z', '2026-11-09T00:00:00Z'),
                        ('a3', ${userId}, now() + interval '1 day', null,
                         '2026-10-01T00:00:00Z', null),
                        ('gone', ${userId}, '2020-01-01T00:00:00Z', ${claude},
                         '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')
                `;
            });
            setSqlForTests(sql);
            const list = await listConnections(userId);
            expect(list).toEqual([
                {
                    clientId: null,
                    clientName: null,
                    firstConnectedAt: new Date("2026-10-01T00:00:00Z"),
                    lastUsedAt: null,
                },
                {
                    clientId: claude,
                    clientName: "Claude",
                    firstConnectedAt: new Date("2026-11-01T00:00:00Z"),
                    lastUsedAt: new Date("2026-11-09T00:00:00Z"),
                },
            ]);
        });

        test("the bearer lookup and the connection list probe registered_clients by primary key", async () => {
            const { sql } = getCtx();
            setSqlForTests(sql);
            const claude = await registerClient("Claude", ["http://l/a"]);
            // /register is unauthenticated, so this table can be grown by
            // anyone; at this size a join on `rc.id::text = t.client_id` is
            // planned as a hash join over a sequential scan of it.
            await sql.unsafe(`
                insert into public.registered_clients (client_name)
                select 'c' || g from generate_series(1, 50000) g
            `);
            await storeToken("plan-token", userId, claude);
            await sql.unsafe("analyze public.registered_clients");
            await sql.unsafe("analyze public.oauth_tokens");

            const now = new Date().toISOString();
            const plans = await run(async (tx) => {
                const lookup =
                    await tx`explain ${oauthTokenLookupQuery(tx, "plan-token", now)}`;
                const list =
                    await tx`explain ${connectionsQuery(tx, userId, now)}`;
                return [lookup, list].map((p) =>
                    p
                        .map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"])
                        .join("\n"),
                );
            });
            for (const plan of plans) {
                expect(plan).toContain("registered_clients_pkey");
                expect(plan).not.toMatch(/Seq Scan on registered_clients/);
            }
        });

        test("revokeConnection removes every token for that client and only that user's", async () => {
            const other = await seedHousehold(getCtx().sql);
            await storeToken("mine-1", userId, "c1");
            await storeToken("mine-2", userId, "c1");
            await storeRefreshToken("mine-r", userId, "c1");
            await storeToken("mine-other-app", userId, "c2");
            await storeToken("theirs", other.userId, "c1");
            await storeRefreshToken("theirs-r", other.userId, "c1");

            expect(await revokeConnection(userId, "c1")).toBe(3);

            expect(await lookupBearer("mine-1")).toEqual({ status: "invalid" });
            expect(await lookupBearer("mine-2")).toEqual({ status: "invalid" });
            expect(await consumeRefreshToken("mine-r")).toBeNull();
            expect(await lookupBearer("mine-other-app")).toMatchObject({
                status: "valid",
            });
            expect(await lookupBearer("theirs")).toMatchObject({
                status: "valid",
            });
            expect(await consumeRefreshToken("theirs-r")).toEqual({
                userId: other.userId,
                clientId: "c1",
            });
        });

        test("revokeConnection also drops the member's unspent codes for that client", async () => {
            const other = await seedHousehold(getCtx().sql);
            await storeAuthCode("c-mine", "http://l/cb", userId, "ch", "c1");
            await storeAuthCode("c-mine-2", "http://l/cb", userId, "ch", "c2");
            await storeAuthCode(
                "c-theirs",
                "http://l/cb",
                other.userId,
                "ch",
                "c1",
            );
            await storeAuthCode("c-null", "http://l/cb", userId, "ch");

            await revokeConnection(userId, "c1");

            expect(await consumeAuthCode("c-mine")).toBeNull();
            expect(await consumeAuthCode("c-mine-2")).not.toBeNull();
            expect(await consumeAuthCode("c-theirs")).not.toBeNull();
            expect(await consumeAuthCode("c-null")).not.toBeNull();

            await revokeConnection(userId, null);
            await storeAuthCode("c-null-2", "http://l/cb", userId, "ch");
            await revokeConnection(userId, null);
            expect(await consumeAuthCode("c-null-2")).toBeNull();
        });

        test("revokeConnection with a null client removes the unknown-app tokens", async () => {
            await storeToken("old-1", userId);
            await storeRefreshToken("old-r", userId);
            await storeToken("known", userId, "c1");
            expect(await revokeConnection(userId, null)).toBe(2);
            expect(await lookupBearer("old-1")).toEqual({ status: "invalid" });
            expect(await consumeRefreshToken("old-r")).toBeNull();
            expect(await lookupBearer("known")).toMatchObject({
                status: "valid",
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
            expect(await lookupBearer("expired")).toEqual({
                status: "invalid",
            });
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
                client_id: null,
            });
            expect(await consumeAuthCode("code-1")).toBeNull();
        });

        test("auth code carries the client it was issued to", async () => {
            await storeAuthCode(
                "code-c",
                "http://localhost/cb",
                userId,
                "challenge",
                "client-9",
            );
            expect(await consumeAuthCode("code-c")).toMatchObject({
                client_id: "client-9",
            });
        });

        test("refresh token store and single consume", async () => {
            await storeRefreshToken("refresh-1", userId, "client-9");
            expect(await consumeRefreshToken("refresh-1")).toEqual({
                userId,
                clientId: "client-9",
            });
            expect(await consumeRefreshToken("refresh-1")).toBeNull();
        });

        test("withRefreshExchange hands back what the exchange returns, with the new pair stored", async () => {
            await storeRefreshToken("old-refresh", userId, "client-9");
            const result = await withRefreshExchange(
                "old-refresh",
                async () => {
                    const owner = await consumeRefreshToken("old-refresh");
                    await storeToken("new-access", userId, owner!.clientId);
                    await storeRefreshToken(
                        "new-refresh",
                        userId,
                        owner!.clientId,
                    );
                    return owner;
                },
            );
            expect(result).toEqual({ userId, clientId: "client-9" });
            expect(await consumeRefreshToken("old-refresh")).toBeNull();
            expect(await lookupBearer("new-access")).toMatchObject({
                status: "valid",
                userId,
                clientId: "client-9",
            });
            expect(await consumeRefreshToken("new-refresh")).not.toBeNull();
        });

        test("withRefreshExchange skips the exchange for a token that is unknown or expired", async () => {
            const { sql } = getCtx();
            await storeRefreshToken("stale-refresh", userId);
            await sql`
                update public.refresh_tokens
                set expires_at = now() - interval '1 minute'
                where token = 'stale-refresh'
            `;
            let called = 0;
            const exchange = async () => {
                called += 1;
                return "minted";
            };
            expect(await withRefreshExchange("nope", exchange)).toBeNull();
            expect(
                await withRefreshExchange("stale-refresh", exchange),
            ).toBeNull();
            expect(called).toBe(0);
        });

        test("withRefreshExchange rolls back when the exchange throws, so the old token is not burned", async () => {
            await storeRefreshToken("kept-refresh", userId, "client-9");
            await expect(
                withRefreshExchange("kept-refresh", async () => {
                    await consumeRefreshToken("kept-refresh");
                    await storeToken("half-minted", userId, "client-9");
                    throw new Error("store failed");
                }),
            ).rejects.toThrow("store failed");
            expect(await lookupBearer("half-minted")).toEqual({
                status: "invalid",
            });
            expect(await consumeRefreshToken("kept-refresh")).toEqual({
                userId,
                clientId: "client-9",
            });
        });

        test("withCodeExchange hands back what the exchange returns, with the pair stored", async () => {
            await storeAuthCode(
                "old-code",
                "http://localhost/cb",
                userId,
                "ch",
                "client-9",
            );
            const result = await withCodeExchange("old-code", async () => {
                const code = await consumeAuthCode("old-code");
                await storeToken("code-access", userId, code!.client_id);
                await storeRefreshToken(
                    "code-refresh",
                    userId,
                    code!.client_id,
                );
                return code;
            });
            expect(result).toMatchObject({
                user_id: userId,
                client_id: "client-9",
            });
            expect(await consumeAuthCode("old-code")).toBeNull();
            expect(await lookupBearer("code-access")).toMatchObject({
                status: "valid",
                userId,
                clientId: "client-9",
            });
            expect(await consumeRefreshToken("code-refresh")).not.toBeNull();
        });

        test("withCodeExchange skips the exchange for a code that is unknown or expired", async () => {
            const { sql } = getCtx();
            await storeAuthCode("stale-code", "http://localhost/cb", userId);
            await sql`
                update public.auth_codes
                set expires_at = now() - interval '1 minute'
                where code = 'stale-code'
            `;
            let called = 0;
            const exchange = async () => {
                called += 1;
                return "minted";
            };
            expect(await withCodeExchange("nope", exchange)).toBeNull();
            expect(await withCodeExchange("stale-code", exchange)).toBeNull();
            expect(called).toBe(0);
        });

        test("withCodeExchange keeps a consume whose checks failed, and rolls back when the exchange throws", async () => {
            await storeAuthCode("spent-code", "http://localhost/cb", userId);
            await storeAuthCode("kept-code", "http://localhost/cb", userId);
            // A refusal is a return value: the consume commits, the code is spent.
            expect(
                await withCodeExchange("spent-code", async () => {
                    await consumeAuthCode("spent-code");
                    return "refused";
                }),
            ).toBe("refused");
            expect(await consumeAuthCode("spent-code")).toBeNull();
            // A throw is an infrastructure failure: nothing is burned or stored.
            await expect(
                withCodeExchange("kept-code", async () => {
                    await consumeAuthCode("kept-code");
                    await storeToken("half-code-minted", userId, null);
                    throw new Error("store failed");
                }),
            ).rejects.toThrow("store failed");
            expect(await lookupBearer("half-code-minted")).toEqual({
                status: "invalid",
            });
            expect(await consumeAuthCode("kept-code")).not.toBeNull();
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
            expect(results.filter((r) => r != null)).toEqual([
                { userId, clientId: null },
            ]);
        });

        test("registerClient inserts and returns the new id", async () => {
            const id = await registerClient("test-client", [
                "http://localhost/a",
            ]);
            expect(id).not.toBeNull();
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
    },
    // OAuth tokens, codes and clients are issued and consumed by the OAuth flow,
    // which runs as the system.
    { actor: DB_SYSTEM_ACTOR },
);
