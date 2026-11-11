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
    getPluralsSameFood,
    householdExists,
    listHouseholdMembers,
    removeHouseholdMemberAccount,
    rotateHouseholdMcpToken,
    setHouseholdMemberRole,
    setPluralsSameFood,
    transferHouseholdOwnership,
    updateHouseholdConfig,
    updateMemberDisplayName,
} from "./household.js";
import { describeDb } from "./testing/pg.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

async function seedUser(sql: import("bun").SQL): Promise<string> {
    const id = crypto.randomUUID();
    await sql`
        insert into public.users (id, email)
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

    test("householdExists for a signed-in user outside the household", async () => {
        // Row level security shows that user no household; the first-user
        // gate must still see that one exists.
        const outsider = await seedUser(getCtx().sql);
        expect(await asUser(outsider, () => householdExists())).toBe(true);
    });

    test("removeHouseholdMemberAccount removes a member's login and data, never the owner", async () => {
        const { sql } = getCtx();
        const member = await seedUser(sql);
        const outsider = await seedUser(sql);
        await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${householdId}, ${member}, 'member', 'Sam')
        `;
        await sql`
            insert into public.oauth_tokens (token, user_id, expires_at)
            values (${`t-${member}`}, ${member}, now() + interval '1 day')
        `;
        await expectRejectsWithMessage(
            removeHouseholdMemberAccount(householdId, ownerId),
            "Only a member other than the owner can be removed.",
        );
        await expectRejectsWithMessage(
            removeHouseholdMemberAccount(householdId, outsider),
            "Only a member other than the owner can be removed.",
        );
        // Acting as the owner, the way the members page does.
        await removeHouseholdMemberAccount(householdId, member);
        const [left] = await sql`
            select
                (select count(*)::int from public.users where id = ${member}) as users,
                (select count(*)::int from public.oauth_tokens where user_id = ${member}) as tokens,
                (select count(*)::int from public.users where id = ${outsider}) as outsider
        `;
        expect(left).toEqual({ users: 0, tokens: 0, outsider: 1 });
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

    test("createHouseholdForCaller allows a second household only when open", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const first = await seedUser(sql);
        await createHouseholdForCaller(first, "Alpha", "Ava");
        const second = await seedUser(sql);
        await expect(
            createHouseholdForCaller(second, "Beta", "Ben"),
        ).rejects.toBeInstanceOf(HouseholdAlreadyExistsError);
        const secondId = await createHouseholdForCaller(second, "Beta", "Ben", {
            allowAdditional: true,
        });
        expect(secondId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
    });

    test("create_household serialises creations: two racing calls make one household", async () => {
        const { sql, pg, truncateAll } = getCtx();
        await truncateAll();
        const first = await seedUser(sql);
        const second = await seedUser(sql);
        const { SQL } = await import("bun");
        const a = new SQL(pg.url, { prepare: false, max: 1 });
        const b = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            await a.unsafe("begin");
            await a`select public.create_household(${first}::uuid, 'A', 'Ann', false)`;
            await b.unsafe("begin");
            // Without the lock this would see no committed household and succeed.
            const racing =
                b`select public.create_household(${second}::uuid, 'B', 'Bo', false)`.then(
                    () => "created",
                    (err: unknown) =>
                        err instanceof Error ? err.message : String(err),
                );
            // Wait until the second call either finished or is queued on the lock.
            let settled = false;
            void racing.then(() => {
                settled = true;
            });
            for (let i = 0; i < 1000 && !settled; i++) {
                const [waiting] = (await sql`
                    select count(*)::int as n
                    from pg_locks
                    where locktype = 'advisory' and not granted
                `) as { n: number }[];
                if (waiting!.n > 0) break;
            }
            await a.unsafe("commit");
            expect(await racing).toContain("household already exists");
            await b.unsafe("rollback");
        } finally {
            await a.close();
            await b.close();
        }
        const [row] = (await sql`
            select count(*)::int as n from public.households
        `) as { n: number }[];
        expect(row!.n).toBe(1);
    });

    test("a member of a household cannot create or join another", async () => {
        const { sql } = getCtx();
        await expect(
            createHouseholdForCaller(ownerId, "Second", "Ann", {
                allowAdditional: true,
            }),
        ).rejects.toBeInstanceOf(HouseholdAlreadyExistsError);
        const [count] = (await sql`
            select count(*)::int as n from public.households
        `) as { n: number }[];
        expect(count!.n).toBe(1);

        // The database itself holds one household per person.
        const otherHousehold = crypto.randomUUID();
        await sql`insert into public.households (id, name) values (${otherHousehold}, 'Other')`;
        // Awaited by hand: expect().rejects on a lazy Bun.sql query never settles.
        const err = await sql`
            insert into public.household_members (household_id, user_id, role, display_name)
            values (${otherHousehold}, ${ownerId}, 'owner', 'Ann')
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(String(err)).toContain(
            "household_members_one_household_per_user",
        );
    });

    test("listHouseholdMembers order and shape", async () => {
        const { sql } = getCtx();
        const memberA = await seedUser(sql);
        const memberZ = await seedUser(sql);
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values
                (${householdId}, ${memberA}, ${"member"}, ${"Alice"}),
                (${householdId}, ${memberZ}, ${"member"}, ${"Zed"})
        `;
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
            insert into public.users (id, email)
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

    test("plurals_same_food defaults false, round-trips, and stays per household", async () => {
        expect(await getPluralsSameFood(householdId)).toBe(false);
        expect(await setPluralsSameFood(householdId, true)).toBe(true);
        expect(await getPluralsSameFood(householdId)).toBe(true);
        expect(await setPluralsSameFood(householdId, false)).toBe(false);
        expect(await getPluralsSameFood(householdId)).toBe(false);

        const { sql } = getCtx();
        const other = await seedHousehold(sql);
        const [otherRow] = (await sql`
            select plurals_same_food
            from public.households
            where id = ${other.householdId}
        `) as { plurals_same_food: boolean }[];
        expect(otherRow!.plurals_same_food).toBe(false);

        await asUser(
            ownerId,
            () => setPluralsSameFood(householdId, true),
            householdId,
        );
        const [stillOff] = (await sql`
            select plurals_same_food
            from public.households
            where id = ${other.householdId}
        `) as { plurals_same_food: boolean }[];
        expect(stillOff!.plurals_same_food).toBe(false);

        await asUser(
            ownerId,
            () =>
                expectRejectsWithMessage(
                    getPluralsSameFood(other.householdId),
                    "Failed to load plurals_same_food",
                ),
            householdId,
        );
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
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
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
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
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
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
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
