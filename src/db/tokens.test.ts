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
        const results = await Promise.all([
            consumeAuthCode("race-code"),
            consumeAuthCode("race-code"),
        ]);
        expect(results.filter((r) => r != null)).toHaveLength(1);
    });

    test("registerClient inserts without throwing", async () => {
        registerClient("test-client", ["http://localhost/a"]);
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
