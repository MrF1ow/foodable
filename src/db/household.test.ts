import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    EMPTY_HOUSEHOLD_PREFERENCES,
    HouseholdAlreadyExistsError,
} from "../household.js";
import {
    addHouseholdMemberForHousehold,
    createHouseholdForCaller,
    getHouseholdConfig,
    getHouseholdMembership,
    householdExists,
    listHouseholdMembers,
    rotateHouseholdMcpToken,
    setHouseholdMemberRole,
    transferHouseholdOwnership,
    updateHouseholdConfig,
    updateMemberDisplayName,
} from "./household.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { run, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

async function seedUser(sql: import("bun").SQL): Promise<string> {
    const id = crypto.randomUUID();
    await sql`
        insert into auth.users (id, email)
        values (${id}, ${`u-${id}@foodable.test`})
    `;
    return id;
}

async function expectRejectsWithMessage(
    promise: Promise<unknown>,
    message: string,
): Promise<void> {
    const err = await promise.then(
        () => null,
        (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(message);
}

describeDb(pgAvailable !== null, "household db", (getCtx) => {
    let ownerId: string;
    let householdId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId: ownerId, householdId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("getHouseholdMembership with and without householdId", async () => {
        const m = await getHouseholdMembership(ownerId);
        expect(m).toMatchObject({
            householdId,
            userId: ownerId,
            role: "owner",
            displayName: "Owner",
        });
        expect(await getHouseholdMembership(ownerId, householdId)).toEqual(m);
        expect(await getHouseholdMembership(crypto.randomUUID())).toBeNull();
    });

    test("householdExists", async () => {
        expect(await householdExists()).toBe(true);
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        expect(await householdExists()).toBe(false);
    });

    test("createHouseholdForCaller success and already exists", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const userId = await seedUser(sql);
        const id = await createHouseholdForCaller(userId, "Home", "Alex");
        expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        await expect(
            createHouseholdForCaller(userId, "Other", "Alex"),
        ).rejects.toBeInstanceOf(HouseholdAlreadyExistsError);
    });

    test("listHouseholdMembers order and shape", async () => {
        const { sql } = getCtx();
        const memberA = await seedUser(sql);
        const memberZ = await seedUser(sql);
        await run(async (tx) => {
            await tx`
                insert into household_members (
                    household_id,
                    user_id,
                    role,
                    display_name
                )
                values
                    (${householdId}, ${memberA}, ${"member"}, ${"Alice"}),
                    (${householdId}, ${memberZ}, ${"member"}, ${"Zed"})
            `;
        });
        const list = await listHouseholdMembers(householdId);
        expect(list.map((m) => m.displayName)).toEqual([
            "Alice",
            "Owner",
            "Zed",
        ]);
    });

    test("addHouseholdMemberForHousehold success", async () => {
        const newUserId = crypto.randomUUID();
        const { sql } = getCtx();
        await sql`
            insert into auth.users (id, email)
            values (${newUserId}, ${`new-${newUserId}@foodable.test`})
        `;
        const result = await addHouseholdMemberForHousehold(
            householdId,
            {
                login: { kind: "username", username: "newperson" },
                password: "long-enough-password",
                displayName: "New Person",
            },
            {
                auth: {
                    createUser: async () => ({
                        ok: true as const,
                        userId: newUserId,
                    }),
                    deleteUser: async () => {},
                },
            },
        );
        expect(result).toEqual({ ok: true, userId: newUserId });
        expect(await getHouseholdMembership(newUserId)).toMatchObject({
            displayName: "New Person",
            role: "member",
        });
    });

    test("addHouseholdMemberForHousehold auth already registered", async () => {
        const result = await addHouseholdMemberForHousehold(
            householdId,
            {
                login: { kind: "username", username: "taken" },
                password: "long-enough-password",
                displayName: "Taken",
            },
            {
                auth: {
                    createUser: async () => ({
                        ok: false as const,
                        alreadyRegistered: true,
                        error: "User already registered",
                    }),
                    deleteUser: async () => {},
                },
            },
        );
        expect(result).toEqual({
            ok: false,
            error: "That login is already in use.",
        });
    });

    test("addHouseholdMemberForHousehold not a household member RPC error", async () => {
        const newUserId = crypto.randomUUID();
        const result = await addHouseholdMemberForHousehold(
            crypto.randomUUID(),
            {
                login: { kind: "username", username: "ghost" },
                password: "long-enough-password",
                displayName: "Ghost",
            },
            {
                auth: {
                    createUser: async () => ({
                        ok: true as const,
                        userId: newUserId,
                    }),
                    deleteUser: async () => {},
                },
            },
        );
        expect(result).toEqual({
            ok: false,
            error: "You must be a household member to add people.",
        });
    });

    test("getHouseholdConfig and updateHouseholdConfig", async () => {
        const config = await getHouseholdConfig(householdId);
        expect(config.name).toBe("Test household");
        expect(config.preferences).toEqual(EMPTY_HOUSEHOLD_PREFERENCES);
        const updated = await updateHouseholdConfig(householdId, {
            ...config,
            name: "Renamed",
        });
        expect(updated.name).toBe("Renamed");
    });

    test("rotateHouseholdMcpToken", async () => {
        const hex = "a".repeat(64);
        const issuedAt = await rotateHouseholdMcpToken({
            householdId,
            tokenHashHex: hex,
            issuedBy: ownerId,
        });
        expect(issuedAt).toMatch(/\+00:00$/);
    });

    test("updateMemberDisplayName", async () => {
        await updateMemberDisplayName(householdId, ownerId, "Captain");
        const m = await getHouseholdMembership(ownerId);
        expect(m?.displayName).toBe("Captain");
    });

    test("transferHouseholdOwnership success", async () => {
        const { sql } = getCtx();
        const memberId = await seedUser(sql);
        await run(async (tx) => {
            await tx`
                insert into household_members (
                    household_id,
                    user_id,
                    role,
                    display_name
                )
                values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
            `;
        });
        await transferHouseholdOwnership(householdId, ownerId, memberId);
        expect(await getHouseholdMembership(ownerId)).toMatchObject({
            role: "member",
        });
        expect(await getHouseholdMembership(memberId)).toMatchObject({
            role: "owner",
        });
    });

    test("transferHouseholdOwnership error paths", async () => {
        const { sql } = getCtx();
        const memberId = await seedUser(sql);
        await run(async (tx) => {
            await tx`
                insert into household_members (
                    household_id,
                    user_id,
                    role,
                    display_name
                )
                values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
            `;
        });
        await expectRejectsWithMessage(
            transferHouseholdOwnership(householdId, memberId, ownerId),
            "Failed to transfer ownership: only the household owner may transfer ownership",
        );
        await expectRejectsWithMessage(
            transferHouseholdOwnership(householdId, ownerId, ownerId),
            "Failed to transfer ownership: that person is already the owner",
        );
        await expectRejectsWithMessage(
            transferHouseholdOwnership(
                householdId,
                ownerId,
                crypto.randomUUID(),
            ),
            "Failed to transfer ownership: not a household member",
        );
    });

    test("setHouseholdMemberRole", async () => {
        const { sql } = getCtx();
        const memberId = await seedUser(sql);
        await run(async (tx) => {
            await tx`
                insert into household_members (
                    household_id,
                    user_id,
                    role,
                    display_name
                )
                values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
            `;
        });
        await setHouseholdMemberRole(householdId, memberId, "admin");
        expect(await getHouseholdMembership(memberId)).toMatchObject({
            role: "admin",
        });
        await expectRejectsWithMessage(
            setHouseholdMemberRole(householdId, ownerId, "admin"),
            "That person is not a member you can change.",
        );
    });
});
